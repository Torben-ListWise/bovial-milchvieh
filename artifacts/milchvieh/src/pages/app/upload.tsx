import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListFiles,
  getListFilesQueryKey,
  useRequestUploadUrl,
  useRegisterFile,
  useDeleteFile,
  useListAnalyses,
  getListAnalysesQueryKey,
  useCreateAnalysis,
  useGetDatasetOverview,
  getGetDatasetOverviewQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  UploadCloud, AlertCircle, CheckCircle, Clock, Trash2,
  FileText, FileSpreadsheet, Sheet, Plus, RefreshCw, X, Info, Activity,
  Sparkles, ArrowRight, Loader2, AlertTriangle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useRequireDataset } from "@/hooks/use-require-dataset";
import { getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { DataTile } from "@/components/DataTile";
import { AiIcon } from "@/components/AiIcon";

const IN_PROGRESS_STATUSES = ["uploaded", "parsing", "mapping", "processing"] as const;
type InProgressStatus = typeof IN_PROGRESS_STATUSES[number];

function isInProgress(status: string): status is InProgressStatus {
  return (IN_PROGRESS_STATUSES as readonly string[]).includes(status);
}

function fileKindIcon(contentType?: string | null, name?: string, kind?: string | null) {
  if (kind === "livestock_events") return <Activity className="w-8 h-8 text-violet-500" />;
  const lower = (name ?? "").toLowerCase();
  if (lower.endsWith(".pdf")) return <FileText className="w-8 h-8 text-red-400" />;
  if (lower.endsWith(".csv")) return <FileSpreadsheet className="w-8 h-8 text-green-500" />;
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".ods"))
    return <FileSpreadsheet className="w-8 h-8 text-emerald-600" />;
  if (contentType?.includes("pdf")) return <FileText className="w-8 h-8 text-red-400" />;
  if (contentType?.includes("csv") || contentType?.includes("excel") || contentType?.includes("spreadsheet"))
    return <FileSpreadsheet className="w-8 h-8 text-emerald-600" />;
  return <Sheet className="w-8 h-8 text-primary/60" />;
}

interface EventSummary {
  inserted: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  topEvents: { type: string; count: number }[];
  dateRange: { from: string; to: string } | null;
  animals: number;
}

function EventSummaryCard({ summary }: { summary: EventSummary }) {
  return (
    <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-800">
        <Activity className="w-3.5 h-3.5" />
        Herdenereignisse importiert
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-white rounded-md border border-violet-100 px-2 py-1.5 text-center">
          <div className="font-bold text-violet-900 text-base leading-tight">{summary.inserted.toLocaleString("de-DE")}</div>
          <div className="text-violet-600 text-[10px] mt-0.5">Events</div>
        </div>
        <div className="bg-white rounded-md border border-violet-100 px-2 py-1.5 text-center">
          <div className="font-bold text-violet-900 text-base leading-tight">{summary.animals.toLocaleString("de-DE")}</div>
          <div className="text-violet-600 text-[10px] mt-0.5">Tiere</div>
        </div>
        <div className="bg-white rounded-md border border-violet-100 px-2 py-1.5 text-center">
          <div className="font-bold text-violet-900 text-base leading-tight">{summary.topEvents.length}</div>
          <div className="text-violet-600 text-[10px] mt-0.5">Typen</div>
        </div>
      </div>
      {summary.dateRange && (
        <p className="text-[10px] text-violet-600">
          Zeitraum: {summary.dateRange.from} – {summary.dateRange.to}
        </p>
      )}
      {summary.topEvents.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {summary.topEvents.slice(0, 6).map((e) => (
            <span key={e.type} className="inline-flex items-center gap-1 text-[10px] bg-violet-100 text-violet-800 px-1.5 py-0.5 rounded">
              <span className="font-semibold">{e.type}</span>
              <span className="text-violet-500">{e.count.toLocaleString("de-DE")}</span>
            </span>
          ))}
        </div>
      )}
      {summary.skippedDuplicates > 0 && (
        <p className="text-[10px] text-violet-500">{summary.skippedDuplicates.toLocaleString("de-DE")} Duplikate übersprungen</p>
      )}
    </div>
  );
}

const BETRIEBSSPIEGEL_QUESTION =
  "Erstelle einen vollständigen Betriebsspiegel: Milchleistung, Zellzahl-Trend, Fruchtbarkeit, Fütterungseffizienz, Ausreißer und Top-3 Handlungsempfehlungen.";

