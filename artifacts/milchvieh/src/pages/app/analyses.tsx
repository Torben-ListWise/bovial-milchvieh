import { useState, useRef, useEffect, memo, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Link, useSearch } from "wouter";
import {
  getListAnalysesQueryKey,
  useListAnalyses,
  useCreateAnalysis,
  useUpdateAnalysis,
  useDeleteAnalysis,
  useGetAnalysis,
  getGetAnalysisQueryKey,
  useAskQuestion,
  useListFiles,
  getListFilesQueryKey,
  useListTemplates,
  getListTemplatesQueryKey,
  useRunTemplate,
  useRequestUploadUrl,
  useRegisterFile,
  useDeleteFile,
  useGetFile,
  useGetCurrentUser,
  type AnalysisDetail,
  type Analysis,
  type AnalysisTemplate,
  type Chart,
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
import { useRequireDataset } from "@/hooks/use-require-dataset";
import { type AnalysisMessage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { DynamicChart } from "@/components/DynamicChart";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { useAnalysisStream, useStreamingState } from "@/hooks/use-analysis-stream";
import { AiIcon } from "@/components/AiIcon";
import {
  User, AlertCircle, Send,
  BarChart3, UploadCloud, MessageSquare, TrendingUp,
  Loader2, ChevronRight, Upload,
  CheckCircle2, Clock, Check, FileText, Sheet, FileSpreadsheet,
  Plus, X, RefreshCw,
  BookOpen, Calculator, BarChart2, Coins, Trophy, AlertTriangle,
  Layers, Database, Search, Cog, ArrowDown, ChevronDown, Share2,
  Pin, MoreHorizontal, Trash2,
  ThumbsUp, ThumbsDown, ImagePlus,
} from "lucide-react";

const FEEDBACK_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

type FileItem = {
  id: string;
  name: string;
  status: string;
  kind?: string | null;
  createdAt: Date;
};

type SystemMsgStatus = "uploading" | "processing" | "ready" | "error" | "timeout";

interface SystemMsg {
  id: string;
  fileName: string;
  fileId?: string;
  status: SystemMsgStatus;
}

// ── Progress label normalization ─────────────────────────────────────────────

function normalizeStep(step: string): { icon: React.ElementType; label: string } {
  if (step.startsWith("Lese"))               return { icon: BookOpen,       label: "Lese Datenschema" };
  if (step.startsWith("Berechne alle"))      return { icon: Calculator,     label: "Berechne alle Kennzahlen" };
  if (step.startsWith("Berechne Statistik")) return { icon: BarChart2,      label: "Berechne Statistiken" };
  if (step.startsWith("Berechne Zeitreihe")) return { icon: TrendingUp,     label: "Berechne Zeitreihe" };
  if (step.startsWith("Berechne Investition")) return { icon: Coins,        label: "Berechne Investitionswirtschaftlichkeit" };
  if (step.startsWith("Erstelle Diagramm"))  return { icon: BarChart3,      label: "Erstelle Diagramm" };
  if (step.startsWith("Erstelle Rangliste")) return { icon: Trophy,         label: "Erstelle Rangliste" };
  if (step.startsWith("Erkenne Ausreißer"))  return { icon: AlertTriangle,  label: "Erkenne Ausreißer" };
  if (step.startsWith("Aggregiere"))         return { icon: Layers,         label: "Aggregiere Daten nach Gruppe" };
  if (step.startsWith("Lade"))               return { icon: Database,       label: "Lade Stammdaten" };
  if (step.startsWith("Überprüfe"))          return { icon: Search,         label: "Überprüfe Ergebnisse" };
  return { icon: Cog, label: step };
}

// ── Analysis history list ─────────────────────────────────────────────────────

function AnalysisSourceBadge({ source }: { source?: string | null }) {
  if (source === "auto") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
        Auto
      </span>
    );
  }
  if (source === "template") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
        Vorlage
      </span>
    );
  }
  if (source === "report") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
        Bericht
      </span>
    );
  }
  return null;
}

function NewDataBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      Neue Daten
    </span>
  );
}

