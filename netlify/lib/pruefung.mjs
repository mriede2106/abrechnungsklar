import { PROMPTS, ERLAUBTE_TYPEN } from "./prompts.mjs";

const API = "https://api.anthropic.com/v1";
const MAX_BYTES = 8 * 1024 * 1024;

export function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Umgebungsvariable ${name} fehlt`);
  }
  return v;
}

function anthropicHeaders() {
  return {
    "x-api-key": env("ANTHROPIC_API_KEY"),
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
}

export function slug(text, max = 20) {
  return String(text || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, max) || "kunde";
}

// custom_id: max. 64 Zeichen, nur [a-zA-Z0-9_-]
export function makeCustomId(kuerzel, submissionId, name) {
  return `${kuerzel}_${slug(submissionId, 30)}_${slug(name, 20)}`.slice(0, 64);
}

export function parseCustomId(id) {
  const [kuerzel, submissionId, ...rest] = String(id).split("_");
  return { kuerzel, submissionId, name: rest.join("_").replace(/-/g, " ") };
}

function fileInfo(value) {
  if (!value) return null;
  if (typeof value === "string") return value.startsWith("http") ? { url: value } : null;
  if (typeof value === "object" && value.url) return value;
  return null;
}

function guessType(name, headerType) {
  const t = (headerType || "").split(";")[0].trim().toLowerCase();
  if (ERLAUBTE_TYPEN.includes(t)) return t;
  const ext = String(name || "").toLowerCase().split(".").pop();
  return { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" }[ext] || t;
}

// Lädt die hochgeladenen Dateien und baut die Inhaltsblöcke für das Modell.
export async function loadDocuments(data, dateiFelder, fetchImpl = fetch) {
  const blocks = [];
  const hinweise = [];
  let total = 0;
  for (const feld of dateiFelder) {
    const info = fileInfo(data[feld]);
    if (!info) continue;
    const name = info.filename || info.name || feld;
    try {
      const res = await fetchImpl(info.url);
      if (!res.ok) { hinweise.push(`${feld}: Download fehlgeschlagen (${res.status})`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      total += buf.length;
      if (total > MAX_BYTES) { hinweise.push(`${feld}: übersprungen, Gesamtgröße über 8 MB`); continue; }
      const type = guessType(name, info.type || res.headers.get("content-type"));
      if (!ERLAUBTE_TYPEN.includes(type)) { hinweise.push(`${feld} (${name}): Dateityp ${type || "unbekannt"} nicht lesbar`); continue; }
      blocks.push({ type: "text", text: `Datei "${name}" (Formularfeld: ${feld}):` });
      blocks.push(type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: type, data: buf.toString("base64") } }
        : { type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } });
    } catch (e) {
      hinweise.push(`${feld}: Fehler beim Laden (${e.message})`);
    }
  }
  return { blocks, hinweise };
}

const DATEI_ODER_TECHNIK = new Set(["form-name", "bot-field", "datenschutz", "email", "telefon", "name"]);

export function kundenangaben(data, dateiFelder) {
  return Object.entries(data)
    .filter(([k, v]) => !DATEI_ODER_TECHNIK.has(k) && !dateiFelder.includes(k) && typeof v === "string" && v.trim())
    .map(([k, v]) => `- ${k}: ${v.trim()}`)
    .join("\n") || "- keine";
}

export function buildBatchRequest({ formName, submissionId, data, blocks, hinweise }) {
  const cfg = PROMPTS[formName];
  const text = `Prüfe die beigefügten Unterlagen.

Angaben des Kunden aus dem Formular:
${kundenangaben(data, cfg.dateiFelder)}

Technische Hinweise zu den Uploads:
${hinweise.length ? hinweise.map(h => "- " + h).join("\n") : "- alle Dateien geladen"}

