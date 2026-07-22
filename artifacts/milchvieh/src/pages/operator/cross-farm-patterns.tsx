import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthToken } from "@workspace/api-client-react";
import {
  TrendingUp,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  Check,
  X,
  Edit2,
  Save,
  Users,
  BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type PatternStatus = "pending" | "approved" | "rejected";

interface CrossFarmPattern {
  id: string;
  kpiName: string;
  changeDescription: string | null;
  baselineValue: number | null;
  afterValue: number | null;
  avgImprovement: number | null;
  sampleSize: number;
  observationPeriodMonths: number | null;
  patternStatement: string | null;
  patternKey: string | null;
  reviewNotes: string | null;
  relevanceTags: string[] | null;
  status: PatternStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

async function authFetch(path: string, opts?: RequestInit): Promise<Response> {
  const token = await getAuthToken();
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const STATUS_CONFIG: Record<
  PatternStatus,
  { label: string; color: string; icon: React.ElementType }
> = {
  pending: { label: "Ausstehend", color: "bg-yellow-50 text-yellow-700 border-yellow-200", icon: Clock },
  approved: { label: "Freigegeben", color: "bg-green-50 text-green-700 border-green-200", icon: CheckCircle2 },
  rejected: { label: "Abgelehnt", color: "bg-red-50 text-red-700 border-red-200", icon: XCircle },
};

function PatternCard({
  pattern,
  onApprove,
  onReject,
  onUpdate,
  isApproving,
  isRejecting,
  isUpdating,
}: {
  pattern: CrossFarmPattern;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onUpdate: (id: string, patch: { patternStatement?: string; reviewNotes?: string; patternKey?: string }) => void;
  isApproving: boolean;
  isRejecting: boolean;
  isUpdating: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(pattern.patternStatement ?? "");
  const [notes, setNotes] = useState(pattern.reviewNotes ?? "");
  const [patternKey, setPatternKey] = useState(pattern.patternKey ?? "");

  const cfg = STATUS_CONFIG[pattern.status];
  const StatusIcon = cfg.icon;
  const isPending = pattern.status === "pending";

  const improvement = pattern.avgImprovement;
  const improvStr =
    improvement != null
      ? `${improvement > 0 ? "+" : ""}${improvement.toFixed(1)} pp`
      : "–";

  const handleSave = () => {
    onUpdate(pattern.id, { patternStatement: statement, reviewNotes: notes, patternKey });
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-5 space-y-4",
        pattern.status === "rejected" && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground capitalize">
              {pattern.kpiName.replace(/_/g, " ")}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5",
                cfg.color,
              )}
            >
              <StatusIcon className="w-3 h-3" />
              {cfg.label}
            </span>
            {improvement != null && (
              <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">
                <TrendingUp className="w-3 h-3" />
                Ø {improvStr}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Erkannt: {formatDate(pattern.createdAt)}
            {pattern.reviewedAt && ` · Geprüft: ${formatDate(pattern.reviewedAt)}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div className="rounded-md bg-secondary/30 p-2 space-y-0.5">
          <p className="text-xs text-muted-foreground">Vorher</p>
          <p className="font-medium">
            {pattern.baselineValue != null ? `${pattern.baselineValue.toFixed(1)}%` : "–"}
          </p>
        </div>
        <div className="rounded-md bg-secondary/30 p-2 space-y-0.5">
          <p className="text-xs text-muted-foreground">Nachher</p>
          <p className="font-medium">
            {pattern.afterValue != null ? `${pattern.afterValue.toFixed(1)}%` : "–"}
          </p>
        </div>
        <div className="rounded-md bg-secondary/30 p-2 space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="w-3 h-3" /> Betriebe
          </p>
          <p className="font-medium">{pattern.sampleSize}</p>
        </div>
        <div className="rounded-md bg-secondary/30 p-2 space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <BarChart2 className="w-3 h-3" /> Monate
          </p>
          <p className="font-medium">{pattern.observationPeriodMonths ?? "–"}</p>
        </div>
      </div>

      {pattern.changeDescription && (
        <div className="text-sm">
          <span className="text-muted-foreground font-medium">Kontextuelle Veränderung: </span>
          <span className="text-foreground">{pattern.changeDescription}</span>
        </div>
      )}

      {pattern.relevanceTags && pattern.relevanceTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pattern.relevanceTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Musteraussage für Nutzer
          </p>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={() => setEditing(true)}
            >
              <Edit2 className="w-3 h-3" />
              Bearbeiten
            </Button>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="Anonymisierte, fachlich geprüfte Musteraussage für Nutzer (Pflichtfeld vor Freigabe)"
              className="text-sm min-h-[80px]"
            />
            <Input
              value={patternKey}
              onChange={(e) => setPatternKey(e.target.value)}
              placeholder="Muster-Schlüssel (optional, z.B. hitze_kr_sommer)"
              className="text-sm"
            />
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Interne Fachnotiz (nicht für Nutzer sichtbar)"
              className="text-sm min-h-[60px]"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1"
                onClick={handleSave}
                disabled={isUpdating}
              >
                <Save className="w-3 h-3" />
                Speichern
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setEditing(false); setStatement(pattern.patternStatement ?? ""); setNotes(pattern.reviewNotes ?? ""); }}
              >
                Abbrechen
              </Button>
            </div>
          </div>
        ) : (
          <p className={cn("text-sm", statement ? "text-foreground" : "text-muted-foreground italic")}>
            {statement || "Noch keine Musteraussage eingetragen — vor Freigabe erforderlich."}
          </p>
        )}
        {!editing && notes && (
          <p className="text-xs text-muted-foreground border-t pt-2">
            <span className="font-medium">Interne Notiz:</span> {notes}
          </p>
        )}
      </div>

      {isPending && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="gap-1"
            onClick={() => onApprove(pattern.id)}
            disabled={isApproving || isRejecting}
          >
            <Check className="w-4 h-4" />
            Freigeben
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-destructive hover:bg-destructive/5 border-destructive/30"
            onClick={() => onReject(pattern.id)}
            disabled={isApproving || isRejecting}
          >
            <X className="w-4 h-4" />
            Ablehnen
          </Button>
        </div>
      )}
    </div>
  );
}

export function CrossFarmPatternsOperatorPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("pending");

  const { data: patterns = [], isLoading, refetch } = useQuery<CrossFarmPattern[]>({
    queryKey: ["admin-cross-farm-patterns", statusFilter],
    queryFn: async () => {
      const res = await authFetch(
        `/api/admin/cross-farm-patterns?status=${statusFilter}`,
      );
      if (!res.ok) throw new Error("Fehler beim Laden");
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/admin/cross-farm-patterns/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Fehler");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-cross-farm-patterns"] }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/admin/cross-farm-patterns/${id}/reject`, { method: "POST" });
      if (!res.ok) throw new Error("Fehler");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-cross-farm-patterns"] }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const res = await authFetch(`/api/admin/cross-farm-patterns/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Fehler");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-cross-farm-patterns"] }),
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/admin/cron/run-pattern-extraction", { method: "POST" });
      if (!res.ok) throw new Error("Fehler");
      return res.json();
    },
    onSuccess: () => setTimeout(() => refetch(), 3000),
  });

  const STATUS_FILTERS = [
    { value: "pending", label: "Ausstehend" },
    { value: "approved", label: "Freigegeben" },
    { value: "rejected", label: "Abgelehnt" },
    { value: "all", label: "Alle" },
  ];

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            Betriebsübergreifende Muster
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Wöchentlich extrahierte Kandidaten — fachlich prüfen und freigeben.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => extractMutation.mutate()}
          disabled={extractMutation.isPending}
        >
          <RefreshCw className={cn("w-4 h-4", extractMutation.isPending && "animate-spin")} />
          Jetzt extrahieren
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              "px-3 py-1 rounded-full text-sm border transition-colors",
              statusFilter === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:border-primary/40",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Wird geladen…
        </div>
      )}

      {!isLoading && patterns.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="font-medium">Keine Muster vorhanden</p>
          <p className="text-sm mt-1">
            Der wöchentliche Batch-Extractor legt Kandidaten sonntags an.
            Manuell über „Jetzt extrahieren" auslösen.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {patterns.map((pattern) => (
          <PatternCard
            key={pattern.id}
            pattern={pattern}
            onApprove={(id) => approveMutation.mutate(id)}
            onReject={(id) => rejectMutation.mutate(id)}
            onUpdate={(id, patch) => updateMutation.mutate({ id, patch })}
            isApproving={approveMutation.isPending}
            isRejecting={rejectMutation.isPending}
            isUpdating={updateMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}