import { PageLayout } from "@/components/PageLayout";

function ProcessingStep({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {done ? (
        <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
      ) : active ? (
        <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
      ) : (
        <Clock className="w-4 h-4 text-muted-foreground/30 shrink-0" />
      )}
      <span className={done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground/40"}>
        {label}
      </span>
    </div>
  );
}

function FirstInsightsPanel({
  datasetId,
  files,
  analysesList,
  overviewData,
  onNavigate,
}: {
  datasetId: string;
  files: { id: string; status: string }[] | undefined;
  analysesList: { id: string; source?: string | null; templateRef?: string | null }[] | undefined;
  overviewData: { kpis: { key: string; label: string; value: number | null; unit?: string | null; trend?: string | null; basis?: string | null }[]; warningCount: number } | undefined;
  onNavigate: (href: string) => void;
}) {
  const hasReadyFile = files?.some((f) => f.status === "ready") ?? false;
  const isFileProcessing = files?.some((f) => isInProgress(f.status as never)) ?? false;
  const autoAnalysis = analysesList?.find(
    (a) => (a as any).templateRef === "auto_erstanalyse" || a.source === "auto"
  );
  const kpis = overviewData?.kpis ?? [];
  const hasKpis = kpis.length > 0;
  const isDone = hasReadyFile && hasKpis;

  const analysesHref = autoAnalysis
    ? `/app/analyses?datasetId=${datasetId}&analysisId=${autoAnalysis.id}`
    : `/app/analyses?datasetId=${datasetId}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isDone ? "bg-primary/10" : "bg-muted"}`}>
          {isDone
            ? <Sparkles className="w-5 h-5 text-primary" />
            : <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />}
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">
            {isDone ? "Erste Erkenntnisse zu deinem Betrieb" : "Wird analysiert…"}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isDone
              ? "Die wichtigsten Kennzahlen aus deiner Datei auf einen Blick."
              : "Das dauert meist weniger als eine Minute — bleib kurz hier."}
          </p>
        </div>
      </div>

      {!isDone && (
        <div className="space-y-3 pl-14">
          <ProcessingStep label="Datei hochgeladen" done />
          <ProcessingStep
            label="Daten werden verarbeitet"
            done={hasReadyFile && !isFileProcessing}
            active={isFileProcessing}
          />
          <ProcessingStep
            label="Kennzahlen werden berechnet"
            done={hasKpis}
            active={hasReadyFile && !isFileProcessing && !hasKpis}
          />
        </div>
      )}

      {isDone && overviewData && overviewData.warningCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900 text-sm">
              {overviewData.warningCount} {overviewData.warningCount === 1 ? "Auffälligkeit" : "Auffälligkeiten"} erkannt
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Der Plausibilitätscheck hat Abweichungen in deinen Betriebsdaten gefunden. Die vollständige Analyse zeigt Details.
            </p>
          </div>
        </div>
      )}

      {isDone && kpis.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.slice(0, 4).map((kpi) => (
            <DataTile
              key={kpi.key}
              label={kpi.label}
              value={kpi.value !== null ? kpi.value.toLocaleString("de-DE") : "–"}
              unit={kpi.unit ?? undefined}
              trend={
                kpi.trend === "up" ? "up" :
                kpi.trend === "down" ? "down" :
                kpi.trend === "flat" ? "neutral" :
                undefined
              }
              source="betrieb"
              basis={kpi.basis ?? undefined}
            />
          ))}
        </div>
      )}

      {isDone && (
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={() => onNavigate(analysesHref)}
            className="gap-2 sm:flex-none"
          >
            <AiIcon size={16} />
            Vollständige Analyse ansehen
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => onNavigate(`/app/overview?datasetId=${datasetId}`)}
            className="gap-2"
          >
            Zur Startseite
          </Button>
        </div>
      )}
    </div>
  );
}

