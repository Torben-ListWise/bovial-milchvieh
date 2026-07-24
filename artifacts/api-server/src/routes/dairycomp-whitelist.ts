/**
 * DairyComp-Befehls-Whitelist — Operator-Verwaltung
 *
 * GET    /api/admin/dairycomp-whitelist          — alle Einträge
 * POST   /api/admin/dairycomp-whitelist          — einen Eintrag anlegen
 * PUT    /api/admin/dairycomp-whitelist/:id      — Eintrag bearbeiten
 * DELETE /api/admin/dairycomp-whitelist/:id      — Eintrag löschen
 * POST   /api/admin/dairycomp-whitelist/parse    — Freitext per LLM parsen → strukturierte Vorschau
 * POST   /api/admin/dairycomp-whitelist/bulk     — geparste Einträge massenhaft speichern
 */

import { Router, type Request, type Response } from "express";
import { eq, asc, sql } from "drizzle-orm";
import { db, dairycompCommandWhitelistTable } from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";
import { getModelForTask } from "../lib/agent";
import { logger } from "../lib/logger";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();
const anthropic = new Anthropic();

// ── GET /api/admin/dairycomp-whitelist ────────────────────────────────────────
router.get(
  "/admin/dairycomp-whitelist",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(dairycompCommandWhitelistTable)
        .orderBy(
          asc(dairycompCommandWhitelistTable.befehlsfamilie),
          asc(dairycompCommandWhitelistTable.befehl)
        );
      res.json(rows);
    } catch (err) {
      logger.error({ err }, "dairycomp-whitelist: GET fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  }
);

// ── POST /api/admin/dairycomp-whitelist/parse ─────────────────────────────────
// Muss VOR dem generischen POST-Handler registriert werden (Routen-Präzedenz)
router.post(
  "/admin/dairycomp-whitelist/parse",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "Kein Text übergeben" });
      return;
    }
    try {
      const model = getModelForTask("knowledge");
      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `Du analysierst eine Befehlsliste aus dem DairyComp 305 Handbuch und extrahierst daraus strukturierte Einträge für eine Befehls-Whitelist.

Eingabe-Text:
<text>
${text}
</text>

Erstelle für jeden DairyComp-Befehl einen strukturierten Eintrag im JSON-Array.
Regeln:
- "befehl": exakter Befehlsstring inkl. Backslash-Modifikator, z.B. "BREDSUM\\E" (Backslash im JSON als doppelter Backslash)
- "befehlsfamilie": Stammbefehl ohne Modifikator, z.B. "BREDSUM"
- "beschreibung": deutsche Kurzbeschreibung, was der Befehl anzeigt/tut (max. 100 Zeichen)
- "kategorie": eine von: "Fruchtbarkeit & Besamung", "Milchleistung", "Eutergesundheit", "Tiergesundheit", "Fütterung", "Herdenmanagement", "Betriebswirtschaft", "Sonstiges"
- "benoetigtZeitraum": true wenn der Befehl eine \\D-Zeitraum-Variante ist
- "benoetigtJungrinderFilter": true wenn der Befehl eine \\*-Jungrinder-Variante ist

Antworte NUR mit einem JSON-Array, kein erklärender Text:
[
  {
    "befehl": "BREDSUM\\E",
    "befehlsfamilie": "BREDSUM",
    "beschreibung": "Besamungsdaten-Eingabe und Bearbeitung",
    "kategorie": "Fruchtbarkeit & Besamung",
    "benoetigtZeitraum": false,
    "benoetigtJungrinderFilter": false
  }
]`,
          },
        ],
      });

      const rawText =
        response.content[0]?.type === "text" ? response.content[0].text : "";
      // Strip markdown code fences if present
      const jsonStr = rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      let parsed: unknown[];
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        logger.error({ rawText }, "dairycomp-whitelist/parse: LLM lieferte kein gültiges JSON");
        res.status(422).json({ error: "LLM-Ausgabe konnte nicht als JSON geparst werden", raw: rawText.slice(0, 500) });
        return;
      }
      res.json({ entries: parsed });
    } catch (err) {
      logger.error({ err }, "dairycomp-whitelist/parse fehlgeschlagen");
      res.status(500).json({ error: "LLM-Parsing fehlgeschlagen" });
    }
  }
);

