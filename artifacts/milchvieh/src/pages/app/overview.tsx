import { useState, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useAuth } from "@clerk/react";
import {
  useGetDatasetOverview,
  getGetDatasetOverviewQueryKey,
  useListAnalyses,
  getListAnalysesQueryKey,
  useListTemplates,
  getListTemplatesQueryKey,
  useRunTemplate,
  useGetCurrentUser,
  useListReports,
  getListReportsQueryKey,
  type AnalysisTemplate,
} from "@workspace/api-client-react";

function filterTemplatesByFocusAreas(
  templates: AnalysisTemplate[],
  focusAreas: string[] | null | undefined
): AnalysisTemplate[] {
  if (!focusAreas || focusAreas.length === 0) return templates;
  if (focusAreas.includes("mischbetrieb") || focusAreas.includes("sonstiges")) return templates;
  return templates.filter(
    (t) => t.categoryTag == null || focusAreas.includes(t.categoryTag)
  );
}
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, X, ArrowRight, ChevronRight, Loader2, Newspaper, ChevronDown, ChevronUp, Upload, FileText, ArrowLeftRight, FlaskConical, Pencil } from "lucide-react";
import { AiIcon } from "@/components/AiIcon";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

import { DynamicChart } from "@/components/DynamicChart";
import { WelcomeBanner } from "@/components/WelcomeBanner";
import { PageLayout } from "@/components/PageLayout";
import { useListFiles, getListFilesQueryKey } from "@workspace/api-client-react";
import { DataTile } from "@/components/DataTile";
import { DatasetList } from "@/pages/app/datasets";

const THI_STATUS_MAP: Record<string, "normal" | "warning" | "critical"> = {
  normal: "normal",
  alert: "warning",
  warning: "warning",
  critical: "critical",
  severe: "critical",
  danger: "critical",
};

