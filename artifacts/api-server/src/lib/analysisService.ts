import { and, asc, eq } from "drizzle-orm";
import {
  db,
  analysesTable,
  messagesTable,
  activityLogTable,
  rulesTable,
  type Analysis,
  type Message,
} from "@workspace/db";
import { runAgent, MissingApiKeyError, type Chart, type Citation } from "./agent";
import { categorizeQuestion } from "./categorize";
import { logger } from "./logger";
import Anthropic from "@anthropic-ai/sdk";

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateFollowUps(question: string, answer: string): Promise<string[]> {
  try {
    const resp = await anthropicClient.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Frage: "${question.slice(0, 200)}"\nAntwort: "${answer.slice(0, 600)}"\n\nGeneriere genau 3 kurze Folgefragen auf Deutsch (max. 7 Wörter je Frage) als JSON-Array von Strings. Antworte NUR mit dem JSON-Array.`,
      }],
    });
    const text = resp.content.find(b => b.type === "text")?.text?.trim() ?? "[]";
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.slice(0, 3).map(String) : [];
  } catch {
    return [];
  }
}

// Insert the user message, run the agent grounded on deterministic compute,
// persist the assistant answer, and log activity (metadata only).
export async function processQuestion(
  analysis: Analysis,
  question: string,
): Promise<Message> {
  await db.insert(messagesTable).values({
    analysisId: analysis.id,
    role: "user",
    content: question,
  });

  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.analysisId, analysis.id))
    .orderBy(asc(messagesTable.createdAt));

  const conversation = history
    .filter((m) => m.content)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content as string,
    }));

  let content: string;
  let charts: Chart[] = [];
  let citations: Citation[] = [];
  let error: string | null = null;
  let agentResultText: string | undefined;

  // Load customer-defined rules and pass them as structured context so the
  // agent can reference them in every analysis (e.g. custom thresholds).
  const customerRules = await db
    .select()
    .from(rulesTable)
    .where(and(eq(rulesTable.userId, analysis.userId!), eq(rulesTable.enabled, true)));
  const rulesContext =
    customerRules.length > 0
      ? `\nKundendefinierte Regeln (verwende diese als Hinweise bei der Analyse):\n${customerRules
          .map(
            (r) =>
              `- ${r.name}: ${r.metric} ${r.comparator} ${r.threshold}${r.unit ? " " + r.unit : ""}${r.description ? " (" + r.description + ")" : ""}`,
          )
          .join("\n")}`
      : "";

  // Reset step tracking for this run
  const completedSteps: string[] = [];
  let lastProgressStep: string | null = null;

  // Reset agentSteps for this new run
  await db
    .update(analysesTable)
    .set({ agentSteps: [] } as any)
    .where(eq(analysesTable.id, analysis.id))
    .catch(() => {});

  try {
    const result = await runAgent({
      datasetId: analysis.datasetId,
      conversation,
      systemExtra: rulesContext || undefined,
      onProgress: async (step: string | null) => {
        // The previous step is now complete — move it to completedSteps
        if (lastProgressStep) completedSteps.push(lastProgressStep);
        lastProgressStep = step;
        await db
          .update(analysesTable)
          .set({ agentProgress: step, agentSteps: [...completedSteps] } as any)
          .where(eq(analysesTable.id, analysis.id));
      },
    });
    content = result.text || "Es konnte keine Antwort erzeugt werden.";
    charts = result.charts;
    citations = result.citations;
    agentResultText = result.text;

  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      content = err.message;
    } else {
      content =
        "Bei der Analyse ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.";
    }
    error = err instanceof Error ? err.message : "Unbekannter Fehler";
  } finally {
    // Always clear progress indicators, even on error
    await db
      .update(analysesTable)
      .set({ agentProgress: null, agentSteps: [] } as any)
      .where(eq(analysesTable.id, analysis.id))
      .catch(() => {});
  }

  // Save the message immediately so the frontend can show it without waiting
  // for follow-up question generation (which runs as a background update).
  const [assistant] = await db
    .insert(messagesTable)
    .values({
      analysisId: analysis.id,
      role: "assistant",
      content,
      charts,
      citations,
      error,
      followUpQuestions: null,
    } as any)
    .returning();

  // Generate follow-up questions in the background and patch the message
  if (agentResultText) {
    generateFollowUps(question, agentResultText)
      .then((qs) => {
        if (qs.length > 0) {
          db.update(messagesTable)
            .set({ followUpQuestions: qs } as any)
            .where(eq(messagesTable.id, assistant.id))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }

  const category = analysis.category ?? categorizeQuestion(question);
  await db
    .update(analysesTable)
    .set({ updatedAt: new Date(), category })
    .where(eq(analysesTable.id, analysis.id));

  await db.insert(activityLogTable).values({
    userId: analysis.userId,
    type: "analysis",
    category,
    datasetRef: analysis.datasetId.slice(0, 8),
  });

  return assistant;
}
