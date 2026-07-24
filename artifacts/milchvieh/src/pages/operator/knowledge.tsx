import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { KnowledgeDocument, FarmNote } from "@workspace/api-client-react";
import {
  useListFarmNotes,
  getListFarmNotesQueryKey,
  useCreateFarmNote,
  useUpdateFarmNote,
  useDeleteFarmNote,
  getAuthToken,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Upload,
  Trash2,
  FileText,
  CheckCircle,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  BookOpen,
  Globe,
  Link,
  Sparkles,
  Tag,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  HelpCircle,
  RefreshCw,
  Plus,
  Pencil,
  StickyNote,
  Star,
  Settings,
  Library,
  BookMarked,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const KNOWLEDGE_TOPICS = [
  "Fruchtbarkeit",
  "Eutergesundheit",
  "Fütterung",
  "Klauengesundheit",
  "Hitzestress",
  "Herdenstruktur",
  "Kälber-/Jungviehaufzucht",
  "Melktechnik",
  "Betriebswirtschaft",
  "Tiergesundheit-Seuchen",
] as const;

const TIER_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Wissenschaftlich (peer-reviewed)", color: "bg-blue-100 text-blue-800 border-blue-200" },
  2: { label: "Branchenpraxis (Verbände/Beratung)", color: "bg-green-100 text-green-800 border-green-200" },
  3: { label: "Betriebserfahrung/Praxisbericht", color: "bg-amber-100 text-amber-800 border-amber-200" },
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status, chunkCount }: { status: string; chunkCount?: number | null }) {
  if (status === "ready") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 gap-1">
        <CheckCircle className="w-3 h-3" />
        Bereit ({chunkCount ?? 0} Chunks)
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Wird geladen...
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 gap-1">
        <Clock className="w-3 h-3" />
        Ausstehend
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200 gap-1">
      <AlertCircle className="w-3 h-3" />
      Fehler
    </Badge>
  );
}

// Stable colour palette for category badges
const CATEGORY_COLORS: Record<string, string> = {
  "Milchleistung & Laktation": "bg-blue-100 text-blue-800 border-blue-200",
  "Eutergesundheit & Zellzahl": "bg-purple-100 text-purple-800 border-purple-200",
  "Fruchtbarkeit & Reproduktion": "bg-pink-100 text-pink-800 border-pink-200",
  "Tiergesundheit & Medizin": "bg-red-100 text-red-800 border-red-200",
  "Fütterung & Ernährung": "bg-green-100 text-green-800 border-green-200",
  "Herdenmanagement": "bg-teal-100 text-teal-800 border-teal-200",
  "Recht & Förderung": "bg-gray-100 text-gray-800 border-gray-200",
  "Technik & Stallbau": "bg-orange-100 text-orange-800 border-orange-200",
  "Betriebswirtschaft": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Umwelt & Nachhaltigkeit": "bg-lime-100 text-lime-800 border-lime-200",
  "Biogas & Energie": "bg-amber-100 text-amber-800 border-amber-200",
  "Ackerbau & Pflanzenbau": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Schweinehaltung": "bg-rose-100 text-rose-800 border-rose-200",
  "Geflügelhaltung": "bg-orange-100 text-orange-800 border-orange-200",
  "Sonstiges": "bg-slate-100 text-slate-700 border-slate-200",
};

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <Badge className={cn("gap-1 border text-xs font-normal", cls)}>
      <Tag className="w-2.5 h-2.5" />
      {category}
    </Badge>
  );
}

interface KnowledgeGapRow {
  query: string;
  frequency: number;
  maxScore: number | null;
  firstSeen: string;
  lastSeen: string;
}

