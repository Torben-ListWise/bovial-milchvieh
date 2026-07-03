import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useRequireDataset } from "@/hooks/use-require-dataset";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FlaskConical, RefreshCw, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

function eur(n: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
function num(n: number, d = 0) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: d }).format(n);
}

const DEFAULT_INPUTS = {
  summeKuehe: 100,
  konzRateKuehe: 35,
  konzRateFaersen: 60,
  prozentAbgaenge: 28,
  eka: 26,
  verlusteKueheRate: 5,
  verlusteRinderRate: 3,
  anteilHoGesext: 60,
  anteilHoKonv: 10,
  anteilBeefGesext: 0,
  anteilBeefKonv: 30,
  preisHoGesext: 22,
  preisHoKonv: 6,
  preisBeefGesext: 22,
  preisBeefKonv: 5,
  verkaufspreisHoBullkalb: 80,
  verkaufspreisBeefWeiblich: 200,
  verkaufspreisBeefBullkalb: 350,
};
type PlanningInputs = typeof DEFAULT_INPUTS;
type PlanningOutputs = {
  herdendynamik: { benoetigteFaersen: number; traechtigkeitenKuehe: number; traechtigkeitenFaersen: number; aufzuchtplaetze: number };
  besamungen: { totalBesamungenKuehe: number; totalBesamungenFaersen: number; portionen: { hoGesext: number; hoKonv: number; beefGesext: number; beefKonv: number; gesamt: number } };
  faersenbalance: { verfuegbareHoFaersen: number; benoetigteFaersen: number; faersenBalance: number; moeglAbgangsratePct: number };
  kosten: { hoGesext: number; hoKonv: number; beefGesext: number; beefKonv: number; gesamt: number; proKuhJahr: number };
  erloese: { hoMaennlich: number; beefMaennlich: number; beefWeiblich: number; gesamt: number };
  nettokosten: number;
  nettokostenProKuhJahr: number;
  sexingMehrpreisProKuhMonat: number;
};