function AnalysisHistoryPanel({
  analyses,
  activeAnalysisId,
  latestFileUploadAt,
  onSelect,
  onNew,
  onDeleteAnalysis,
  onUpdateAnalysis,
}: {
  analyses: Analysis[];
  activeAnalysisId: string | null;
  latestFileUploadAt: number;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleteAnalysis: (id: string) => void;
  onUpdateAnalysis: (id: string, patch: { pinned?: boolean }) => void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-projects-open") === "false"; } catch { return false; }
  });
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("sidebar-projects-open", String(!next)); } catch {}
  }

  // Close menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    function handler() { setOpenMenuId(null); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  return (
    <div className="px-3 pt-3 pb-1 border-b border-border/60 shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider hover:text-muted-foreground transition-colors"
        >
          <ChevronDown className={cn("w-3 h-3 transition-transform duration-150", collapsed && "-rotate-90")} />
          Projekte
        </button>
        <button
          onClick={onNew}
          title="Neues Projekt"
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-0.5 max-h-44 overflow-y-auto">
          {analyses.length === 0 && (
            <p className="text-xs text-muted-foreground/50 px-2 py-1">Noch keine Projekte</p>
          )}
          {analyses.map((a) => {
            const analysisTime = new Date(a.updatedAt ?? a.createdAt).getTime();
            const isStale = latestFileUploadAt > 0 && analysisTime < latestFileUploadAt;
            const isConfirmingDelete = confirmDeleteId === a.id;

            return (
              <div key={a.id} className="relative group">
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-1 text-[11px] rounded-md px-2 py-1.5 bg-destructive/10 border border-destructive/20">
                    <span className="flex-1 text-destructive">Wirklich löschen?</span>
                    <button
                      onClick={() => { onDeleteAnalysis(a.id); setConfirmDeleteId(null); }}
                      className="text-destructive font-medium hover:underline"
                    >Ja</button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-muted-foreground hover:underline ml-1"
                    >Nein</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setOpenMenuId(null); onSelect(a.id); }}
                    className={cn(
                      "flex items-center gap-1.5 text-xs rounded-md px-2 py-1.5 text-left w-full transition-colors",
                      activeAnalysisId === a.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {a.pinned && <Pin className="w-2.5 h-2.5 shrink-0 text-primary/70 fill-primary/60" />}
                    <span className="flex-1 truncate min-w-0 pr-8">{a.title}</span>
                    {isStale && <NewDataBadge />}
                    <AnalysisSourceBadge source={a.source} />
                  </button>
                )}
                {!isConfirmingDelete && (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2">
                    <button
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (openMenuId === a.id) {
                          setOpenMenuId(null);
                          setMenuRect(null);
                        } else {
                          setMenuRect(e.currentTarget.getBoundingClientRect());
                          setOpenMenuId(a.id);
                        }
                      }}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                      title="Optionen"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                    {openMenuId === a.id && menuRect && createPortal(
                      <div
                        style={{
                          position: "fixed",
                          top: menuRect.bottom + 2,
                          right: window.innerWidth - menuRect.right,
                          zIndex: 9999,
                        }}
                        className="bg-popover border border-border rounded-md shadow-md min-w-[140px] py-1"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => { onUpdateAnalysis(a.id, { pinned: !a.pinned }); setOpenMenuId(null); setMenuRect(null); }}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
                        >
                          <Pin className="w-3 h-3" />
                          {a.pinned ? "Loslösen" : "Anpinnen"}
                        </button>
                        <button
                          onClick={() => { setConfirmDeleteId(a.id); setOpenMenuId(null); setMenuRect(null); }}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-destructive/10 text-destructive transition-colors text-left"
                        >
                          <Trash2 className="w-3 h-3" />
                          Löschen
                        </button>
                      </div>,
                      document.body
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Historical file pills ────────────────────────────────────────────────────

function fileKindIcon(kind?: string | null) {
  if (kind === "pdf") return <FileText className="w-3.5 h-3.5 shrink-0" />;
  if (kind === "csv" || kind === "excel" || kind === "herd_export")
    return <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />;
  return <Sheet className="w-3.5 h-3.5 shrink-0" />;
}

function HistoricalFiles({
  files,
  onDeleteFile,
  activeContextFileIds,
  collapsed,
  onToggle,
}: {
  files: FileItem[];
  onDeleteFile?: (id: string) => void;
  activeContextFileIds?: string[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div className="px-3 pt-2 pb-1 border-b border-border/60 shrink-0">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5 hover:text-muted-foreground transition-colors w-full"
      >
        <ChevronDown className={cn("w-3 h-3 transition-transform duration-150", collapsed && "-rotate-90")} />
        Hochgeladene Daten
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
          {files.length === 0 && (
            <p className="text-xs text-muted-foreground/50 px-1 py-1">Keine Dateien hochgeladen</p>
          )}
          {files.map((f) => (
            <div key={f.id} className="relative group">
              {confirmDeleteId === f.id ? (
                <div className="flex items-center gap-1 text-[11px] rounded-lg px-2 py-1.5 bg-destructive/10 border border-destructive/20">
                  <span className="flex-1 text-destructive">Wirklich löschen?</span>
                  <button onClick={() => { onDeleteFile?.(f.id); setConfirmDeleteId(null); }} className="text-destructive font-medium hover:underline">Ja</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="text-muted-foreground hover:underline ml-1">Nein</button>
                </div>
              ) : (
                <div
                  className={cn(
                    "flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 border",
                    f.status === "ready"
                      ? "bg-green-50/60 border-green-200/70 text-green-800"
                      : f.status === "error"
                      ? "bg-red-50/60 border-red-200/70 text-red-700"
                      : "bg-muted/60 border-border text-muted-foreground",
                  )}
                >
                  {fileKindIcon(f.kind)}
                  <span className="flex-1 truncate font-medium min-w-0">{f.name}</span>
                  {activeContextFileIds?.includes(f.id) && (
                    <span className="text-[9px] bg-muted border border-border rounded px-1 text-muted-foreground shrink-0 whitespace-nowrap">
                      dieses Projekt
                    </span>
                  )}
                  {f.status === "ready" && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                  {f.status === "error" && <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                  {(f.status === "uploaded" || f.status === "parsing" || f.status === "mapping" || f.status === "processing") && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                  )}
                  <span className="text-[10px] text-muted-foreground/70 shrink-0">
                    {format(new Date(f.createdAt), "dd.MM.", { locale: de })}
                  </span>
                </div>
              )}
              {confirmDeleteId !== f.id && onDeleteFile && (
                <button
                  onClick={() => setConfirmDeleteId(f.id)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                  title="Datei löschen"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Project files panel ──────────────────────────────────────────────────────

function ProjectFilesPanel({
  files,
  contextFileIds,
  onRemove,
}: {
  files: FileItem[];
  contextFileIds: string[];
  onRemove: (fileId: string) => void;
}) {
  const projectFiles = files.filter((f) => contextFileIds.includes(f.id));
  if (projectFiles.length === 0) return null;

  return (
    <div className="px-3 pt-2 pb-1 border-b border-border/60 shrink-0">
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
          Projektdateien
        </span>
        <span className="ml-1 text-[9px] bg-primary/10 text-primary rounded-full px-1.5 py-0.5 font-semibold shrink-0">
          {projectFiles.length}
        </span>
      </div>
      <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
        {projectFiles.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 border bg-primary/5 border-primary/20 text-primary/80 group"
          >
            {fileKindIcon(f.kind)}
            <span className="flex-1 truncate font-medium min-w-0">{f.name}</span>
            <button
              onClick={() => onRemove(f.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-primary/10 text-primary/50 hover:text-primary shrink-0"
              title="Aus Projekt entfernen"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── File poller ──────────────────────────────────────────────────────────────
// Renders nothing — polls a single file until ready/error/timeout (2 min)

const POLL_TIMEOUT_MS = 120_000;

function FilePoller({
  fileId,
  onDone,
}: {
  fileId: string;
  onDone: (result: "ready" | "error" | "timeout") => void;
}) {
  const startRef = useRef(Date.now());
  const calledRef = useRef(false);

  const { data } = useGetFile(fileId, {
    query: {
      queryKey: [`/api/files/${fileId}`],
      refetchInterval: (query) => {
        if (calledRef.current) return false;
        const d = query.state.data;
        if (!d) return 3000;
        if (d.status === "ready" || d.status === "error") return false;
        if (Date.now() - startRef.current > POLL_TIMEOUT_MS) return false;
        return 3000;
      },
    },
  });

  useEffect(() => {
    if (!data || calledRef.current) return;
    if (data.status === "ready" || data.status === "error") {
      calledRef.current = true;
      onDone(data.status === "ready" ? "ready" : "error");
    }
  }, [data?.status]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!calledRef.current) {
        calledRef.current = true;
        onDone("timeout");
      }
    }, POLL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  return null;
}

// ── System message bubble ────────────────────────────────────────────────────

function SystemMessageBubble({ msg }: { msg: SystemMsg }) {
  const icons: Record<SystemMsgStatus, React.ReactNode> = {
    uploading:   <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />,
    processing:  <Clock className="w-4 h-4 text-primary animate-pulse shrink-0" />,
    ready:       <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />,
    error:       <AlertCircle className="w-4 h-4 text-destructive shrink-0" />,
    timeout:     <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />,
  };

  const labels: Record<SystemMsgStatus, string> = {
    uploading:  `📎 ${msg.fileName} — wird hochgeladen…`,
    processing: `📎 ${msg.fileName} — wird verarbeitet…`,
    ready:      `✅ ${msg.fileName} — bereit zum Analysieren`,
    error:      `❌ ${msg.fileName} — Verarbeitungsfehler`,
    timeout:    `⏱ ${msg.fileName} — Zeitüberschreitung bei der Verarbeitung`,
  };

  return (
    <div className="flex gap-3 justify-center">
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-full text-sm border",
          msg.status === "ready"
            ? "bg-green-50 border-green-200 text-green-700"
            : msg.status === "error" || msg.status === "timeout"
            ? "bg-destructive/5 border-destructive/20 text-destructive"
            : "bg-muted border-border text-muted-foreground",
        )}
      >
        {icons[msg.status]}
        <span>{labels[msg.status]}</span>
      </div>
    </div>
  );
}

// ── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isNew,
  isLast,
  isAgentWorking,
}: {
  msg: AnalysisMessage;
  isNew: boolean;
  isLast?: boolean;
  isAgentWorking?: boolean;
}) {
  const isAssistant = msg.role === "assistant";
  return (
    <div className={cn("flex gap-3", isAssistant ? "justify-start" : "justify-end")}>
      {isAssistant && (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
          <AiIcon size={14} className="text-primary" />
        </div>
      )}
      <div className={cn("max-w-[85%] space-y-2", isAssistant ? "" : "items-end flex flex-col")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isAssistant
              ? "bg-secondary text-foreground rounded-tl-sm"
              : "bg-primary text-primary-foreground rounded-tr-sm",
          )}
        >
          {msg.error ? (
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0" /> {msg.content ?? msg.error}
              </span>
              {isLast && !isAgentWorking && (
                <span className="text-xs text-muted-foreground pl-6">
                  Bitte stelle deine Frage erneut.
                </span>
              )}
            </span>
          ) : isAssistant ? (
            <StreamingText text={msg.content ?? ""} animate={isNew} />
          ) : (
            <span className="whitespace-pre-wrap">{msg.content ?? ""}</span>
          )}
        </div>
        {isAssistant && msg.citations && msg.citations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {msg.citations.map((c, i) => {
              const isDocSource = c.value === "PDF-Dokument" || c.value === "Wissensbibliothek";
              return (
                <span
                  key={i}
                  className="text-xs bg-primary/5 border border-primary/20 text-primary px-2 py-0.5 rounded-full"
                >
                  {isDocSource ? c.label : `${c.label}: ${c.value}`}
                </span>
              );
            })}
          </div>
        )}
        <span className="text-[10px] text-muted-foreground">
          {format(new Date(msg.createdAt), "HH:mm", { locale: de })}
        </span>
      </div>
      {!isAssistant && (
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
          <User className="w-3.5 h-3.5 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}

// ── Feedback bar (beta users only — server validates plan) ────────────────────

function FeedbackBar({ messageId }: { messageId: string }) {
  const { getToken } = useAuth();
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${FEEDBACK_API_BASE}/api/messages/${messageId}/feedback`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status === 403 || res.status === 404) { if (!cancelled) setHidden(true); return; }
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.rating) setRating(data.rating);
      } catch { /* silently ignore */ }
    })();
    return () => { cancelled = true; };
  }, [messageId, getToken]);

  const handleRating = async (newRating: "up" | "down") => {
    if (isLoading || hidden) return;
    setIsLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${FEEDBACK_API_BASE}/api/messages/${messageId}/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rating: newRating }),
      });
      if (res.status === 403) { setHidden(true); return; }
      if (res.ok) setRating(newRating);
    } catch { /* silently ignore */ } finally {
      setIsLoading(false);
    }
  };

  if (hidden) return null;

  return (
    <div className="flex items-center gap-1.5 mt-1 ml-10">
      <span className="text-[10px] text-muted-foreground">Hilfreich?</span>
      <button
        onClick={() => handleRating("up")}
        disabled={isLoading}
        title="Hilfreiche Antwort"
        className={cn(
          "p-1 rounded hover:bg-muted/60 transition-colors disabled:opacity-50",
          rating === "up" ? "text-green-600" : "text-muted-foreground",
        )}
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => handleRating("down")}
        disabled={isLoading}
        title="Nicht hilfreiche Antwort"
        className={cn(
          "p-1 rounded hover:bg-muted/60 transition-colors disabled:opacity-50",
          rating === "down" ? "text-red-500" : "text-muted-foreground",
        )}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Live agent steps timeline ─────────────────────────────────────────────────

function AgentStepsTimeline({
  completedSteps,
  currentStep,
}: {
  completedSteps: string[];
  currentStep: string | null;
}) {
  const dedupedSteps: { icon: React.ElementType; label: string; count: number }[] = [];
  const labelIndexMap = new Map<string, number>();
  for (const step of completedSteps) {
    const { icon, label } = normalizeStep(step);
    const existing = labelIndexMap.get(label);
    if (existing !== undefined) {
      dedupedSteps[existing].count += 1;
    } else {
      labelIndexMap.set(label, dedupedSteps.length);
      dedupedSteps.push({ icon, label, count: 1 });
    }
  }

  const normalizedCurrent = currentStep ? normalizeStep(currentStep) : null;
  const currentAlreadyCompleted =
    normalizedCurrent !== null && labelIndexMap.has(normalizedCurrent.label);

  return (
    <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <AiIcon size={14} working className="text-primary" />
      </div>
      <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3 space-y-1.5 min-w-[220px]">
        <div className="relative before:absolute before:left-[5px] before:top-3 before:bottom-3 before:w-px before:bg-border">
          {dedupedSteps.map(({ icon: StepIcon, label, count }, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground/70 py-0.5">
              <div className="w-3 h-3 rounded-full bg-green-500 flex items-center justify-center shrink-0 z-10">
                <StepIcon className="w-2 h-2 text-white" />
              </div>
              <span>{label}{count > 1 ? ` ×${count}` : ""}</span>
            </div>
          ))}
        </div>
        {normalizedCurrent && !currentAlreadyCompleted ? (
          <div className="flex items-center gap-2 text-sm text-foreground">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-primary animate-pulse shrink-0" />
            <span>{normalizedCurrent.label}…</span>
          </div>
        ) : !normalizedCurrent && dedupedSteps.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
            <span>Verbinde mit Agent…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Live Sources Activity ─────────────────────────────────────────────────────

function LiveSourcesActivity({ sources }: { sources: string[] }) {
  return (
    <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-1">
        <BookOpen className="w-3.5 h-3.5 text-amber-600" />
      </div>
      <div className="flex-1 rounded-2xl rounded-tl-sm border-l-4 border-amber-400 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1.5">
          Wissensquellen werden durchsucht…
        </p>
        <ul className="space-y-0.5">
          {sources.map((_title, index) => (
            <li key={index} className="flex items-center gap-1.5 text-xs text-amber-800/80 dark:text-amber-300/70">
              <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />
              Quelle {index + 1}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Answer type badge helpers ─────────────────────────────────────────────────

type AnswerType = "Empfehlung" | "Analyse" | "Investition" | "Wissen";

const BADGE_COLORS: Record<AnswerType, string> = {
  Investition: "#f97316",
  Analyse: "#3b82f6",
  Empfehlung: "#22c55e",
  Wissen: "#6b7280",
};

function inferAnswerType(content: string, charts?: Chart[]): AnswerType {
  if (charts && charts.some((c) => c.type === "kpi")) return "Investition";
  if (charts && charts.some((c) => c.type !== "kpi")) return "Analyse";
  const bulletLines = (content ?? "").split("\n").filter((l) => /^[-*] /.test(l));
  if (bulletLines.length >= 2) return "Empfehlung";
  return "Wissen";
}

// ── Streaming Result Card ─────────────────────────────────────────────────────

function StreamingResultCard({ text, charts }: { text: string; charts?: Chart[] }) {
  const answerType = useMemo(() => inferAnswerType(text, charts), [charts]);
  const badgeColor = BADGE_COLORS[answerType];

  return (
    <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <AiIcon size={14} working className="text-primary" />
      </div>
      <div className="flex-1 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-white leading-none"
            style={{ backgroundColor: badgeColor }}
          >
            {answerType}
          </span>
        </div>
        {text ? (
          <div className="text-sm leading-relaxed">
            <MarkdownContent text={text} />
            <span className="inline-block w-0.5 h-3.5 bg-primary ml-0.5 align-text-bottom animate-pulse" />
          </div>
        ) : (
          <span className="inline-block w-0.5 h-3.5 bg-primary align-text-bottom animate-pulse" />
        )}
        {charts && charts.length > 0 && (
          <div className="space-y-4 pt-1">
            {charts.map((chart, i) => (
              <div key={chart.id ?? i} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
                {chart.title && (
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">{chart.title}</p>
                )}
                {chart.type === "kpi" ? (
                  <DynamicChart chart={chart} />
                ) : (
                  <div className="h-64">
                    <DynamicChart chart={chart} fillContainer />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent Working Banner ──────────────────────────────────────────────────────

function AgentWorkingBanner({ currentStep }: { currentStep: string | null }) {
  const stepLabel = currentStep ? normalizeStep(currentStep).label : null;
  const displayText = stepLabel ? `${stepLabel}…` : "Assistent arbeitet…";

  return (
    <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <AiIcon size={14} working className="text-primary" />
      </div>
      <div className="flex-1 rounded-2xl rounded-tl-sm border-l-4 border-primary bg-primary/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex gap-1 shrink-0">
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
          </span>
          <span className="text-sm font-medium text-foreground">{displayText}</span>
        </div>
      </div>
    </div>
  );
}

// ── Footnote preprocessing ────────────────────────────────────────────────────
// Converts [N] markers in text to inline <sup> HTML, namespaced by msgId to
// avoid duplicate DOM IDs when multiple ResultCards are rendered on one page.
// Avoids matching markdown link syntax [text](url) — the pattern only matches
// a bare number inside brackets not followed by (
function preprocessFootnotes(text: string, ns: string): string {
  return text.replace(/\[(\d{1,2})\](?!\()/g, (_, n) =>
    `<sup class="cite-sup" id="cref-${ns}-${n}"><a href="#cite-${ns}-${n}" class="footnote-link">[${n}]</a></sup>`
  );
}

// Strip all trust/source markers from text so they don't appear inline.
// Sources are collected separately via extractTrustSources and shown below the text.
function stripTrustMarkers(text: string): string {
  return text
    // New emoji-free format
    .replace(/\s*\*\[Bibliothek\]\*/g, "")
    .replace(/\s*\*\[Web\]\*/g, "")
    .replace(/\s*\*\[Allgemeinwissen\]\*/g, "")
    .replace(/\s*\*\[Betriebsdaten\]\*/g, "")
    // Legacy emoji format
    .replace(/\s*\*\[📚 Bibliothek\]\*/g, "")
    .replace(/\s*\*\[🌐 Web\]\*/g, "")
    .replace(/\s*\*\[💭 Allgemeinwissen\]\*/g, "")
    // Inline [Dokument] markers the agent appends to cited values
    .replace(/\s*\[Dokument\]/g, "")
    // Tidy up orphaned spaces before punctuation
    .replace(/ ([.,;:])/g, "$1");
}

// Extract de-duplicated trust sources present in a message text.
// Returns an ordered array of the sources that appear (library → web → general).
// Matches both new emoji-free format and legacy emoji format.
type TrustSource = { label: string; className: string };
function extractTrustSources(text: string): TrustSource[] {
  const sources: TrustSource[] = [];
  if (/\*\[(?:📚 )?Bibliothek\]\*/.test(text))
    sources.push({ label: "Bibliothek", className: "trust-badge trust-badge-library" });
  if (/\*\[(?:🌐 )?Web\]\*/.test(text))
    sources.push({ label: "Web", className: "trust-badge trust-badge-web" });
  if (/\*\[(?:💭 )?Allgemeinwissen\]\*/.test(text))
    sources.push({ label: "Allgemeinwissen", className: "trust-badge trust-badge-general" });
  return sources;
}

// Strict sanitize schema: only allow <sup>, <span>, and <a> elements introduced by
// preprocessFootnotes / stripTrustMarkers. Everything else the LLM might emit
// as raw HTML is stripped.
const TABLE_TAG_NAMES = ["table", "thead", "tbody", "tr", "th", "td", "colgroup", "col"] as const;
const TABLE_ATTRIBUTES = {
  th: ["align", "scope"],
  td: ["align"],
};

const FOOTNOTE_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "sup",
    "span",
    ...TABLE_TAG_NAMES,
  ],
  attributes: {
    ...defaultSchema.attributes,
    sup: ["id", "class"],
    span: ["class", "tabindex"],
    a: [...((defaultSchema.attributes as Record<string, string[]>)?.a ?? []), "class"],
    ...TABLE_ATTRIBUTES,
  },
};

// Lighter schema used by MarkdownContent (no footnotes, only trust-label spans).
const TRUST_BADGE_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "span",
    ...TABLE_TAG_NAMES,
  ],
  attributes: {
    ...defaultSchema.attributes,
    span: ["class", "tabindex"],
    ...TABLE_ATTRIBUTES,
  },
};

// ── Markdown renderer ────────────────────────────────────────────────────────

const LINK_CLASSES = "text-primary underline hover:text-primary/80";

const EXTERNAL_LINK_COMPONENTS = {
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    if (href?.startsWith("http://") || href?.startsWith("https://")) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASSES}>
          {children}
        </a>
      );
    }
    if (href?.startsWith("#")) {
      return <a href={href} className={LINK_CLASSES}>{children}</a>;
    }
    return <span className={LINK_CLASSES}>{children}</span>;
  },
  table({ children }: { children?: React.ReactNode }) {
    return <div className="overflow-x-auto"><table>{children}</table></div>;
  },
};

const PROSE_CLASSES = "prose prose-sm max-w-none " +
  "prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-3 prose-headings:mb-1 " +
  "prose-p:text-foreground prose-p:my-1.5 prose-p:leading-relaxed " +
  "prose-strong:text-foreground prose-strong:font-semibold " +
  "prose-li:text-foreground prose-li:my-0.5 " +
  "prose-ul:my-1 prose-ol:my-1 " +
  "prose-ul:pl-4 prose-ol:pl-4 " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-3 " +
  "[&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:bg-muted/60 " +
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top " +
  "[&_tbody_tr:nth-child(even)]:bg-muted/20 " +
  "[&_td[align=right]]:text-right [&_th[align=right]]:text-right [&_td[align=center]]:text-center [&_th[align=center]]:text-center " +
  "[&_pre]:!text-sm [&_pre]:leading-relaxed " +
  "[&_:not(pre)>code]:!text-[0.9em]";

const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  const processed = stripTrustMarkers(text);
  return (
    <div className={PROSE_CLASSES}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, TRUST_BADGE_SANITIZE_SCHEMA]]}
        components={EXTERNAL_LINK_COMPONENTS}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});

// Variant used inside ResultCard — renders footnote superscripts safely.
// rehypeRaw parses our pre-inserted <sup> tags; rehypeSanitize then strips
// any other HTML the model might have emitted (XSS protection).
const ResultMarkdownContent = memo(function ResultMarkdownContent({
  text,
  msgId,
}: {
  text: string;
  msgId: string;
}) {
  const processed = preprocessFootnotes(stripTrustMarkers(text), msgId);
  return (
    <div className={
      PROSE_CLASSES +
      " [&_.cite-sup]:text-[0.65em] [&_.cite-sup]:align-super" +
      " [&_.footnote-link]:text-primary/70 [&_.footnote-link]:hover:text-primary" +
      " [&_.footnote-link]:font-semibold [&_.footnote-link]:no-underline [&_.footnote-link]:hover:underline"
    }>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, FOOTNOTE_SANITIZE_SCHEMA]]}
        components={EXTERNAL_LINK_COMPONENTS}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});

// ── Streaming text (character-by-character reveal) ────────────────────────────

function StreamingText({ text, animate }: { text: string; animate: boolean }) {
  const [visibleChars, setVisibleChars] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) return;
    let i = 0;
    const id = setInterval(() => {
      i += 10;
      setVisibleChars(i);
      if (i >= text.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [animate, text]);

  const displayText = animate && visibleChars < text.length
    ? text.slice(0, visibleChars)
    : text;

  return <MarkdownContent text={displayText} />;
}

// ── Heuristic: is this message a back-question from the agent? ────────────────

function isBackQuestion(content: string | null | undefined): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (trimmed.length >= 400) return false;
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar !== "?") return false;
  // Suppress markdown-structured messages (headings, lists, tables) — they are results, not questions
  if (/^#{1,6}\s/m.test(trimmed)) return false;
  if (/^[-*]\s/m.test(trimmed)) return false;
  if (/^\|/m.test(trimmed)) return false;
  return true;
}

// ── Extract individual questions from agent messages ──────────────────────────

function extractBackQuestions(content: string | null | undefined): string[] | null {
  if (!content) return null;
  const trimmed = content.trim();

  // Case A: short back-question — treat entire content as one question
  if (isBackQuestion(content)) {
    return [trimmed];
  }

  // Case B: numbered questions embedded in longer text
  // Match lines like "1. ...?" or "2) ...?" at end of content
  const lines = trimmed.split("\n");
  const questionLines: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:\d+[.)]\s+|-\s+)(.+\?)\s*$/);
    if (m) {
      questionLines.push(m[1].trim());
    }
  }

  if (questionLines.length >= 2) {
    return questionLines;
  }

  return null;
}

// ── Message-level helpers: prefer structured backQuestions, fall back to heuristic ──

function msgIsBackQuestion(msg: AnalysisMessage): boolean {
  if (msg.backQuestions && msg.backQuestions.length > 0) return true;
  return isBackQuestion(msg.content);
}

function getMsgBackQuestions(msg: AnalysisMessage): FarmerQuestion[] | null {
  if (msg.backQuestions && msg.backQuestions.length > 0) {
    return msg.backQuestions as FarmerQuestion[];
  }
  const extracted = extractBackQuestions(msg.content);
  return extracted ? extracted.map((text) => ({ text })) : null;
}

// ── Interactive back-question form ────────────────────────────────────────────

/** Strip leading emoji and **Bold:** label prefixes the agent sometimes adds. */
function cleanQuestionText(q: string): string {
  // Remove leading emoji characters (including variation selectors + ZWJ sequences)
  let s = q.replace(/^[\p{Emoji}\s]+/u, "").trim();
  // Remove **Label:** or **Label** prefix pattern
  s = s.replace(/^\*\*[^*]{1,40}\*\*\s*:?\s*/, "").trim();
  return s || q;
}

type FarmerQuestion = { text: string; options?: string[] };

function BackQuestionForm({
  questions,
  onSubmit,
}: {
  questions: FarmerQuestion[];
  onSubmit: (answer: string) => void;
}) {
  const capped = questions.slice(0, 3);
  const [answers, setAnswers] = useState<string[]>(() => capped.map(() => ""));
  const [skipped, setSkipped] = useState<boolean[]>(() => capped.map(() => false));
  const [submitted, setSubmitted] = useState(false);

  if (submitted) return null;

  const allSkipped = skipped.every(Boolean);

  function handleSend() {
    const parts = capped.map((q, i) => {
      const ans = skipped[i] ? "keine Angabe" : (answers[i].trim() || "keine Angabe");
      return `${i + 1}. ${q.text}: ${ans}`;
    });
    const text = `Zu deinen Fragen:\n${parts.join("\n")}`;
    setSubmitted(true);
    onSubmit(text);
  }

  return (
    <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <AiIcon size={14} className="text-primary" />
      </div>
      <div className="flex-1 bg-secondary rounded-2xl rounded-tl-sm px-4 py-3 space-y-3 max-w-[90%]">
        {capped.map((q, i) => {
          const clean = cleanQuestionText(q.text);
          const opts = q.options ?? [];
          return (
            <div key={i} className={cn("space-y-2", skipped[i] && "opacity-50")}>
              {/* Question header */}
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-semibold text-primary/70 tabular-nums shrink-0 mt-0.5">
                  {i + 1}.
                </span>
                <span className={cn("text-sm leading-snug text-foreground flex-1", skipped[i] && "line-through")}>
                  {clean}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSkipped((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
                  }
                  className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                >
                  {skipped[i] ? "Hinzufügen" : "Überspringen"}
                </button>
              </div>

              {!skipped[i] && (
                <div className="pl-5 space-y-2">
                  {/* Option chips */}
                  {opts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {opts.map((opt) => {
                        const selected = answers[i] === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setAnswers((prev) =>
                                prev.map((a, idx) => (idx === i ? (a === opt ? "" : opt) : a)),
                              )
                            }
                            className={cn(
                              "text-xs px-3 py-1 rounded-full border transition-all",
                              selected
                                ? "bg-primary text-primary-foreground border-primary font-medium"
                                : "bg-background border-border text-foreground hover:border-primary/50 hover:bg-primary/5",
                            )}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* Free text */}
                  <input
                    type="text"
                    maxLength={500}
                    value={answers[i]}
                    onChange={(e) =>
                      setAnswers((prev) => prev.map((a, idx) => (idx === i ? e.target.value : a)))
                    }
                    placeholder={opts.length > 0 ? "Oder eigene Antwort…" : "Deine Antwort…"}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                  />
                </div>
              )}
            </div>
          );
        })}
        <Button
          type="button"
          size="sm"
          onClick={handleSend}
          className="w-full mt-1"
        >
          Senden
        </Button>
      </div>
    </div>
  );
}

// ── Follow-up question chips ───────────────────────────────────────────────────

function FollowUpChips({
  questions,
  onAsk,
  fading = false,
  exiting = false,
}: {
  questions: string[];
  onAsk: (q: string) => void;
  fading?: boolean;
  exiting?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-2 pl-10 transition-opacity duration-500 ${
        exiting
          ? "animate-out fade-out slide-out-to-bottom-1 fill-mode-forwards"
          : "animate-in fade-in slide-in-from-bottom-1"
      } ${fading && !exiting ? "opacity-30 pointer-events-none" : exiting ? "pointer-events-none" : "opacity-100"}`}
    >
      <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
        <ChevronRight className="w-3 h-3" />
        Weiter fragen
      </span>
      <div className="flex flex-wrap gap-2">
        {questions.map((q, i) => (
          <button
            key={i}
            onClick={() => onAsk(q)}
            style={{ animationDelay: `${i * 60}ms` }}
            className="text-xs px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors text-left animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Starter questions (DB-driven templates) ──────────────────────────────────

function relativeDay(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  const diffDays = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "heute";
  if (diffDays === 1) return "gestern";
  return `vor ${diffDays} Tagen`;
}

function StarterQuestions({
  hasFiles,
  datasetId,
  onTemplateRun,
  onAsk,
}: {
  hasFiles: boolean;
  datasetId: string;
  onTemplateRun: (analysisId: string) => void;
  onAsk: (question: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates, isLoading: templatesLoading } = useListTemplates(datasetId, {
    query: {
      enabled: hasFiles,
      queryKey: getListTemplatesQueryKey(datasetId),
      staleTime: 60_000,
    },
  });

  const { data: currentUser } = useGetCurrentUser();

  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const runTemplate = useRunTemplate({
    mutation: {
      onSuccess: (data, vars) => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId) });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey(datasetId) });
        setQuotaExceeded(false);
        onTemplateRun(data.analysisId);
      },
      onError: (err: any) => {
        const status = err?.status ?? err?.response?.status;
        const data = err?.data ?? err?.response?.data;
        if (status === 402 && data?.error === "quota_exceeded") {
          setQuotaExceeded(true);
          return;
        }
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Vorlage konnte nicht gestartet werden.",
        });
      },
    },
  });

  if (quotaExceeded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-amber-500" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Analyse-Kontingent erschöpft</h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Du hast das Limit deines aktuellen Tarifs für diesen Monat erreicht.
          Upgrade auf Starter oder Pro für weitere Analysen.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button asChild variant="outline">
            <Link href="/app/settings">
              Auf Starter upgraden (50 €/Monat)
            </Link>
          </Button>
          <Button asChild>
            <Link href="/app/settings">
              Auf Pro upgraden (100 €/Monat)
            </Link>
          </Button>
        </div>
        <button
          onClick={() => setQuotaExceeded(false)}
          className="mt-4 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Zurück zu den Vorlagen
        </button>
      </div>
    );
  }

  if (!hasFiles) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-4">
          <UploadCloud className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Noch keine Daten hochgeladen</h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Lade zuerst deine Herdenmanagement-Exporte hoch, bevor du Analysen startest.
        </p>
        <Button asChild>
          <Link href={`/app/upload?datasetId=${datasetId}`}>
            <Upload className="w-4 h-4 mr-2" />
            Zur Upload-Seite
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground mt-4">
          Oder ziehe Dateien direkt auf diese Seite
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-4 glow-sm">
        <AiIcon size={28} className="text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-1">Womit kann ich helfen?</h3>
      <p className="text-sm text-muted-foreground mb-6">
        Stelle eine Frage oder wähle eine Vorlage:
      </p>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 md:grid md:grid-cols-2 md:overflow-visible md:snap-none md:pb-0 md:w-full md:max-w-2xl -mx-1 px-1">
        {templatesLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4 rounded-xl border border-border bg-card animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-3/4" />
                    <div className="h-2 bg-muted rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))
          : filterTemplatesByFocusAreas(templates ?? [], currentUser?.focusAreas).map((t) => {
              const lastDay = relativeDay(t.lastRunAt);
              const snippet = t.lastResultSnippet
                ? t.lastResultSnippet.slice(0, 80)
                : null;
              return (
                <button
                  key={t.id}
                  onClick={() =>
                    runTemplate.mutate({ datasetId, templateId: t.id })
                  }
                  disabled={runTemplate.isPending}
                  className="group text-left p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm hover:-translate-y-0.5 transition-all duration-150 disabled:opacity-60 snap-start min-w-[280px] md:min-w-0 shrink-0 md:shrink"
                >
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center text-xl leading-none shrink-0">{t.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">
                        {t.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t.shortDescription}
                      </p>
                      {lastDay && (
                        <p className="text-[10px] text-muted-foreground/70 mt-1 truncate">
                          Zuletzt: {lastDay}
                          {snippet ? ` · ${snippet}` : ""}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-0.5" />
                  </div>
                </button>
              );
            })}
      </div>
    </div>
  );
}

// ── Result card (memoized) ───────────────────────────────────────────────────

// ── Interactive Chat Calculators ──────────────────────────────────────────────

type HeatAbatementPrefill = {
  herdSize?: number;
  heatStressDays?: number;
  milkLossPerDayKg?: number;
  milkPriceEuroKg?: number;
  investmentCost?: number;
  annualOperatingCost?: number;
  systemLifetimeYears?: number;
  interestRatePct?: number;
};

function HeatAbatementWidget({ prefill }: { prefill: Record<string, number> }) {
  const p = prefill as HeatAbatementPrefill;
  const [herdSize, setHerdSize] = useState(p.herdSize ?? 80);
  const [heatStressDays, setHeatStressDays] = useState(p.heatStressDays ?? 45);
  const [milkLossPerDayKg, setMilkLossPerDayKg] = useState(p.milkLossPerDayKg ?? 1.5);
  const [milkPriceEuroKg, setMilkPriceEuroKg] = useState(p.milkPriceEuroKg ?? 0.40);
  const [investmentCost, setInvestmentCost] = useState(p.investmentCost ?? 50000);
  const [annualOperatingCost, setAnnualOperatingCost] = useState(p.annualOperatingCost ?? 3000);
  const [systemLifetimeYears, setSystemLifetimeYears] = useState(p.systemLifetimeYears ?? 15);
  const [interestRatePct, setInterestRatePct] = useState(p.interestRatePct ?? 3.5);

  const result = useMemo(() => {
    const annualMilkLossRevenue = herdSize * heatStressDays * milkLossPerDayKg * milkPriceEuroKg;
    const i = interestRatePct / 100;
    const n = systemLifetimeYears;
    let annuity: number;
    if (i === 0) {
      annuity = investmentCost / n;
    } else {
      annuity = (investmentCost * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
    }
    const netAnnualBenefit = annualMilkLossRevenue - annualOperatingCost - annuity;
    let breakEvenYear: number | null = null;
    let cumulative = 0;
    for (let y = 1; y <= 25; y++) {
      cumulative += netAnnualBenefit;
      if (cumulative > 0) { breakEvenYear = y; break; }
    }
    let rating: "wirtschaftlich" | "grenzwertig" | "nicht empfohlen";
    if (breakEvenYear !== null && breakEvenYear <= systemLifetimeYears) {
      rating = "wirtschaftlich";
    } else if (breakEvenYear !== null && breakEvenYear <= systemLifetimeYears * 1.3) {
      rating = "grenzwertig";
    } else {
      rating = "nicht empfohlen";
    }
    return { annualMilkLossRevenue, netAnnualBenefit, breakEvenYear, rating };
  }, [herdSize, heatStressDays, milkLossPerDayKg, milkPriceEuroKg, investmentCost, annualOperatingCost, systemLifetimeYears, interestRatePct]);

  const ratingColor = result.rating === "wirtschaftlich" ? "bg-green-50 border-green-200 text-green-800" : result.rating === "grenzwertig" ? "bg-yellow-50 border-yellow-200 text-yellow-800" : "bg-red-50 border-red-200 text-red-800";
  const ratingDot = result.rating === "wirtschaftlich" ? "bg-green-500" : result.rating === "grenzwertig" ? "bg-yellow-500" : "bg-red-500";

  function NumField({ label, value, onChange, unit, step }: { label: string; value: number; onChange: (v: number) => void; unit: string; step?: number }) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            step={step ?? 1}
            value={value}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{unit}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-base">🌡️</span>
        <span className="text-sm font-semibold">Hitzestress-Rechner</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <NumField label="Laktierende Kühe" value={herdSize} onChange={setHerdSize} unit="Kühe" />
        <NumField label="Hitzestresstage/Jahr" value={heatStressDays} onChange={setHeatStressDays} unit="Tage" />
        <NumField label="Milchverlust/Kuh/Tag" value={milkLossPerDayKg} onChange={setMilkLossPerDayKg} unit="kg" step={0.1} />
        <NumField label="Milchpreis" value={milkPriceEuroKg} onChange={setMilkPriceEuroKg} unit="€/kg" step={0.01} />
        <NumField label="Investition" value={investmentCost} onChange={setInvestmentCost} unit="€" step={1000} />
        <NumField label="Betriebskosten/Jahr" value={annualOperatingCost} onChange={setAnnualOperatingCost} unit="€/Jahr" step={100} />
        <NumField label="Nutzungsdauer" value={systemLifetimeYears} onChange={setSystemLifetimeYears} unit="Jahre" />
        <NumField label="Zinssatz" value={interestRatePct} onChange={setInterestRatePct} unit="%" step={0.1} />
      </div>
      <div className={`rounded-lg border p-3 ${ratingColor}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${ratingDot}`} />
          <span className="text-xs font-semibold uppercase tracking-wide">{result.rating}</span>
        </div>
        <p className="text-2xl font-bold tabular-nums">
          {result.netAnnualBenefit >= 0 ? "+" : ""}{result.netAnnualBenefit.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €/Jahr
        </p>
        <p className="text-xs mt-1 opacity-80">
          {result.breakEvenYear !== null ? `Amortisation nach ${result.breakEvenYear} Jahren` : "Amortisation außerhalb Planungshorizont"}
          {" · "}Jährl. Milchverlust: {result.annualMilkLossRevenue.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €
        </p>
        <p className="text-xs mt-0.5 opacity-70">
          {result.rating === "wirtschaftlich" ? "Die Investition rechnet sich innerhalb der Nutzungsdauer." : result.rating === "grenzwertig" ? "Die Investition liegt knapp außerhalb — Optimierungspotenzial prüfen." : "Die Investition amortisiert sich nicht innerhalb der Nutzungsdauer."}
        </p>
      </div>
    </div>
  );
}

type FreshCowPrefill = {
  calvingsPerYear?: number;
  metritisRatePct?: number;
  ketosisRatePct?: number;
  hypocalcemiaRatePct?: number;
  metrisisCostEuro?: number;
  ketosisCostEuro?: number;
  hypocalcemiaCostEuro?: number;
  diseaseReductionPct?: number;
  programCostPerCowEuro?: number;
};

function FreshCowWidget({ prefill }: { prefill: Record<string, number> }) {
  const p = prefill as FreshCowPrefill;
  const [calvingsPerYear, setCalvingsPerYear] = useState(p.calvingsPerYear ?? 80);
  const [metritisRatePct, setMetritisRatePct] = useState(p.metritisRatePct ?? 25);
  const [ketosisRatePct, setKetosisRatePct] = useState(p.ketosisRatePct ?? 20);
  const [hypocalcemiaRatePct, setHypocalcemiaRatePct] = useState(p.hypocalcemiaRatePct ?? 30);
  const [metrisisCostEuro, setMetrisisCostEuro] = useState(p.metrisisCostEuro ?? 400);
  const [ketosisCostEuro, setKetosisCostEuro] = useState(p.ketosisCostEuro ?? 300);
  const [hypocalcemiaCostEuro, setHypocalcemiaCostEuro] = useState(p.hypocalcemiaCostEuro ?? 150);
  const [diseaseReductionPct, setDiseaseReductionPct] = useState(p.diseaseReductionPct ?? 35);
  const [programCostPerCowEuro, setProgramCostPerCowEuro] = useState(p.programCostPerCowEuro ?? 25);

  const result = useMemo(() => {
    const currentDiseaseCost = calvingsPerYear * (
      (metritisRatePct / 100) * metrisisCostEuro +
      (ketosisRatePct / 100) * ketosisCostEuro +
      (hypocalcemiaRatePct / 100) * hypocalcemiaCostEuro
    );
    const annualSavings = currentDiseaseCost * diseaseReductionPct / 100;
    const annualProgramCost = calvingsPerYear * programCostPerCowEuro;
    const netAnnualBenefit = annualSavings - annualProgramCost;
    const roiPct = annualProgramCost > 0 ? (netAnnualBenefit / annualProgramCost) * 100 : 0;
    let rating: "lohnt sich" | "grenzwertig" | "lohnt sich nicht";
    if (netAnnualBenefit > 0) {
      rating = "lohnt sich";
    } else if (netAnnualBenefit > -(annualProgramCost * 0.2)) {
      rating = "grenzwertig";
    } else {
      rating = "lohnt sich nicht";
    }
    return { currentDiseaseCost, annualSavings, annualProgramCost, netAnnualBenefit, roiPct, rating };
  }, [calvingsPerYear, metritisRatePct, ketosisRatePct, hypocalcemiaRatePct, metrisisCostEuro, ketosisCostEuro, hypocalcemiaCostEuro, diseaseReductionPct, programCostPerCowEuro]);

  const ratingColor = result.rating === "lohnt sich" ? "bg-green-50 border-green-200 text-green-800" : result.rating === "grenzwertig" ? "bg-yellow-50 border-yellow-200 text-yellow-800" : "bg-red-50 border-red-200 text-red-800";
  const ratingDot = result.rating === "lohnt sich" ? "bg-green-500" : result.rating === "grenzwertig" ? "bg-yellow-500" : "bg-red-500";

  function NumField({ label, value, onChange, unit, step }: { label: string; value: number; onChange: (v: number) => void; unit: string; step?: number }) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            step={step ?? 1}
            value={value}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{unit}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-base">🐄</span>
        <span className="text-sm font-semibold">Frischmelker-ROI-Rechner</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <NumField label="Abkalbungen/Jahr" value={calvingsPerYear} onChange={setCalvingsPerYear} unit="Abkalbungen" />
        <NumField label="Metritis-Rate" value={metritisRatePct} onChange={setMetritisRatePct} unit="%" step={0.5} />
        <NumField label="Ketose-Rate" value={ketosisRatePct} onChange={setKetosisRatePct} unit="%" step={0.5} />
        <NumField label="Hypokalzämie-Rate" value={hypocalcemiaRatePct} onChange={setHypocalcemiaRatePct} unit="%" step={0.5} />
        <NumField label="Kosten Metritis/Fall" value={metrisisCostEuro} onChange={setMetrisisCostEuro} unit="€" step={10} />
        <NumField label="Kosten Ketose/Fall" value={ketosisCostEuro} onChange={setKetosisCostEuro} unit="€" step={10} />
        <NumField label="Kosten Hypokalzämie/Fall" value={hypocalcemiaCostEuro} onChange={setHypocalcemiaCostEuro} unit="€" step={10} />
        <NumField label="Krankheitsreduktion" value={diseaseReductionPct} onChange={setDiseaseReductionPct} unit="%" step={1} />
        <NumField label="Programmkosten/Kuh" value={programCostPerCowEuro} onChange={setProgramCostPerCowEuro} unit="€/Kuh" step={1} />
      </div>
      <div className={`rounded-lg border p-3 ${ratingColor}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${ratingDot}`} />
          <span className="text-xs font-semibold uppercase tracking-wide">{result.rating}</span>
        </div>
        <p className="text-2xl font-bold tabular-nums">
          {result.netAnnualBenefit >= 0 ? "+" : ""}{result.netAnnualBenefit.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €/Jahr
        </p>
        <p className="text-xs mt-1 opacity-80">
          ROI: {result.roiPct >= 0 ? "+" : ""}{result.roiPct.toLocaleString("de-DE", { maximumFractionDigits: 0 })} %
          {" · "}Einsparungen: {result.annualSavings.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €/Jahr
          {" · "}Programmkosten: {result.annualProgramCost.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €/Jahr
        </p>
        <p className="text-xs mt-0.5 opacity-70">
          {result.rating === "lohnt sich" ? "Das verbesserte Programm erwirtschaftet mehr als es kostet." : result.rating === "grenzwertig" ? "Das Programm ist annähernd kostendeckend — Inzidenzwerte prüfen." : "Die Programmkosten übersteigen die erzielbaren Einsparungen."}
        </p>
      </div>
    </div>
  );
}

const ResultCard = memo(function ResultCard({
  questionTitle,
  msg,
  analysisId,
  cardRef,
  onFollowUpClick,
  isAgentWorking,
}: {
  questionTitle: string | null;
  msg: AnalysisMessage;
  analysisId: string;
  cardRef?: React.Ref<HTMLDivElement>;
  onFollowUpClick?: (q: string) => void;
  isAgentWorking?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const headerLabel = questionTitle ?? "Ergebnis";
  const { toast } = useToast();
  const answerType = useMemo(() => inferAnswerType(msg.content ?? "", msg.charts ?? undefined), [msg.charts, msg.content]);
  const badgeColor = BADGE_COLORS[answerType];

  async function handleShare() {
    // Generate a share URL that goes through the API share route so social
    // media bots receive proper OG meta tags; browsers are redirected to the SPA.
    const shareUrl = `${window.location.origin}/api/share/analyses/${encodeURIComponent(analysisId)}`;
    const shareData: ShareData = {
      title: headerLabel,
      text: `${headerLabel} – Milchvieh Analyse`,
      url: shareUrl,
    };
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          await navigator.clipboard.writeText(shareUrl);
          toast({ description: "Link kopiert" });
        }
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      toast({ description: "Link kopiert" });
    }
  }

  return (
    <div
      ref={cardRef}
      className="rounded-xl border border-border bg-card shadow-sm overflow-hidden"
    >
      <div className="flex items-stretch border-b border-border bg-muted/30">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex-1 flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
          aria-expanded={!collapsed}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              data-testid="answer-badge"
              className="shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-white leading-none"
              style={{ backgroundColor: badgeColor }}
            >
              {answerType}
            </span>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
              {headerLabel}
            </p>
          </div>
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground shrink-0 ml-2 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={handleShare}
          title="Teilen"
          className="shrink-0 flex items-center justify-center w-11 h-11 md:w-auto md:h-auto md:px-2 md:py-2.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Share2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {!collapsed && (
        <div className="px-4 py-3 space-y-3">
          <ResultMarkdownContent text={msg.content ?? ""} msgId={msg.id} />
          {(msg as any).widgetSpec?.type === "heat_abatement" && (
            <HeatAbatementWidget prefill={(msg as any).widgetSpec.prefill ?? {}} />
          )}
          {(msg as any).widgetSpec?.type === "fresh_cow" && (
            <FreshCowWidget prefill={(msg as any).widgetSpec.prefill ?? {}} />
          )}
          {(() => {
            const trustSources = extractTrustSources(msg.content ?? "");
            const hasCitations = msg.citations && msg.citations.length > 0;
            if (!trustSources.length && !hasCitations) return null;
            return (
              <div className="pt-2 border-t border-border/30 space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Quellen</p>
                <div className="flex flex-wrap gap-1.5">
                  {trustSources.map((s) => (
                    <span key={s.label} className={s.className} style={{ fontSize: "0.65rem" }}>{s.label}</span>
                  ))}
                  {hasCitations && msg.citations!.map((c, i) => {
                    const icon =
                      c.sourceType === "betriebsdaten" ? "📊" :
                      c.sourceType === "pdf" ? "📄" :
                      c.sourceType === "wissen" ? "📚" :
                      c.sourceType === "web" ? "🌐" : "📌";
                    return (
                      <span
                        key={i}
                        id={`cite-${msg.id}-${i + 1}`}
                        title={c.basis ?? undefined}
                        className="inline-flex items-center gap-1 text-xs bg-primary/5 border border-primary/20 text-primary px-2 py-0.5 rounded-full"
                      >
                        <span className="text-[10px] font-semibold text-muted-foreground/60 shrink-0">[{i + 1}]</span>
                        <span>{icon}</span>
                        <span className="font-medium">{c.label}</span>
                        <span className="text-muted-foreground/70">·</span>
                        <span className="text-muted-foreground">{c.value}</span>
                        {c.basis && (
                          <span className="text-[10px] text-muted-foreground/50 ml-0.5">({c.basis})</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {msg.charts && msg.charts.length > 0 && (
            <div className="space-y-4">
              {msg.charts.map((chart, i) => (
                <div key={i}>
                  {chart.title && chart.title !== headerLabel && (
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">
                      {chart.title}
                    </p>
                  )}
                  {chart.type === "kpi" ? (
                    <DynamicChart chart={chart} />
                  ) : (
                    <div className="h-64">
                      <DynamicChart chart={chart} fillContainer />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ── Analysis results panel ────────────────────────────────────────────────────

function AnalysisResultsPanel({
  analysis,
  isWorking,
  pendingQuestion,
  streamingText,
  streamingCharts,
  onFollowUpClick,
}: {
  analysis: AnalysisDetail | undefined;
  isWorking: boolean;
  pendingQuestion?: string;
  streamingText?: string;
  streamingCharts?: Chart[];
  onFollowUpClick?: (q: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCardRef = useRef<HTMLDivElement>(null);
  const streamingCardRef = useRef<HTMLDivElement>(null);

  const msgs = analysis?.messages ?? [];

  // Pairs: result message + preceding user question title
  const resultPairs: { msg: AnalysisMessage; questionTitle: string | null }[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "assistant" && !m.error && !msgIsBackQuestion(m)) {
      const prevUser = [...msgs.slice(0, i)].reverse().find((x) => x.role === "user");
      resultPairs.push({ msg: m, questionTitle: prevUser?.content ?? null });
    }
  }

  // Most recent widgetSpec across all messages — drives the sticky calculator panel
  const lastWidgetSpec = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const ws = (msgs[i] as any).widgetSpec;
      if (ws?.type) return ws as { type: string; prefill: Record<string, number> };
    }
    return null;
  }, [msgs]);

  const [widgetPanelCollapsed, setWidgetPanelCollapsed] = useState(false);
  const prevWidgetTypeRef = useRef<string | null>(null);

  // Auto-expand when a new widgetSpec type appears
  useEffect(() => {
    if (lastWidgetSpec?.type && lastWidgetSpec.type !== prevWidgetTypeRef.current) {
      setWidgetPanelCollapsed(false);
      prevWidgetTypeRef.current = lastWidgetSpec.type;
    }
  }, [lastWidgetSpec?.type]);

  // Scroll to the streaming area as soon as the agent starts — don't wait for the full response.
  useEffect(() => {
    if (!isWorking) return;
    if (resultPairs.length === 0) {
      // First question: the streaming card is at the very top, scroll the panel there immediately.
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      // Follow-up: scroll the streaming card into view right at the start.
      streamingCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isWorking]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to top when switching to a different analysis
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [analysis?.id]);

  // Pending question to show in loading indicators:
  // prefer the ref value (set just before submission), fall back to the last
  // persisted user message (covers reload/resume while agent is still working).
  const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const rawWorkingQuestion = pendingQuestion || lastUserMsg;
  const workingQuestion = rawWorkingQuestion
    ? rawWorkingQuestion.length > 60
      ? rawWorkingQuestion.slice(0, 60) + "…"
      : rawWorkingQuestion
    : null;

  if (!analysis) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">
          Stelle eine Frage, um Ergebnisse zu sehen
        </p>
      </div>
    );
  }

  if (resultPairs.length === 0 && !isWorking) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <TrendingUp className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">
          Ergebnisse erscheinen hier sobald der Agent antwortet
        </p>
      </div>
    );
  }

  if (resultPairs.length === 0 && isWorking) {
    if (streamingText || (streamingCharts && streamingCharts.length > 0)) {
      return (
        <div className="h-full overflow-y-auto px-4 py-4">
          <StreamingResultCard text={streamingText ?? ""} charts={streamingCharts} />
          <div className="h-2" />
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-3" />
        <p className="text-sm text-muted-foreground">Berechne Ergebnis…</p>
        {workingQuestion && (
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">„{workingQuestion}"</p>
        )}
      </div>
    );
  }

  const stickyCalculatorPanel = lastWidgetSpec ? (
    <div className="shrink-0 border-t border-border bg-background">
      <button
        type="button"
        onClick={() => setWidgetPanelCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors"
        aria-expanded={!widgetPanelCollapsed}
      >
        <div className="flex items-center gap-1.5">
          <Calculator className="w-3 h-3 text-primary shrink-0" />
          <span className="text-xs font-semibold text-muted-foreground">
            {lastWidgetSpec.type === "heat_abatement" ? "🌡️ Hitzestress-Rechner" : "🐄 Frischmelker-ROI-Rechner"}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${widgetPanelCollapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {!widgetPanelCollapsed && (
        <div className="px-4 pb-4 max-h-[55vh] overflow-y-auto">
          {lastWidgetSpec.type === "heat_abatement" && (
            <HeatAbatementWidget prefill={lastWidgetSpec.prefill ?? {}} />
          )}
          {lastWidgetSpec.type === "fresh_cow" && (
            <FreshCowWidget prefill={lastWidgetSpec.prefill ?? {}} />
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {resultPairs.map((pair, idx) => (
          <div key={pair.msg.id}>
            <ResultCard
              questionTitle={pair.questionTitle}
              msg={pair.msg}
              analysisId={analysis.id}
              cardRef={idx === resultPairs.length - 1 ? lastCardRef : undefined}
              onFollowUpClick={onFollowUpClick}
              isAgentWorking={isWorking}
            />
            <p className="text-[11px] text-muted-foreground/60 mt-1.5 px-1 text-center select-none">
              KI-Analysen können Fehler enthalten – bitte Ergebnisse stets fachlich prüfen.
            </p>
          </div>
        ))}

        {isWorking && (
          <div ref={streamingCardRef}>
          {(streamingText || (streamingCharts && streamingCharts.length > 0)) ? (
            <StreamingResultCard text={streamingText ?? ""} charts={streamingCharts} />
          ) : (
          <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
              <AiIcon size={14} working className="text-primary" />
            </div>
            <div className="flex-1 rounded-2xl rounded-tl-sm border-l-4 border-primary bg-primary/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex gap-1 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                </span>
                <span className="text-sm font-medium text-foreground">Berechne Ergebnis…</span>
              </div>
              {workingQuestion && (
                <p className="text-xs text-muted-foreground mt-1.5 truncate max-w-[360px]">
                  „{workingQuestion}"
                </p>
              )}
            </div>
          </div>
          )
          }
          </div>
        )}

        <div className="h-2" />
      </div>
      {stickyCalculatorPanel}
    </div>
  );
}

// ── Neue Daten verfügbar Banner ──────────────────────────────────────────────

function NeueDatatenBanner({
  onDismiss,
  onNewAnalysis,
}: {
  onDismiss: () => void;
  onNewAnalysis: () => void;
}) {
  return (
    <div className="mx-3 mt-2 mb-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2.5 text-sm animate-in fade-in slide-in-from-top-1">
      <RefreshCw className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-amber-900 text-xs leading-snug">
          Neue Daten verfügbar
        </p>
        <p className="text-amber-700 text-xs mt-0.5 leading-snug">
          Es wurden neue Dateien hochgeladen. Die Erstanalyse basiert noch auf den alten Daten.
        </p>
        <button
          onClick={onNewAnalysis}
          className="mt-1.5 text-xs text-amber-800 font-medium underline underline-offset-2 hover:text-amber-900"
        >
          Neue Analyse starten →
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="p-0.5 rounded hover:bg-amber-200 text-amber-500 hover:text-amber-700 transition-colors shrink-0"
        title="Schließen"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function ChatImageThumbnail({ objectPath }: { objectPath: string }) {
  const { getToken } = useAuth();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let blobUrl: string | null = null;
    async function load() {
      try {
        const token = await getToken();
        const res = await fetch(
          `${FEEDBACK_API_BASE}/api/chat-images/download?objectPath=${encodeURIComponent(objectPath)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok || !active) return;
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        if (active) setSrc(blobUrl);
      } catch {}
    }
    load();
    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [objectPath]);

  if (!src) return null;
  return (
    <div className="flex justify-end mb-1">
      <img
        src={src}
        alt="Angehängtes Bild"
        className="max-w-[200px] max-h-[200px] rounded-xl border border-border object-cover shadow-sm"
      />
    </div>
  );
}

export function AnalysesPage() {
  const { datasetId, isLoading: datasetLoading } = useRequireDataset();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const searchStr = useSearch();

  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(() => {
    return new URLSearchParams(searchStr).get("analysisId") ?? null;
  });
  const [question, setQuestion] = useState("");
  const [mobileTab, setMobileTab] = useState<"chat" | "chart">(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash === "#ergebnisse") return "chart";
    }
    return "chat";
  });
  const [isDragOver, setIsDragOver] = useState(false);
  const [systemMessages, setSystemMessages] = useState<SystemMsg[]>([]);
  const [chatWidth, setChatWidth] = useState<number>(() => {
    const saved = sessionStorage.getItem("chatPanelWidth");
    return saved ? Math.max(200, Math.min(700, parseInt(saved, 10))) : 320;
  });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [neueDatatenDismissed, setNeueDatatenDismissed] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-files-open") === "false"; } catch { return false; }
  });
  const [pendingContextFileIds, setPendingContextFileIds] = useState<string[]>([]);
  const [pendingImage, setPendingImage] = useState<{
    file: File;
    objectPath: string;
    preview: string;
    uploading: boolean;
  } | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [pendingDepthLevel, setPendingDepthLevel] = useState<"quick" | "deep">("quick");
  // Upload scope picker: null = no picker shown, otherwise the file being dropped
  const [scopePicker, setScopePicker] = useState<{
    file: File; uploadURL: string; objectPath: string; msgId: string;
  } | null>(null);
  const [scopePickerChoice, setScopePickerChoice] = useState<"all" | "project">("all");
  const scopePickerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── SSE streaming state via hook ──────────────────────────────────────────
  const streaming = useStreamingState();
  const [pollFallback, setPollFallback] = useState(false);
  const [chatQuotaExceeded, setChatQuotaExceeded] = useState(false);
  const streamingAnalysisIdRef = useRef<string | null>(null);
  const sseStartedForRef = useRef(new Set<string>());

  const bottomRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const askIsPendingRef = useRef(false);
  const pendingQuestionRef = useRef("");
  const answeredMsgIdsRef = useRef<Set<string>>(new Set());
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const chatWidthRef = useRef(chatWidth);
  chatWidthRef.current = chatWidth;
  // Track component mount time so we can detect "new" messages for animation
  const mountedAtRef = useRef(Date.now());
  // Track previous isAgentWorking value to fire polling after agent ends
  const wasAgentWorkingRef = useRef(false);
  const followUpPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const followUpPollingStartRef = useRef<number>(0);

  const requestUrl = useRequestUploadUrl();
  const registerFile = useRegisterFile();

  const updateAnalysis = useUpdateAnalysis();
  const deleteAnalysis = useDeleteAnalysis();
  const deleteFile = useDeleteFile();

  const { data: files } = useListFiles(datasetId ?? "", {
    query: {
      enabled: !!datasetId,
      queryKey: getListFilesQueryKey(datasetId ?? ""),
    },
  });

  const { data: analysesList } = useListAnalyses(datasetId ?? "", {
    query: {
      enabled: !!datasetId,
      queryKey: getListAnalysesQueryKey(datasetId ?? ""),
      refetchInterval: (query) => {
        if (activeAnalysisId) return false;
        const data = query.state.data as Analysis[] | undefined;
        if (!data || data.length === 0) return 5000;
        // Stop polling once all analyses are older than 90 s —
        // no new auto-analysis is coming from a recent upload any more.
        const now = Date.now();
        const hasRecentAnalysis = data.some(
          (a) => now - new Date(a.createdAt).getTime() < 90_000,
        );
        return hasRecentAnalysis ? 5000 : false;
      },
    },
  });

  const { startStream, stopStream } = useAnalysisStream({
    onDelta: streaming.onDelta,
    onProgress: streaming.onProgress,
    onChart: streaming.onChart,
    onSources: streaming.onSources,
    onDone: () => {
      const id = streamingAnalysisIdRef.current;
      if (id) {
        queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId ?? "") });
      }
    },
    onFallback: () => {
      setPollFallback(true);
      toast({ description: "Live-Verbindung unterbrochen – Ergebnis wird nach Fertigstellung geladen." });
    },
  });

  function openSseStream(analysisId: string) {
    streamingAnalysisIdRef.current = analysisId;
    sseStartedForRef.current.add(analysisId);
    streaming.reset();
    setPollFallback(false);
    startStream(analysisId);
  }

  const createAnalysis = useCreateAnalysis({
    mutation: {
      onSuccess: (data) => {
        setActiveAnalysisId(data.id);
        queryClient.invalidateQueries({
          queryKey: getListAnalysesQueryKey(datasetId ?? ""),
        });
        queryClient.setQueryData(getGetAnalysisQueryKey(data.id), data);
        setQuestion("");
        inputRef.current?.focus();
        openSseStream(data.id);
      },
      onError: (err: any) => {
        const status = err?.status ?? err?.response?.status;
        const data = err?.data ?? err?.response?.data;
        if (status === 402 && data?.error === "quota_exceeded") {
          setChatQuotaExceeded(true);
          return;
        }
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Analyse konnte nicht gestartet werden.",
        });
      },
    },
  });

  const ask = useAskQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetAnalysisQueryKey(activeAnalysisId ?? ""),
        });
        queryClient.invalidateQueries({
          queryKey: getListAnalysesQueryKey(datasetId ?? ""),
        });
        setQuestion("");
        inputRef.current?.focus();
        if (activeAnalysisId) openSseStream(activeAnalysisId);
      },
      onError: (err: any) => {
        const status = err?.status ?? err?.response?.status;
        const data = err?.data ?? err?.response?.data;
        if (status === 402 && data?.error === "quota_exceeded") {
          setChatQuotaExceeded(true);
          return;
        }
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Frage konnte nicht gesendet werden.",
        });
      },
    },
  });

  askIsPendingRef.current = ask.isPending;

  const { data: analysis } = useGetAnalysis(activeAnalysisId ?? "", {
    query: {
      enabled: !!activeAnalysisId,
      queryKey: getGetAnalysisQueryKey(activeAnalysisId ?? ""),
      staleTime: 0,
      refetchInterval: (query) => {
        if (!activeAnalysisId) return false;
        // Poll in fallback mode (SSE failed)
        if (pollFallback) return 1000;
        const data = query.state.data as AnalysisDetail | undefined;
        // Poll for template/auto analyses started on the server (no SSE opened yet)
        if (data?.agentProgress != null && !sseStartedForRef.current.has(activeAnalysisId)) return 1000;
        return false;
      },
    },
  });

  const isAgentWorking =
    (ask.isPending && !!activeAnalysisId) ||
    analysis?.agentProgress != null ||
    // Background agent started but no messages in DB yet
    (!!activeAnalysisId && (analysis?.messages?.length ?? 0) === 0 && !!pendingQuestionRef.current);

  // Prefer live SSE progress over DB-polled value
  const currentStep = streaming.progressStep ?? analysis?.agentProgress ?? null;
  const completedSteps =
    streaming.completedSteps.length > 0
      ? streaming.completedSteps
      : ((analysis?.agentSteps as string[] | undefined) ?? []);

  // Auto-start SSE for template/auto analyses already in progress when navigating to them
  useEffect(() => {
    if (!activeAnalysisId || !analysis) return;
    if (sseStartedForRef.current.has(activeAnalysisId)) return;
    if (analysis.agentProgress != null) {
      openSseStream(activeAnalysisId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnalysisId, analysis?.agentProgress]);

  // Clear streaming state when analysis changes
  useEffect(() => {
    streaming.reset();
    stopStream();
    sseStartedForRef.current.delete(activeAnalysisId ?? "");
    setPollFallback(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnalysisId]);

  // Step 1 — Smart polling: after agent ends, poll every 1s (up to 12s) until
  // followUpQuestions arrive, then stop. This is independent of LLM latency.
  useEffect(() => {
    if (activeAnalysisId && wasAgentWorkingRef.current && !isAgentWorking) {
      // Stop any previous interval
      if (followUpPollingRef.current) {
        clearInterval(followUpPollingRef.current);
        followUpPollingRef.current = null;
      }
      followUpPollingStartRef.current = Date.now();
      followUpPollingRef.current = setInterval(() => {
        const elapsed = Date.now() - followUpPollingStartRef.current;
        // Check if follow-up questions already landed in the cache
        const cached = queryClient.getQueryData(
          getGetAnalysisQueryKey(activeAnalysisId),
        ) as AnalysisDetail | undefined;
        const lastResult = [...(cached?.messages ?? [])]
          .reverse()
          .find((m) => m.role === "assistant" && !m.error && !msgIsBackQuestion(m));
        const hasQuestions =
          ((lastResult?.followUpQuestions as string[] | null)?.length ?? 0) > 0;
        if (hasQuestions || elapsed > 12_000) {
          clearInterval(followUpPollingRef.current!);
          followUpPollingRef.current = null;
          return;
        }
        queryClient.invalidateQueries({
          queryKey: getGetAnalysisQueryKey(activeAnalysisId),
        });
      }, 1000);
    }
    wasAgentWorkingRef.current = isAgentWorking;
    return () => {
      if (followUpPollingRef.current) {
        clearInterval(followUpPollingRef.current);
        followUpPollingRef.current = null;
      }
    };
  }, [isAgentWorking, activeAnalysisId]);

  // Sync mobile tab to URL hash (only on mobile viewports to avoid polluting desktop URLs)
  useEffect(() => {
    if (window.innerWidth >= 768) return;
    const hash = mobileTab === "chart" ? "#ergebnisse" : "#chat";
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
  }, [mobileTab]);

  // Auto-switch tab on mobile when agent finishes.
  // If the response is a back-question, stay on (or switch to) "chat" so the
  // BackQuestionForm is visible. Otherwise go to "chart" to show the result.
  const wasWorkingForTabRef = useRef(false);
  useEffect(() => {
    if (!isAgentWorking && wasWorkingForTabRef.current) {
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        const lastMsg = (analysis?.messages ?? []).at(-1);
        const endsWithBackQuestion = lastMsg ? msgIsBackQuestion(lastMsg) : false;
        setMobileTab(endsWithBackQuestion ? "chat" : "chart");
      }
    }
    wasWorkingForTabRef.current = isAgentWorking;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgentWorking]);

  // Mobile swipe between tabs
  const mobileSwipeStartXRef = useRef<number | null>(null);

  function handleMobileContentTouchStart(e: React.TouchEvent) {
    mobileSwipeStartXRef.current = e.touches[0].clientX;
  }

  function handleMobileContentTouchEnd(e: React.TouchEvent) {
    if (mobileSwipeStartXRef.current === null) return;
    const dx = e.changedTouches[0].clientX - mobileSwipeStartXRef.current;
    mobileSwipeStartXRef.current = null;
    if (Math.abs(dx) < 60) return;
    if (dx < 0) setMobileTab("chart");
    else setMobileTab("chat");
  }

  // Visual viewport keyboard handling: track keyboard offset for chat input only
  // We never resize the container itself — only push padding on the input form.
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function onResize() {
      // Keyboard height = difference between layout viewport and visual viewport
      const offset = Math.max(0, window.innerHeight - vv!.height - vv!.offsetTop);
      setKeyboardOffset(offset);
    }
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // Helper: is this message new (created after this component mounted)?
  function isNewMessage(msg: AnalysisMessage): boolean {
    return new Date(msg.createdAt).getTime() > mountedAtRef.current;
  }

  // Scroll to top after React renders a new user message so the question
  // appears at the top and the assistant answer fills in below.
  useEffect(() => {
    const msgs = analysis?.messages ?? [];
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg?.role !== "user") return;
    if (!isNewMessage(lastMsg)) return;
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = 0;
  }, [analysis?.messages?.length]);

  // Scroll to bottom immediately when the user switches to a different analysis.
  useEffect(() => {
    if (!activeAnalysisId) return;
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [activeAnalysisId]);

  // Auto-scroll to bottom when new messages or system messages arrive.
  // Skip when the newest message is a user message — the effect above
  // already scrolled to top; we only want to scroll down when the
  // assistant answer actually arrives.
  useEffect(() => {
    const msgs = analysis?.messages ?? [];
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg?.role === "user") return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [analysis?.messages?.length, systemMessages.length]);

  // Auto-focus input when agent finishes with a back-question or an error
  useEffect(() => {
    if (isAgentWorking) return;
    const msgs = analysis?.messages ?? [];
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg?.role === "assistant" && (msgIsBackQuestion(lastMsg) || lastMsg.error != null)) {
      inputRef.current?.focus();
    }
  }, [isAgentWorking]);

  // Scroll to bottom when a BackQuestionForm appears (agent finished with a question)
  const lastAssistantMsgIdForForm = (() => {
    if (isAgentWorking) return null;
    const msgs = analysis?.messages ?? [];
    const last = [...msgs].reverse().find((m) => m.role === "assistant" && !m.error);
    if (!last) return null;
    return getMsgBackQuestions(last) ? last.id : null;
  })();
  useEffect(() => {
    if (!lastAssistantMsgIdForForm) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastAssistantMsgIdForForm]);

  // ── Panel resize drag handlers ────────────────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragStartXRef.current && dragStartXRef.current !== 0) return;
      if (!document.body.classList.contains("resizing-panel")) return;
      const delta = e.clientX - dragStartXRef.current;
      const newW = Math.max(200, Math.min(700, dragStartWidthRef.current + delta));
      setChatWidth(newW);
      chatWidthRef.current = newW;
    }
    function onMouseUp() {
      if (document.body.classList.contains("resizing-panel")) {
        document.body.classList.remove("resizing-panel");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsDraggingPanel(false);
        sessionStorage.setItem("chatPanelWidth", String(chatWidthRef.current));
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function handlePanelDragStart(e: React.MouseEvent) {
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = chatWidthRef.current;
    document.body.classList.add("resizing-panel");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setIsDraggingPanel(true);
    e.preventDefault();
  }

  function handleNewAnalysis() {
    setActiveAnalysisId(null);
    setQuestion("");
    setPendingContextFileIds([]);
    setFilePickerOpen(false);
    inputRef.current?.focus();
  }

  function handleDeleteAnalysis(id: string) {
    deleteAnalysis.mutate({ analysisId: id }, {
      onSuccess: () => {
        if (activeAnalysisId === id) {
          setActiveAnalysisId(null);
        }
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId ?? "") });
      },
    });
  }

  function handleUpdateAnalysis(id: string, patch: { pinned?: boolean; contextFileIds?: string[]; depthLevel?: "quick" | "deep" | null }) {
    updateAnalysis.mutate({ analysisId: id, data: patch }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId ?? "") });
        queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) });
      },
    });
  }

  function handleDeleteFile(fileId: string) {
    deleteFile.mutate({ fileId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(datasetId ?? "") });
      },
    });
  }

  function toggleFilesCollapsed() {
    const next = !filesCollapsed;
    setFilesCollapsed(next);
    try { localStorage.setItem("sidebar-files-open", String(!next)); } catch {}
  }

  async function handleImageSelect(file: File) {
    const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_IMAGE_SIZE) {
      toast({ variant: "destructive", title: "Bild zu groß", description: "Maximale Bildgröße: 20 MB (JPEG, PNG, WEBP)" });
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast({ variant: "destructive", title: "Ungültiges Format", description: "Erlaubte Formate: JPEG, PNG, WEBP" });
      return;
    }
    const preview = URL.createObjectURL(file);
    setPendingImage({ file, objectPath: "", preview, uploading: true });
    try {
      const token = await getToken();
      const urlRes = await fetch(`${FEEDBACK_API_BASE}/api/chat-images/upload-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ contentType: file.type }),
      });
      if (!urlRes.ok) throw new Error("Upload-URL konnte nicht erstellt werden");
      const { uploadURL, objectPath } = await urlRes.json();
      await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      setPendingImage({ file, objectPath, preview, uploading: false });
    } catch {
      setPendingImage(null);
      URL.revokeObjectURL(preview);
      toast({ variant: "destructive", title: "Bild-Upload fehlgeschlagen", description: "Bitte erneut versuchen." });
    }
  }

  async function handleSubmit(q?: string) {
    const text = (q ?? question).trim();
    if (!text) return;
    if (pendingImage?.uploading) return;

    pendingQuestionRef.current = text;

    if (!activeAnalysisId) {
      createAnalysis.mutate({
        datasetId: datasetId!,
        data: {
          title: text,
          question: text,
          depthLevel: pendingDepthLevel,
          ...(pendingContextFileIds.length > 0 ? { contextFileIds: pendingContextFileIds } : {}),
        },
      });
      // After creation, apply selected depth level if any
      setPendingContextFileIds([]);
      setFilePickerOpen(false);
    } else {
      const imageObjectPath = pendingImage?.objectPath || undefined;
      ask.mutate({ analysisId: activeAnalysisId, data: { question: text, imageObjectPath } });
      if (pendingImage?.preview) URL.revokeObjectURL(pendingImage.preview);
      setPendingImage(null);
    }
  }

  function handleStarterQuestion(q: string) {
    setQuestion(q);
    handleSubmit(q);
  }


  // ── Drag-and-drop upload ────────────────────────────────────────────────────

  function updateSystemMsg(id: string, patch: Partial<SystemMsg>) {
    setSystemMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }

  const MAX_FILE_SIZE_MB = 50;

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file || !datasetId) return;

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Datei zu groß",
        description: `Maximale Dateigröße: ${MAX_FILE_SIZE_MB} MB. Deine Datei hat ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      });
      return;
    }

    const msgId = crypto.randomUUID();
    setSystemMessages((prev) => [
      ...prev,
      { id: msgId, fileName: file.name, status: "uploading" },
    ]);

    try {
      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        },
      });

      updateSystemMsg(msgId, { status: "uploading" });

      // If there's an active project, show the scope picker before uploading the actual file
      if (activeAnalysisId) {
        setScopePickerChoice("all");
        setScopePicker({ file, uploadURL, objectPath, msgId });
        // Auto-confirm after 5 seconds on default option ("all")
        scopePickerTimerRef.current = setTimeout(() => {
          void completeScopedUpload({ file, uploadURL, objectPath, msgId }, "all");
          setScopePicker(null);
        }, 5000);
        return;
      }

      await doUpload(file, uploadURL, objectPath, msgId, null);
    } catch {
      updateSystemMsg(msgId, { status: "error" });
    }
  }

  async function doUpload(
    file: File,
    uploadURL: string,
    objectPath: string,
    msgId: string,
    attachToAnalysisId: string | null,
  ) {
    try {
      await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      const registered = await registerFile.mutateAsync({
        datasetId: datasetId!,
        data: {
          objectPath,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        },
      });

      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(datasetId!) });
      updateSystemMsg(msgId, {
        status: "processing",
        fileId: (registered as any).id ?? undefined,
      });

      // If scoped to a project, patch the analysis to attach this file
      if (attachToAnalysisId && (registered as any).id) {
        const currentAnalysis = queryClient.getQueryData(getGetAnalysisQueryKey(attachToAnalysisId)) as AnalysisDetail | undefined;
        const existingIds = currentAnalysis?.contextFileIds ?? [];
        const newId = (registered as any).id as string;
        if (!existingIds.includes(newId)) {
          updateAnalysis.mutate({
            analysisId: attachToAnalysisId,
            data: { contextFileIds: [...existingIds, newId] },
          }, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId!) });
              queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(attachToAnalysisId) });
            },
          });
        }
      }
    } catch {
      updateSystemMsg(msgId, { status: "error" });
    }
  }

  async function completeScopedUpload(
    data: { file: File; uploadURL: string; objectPath: string; msgId: string },
    scope: "all" | "project",
  ) {
    if (scopePickerTimerRef.current) {
      clearTimeout(scopePickerTimerRef.current);
      scopePickerTimerRef.current = null;
    }
    await doUpload(data.file, data.uploadURL, data.objectPath, data.msgId, scope === "project" ? activeAnalysisId : null);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  if (datasetLoading || !datasetId) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground">
        Laden…
      </div>
    );
  }

  const hasFiles = !!(files && files.length > 0);
  const isPending = createAnalysis.isPending || ask.isPending;

  // ── Neue Daten verfügbar detection ─────────────────────────────────────────

  const historicalFiles = (files ?? []) as unknown as FileItem[];
  const analysesListItems = analysesList ?? [];

  const autoAnalysis = analysesListItems.find((a) => (a as any).templateRef === "auto_erstanalyse" || a.source === "auto");
  const latestFileTime = historicalFiles.length > 0
    ? Math.max(...historicalFiles.map((f) => new Date(f.createdAt).getTime()))
    : 0;
  const autoAnalysisTime = autoAnalysis ? new Date((autoAnalysis as any).createdAt).getTime() : 0;
  const showNeueDatatenBanner =
    !neueDatatenDismissed &&
    autoAnalysis != null &&
    latestFileTime > autoAnalysisTime + 30_000; // 30s buffer for race

  // ── Scroll-to-bottom tracking ───────────────────────────────────────────────

  function handleChatScroll() {
    const el = chatScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollButton(distFromBottom > 100);
  }

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const scrollToBottomButton = showScrollButton ? (
    <button
      onClick={scrollToBottom}
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border shadow-md text-xs text-foreground hover:bg-accent transition-colors"
    >
      <ArrowDown className="w-3.5 h-3.5" />
      Zur neuesten Antwort
    </button>
  ) : null;

  // ── Shared sidebar panels (always visible, above scroll area) ────────────────

  const activeContextFileIds = analysis?.contextFileIds ?? [];

  const sidebarPanels = (
    <>
      <AnalysisHistoryPanel
        analyses={analysesListItems}
        activeAnalysisId={activeAnalysisId}
        latestFileUploadAt={latestFileTime}
        onSelect={(id) => { setActiveAnalysisId(id); pendingQuestionRef.current = ""; setPendingContextFileIds([]); setFilePickerOpen(false); }}
        onNew={handleNewAnalysis}
        onDeleteAnalysis={handleDeleteAnalysis}
        onUpdateAnalysis={handleUpdateAnalysis}
      />
      {activeAnalysisId && activeContextFileIds.length > 0 && (
        <ProjectFilesPanel
          files={historicalFiles}
          contextFileIds={activeContextFileIds}
          onRemove={(fileId) => {
            handleUpdateAnalysis(activeAnalysisId, {
              contextFileIds: activeContextFileIds.filter((id) => id !== fileId),
            });
          }}
        />
      )}
      <HistoricalFiles
        files={historicalFiles}
        onDeleteFile={handleDeleteFile}
        activeContextFileIds={activeContextFileIds}
        collapsed={filesCollapsed}
        onToggle={toggleFilesCollapsed}
      />
    </>
  );

  // ── New-project file picker block ─────────────────────────────────────────

  const newProjectFilePicker = !activeAnalysisId && (
    <div className="px-3 py-2 border-b border-border/60 shrink-0">
      <button
        onClick={() => setFilePickerOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider hover:text-muted-foreground transition-colors w-full"
      >
        <ChevronDown className={cn("w-3 h-3 transition-transform duration-150", !filePickerOpen && "-rotate-90")} />
        Dateien auswählen
        {pendingContextFileIds.length > 0 && (
          <span className="ml-1 text-primary font-bold">({pendingContextFileIds.length})</span>
        )}
      </button>
      {filePickerOpen && (
        <div className="mt-1.5 flex flex-col gap-1 max-h-32 overflow-y-auto">
          {historicalFiles.length === 0 && (
            <p className="text-xs text-muted-foreground/50 px-1">Keine Dateien vorhanden</p>
          )}
          {historicalFiles.map((f) => {
            const checked = pendingContextFileIds.includes(f.id);
            return (
              <label
                key={f.id}
                className="flex items-center gap-2 text-xs rounded px-1.5 py-1 cursor-pointer hover:bg-muted transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setPendingContextFileIds((prev) =>
                      checked ? prev.filter((id) => id !== f.id) : [...prev, f.id]
                    );
                  }}
                  className="rounded border-border accent-primary"
                />
                {fileKindIcon(f.kind)}
                <span className="flex-1 truncate text-foreground">{f.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Chat zone renderer ─────────────────────────────────────────────────────

  function renderChatContent() {
    if (!activeAnalysisId && !createAnalysis.isPending && systemMessages.length === 0) {
      return (
        <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
          {sidebarPanels}
          {newProjectFilePicker}
          {showNeueDatatenBanner && (
            <NeueDatatenBanner
              onDismiss={() => setNeueDatatenDismissed(true)}
              onNewAnalysis={handleNewAnalysis}
            />
          )}
          <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto min-h-0">
            <StarterQuestions
              hasFiles={hasFiles}
              datasetId={datasetId!}
              onTemplateRun={(id) => {
                setActiveAnalysisId(id);
                queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId!) });
                openSseStream(id);
              }}
              onAsk={handleStarterQuestion}
            />
            <div ref={bottomRef} />
          </div>
          {scrollToBottomButton}
        </div>
      );
    }

    if (createAnalysis.isPending && !activeAnalysisId) {
      return (
        <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
          {sidebarPanels}
          <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-5 min-h-0">
            {systemMessages.map((m) => (
              <SystemMessageBubble key={m.id} msg={m} />
            ))}
            <div className="flex gap-3 justify-end">
              <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm max-w-[80%]">
                {pendingQuestionRef.current || question}
              </div>
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
                <User className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
            </div>
            <AgentWorkingBanner currentStep={null} />
            <div ref={bottomRef} />
          </div>
          {scrollToBottomButton}
        </div>
      );
    }

    const msgs = analysis?.messages ?? [];

    // Determine if the last assistant message triggers a BackQuestionForm
    const lastAssistantMsg = [...msgs].reverse().find((m) => m.role === "assistant" && !m.error);
    const lastBackQuestionMsgId = (() => {
      if (isAgentWorking) return null;
      if (!lastAssistantMsg) return null;
      const qs = getMsgBackQuestions(lastAssistantMsg);
      return qs ? lastAssistantMsg.id : null;
    })();

    // For Fall B: embedded questions in a long result message (not a back-question bubble).
    // Only show if the very last message overall is still the assistant message — i.e. the user
    // hasn't replied yet (guards against re-appearing after page reload when there's already an answer).
    const embeddedFormQuestions = (() => {
      if (isAgentWorking) return null;
      if (!lastAssistantMsg) return null;
      if (msgIsBackQuestion(lastAssistantMsg)) return null;
      if (msgs[msgs.length - 1]?.id !== lastAssistantMsg.id) return null;
      if (answeredMsgIdsRef.current.has(lastAssistantMsg.id + "-embedded")) return null;
      return getMsgBackQuestions(lastAssistantMsg);
    })();

    return (
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        {sidebarPanels}
        <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
          <div className="space-y-5">
            {systemMessages.map((m) => (
              <SystemMessageBubble key={m.id} msg={m} />
            ))}

            {!analysis && activeAnalysisId ? (
              <div className="flex items-center justify-center h-16">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <>
              {msgs.length === 0 && isAgentWorking && pendingQuestionRef.current && (
                <div className="flex gap-3 justify-end">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm max-w-[80%]">
                    {pendingQuestionRef.current}
                  </div>
                  <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
                    <User className="w-3.5 h-3.5 text-primary-foreground" />
                  </div>
                </div>
              )}
              {msgs.map((msg, idx) => {
                const isLast = idx === msgs.length - 1;
                // Assistant results (not errors, not back-questions) go to the right panel — skip here
                if (msg.role === "assistant" && !msg.error && !msgIsBackQuestion(msg)) {
                  return null;
                }
                // Fall A: last back-question bubble → replace with interactive form.
                // Guard with answeredMsgIdsRef so the form can't re-appear during the race window
                // between ask.mutate settling and the next agentProgress poll.
                if (
                  msg.role === "assistant" &&
                  !msg.error &&
                  isLast &&
                  msg.id === lastBackQuestionMsgId &&
                  !answeredMsgIdsRef.current.has(msg.id)
                ) {
                  const qs = getMsgBackQuestions(msg)!;
                  return (
                    <BackQuestionForm
                      key={msg.id}
                      questions={qs}
                      onSubmit={(answer) => {
                        answeredMsgIdsRef.current.add(msg.id);
                        handleSubmit(answer);
                      }}
                    />
                  );
                }
                // Bug 3: suppress old back-question messages in history — they rendered as a plain
                // chat bubble showing raw question text; the user's answer below provides context.
                if (msg.role === "assistant" && !msg.error && msgIsBackQuestion(msg)) {
                  return null;
                }
                return (
                  <div key={msg.id}>
                    {msg.role === "user" && msg.imageObjectPath && (
                      <ChatImageThumbnail objectPath={msg.imageObjectPath} />
                    )}
                    <MessageBubble
                      msg={msg}
                      isNew={isNewMessage(msg)}
                      isLast={isLast}
                      isAgentWorking={isAgentWorking}
                    />
                    {msg.role === "user" && (() => {
                      const nextMsg = msgs[idx + 1];
                      if (nextMsg?.role === "assistant" && !nextMsg.error) {
                        return <FeedbackBar key={`fb-${nextMsg.id}`} messageId={nextMsg.id} />;
                      }
                      return null;
                    })()}
                  </div>
                );
              })}

              {/* Fall B: long result message with embedded numbered questions */}
              {embeddedFormQuestions && (
                <BackQuestionForm
                  key={lastAssistantMsg!.id + "-embedded"}
                  questions={embeddedFormQuestions}
                  onSubmit={(answer) => {
                    answeredMsgIdsRef.current.add(lastAssistantMsg!.id + "-embedded");
                    handleSubmit(answer);
                  }}
                />
              )}
              </>
            )}

            {isAgentWorking && streaming.sources.length > 0 && (
              <LiveSourcesActivity sources={streaming.sources} />
            )}
            {isAgentWorking && completedSteps.length > 0 ? (
              <AgentStepsTimeline completedSteps={completedSteps} currentStep={currentStep} />
            ) : isAgentWorking ? (
              <AgentWorkingBanner currentStep={currentStep} />
            ) : null}

            {!isAgentWorking &&
              ((lastAssistantMsg?.followUpQuestions as string[] | null | undefined)?.length ?? 0) > 0 && (
                <FollowUpChips
                  questions={lastAssistantMsg!.followUpQuestions as string[]}
                  onAsk={(q) => {
                    setQuestion(q);
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                />
              )}

            <div ref={bottomRef} />
          </div>
        </div>
        {scrollToBottomButton}
      </div>
    );
  }

  const chatInputArea = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className="p-3 bg-card/80 backdrop-blur-sm border-t border-border shrink-0"
      style={keyboardOffset > 0 ? { paddingBottom: `${keyboardOffset + 12}px` } : undefined}
    >
      {chatQuotaExceeded && (
        <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">Analyse-Kontingent erschöpft</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Monatslimit erreicht.{" "}
              <a href="/app/settings" className="underline font-medium hover:text-amber-900">
                Tarif upgraden
              </a>{" "}
              für weitere Analysen.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setChatQuotaExceeded(false)}
            className="shrink-0 text-amber-500 hover:text-amber-700 leading-none"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
      )}
      {/* Image preview above the input row */}
      {pendingImage && (
        <div className="mb-2 flex items-center gap-2">
          <div className="relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-border bg-muted">
            <img src={pendingImage.preview} alt="Bild-Vorschau" className="w-full h-full object-cover" />
            {pendingImage.uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (pendingImage.preview) URL.revokeObjectURL(pendingImage.preview);
              setPendingImage(null);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Bild entfernen"
          >
            <X className="w-4 h-4" />
          </button>
          <span className="text-xs text-muted-foreground truncate max-w-[120px]">
            {pendingImage.uploading ? "Wird hochgeladen…" : pendingImage.file.name}
          </span>
        </div>
      )}
      <div className="flex gap-2 items-center">
        {/* Hidden file input for image selection */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageSelect(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={isPending || chatQuotaExceeded || !!pendingImage}
          title="Bild anhängen (JPEG, PNG, WEBP, max. 20 MB)"
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ImagePlus className="w-4 h-4" />
        </button>
        <Input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, 4_000))}
          maxLength={4_000}
          placeholder={
            activeAnalysisId
              ? "Folgefrage stellen…"
              : "Stelle eine Frage zu deinen Daten…"
          }
          className="flex-1 rounded-xl border-border/60 bg-card shadow-inner focus-within:ring-2 focus-within:ring-primary/30 h-11"
          disabled={isPending || chatQuotaExceeded}
        />
        <Button
          type="submit"
          data-testid="question-submit"
          size="icon"
          className="w-11 h-11 shrink-0"
          disabled={isPending || chatQuotaExceeded || !question.trim() || pendingImage?.uploading}
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
      {/* Depth level selector — shown when there's no active analysis yet */}
      {!activeAnalysisId && (
        <div className="flex items-center gap-1.5 mt-2 px-1">
          <span className="text-xs text-muted-foreground/70 shrink-0">Analysetiefe:</span>
          {([
            { value: "quick" as const, label: "Schnelle Antwort" },
            { value: "deep" as const, label: "Ausführliche Analyse" },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setPendingDepthLevel(value)}
              className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
                pendingDepthLevel === value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Depth level badge — shown on existing analysis */}
      {activeAnalysisId && analysis && (
        <div className="flex items-center gap-1.5 mt-2 px-1">
          <span className="text-xs text-muted-foreground/70 shrink-0">Analysetiefe:</span>
          {([
            { value: "quick" as const, label: "Schnelle Antwort" },
            { value: "deep" as const, label: "Ausführliche Analyse" },
          ] as const).map(({ value, label }) => {
            const current = (analysis as any).depthLevel as "quick" | "deep" | null;
            // Treat null (legacy analyses) as "quick" for display purposes
            const isActive = (current ?? "quick") === value;
            return (
              <button
                key={String(value)}
                type="button"
                onClick={() => handleUpdateAnalysis(activeAnalysisId, { depthLevel: value })}
                className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {!activeAnalysisId && (
        <p className="hidden md:block text-xs text-muted-foreground mt-1.5 px-1">
          Tipp: Dateien direkt auf diese Seite ziehen zum Hochladen
        </p>
      )}
      <p className="text-xs text-muted-foreground/70 mt-1.5 px-1 text-center">
        KI-Analysen können Fehler enthalten – bitte Ergebnisse stets fachlich prüfen.
      </p>
    </form>
  );

  // ── File pollers (rendered for each processing file) ──────────────────────
  const filePollers = systemMessages
    .filter((m) => m.status === "processing" && m.fileId)
    .map((m) => (
      <FilePoller
        key={m.fileId}
        fileId={m.fileId!}
        onDone={(result) => {
          updateSystemMsg(m.id, { status: result });
          if (result === "ready") {
            queryClient.invalidateQueries({
              queryKey: getListFilesQueryKey(datasetId),
            });
          }
        }}
      />
    ));

  return (
    <div
      className="flex h-full relative overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file pollers */}
      {filePollers}

      {/* Drag-and-drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
          <div className="bg-background rounded-xl px-8 py-6 text-center shadow-lg">
            <UploadCloud className="w-10 h-10 text-primary mx-auto mb-2" />
            <p className="font-semibold text-foreground">Datei hier ablegen</p>
            <p className="text-sm text-muted-foreground mt-1">Excel, CSV oder PDF</p>
          </div>
        </div>
      )}

      {/* Upload scope picker */}
      {scopePicker && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-background rounded-xl border border-border shadow-xl p-4 w-72">
            <p className="text-sm font-semibold mb-1">Datei hochladen: {scopePicker.file.name}</p>
            <p className="text-xs text-muted-foreground mb-3">Für welche Analysen soll diese Datei gelten?</p>
            <div className="flex flex-col gap-2 mb-3">
              <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-border px-3 py-2 hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="scope"
                  value="all"
                  checked={scopePickerChoice === "all"}
                  onChange={() => setScopePickerChoice("all")}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">Für alle Analysen</p>
                  <p className="text-xs text-muted-foreground">Standard – Datei steht in allen Projekten zur Verfügung</p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-border px-3 py-2 hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="scope"
                  value="project"
                  checked={scopePickerChoice === "project"}
                  onChange={() => setScopePickerChoice("project")}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">Nur für dieses Projekt</p>
                  <p className="text-xs text-muted-foreground">Datei wird dem aktuellen Projekt zugeordnet</p>
                </div>
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const data = scopePicker;
                  setScopePicker(null);
                  void completeScopedUpload(data, scopePickerChoice);
                }}
              >
                Bestätigen
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-2 text-right">
              Automatisch in 5 Sek. mit „Für alle" fortfahren
            </p>
          </div>
        </div>
      )}

      {/* ── Desktop layout ─────────────────────────────────────────────────── */}
      <div className={cn("hidden md:flex w-full h-full", isDraggingPanel && "select-none")}>
        {/* Chat zone */}
        <div
          className="shrink-0 flex flex-col border-r border-border"
          style={{ width: chatWidth }}
        >
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {renderChatContent()}
          </div>
          {chatInputArea}
        </div>

        {/* Drag handle */}
        <div
          className={cn(
            "w-1 shrink-0 cursor-col-resize hover:bg-primary/40 transition-colors",
            isDraggingPanel ? "bg-primary/50" : "bg-border"
          )}
          onMouseDown={handlePanelDragStart}
        />

        {/* Results panel */}
        <div className="flex-1 flex flex-col bg-background min-w-0">
          <div className="px-4 py-2 border-b border-border shrink-0 bg-muted/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Ergebnisse
            </span>
            {analysis?.title && (
              <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{analysis.title}</p>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <AnalysisResultsPanel analysis={analysis} isWorking={isAgentWorking} pendingQuestion={pendingQuestionRef.current} streamingText={streaming.text} streamingCharts={streaming.charts} onFollowUpClick={(q) => { handleSubmit(q); }} />
          </div>
        </div>
      </div>

      {/* ── Mobile layout ──────────────────────────────────────────────────── */}
      <div className="flex md:hidden flex-col w-full h-full overflow-hidden">
        {/* Mobile tab content */}
        <div
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
          onTouchStart={handleMobileContentTouchStart}
          onTouchEnd={handleMobileContentTouchEnd}
        >
          {mobileTab === "chat" ? (
            <>
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {renderChatContent()}
              </div>
              {chatInputArea}
            </>
          ) : (
            <div className="flex-1 min-h-0">
              <AnalysisResultsPanel analysis={analysis} isWorking={isAgentWorking} pendingQuestion={pendingQuestionRef.current} streamingText={streaming.text} streamingCharts={streaming.charts} onFollowUpClick={(q) => { handleSubmit(q); }} />
            </div>
          )}
        </div>

        {/* Mobile bottom tab bar */}
        <div className="shrink-0 flex border-t border-border bg-background pb-safe">
          <button
            onClick={() => setMobileTab("chat")}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs transition-colors min-h-[56px]",
              mobileTab === "chat"
                ? "text-primary border-t-2 border-primary"
                : "text-muted-foreground",
            )}
          >
            <MessageSquare className="w-5 h-5" />
            Chat
          </button>
          <button
            onClick={() => setMobileTab("chart")}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs transition-colors relative min-h-[56px]",
              mobileTab === "chart"
                ? "text-primary border-t-2 border-primary"
                : "text-muted-foreground",
            )}
          >
            <TrendingUp className="w-5 h-5" />
            Ergebnisse
            {isAgentWorking && (
              <span className="absolute top-2 right-[calc(50%-12px)] w-2 h-2 rounded-full bg-primary animate-pulse" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
