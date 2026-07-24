import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import {
  db,
  knowledgeDocumentsTable,
  knowledgeDocumentTopicsTable,
  KNOWLEDGE_TOPICS,
  type MetaPendingData,
} from "@workspace/db";
import { extractPdfText } from "./ingest";
import { ObjectStorageService } from "./objectStorage";
import { getModelForTask } from "./agent";
import { logger } from "./logger";

const objectStorage = new ObjectStorageService();

export function detectQueryTopic(query: string): string | null {
  const lower = query.toLowerCase();
  if (/fruchtbar|reprodukt|brunst|zykl|trächtig|konzept|besamung|pregrate|offene.tage|zwischenkalb/.test(lower)) return "Fruchtbarkeit";
  if (/euter|zellzahl|scc|mastitis|euterkrank|milchqualit/.test(lower)) return "Eutergesundheit";
  if (/fütt|tmt|tmr|ration|futter|energie|protein|kraftfutter/.test(lower)) return "Fütterung";
  if (/klau|lahmheit|huf|schiene/.test(lower)) return "Klauengesundheit";
  if (/hitze|temperatur|thi|wärme|climate|sommer/.test(lower)) return "Hitzestress";
  if (/herde|bestand|tier.anzahl|management|remontier/.test(lower)) return "Herdenstruktur";
  if (/kalb|jungvieh|aufzucht|färse|heifer/.test(lower)) return "Kälber-/Jungviehaufzucht";
  if (/melk|melktech|automat|roboter|ams|lely/.test(lower)) return "Melktechnik";
  if (/betriebs|wirtschaft|kosten|ertrag|wirtschaftlich|invest/.test(lower)) return "Betriebswirtschaft";
  if (/seuche|infekt|impf|bvd|tbc|tierseuche|krankheit/.test(lower)) return "Tiergesundheit-Seuchen";
  return null;
}

export async function extractDocumentMetadata(docId: string): Promise<MetaPendingData | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const [doc] = await db
    .select()
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.id, docId));
  if (!doc || doc.status !== "ready") return null;

  let textSnippet = "";
  try {
    const file = await objectStorage.getObjectEntityFile(doc.objectPath);
    const [buf] = await file.download();
    const lower = doc.filename.toLowerCase();
    if (lower.endsWith(".pdf") || doc.fileType === "pdf") {
      const fullText = await extractPdfText(buf);
      textSnippet = fullText.slice(0, 3000);
    } else {
      textSnippet = buf.toString("utf-8").slice(0, 3000);
    }
  } catch (err) {
    logger.warn({ err, docId }, "Textextraktion für Metadaten fehlgeschlagen");
    textSnippet = "";
  }

  const topicsList = KNOWLEDGE_TOPICS.join(", ");
  const sourceUrlHint = doc.sourceUrl ? `\nQuelle-URL des Dokuments: "${doc.sourceUrl}"` : "";

  const prompt = `Du bist ein Bibliograph für wissenschaftliche Fachliteratur im Agrarbereich. Analysiere den folgenden Dokumententitel und Textauszug und extrahiere die bibliografischen Metadaten.

Dokumententitel: "${doc.title}"
Dateiname: "${doc.filename}"${sourceUrlHint}

Textauszug (erste 3000 Zeichen):
${textSnippet || "(kein Text verfügbar)"}

Verfügbare Themen-Kategorien: ${topicsList}

Extrahiere die folgenden Informationen:
- metaTitel: Der echte Titel des Dokuments/Papers (aus dem Text, nicht Dateiname)
- metaAutoren: Autoren (kommagetrennt, z.B. "Müller, H.; Schmidt, A.")
- metaJahr: Erscheinungsjahr (4-stellige Zahl)
- metaHerausgeber: Journal, Verlag oder herausgebende Institution
- metaUrl: DOI oder kanonische URL des Dokuments/Papers (falls im Text gefunden, z.B. "https://doi.org/..." oder direkte URL). Nicht die Upload-URL oder sourceUrl, sondern die offizielle Veröffentlichungs-URL.
- topics: Array von passenden Themen aus der Kategorien-Liste (1-3 Themen)
- tierStufe: Vertrauensstufe: 1=wissenschaftlich peer-reviewed, 2=Branchenpraxis (Verbände, Beratung), 3=Betriebserfahrung/Praxisberichte

Wenn eine Information nicht ermittelbar ist, setze null. Gib IMMER mindestens ein Thema an.

Antworte NUR mit einem JSON-Objekt, kein weiterer Text:`;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: getModelForTask("doc_categorization"),
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as {
      metaTitel?: string | null;
      metaAutoren?: string | null;
      metaJahr?: number | null;
      metaHerausgeber?: string | null;
      metaUrl?: string | null;
      topics?: string[];
      tierStufe?: number | null;
    };

    const validTopics = (parsed.topics ?? []).filter((t) =>
      (KNOWLEDGE_TOPICS as readonly string[]).includes(t)
    );

    // Determine if extraction yielded meaningful bibliographic data
    const hasKeyFields = !!(parsed.metaTitel || parsed.metaAutoren || parsed.tierStufe);

    const result: MetaPendingData = {
      metaTitel: parsed.metaTitel ?? null,
      metaAutoren: parsed.metaAutoren ?? null,
      metaJahr: parsed.metaJahr ?? null,
      metaHerausgeber: parsed.metaHerausgeber ?? null,
      metaUrl: parsed.metaUrl ?? null,
      topics: validTopics.length > 0 ? validTopics : [],
      tierStufe: parsed.tierStufe ?? null,
      _extractionStatus: hasKeyFields ? "pending_review" : "incomplete",
    };
    return result;
  } catch (err) {
    logger.error({ err, docId }, "Metadaten-Extraktion fehlgeschlagen");
    return null;
  }
}

