import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle, ThumbsDown, ThumbsUp, ChevronRight, ChevronLeft,
  MessageSquare, User, Wrench, Clock, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type TranscriptSummary = {
  analysis_id: string;
  title: string;
  analysis_created_at: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  question_count: number;
  answer_count: number;
  has_escalation: boolean;
  last_escalation_type: string | null;
  thumbs_down_count: number;
  thumbs_up_count: number;
  last_activity: string;
};

type ToolLog = {
  id: string;
  toolName: string;
  keyParams: Record<string, unknown> | null;
  durationMs: number | null;
  escalationTrigger: string | null;
  escalationReason: string | null;
  createdAt: string;
};

type FeedbackEntry = {
  id: string;
  messageId: string;
  userId: string;
  rating: "up" | "down";
  comment: string | null;
  createdAt: string;
} | null;

type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  content: string | null;
  citations: Array<{ label: string; value: string; sourceType?: string }>;
  createdAt: string;
  toolLogs: ToolLog[];
  feedback: FeedbackEntry;
};

type TranscriptDetail = {
  analysisId: string;
  title: string;
  userEmail: string;
  userName: string | null;
  userId: string;
  createdAt: string;
  messages: TranscriptMessage[];
};

function useApiAuth() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  };
}

function useTranscripts(filters: { userId?: string; escalated?: string; thumbsDown?: string }) {
  const getHeaders = useApiAuth();
  return useQuery({
    queryKey: ["beta-transcripts", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.userId) params.set("userId", filters.userId);
      if (filters.escalated && filters.escalated !== "all") params.set("escalated", filters.escalated);
      if (filters.thumbsDown && filters.thumbsDown !== "all") params.set("thumbsDown", filters.thumbsDown);
      const headers = await getHeaders();
      const res = await fetch(`${API_BASE}/api/admin/beta/transcripts?${params}`, { headers });
      if (!res.ok) throw new Error("Fehler beim Laden der Transkripte");
      return res.json() as Promise<TranscriptSummary[]>;
    },
  });
}

function useTranscriptDetail(analysisId: string | null) {
  const getHeaders = useApiAuth();
  return useQuery({
    queryKey: ["beta-transcript-detail", analysisId],
    enabled: !!analysisId,
    queryFn: async () => {
      const headers = await getHeaders();
      const res = await fetch(`${API_BASE}/api/admin/beta/transcripts/${analysisId}`, { headers });
      if (!res.ok) throw new Error("Fehler beim Laden des Transkripts");
      return res.json() as Promise<TranscriptDetail>;
    },
  });
}

function EscalationBadge({ trigger }: { trigger: string | null }) {
  if (!trigger) return null;
  const colors: Record<string, string> = {
    "Werkzeugkonflikt": "bg-orange-100 text-orange-800 border-orange-200",
    "Investitionsschwelle": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Markenwiederholung": "bg-blue-100 text-blue-800 border-blue-200",
    "Sicherheitsrelevante Frage": "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border", colors[trigger] ?? "bg-gray-100 text-gray-700")}>
      <AlertTriangle className="w-3 h-3" />
      {trigger}
    </span>
  );
}

function ToolLogRow({ log }: { log: ToolLog }) {
  const isEscalation = !!log.escalationTrigger;
  return (
    <div className={cn("flex items-start gap-2 text-xs py-1 px-2 rounded", isEscalation ? "bg-red-50" : "bg-muted/30")}>
      <Wrench className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
      <span className="font-mono text-muted-foreground shrink-0">{log.toolName}</span>
      {log.keyParams && Object.keys(log.keyParams).length > 0 && (
        <span className="text-muted-foreground truncate">
          {Object.entries(log.keyParams).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}
        </span>
      )}
      {log.durationMs != null && (
        <span className="ml-auto shrink-0 flex items-center gap-1 text-muted-foreground">
          <Clock className="w-2.5 h-2.5" />{log.durationMs}ms
        </span>
      )}
      {isEscalation && (
        <EscalationBadge trigger={log.escalationTrigger} />
      )}
    </div>
  );
}

