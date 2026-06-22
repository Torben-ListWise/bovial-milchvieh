import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  datasetsTable,
  analysesTable,
  messagesTable,
  analysisTemplatesTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { processQuestion } from "../lib/analysisService";

const router: IRouter = Router();

async function ownDatasetId(datasetId: string, userId: string): Promise<boolean> {
  const [d] = await db
    .select({ id: datasetsTable.id })
    .from(datasetsTable)
    .where(and(eq(datasetsTable.id, datasetId), eq(datasetsTable.userId, userId)));
  return !!d;
}

router.get(
  "/datasets/:datasetId/templates",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = req.params as { datasetId: string };
    if (!(await ownDatasetId(datasetId, req.userId!))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }

    const templates = await db
      .select()
      .from(analysisTemplatesTable)
      .where(eq(analysisTemplatesTable.active, true))
      .orderBy(analysisTemplatesTable.sortOrder);

    const result = await Promise.all(
      templates.map(async (t) => {
        const [lastAnalysis] = await db
          .select({ id: analysesTable.id, updatedAt: analysesTable.updatedAt })
          .from(analysesTable)
          .where(
            and(
              eq(analysesTable.datasetId, datasetId),
              eq(analysesTable.templateRef, t.id),
            ),
          )
          .orderBy(desc(analysesTable.updatedAt))
          .limit(1);

        let lastResultSnippet: string | null = null;
        if (lastAnalysis) {
          const [lastMsg] = await db
            .select({ content: messagesTable.content })
            .from(messagesTable)
            .where(
              and(
                eq(messagesTable.analysisId, lastAnalysis.id),
                eq(messagesTable.role, "assistant"),
              ),
            )
            .orderBy(desc(messagesTable.createdAt))
            .limit(1);
          if (lastMsg?.content) {
            lastResultSnippet = lastMsg.content.slice(0, 120);
          }
        }

        return {
          id: t.id,
          title: t.title,
          emoji: t.emoji,
          shortDescription: t.shortDescription,
          promptText: t.promptText,
          categoryTag: t.categoryTag ?? null,
          sortOrder: t.sortOrder,
          active: t.active,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          lastRunAt: lastAnalysis?.updatedAt ?? null,
          lastResultSnippet,
        };
      }),
    );

    res.json(result);
  },
);

router.post(
  "/datasets/:datasetId/templates/:templateId/run",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId, templateId } = req.params as {
      datasetId: string;
      templateId: string;
    };

    if (!(await ownDatasetId(datasetId, req.userId!))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }

    const [template] = await db
      .select()
      .from(analysisTemplatesTable)
      .where(
        and(
          eq(analysisTemplatesTable.id, templateId),
          eq(analysisTemplatesTable.active, true),
        ),
      )
      .limit(1);

    if (!template) {
      res.status(404).json({ error: "Vorlage nicht gefunden" });
      return;
    }

    const [analysis] = await db
      .insert(analysesTable)
      .values({
        datasetId,
        userId: req.userId!,
        title: template.title,
        source: "template",
        templateRef: template.id,
        agentProgress: "Wird gestartet…",
      } as any)
      .returning();

    res.status(201).json({ analysisId: analysis.id });

    setImmediate(() => {
      processQuestion(analysis, template.promptText).catch((err) => {
        logger.error({ err }, "Background template processQuestion failed");
      });
    });
  },
);

export default router;