function NumField({
  label, value, onChange, unit, min = 0, max, step = 1, hint,
}: {
  label: string; value: number; onChange: (v: number) => void;
  unit?: string; min?: number; max?: number; step?: number; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {unit && <span className="text-xs text-muted-foreground whitespace-nowrap">{unit}</span>}
      </div>
      {hint && <span className="text-xs text-muted-foreground/70">{hint}</span>}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultRow({ label, value, highlight }: { label: string; value: string; highlight?: "good" | "bad" | "neutral" }) {
  return (
    <div className={cn(
      "flex items-center justify-between py-2 px-3 rounded-md",
      highlight === "good" && "bg-emerald-50 dark:bg-emerald-950/30",
      highlight === "bad" && "bg-red-50 dark:bg-red-950/30",
      !highlight && "bg-muted/40",
    )}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn(
        "text-sm font-semibold tabular-nums",
        highlight === "good" && "text-emerald-700 dark:text-emerald-400",
        highlight === "bad" && "text-red-700 dark:text-red-400",
      )}>{value}</span>
    </div>
  );
}

export function SemenPlanningPage() {
  const { datasetId } = useRequireDataset();
  const { getToken } = useAuth();
  const { toast } = useToast();

  const [inputs, setInputs] = useState<PlanningInputs>(DEFAULT_INPUTS);
  const [outputs, setOutputs] = useState<PlanningOutputs | null>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/semen-planning`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.found) {
            setInputs({ ...DEFAULT_INPUTS, ...(data.inputs ?? {}) });
            setOutputs(data.outputs ?? null);
            setLastSaved(data.updatedAt ? new Date(data.updatedAt) : null);
          }
        }
      } catch { }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [datasetId]);

  function setField(key: keyof PlanningInputs, value: number) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  const anteilSum = inputs.anteilHoGesext + inputs.anteilHoKonv + inputs.anteilBeefGesext + inputs.anteilBeefKonv;
  const anteilValid = Math.abs(anteilSum - 100) <= 0.5;

  async function handleCalculate() {
    if (!datasetId) return;
    if (!anteilValid) {
      toast({ variant: "destructive", title: "Sperma-Anteile ungültig", description: `Aktuell ${num(anteilSum, 1)} % — müssen genau 100 % ergeben.` });
      return;
    }
    setCalculating(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/semen-planning/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(inputs),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Berechnung fehlgeschlagen.");
      }
      const data = await res.json();
      setOutputs(data.outputs);
      setLastSaved(new Date());
      toast({ title: "Berechnung gespeichert" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Fehler", description: e?.message ?? "Unbekannter Fehler." });
    } finally {
      setCalculating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const faersenBalance = outputs?.faersenbalance.faersenBalance ?? 0;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold">Sperma-Kalkulator</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Besamungs- und Erlösplanung für Ihren Betrieb
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-xs text-muted-foreground">
              Gespeichert {lastSaved.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button onClick={handleCalculate} disabled={calculating} size="sm">
            {calculating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Berechnen & Speichern
          </Button>
        </div>
      </div>

      <SectionCard title="Herdenparameter">
        <NumField label="Kühe gesamt" value={inputs.summeKuehe} onChange={(v) => setField("summeKuehe", v)} unit="Tiere" min={1} />
        <NumField label="Konzeptionsrate Kühe" value={inputs.konzRateKuehe} onChange={(v) => setField("konzRateKuehe", v)} unit="%" min={1} max={100} />
        <NumField label="Konzeptionsrate Färsen" value={inputs.konzRateFaersen} onChange={(v) => setField("konzRateFaersen", v)} unit="%" min={1} max={100} />
        <NumField label="Abgangsrate" value={inputs.prozentAbgaenge} onChange={(v) => setField("prozentAbgaenge", v)} unit="%" min={0} max={100} />
        <NumField label="Erstkalbealter" value={inputs.eka} onChange={(v) => setField("eka", v)} unit="Monate" min={18} max={40} />
        <NumField label="Verlustrate Kühe" value={inputs.verlusteKueheRate} onChange={(v) => setField("verlusteKueheRate", v)} unit="%" min={0} max={30} />
        <NumField label="Verlustrate Rinder" value={inputs.verlusteRinderRate} onChange={(v) => setField("verlusteRinderRate", v)} unit="%" min={0} max={30} />
      </SectionCard>

      <SectionCard title={`Sperma-Mix (Summe: ${num(anteilSum, 1)} % — muss 100 % ergeben)`}>
        <NumField label="HO gesext" value={inputs.anteilHoGesext} onChange={(v) => setField("anteilHoGesext", v)} unit="%" min={0} max={100} hint="Sexed Holstein" />
        <NumField label="HO konv." value={inputs.anteilHoKonv} onChange={(v) => setField("anteilHoKonv", v)} unit="%" min={0} max={100} hint="Konventionell Holstein" />
        <NumField label="Beef gesext" value={inputs.anteilBeefGesext} onChange={(v) => setField("anteilBeefGesext", v)} unit="%" min={0} max={100} hint="Sexed Beef" />
        <NumField label="Beef konv." value={inputs.anteilBeefKonv} onChange={(v) => setField("anteilBeefKonv", v)} unit="%" min={0} max={100} hint="Konventionell Beef" />
        {!anteilValid && (
          <div className="col-span-full text-xs text-red-600 dark:text-red-400 font-medium">
            Summe {num(anteilSum, 1)} % — bitte auf genau 100 % anpassen.
          </div>
        )}
      </SectionCard>

      <SectionCard title="Sperma-Einkaufspreise">
        <NumField label="HO gesext" value={inputs.preisHoGesext} onChange={(v) => setField("preisHoGesext", v)} unit="€/Portion" min={0} step={0.5} />
        <NumField label="HO konv." value={inputs.preisHoKonv} onChange={(v) => setField("preisHoKonv", v)} unit="€/Portion" min={0} step={0.5} />
        <NumField label="Beef gesext" value={inputs.preisBeefGesext} onChange={(v) => setField("preisBeefGesext", v)} unit="€/Portion" min={0} step={0.5} />
        <NumField label="Beef konv." value={inputs.preisBeefKonv} onChange={(v) => setField("preisBeefKonv", v)} unit="€/Portion" min={0} step={0.5} />
      </SectionCard>

      <SectionCard title="Kalbverkaufspreise">
        <NumField label="HO-Bullkalb" value={inputs.verkaufspreisHoBullkalb} onChange={(v) => setField("verkaufspreisHoBullkalb", v)} unit="€/Tier" min={0} step={5} />
        <NumField label="Beef-Bullkalb" value={inputs.verkaufspreisBeefBullkalb} onChange={(v) => setField("verkaufspreisBeefBullkalb", v)} unit="€/Tier" min={0} step={5} />
        <NumField label="Beef-Kuhkalb" value={inputs.verkaufspreisBeefWeiblich} onChange={(v) => setField("verkaufspreisBeefWeiblich", v)} unit="€/Tier" min={0} step={5} />
      </SectionCard>

      {outputs && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold">Ergebnis</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Herdendynamik & Besamungen</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1.5">
                <ResultRow label="Benötigte Ersatzfärsen/Jahr" value={`${num(outputs.herdendynamik.benoetigteFaersen)} Tiere`} />
                <ResultRow label="Besamungen Kühe" value={num(outputs.besamungen.totalBesamungenKuehe)} />
                <ResultRow label="Besamungen Färsen" value={num(outputs.besamungen.totalBesamungenFaersen)} />
                <ResultRow label="Portionen gesamt" value={num(outputs.besamungen.portionen.gesamt)} highlight="neutral" />
                <ResultRow label="  davon HO gesext" value={num(outputs.besamungen.portionen.hoGesext)} />
                <ResultRow label="  davon HO konv." value={num(outputs.besamungen.portionen.hoKonv)} />
                <ResultRow label="  davon Beef gesext" value={num(outputs.besamungen.portionen.beefGesext)} />
                <ResultRow label="  davon Beef konv." value={num(outputs.besamungen.portionen.beefKonv)} />
                <ResultRow label="Aufzuchtplätze" value={num(outputs.herdendynamik.aufzuchtplaetze)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Färsenbalance</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1.5">
                <ResultRow label="Verfügbare HO-Färsen" value={`${num(outputs.faersenbalance.verfuegbareHoFaersen)} Tiere`} />
                <ResultRow label="Benötigt" value={`${num(outputs.faersenbalance.benoetigteFaersen)} Tiere`} />
                <ResultRow
                  label="Überschuss / Fehlbedarf"
                  value={`${faersenBalance >= 0 ? "+" : ""}${num(faersenBalance)} Tiere`}
                  highlight={faersenBalance >= 0 ? "good" : "bad"}
                />
                <ResultRow label="Mögliche Abgangsrate" value={`${num(outputs.faersenbalance.moeglAbgangsratePct, 1)} %`} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Kosten</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1.5">
                <ResultRow label="HO gesext" value={eur(outputs.kosten.hoGesext)} />
                <ResultRow label="HO konv." value={eur(outputs.kosten.hoKonv)} />
                <ResultRow label="Beef gesext" value={eur(outputs.kosten.beefGesext)} />
                <ResultRow label="Beef konv." value={eur(outputs.kosten.beefKonv)} />
                <ResultRow label="Spermakosten gesamt" value={eur(outputs.kosten.gesamt)} highlight="neutral" />
                <ResultRow label="je Kuh & Jahr" value={eur(outputs.kosten.proKuhJahr)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Erlöse & Nettokosten</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1.5">
                <ResultRow label="HO-Bullkälber" value={eur(outputs.erloese.hoMaennlich)} />
                <ResultRow label="Beef-Bullkälber" value={eur(outputs.erloese.beefMaennlich)} />
                <ResultRow label="Beef-Kuhkälber" value={eur(outputs.erloese.beefWeiblich)} />
                <ResultRow label="Gesamterlös Kälber" value={eur(outputs.erloese.gesamt)} highlight="good" />
                <ResultRow
                  label="Nettokosten (Sperma – Erlös)"
                  value={eur(outputs.nettokosten)}
                  highlight={outputs.nettokosten <= 0 ? "good" : "bad"}
                />
                <ResultRow label="Nettokosten je Kuh & Jahr" value={eur(outputs.nettokostenProKuhJahr)} />
                <ResultRow label="Sexing-Mehrpreis je Kuh & Monat" value={`${new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(outputs.sexingMehrpreisProKuhMonat)}`} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {!outputs && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center text-muted-foreground">
          <FlaskConical className="w-8 h-8 opacity-30" />
          <p className="text-sm">Parameter einstellen und auf „Berechnen & Speichern" klicken.</p>
        </div>
      )}
    </div>
  );
}