// ── POST /api/admin/dairycomp-whitelist/bulk ──────────────────────────────────
router.post(
  "/admin/dairycomp-whitelist/bulk",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { entries } = req.body as {
      entries?: {
        befehl: string;
        befehlsfamilie: string;
        beschreibung?: string;
        kategorie?: string;
        benoetigtZeitraum?: boolean;
        benoetigtJungrinderFilter?: boolean;
        quelleReferenz?: string;
      }[];
    };
    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: "Keine Einträge übergeben" });
      return;
    }
    try {
      let inserted = 0;
      let skipped = 0;
      for (const e of entries) {
        if (!e.befehl || !e.befehlsfamilie) continue;
        const result = await db
          .insert(dairycompCommandWhitelistTable)
          .values({
            befehl: e.befehl.trim(),
            befehlsfamilie: e.befehlsfamilie.trim(),
            beschreibung: e.beschreibung?.trim() ?? null,
            kategorie: e.kategorie?.trim() ?? null,
            benoetigtZeitraum: e.benoetigtZeitraum ?? false,
            benoetigtJungrinderFilter: e.benoetigtJungrinderFilter ?? false,
            quelleReferenz: e.quelleReferenz?.trim() ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: dairycompCommandWhitelistTable.id });
        if (result.length > 0) inserted++;
        else skipped++;
      }
      res.json({ inserted, skipped });
    } catch (err) {
      logger.error({ err }, "dairycomp-whitelist/bulk fehlgeschlagen");
      res.status(500).json({ error: "Bulk-Import fehlgeschlagen" });
    }
  }
);

// ── POST /api/admin/dairycomp-whitelist ───────────────────────────────────────
router.post(
  "/admin/dairycomp-whitelist",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { befehl, befehlsfamilie, beschreibung, kategorie, benoetigtZeitraum, benoetigtJungrinderFilter, quelleReferenz } =
      req.body as {
        befehl?: string;
        befehlsfamilie?: string;
        beschreibung?: string;
        kategorie?: string;
        benoetigtZeitraum?: boolean;
        benoetigtJungrinderFilter?: boolean;
        quelleReferenz?: string;
      };
    if (!befehl?.trim() || !befehlsfamilie?.trim()) {
      res.status(400).json({ error: "befehl und befehlsfamilie sind Pflichtfelder" });
      return;
    }
    try {
      const [row] = await db
        .insert(dairycompCommandWhitelistTable)
        .values({
          befehl: befehl.trim(),
          befehlsfamilie: befehlsfamilie.trim(),
          beschreibung: beschreibung?.trim() ?? null,
          kategorie: kategorie?.trim() ?? null,
          benoetigtZeitraum: benoetigtZeitraum ?? false,
          benoetigtJungrinderFilter: benoetigtJungrinderFilter ?? false,
          quelleReferenz: quelleReferenz?.trim() ?? null,
        })
        .returning();
      res.status(201).json(row);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("unique")) {
        res.status(409).json({ error: "Befehl existiert bereits in der Whitelist" });
        return;
      }
      logger.error({ err }, "dairycomp-whitelist: POST fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  }
);

// ── PUT /api/admin/dairycomp-whitelist/:id ────────────────────────────────────
router.put(
  "/admin/dairycomp-whitelist/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { befehl, befehlsfamilie, beschreibung, kategorie, benoetigtZeitraum, benoetigtJungrinderFilter, quelleReferenz } =
      req.body as {
        befehl?: string;
        befehlsfamilie?: string;
        beschreibung?: string;
        kategorie?: string;
        benoetigtZeitraum?: boolean;
        benoetigtJungrinderFilter?: boolean;
        quelleReferenz?: string;
      };
    if (!befehl?.trim() || !befehlsfamilie?.trim()) {
      res.status(400).json({ error: "befehl und befehlsfamilie sind Pflichtfelder" });
      return;
    }
    try {
      const [row] = await db
        .update(dairycompCommandWhitelistTable)
        .set({
          befehl: befehl.trim(),
          befehlsfamilie: befehlsfamilie.trim(),
          beschreibung: beschreibung?.trim() ?? null,
          kategorie: kategorie?.trim() ?? null,
          benoetigtZeitraum: benoetigtZeitraum ?? false,
          benoetigtJungrinderFilter: benoetigtJungrinderFilter ?? false,
          quelleReferenz: quelleReferenz?.trim() ?? null,
        })
        .where(eq(dairycompCommandWhitelistTable.id, id))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Eintrag nicht gefunden" });
        return;
      }
      res.json(row);
    } catch (err) {
      logger.error({ err }, "dairycomp-whitelist: PUT fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  }
);

// ── DELETE /api/admin/dairycomp-whitelist/:id ─────────────────────────────────
router.delete(
  "/admin/dairycomp-whitelist/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const [deleted] = await db
        .delete(dairycompCommandWhitelistTable)
        .where(eq(dairycompCommandWhitelistTable.id, id))
        .returning({ id: dairycompCommandWhitelistTable.id });
      if (!deleted) {
        res.status(404).json({ error: "Eintrag nicht gefunden" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "dairycomp-whitelist: DELETE fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  }
);

export default router;
