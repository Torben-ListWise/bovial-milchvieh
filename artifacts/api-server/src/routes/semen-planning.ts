import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, semenPlanningTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { canReadDataset } from "../lib/teamAccess";

const router = Router();

// ── Shared calculation logic (mirrors calculate_semen_planning agent tool) ────
function calcSemenPlanning(inp: {
  summeKuehe: number; konzRateKuehe: number; konzRateFaersen: number;
  prozentAbgaenge: number; eka: number; verlusteKueheRate: number; verlusteRinderRate: number;
  anteilHoGesext: number; anteilHoKonv: number; anteilBeefGesext: number; anteilBeefKonv: number;
  preisHoGesext: number; preisHoKonv: number; preisBeefGesext: number; preisBeefKonv: number;
  verkaufspreisHoBullkalb: number; verkaufspreisBeefWeiblich: number; verkaufspreisBeefBullkalb: number;
}) {
  const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
  const kuehe = inp.summeKuehe;
  const kzKuehe = inp.konzRateKuehe / 100;
  const kzFaersen = inp.konzRateFaersen / 100;

  const benoetigteFaersen = round(kuehe * inp.prozentAbgaenge / 100);
  const traechtigkeitenKuehe = round(kuehe * 0.9);
  const traechtigkeitenFaersen = round(benoetigteFaersen * 1.05);

  const totalBesamungenKuehe = traechtigkeitenKuehe / kzKuehe;
  const totalBesamungenFaersen = traechtigkeitenFaersen / kzFaersen;
  const totalBesamungen = totalBesamungenKuehe + totalBesamungenFaersen;

  const aHoGes = inp.anteilHoGesext / 100;
  const aHoKonv = inp.anteilHoKonv / 100;
  const aBeefGes = inp.anteilBeefGesext / 100;
  const aBeefKonv = inp.anteilBeefKonv / 100;

  const portHoGes = round(totalBesamungen * aHoGes);
  const portHoKonv = round(totalBesamungen * aHoKonv);
  const portBeefGes = round(totalBesamungen * aBeefGes);
  const portBeefKonv = round(totalBesamungen * aBeefKonv);
  const portGesamt = round(portHoGes + portHoKonv + portBeefGes + portBeefKonv);

  const pregHoGes = round(traechtigkeitenKuehe * aHoGes + traechtigkeitenFaersen * aHoGes);
  const pregHoKonv = round(traechtigkeitenKuehe * aHoKonv + traechtigkeitenFaersen * aHoKonv);
  const pregBeefGes = round(traechtigkeitenKuehe * aBeefGes + traechtigkeitenFaersen * aBeefGes);
  const pregBeefKonv = round(traechtigkeitenKuehe * aBeefKonv + traechtigkeitenFaersen * aBeefKonv);

  const maleHoGes = round(pregHoGes * 0.10);
  const maleHoKonv = round(pregHoKonv * 0.50);
  const maleBeefGes = round(pregBeefGes * 0.90);
  const maleBeefKonv = round(pregBeefKonv * 0.50);
  const femaleHoGes = round(pregHoGes * 0.90);
  const femaleHoKonv = round(pregHoKonv * 0.50);
  const femaleBeefGes = round(pregBeefGes * 0.10);
  const femaleBeefKonv = round(pregBeefKonv * 0.50);

  const verfuegbareHoFaersen = round(femaleHoGes + femaleHoKonv);
  const faersenBalance = round(verfuegbareHoFaersen - benoetigteFaersen);
  const moeglAbgangsrate = round((verfuegbareHoFaersen / kuehe) * 100, 1);
  const aufzuchtplaetze = round(benoetigteFaersen / 12 * inp.eka);

  const kostenHoGes = round(portHoGes * inp.preisHoGesext);
  const kostenHoKonv = round(portHoKonv * inp.preisHoKonv);
  const kostenBeefGes = round(portBeefGes * inp.preisBeefGesext);
  const kostenBeefKonv = round(portBeefKonv * inp.preisBeefKonv);
  const gesamtkosten = round(kostenHoGes + kostenHoKonv + kostenBeefGes + kostenBeefKonv);
  const kostenProKuhJahr = round(gesamtkosten / kuehe);

  const erlösHoMaennlich = round((maleHoGes + maleHoKonv) * inp.verkaufspreisHoBullkalb);
  const erlösBeefMaennlich = round((maleBeefGes + maleBeefKonv) * inp.verkaufspreisBeefBullkalb);
  const erlösBeefWeiblich = round((femaleBeefGes + femaleBeefKonv) * inp.verkaufspreisBeefWeiblich);
  const gesamterlös = round(erlösHoMaennlich + erlösBeefMaennlich + erlösBeefWeiblich);
  const nettokosten = round(gesamtkosten - gesamterlös);
  const nettokostenProKuhJahr = round(nettokosten / kuehe);
  const sexingMehrpreisProKuhMonat = round(
    (inp.preisHoGesext - inp.preisHoKonv) * portHoGes / kuehe / 12, 2
  );

  return {
    herdendynamik: { benoetigteFaersen, traechtigkeitenKuehe, traechtigkeitenFaersen, aufzuchtplaetze },
    besamungen: {
      totalBesamungenKuehe: round(totalBesamungenKuehe),
      totalBesamungenFaersen: round(totalBesamungenFaersen),
      portionen: { hoGesext: portHoGes, hoKonv: portHoKonv, beefGesext: portBeefGes, beefKonv: portBeefKonv, gesamt: portGesamt },
    },
    kaelber: {
      maennlich: { hoGesext: maleHoGes, hoKonv: maleHoKonv, beefGesext: maleBeefGes, beefKonv: maleBeefKonv },
      weiblichBeef: { beefGesext: femaleBeefGes, beefKonv: femaleBeefKonv },
      verfuegbareHoFaersen,
    },
    faersenbalance: { verfuegbareHoFaersen, benoetigteFaersen, faersenBalance, moeglAbgangsratePct: moeglAbgangsrate },
    kosten: { hoGesext: kostenHoGes, hoKonv: kostenHoKonv, beefGesext: kostenBeefGes, beefKonv: kostenBeefKonv, gesamt: gesamtkosten, proKuhJahr: kostenProKuhJahr },
    erloese: { hoMaennlich: erlösHoMaennlich, beefMaennlich: erlösBeefMaennlich, beefWeiblich: erlösBeefWeiblich, gesamt: gesamterlös },
    nettokosten,
    nettokostenProKuhJahr,
    sexingMehrpreisProKuhMonat,
  };
}

