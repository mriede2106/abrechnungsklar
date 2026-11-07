// Läuft alle 5 Minuten. Holt fertige Prüfungen ab, schickt den Bericht per Mail
// und löscht den Auftrag danach beim Modell-Anbieter, damit nichts doppelt verschickt wird.
import { listBatches, fetchResults, deleteBatch, extractJson, renderReport, sendMail, parseCustomId, configByKuerzel, env } from "../lib/pruefung.mjs";

export default async () => {
  const modus = env("MODUS", "freigabe"); // "freigabe" = Bericht an dich, "direkt" = später an Kunden
  const batches = await listBatches();
  let verschickt = 0;

  for (const batch of batches) {
    if (batch.processing_status !== "ended") continue;
    let results;
    try {
      results = await fetchResults(batch);
    } catch (e) {
      console.error(e);
      continue;
    }
    const unsere = results.filter(r => configByKuerzel(parseCustomId(r.custom_id).kuerzel));
    if (!unsere.length) continue; // fremder Batch, nicht anfassen

    let alleOk = true;
    for (const r of unsere) {
      const { kuerzel, submissionId, name } = parseCustomId(r.custom_id);
      const cfg = configByKuerzel(kuerzel);
      try {
        if (r.result?.type !== "succeeded") {
          await sendMail({
            subject: `[${kuerzel.toUpperCase()}] Prüfung nicht abgeschlossen: ${name}`,
            html: `<p>Status: ${r.result?.type}. ${JSON.stringify(r.result?.error || {}).slice(0, 500)}</p><p>Anfrage ${submissionId}. Bitte manuell prüfen.</p>`,
          });
          continue;
        }
        const text = (r.result.message.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
        let bericht;
        try {
          bericht = extractJson(text);
        } catch {
          await sendMail({
            subject: `[${kuerzel.toUpperCase()}] Bericht (unformatiert): ${name}`,
            html: `<p>Das Modell hat kein gültiges JSON geliefert. Rohtext:</p><pre style="white-space:pre-wrap">${text.replace(/</g, "&lt;")}</pre>`,
          });
          continue;
        }
        const anzahl = (bericht.befunde || []).filter(b => b.einordnung === "RUECKZAHLUNG").length;
        await sendMail({
          subject: `[${kuerzel.toUpperCase()}] Prüfbericht ${name}: ${anzahl ? anzahl + " Befund(e) mit Betrag" : "ohne Rückzahlungsbefund"}`,
          html: renderReport(bericht, { titel: cfg.titel, kunde: name, submissionId, modus, eckdaten: kuerzel === "ek" }),
        });
        verschickt++;
      } catch (e) {
        console.error(e);
        alleOk = false;
      }
    }
    if (alleOk) {
      try { await deleteBatch(batch.id); } catch (e) { console.error(e); }
    }
  }
  return new Response(`${verschickt} Bericht(e) verschickt`);
};

export const config = { schedule: "*/5 * * * *" };