function ThiTile() {
  const { getToken } = useAuth();
  const [data, setData] = useState<{
    thiOutdoor: number;
    thiEffective: number;
    status: string;
    hasCoords: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/thi/current`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {}
    }
    load();
  }, [getToken]);

  if (!data || !data.hasCoords) return null;

  const status = THI_STATUS_MAP[data.status] ?? "normal";
  const effectiveDiff = Math.round(data.thiEffective - data.thiOutdoor);
  const unitSuffix = effectiveDiff < 0 ? ` (Stall ${effectiveDiff})` : "";

  return (
    <DataTile
      label={`THI Hitzestress${unitSuffix}`}
      value={data.thiOutdoor.toFixed(1)}
      source="wetter"
      status={status}
    />
  );
}

function AutoAnalysisBanner({ analysisId, datasetId }: { analysisId: string; datasetId: string }) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    return localStorage.getItem(`auto-banner-dismissed-${datasetId}`) === "1";
  });

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(`auto-banner-dismissed-${datasetId}`, "1");
    setDismissed(true);
  }

  return (
    <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-5 py-3">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <AiIcon size={16} className="text-primary" />
      </div>
      <p className="flex-1 text-sm font-medium text-foreground">
        🤖 Erstanalyse bereit — Dein vollständiger Betriebsspiegel wurde automatisch erstellt.
      </p>
      <Link href={`/app/analyses?datasetId=${datasetId}&analysisId=${analysisId}`}>
        <div className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline shrink-0 cursor-pointer">
          Ansehen
          <ArrowRight className="w-4 h-4" />
        </div>
      </Link>
      <button
        onClick={handleDismiss}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground shrink-0"
        title="Schließen"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

interface NewsPreview {
  id: string;
  title: string;
  topic?: string;
  topicColor?: string;
  scheduledDate?: string;
  appBody?: string;
  teaser?: string | null;
  topicBadges?: string[] | null;
  publishedAt?: string | null;
  batchRunAt?: string | null;
}

const TOPIC_COLORS_OVERVIEW: Record<string, string> = {
  blue:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  green:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  amber:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  rose:   "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  cyan:   "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
};

function NewsPreviewCard({ datasetId }: { datasetId?: string | null }) {
  const { getToken } = useAuth();
  const [edition, setEdition] = useState<NewsPreview | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const authHeaders: Record<string, string> = token
          ? { Authorization: `Bearer ${token}` }
          : {};
        // Try new newsletter endpoint first
        const resp = await fetch(`${API_BASE}/api/news/newsletter/current`, {
          headers: authHeaders,
          credentials: "include",
        });
        if (resp.ok) {
          const data = await resp.json() as NewsPreview | null;
          if (!cancelled) setEdition(data);
          return;
        }
        // Fall back to legacy endpoint
        const legacyResp = await fetch(`${API_BASE}/api/news/latest`, {
          headers: authHeaders,
          credentials: "include",
        });
        if (!legacyResp.ok) { if (!cancelled) setEdition(null); return; }
        const data = await legacyResp.json() as NewsPreview | null;
        if (!cancelled) setEdition(data);
      } catch {
        if (!cancelled) setEdition(null);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [getToken]);

  if (edition === undefined) {
    return <Skeleton className="h-28 rounded-xl" />;
  }

  if (edition === null) {
    return (
      <div className="rounded-xl border border-border bg-card/50 p-4 flex items-center gap-3 text-muted-foreground">
        <Newspaper className="w-4 h-4 shrink-0" />
        <p className="text-sm">Noch keine Nachrichten-Ausgabe verfügbar — der wöchentliche Batch wird sie automatisch erstellen.</p>
      </div>
    );
  }

  // Support both new newsletter schema and legacy schema
  const displayDate = edition.scheduledDate ?? edition.publishedAt ?? null;
  const teaser = edition.appBody
    ? edition.appBody.split(/\n\n/)[0]?.slice(0, 180)
    : (edition.teaser ?? null);
  const topicName = edition.topic ?? null;
  const topicColorKey = edition.topicColor ?? "blue";
  const badgeClass = TOPIC_COLORS_OVERVIEW[topicColorKey] ?? "bg-primary/10 text-primary";

  // Legacy: topicBadges
  const legacyBadges = edition.topicBadges?.filter(Boolean) ?? [];

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Newspaper className="w-4 h-4 text-primary shrink-0" />
          {topicName ? (
            <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${badgeClass}`}>
              {topicName}
            </span>
          ) : (
            legacyBadges.map((badge) => (
              <span
                key={badge}
                className="bg-primary/10 text-primary text-xs font-medium rounded-full px-2.5 py-0.5"
              >
                {badge}
              </span>
            ))
          )}
        </div>
        {displayDate && (
          <span className="text-xs text-muted-foreground shrink-0">
            {new Date(displayDate).toLocaleDateString("de-DE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}
          </span>
        )}
      </div>
      <p className="font-semibold text-base text-foreground leading-snug">{edition.title}</p>
      {teaser && (
        <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">{teaser}</p>
      )}
      <Link href={datasetId ? `/app/nachrichten?datasetId=${datasetId}` : "/app/nachrichten"}>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline cursor-pointer">
          Weiterlesen <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </Link>
    </div>
  );
}

interface InsightsSummaryData {
  text: string;
  reportCount: number;
  generatedAt: string;
}

function InsightsSummaryCard({ datasetId }: { datasetId: string }) {
  const { getToken } = useAuth();
  const [summary, setSummary] = useState<InsightsSummaryData | null | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const resp = await fetch(`${API_BASE}/api/datasets/${datasetId}/insights-summary`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) { setSummary(null); return; }
        const data = await resp.json() as InsightsSummaryData | null;
        if (!cancelled) setSummary(data);
      } catch {
        if (!cancelled) setSummary(null);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [datasetId, getToken]);

  if (summary === undefined) {
    return <Skeleton className="h-24 rounded-xl" />;
  }

  if (!summary || summary.reportCount < 2) return null;

  const formattedDate = new Date(summary.generatedAt).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <button
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <AiIcon size={14} className="text-primary" />
        </div>
        <span className="flex-1 text-sm font-semibold text-foreground">
          Erkenntnisse aus deinen letzten Auswertungen
        </span>
        {collapsed
          ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {!collapsed && (
        <>
          <p className="text-sm text-foreground leading-relaxed">{summary.text}</p>
          <p className="text-xs text-muted-foreground">
            Basierend auf {summary.reportCount} {summary.reportCount === 1 ? "Auswertung" : "Auswertungen"} · zuletzt berechnet {formattedDate}
          </p>
        </>
      )}
    </div>
  );
}