// GET /api/datasets/:datasetId/semen-planning
router.get("/datasets/:datasetId/semen-planning", requireAuth, async (req: Request, res: Response) => {
  const { datasetId } = req.params as { datasetId: string };
  const userId = req.userId!;
  if (!await canReadDataset(datasetId, userId)) { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db.select().from(semenPlanningTable).where(eq(semenPlanningTable.datasetId, datasetId)).limit(1);
  if (rows.length === 0) {
    res.json({ found: false });
  } else {
    res.json({ found: true, inputs: rows[0].inputs, outputs: rows[0].outputs, updatedAt: rows[0].updatedAt });
  }
});

// POST /api/datasets/:datasetId/semen-planning/calculate
router.post("/datasets/:datasetId/semen-planning/calculate", requireAuth, async (req: Request, res: Response) => {
  const { datasetId } = req.params as { datasetId: string };
  const userId = req.userId!;
  if (!await canReadDataset(datasetId, userId)) { res.status(403).json({ error: "Forbidden" }); return; }

  const inp = req.body as Parameters<typeof calcSemenPlanning>[0];

  if (!inp.summeKuehe || inp.summeKuehe <= 0) { res.status(400).json({ error: "summeKuehe muss größer 0 sein." }); return; }
  const anteilSum = (inp.anteilHoGesext ?? 0) + (inp.anteilHoKonv ?? 0) + (inp.anteilBeefGesext ?? 0) + (inp.anteilBeefKonv ?? 0);
  if (Math.abs(anteilSum - 100) > 0.5) { res.status(400).json({ error: `Sperma-Anteile summieren sich zu ${anteilSum.toFixed(1)} % — müssen genau 100 % ergeben.` }); return; }

  const outputs = calcSemenPlanning(inp);
  const nowTs = new Date();

  await db
    .insert(semenPlanningTable)
    .values({ datasetId, userId, inputs: inp as any, outputs: outputs as any, updatedAt: nowTs })
    .onConflictDoUpdate({ target: semenPlanningTable.datasetId, set: { inputs: inp as any, outputs: outputs as any, updatedAt: nowTs } });

  res.json({ inputs: inp, outputs });
});

export default router;
