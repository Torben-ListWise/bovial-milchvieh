import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
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
import { AlertTriangle, TrendingUp, TrendingDown, Minus, X, ArrowRight, ChevronRight, Loader2, Newspaper, ChevronDown, ChevronUp } from "lucide-react";
import { AiIcon } from "@/components/AiIcon";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

import { DynamicChart } from "@/components/DynamicChart";
import { useRequireDataset } from "@/hooks/use-require-dataset";
import { WelcomeBanner } from "@/components/WelcomeBanner";
import { PageLayout } from "@/components/PageLayout";
import { useListFiles, getListFilesQueryKey } from "@workspace/api-client-react";

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

function NewsPreviewCard() {
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
      <Link href="/app/nachrichten">
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

export function DatasetOverview() {
  const { datasetId, isLoading: datasetLoading } = useRequireDataset();
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

  const autoAnalysis = analyses?.find((a) => a.source === "auto" && a.templateRef === "auto_erstanalyse");

  if (datasetLoading || !datasetId) {
    return <div className="h-32 flex items-center justify-center text-muted-foreground">Laden…</div>;
  }

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
        <h1 className="text-3xl font-bold text-foreground">Übersicht</h1>
        {overview.warningCount > 0 && (
          <div className="flex items-center text-destructive bg-destructive/10 px-4 py-2 rounded-lg font-medium">
            <AlertTriangle className="w-5 h-5 mr-2" />
            {overview.warningCount} offene Warnungen
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {overview.kpis.map((kpi) => (
          <Card key={kpi.key} className="bg-gradient-to-b from-card to-muted/20">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-muted-foreground">{kpi.label}</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold">
                  {kpi.value !== null ? kpi.value.toLocaleString('de-DE') : '-'}
                  {kpi.unit ? ` ${kpi.unit}` : ''}
                </span>
              </div>
              {kpi.deltaPct !== null && kpi.deltaPct !== undefined && (
                <div className="mt-2">
                  {kpi.trend === 'up' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                      <TrendingUp className="w-3 h-3" />
                      +{Math.abs(kpi.deltaPct).toLocaleString('de-DE')}%
                    </span>
                  )}
                  {kpi.trend === 'down' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                      <TrendingDown className="w-3 h-3" />
                      -{Math.abs(kpi.deltaPct).toLocaleString('de-DE')}%
                    </span>
                  )}
                  {kpi.trend === 'flat' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                      <Minus className="w-3 h-3" />
                      {Math.abs(kpi.deltaPct).toLocaleString('de-DE')}%
                    </span>
                  )}
                </div>
              )}
              {kpi.basis && <p className="mt-1 text-xs text-muted-foreground">Basis: {kpi.basis}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <SchnellauswertungenSection datasetId={datasetId} />

      <NewsPreviewCard />
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