// ── Start-Chips (Top-3 Templates als Pills) ───────────────────────────────────

function StartChipsSection({ datasetId }: { datasetId: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates } = useListTemplates(datasetId, {
    query: {
      queryKey: getListTemplatesQueryKey(datasetId),
      staleTime: 60_000,
    },
  });

  const { data: currentUser } = useGetCurrentUser();

  const runTemplate = useRunTemplate({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId) });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey(datasetId) });
        navigate(`/app/analyses?datasetId=${datasetId}&analysisId=${data.analysisId}`);
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Auswertung konnte nicht gestartet werden." });
      },
    },
  });

  const top3 = filterTemplatesByFocusAreas(templates ?? [], currentUser?.focusAreas).slice(0, 3);

  if (top3.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {top3.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => runTemplate.mutate({ datasetId, templateId: t.id })}
          disabled={runTemplate.isPending}
          className="px-4 py-2 rounded-full border border-border bg-card text-sm font-medium text-foreground hover:border-primary/60 hover:bg-primary/5 hover:text-primary transition-all disabled:opacity-60 whitespace-nowrap"
        >
          {t.title}
        </button>
      ))}
    </div>
  );
}

function SchnellauswertungenSection({ datasetId }: { datasetId: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates, isLoading } = useListTemplates(datasetId, {
    query: {
      queryKey: getListTemplatesQueryKey(datasetId),
      staleTime: 60_000,
    },
  });

  const { data: currentUser } = useGetCurrentUser();

  const runTemplate = useRunTemplate({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId) });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey(datasetId) });
        navigate(`/app/analyses?datasetId=${datasetId}&analysisId=${data.analysisId}`);
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Vorlage konnte nicht gestartet werden.",
        });
      },
    },
  });

  const filtered = filterTemplatesByFocusAreas(templates ?? [], currentUser?.focusAreas);
  const top4 = filtered.slice(0, 4);

  if (isLoading || top4.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Schnellauswertungen</h2>
        <Link href={`/app/analyses?datasetId=${datasetId}`}>
          <span className="text-sm text-primary hover:underline flex items-center gap-1">
            Alle ansehen <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {top4.map((t) => (
          <button
            key={t.id}
            onClick={() => runTemplate.mutate({ datasetId, templateId: t.id })}
            disabled={runTemplate.isPending}
            className="group text-left p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-60"
          >
            <div className="flex items-start gap-2.5">
              <span className="text-xl leading-none mt-0.5 shrink-0">{t.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-foreground group-hover:text-primary transition-colors truncate">
                  {t.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {t.shortDescription}
                </p>
              </div>
              {runTemplate.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0 mt-0.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Semen Planning Summary Card ───────────────────────────────────────────────

interface SemenPlanningInputs {
  summeKuehe: number;
  konzRateKuehe: number;
  konzRateFaersen: number;
  prozentAbgaenge: number;
  eka: number;
  anteilHoGesext: number;
  anteilHoKonv: number;
  anteilBeefGesext: number;
  anteilBeefKonv: number;
  preisHoGesext: number;
  preisHoKonv: number;
  preisBeefGesext: number;
  preisBeefKonv: number;
  verkaufspreisHoBullkalb: number;
  verkaufspreisBeefWeiblich: number;
  verkaufspreisBeefBullkalb: number;
}

interface SemenPlanningOutputs {
  besamungen: { portionen: { gesamt: number } };
  faersenbalance: { faersenBalance: number; moeglAbgangsratePct: number };
  nettokosten: number;
  nettokostenProKuhJahr: number;
  sexingMehrpreisProKuhMonat: number;
}

interface SemenPlanningData {
  found: boolean;
  inputs?: SemenPlanningInputs;
  outputs?: SemenPlanningOutputs;
  updatedAt?: string;
}

function SemenPlanningCard({ datasetId }: { datasetId: string }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<SemenPlanningData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const resp = await fetch(`${API_BASE}/api/datasets/${datasetId}/semen-planning`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!resp.ok) { if (!cancelled) setData(null); return; }
        const json = await resp.json() as SemenPlanningData;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData(null);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [datasetId, getToken]);

  if (data === undefined) return null;
  if (!data || !data.found || !data.inputs || !data.outputs) return null;

  const inp = data.inputs;
  const out = data.outputs;

  const fmt = (n: number, decimals = 0) =>
    n.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const fmtEur = (n: number) =>
    n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const updatedLabel = data.updatedAt
    ? new Date(data.updatedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  const editHref = `/app/analyses?datasetId=${datasetId}`;

  const faersenBalanceColor =
    out.faersenbalance.faersenBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FlaskConical className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground">Spermaplanung</span>
          {updatedLabel && (
            <span className="text-xs text-muted-foreground hidden sm:inline">· Stand {updatedLabel}</span>
          )}
        </div>
        <Link href={editHref}>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer">
            <Pencil className="w-3.5 h-3.5" />
            Bearbeiten
          </span>
        </Link>
      </div>

      {/* Key inputs grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">Herdengröße</p>
          <p className="text-sm font-semibold text-foreground">{fmt(inp.summeKuehe)} Kühe</p>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">Konzeptionsrate</p>
          <p className="text-sm font-semibold text-foreground">
            {fmt(inp.konzRateKuehe)} % / {fmt(inp.konzRateFaersen)} %
          </p>
          <p className="text-xs text-muted-foreground">Kühe / Färsen</p>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">HO gesext / konv.</p>
          <p className="text-sm font-semibold text-foreground">
            {fmt(inp.anteilHoGesext)} % / {fmt(inp.anteilHoKonv)} %
          </p>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">Beef gesext / konv.</p>
          <p className="text-sm font-semibold text-foreground">
            {fmt(inp.anteilBeefGesext)} % / {fmt(inp.anteilBeefKonv)} %
          </p>
        </div>
      </div>

      {/* Key results row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
          <p className="text-xs text-muted-foreground">Portionen/Jahr</p>
          <p className="text-sm font-semibold text-foreground">{fmt(out.besamungen.portionen.gesamt)}</p>
        </div>
        <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
          <p className="text-xs text-muted-foreground">Färsenbilanz</p>
          <p className={`text-sm font-semibold ${faersenBalanceColor}`}>
            {out.faersenbalance.faersenBalance >= 0 ? "+" : ""}{fmt(out.faersenbalance.faersenBalance)}
          </p>
        </div>
        <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
          <p className="text-xs text-muted-foreground">Nettokosten</p>
          <p className="text-sm font-semibold text-foreground">{fmtEur(out.nettokosten)}</p>
        </div>
        <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
          <p className="text-xs text-muted-foreground">Netto / Kuh / Jahr</p>
          <p className="text-sm font-semibold text-foreground">{fmtEur(out.nettokostenProKuhJahr)}</p>
        </div>
      </div>

      {updatedLabel && (
        <p className="text-xs text-muted-foreground sm:hidden">Stand: {updatedLabel}</p>
      )}
    </div>
  );
}

export function DatasetOverview() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const datasetId = searchParams.get("datasetId") || null;
  const hostId = searchParams.get("hostId") || null;

  const { data: currentUser } = useGetCurrentUser();
  const { data: files } = useListFiles(datasetId!, {
    query: { enabled: !!datasetId, queryKey: getListFilesQueryKey(datasetId!) },
  });

  const { data: overview, isLoading } = useGetDatasetOverview(datasetId!, {
    query: { enabled: !!datasetId, queryKey: getGetDatasetOverviewQueryKey(datasetId!) }
  });

  const { data: analyses } = useListAnalyses(datasetId!, {
    query: {
      enabled: !!datasetId,
      queryKey: getListAnalysesQueryKey(datasetId!),
      staleTime: 30_000,
    },
  });

  const { data: reports } = useListReports(
    datasetId ?? "",
    { query: { enabled: !!datasetId, queryKey: getListReportsQueryKey(datasetId ?? "") } }
  );

  const autoAnalysis = analyses?.find((a) => a.source === "auto" && a.templateRef === "auto_erstanalyse");

  // State A: no dataset selected — show dataset picker
  if (!datasetId) {
    return (
      <PageLayout size="wide">
        <DatasetList />
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Aktuelle Nachrichten</h2>
          <NewsPreviewCard datasetId={null} />
        </div>
      </PageLayout>
    );
  }

  // State B: dataset selected — show dashboard
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!overview) return <div>Keine Daten verfügbar.</div>;

  return (
    <PageLayout size="wide">
      {(currentUser as any)?.onboardingCompletedAt == null && (
        <WelcomeBanner datasetId={datasetId} />
      )}
      {autoAnalysis && files && files.length > 0 && (
        <AutoAnalysisBanner analysisId={autoAnalysis.id} datasetId={datasetId} />
      )}

      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-foreground">Start</h1>
        <div className="flex items-center gap-3">
          {overview.warningCount > 0 && (
            <div className="flex items-center text-destructive bg-destructive/10 px-4 py-2 rounded-lg font-medium">
              <AlertTriangle className="w-5 h-5 mr-2" />
              {overview.warningCount} offene Warnungen
            </div>
          )}
          <button
            onClick={() => setLocation(hostId ? `/app/overview?hostId=${hostId}` : '/app/overview')}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground bg-secondary hover:bg-secondary/80 hover:text-foreground border border-border px-3 py-1.5 rounded-lg transition-colors"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Betrieb wechseln
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {overview.kpis.map((kpi) => (
          <DataTile
            key={kpi.key}
            label={kpi.label}
            value={kpi.value !== null ? kpi.value.toLocaleString('de-DE') : '–'}
            unit={kpi.unit ?? undefined}
            trend={
              kpi.trend === 'up' ? 'up' :
              kpi.trend === 'down' ? 'down' :
              kpi.trend === 'flat' ? 'neutral' :
              undefined
            }
            source="betrieb"
            basis={kpi.basis ?? undefined}
          />
        ))}
        <ThiTile />
      </div>

      {datasetId && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link href={`/app/upload?datasetId=${datasetId}`}>
            <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Upload className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground">Dateien &amp; Upload</p>
                <p className="text-xs text-muted-foreground mt-0.5">{files?.length ?? 0} hochgeladene {(files?.length ?? 0) === 1 ? "Datei" : "Dateien"}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
          </Link>

          <Link href={`/app/warnings?datasetId=${datasetId}`}>
            <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${overview.warningCount > 0 ? "bg-destructive/10" : "bg-primary/10"}`}>
                <AlertTriangle className={`w-5 h-5 ${overview.warningCount > 0 ? "text-destructive" : "text-primary"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground">Warnungen</p>
                <p className={`text-xs mt-0.5 ${overview.warningCount > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {overview.warningCount} offene {overview.warningCount === 1 ? "Warnung" : "Warnungen"}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
          </Link>

          <Link href={`/app/reports?datasetId=${datasetId}`}>
            <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground">Berichte</p>
                <p className="text-xs text-muted-foreground mt-0.5">{reports?.length ?? 0} {(reports?.length ?? 0) === 1 ? "Bericht" : "Berichte"}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
          </Link>
        </div>
      )}

      <SemenPlanningCard datasetId={datasetId} />

      <StartChipsSection datasetId={datasetId} />
      <SchnellauswertungenSection datasetId={datasetId} />

      <NewsPreviewCard datasetId={datasetId} />
      <InsightsSummaryCard datasetId={datasetId} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {overview.charts.map((chart) => (
          <Card key={chart.id} className="flex flex-col">
            <CardHeader className="pb-2 shrink-0">
              <CardTitle>{chart.title}</CardTitle>
              {chart.description && <CardDescription>{chart.description}</CardDescription>}
            </CardHeader>
            <CardContent className="flex-1 min-h-[300px] pt-4">
              <DynamicChart chart={chart as any} />
            </CardContent>
          </Card>
        ))}
      </div>
    </PageLayout>
  );
}
