// Läuft automatisch bei jeder bestätigten (nicht als Spam markierten) Formularanfrage.
// Lädt die Unterlagen und gibt die Prüfung als Batch-Auftrag an das Modell.
// Muss in unter 10 Sekunden fertig sein, deshalb wird hier nur der Auftrag erteilt;
// das Ergebnis holt die Funktion "berichte-abholen" ab.
import { PROMPTS } from "../lib/prompts.mjs";
import { loadDocuments, buildBatchRequest, createBatch, sendMail } from "../lib/pruefung.mjs";

export default async (req) => {
  let payload;
  try {
    ({ payload } = await req.json());
  } catch {
    return new Response("Ungültige Anfrage", { status: 400 });
  }
  const formName = payload?.form_name;
  const cfg = PROMPTS[formName];
  if (!cfg) return new Response(`Formular ${formName} wird nicht automatisch geprüft`);

  const data = payload.data || {};
  const submissionId = payload.id || payload.number || Date.now().toString();

  try {
    const { blocks, hinweise } = await loadDocuments(data, cfg.dateiFelder);
    if (!blocks.length) {
      await sendMail({
        subject: `[${cfg.kuerzel.toUpperCase()}] Keine lesbaren Unterlagen: ${data.name || "unbekannt"}`,
        html: `<p>Für die Anfrage von ${data.name || "?"} (${data.email || "?"}) konnten keine Dateien geladen werden.</p><ul>${hinweise.map(h => `<li>${h}</li>`).join("")}</ul><p>Bitte Unterlagen beim Kunden nachfordern.</p>`,
      });
      return new Response("keine Dateien");
    }
    const request = buildBatchRequest({ formName, submissionId, data, blocks, hinweise });
    const batch = await createBatch(request);
    console.log(`Batch ${batch.id} für ${request.custom_id} erstellt`);
    return new Response("ok");
  } catch (e) {
    console.error(e);
    try {
      await sendMail({
        subject: `[${cfg.kuerzel.toUpperCase()}] Automatische Prüfung fehlgeschlagen: ${data.name || "unbekannt"}`,
        html: `<p>Fehler: ${String(e.message).replace(/</g, "&lt;")}</p><p>Kunde: ${data.name || "?"} (${data.email || "?"}). Bitte manuell prüfen.</p>`,
      });
    } catch (e2) { console.error(e2); }
    return new Response("Fehler", { status: 500 });
  }
};
