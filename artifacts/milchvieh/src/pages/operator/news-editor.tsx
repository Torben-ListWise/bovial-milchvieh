import { useEffect, useState, useCallback } from "react";
import { getAuthToken } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { PageLayout } from "@/components/PageLayout";
import {
  Check,
  X,
  Pencil,
  ChevronDown,
  ChevronUp,
  Zap,
  RotateCcw,
  Settings2,
  Calendar,
  ArrowLeftRight,
  Copy,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

type EditionStatus = "draft" | "approved" | "rejected";
type CtaType = "route" | "chat_prompt";

interface NewsSource {
  name: string;
  url: string;
}

interface NewsletterEdition {
  id: string;
  scheduledDate: string;
  topic: string;
  topicColor: string;
  title: string;
  appBody: string;
  socialBody: string;
  sources: NewsSource[];
  ctaType: CtaType;
  ctaTarget: string;
  status: EditionStatus;
  batchRunAt: string | null;
  createdAt: string;
}

interface NewsTopic {
  id: string;
  name: string;
  color: string;
  sourceUrls: string[];
  sortOrder: number;
  active: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOPIC_COLORS: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  green: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
};

function topicColorClass(color: string): string {
  return TOPIC_COLORS[color] ?? TOPIC_COLORS.blue;
}

function statusLabel(status: EditionStatus): string {
  if (status === "approved") return "Freigegeben";
  if (status === "rejected") return "Verworfen";
  return "Entwurf";
}

function statusClass(status: EditionStatus): string {
  if (status === "approved")
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (status === "rejected")
    return "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400";
  return "bg-muted text-muted-foreground";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Snap any ISO date string to the Monday of its ISO week. */
function toMonday(isoDate: string): string {
  const d = new Date(isoDate);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Edition Card ─────────────────────────────────────────────────────────────

interface SwapTarget {
  id: string;
  topic: string;
  scheduledDate: string;
}

interface EditionCardProps {
  edition: NewsletterEdition;
  allEditions: SwapTarget[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onSave: (id: string, patch: Partial<NewsletterEdition>) => Promise<void>;
  onSwap: (idA: string, idB: string) => Promise<void>;
}

function EditionCard({ edition, allEditions, onApprove, onReject, onSave, onSwap }: EditionCardProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [swapTarget, setSwapTarget] = useState("");
  const [copiedSocial, setCopiedSocial] = useState(false);

  async function handleCopySocial() {
    try {
      await navigator.clipboard.writeText(edition.socialBody);
      setCopiedSocial(true);
      toast({ title: "Social-Text kopiert", description: "Bereit zum Einfügen in WhatsApp oder Instagram." });
      setTimeout(() => setCopiedSocial(false), 2000);
    } catch {
      toast({ variant: "destructive", title: "Kopieren fehlgeschlagen" });
    }
  }

  const [form, setForm] = useState({
    title: edition.title,
    appBody: edition.appBody,
    socialBody: edition.socialBody,
    ctaType: edition.ctaType as CtaType,
    ctaTarget: edition.ctaTarget,
  });

  function startEdit() {
    setForm({
      title: edition.title,
      appBody: edition.appBody,
      socialBody: edition.socialBody,
      ctaType: edition.ctaType,
      ctaTarget: edition.ctaTarget,
    });
    setEditing(true);
    setExpanded(true);
  }

  async function handleSave() {
    setBusy(true);
    try {
      await onSave(edition.id, form);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    setBusy(true);
    try {
      await onApprove(edition.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    try {
      await onReject(edition.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleSwapConfirm() {
    if (!swapTarget) return;
    setBusy(true);
    try {
      await onSwap(edition.id, swapTarget);
      setShowSwap(false);
      setSwapTarget("");
    } finally {
      setBusy(false);
    }
  }

  const isDraft = edition.status === "draft";
  const otherEditions = allEditions.filter((e) => e.id !== edition.id);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 p-4">
        {/* Date + topic badge — click anywhere here to expand */}
        <button
          type="button"
          className="flex-1 min-w-0 space-y-1 text-left"
          onClick={() => { setExpanded((v) => !v); setEditing(false); }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatDate(edition.scheduledDate)}
            </span>
            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${topicColorClass(edition.topicColor)}`}>
              {edition.topic}
            </span>
            <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${statusClass(edition.status)}`}>
              {statusLabel(edition.status)}
            </span>
          </div>
          <p className="font-semibold text-sm text-foreground truncate">
            {edition.title}
          </p>
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {isDraft && !editing && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="w-8 h-8"
                title="Bearbeiten"
                onClick={startEdit}
                disabled={busy}
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              {otherEditions.length > 0 && (
                <Button
                  size="icon"
                  variant="ghost"
                  className={`w-8 h-8 ${showSwap ? "bg-muted" : ""}`}
                  title="Datum mit anderer Ausgabe tauschen"
                  onClick={() => setShowSwap((v) => !v)}
                  disabled={busy}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="w-8 h-8 text-green-600 hover:text-green-700"
                title="Freigeben"
                onClick={handleApprove}
                disabled={busy}
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="w-8 h-8 text-destructive hover:text-destructive"
                title="Verwerfen"
                onClick={handleReject}
                disabled={busy}
              >
                <X className="w-4 h-4" />
              </Button>
            </>
          )}
          <button
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
            onClick={() => { setExpanded((v) => !v); setEditing(false); }}
          >
            {expanded
              ? <ChevronUp className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Swap panel */}
      {showSwap && otherEditions.length > 0 && (
        <div className="border-t border-border bg-muted/30 px-4 py-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Datum tauschen mit:</span>
          <select
            className="flex-1 min-w-[180px] border border-input rounded-md px-2 py-1.5 text-xs bg-background"
            value={swapTarget}
            onChange={(e) => setSwapTarget(e.target.value)}
          >
            <option value="">— Ausgabe wählen —</option>
            {otherEditions.map((e) => (
              <option key={e.id} value={e.id}>
                {formatDate(e.scheduledDate)} · {e.topic}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!swapTarget || busy}
            onClick={handleSwapConfirm}
          >
            {busy ? "Tausche…" : "Tauschen"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setShowSwap(false); setSwapTarget(""); }}
            disabled={busy}
          >
            Abbrechen
          </Button>
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {editing ? (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Titel</label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">App-Text</label>
                <Textarea
                  value={form.appBody}
                  onChange={(e) => setForm((f) => ({ ...f, appBody: e.target.value }))}
                  rows={8}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Social-Text</label>
                <Textarea
                  value={form.socialBody}
                  onChange={(e) => setForm((f) => ({ ...f, socialBody: e.target.value }))}
                  rows={3}
                  className="text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">CTA-Typ</label>
                  <select
                    className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                    value={form.ctaType}
                    onChange={(e) => setForm((f) => ({ ...f, ctaType: e.target.value as CtaType }))}
                  >
                    <option value="route">Interne Route</option>
                    <option value="chat_prompt">Chat-Frage</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">CTA-Ziel</label>
                  <Input
                    value={form.ctaTarget}
                    onChange={(e) => setForm((f) => ({ ...f, ctaTarget: e.target.value }))}
                    placeholder={form.ctaType === "route" ? "/app/warnings" : "Analysiere meine…"}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={busy}>
                  {busy ? "Speichern…" : "Speichern"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
                  Abbrechen
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">App-Text</p>
                <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto">
                  {edition.appBody}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-muted-foreground">Social-Text</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={handleCopySocial}
                    title="Für Social Media kopieren"
                  >
                    {copiedSocial ? (
                      <Check className="w-3 h-3 text-green-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedSocial ? "Kopiert!" : "Für Social Media kopieren"}
                  </Button>
                </div>
                <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap bg-muted/30 rounded-lg p-3">
                  {edition.socialBody}
                </div>
              </div>
              {(edition.sources ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Quellen</p>
                  <ul className="space-y-1">
                    {(edition.sources ?? []).map((s, i) => (
                      <li key={i} className="text-xs">
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {s.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">CTA:</span>{" "}
                {edition.ctaType === "route" ? `Route → ${edition.ctaTarget}` : `Chat: „${edition.ctaTarget}"`}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Topic Manager ─────────────────────────────────────────────────────────────

function TopicManager({
  topics,
  onUpdate,
}: {
  topics: NewsTopic[];
  onUpdate: (id: string, patch: Partial<NewsTopic>) => Promise<void>;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [editUrls, setEditUrls] = useState("");

  function startEdit(t: NewsTopic) {
    setEditId(t.id);
    setEditUrls((t.sourceUrls ?? []).join("\n"));
  }

  async function saveUrls(t: NewsTopic) {
    const urls = editUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    await onUpdate(t.id, { sourceUrls: urls });
    setEditId(null);
  }

  return (
    <div className="space-y-2">
      {topics.map((t) => (
        <div key={t.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${topicColorClass(t.color)}`}>
              {t.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {(t.sourceUrls ?? []).length} Quell-URL(s)
            </span>
            <div className="flex-1" />
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7"
              onClick={() => (editId === t.id ? setEditId(null) : startEdit(t))}
            >
              <Settings2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          {editId === t.id && (
            <div className="mt-3 space-y-2">
              <label className="text-xs text-muted-foreground">Quell-URLs (eine pro Zeile)</label>
              <Textarea
                value={editUrls}
                onChange={(e) => setEditUrls(e.target.value)}
                rows={3}
                className="text-xs font-mono"
                placeholder="https://…"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveUrls(t)}>Speichern</Button>
                <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Abbrechen</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function NewsEditorPage() {
  const { toast } = useToast();

  const [editions, setEditions] = useState<NewsletterEdition[] | undefined>(undefined);
  const [topics, setTopics] = useState<NewsTopic[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [showTopics, setShowTopics] = useState(false);

  // week navigation: always snapped to Monday of the week
  const [weekAnchor, setWeekAnchor] = useState<string>(() => toMonday(new Date().toISOString().slice(0, 10)));

  async function apiFetch(path: string, opts?: RequestInit) {
    const token = await getAuthToken();
    return fetch(`${API_BASE}/api${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts?.headers,
      },
    });
  }

  const loadEditions = useCallback(async () => {
    try {
      const resp = await apiFetch(`/operator/newsletter?week=${weekAnchor}`);
      if (!resp.ok) throw new Error("Laden fehlgeschlagen");
      const data = await resp.json() as NewsletterEdition[];
      setEditions(data);
    } catch {
      toast({ variant: "destructive", title: "Fehler beim Laden der Ausgaben" });
      setEditions([]);
    }
  }, [weekAnchor]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTopics = useCallback(async () => {
    try {
      const resp = await apiFetch("/operator/news-topics");
      if (!resp.ok) return;
      const data = await resp.json() as NewsTopic[];
      setTopics(data);
    } catch {
      // ignore
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadEditions(); }, [loadEditions]);
  useEffect(() => { loadTopics(); }, [loadTopics]);

  async function handleApprove(id: string) {
    const resp = await apiFetch(`/operator/newsletter/${id}/approve`, { method: "POST" });
    if (!resp.ok) {
      let detail = "";
      try { detail = (await resp.json() as { error?: string }).error ?? ""; } catch { /* ignore */ }
      toast({ variant: "destructive", title: "Freigabe fehlgeschlagen", description: detail || `Status ${resp.status}` });
      return;
    }
    toast({ title: "Ausgabe freigegeben" });
    await loadEditions();
  }

  async function handleReject(id: string) {
    const resp = await apiFetch(`/operator/newsletter/${id}/reject`, { method: "POST" });
    if (!resp.ok) {
      let detail = "";
      try { detail = (await resp.json() as { error?: string }).error ?? ""; } catch { /* ignore */ }
      toast({ variant: "destructive", title: "Verwerfen fehlgeschlagen", description: detail || `Status ${resp.status}` });
      return;
    }
    toast({ title: "Ausgabe verworfen" });
    await loadEditions();
  }

  async function handleSave(id: string, patch: Partial<NewsletterEdition>) {
    const resp = await apiFetch(`/operator/newsletter/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      toast({ variant: "destructive", title: "Speichern fehlgeschlagen" });
      return;
    }
    toast({ title: "Entwurf gespeichert" });
    await loadEditions();
  }

  async function handleSwap(idA: string, idB: string) {
    const resp = await apiFetch("/operator/newsletter/swap-dates", {
      method: "POST",
      body: JSON.stringify({ idA, idB }),
    });
    if (!resp.ok) {
      toast({ variant: "destructive", title: "Datum-Tausch fehlgeschlagen" });
      return;
    }
    toast({ title: "Termine getauscht" });
    await loadEditions();
  }

  async function handleTopicUpdate(id: string, patch: Partial<NewsTopic>) {
    const resp = await apiFetch(`/operator/news-topics/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      toast({ variant: "destructive", title: "Thema konnte nicht gespeichert werden" });
      return;
    }
    toast({ title: "Thema gespeichert" });
    await loadTopics();
  }

  async function handleGenerateBatch(fromToday = false) {
    if (batchRunning) return;
    setBatchRunning(true);
    try {
      const offsetDays = fromToday ? 0 : 1;
      const resp = await apiFetch("/operator/newsletter/batch/sync", {
        method: "POST",
        body: JSON.stringify({ offsetDays }),
      });
      const result = await resp.json() as {
        generated?: number;
        skipped?: number;
        errors?: string[];
      };
      if (!resp.ok) {
        const errMsg = (result as { error?: string })?.error ?? JSON.stringify(result);
        toast({ variant: "destructive", title: "Batch fehlgeschlagen", description: errMsg });
        return;
      }
      toast({
        title: `Batch abgeschlossen`,
        description: `${result.generated ?? 0} generiert, ${result.skipped ?? 0} übersprungen${result.errors?.length ? `, ${result.errors.length} Fehler` : ""}`,
      });
      // Navigate to the Monday of the generated week
      const rawFirstDate = fromToday
        ? new Date().toISOString().slice(0, 10)
        : addDays(new Date().toISOString().slice(0, 10), 1);
      setWeekAnchor(toMonday(rawFirstDate));
      await loadEditions();
    } catch {
      toast({ variant: "destructive", title: "Batch-Verbindungsfehler" });
    } finally {
      setBatchRunning(false);
    }
  }

  const draftCount = editions?.filter((e) => e.status === "draft").length ?? 0;
  const approvedCount = editions?.filter((e) => e.status === "approved").length ?? 0;

  return (
    <PageLayout>
      <div className="space-y-6 max-w-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Nachrichten-Editor</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              KI-generierte Wochenausgaben prüfen, bearbeiten und freigeben
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowTopics((v) => !v)}
            >
              <Settings2 className="w-4 h-4 mr-1.5" />
              Themen
            </Button>
            <Button
              size="sm"
              onClick={() => handleGenerateBatch(false)}
              disabled={batchRunning}
            >
              {batchRunning ? (
                <>
                  <RotateCcw className="w-4 h-4 mr-1.5 animate-spin" />
                  Generiere…
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-1.5" />
                  7 Entwürfe generieren
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Topics panel */}
        {showTopics && topics.length > 0 && (
          <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Themen &amp; Quell-URLs</h2>
            <TopicManager topics={topics} onUpdate={handleTopicUpdate} />
          </div>
        )}

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
            onClick={() => setWeekAnchor((d) => addDays(d, -7))}
          >
            ← Vorwoche
          </button>
          <span className="text-xs text-muted-foreground flex-1 text-center">
            Woche ab {formatDate(weekAnchor)}
            {editions !== undefined && editions.length > 0 && (
              <span className="ml-2">
                ({draftCount} Entwurf{draftCount !== 1 ? "e" : ""}, {approvedCount} freigegeben)
              </span>
            )}
          </span>
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
            onClick={() => setWeekAnchor((d) => addDays(d, 7))}
          >
            Nächste Woche →
          </button>
        </div>

        {/* Editions list */}
        {editions === undefined && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        )}

        {editions !== undefined && editions.length === 0 && (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Noch keine Ausgaben für diese Woche.
            </p>
            <div className="flex justify-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleGenerateBatch(true)}
                disabled={batchRunning}
              >
                <Zap className="w-4 h-4 mr-1.5" />
                {batchRunning ? "Generiere…" : "Ab heute generieren (Test)"}
              </Button>
              <Button
                size="sm"
                onClick={() => handleGenerateBatch(false)}
                disabled={batchRunning}
              >
                <Zap className="w-4 h-4 mr-1.5" />
                {batchRunning ? "Generiere…" : "Nächste Woche generieren"}
              </Button>
            </div>
          </div>
        )}

        {editions !== undefined && editions.length > 0 && (
          <div className="space-y-3">
            {editions.map((ed) => (
              <EditionCard
                key={ed.id}
                edition={ed}
                allEditions={editions}
                onApprove={handleApprove}
                onReject={handleReject}
                onSave={handleSave}
                onSwap={handleSwap}
              />
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