Heutiges Datum: ${new Date().toISOString().slice(0, 10)}`;
  return {
    custom_id: makeCustomId(cfg.kuerzel, submissionId, data.name),
    params: {
      model: env("MODEL", "claude-sonnet-5-5"),
      max_tokens: 8000,
      system: cfg.system,
      messages: [{ role: "user", content: [...blocks, { type: "text", text }] }],
    },
  };
}

export async function createBatch(request, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/messages/batches`, {
    method: "POST", headers: anthropicHeaders(), body: JSON.stringify({ requests: [request] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

export async function listBatches(fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/messages/batches?limit=50`, { headers: anthropicHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body.data || [];
}

export async function fetchResults(batch, fetchImpl = fetch) {
  const url = batch.results_url || `${API}/messages/batches/${batch.id}/results`;
  const res = await fetchImpl(url, { headers: anthropicHeaders() });
  if (!res.ok) throw new Error(`Ergebnisse ${batch.id}: ${res.status}`);
  const text = await res.text();
  return text.split("\n").filter(Boolean).map(l => JSON.parse(l));
}

export async function deleteBatch(id, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/messages/batches/${id}`, { method: "DELETE", headers: anthropicHeaders() });
  if (!res.ok) throw new Error(`Löschen ${id}: ${res.status}`);
}

export function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Keine JSON-Antwort");
  return JSON.parse(text.slice(start, end + 1));
}

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = n => (typeof n === "number" ? n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "–");
const num = (n, d = 0) => (typeof n === "number" ? n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const LABEL = { RUECKZAHLUNG: "Rückzahlung", EINSPARUNG: "Einsparung", HINWEIS: "Hinweis", NICHT_PRUEFBAR: "Nicht prüfbar" };
const FARBE = { RUECKZAHLUNG: "#c4361c", EINSPARUNG: "#b26a00", HINWEIS: "#2f5d8a", NICHT_PRUEFBAR: "#6b7280" };

export function renderReport(r, { titel, kunde, submissionId, modus, eckdaten = true }) {
  const ek = r.eckdaten || {};
  const befunde = Array.isArray(r.befunde) ? r.befunde : [];
  const summe = befunde.filter(b => b.einordnung === "RUECKZAHLUNG" && typeof b.betrag_eur === "number").reduce((a, b) => a + b.betrag_eur, 0);
  const rows = befunde.map((b, i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #ddd;vertical-align:top">${i + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;vertical-align:top">
        <span style="display:inline-block;padding:2px 6px;border-radius:3px;color:#fff;background:${FARBE[b.einordnung] || "#6b7280"};font-size:11px">${esc(LABEL[b.einordnung] || b.einordnung)}</span>
        <b style="display:block;margin-top:4px">${esc(b.titel)}</b>
        <div>${esc(b.beschreibung)}</div>
        ${b.rechnung ? `<div style="font-family:monospace;font-size:12px;color:#444;margin-top:4px">${esc(b.rechnung)}</div>` : ""}
        ${b.fundstelle ? `<div style="font-size:12px;color:#666">Fundstelle: ${esc(b.fundstelle)}</div>` : ""}
        ${b.naechster_schritt ? `<div style="margin-top:4px"><i>Nächster Schritt:</i> ${esc(b.naechster_schritt)}</div>` : ""}
      </td>
      <td style="padding:8px;border-bottom:1px solid #ddd;vertical-align:top;white-space:nowrap;text-align:right">${eur(b.betrag_eur)}<div style="font-size:11px;color:#666">Sicherheit: ${esc(b.sicherheit)}</div></td>
    </tr>`).join("");
  const hinweisPruefer = modus === "direkt" ? "" : `
    <div style="background:#fff4e5;border:1px solid #f0c27b;padding:10px;margin-bottom:16px;font-size:13px">
      <b>Entwurf für dich.</b> Bitte jeden Befund „Rückzahlung“ am Original nachvollziehen, Befunde mit Sicherheit „niedrig“ streichen oder als Frage formulieren, dann an den Kunden weiterleiten.<br>
      Kunde: ${esc(kunde)} · Netlify-Anfrage: ${esc(submissionId)}
    </div>`;
  return `<!DOCTYPE html><html lang="de"><body style="font-family:Arial,Helvetica,sans-serif;color:#17222c;max-width:720px;margin:0 auto;padding:16px">
  ${hinweisPruefer}
  <h2 style="margin:0 0 4px">${esc(titel)}</h2>
  <div style="color:#666;font-size:13px;margin-bottom:16px">${esc(ek.versorger)} ${esc(ek.energieart)} · ${esc(ek.zeitraum)}</div>
  <p>${esc(r.zusammenfassung)}</p>
  ${summe > 0 ? `<p style="font-size:18px"><b>Mögliche Rückzahlung bzw. Korrektur: ${eur(summe)}</b></p>` : ""}
  ${!eckdaten ? "" : `<table style="border-collapse:collapse;font-size:13px;margin:12px 0">
    <tr><td style="padding:3px 12px 3px 0;color:#666">Verbrauch</td><td>${num(ek.verbrauch_kwh)} kWh</td></tr>
    <tr><td style="padding:3px 12px 3px 0;color:#666">Arbeitspreis</td><td>${num(ek.arbeitspreis_ct_kwh, 2)} ct/kWh</td></tr>
    <tr><td style="padding:3px 12px 3px 0;color:#666">Grundpreis</td><td>${eur(ek.grundpreis_eur_monat)} pro Monat</td></tr>
    <tr><td style="padding:3px 12px 3px 0;color:#666">Ergebnis laut Rechnung</td><td>${esc(ek.ergebnis_art)} ${eur(ek.ergebnis_eur)}</td></tr>
  </table>`}
  <h3>Befunde</h3>
  ${befunde.length ? `<table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>` : "<p>Keine Befunde. Die Abrechnung ist nach den vorliegenden Unterlagen plausibel.</p>"}
  ${typeof r.abschlag_empfehlung_eur === "number" ? `<h3>Abschlag</h3><p>Empfohlener Monatsabschlag: <b>${eur(r.abschlag_empfehlung_eur)}</b>. ${esc(r.abschlag_begruendung)}</p>` : ""}
  ${Array.isArray(r.fehlende_unterlagen) && r.fehlende_unterlagen.length ? `<h3>Fehlende Unterlagen</h3><ul>${r.fehlende_unterlagen.map(u => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
  ${r.textbaustein ? `<h3>Textbaustein</h3><div style="white-space:pre-wrap;background:#f4f6f5;padding:10px;font-size:13px">${esc(r.textbaustein)}</div>` : ""}
  <p style="font-size:11px;color:#666;margin-top:24px">Rechnerischer Plausibilitätscheck auf Grundlage der übermittelten Unterlagen, erstellt mit KI-Unterstützung. Keine Rechtsberatung.</p>
  </body></html>`;
}

export async function sendMail({ subject, html, to }, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("MAIL_FROM", "Prüfbericht <onboarding@resend.dev>"), to: [to || env("REPORT_TO")], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export function configByKuerzel(kuerzel) {
  return Object.values(PROMPTS).find(p => p.kuerzel === kuerzel);
}
