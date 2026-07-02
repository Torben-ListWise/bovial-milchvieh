/**
 * THI (Temperature-Humidity Index) integration
 * - Open-Meteo API fetch (no API key required)
 * - THI calculation using Brügemann et al. 2012 formula
 * - Nightly job: update all users with coordinates, create warnings
 */
import { and, eq, isNotNull, desc } from "drizzle-orm";
import { db, usersTable, thiForecasts, warningsTable, datasetsTable } from "@workspace/db";
import { logger } from "./logger";

// ── THI formula ─────────────────────────────────────────────────────────────

export function calcTHI(tempC: number, rh: number): number {
  return (1.8 * tempC + 32) - (0.55 - 0.0055 * rh) * (1.8 * tempC - 26);
}

export type ThiStatus = "normal" | "leicht" | "moderat" | "schwer";

export function thiStatus(thi: number): ThiStatus {
  if (thi <= 60) return "normal";
  if (thi <= 72) return "leicht";
  if (thi <= 80) return "moderat";
  return "schwer";
}

function thiSeverityLabel(status: ThiStatus): string {
  switch (status) {
    case "leicht": return "Leichter Hitzestress";
    case "moderat": return "Moderater Hitzestress";
    case "schwer": return "Schwerer Hitzestress";
    default: return "Normaler THI-Bereich";
  }
}

// ── Open-Meteo fetch ─────────────────────────────────────────────────────────

interface HourlyData {
  time: string[];
  temperature_2m: number[];
  relativehumidity_2m: number[];
}

export async function fetchOpenMeteo(lat: number, lng: number): Promise<HourlyData> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("hourly", "temperature_2m,relativehumidity_2m");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("timezone", "Europe/Berlin");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo API error: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { hourly: HourlyData };
  return data.hourly;
}

// ── Per-user THI computation ─────────────────────────────────────────────────

export interface ThiResult {
  outdoorThiCurrent: number;
  effectiveThiCurrent: number;
  status: ThiStatus;
  nextDayMaxThi: number;
  heatStressHours: number;
  hourlyData: { time: string; thi: number; effectiveThi: number }[];
}

export async function computeThiForUser(
  lat: number,
  lng: number,
  correction: number,
): Promise<ThiResult> {
  const hourly = await fetchOpenMeteo(lat, lng);
  const now = new Date();

  const hourlyData = hourly.time.map((t, i) => {
    const thi = calcTHI(hourly.temperature_2m[i]!, hourly.relativehumidity_2m[i]!);
    return { time: t, thi, effectiveThi: thi + correction };
  });

  // Current hour (match "YYYY-MM-DDTHH" prefix)
  const nowHour = now.toISOString().slice(0, 13);
  const currentIdx = hourlyData.findIndex((h) => h.time.startsWith(nowHour));
  const current = hourlyData[currentIdx >= 0 ? currentIdx : 0]!;

  // Tomorrow's hours for warning analysis
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);
  const nextDayHours = hourlyData.filter((h) => h.time.startsWith(tomorrowDate));

  const maxEffective =
    nextDayHours.length > 0
      ? Math.max(...nextDayHours.map((h) => h.effectiveThi))
      : current.effectiveThi;

  // Max consecutive hours with effective THI > 60 tomorrow
  let maxConsecutive = 0;
  let currentRun = 0;
  for (const h of nextDayHours) {
    if (h.effectiveThi > 60) {
      currentRun++;
      maxConsecutive = Math.max(maxConsecutive, currentRun);
    } else {
      currentRun = 0;
    }
  }

  return {
    outdoorThiCurrent: Math.round(current.thi * 10) / 10,
    effectiveThiCurrent: Math.round(current.effectiveThi * 10) / 10,
    status: thiStatus(current.effectiveThi),
    nextDayMaxThi: Math.round(maxEffective * 10) / 10,
    heatStressHours: maxConsecutive,
    hourlyData,
  };
}

// ── Upsert forecast (exported for on-demand use in routes) ───────────────────

export async function upsertForecastPublic(userId: string, result: ThiResult): Promise<void> {
  await db
    .insert(thiForecasts)
    .values({
      userId,
      fetchedAt: new Date(),
      outdoorThiCurrent: result.outdoorThiCurrent,
      effectiveThiCurrent: result.effectiveThiCurrent,
      status: result.status,
      nextDayMaxThi: result.nextDayMaxThi,
      heatStressHours: result.heatStressHours,
      hourlyData: result.hourlyData as any,
    })
    .onConflictDoUpdate({
      target: thiForecasts.userId,
      set: {
        fetchedAt: new Date(),
        outdoorThiCurrent: result.outdoorThiCurrent,
        effectiveThiCurrent: result.effectiveThiCurrent,
        status: result.status,
        nextDayMaxThi: result.nextDayMaxThi,
        heatStressHours: result.heatStressHours,
        hourlyData: result.hourlyData as any,
      },
    });
}