function KnowledgeGapsCard() {
  const [enabled, setEnabled] = useState(false);

  const { data: gaps, isLoading, refetch, isFetching } = useQuery<KnowledgeGapRow[]>({
    queryKey: ["knowledge-gaps"],
    enabled,
    queryFn: async () => {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/admin/knowledge-gaps?limit=50`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Fehler beim Laden");
      return res.json();
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-amber-500" />
              Wissenslücken
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fragen, bei denen die Bibliothek keine relevanten Treffer lieferte — sortiert nach Häufigkeit.
            </p>
            <p className="text-xs text-muted-foreground mt-1 italic">
              Hinweis: DairyComp-Fragen, Betriebskürzel-Anfragen und Rechner-Anfragen erscheinen hier nicht — sie werden durch dedizierte Tools (Handbuch-Suche, Abkürzungsindex, Kalkulatoren) abgedeckt und zählen nicht als Lücken.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {enabled && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => void refetch()}
                disabled={isFetching}
                title="Aktualisieren"
              >
                <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
              </Button>
            )}
            {!enabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEnabled(true)}
                className="gap-2"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Anzeigen
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {enabled && (
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Laden...
            </div>
          ) : !gaps || gaps.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <CheckCircle className="w-7 h-7 mx-auto mb-2 text-green-500 opacity-60" />
              <p className="text-sm">Noch keine Wissenslücken aufgezeichnet.</p>
              <p className="text-xs mt-0.5">Sobald ein Bauer eine Frage stellt, die keine Bibliotheks-Treffer erzielt, erscheint sie hier.</p>
            </div>
          ) : (
            <div className="space-y-0 divide-y">
              {gaps.map((gap, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center justify-center rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold min-w-[2rem] h-7 px-1.5 shrink-0">
                    {gap.frequency}×
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug break-words">{gap.query}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Letztes Mal: {new Date(gap.lastSeen).toLocaleDateString("de-DE")}
                      {gap.maxScore !== null && (
                        <span className="ml-2">
                          · Top-Score: <span className={cn(
                            "font-medium",
                            gap.maxScore >= 0.45 ? "text-yellow-600" : "text-red-600"
                          )}>{(gap.maxScore * 100).toFixed(0)}%</span>
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

interface UploadItem {
  file: File;
  title: string;
  status: "pending" | "uploading" | "ingesting" | "done" | "error";
  error?: string;
  isBenchmarkRef?: boolean;
  isDairyCompManual?: boolean;
  isAbbrevList?: boolean;
}

// ── Betriebshinweise section ────────────────────────────────────────────────

function FarmNotesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [noteText, setNoteText] = useState("");
  const [editingNote, setEditingNote] = useState<FarmNote | null>(null);
  const [editText, setEditText] = useState("");

  const { data: notes, isLoading } = useListFarmNotes({
    query: { queryKey: getListFarmNotesQueryKey() },
  });

  const createNote = useCreateFarmNote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFarmNotesQueryKey() });
        setNoteText("");
        toast({ title: "Hinweis gespeichert" });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Hinweis konnte nicht gespeichert werden." });
      },
    },
  });

  const updateNote = useUpdateFarmNote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFarmNotesQueryKey() });
        setEditingNote(null);
        toast({ title: "Hinweis aktualisiert" });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Hinweis konnte nicht aktualisiert werden." });
      },
    },
  });

  const deleteNote = useDeleteFarmNote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFarmNotesQueryKey() });
        toast({ title: "Hinweis gelöscht" });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Hinweis konnte nicht gelöscht werden." });
      },
    },
  });

  const toggleNote = (note: FarmNote) => {
    updateNote.mutate({ noteId: note.id, data: { enabled: !note.enabled } });
  };

  const startEdit = (note: FarmNote) => {
    setEditingNote(note);
    setEditText(note.content);
  };

  const saveEdit = () => {
    if (!editingNote || !editText.trim()) return;
    updateNote.mutate({ noteId: editingNote.id, data: { content: editText.trim() } });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <StickyNote className="w-5 h-5 text-primary" />
          Betriebshinweise
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Freitext-Hinweise die bei jeder Kundenanalyse in den Agenten-Kontext einfliessen
          (z.&thinsp;B. betriebliche Schwerpunkte, wichtige Kennzahlen oder Interpretationsregeln).
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="z. B. Pregrate ist die wichtigste Fertilitatskennzahl. Immer Laktationsnummer beachten."
            rows={3}
            maxLength={2000}
            className="resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{noteText.length}/2000 Zeichen</span>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!noteText.trim() || createNote.isPending}
              onClick={() => createNote.mutate({ data: { content: noteText.trim() } })}
            >
              <Plus className="w-3.5 h-3.5" />
              Hinweis hinzufügen
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laden…</p>
      ) : !notes || notes.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-2">
          Noch keine Betriebshinweise angelegt.
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <Card key={note.id} className={cn(!note.enabled && "opacity-55")}>
              <CardContent className="p-3">
                {editingNote?.id === note.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      maxLength={2000}
                      className="resize-none"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingNote(null)}>
                        Abbrechen
                      </Button>
                      <Button size="sm" disabled={!editText.trim() || updateNote.isPending} onClick={saveEdit}>
                        Speichern
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className={cn("w-4 h-4 mt-0.5 shrink-0", note.enabled ? "text-primary" : "text-muted-foreground")} />
                    <p className="flex-1 text-sm leading-relaxed">{note.content}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={note.enabled}
                        onCheckedChange={() => toggleNote(note)}
                        aria-label="Hinweis aktiv"
                      />
                      <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => startEdit(note)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-destructive hover:text-destructive"
                        disabled={deleteNote.isPending}
                        onClick={() => deleteNote.mutate({ noteId: note.id })}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function BenchmarkFactorSection() {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: masterData, refetch } = useQuery<
    Array<{ id: string; category: string; key: string; value: string }>
  >({
    queryKey: ["masterdata-sys"],
    queryFn: async () => {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/masterdata`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Fehler beim Laden");
      return res.json();
    },
  });

  const factorEntry = masterData?.find(
    (e) => e.category === "Systemeinstellungen" && e.key === "benchmark_abweichungsfaktor",
  );

  async function saveFactor() {
    if (!factorEntry) return;
    const val = parseFloat(inputVal.replace(",", "."));
    if (isNaN(val) || val <= 0) {
      toast({
        variant: "destructive",
        title: "Ungültiger Wert",
        description: "Bitte eine positive Zahl eingeben.",
      });
      return;
    }
    setSaving(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/masterdata/${factorEntry.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ value: String(val) }),
      });
      if (!res.ok) throw new Error("Speichern fehlgeschlagen");
      await refetch();
      setEditing(false);
      toast({ title: "Gespeichert" });
    } catch {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Wert konnte nicht gespeichert werden.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
        <Settings className="w-5 h-5 text-primary" />
        Systemeinstellungen
      </h2>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="font-medium text-sm">Plausibilitäts-Faktor für Benchmarkabweichung</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Schwellenwert (Max/Min-Verhältnis) ab dem eine Kennzahl im Bericht als ungewöhnlich
                abweichend markiert wird. Standard: 5 (eigener Wert muss mehr als 5× vom Richtwert abweichen).
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {editing ? (
                <>
                  <Input
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    className="h-8 w-20 text-center"
                    type="number"
                    min="1"
                    step="0.5"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveFactor();
                      if (e.key === "Escape") setEditing(false);
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => void saveFactor()}
                    disabled={saving}
                    className="h-8"
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Speichern"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(false)}
                    className="h-8"
                  >
                    Abbrechen
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-lg font-bold">{factorEntry?.value ?? "5"}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    onClick={() => {
                      setInputVal(factorEntry?.value ?? "5");
                      setEditing(true);
                    }}
                  >
                    <Pencil className="w-3 h-3" />
                    Bearbeiten
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { PageLayout } from "@/components/PageLayout";

