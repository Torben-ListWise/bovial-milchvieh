import { Router, type IRouter, type Request, type Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db, datasetsTable, analysesTable, messagesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /public/analyses/:analysisId ─────────────────────────────────────────
// No auth required. Returns read-only analysis data (title, dataset name,
// messages) for share-link recipients.
router.get("/public/analyses/:analysisId", async (req: Request, res: Response) => {
  const { analysisId } = req.params;
  if (!analysisId) {
    res.status(400).json({ error: "analysisId fehlt" });
    return;
  }

  try {
    const [analysis] = await db
      .select()
      .from(analysesTable)
      .where(eq(analysesTable.id, analysisId));

    if (!analysis) {
      res.status(404).json({ error: "Analyse nicht gefunden" });
      return;
    }

    if (!(analysis as any).isShared) {
      res.status(404).json({ error: "Analyse nicht gefunden" });
      return;
    }

    const [dataset] = await db
      .select({ name: datasetsTable.name })
      .from(datasetsTable)
      .where(eq(datasetsTable.id, analysis.datasetId));

    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.analysisId, analysisId))
      .orderBy(asc(messagesTable.createdAt));

    res.json({
      id: analysis.id,
      title: analysis.title,
      datasetId: analysis.datasetId,
      datasetName: dataset?.name ?? null,
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content ?? null,
        charts: (m.charts as unknown[]) ?? [],
        citations: (m.citations as unknown[]) ?? [],
        followUpQuestions: ((m as any).followUpQuestions as string[] | null) ?? [],
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /public/analyses/:analysisId fehlgeschlagen");
    res.status(500).json({ error: "Interner Fehler" });
  }
});

// ── GET /oembed ───────────────────────────────────────────────────────────────
// oEmbed JSON endpoint. Parses analysisId from ?url= and returns oEmbed spec.
// Spec: https://oembed.com/
router.get("/oembed", async (req: Request, res: Response) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) {
    res.status(400).json({ error: "url parameter fehlt" });
    return;
  }

  let analysisId: string | null = null;
  try {
    const parsed = new URL(rawUrl);
    analysisId = parsed.searchParams.get("analysisId");
  } catch {
    res.status(400).json({ error: "Ungültige URL" });
    return;
  }

  if (!analysisId) {
    res.status(404).json({ error: "Keine analysisId in URL gefunden" });
    return;
  }

  try {
    const [analysis] = await db
      .select({ title: analysesTable.title, datasetId: analysesTable.datasetId })
      .from(analysesTable)
      .where(eq(analysesTable.id, analysisId));

    if (!analysis) {
      res.status(404).json({ error: "Analyse nicht gefunden" });
      return;
    }

    const [dataset] = await db
      .select({ name: datasetsTable.name })
      .from(datasetsTable)
      .where(eq(datasetsTable.id, analysis.datasetId));

    const host = req.headers.host ?? "";
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const providerUrl = `${proto}://${host}`;

    res.json({
      version: "1.0",
      type: "rich",
      provider_name: "Milchvieh Datenanalyse-Assistent",
      provider_url: providerUrl,
      title: `${analysis.title}${dataset?.name ? ` – ${dataset.name}` : ""}`,
      html: `<blockquote>${analysis.title}</blockquote>`,
      width: 600,
      height: 200,
    });
  } catch (err) {
    logger.error({ err }, "GET /oembed fehlgeschlagen");
    res.status(500).json({ error: "Interner Fehler" });
  }
});

// ── GET /share/analyses/:analysisId ──────────────────────────────────────────
// Bots (WhatsApp, Slack, Twitter) follow this URL and read the OG meta tags.
// Browsers get an instant meta-refresh redirect into the SPA.
// Mounted under /api so Replit's path router forwards it to this server.
router.get("/share/analyses/:analysisId", async (req: Request, res: Response) => {
  const { analysisId } = req.params;

  let ogTitle = "Milchvieh Datenanalyse-Assistent";
  let ogDescription = "Betriebsanalyse teilen – melde dich an, um eigene Analysen zu erstellen.";
  let datasetId = "";

  try {
    const [analysis] = await db
      .select({ title: analysesTable.title, datasetId: analysesTable.datasetId })
      .from(analysesTable)
      .where(eq(analysesTable.id, analysisId));

    if (analysis) {
      const [dataset] = await db
        .select({ name: datasetsTable.name })
        .from(datasetsTable)
        .where(eq(datasetsTable.id, analysis.datasetId));

      const datasetLabel = dataset?.name ? ` – ${dataset.name}` : "";
      ogTitle = `${analysis.title}${datasetLabel}`;
      ogDescription = `Betriebsanalyse${datasetLabel}. Melde dich an, um selbst Analysen zu erstellen.`;
      datasetId = analysis.datasetId;
    }
  } catch (err) {
    logger.warn({ err, analysisId }, "/api/share: DB-Lookup fehlgeschlagen, Fallback-Meta-Tags");
  }

  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = req.headers.host ?? "";
  const baseUrl = `${proto}://${host}`;
  const spaUrl = `${baseUrl}/app/analyses?datasetId=${encodeURIComponent(datasetId)}&analysisId=${encodeURIComponent(analysisId)}`;
  const oEmbedUrl = `${baseUrl}/api/oembed?url=${encodeURIComponent(spaUrl)}`;

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <title>${esc(ogTitle)}</title>
  <meta name="description" content="${esc(ogDescription)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(ogTitle)}" />
  <meta property="og:description" content="${esc(ogDescription)}" />
  <meta property="og:url" content="${esc(spaUrl)}" />
  <meta property="og:site_name" content="Milchvieh Datenanalyse-Assistent" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(ogTitle)}" />
  <meta name="twitter:description" content="${esc(ogDescription)}" />
  <link rel="alternate" type="application/json+oembed" href="${esc(oEmbedUrl)}" title="${esc(ogTitle)}" />
  <meta http-equiv="refresh" content="0; url=${esc(spaUrl)}" />
</head>
<body>
  <p>Weiterleitung zur Analyse&#8230; <a href="${esc(spaUrl)}">Hier klicken</a></p>
</body>
</html>`);
});

export default router;
