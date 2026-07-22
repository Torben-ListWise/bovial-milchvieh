/**
 * Routen: Wetter × Konzeptionsraten-Korrelation
 *
 * GET /api/datasets/:id/weather-conception?offset=0
 *   Berechnet die Korrelation zwischen DWD-Temperatur/THI und der monatlichen
 *   Konzeptionsrate des Datensatzes. offset = Zeitversatz in Tagen (0 bis -365).
 *
 * GET /api/weather-conception/status
 *   Gibt zurück, ob für den aktuellen Nutzer Wetter-Koordinaten konfiguriert sind.
 */

import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, datasetsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { computeWeatherConceptionCorrelation } from "../lib/weatherConception";
import { logger } from "../lib/logger";

const router = Router();

router.get(
  "/datasets/:id/weather-conception",
  requireAuth,
  async (req: Request, res: Response) => {
    const datasetId = req.params["id"];
    const userId = (req as any).userId as string;
    const offsetDays = Math.round(
      parseFloat((req.query["offset"] as string | undefined) ?? "0"),
    );

    // 1. Dataset-Zugehörigkeit prüfen
    const [dataset] = await db
      .select({ id: datasetsTable.id, userId: datasetsTable.userId })
      .from(datasetsTable)
      .where(eq(datasetsTable.id, datasetId))
      .limit(1);

    if (!dataset) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }

    // Betriebszugehörigkeit: Eigentümer oder Gast (vereinfachte Prüfung)
    if (dataset.userId !== userId) {
      // Gastnutzer: teamAccess-Prüfung könnte hier ergänzt werden
      // Für jetzt: nur Eigentümer erlaubt
      res.status(403).json({ error: "Kein Zugriff" });
      return;
    }

    // 2. Standortkoordinaten des Nutzers
    const [user] = await db
      .select({
        lat: (usersTable as any).lat,
        lng: (usersTable as any).lng,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user?.lat || !user?.lng) {
      res.status(422).json({
        error: "Kein Standort konfiguriert",
        hint: "Bitte Breitengrad und Längengrad in den Betriebseinstellungen eintragen.",
      });
      return;
    }

    try {
      const result = await computeWeatherConceptionCorrelation(
        datasetId,
        user.lat as number,
        user.lng as number,
        offsetDays,
      );
      res.json(result);
    } catch (err) {
      logger.error({ err, datasetId }, "weather-conception Fehler");
      res.status(500).json({ error: "Berechnungsfehler" });
    }
  },
);

// Quick-Status-Check
router.get(
  "/weather-conception/status",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    const [user] = await db
      .select({
        lat: (usersTable as any).lat,
        lng: (usersTable as any).lng,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    res.json({
      hasLocation: !!(user?.lat && user?.lng),
      lat: user?.lat ?? null,
      lng: user?.lng ?? null,
    });
  },
);

export default router;