export function KnowledgePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"file" | "url">("file");
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [batchExtracting, setBatchExtracting] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [uploadAsBenchmarkRef, setUploadAsBenchmarkRef] = useState(false);
  const [uploadAsDairyCompManual, setUploadAsDairyCompManual] = useState(false);
  const [uploadAsAbbrevList, setUploadAsAbbrevList] = useState(false);
  const [confirmingDocId, setConfirmingDocId] = useState<string | null>(null);
  const [metaForm, setMetaForm] = useState<{
    metaTitel: string;
    metaAutoren: string;
    metaJahr: string;
    metaHerausgeber: string;
    metaUrl: string;
    tierStufe: string;
    topics: string[];
  }>({ metaTitel: "", metaAutoren: "", metaJahr: "", metaHerausgeber: "", metaUrl: "", tierStufe: "", topics: [] });

  const { data: docs = [], isLoading } = useQuery<KnowledgeDocument[]>({
    queryKey: ["knowledge-docs"],
    queryFn: async () => {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/knowledge`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Fehler beim Laden");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as KnowledgeDocument[] | undefined;
      const hasPending = data?.some(
        (d) => d.status === "processing" || d.status === "pending",
      );
      return hasPending ? 2000 : false;
    },
  });

  const retryIngestMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/knowledge/${id}/ingest`, {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Neueinlesung fehlgeschlagen");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
      toast({ title: "Neu einlesen gestartet" });
    },
    onError: () => {
      toast({ title: "Neueinlesung fehlgeschlagen", variant: "destructive" });
    },
  });

  const setDocTypeMutation = useMutation({
    mutationFn: async ({ id, documentType }: { id: string; documentType: string | null }) => {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/knowledge/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ documentType }),
      });
      if (!res.ok) throw new Error("Typ-Änderung fehlgeschlagen");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
      toast({ title: "Dokumenttyp aktualisiert" });
    },
    onError: () => {
      toast({ title: "Typ-Änderung fehlgeschlagen", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/knowledge/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Löschen fehlgeschlagen");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
      toast({ title: "Dokument gelöscht" });
    },
    onError: () => {
      toast({ title: "Fehler beim Löschen", variant: "destructive" });
    },
  });

  async function handleCategorizeAll() {
    setCategorizing(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/knowledge/categorize-all`, {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Kategorisierung fehlgeschlagen",
          description: (body as any).error ?? "Unbekannter Fehler",
          variant: "destructive",
        });
        return;
      }
      const { updated, message } = body as { updated: number; message?: string };
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
      toast({
        title: updated > 0
          ? `${updated} Dokument${updated !== 1 ? "e" : ""} kategorisiert`
          : "Alle Dokumente bereits kategorisiert",
        description: message,
      });
    } catch {
      toast({ title: "Netzwerkfehler", variant: "destructive" });
    } finally {
      setCategorizing(false);
    }
  }

  async function handleBatchExtractMetadata() {
    setBatchExtracting(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/knowledge/batch-extract-metadata`, {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Metadaten-Extraktion fehlgeschlagen",
          description: (body as any).error ?? "Unbekannter Fehler",
          variant: "destructive",
        });
        return;
      }
      const { queued, message } = body as { queued: number; message?: string };
      toast({
        title: queued > 0
          ? `${queued} Dokument${queued !== 1 ? "e" : ""} werden verarbeitet`
          : "Alle Dokumente bereits verarbeitet",
        description: message,
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
      }, 3000);
    } catch {
      toast({ title: "Netzwerkfehler", variant: "destructive" });
    } finally {
      setBatchExtracting(false);
    }
  }

  function openMetaConfirm(doc: KnowledgeDocument) {
    const pending = doc.metaPending as any;
    setConfirmingDocId(doc.id);
    setMetaForm({
      metaTitel: pending?.metaTitel ?? doc.metaTitel ?? "",
      metaAutoren: pending?.metaAutoren ?? doc.metaAutoren ?? "",
      metaJahr: String(pending?.metaJahr ?? doc.metaJahr ?? ""),
      metaHerausgeber: pending?.metaHerausgeber ?? doc.metaHerausgeber ?? "",
      metaUrl: pending?.metaUrl ?? (doc as any).metaUrl ?? "",
      tierStufe: String(pending?.tierStufe ?? doc.tierStufe ?? ""),
      topics: pending?.topics ?? doc.topics ?? [],
    });
  }

  async function handleConfirmMeta(docId: string) {
    const token = await getAuthToken();
    const res = await fetch(`${API_BASE}/api/knowledge/${docId}/confirm-metadata`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        metaTitel: metaForm.metaTitel || null,
        metaAutoren: metaForm.metaAutoren || null,
        metaJahr: metaForm.metaJahr ? Number(metaForm.metaJahr) : null,
        metaHerausgeber: metaForm.metaHerausgeber || null,
        metaUrl: metaForm.metaUrl || null,
        tierStufe: metaForm.tierStufe ? Number(metaForm.tierStufe) : null,
        topics: metaForm.topics,
      }),
    });
    if (!res.ok) {
      toast({ title: "Speichern fehlgeschlagen", variant: "destructive" });
      return;
    }
    toast({ title: "Metadaten gespeichert" });
    setConfirmingDocId(null);
    queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
  }

  async function handleDismissMeta(docId: string) {
    const token = await getAuthToken();
    await fetch(`${API_BASE}/api/knowledge/${docId}/dismiss-metadata`, {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    setConfirmingDocId(null);
    queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
  }

  async function uploadFile(item: UploadItem) {
    const updateItem = (patch: Partial<UploadItem>) =>
      setUploadItems((prev) =>
        prev.map((i) => (i.file === item.file ? { ...i, ...patch } : i)),
      );

    try {
      updateItem({ status: "uploading" });
      const token = await getAuthToken();
      const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

      const urlRes = await fetch(`${API_BASE}/api/knowledge/upload-url`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          filename: item.file.name,
          contentType: item.file.type || "application/octet-stream",
          size: item.file.size,
          title: item.title || undefined,
          documentType: item.isDairyCompManual ? "dairycomp_manual" : item.isAbbrevList ? "farm_abbreviations" : item.isBenchmarkRef ? "benchmark_reference" : undefined,
        }),
      });

      if (!urlRes.ok) {
        const errBody = await urlRes.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error ?? "Upload-URL konnte nicht erstellt werden");
      }
      const { uploadURL, docId } = await urlRes.json();

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: item.file,
        headers: { "Content-Type": item.file.type || "application/octet-stream" },
      });
      if (!putRes.ok) {
        const putErrMsg = `Datei-Upload fehlgeschlagen (HTTP ${putRes.status})`;
        void fetch(`${API_BASE}/api/knowledge/${docId}/mark-upload-error`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ message: putErrMsg }),
        }).catch(() => undefined);
        toast({
          title: "Upload fehlgeschlagen",
          description: `Die Datei "${item.file.name}" konnte nicht hochgeladen werden. Bitte erneut versuchen.`,
          variant: "destructive",
        });
        throw new Error(putErrMsg);
      }

      updateItem({ status: "ingesting" });
      await fetch(`${API_BASE}/api/knowledge/${docId}/ingest`, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeader },
      });

      updateItem({ status: "done" });
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
    } catch (err) {
      updateItem({
        status: "error",
        error: err instanceof Error ? err.message : "Unbekannter Fehler",
      });
    }
  }

  async function handleIngestUrl() {
    setUrlError(null);
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError("Bitte eine URL eingeben");
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setUrlError("Ungültige URL — Beispiel: https://www.lfl.bayern.de");
      return;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      setUrlError("Nur http:// und https:// URLs sind erlaubt");
      return;
    }

    setUrlLoading(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/knowledge/ingest-url`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setUrlError((body as any).error ?? "Diese URL wurde bereits hinzugefügt");
        return;
      }
      if (!res.ok) {
        setUrlError((body as any).error ?? "Fehler beim Laden der URL");
        return;
      }
      setUrlInput("");
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
      toast({ title: "URL wird verarbeitet", description: "Der Inhalt wird geladen und indexiert." });
    } catch {
      setUrlError("Netzwerkfehler — bitte erneut versuchen");
    } finally {
      setUrlLoading(false);
    }
  }

  const ALLOWED_EXTS = [".pdf", ".pptx", ".ppt", ".xlsx", ".xls", ".ods", ".csv", ".tsv", ".txt", ".docx", ".doc"];

  function addFiles(files: File[]) {
    const valid = files.filter((f) =>
      ALLOWED_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)),
    );
    if (valid.length === 0) {
      toast({
        title: "Ungültiges Format",
        description: "Unterstützte Formate: PDF, Word, Excel, PowerPoint, CSV, TXT.",
        variant: "destructive",
      });
      return;
    }
    const items: UploadItem[] = valid.map((f) => ({
      file: f,
      title: f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim(),
      status: "pending",
      isBenchmarkRef: uploadAsBenchmarkRef && !uploadAsDairyCompManual && !uploadAsAbbrevList,
      isDairyCompManual: uploadAsDairyCompManual && !uploadAsAbbrevList,
      isAbbrevList: uploadAsAbbrevList,
    }));
    setUploadItems((prev) => [...prev, ...items]);
  }

  function startUpload() {
    const pending = uploadItems.filter((i) => i.status === "pending");
    for (const item of pending) {
      void uploadFile(item);
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const pendingCount = uploadItems.filter((i) => i.status === "pending").length;

  // Build category stats from ready docs
  const readyDocs = docs.filter((d) => d.status === "ready");
  const uncategorizedCount = readyDocs.filter((d) => !d.category).length;
  const categoryMap = new Map<string, number>();
  for (const doc of readyDocs) {
    if (doc.category) {
      categoryMap.set(doc.category, (categoryMap.get(doc.category) ?? 0) + 1);
    }
  }
  const categories = Array.from(categoryMap.entries()).sort((a, b) => b[1] - a[1]);
  const MAX_VISIBLE_CATEGORIES = 6;
  const visibleCategories = showAllCategories ? categories : categories.slice(0, MAX_VISIBLE_CATEGORIES);

  // Filter docs by active category
  const filteredDocs = activeCategory === null
    ? docs
    : activeCategory === "__uncategorized__"
      ? docs.filter((d) => d.status === "ready" && !d.category)
      : docs.filter((d) => d.category === activeCategory);

  return (
    <PageLayout size="narrow">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-primary" />
            Wissensbibliothek
          </h1>
          <p className="text-muted-foreground mt-1">
            Dokumente hochladen oder Websites hinzufügen. Der Assistent durchsucht diese Inhalte
            semantisch bei Fachfragen.
          </p>
        </div>
        {readyDocs.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={handleBatchExtractMetadata}
              disabled={batchExtracting}
              className="gap-2"
            >
              {batchExtracting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <BookMarked className="w-4 h-4" />
              )}
              {batchExtracting ? "Extrahiere..." : "Metadaten nachladen (Alle)"}
            </Button>
            <Button
              variant="outline"
              onClick={handleCategorizeAll}
              disabled={categorizing || uncategorizedCount === 0}
              className="gap-2"
            >
              {categorizing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {categorizing
                ? "Kategorisiere..."
                : uncategorizedCount > 0
                  ? `KI-Kategorisierung (${uncategorizedCount})`
                  : "Alle kategorisiert"}
            </Button>
          </div>
        )}
      </div>

      {/* Category filter chips */}
      {categories.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Tag className="w-3.5 h-3.5" />
              Nach Thema filtern
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveCategory(null)}
                className={cn(
                  "px-3 py-1 rounded-full text-sm border transition-colors",
                  activeCategory === null
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted",
                )}
              >
                Alle ({docs.length})
              </button>
              {visibleCategories.map(([cat, count]) => {
                const colorCls = CATEGORY_COLORS[cat] ?? "bg-slate-100 text-slate-700 border-slate-200";
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                    className={cn(
                      "px-3 py-1 rounded-full text-sm border transition-colors",
                      activeCategory === cat
                        ? "ring-2 ring-offset-1 ring-primary"
                        : "hover:opacity-80",
                      colorCls,
                    )}
                  >
                    {cat} ({count})
                  </button>
                );
              })}
              {uncategorizedCount > 0 && (
                <button
                  onClick={() => setActiveCategory(activeCategory === "__uncategorized__" ? null : "__uncategorized__")}
                  className={cn(
                    "px-3 py-1 rounded-full text-sm border transition-colors",
                    activeCategory === "__uncategorized__"
                      ? "bg-muted-foreground/20 border-muted-foreground ring-2 ring-offset-1 ring-primary"
                      : "bg-muted/50 border-border hover:bg-muted text-muted-foreground",
                  )}
                >
                  Ohne Kategorie ({uncategorizedCount})
                </button>
              )}
              {categories.length > MAX_VISIBLE_CATEGORIES && (
                <button
                  onClick={() => setShowAllCategories((v) => !v)}
                  className="px-3 py-1 rounded-full text-sm border border-border hover:bg-muted text-muted-foreground flex items-center gap-1"
                >
                  {showAllCategories ? (
                    <><ChevronUp className="w-3 h-3" /> Weniger</>
                  ) : (
                    <><ChevronDown className="w-3 h-3" /> +{categories.length - MAX_VISIBLE_CATEGORIES} mehr</>
                  )}
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Card with tabs */}
      {activeCategory === null && (
        <Card>
          <CardHeader className="pb-0">
            <div className="flex gap-1 border-b">
              <button
                onClick={() => setActiveTab("file")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                  activeTab === "file"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Upload className="w-4 h-4" />
                Datei hochladen
              </button>
              <button
                onClick={() => setActiveTab("url")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                  activeTab === "url"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Globe className="w-4 h-4" />
                URL hinzufügen
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {activeTab === "file" && (
              <>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30",
                  )}
                >
                  <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                  <p className="font-medium text-sm">Datei hierher ziehen</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, Word, Excel, PowerPoint, CSV, TXT — oder klicken zum Auswählen
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.pptx,.ppt,.xlsx,.xls,.ods,.csv,.tsv,.txt,.docx,.doc"
                    multiple
                    className="hidden"
                    onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
                  />
                </div>

                <div className="flex items-start gap-3 p-3 rounded-md border bg-amber-50 border-amber-200">
                  <input
                    type="checkbox"
                    id="benchmark-ref-toggle"
                    checked={uploadAsBenchmarkRef && !uploadAsDairyCompManual}
                    onChange={(e) => { setUploadAsBenchmarkRef(e.target.checked); setUploadAsDairyCompManual(false); setUploadAsAbbrevList(false); }}
                    className="w-4 h-4 mt-0.5 accent-amber-600 shrink-0"
                  />
                  <label htmlFor="benchmark-ref-toggle" className="text-sm cursor-pointer select-none">
                    <span className="font-medium flex items-center gap-1.5">
                      <Star className="w-3.5 h-3.5 text-amber-600" />
                      Als Referenz-Benchmark hochladen
                    </span>
                    <span className="text-xs text-muted-foreground block mt-0.5">
                      Wird bei der Berichtserstellung für den Benchmarkvergleich herangezogen.
                      Ersetzt automatisch den bisherigen Referenz-Benchmark.
                    </span>
                  </label>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-md border bg-blue-50 border-blue-200">
                  <input
                    type="checkbox"
                    id="dairycomp-manual-toggle"
                    checked={uploadAsDairyCompManual}
                    onChange={(e) => { setUploadAsDairyCompManual(e.target.checked); setUploadAsBenchmarkRef(false); setUploadAsAbbrevList(false); }}
                    className="w-4 h-4 mt-0.5 accent-blue-600 shrink-0"
                  />
                  <label htmlFor="dairycomp-manual-toggle" className="text-sm cursor-pointer select-none">
                    <span className="font-medium flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                      Als DairyComp-Handbuch hochladen
                    </span>
                    <span className="text-xs text-muted-foreground block mt-0.5">
                      Wird für DairyComp-Bedienungsfragen im Chat verwendet.
                      Ersetzt automatisch das bisherige DairyComp-Handbuch.
                    </span>
                  </label>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-md border bg-violet-50 border-violet-200">
                  <input
                    type="checkbox"
                    id="abbrev-list-toggle"
                    checked={uploadAsAbbrevList}
                    onChange={(e) => { setUploadAsAbbrevList(e.target.checked); setUploadAsBenchmarkRef(false); setUploadAsDairyCompManual(false); }}
                    className="w-4 h-4 mt-0.5 accent-violet-600 shrink-0"
                  />
                  <label htmlFor="abbrev-list-toggle" className="text-sm cursor-pointer select-none">
                    <span className="font-medium flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-violet-600" />
                      Als Betriebskürzel / ALTER3-Makroliste hochladen
                    </span>
                    <span className="text-xs text-muted-foreground block mt-0.5">
                      Deine betriebsspezifischen DairyComp-Kürzel aus der ALTER3-Liste.
                      Wird einmal hochgeladen und ersetzt das vorherige Dokument automatisch.
                    </span>
                  </label>
                </div>

                {uploadItems.length > 0 && (
                  <div className="space-y-2">
                    {uploadItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 p-3 rounded-md border bg-muted/30"
                      >
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          {item.status === "pending" ? (
                            <Input
                              value={item.title}
                              onChange={(e) =>
                                setUploadItems((prev) =>
                                  prev.map((i, i2) =>
                                    i2 === idx ? { ...i, title: e.target.value } : i,
                                  )
                                )
                              }
                              className="h-7 text-sm"
                              placeholder="Titel (optional)"
                            />
                          ) : (
                            <p className="text-sm font-medium truncate">
                              {item.title || item.file.name}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground truncate">
                            {item.file.name} · {formatBytes(item.file.size)}
                          </p>
                          {item.status === "error" && item.error && (
                            <p className="text-xs text-red-600 mt-0.5">{item.error}</p>
                          )}
                        </div>
                        <div className="shrink-0">
                          {item.status === "pending" && (
                            <Badge variant="secondary">Bereit</Badge>
                          )}
                          {item.status === "uploading" && (
                            <Badge className="bg-blue-100 text-blue-800 gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Lade hoch
                            </Badge>
                          )}
                          {item.status === "ingesting" && (
                            <Badge className="bg-blue-100 text-blue-800 gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Verarbeite
                            </Badge>
                          )}
                          {item.status === "done" && (
                            <Badge className="bg-green-100 text-green-800 gap-1">
                              <CheckCircle className="w-3 h-3" />
                              Fertig
                            </Badge>
                          )}
                          {item.status === "error" && (
                            <Badge className="bg-red-100 text-red-800 gap-1">
                              <AlertCircle className="w-3 h-3" />
                              Fehler
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}

                    {pendingCount > 0 && (
                      <Button onClick={startUpload} className="w-full">
                        <Upload className="w-4 h-4 mr-2" />
                        {pendingCount === 1
                          ? "1 Dokument hochladen"
                          : `${pendingCount} Dokumente hochladen`}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}

            {activeTab === "url" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Website-URL eingeben — der Inhalt wird automatisch geladen, aufbereitet und zur
                  Wissensbibliothek hinzugefügt (bis zu 20 Seiten, eine Ebene tief).
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={urlInput}
                      onChange={(e) => {
                        setUrlInput(e.target.value);
                        if (urlError) setUrlError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleIngestUrl();
                      }}
                      placeholder="https://www.lfl.bayern.de/itz/rind/..."
                      className="pl-9"
                      disabled={urlLoading}
                    />
                  </div>
                  <Button onClick={handleIngestUrl} disabled={urlLoading || !urlInput.trim()}>
                    {urlLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Lädt...
                      </>
                    ) : (
                      "Laden"
                    )}
                  </Button>
                </div>
                {urlError && (
                  <p className="text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {urlError}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Metadata Pending Confirmation Banner — only pending_review docs (Claude found useful fields) */}
      {docs.filter((d) => {
        const s = (d.metaPending as any)?._extractionStatus;
        return d.metaPending && !d.tierStufe && s !== "incomplete";
      }).length > 0 && (() => {
        const pendingDocs = docs.filter((d) => {
          const s = (d.metaPending as any)?._extractionStatus;
          return d.metaPending && !d.tierStufe && s !== "incomplete";
        });
        return (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-800">
                <BookMarked className="w-4 h-4" />
                Metadaten zur Bestätigung ausstehend ({pendingDocs.length} Dokument{pendingDocs.length !== 1 ? "e" : ""})
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 space-y-3">
              {pendingDocs.map((doc) => {
                const pending = doc.metaPending as any;
                const isOpen = confirmingDocId === doc.id;
                return (
                  <div key={doc.id} className="border border-amber-200 rounded-lg bg-white p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{doc.title}</p>
                        {pending?.metaTitel && (
                          <p className="text-xs text-muted-foreground truncate">KI-Vorschlag: {pending.metaTitel}</p>
                        )}
                        {pending?.topics && pending.topics.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(pending.topics as string[]).map((t: string) => (
                              <span key={t} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => isOpen ? setConfirmingDocId(null) : openMetaConfirm(doc)}
                        >
                          <Pencil className="w-3 h-3" />
                          {isOpen ? "Schließen" : "Bestätigen"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() => handleDismissMeta(doc.id)}
                        >
                          Überspringen
                        </Button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="space-y-2 pt-2 border-t border-amber-100">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Titel</label>
                            <Input
                              className="h-7 text-xs mt-0.5"
                              value={metaForm.metaTitel}
                              onChange={(e) => setMetaForm((f) => ({ ...f, metaTitel: e.target.value }))}
                              placeholder="Dokumenttitel"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Autoren</label>
                            <Input
                              className="h-7 text-xs mt-0.5"
                              value={metaForm.metaAutoren}
                              onChange={(e) => setMetaForm((f) => ({ ...f, metaAutoren: e.target.value }))}
                              placeholder="Müller, H.; Schmidt, A."
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Jahr</label>
                            <Input
                              className="h-7 text-xs mt-0.5"
                              value={metaForm.metaJahr}
                              onChange={(e) => setMetaForm((f) => ({ ...f, metaJahr: e.target.value }))}
                              placeholder="2023"
                              type="number"
                              min="1900"
                              max="2099"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Journal / Herausgeber</label>
                            <Input
                              className="h-7 text-xs mt-0.5"
                              value={metaForm.metaHerausgeber}
                              onChange={(e) => setMetaForm((f) => ({ ...f, metaHerausgeber: e.target.value }))}
                              placeholder="Journal of Dairy Science"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">DOI / Veröffentlichungs-URL</label>
                            <Input
                              className="h-7 text-xs mt-0.5"
                              value={metaForm.metaUrl}
                              onChange={(e) => setMetaForm((f) => ({ ...f, metaUrl: e.target.value }))}
                              placeholder="https://doi.org/10.3168/jds.2022-..."
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Vertrauensstufe (Tier)</label>
                          <div className="flex gap-2 mt-1">
                            {([1, 2, 3] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setMetaForm((f) => ({ ...f, tierStufe: String(t) }))}
                                className={cn(
                                  "flex-1 text-xs py-1 px-2 rounded border transition-colors",
                                  metaForm.tierStufe === String(t)
                                    ? TIER_LABELS[t].color + " ring-1 ring-offset-1 ring-primary"
                                    : "border-border hover:bg-muted",
                                )}
                              >
                                T{t}: {t === 1 ? "Wissenschaftlich" : t === 2 ? "Branchenpraxis" : "Betriebserfahrung"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Themen</label>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {KNOWLEDGE_TOPICS.map((topic) => (
                              <button
                                key={topic}
                                type="button"
                                onClick={() => setMetaForm((f) => ({
                                  ...f,
                                  topics: f.topics.includes(topic)
                                    ? f.topics.filter((t) => t !== topic)
                                    : [...f.topics, topic],
                                }))}
                                className={cn(
                                  "text-xs py-0.5 px-2 rounded-full border transition-colors",
                                  metaForm.topics.includes(topic)
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "border-border hover:bg-muted text-muted-foreground",
                                )}
                              >
                                {topic}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleConfirmMeta(doc.id)}
                            disabled={!metaForm.tierStufe}
                          >
                            <ShieldCheck className="w-3 h-3" />
                            Metadaten bestätigen
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setConfirmingDocId(null)}
                          >
                            Abbrechen
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      {/* Incomplete extraction banner — Claude ran but couldn't find key bibliographic fields */}
      {docs.filter((d) => (d.metaPending as any)?._extractionStatus === "incomplete" && !d.tierStufe).length > 0 && (() => {
        const incompleteDocs = docs.filter((d) => (d.metaPending as any)?._extractionStatus === "incomplete" && !d.tierStufe);
        return (
          <Card className="border-rose-200 bg-rose-50/30">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-rose-800">
                <AlertCircle className="w-4 h-4" />
                Metadaten unvollständig ({incompleteDocs.length} Dokument{incompleteDocs.length !== 1 ? "e" : ""}) — manuelle Eingabe erforderlich
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 space-y-2">
              {incompleteDocs.map((doc) => {
                const isOpen = confirmingDocId === doc.id;
                return (
                  <div key={doc.id} className="border border-rose-200 rounded-lg bg-white p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{doc.title}</p>
                        <p className="text-xs text-rose-600">KI konnte keine bibliografischen Daten ermitteln</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 border-rose-200 hover:bg-rose-50"
                          onClick={() => isOpen ? setConfirmingDocId(null) : openMetaConfirm(doc)}
                        >
                          <Pencil className="w-3 h-3" />
                          {isOpen ? "Schließen" : "Manuell eingeben"}
                        </Button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="space-y-2 pt-2 border-t border-rose-100">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Titel</label>
                            <Input className="h-7 text-xs mt-0.5" value={metaForm.metaTitel} onChange={(e) => setMetaForm((f) => ({ ...f, metaTitel: e.target.value }))} placeholder="Dokumenttitel" />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Autoren</label>
                            <Input className="h-7 text-xs mt-0.5" value={metaForm.metaAutoren} onChange={(e) => setMetaForm((f) => ({ ...f, metaAutoren: e.target.value }))} placeholder="Müller, H.; Schmidt, A." />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Jahr</label>
                            <Input className="h-7 text-xs mt-0.5" value={metaForm.metaJahr} onChange={(e) => setMetaForm((f) => ({ ...f, metaJahr: e.target.value }))} placeholder="2023" type="number" min="1900" max="2099" />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Journal / Herausgeber</label>
                            <Input className="h-7 text-xs mt-0.5" value={metaForm.metaHerausgeber} onChange={(e) => setMetaForm((f) => ({ ...f, metaHerausgeber: e.target.value }))} placeholder="Journal of Dairy Science" />
                          </div>
                          <div className="col-span-2">
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">DOI / Veröffentlichungs-URL</label>
                            <Input className="h-7 text-xs mt-0.5" value={metaForm.metaUrl} onChange={(e) => setMetaForm((f) => ({ ...f, metaUrl: e.target.value }))} placeholder="https://doi.org/10.3168/jds.2022-..." />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Vertrauensstufe (Tier)</label>
                          <div className="flex gap-2 mt-1">
                            {([1, 2, 3] as const).map((t) => (
                              <button key={t} type="button" onClick={() => setMetaForm((f) => ({ ...f, tierStufe: String(t) }))}
                                className={cn("flex-1 text-xs py-1 px-2 rounded border transition-colors", metaForm.tierStufe === String(t) ? TIER_LABELS[t].color + " ring-1 ring-offset-1 ring-primary" : "border-border hover:bg-muted")}>
                                T{t}: {t === 1 ? "Wissenschaftlich" : t === 2 ? "Branchenpraxis" : "Betriebserfahrung"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Themen</label>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {KNOWLEDGE_TOPICS.map((topic) => (
                              <button key={topic} type="button"
                                onClick={() => setMetaForm((f) => ({ ...f, topics: f.topics.includes(topic) ? f.topics.filter((t) => t !== topic) : [...f.topics, topic] }))}
                                className={cn("text-xs py-0.5 px-2 rounded-full border transition-colors", metaForm.topics.includes(topic) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted text-muted-foreground")}>
                                {topic}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleConfirmMeta(doc.id)} disabled={!metaForm.tierStufe}>
                            <ShieldCheck className="w-3 h-3" />
                            Metadaten speichern
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmingDocId(null)}>Abbrechen</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      {/* Knowledge Gaps */}
      <KnowledgeGapsCard />

      {/* Document List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Dokumente ({filteredDocs.length}{filteredDocs.length !== docs.length ? ` von ${docs.length}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Laden...
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">
                {activeCategory ? "Keine Dokumente in dieser Kategorie." : "Noch keine Dokumente hochgeladen."}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-start gap-4 py-3 first:pt-0 last:pb-0"
                >
                  {doc.sourceUrl ? (
                    <Globe className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                  ) : (
                    <FileText className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{doc.title}</p>
                    {doc.metaTitel && doc.metaTitel !== doc.title && (
                      <p className="text-xs text-primary/80 truncate italic">{doc.metaTitel}</p>
                    )}
                    {doc.metaAutoren && (
                      <p className="text-xs text-muted-foreground truncate">
                        {doc.metaAutoren}
                        {doc.metaJahr ? ` (${doc.metaJahr})` : ""}
                        {doc.metaHerausgeber ? ` · ${doc.metaHerausgeber}` : ""}
                      </p>
                    )}
                    {doc.sourceUrl ? (
                      <p className="text-xs text-muted-foreground truncate">
                        <a
                          href={doc.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {doc.sourceUrl}
                        </a>
                        {" · "}
                        {new Date(doc.createdAt).toLocaleDateString("de-DE")}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground truncate">
                        {doc.filename} · {formatBytes(doc.size)} ·{" "}
                        {new Date(doc.createdAt).toLocaleDateString("de-DE")}
                      </p>
                    )}
                    {doc.status === "error" && doc.errorMessage && (
                      <p className="text-xs text-red-600 mt-0.5">
                        {doc.errorMessage}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {doc.category && <CategoryBadge category={doc.category} />}
                      {doc.tierStufe && TIER_LABELS[doc.tierStufe] && (
                        <span className={cn(
                          "text-[10px] font-medium px-1.5 py-0.5 rounded border",
                          TIER_LABELS[doc.tierStufe].color,
                        )}>
                          T{doc.tierStufe}
                        </span>
                      )}
                      {doc.topics && doc.topics.length > 0 && doc.topics.map((t) => (
                        <span key={t} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full border border-border">
                          {t}
                        </span>
                      ))}
                      {doc.metaPending && !doc.tierStufe && (
                        <button
                          className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200 hover:bg-amber-200 transition-colors"
                          onClick={() => openMetaConfirm(doc)}
                        >
                          Metadaten bestätigen →
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 mt-0.5">
                    {(doc as any).documentType === "benchmark_reference" && (
                      <Badge className="bg-amber-100 text-amber-800 border border-amber-200 gap-1 text-xs shrink-0">
                        <Star className="w-2.5 h-2.5" />
                        Referenz-Benchmark
                      </Badge>
                    )}
                    {(doc as any).documentType === "farm_abbreviations" && (
                      <Badge
                        className="bg-violet-100 text-violet-800 border border-violet-200 gap-1 text-xs shrink-0 cursor-pointer hover:bg-violet-200"
                        title="Klicken um Zuweisung zu entfernen"
                        onClick={() => setDocTypeMutation.mutate({ id: doc.id, documentType: null })}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        Kürzel-Liste
                      </Badge>
                    )}
                    {(doc as any).documentType === "dairycomp_manual" ? (
                      <Badge
                        className="bg-blue-100 text-blue-800 border border-blue-200 gap-1 text-xs shrink-0 cursor-pointer hover:bg-blue-200"
                        title="Klicken um Zuweisung zu entfernen"
                        onClick={() => setDocTypeMutation.mutate({ id: doc.id, documentType: null })}
                      >
                        <BookOpen className="w-2.5 h-2.5" />
                        DairyComp-Handbuch
                      </Badge>
                    ) : doc.status === "ready" && !(doc as any).documentType ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground hover:text-blue-700 shrink-0"
                        title="Als DairyComp-Handbuch markieren"
                        disabled={setDocTypeMutation.isPending}
                        onClick={() => setDocTypeMutation.mutate({ id: doc.id, documentType: "dairycomp_manual" })}
                      >
                        <BookOpen className="w-3 h-3 mr-1" />
                        DC-Handbuch
                      </Button>
                    ) : null}
                    <StatusBadge status={doc.status} chunkCount={doc.chunkCount} />
                    {(doc.status === "error" ||
                      (doc.status === "pending" &&
                        Date.now() - new Date(doc.createdAt).getTime() > 5 * 60 * 1000)) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-primary"
                        onClick={() => retryIngestMutation.mutate(doc.id)}
                        disabled={retryIngestMutation.isPending}
                        title="Einlesen erneut versuchen"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(doc.id)}
                      disabled={deleteMutation.isPending}
                      title="Dokument löschen"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="border-t pt-6 space-y-6">
        <BenchmarkFactorSection />
        <FarmNotesSection />
        <FarmDiarySection />
      </div>
    </PageLayout>
  );
}

// ── Operator: Farm Diary (all customer events) ────────────────────────────────

const DIARY_CATEGORY_DE: Record<string, string> = {
  feed: "Fütterung",
  infrastructure: "Infrastruktur",
  health: "Tiergesundheit",
  management: "Betriebsführung",
  weather: "Wetter",
  other: "Sonstiges",
};

type DiaryEntryAdmin = {
  id: string;
  entryDate: string;
  category: string;
  categoryLabel: string;
  description: string;
  reminderDays: number | null;
  reminderDueAt: string | null;
  remindedAt: string | null;
  createdAt: string;
  user: { id: string; email: string | null; name: string | null };
};

const API_BASE_DIARY = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

function FarmDiarySection() {
  const [entries, setEntries] = useState<DiaryEntryAdmin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterUser, setFilterUser] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getAuthToken();
      const params = new URLSearchParams();
      if (filterUser) params.set("userId", filterUser);
      if (filterCategory) params.set("category", filterCategory);
      const res = await fetch(`${API_BASE_DIARY}/api/admin/diary?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json() as DiaryEntryAdmin[];
      setEntries(data);
    } finally {
      setIsLoading(false);
    }
  }, [filterUser, filterCategory]);

  useEffect(() => {
    if (expanded) load();
  }, [expanded, load]);

  const users = Array.from(
    new Map(entries.map((e) => [e.user.id, e.user])).values(),
  );

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Betriebstagebuch
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Vom Agenten automatisch erfasste Betriebsereignisse aller Kunden
          </p>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
      </button>

      {expanded && (
        <>
          <div className="flex flex-wrap gap-2">
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-background"
            >
              <option value="">Alle Kunden</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email || u.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-background"
            >
              <option value="">Alle Kategorien</option>
              {Object.entries(DIARY_CATEGORY_DE).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <Card>
            <CardContent className="p-4">
              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Laden...
                </div>
              ) : entries.length === 0 ? (
                <p className="text-sm text-muted-foreground italic text-center py-4">
                  Noch keine Betriebsereignisse erfasst.
                </p>
              ) : (
                <div className="divide-y">
                  {entries.map((e) => (
                    <div key={e.id} className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-0.5">
                          <span className="text-xs font-medium text-muted-foreground">
                            {new Date(e.entryDate + "T12:00:00Z").toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })}
                          </span>
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">
                            {e.categoryLabel}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {e.user.name || e.user.email || e.user.id.slice(0, 8)}
                          </span>
                          {e.remindedAt && (
                            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs px-1.5 py-0 gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              erinnert
                            </Badge>
                          )}
                          {!e.remindedAt && e.reminderDueAt && (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs px-1.5 py-0 gap-1">
                              🔔 Erinnerung {new Date(e.reminderDueAt).toLocaleDateString("de-DE")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm">{e.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
