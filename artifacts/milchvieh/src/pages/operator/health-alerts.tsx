import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthToken } from "@workspace/api-client-react";
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  Clock,
  Check,
  X,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type AlertStatus = "pending" | "approved" | "rejected";

interface HealthAlert {
  id: string;
  sourceKey: string;
  topic: string;
  title: string;
  summary: string;
  sourceUrl: string;
  officialDate: string | null;
  status: AlertStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  fetchedAt: string;
  affectedSpecies?: string[] | null;
}

const ALL_SPECIES = ["milchvieh", "schweine", "geflügel", "ackerbau", "allgemein"] as const;
type Species = typeof ALL_SPECIES[number];

const SPECIES_LABELS: Record<string, string> = {
  milchvieh: "Milchvieh",
  schweine:  "Schweine",
  geflügel:  "Geflügel",
  ackerbau:  "Ackerbau",
  allgemein: "Allgemein",
};

const SPECIES_COLORS: Record<string, string> = {
  milchvieh: "bg-blue-50 text-blue-700 border-blue-200",
  schweine:  "bg-pink-50 text-pink-700 border-pink-200",
  geflügel:  "bg-orange-50 text-orange-700 border-orange-200",
  ackerbau:  "bg-lime-50 text-lime-700 border-lime-200",
  allgemein: "bg-gray-50 text-gray-600 border-gray-200",
};

const SPECIES_ACTIVE_COLORS: Record<string, string> = {
  milchvieh: "bg-blue-600 text-white border-blue-600",
  schweine:  "bg-pink-600 text-white border-pink-600",
  geflügel:  "bg-orange-500 text-white border-orange-500",
  ackerbau:  "bg-lime-600 text-white border-lime-600",
  allgemein: "bg-gray-500 text-white border-gray-500",
};

const SOURCE_LABELS: Record<string, string> = {
  fli: "FLI (bundesweit)",
  laves_nds: "LAVES Niedersachsen",
};

const SOURCE_COLORS: Record<string, string> = {
  fli: "bg-blue-50 text-blue-700 border-blue-200",
  laves_nds: "bg-green-50 text-green-700 border-green-200",
};

