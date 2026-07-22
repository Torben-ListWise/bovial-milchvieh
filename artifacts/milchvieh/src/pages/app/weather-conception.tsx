import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { getAuthToken } from "@workspace/api-client-react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  Thermometer,
  TrendingDown,
  TrendingUp,
  Minus,
  Info,
  RefreshCw,
  AlertTriangle,
  MapPin,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ── Typen ──────────────────────────────────────────────────────────────────────

interface ConceptionWeatherPoint {
  month: string;
  monthLabel: string;
  bred_count: number;
  preg_count: number;
  conception_rate: number | null;
  avg_thi: number | null;
  avg_thi_mean: number | null;
  avg_temp: number | null;
}

interface ConceptionWeatherResult {
  series: ConceptionWeatherPoint[];
  pearson_r: number | null;
  pearson_r_temp: number | null;
  offset_days: number;
  data_months: number;
  missing_weather_months: number;
  lat: number;
  lon: number;
  station_note: string;
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

async function fetchCorrelation(
  datasetId: string,
  offset: number,
): Promise<ConceptionWeatherResult> {
  const token = await getAuthToken();
  const resp = await fetch(
    `${API_BASE}/api/datasets/${datasetId}/weather-conception?offset=${offset}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}

function correlationLabel(r: number | null): {
  text: string;
  color: string;
  Icon: React.ElementType;
} {
  if (r == null) return { text: "–", color: "text-muted-foreground", Icon: Minus };
  const abs = Math.abs(r);
  if (abs >= 0.7)
    return {
      text: r < 0 ? "Starker negativer Zusammenhang" : "Starker positiver Zusammenhang",
      color: r < 0 ? "text-orange-600" : "text-green-600",
      Icon: r < 0 ? TrendingDown : TrendingUp,
    };
  if (abs >= 0.4)
    return {
      text: r < 0 ? "Mäßig negativer Zusammenhang" : "Mäßig positiver Zusammenhang",
      color: r < 0 ? "text-amber-600" : "text-blue-600",
      Icon: r < 0 ? TrendingDown : TrendingUp,
    };
  return {
    text: "Schwacher / kein Zusammenhang",
    color: "text-muted-foreground",
    Icon: Minus,
  };
}

const OFFSET_STEPS = [0, -7, -14, -21, -28, -35, -42, -49, -56];
const OFFSET_LABELS: Record<number, string> = {
  0: "Besamungstag",
  "-7": "−1 Woche",
  "-14": "−2 Wochen",
  "-21": "−3 Wochen",
  "-28": "−4 Wochen",
  "-35": "−5 Wochen",
  "-42": "−6 Wochen",
  "-49": "−7 Wochen",
  "-56": "−8 Wochen",
};

// ── Chart-Tooltip ─────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-xs space-y-1">
      <p className="font-semibold text-foreground">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{p.value != null ? p.value.toFixed(1) : "–"}</strong>
          {p.name === "Konzeptionsrate" ? "%" : ""}
        </p>
      ))}
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export function WeatherConceptionPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const datasetId = params.get("datasetId") ?? "";

  const [offset, setOffset] = useState(0);

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<ConceptionWeatherResult, Error>({
    queryKey: ["weather-conception", datasetId, offset],
    queryFn: () => fetchCorrelation(datasetId, offset),
    enabled: !!datasetId,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const correlTHI = data ? correlationLabel(data.pearson_r) : null;

  if (!datasetId) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Kein Datensatz ausgewählt.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Thermometer className="w-6 h-6 text-amber-500" />
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Wetter × Konzeptionsrate
          </h1>
          <p className="text-sm text-muted-foreground">
            DWD-Temperatur/THI vs. monatliche Besamungserfolge
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isFetching && "animate-spin")} />
          Aktualisieren
        </Button>
      </div>

      {/* Zeitversatz-Selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              <strong>Zeitversatz:</strong> Wähle, wie viele Tage <em>vor</em> der
              Besamung der Temperatur/THI gemessen wird. Standard = 0 (Besamungstag
              selbst). −8 Wochen analysiert den Einfluss auf die Eizellreifung.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {OFFSET_STEPS.map((step) => (
              <button
                key={step}
                onClick={() => setOffset(step)}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-full border transition-colors",
                  offset === step
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
                )}
              >
                {OFFSET_LABELS[step]}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Fehler/Status */}
      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong>Fehler:</strong> {error.message}
            {error.message.includes("Standort") && (
              <div className="mt-2 space-y-1">
                <p className="text-xs">
                  Bitte Betriebsstandort (Breitengrad/Längengrad) in den Einstellungen hinterlegen.
                </p>
                <a
                  href="/app/settings#standort"
                  className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2"
                >
                  Zu den Einstellungen →
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          <div className="h-10 rounded-lg bg-muted animate-pulse" />
          <div className="h-80 rounded-xl bg-muted animate-pulse" />
        </div>
      )}

      {data && data.series.length === 0 && !isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <Thermometer className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Keine BRED-Events mit ausreichend Daten gefunden.</p>
          <p className="text-xs mt-1 opacity-60">
            Mindestens 5 Besamungen pro Monat werden für die Auswertung benötigt.
          </p>
        </div>
      )}

      {data && data.series.length > 0 && (
        <>
          {/* KPI-Karten */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-3">
              <p className="text-[11px] text-muted-foreground">Analysezeitraum</p>
              <p className="text-lg font-bold">{data.data_months} Monate</p>
            </Card>
            <Card className="p-3">
              <p className="text-[11px] text-muted-foreground">Korrelation r (THI)</p>
              <p
                className={cn(
                  "text-lg font-bold",
                  correlTHI?.color ?? "text-foreground",
                )}
              >
                {data.pearson_r != null ? data.pearson_r.toFixed(2) : "–"}
              </p>
            </Card>
            <Card className="p-3">
              <p className="text-[11px] text-muted-foreground">Zeitversatz</p>
              <p className="text-lg font-bold">
                {OFFSET_LABELS[offset] ?? `${offset} Tage`}
              </p>
            </Card>
            <Card className="p-3 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-[11px] text-muted-foreground">Standort</p>
                <p className="text-xs font-medium">
                  {data.lat.toFixed(2)}° N, {data.lon.toFixed(2)}° E
                </p>
              </div>
            </Card>
          </div>

          {/* Korrelationsinterpretation */}
          {correlTHI && data.pearson_r != null && (
            <div
              className={cn(
                "flex items-center gap-2 text-sm px-3 py-2 rounded-lg border",
                Math.abs(data.pearson_r) >= 0.4
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-muted/50 border-border text-muted-foreground",
              )}
            >
              <correlTHI.Icon className="w-4 h-4 shrink-0" />
              <span>
                <strong>r = {data.pearson_r.toFixed(2)}</strong> —{" "}
                {correlTHI.text}. Bei r &lt; −0.4 besteht ein relevanter
                Hitzestress-Effekt auf die Konzeptionsrate.
              </span>
            </div>
          )}

          {/* Dual-Axis-Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Ø THI (Tageshöchstwert) vs. Konzeptionsrate — monatlich
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart
                  data={data.series}
                  margin={{ top: 8, right: 24, bottom: 8, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    label={{
                      value: "Konzeptionsrate (%)",
                      angle: -90,
                      position: "insideLeft",
                      offset: 10,
                      style: { fontSize: 10, fill: "#6b7280" },
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[40, 100]}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    label={{
                      value: "THI",
                      angle: 90,
                      position: "insideRight",
                      offset: 10,
                      style: { fontSize: 10, fill: "#6b7280" },
                    }}
                  />
                  {/* Hitzestress-Schwelle bei THI 72 */}
                  <ReferenceLine
                    yAxisId="right"
                    y={72}
                    stroke="#f59e0b"
                    strokeDasharray="4 2"
                    label={{
                      value: "Hitzestress-Schwelle (THI 72)",
                      position: "insideTopRight",
                      fontSize: 10,
                      fill: "#d97706",
                    }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="conception_rate"
                    name="Konzeptionsrate"
                    fill="#10b981"
                    fillOpacity={0.7}
                    radius={[2, 2, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avg_thi"
                    name="Ø THI (Max)"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#f59e0b" }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
              {data.missing_weather_months > 0 && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  ⚠ Für {data.missing_weather_months} Monat(e) fehlen Wetterdaten.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Erläuterungen */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-muted-foreground">
            <div className="space-y-1">
              <p className="font-medium text-foreground">Was bedeutet THI?</p>
              <p>
                Der Temperature-Humidity Index (THI) misst Hitzestress. Ab THI &gt; 72
                beginnt Hitzestress bei Milchkühen. Ab THI &gt; 80 tritt schwerer
                Stress auf, der die Spermienqualität, Befruchtungsrate und frühe
                Embryonalentwicklung messbar beeinträchtigt.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Zeitversatz</p>
              <p>
                Der Zeitversatz erlaubt dir zu untersuchen, ob Hitzestress
                <em>vor</em> der Besamung (z.B. während der Eizellreifung, ~−3 bis
                −5 Wochen) einen stärkeren Effekt hat als am Besamungstag selbst.
              </p>
            </div>
          </div>

          {/* Datenquelle */}
          <p className="text-[11px] text-muted-foreground/60 border-t border-border pt-3">
            {data.station_note} · Methode: Pearson-Korrelation r(THI<sub>max</sub>,
            Konzeptionsrate) · Mindestbestand: ≥ 5 Besamungen/Monat
          </p>
        </>
      )}
    </div>
  );
}

// ── Kompakte Karte für Dashboard-Überblick ────────────────────────────────────

export function WeatherConceptionCard({
  datasetId,
}: {
  datasetId: string;
}) {
  const { data, isLoading, error } = useQuery<ConceptionWeatherResult, Error>({
    queryKey: ["weather-conception", datasetId, 0],
    queryFn: () => fetchCorrelation(datasetId, 0),
    staleTime: 30 * 60 * 1000,
    retry: 0,
  });

  if (error?.message.includes("Standort") || error?.message.includes("422")) {
    return null; // Kein Standort → kein Widget
  }

  if (isLoading) {
    return (
      <div className="h-20 rounded-xl bg-muted animate-pulse" />
    );
  }

  if (!data || data.series.length === 0) return null;

  const correlLabel = correlationLabel(data.pearson_r);
  const hasHeatIssue =
    data.pearson_r != null && data.pearson_r < -0.4;

  // Letztes Sommer-Maximum
  const summerMonths = data.series.filter((p) => {
    const m = parseInt(p.month.split("-")[1]);
    return m >= 6 && m <= 9;
  });
  const latestSummer = summerMonths.at(-1);

  return (
    <Card className={cn(
      "border",
      hasHeatIssue ? "border-amber-200 bg-amber-50/20" : "border-border",
    )}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Thermometer
            className={cn(
              "w-5 h-5 shrink-0 mt-0.5",
              hasHeatIssue ? "text-amber-500" : "text-muted-foreground",
            )}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-foreground">
                Hitzestress-Auswirkung
              </span>
              {data.pearson_r != null && (
                <span
                  className={cn(
                    "text-[11px] font-medium px-1.5 py-0.5 rounded",
                    correlLabel.color,
                    "bg-current/10",
                  )}
                >
                  r = {data.pearson_r.toFixed(2)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {hasHeatIssue
                ? `Negativer Zusammenhang zwischen THI und Konzeptionsrate erkannt.`
                : `Kein signifikanter THI-Effekt auf die Konzeptionsrate festgestellt.`}
              {latestSummer && latestSummer.avg_thi != null && (
                <span>
                  {" "}
                  Letzter Sommer: Ø THI {latestSummer.avg_thi.toFixed(0)}, KR{" "}
                  {latestSummer.conception_rate?.toFixed(0) ?? "–"}%.
                </span>
              )}
            </p>
          </div>
          <a
            href={`/app/weather-correlation?datasetId=${datasetId}`}
            className="text-[11px] text-primary hover:underline whitespace-nowrap"
          >
            Details →
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
