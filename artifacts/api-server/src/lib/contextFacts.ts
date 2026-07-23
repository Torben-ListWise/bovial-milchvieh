import Anthropic from "@anthropic-ai/sdk";
import { db, contextFactsTable } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { getModelForTask } from "./agent";
import { SHARED_DERIVATION_PROHIBITION } from "./sharedDomainRules";
import { embedTexts } from "./embeddings";
import { logger } from "./logger";

const CATEGORIES = ["verfahren", "ausruestung", "wartezeiten", "sonstiges"] as const;
type Category = (typeof CATEGORIES)[number];

// Cosine similarity above this threshold is treated as "already known" — the
// new proposal is silently dropped instead of creating a duplicate suggestion.
// Applies against active, still-pending AND previously rejected facts, so a
// fact the owner already rejected once is not re-proposed on every mention.
const DEDUP_SIMILARITY_THRESHOLD = 0.88;

const EXTRACTION_PROMPT = `Du analysierst einen Chat-Ausschnitt zwischen einem Milchvieh-Landwirt und einem Analyse-Assistenten.

Deine Aufgabe: Erkenne AUSSCHLIESSLICH dauerhafte, betriebsspezifische Eigenschaften, die der Landwirt beiläufig erwähnt hat — Dinge, die auch in Zukunft für JEDE Analyse dieses Betriebs relevant bleiben. Beispiele:
- Feste Verfahren/Routinen (z. B. "wir melken immer 3x täglich", "wir trocknen grundsätzlich 8 Wochen vor dem Kalben")
- Ausrüstung/Technik (z. B. "wir haben ein Melkkarussell", "unser Stall hat Kuhbürsten")
- Wartezeiten (z. B. "bei uns gilt für Medikament X eine Wartezeit von 5 Tagen")
- Sonstige dauerhafte Betriebseigenschaften

NICHT extrahieren:
- Einmalige Ereignisse, Zahlen/Messwerte, Fragen, Meinungen, Vermutungen, Zeiträume ("letzten Monat...")
- Alles, was schon eine reine Wiederholung von Standarddaten ist (z. B. Milchleistungswerte)
- Alles, das nicht eindeutig als feste/dauerhafte Eigenschaft formuliert ist

${SHARED_DERIVATION_PROHIBITION}

Antworte NUR mit kompaktem JSON (kein Markdown, kein Fließtext) in exakt diesem Format:
{"facts": [{"category": "verfahren"|"ausruestung"|"wartezeiten"|"sonstiges", "text": "kurzer, klarer Fakt in einem Satz"}]}

Wenn keine dauerhafte Eigenschaft erwähnt wurde, antworte mit {"facts": []}.`;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are already L2-normalized by embedTexts/embedQuery
}

/**
 * Fire-and-forget: classifies the latest chat turn for durable farm-context
 * facts and stores conservative dedup-checked proposals. NEVER throws —
 * callers should invoke this without awaiting, or await inside a try/catch
 * that swallows all errors, since it must never affect the chat response.
 */
export async function classifyAndProposeContextFacts(opts: {
  datasetId: string;
  ownerUserId: string;
  question: string;
  answer: string;
  sourceAnalysisId: string;
  sourceMessageId: string;
}): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;
  if (!opts.question || opts.question.trim().length < 3) return;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: getModelForTask("context_fact_extraction"),
      max_tokens: 500,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: `Nachricht des Landwirts:\n${opts.question}\n\nAntwort des Assistenten (zur Einordnung, extrahiere Fakten nur aus der Landwirt-Nachricht):\n${opts.answer.slice(0, 1500)}`,
        },
      ],
    });
    const raw = msg.content.find((b) => b.type === "text")?.text ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    let parsed: { facts?: { category?: string; text?: string }[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return;
    }
    const facts = (parsed.facts ?? [])
      .map((f) => ({
        category: (CATEGORIES as readonly string[]).includes(f.category ?? "")
          ? (f.category as Category)
          : ("sonstiges" as Category),
        text: (f.text ?? "").trim(),
      }))
      .filter((f) => f.text.length >= 5 && f.text.length <= 500)
      .slice(0, 5); // safety cap per turn

    if (facts.length === 0) return;

    // Existing facts for this dataset — used for embedding-based dedup against
    // active, still-pending AND previously rejected proposals.
    const existing = await db
      .select({ id: contextFactsTable.id, embedding: contextFactsTable.embedding, status: contextFactsTable.status })
      .from(contextFactsTable)
      .where(
        and(
          eq(contextFactsTable.datasetId, opts.datasetId),
          ne(contextFactsTable.status, "deaktiviert"),
        ),
      );

    // Fail-open: if the embedding pipeline is unavailable, we still store the
    // proposals without a similarity check rather than silently dropping a
    // potentially valid fact — an occasional duplicate is less harmful than a
    // silently lost proposal.
    let newEmbeddings: (number[] | null)[] = facts.map(() => null);
    try {
      newEmbeddings = await embedTexts(facts.map((f) => f.text));
    } catch (err) {
      logger.warn({ err, datasetId: opts.datasetId }, "Embedding-Dedup fehlgeschlagen — lege Vorschläge ungeprüft an (fail-open)");
    }

    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      const embedding = newEmbeddings[i];
      if (embedding) {
        const isDuplicate = existing.some((e) => {
          if (!e.embedding) return false;
          return cosineSimilarity(embedding, e.embedding) >= DEDUP_SIMILARITY_THRESHOLD;
        });
        if (isDuplicate) continue;
      }

      await db.insert(contextFactsTable).values({
        datasetId: opts.datasetId,
        userId: opts.ownerUserId,
        category: fact.category,
        factText: fact.text,
        originalText: fact.text,
        status: "vorgeschlagen",
        sourceAnalysisId: opts.sourceAnalysisId,
        sourceMessageId: opts.sourceMessageId,
        embedding,
      });
      logger.info(
        { datasetId: opts.datasetId, category: fact.category },
        "Neuer Betriebs-Kontext-Fakt-Vorschlag erstellt",
      );
    }
  } catch (err) {
    logger.warn({ err, datasetId: opts.datasetId }, "Betriebs-Kontext-Fakt-Erkennung fehlgeschlagen — ignoriert");
  }
}