function formatDate(iso: string | null): string {
  if (!iso) return "–";
  try {
    if (iso.length === 10) {
      const [y, m, d] = iso.split("-");
      return `${d}.${m}.${y}`;
    }
    return new Date(iso).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
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

function SpeciesEditor({
  alertId,
  current,
  onSaved,
}: {
  alertId: string;
  current: string[];
  onSaved: (species: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    current.length > 0 ? current : ["allgemein"],
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (s: Species) => {
    setSaved(false);
    setSelected((prev) =>
      prev.includes(s) ? (prev.length > 1 ? prev.filter((x) => x !== s) : prev) : [...prev, s],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const resp = await authFetch(`/api/health-alerts/operator/${alertId}`, {
        method: "PATCH",
        body: JSON.stringify({ affectedSpecies: selected }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Fehler beim Speichern");
      }
      setSaved(true);
      onSaved(selected);
    } catch (e: any) {
      setError(e.message ?? "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  };

  const isDirty =
    selected.slice().sort().join(",") !== current.slice().sort().join(",");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {ALL_SPECIES.map((s) => {
          const active = selected.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded border transition-colors cursor-pointer",
                active
                  ? (SPECIES_ACTIVE_COLORS[s] ?? "bg-gray-500 text-white border-gray-500")
                  : (SPECIES_COLORS[s] ?? "bg-gray-50 text-gray-600 border-gray-200"),
              )}
            >
              {SPECIES_LABELS[s]}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
      {isDirty && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px] self-start"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <RefreshCw className="w-3 h-3 animate-spin mr-1" />
          ) : saved ? (
            <Check className="w-3 h-3 mr-1 text-green-600" />
          ) : null}
          Tierart speichern
        </Button>
      )}
      {saved && !isDirty && (
        <p className="text-[11px] text-green-700 flex items-center gap-1">
          <Check className="w-3 h-3" /> Gespeichert
        </p>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  alert: HealthAlert;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const [localSpecies, setLocalSpecies] = useState<string[]>(
    (alert.affectedSpecies ?? []).length > 0
      ? (alert.affectedSpecies as string[])
      : ["allgemein"],
  );

  const sourceLabel = SOURCE_LABELS[alert.sourceKey] ?? alert.sourceKey;
  const sourceCls =
    SOURCE_COLORS[alert.sourceKey] ?? "bg-gray-50 text-gray-700 border-gray-200";

  return (
    <div
      className={cn(
        "border rounded-xl p-4 space-y-3 transition-opacity",
        alert.status === "approved" && "border-green-200 bg-green-50/30",
        alert.status === "rejected" && "border-border bg-muted/20 opacity-60",
        alert.status === "pending" && "border-amber-200 bg-amber-50/20",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          {alert.status === "approved" ? (
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          ) : alert.status === "rejected" ? (
            <XCircle className="w-5 h-5 text-muted-foreground" />
          ) : (
            <Clock className="w-5 h-5 text-amber-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded border",
                sourceCls,
              )}
            >
              {sourceLabel}
            </span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded border bg-secondary text-muted-foreground">
              {alert.topic}
            </span>
            {alert.officialDate && (
              <span className="text-[11px] text-muted-foreground">
                Amtlich: {formatDate(alert.officialDate)}
              </span>
            )}
          </div>

          {/* Current species badges (read-only display) */}
          {localSpecies.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {localSpecies.map((s) => (
                <span
                  key={s}
                  className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded border",
                    SPECIES_COLORS[s] ?? "bg-gray-50 text-gray-600 border-gray-200",
                  )}
                >
                  {SPECIES_LABELS[s] ?? s}
                </span>
              ))}
            </div>
          )}

          <h3 className="text-sm font-semibold text-foreground leading-snug">
            {alert.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {alert.summary}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <a
              href={alert.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Originalquelle
            </a>
            <span className="text-[11px] text-muted-foreground/60">
              Gefetcht: {formatDate(alert.fetchedAt)}
            </span>
          </div>

          {/* Species editor — always visible for operators */}
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-[11px] text-muted-foreground mb-1.5 font-medium">
              Tierart-Zuweisung (klicken zum Aktivieren/Deaktivieren):
            </p>
            <SpeciesEditor
              alertId={alert.id}
              current={localSpecies}
              onSaved={setLocalSpecies}
            />
          </div>
        </div>
      </div>

      {alert.status === "pending" && (
        <div className="flex items-center gap-2 pt-1 border-t border-amber-200/60">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={() => onApprove(alert.id)}
            disabled={isApproving || isRejecting}
          >
            {isApproving ? (
              <RefreshCw className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Check className="w-3 h-3 mr-1" />
            )}
            Bestätigen &amp; veröffentlichen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => onReject(alert.id)}
            disabled={isApproving || isRejecting}
          >
            <X className="w-3 h-3 mr-1" />
            Ablehnen
          </Button>
        </div>
      )}

      {alert.status === "approved" && (
        <div className="flex items-center gap-1 text-xs text-green-700 pt-1 border-t border-green-200/60">
          <CheckCircle2 className="w-3 h-3" />
          Bestätigt — wird im Kunden-Dashboard angezeigt
          {alert.reviewedAt && (
            <span className="text-green-600/60 ml-1">
              ({formatDate(alert.reviewedAt)})
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function HealthAlertsOperatorPage() {
  const [statusFilter, setStatusFilter] = useState<AlertStatus>("pending");
  const queryClient = useQueryClient();

  const { data: alerts, isLoading, refetch } = useQuery<HealthAlert[]>({
    queryKey: ["health-alerts-operator", statusFilter],
    queryFn: async () => {
      const resp = await authFetch(
        `/api/health-alerts/operator?status=${statusFilter}`,
      );
      if (!resp.ok) throw new Error("Fehler beim Laden");
      return resp.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const resp = await authFetch(`/api/health-alerts/operator/${id}/approve`, {
        method: "POST",
      });
      if (!resp.ok) throw new Error("Fehler bei Bestätigung");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-alerts-operator"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const resp = await authFetch(`/api/health-alerts/operator/${id}/reject`, {
        method: "POST",
      });
      if (!resp.ok) throw new Error("Fehler bei Ablehnung");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-alerts-operator"] });
    },
  });

  const tabs: { label: string; value: AlertStatus }[] = [
    { label: "Ausstehend", value: "pending" },
    { label: "Bestätigt", value: "approved" },
    { label: "Abgelehnt", value: "rejected" },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-6 h-6 text-amber-500" />
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Amtliche Tierseuchen-Warnungen
          </h1>
          <p className="text-sm text-muted-foreground">
            Freigabe-Workflow für FLI- und LAVES-Meldungen
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => refetch()}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Aktualisieren
        </Button>
      </div>

      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <strong>Freigabe-Workflow:</strong> Neue Meldungen werden täglich automatisch
          gefetcht (FLI + LAVES NDS). Bestätigte Meldungen erscheinen im
          Kunden-Dashboard mit dem{" "}
          <span className="font-mono text-xs bg-amber-100 px-1 rounded">
            [Amtliche Quelle]
          </span>
          -Tag. Pro Thema wird immer nur die neueste Meldung angezeigt.
          <br />
          <span className="text-amber-700">
            Tierart-Tags können jederzeit manuell korrigiert werden — auch nach der Freigabe.
          </span>
        </div>
      </div>

      {/* Filter-Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              statusFilter === tab.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 rounded-xl bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : !alerts || alerts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ShieldAlert className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {statusFilter === "pending"
              ? "Keine ausstehenden Meldungen"
              : statusFilter === "approved"
              ? "Noch keine bestätigten Meldungen"
              : "Keine abgelehnten Meldungen"}
          </p>
          <p className="text-xs mt-1 opacity-60">
            Der tägliche Fetch läuft automatisch um 07:00 Uhr.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onApprove={(id) => approveMutation.mutate(id)}
              onReject={(id) => rejectMutation.mutate(id)}
              isApproving={
                approveMutation.isPending &&
                (approveMutation.variables as string) === alert.id
              }
              isRejecting={
                rejectMutation.isPending &&
                (rejectMutation.variables as string) === alert.id
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
