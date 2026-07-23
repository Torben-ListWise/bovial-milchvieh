import Anthropic from "@anthropic-ai/sdk";
import { db, reportsTable, datasetsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { logger } from "./logger";
import { getModelForTask } from "./agent";
import { SHARED_EPISTEMIC_CAUTION } from "./sharedDomainRules";

export async function generateInsightsSummary(datasetId: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const reports = await db
    .select({
      id: reportsTable.id,
      summary: reportsTable.summary,
      period: reportsTable.period,
      createdAt: reportsTable.createdAt,
    })
    .from(reportsTable)
    .where(
      and(
        eq(reportsTable.datasetId, datasetId),
        eq(reportsTable.status, "ready"),
      ),
    )
    .orderBy(desc(reportsTable.createdAt))
    .limit(5);

  if (reports.length < 2) return;

  const reportTexts = reports
    .map((r, i) => {
      const date = new Date(r.createdAt).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const narrative = r.summary?.trim() ?? "(keine Zusammenfassung vorhanden)";
      return `Auswertung ${i + 1} (${r.period ?? "unbekannt"}, ${date}):\n${narrative}`;
    })
    .join("\n\n---\n\n");

  const client = new Anthropic({ apiKey });

  let text: string | null = null;
  try {
    const msg = await client.messages.create({
      model: getModelForTask("insights_summary"),
      max_tokens: 350,
      system: SHARED_EPISTEMIC_CAUTION,
      messages: [
        {
          role: "user",
          content:
            `Du analysierst ${reports.length} aufeinanderfolgende Benchmarkreports eines Milchviehbetriebs. ` +
            `Schreibe 3–5 Sätze Fließtext, die auffällige Muster, Trends und Veränderungen über diese Auswertungen hinweg beobachten. ` +
            `Regeln: Nur was in den Reports steht — keine Erfindungen. Formuliere als Beobachtung (z. B. „In drei der fünf Auswertungen lag…"), ` +
            `nicht als Tatsache. Keine kausalen Erklärungen als Fakt. Kein Markdown, kein Aufzählungszeichen — nur Fließtext.\n\n` +
            reportTexts,
        },
      ],
    });
    const block = msg.content[0];
    text = block?.type === "text" ? block.text.trim() : null;
  } catch (err) {
    logger.warn({ err, datasetId }, "InsightsSummary: Anthropic-Call fehlgeschlagen");
    return;
  }

  if (!text) return;

  await db
    .update(datasetsTable)
    .set({
      insightsSummary: {
        text,
        reportCount: reports.length,
        basedOnReportIds: reports.map((r) => r.id),
        generatedAt: new Date().toISOString(),
      },
      insightsSummaryUpdatedAt: new Date(),
    })
    .where(eq(datasetsTable.id, datasetId));

  logger.info({ datasetId, reportCount: reports.length }, "InsightsSummary erfolgreich generiert");
}