export function UploadPage() {
  const { datasetId, isLoading: datasetLoading } = useRequireDataset();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isFirstUploadDone, setIsFirstUploadDone] = useState(false);
  const [overviewEnabled, setOverviewEnabled] = useState(false);
  const requestUrl = useRequestUploadUrl();
  const registerFile = useRegisterFile();
  const deleteFile = useDeleteFile();
  const [isUploading, setIsUploading] = useState(false);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [showBetriebsspiegelOffer, setShowBetriebsspiegelOffer] = useState(false);

  const prevReadyIdsRef = useRef<Set<string>>(new Set());
  const offerShownRef = useRef(false);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (navigateTimerRef.current !== null) {
        clearTimeout(navigateTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isUploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Upload läuft noch — Seite wirklich verlassen?";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isUploading]);

  const { data: files, isLoading } = useListFiles(
    datasetId ?? "",
    {
      query: {
        enabled: !!datasetId,
        queryKey: getListFilesQueryKey(datasetId ?? ""),
        refetchInterval: (query) => {
          const data = query.state.data as typeof files;
          if (!data) return 3000;
          const hasProcessing = data.some((f) => isInProgress(f.status));
          return hasProcessing ? 3000 : false;
        },
      },
    }
  );

  const { data: analysesList } = useListAnalyses(datasetId ?? "", {
    query: {
      enabled: !!datasetId,
      queryKey: getListAnalysesQueryKey(datasetId ?? ""),
    },
  });

  const { data: overviewData } = useGetDatasetOverview(datasetId ?? "", {
    query: {
      enabled: overviewEnabled && !!datasetId,
      queryKey: getGetDatasetOverviewQueryKey(datasetId ?? ""),
      refetchInterval: overviewEnabled ? 3000 : false,
    },
  });

  const createAnalysis = useCreateAnalysis({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId ?? "") });
        setShowBetriebsspiegelOffer(false);
        navigate(`/app/analyses?analysisId=${data.id}`);
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Analyse konnte nicht gestartet werden.",
        });
      },
    },
  });

  const autoAnalysis = analysesList?.find(
    (a) => (a as any).templateRef === "auto_erstanalyse" || a.source === "auto"
  );

  useEffect(() => {
    if (!files || offerShownRef.current) return;
    const currentReadyIds = new Set(files.filter((f) => f.status === "ready").map((f) => f.id));
    const newlyReady = [...currentReadyIds].filter((id) => !prevReadyIdsRef.current.has(id));

    if (newlyReady.length > 0 && prevReadyIdsRef.current.size > 0 && autoAnalysis) {
      offerShownRef.current = true;
      setShowBetriebsspiegelOffer(true);
    }

    prevReadyIdsRef.current = currentReadyIds;
  }, [files, autoAnalysis]);

  useEffect(() => {
    if (!isFirstUploadDone || !datasetId || overviewEnabled) return;
    const hasReady = files?.some((f) => f.status === "ready");
    if (hasReady) setOverviewEnabled(true);
  }, [files, isFirstUploadDone, datasetId, overviewEnabled]);

  if (datasetLoading || !datasetId) {
    return <div className="h-32 flex items-center justify-center text-muted-foreground">Laden…</div>;
  }

  const handleDelete = (fileId: string) => {
    deleteFile.mutate(
      { fileId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(datasetId) });
          toast({ title: "Datei gelöscht" });
          setDeleteFileId(null);
        },
        onError: () => {
          toast({ variant: "destructive", title: "Fehler", description: "Datei konnte nicht gelöscht werden." });
          setDeleteFileId(null);
        },
      }
    );
  };

  const MAX_FILE_SIZE_MB = 50;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Datei zu groß",
        description: `Maximale Dateigröße: ${MAX_FILE_SIZE_MB} MB. Deine Datei hat ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      });
      if (e.target) e.target.value = "";
      return;
    }

    const wasFirstFile = !files || files.length === 0;

    setIsUploading(true);
    offerShownRef.current = false;
    setShowBetriebsspiegelOffer(false);
    try {
      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream"
        }
      });

      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });

      if (!uploadRes.ok) throw new Error("Upload fehlgeschlagen");

      const registered = await registerFile.mutateAsync({
        datasetId,
        data: {
          objectPath,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }
      });

      const isFirstFile = wasFirstFile || (registered as any).isFirstFile;

      if (isFirstFile) {
        setIsFirstUploadDone(true);
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        // Stay on page — FirstInsightsPanel will reveal KPIs once data is ready
      } else {
        toast({ title: "Datei hochgeladen", description: "Die Datei wird nun verarbeitet…" });
      }

      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(datasetId) });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Fehler", description: "Beim Upload ist ein Fehler aufgetreten." });
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleBetriebsspiegelRerun = () => {
    if (!datasetId) return;
    createAnalysis.mutate({
      datasetId,
      data: {
        title: "Betriebsspiegel (aktualisiert)",
        question: BETRIEBSSPIEGEL_QUESTION,
      },
    });
  };

  const hasFiles = !!(files && files.length > 0);
  const hasProcessingFiles = !!(files?.some((f) => isInProgress(f.status)));

  return (
    <PageLayout size="standard">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Dateien & Upload</h1>
        <p className="text-muted-foreground mt-1 text-sm md:text-base">Lade deine Herdenmanagement-Exporte (Excel, CSV, PDF) hier hoch.</p>
      </div>

      {isFirstUploadDone && (
        <Card>
          <CardContent className="py-8 px-6">
            <FirstInsightsPanel
              datasetId={datasetId}
              files={files as { id: string; status: string }[] | undefined}
              analysesList={analysesList as { id: string; source?: string | null; templateRef?: string | null }[] | undefined}
              overviewData={overviewData as { kpis: { key: string; label: string; value: number | null; unit?: string | null; trend?: string | null; basis?: string | null }[]; warningCount: number } | undefined}
              onNavigate={navigate}
            />
          </CardContent>
        </Card>
      )}

      {!hasFiles && !isFirstUploadDone && (
        <Card className="border-dashed bg-secondary/10 upload-pulse-border">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <UploadCloud className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Datei auswählen oder hierher ziehen</h3>
            <p className="text-muted-foreground mb-5">Lade deinen ersten Herdenmanagement-Export hoch, um mit der Analyse zu starten.</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 text-left w-full max-w-xl">
              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">MLP-Excel</p>
                  <p className="text-xs text-muted-foreground mt-0.5">z.&nbsp;B. <span className="font-mono">MLP_Export_2024.xlsx</span></p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">Monatliche Milchleistungsdaten</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3">
                <FileSpreadsheet className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">CSV-Export</p>
                  <p className="text-xs text-muted-foreground mt-0.5">z.&nbsp;B. <span className="font-mono">herde_export.csv</span></p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">Herdenmanagement-System</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3">
                <FileText className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">PDF-Bericht</p>
                  <p className="text-xs text-muted-foreground mt-0.5">z.&nbsp;B. <span className="font-mono">monatsbericht.pdf</span></p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">Monatliche Berichte vom LKV</p>
                </div>
              </div>
            </div>

            <div className="w-full max-w-xl mb-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5 text-center">Was passiert mit deinen Betriebsdaten?</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
                  <span className="text-base shrink-0 mt-0.5">📊</span>
                  <div>
                    <p className="text-xs font-semibold text-foreground leading-tight">Betriebsspiegel</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">Milchleistung, Zellzahl & Fruchtbarkeit — automatisch ausgewertet</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
                  <span className="text-base shrink-0 mt-0.5">💬</span>
                  <div>
                    <p className="text-xs font-semibold text-foreground leading-tight">KI-Fragen auf Deutsch</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">„Welche Kühe haben die höchste Zellzahl?" — einfach fragen</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
                  <span className="text-base shrink-0 mt-0.5">💉</span>
                  <div>
                    <p className="text-xs font-semibold text-foreground leading-tight">Sperma-Kalkulator</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">Herdengröße & Konzeptionsrate werden automatisch befüllt</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
                  <span className="text-base shrink-0 mt-0.5">⚠️</span>
                  <div>
                    <p className="text-xs font-semibold text-foreground leading-tight">Gesundheitswarnungen</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">Auffälligkeiten in Zellzahl & Fruchtbarkeit sofort erkannt</p>
                  </div>
                </div>
              </div>
            </div>

            <label className="relative cursor-pointer mb-3">
              <Button disabled={isUploading} asChild>
                <span className="min-h-[44px] min-w-[160px] flex items-center justify-center">
                  <UploadCloud className="w-4 h-4 mr-2" />
                  {isUploading ? 'Wird hochgeladen...' : 'Datei auswählen'}
                </span>
              </Button>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.ods,.pdf"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileSelect}
                disabled={isUploading}
              />
            </label>

            <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Deine Daten bleiben privat und werden nur für deine Auswertungen verwendet.</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-2">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg md:text-xl font-bold">Deine Dateien</h3>
          {hasFiles && (
            <label className="relative cursor-pointer">
              <Button disabled={isUploading} asChild>
                <span className="gap-2 min-h-[44px] flex items-center px-4">
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">{isUploading ? 'Wird hochgeladen...' : 'Weitere Datei'}</span>
                  <span className="sm:hidden">{isUploading ? '…' : 'Hinzufügen'}</span>
                </span>
              </Button>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.ods,.pdf"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileSelect}
                disabled={isUploading}
              />
            </label>
          )}
        </div>

        {showBetriebsspiegelOffer && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
            <RefreshCw className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-amber-900 text-sm">Neue Daten bereit</p>
              <p className="text-amber-700 text-xs mt-0.5">
                Betriebsspiegel mit den neuen Daten aktualisieren?
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={handleBetriebsspiegelRerun}
                disabled={createAnalysis.isPending}
                className="text-xs h-7 px-3"
              >
                {createAnalysis.isPending ? 'Wird gestartet…' : 'Jetzt aktualisieren'}
              </Button>
              <button
                onClick={() => setShowBetriebsspiegelOffer(false)}
                className="p-0.5 rounded hover:bg-amber-200 text-amber-500 hover:text-amber-700 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            <div className="h-20 bg-muted animate-pulse rounded-lg" />
            <div className="h-20 bg-muted animate-pulse rounded-lg" />
          </div>
        ) : !files || files.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <div className="text-center py-8 text-muted-foreground">
                Noch keine Dateien hochgeladen.
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {hasProcessingFiles && (
              <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
                <Clock className="w-4 h-4 animate-pulse shrink-0" />
                <span>Dateien werden verarbeitet — die Liste aktualisiert sich automatisch.</span>
              </div>
            )}
            {files.map(f => {
              const fileKind = (f as any).kind as string | null;
              const previewRows = ((f as any).previewRows ?? []) as { eventSummary?: EventSummary }[];
              const eventSummary = fileKind === "livestock_events" ? previewRows[0]?.eventSummary : undefined;
              return (
              <Card key={f.id} className="hover:border-primary/50 transition-colors group">
                <CardContent className="p-3 md:p-4 flex flex-col gap-1">
                  <div className="flex items-center gap-3 md:gap-4">
                  <div className="shrink-0">{fileKindIcon(f.contentType, f.name, fileKind)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate text-sm md:text-base">{f.name}</p>
                    <div className="flex flex-wrap gap-2 md:gap-4 text-xs text-muted-foreground mt-0.5">
                      <span>{format(new Date(f.createdAt), "dd.MM.yyyy HH:mm", { locale: de })}</span>
                      {f.size ? <span>{(f.size / 1024 / 1024).toFixed(2)} MB</span> : null}
                      {fileKind === "livestock_events"
                        ? <span className="text-violet-600 font-medium">Event-CSV</span>
                        : f.rowCount ? <span>{f.rowCount.toLocaleString("de-DE")} Zeilen</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 md:gap-3 shrink-0">
                    {f.status === 'ready' && (
                      <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        <span className="hidden sm:inline">Bereit</span>
                      </span>
                    )}
                    {f.status === 'error' && (
                      <span
                        className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded flex items-center gap-1 cursor-help"
                        title={(f as any).errorMessage ?? "Verarbeitungsfehler — bitte eine andere Datei versuchen."}
                      >
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span className="hidden sm:inline max-w-[180px] truncate">
                          {(f as any).errorMessage ? (f as any).errorMessage : "Verarbeitungsfehler"}
                        </span>
                      </span>
                    )}
                    {f.status === 'needs_mapping' && (
                      <span className="bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span className="hidden sm:inline">Spalten prüfen</span>
                      </span>
                    )}
                    {isInProgress(f.status) && (
                      <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded flex items-center gap-1">
                        <Clock className="w-3 h-3 animate-pulse" />
                        <span className="hidden sm:inline">Verarbeitung…</span>
                      </span>
                    )}
                    <button
                      className="flex items-center justify-center w-11 h-11 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                      onClick={() => setDeleteFileId(f.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  </div>
                  {eventSummary && <EventSummaryCard summary={eventSummary} />}
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteFileId} onOpenChange={(open) => { if (!open) setDeleteFileId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Datei löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Datei und alle daraus verarbeiteten Datensätze werden unwiderruflich entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteFile.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteFile.isPending}
              onClick={() => deleteFileId && handleDelete(deleteFileId)}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}