// ── Warning creation ─────────────────────────────────────────────────────────

async function createThiWarning(userId: string, result: ThiResult): Promise<void> {
  if (result.heatStressHours < 4) return;

  // Find user's most recent ready dataset for the warning
  const datasets = await db
    .select({ id: datasetsTable.id })
    .from(datasetsTable)
    .where(and(eq(datasetsTable.userId, userId), eq(datasetsTable.status, "ready")))
    .orderBy(desc(datasetsTable.updatedAt))
    .limit(1);

  if (datasets.length === 0) return;
  const datasetId = datasets[0]!.id;

  // Remove previous open THI warnings for this dataset
  await db
    .delete(warningsTable)
    .where(
      and(
        eq(warningsTable.datasetId, datasetId),
        eq(warningsTable.metric, "thi"),
        eq(warningsTable.status, "open"),
      ),
    );

  const maxStatus = thiStatus(result.nextDayMaxThi);
  const severity =
    maxStatus === "schwer" ? "critical" : maxStatus === "moderat" ? "warning" : "info";

  const recommendations = [
    "Lüftungsanlage auf maximale Leistung stellen",
    "Tränken auf ausreichende Wasserverfügbarkeit prüfen",
    "Fütterungszeiten in die kühleren Morgenstunden verlegen",
    ...(result.nextDayMaxThi > 72 ? ["Liegeboxen zusätzlich kühlen"] : []),
    ...(result.nextDayMaxThi > 80
      ? ["Tierarzt informieren, Milchleistungseinbußen einkalkulieren"]
      : []),
  ];

  await db.insert(warningsTable).values({
    datasetId,
    userId,
    title: `Hitzestress-Warnung: Eff. THI ${result.nextDayMaxThi.toFixed(1)} — ${result.heatStressHours}h über Schwellenwert`,
    detail: [
      `${thiSeverityLabel(maxStatus)} für morgen prognostiziert (${result.heatStressHours} aufeinanderfolgende Stunden mit THI > 60).`,
      `Effektiver Stall-THI (max.): ${result.nextDayMaxThi.toFixed(1)} | Status: ${maxStatus}`,
      "",
      "Empfohlene Maßnahmen:",
      ...recommendations.map((r) => `• ${r}`),
      "",
      "Quelle: Brügemann et al. 2012 | Wetterdaten: Open-Meteo",
    ].join("\n"),
    metric: "thi",
    value: result.nextDayMaxThi,
    severity,
    status: "open",
  });
}

// ── Nightly batch job ────────────────────────────────────────────────────────

export async function runThiBatch(): Promise<{ processed: number; errors: number }> {
  logger.info("THI-Batch: Starte Hitzestress-Prüfung für alle Betriebe");

  const users = await db
    .select({
      id: usersTable.id,
      lat: (usersTable as any).lat,
      lng: (usersTable as any).lng,
      stallCoolingCorrection: (usersTable as any).stallCoolingCorrection,
    })
    .from(usersTable)
    .where(
      and(
        isNotNull((usersTable as any).lat),
        isNotNull((usersTable as any).lng),
      ),
    );

  let processed = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const correction = (user.stallCoolingCorrection as number) ?? 0;
      const result = await computeThiForUser(
        user.lat as number,
        user.lng as number,
        correction,
      );
      await upsertForecastPublic(user.id, result);
      await createThiWarning(user.id, result);
      processed++;
      logger.debug(
        { userId: user.id, effectiveThi: result.effectiveThiCurrent },
        "THI-Batch: Betrieb verarbeitet",
      );
    } catch (err) {
      errors++;
      logger.error({ err, userId: user.id }, "THI-Batch: Fehler für Betrieb");
    }
  }

  logger.info({ processed, errors }, "THI-Batch: Abgeschlossen");
  return { processed, errors };
}

// ── Scheduler (hourly check, runs batch daily at 01:00) ──────────────────────

let thiLastRun: Date | null = null;

export function startThiScheduler(): void {
  logger.info("THI-Scheduler gestartet (stündliche Prüfung, Ausführung täglich 01:00 Uhr)");
  setInterval(() => {
    const now = new Date();
    // Run once per day at 01:00
    if (now.getHours() !== 1) return;
    // Guard: only once per hour window
    if (thiLastRun && now.getTime() - thiLastRun.getTime() < 60 * 60 * 1000) return;
    thiLastRun = now;
    runThiBatch().catch((err) => logger.error({ err }, "THI-Scheduler-Fehler"));
  }, 60 * 60 * 1000);
}