export async function confirmDocumentMetadata(docId: string, data: MetaPendingData): Promise<void> {
  await db
    .update(knowledgeDocumentsTable)
    .set({
      metaTitel: data.metaTitel ?? null,
      metaAutoren: data.metaAutoren ?? null,
      metaJahr: data.metaJahr ? Number(data.metaJahr) : null,
      metaHerausgeber: data.metaHerausgeber ?? null,
      metaUrl: data.metaUrl ?? null,
      tierStufe: data.tierStufe ? Number(data.tierStufe) : null,
      metaPending: null,
    })
    .where(eq(knowledgeDocumentsTable.id, docId));

  // Always replace topics — even empty list clears previous topics
  await db
    .delete(knowledgeDocumentTopicsTable)
    .where(eq(knowledgeDocumentTopicsTable.docId, docId));

  if (data.topics && data.topics.length > 0) {
    await db.insert(knowledgeDocumentTopicsTable).values(
      data.topics.map((topic) => ({ docId, topic })),
    );
  }
}

export async function runBatchMetadataExtraction(
  onProgress?: (done: number, total: number, docId: string) => void,
): Promise<{ processed: number; incomplete: number }> {
  const docs = await db
    .select({
      id: knowledgeDocumentsTable.id,
      metaTitel: knowledgeDocumentsTable.metaTitel,
      tierStufe: knowledgeDocumentsTable.tierStufe,
      metaPending: knowledgeDocumentsTable.metaPending,
    })
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.status, "ready"));

  // Process docs that have no confirmed metadata AND no metaPending (not yet run)
  const needsExtraction = docs.filter(
    (d) => !d.tierStufe && !d.metaTitel && !d.metaPending,
  );
  const total = needsExtraction.length;
  let processed = 0;
  let incomplete = 0;

  for (const doc of needsExtraction) {
    try {
      const result = await extractDocumentMetadata(doc.id);
      if (!result) {
        // Extraction failed entirely — mark as incomplete so admin can see it
        await db
          .update(knowledgeDocumentsTable)
          .set({ metaPending: { _extractionStatus: "incomplete" } })
          .where(eq(knowledgeDocumentsTable.id, doc.id));
        incomplete++;
      } else {
        await db
          .update(knowledgeDocumentsTable)
          .set({ metaPending: result })
          .where(eq(knowledgeDocumentsTable.id, doc.id));
        if (result._extractionStatus === "incomplete") incomplete++;
      }
      processed++;
      onProgress?.(processed, total, doc.id);
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      logger.error({ err, docId: doc.id }, "Batch-Metadaten-Extraktion fehlgeschlagen");
      await db
        .update(knowledgeDocumentsTable)
        .set({ metaPending: { _extractionStatus: "incomplete" } })
        .where(eq(knowledgeDocumentsTable.id, doc.id));
      incomplete++;
      processed++;
    }
  }

  return { processed, incomplete };
}
