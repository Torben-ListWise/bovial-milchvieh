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
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  UploadCloud, AlertCircle, CheckCircle, Clock, Trash2,
  FileText, FileSpreadsheet, Sheet, Plus, RefreshCw, X, Info,
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

const IN_PROGRESS_STATUSES = ["uploaded", "parsing", "mapping", "processing"] as const;
type InProgressStatus = typeof IN_PROGRESS_STATUSES[number];

function isInProgress(status: string): status is InProgressStatus {
  return (IN_PROGRESS_STATUSES as readonly string[]).includes(status);
}

function fileKindIcon(contentType?: string | null, name?: string) {
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

const BETRIEBSSPIEGEL_QUESTION =
  "Erstelle einen vollständigen Betriebsspiegel: Milchleistung, Zellzahl-Trend, Fruchtbarkeit, Fütterungseffizienz, Ausreißer und Top-3 Handlungsempfehlungen.";

export function UploadPage() {
  const { datasetId, isLoading: datasetLoading } = useRequireDataset();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isFirstUploadDone, setIsFirstUploadDone] = useState(false);
  const requestUrl = useRequestUploadUrl();
  const registerFile = useRegisterFile();
  const deleteFile = useDeleteFile();
  const [isUploading, setIsUploading] = useState(false);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [showBetriebsspiegelOffer, setShowBetriebsspiegelOffer] = useState(false);

  const prevReadyIdsRef = useRef<Set<string>>(new Set());
  const offerShownRef = useRef(false);

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
        const analysesHref = datasetId
          ? `/app/analyses?datasetId=${datasetId}`
          : "/app/analyses";
        toast({
          title: "🎉 Deine erste Datei ist da!",
          description: "Die Analyse läuft bereits im Hintergrund.",
          duration: 8000,
          action: (
            <ToastAction
              altText="Zur Analyse"
              onClick={() => navigate(analysesHref)}
            >
              Zur Analyse →
            </ToastAction>
          ),
        });
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        // Also auto-navigate after a brief pause so the farmer sees the analysis running
        setTimeout(() => navigate(analysesHref), 2000);
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
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Dateien & Upload</h1>
        <p className="text-muted-foreground mt-1 text-sm md:text-base">Lade deine Herdenmanagement-Exporte (Excel, CSV, PDF) hier hoch.</p>
      </div>

      {!hasFiles && (
        <Card className="border-dashed bg-secondary/10">
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

            <label className="relative cursor-pointer mb-4">
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
              <span>Nach dem Upload erstellt der Assistent automatisch einen Betriebsspiegel.</span>
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
            {files.map(f => (
              <Card key={f.id} className="hover:border-primary/50 transition-colors group">
                <CardContent className="p-3 md:p-4 flex items-center gap-3 md:gap-4">
                  <div className="shrink-0">{fileKindIcon(f.contentType, f.name)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate text-sm md:text-base">{f.name}</p>
                    <div className="flex flex-wrap gap-2 md:gap-4 text-xs text-muted-foreground mt-0.5">
                      <span>{format(new Date(f.createdAt), "dd.MM.yyyy HH:mm", { locale: de })}</span>
                      {f.size ? <span>{(f.size / 1024 / 1024).toFixed(2)} MB</span> : null}
                      {f.rowCount ? <span>{f.rowCount.toLocaleString("de-DE")} Zeilen</span> : null}
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
                </CardContent>
              </Card>
            ))}
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
    </div>
  );
}