function MessageCard({ msg }: { msg: TranscriptMessage }) {
  const [showTools, setShowTools] = useState(false);
  const isAssistant = msg.role === "assistant";

  return (
    <div className={cn("flex gap-3", isAssistant ? "justify-start" : "justify-end")}>
      {isAssistant && (
        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
          <MessageSquare className="w-3 h-3 text-primary" />
        </div>
      )}
      <div className={cn("max-w-[85%] space-y-1", isAssistant ? "" : "items-end flex flex-col")}>
        <div className={cn(
          "rounded-xl px-3 py-2 text-sm",
          isAssistant ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground"
        )}>
          <p className="whitespace-pre-wrap leading-relaxed">{msg.content ?? ""}</p>
        </div>

        {isAssistant && (
          <>
            {msg.citations.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {msg.citations.map((c, i) => (
                  <span key={i} className="text-[10px] bg-primary/5 border border-primary/20 text-primary px-2 py-0.5 rounded-full">
                    {c.label}: {c.value}
                  </span>
                ))}
              </div>
            )}

            {msg.toolLogs.length > 0 && (
              <div className="mt-1">
                <button
                  onClick={() => setShowTools(!showTools)}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Wrench className="w-2.5 h-2.5" />
                  {msg.toolLogs.length} Tool-Aufruf{msg.toolLogs.length !== 1 ? "e" : ""}
                  {msg.toolLogs.some((t) => t.escalationTrigger) && (
                    <span className="ml-1 text-red-500 font-medium">· Eskalation</span>
                  )}
                  {showTools ? <ChevronLeft className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                </button>
                {showTools && (
                  <div className="mt-1 space-y-0.5">
                    {msg.toolLogs.map((log) => <ToolLogRow key={log.id} log={log} />)}
                  </div>
                )}
              </div>
            )}

            {msg.feedback && (
              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium",
                  msg.feedback.rating === "up"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                )}>
                  {msg.feedback.rating === "up" ? <ThumbsUp className="w-3 h-3" /> : <ThumbsDown className="w-3 h-3" />}
                  {msg.feedback.rating === "up" ? "Positiv" : "Negativ"}
                </span>
                {msg.feedback.comment && (
                  <span className="text-[11px] text-muted-foreground italic truncate max-w-xs">
                    „{msg.feedback.comment}"
                  </span>
                )}
              </div>
            )}
          </>
        )}

        <span className="text-[10px] text-muted-foreground">
          {format(new Date(msg.createdAt), "dd.MM. HH:mm", { locale: de })}
        </span>
      </div>
      {!isAssistant && (
        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
          <User className="w-3 h-3 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function TranscriptDetail({ analysisId, onBack }: { analysisId: string; onBack: () => void }) {
  const { data, isLoading } = useTranscriptDetail(analysisId);

  if (isLoading) return (
    <div className="p-6 text-center text-muted-foreground text-sm">Lade Transkript...</div>
  );
  if (!data) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="w-4 h-4" /> Zurück
        </Button>
        <div>
          <h2 className="font-semibold text-sm">{data.title}</h2>
          <p className="text-xs text-muted-foreground">
            {data.userEmail} · {format(new Date(data.createdAt), "dd.MM.yyyy", { locale: de })}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {data.messages.map((msg) => <MessageCard key={msg.id} msg={msg} />)}
      </div>
    </div>
  );
}

import { PageLayout } from "@/components/PageLayout";

export default function BetaTranscriptsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState("");
  const [escalatedFilter, setEscalatedFilter] = useState("all");
  const [thumbsDownFilter, setThumbsDownFilter] = useState("all");

  const activeFilters = {
    userId: userFilter.trim() || undefined,
    escalated: escalatedFilter !== "all" ? escalatedFilter : undefined,
    thumbsDown: thumbsDownFilter !== "all" ? thumbsDownFilter : undefined,
  };

  const { data: transcripts, isLoading } = useTranscripts(activeFilters);

  if (selectedId) {
    return (
      <div className="h-full">
        <TranscriptDetail analysisId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <PageLayout size="narrow">
      <div>
        <h1 className="text-xl font-semibold">Beta-Transkripte</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Konversationen eingeladener Beta-Testnutzer — nur für Betreiber sichtbar.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Nutzer-E-Mail filtern..."
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="w-56 h-8 text-sm"
        />
        <Select value={escalatedFilter} onValueChange={setEscalatedFilter}>
          <SelectTrigger className="w-40 h-8 text-sm">
            <Filter className="w-3 h-3 mr-1" />
            <SelectValue placeholder="Eskalation" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="true">Nur mit Eskalation</SelectItem>
          </SelectContent>
        </Select>
        <Select value={thumbsDownFilter} onValueChange={setThumbsDownFilter}>
          <SelectTrigger className="w-44 h-8 text-sm">
            <ThumbsDown className="w-3 h-3 mr-1" />
            <SelectValue placeholder="Feedback" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="true">Nur Daumen runter</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Lade Transkripte...</div>
      ) : !transcripts?.length ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          Keine Beta-Transkripte gefunden.
        </div>
      ) : (
        <div className="space-y-2">
          {transcripts.map((t) => (
            <button
              key={t.analysis_id}
              onClick={() => setSelectedId(t.analysis_id)}
              className="w-full text-left rounded-lg border bg-card p-4 hover:bg-accent transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{t.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.user_email}
                    {t.user_name && ` (${t.user_name})`}
                    {" · "}
                    {format(new Date(t.last_activity), "dd.MM.yyyy", { locale: de })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {t.has_escalation && (
                    <EscalationBadge trigger={t.last_escalation_type} />
                  )}
                  {Number(t.thumbs_down_count) > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
                      <ThumbsDown className="w-2.5 h-2.5" /> {t.thumbs_down_count}
                    </span>
                  )}
                  {Number(t.thumbs_up_count) > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
                      <ThumbsUp className="w-2.5 h-2.5" /> {t.thumbs_up_count}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> {t.question_count}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
