import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthToken } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  CheckCircle2,
  XCircle,
  Pencil,
  ChevronDown,
  ChevronUp,
  Loader2,
  BookOpen,
  Sparkles,
  AlertTriangle,
  Terminal,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ReferenceAnalysis {
  id: string;
  status: "pending_review" | "confirmed" | "rejected";
  rawInput: string;
  adminNote: string | null;
  uploadFilename: string | null;
  extractedCommand: string | null;
  extractedCommandSynonyms: string[] | null;
  extractedPattern: string;
  extractedClassification: string;
  extractedTopic: string;
  editedPattern: string | null;
  editedClassification: string | null;
  editedCommand: string | null;
  editedCommandSynonyms: string[] | null;
  knowledgeDocId: string | null;
  createdAt: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(path: string, opts?: RequestInit) {
  const token = await getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: ReferenceAnalysis["status"] }) {
  if (status === "confirmed")
    return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-300/40 text-xs">✓ Bestätigt</Badge>;
  if (status === "rejected")
    return <Badge className="bg-red-500/15 text-red-700 border-red-300/40 text-xs">✕ Abgelehnt</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-700 border-amber-300/40 text-xs">⏳ Ausstehend</Badge>;
}

// ── Upload/Extraction form ────────────────────────────────────────────────────
function UploadForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [rawText, setRawText] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      let imageBase64: string | undefined;
      let imageMimeType: string | undefined;
      let uploadFilename: string | undefined;

      if (imageFile) {
        const buf = await imageFile.arrayBuffer();
        imageBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        imageMimeType = imageFile.type;
        uploadFilename = imageFile.name;
      }

      return apiFetch("/api/admin/reference-analyses", {
        method: "POST",
        body: JSON.stringify({ rawText, adminNote, imageBase64, imageMimeType, uploadFilename }),
      });
    },
    onSuccess: () => {
      toast({ title: "Extraktion erfolgreich", description: "Bitte prüfe das extrahierte Muster und bestätige oder korrigiere es." });
      setRawText("");
      setAdminNote("");
      setImageFile(null);
      onCreated();
    },
    onError: (err: Error) => {
      toast({ title: "Extraktion fehlgeschlagen", description: err.message, variant: "destructive" });
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) setImageFile(file);
  }, []);

  const canSubmit = rawText.trim().length > 0 || imageFile !== null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Neues Referenzbeispiel hochladen</h2>
      </div>

      {/* Image drop zone */}
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/40",
          imageFile && "border-primary/60 bg-primary/5",
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setImageFile(f); }}
        />
        <Upload className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
        {imageFile ? (
          <p className="text-xs text-primary font-medium">{imageFile.name}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Screenshot hierher ziehen oder klicken</p>
        )}
        {imageFile && (
          <button
            className="mt-1 text-xs text-muted-foreground underline"
            onClick={(e) => { e.stopPropagation(); setImageFile(null); }}
          >
            Entfernen
          </button>
        )}
      </div>

      {/* Raw text paste area */}
      <Textarea
        placeholder="Oder: Analysetext / DairyComp-Befehlsausgabe hier einfügen (z.B. kopierter Reporttext oder Tabelleninhalt)…"
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        rows={5}
        className="text-sm resize-none font-mono"
      />

      {/* Admin note */}
      <Textarea
        placeholder={'Eigene Einschätzung (optional): z.B. "Das ist gut", "hier ist die Stellschraube", "auffällig wegen…"'}
        value={adminNote}
        onChange={(e) => setAdminNote(e.target.value)}
        rows={2}
        className="text-sm resize-none"
      />

      <Button
        onClick={() => mutation.mutate()}
        disabled={!canSubmit || mutation.isPending}
        className="w-full"
        size="sm"
      >
        {mutation.isPending ? (
          <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />KI extrahiert Muster…</>
        ) : (
          <><Sparkles className="w-3.5 h-3.5 mr-2" />Muster extrahieren</>
        )}
      </Button>
    </div>
  );
}

// ── Reference analysis card ───────────────────────────────────────────────────
function ReferenceAnalysisCard({
  item,
  onUpdate,
}: {
  item: ReferenceAnalysis;
  onUpdate: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(item.status === "pending_review");
  const [editingPattern, setEditingPattern] = useState(false);
  const [editingClass, setEditingClass] = useState(false);
  const [editingCommand, setEditingCommand] = useState(false);
  const [patternDraft, setPatternDraft] = useState(item.editedPattern ?? item.extractedPattern);
  const [classDraft, setClassDraft] = useState(item.editedClassification ?? item.extractedClassification);
  const [commandDraft, setCommandDraft] = useState(item.editedCommand ?? item.extractedCommand ?? "");
  const [synonymsDraft, setSynonymsDraft] = useState(
    (item.editedCommandSynonyms ?? item.extractedCommandSynonyms ?? []).join("\n"),
  );

  const confirmMutation = useMutation({
    mutationFn: () => apiFetch(`/api/admin/reference-analyses/${item.id}/confirm`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Gespeichert", description: "Muster wurde in die Wissensbibliothek übernommen." }); onUpdate(); },
    onError: (err: Error) => toast({ title: "Fehler", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiFetch(`/api/admin/reference-analyses/${item.id}/reject`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Abgelehnt" }); onUpdate(); },
    onError: (err: Error) => toast({ title: "Fehler", description: err.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: (body: { editedPattern?: string; editedClassification?: string }) =>
      apiFetch(`/api/admin/reference-analyses/${item.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { toast({ title: "Gespeichert" }); onUpdate(); },
    onError: (err: Error) => toast({ title: "Fehler", description: err.message, variant: "destructive" }),
  });

  const reextractMutation = useMutation({
    mutationFn: () => apiFetch(`/api/admin/reference-analyses/${item.id}/reextract`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Neu extrahiert", description: "Muster wurde mit dem aktuellen Prompt neu generiert." });
      onUpdate();
    },
    onError: (err: Error) => toast({ title: "Neu-Extraktion fehlgeschlagen", description: err.message, variant: "destructive" }),
  });

  const currentPattern = item.editedPattern ?? item.extractedPattern;
  const currentClass = item.editedClassification ?? item.extractedClassification;

  return (
    <div className={cn(
      "rounded-xl border bg-card transition-all",
      item.status === "pending_review" ? "border-amber-300/40" : "border-border/50",
    )}>
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={item.status} />
            <span className="text-xs font-medium text-foreground truncate">{item.extractedTopic}</span>
            {item.extractedCommand && (
              <Badge variant="outline" className="text-xs font-mono gap-1">
                <Terminal className="w-2.5 h-2.5" />{item.extractedCommand}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date(item.createdAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            {item.uploadFilename && ` · ${item.uploadFilename}`}
          </p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/40 pt-4">

          {/* DairyComp command block — always shown for pending, or when any command data exists */}
          {(item.extractedCommand !== null || item.editedCommand !== null || item.status === "pending_review") && (
            <div className="rounded-lg bg-secondary/40 border border-border/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Terminal className="w-3 h-3" />
                  DairyComp-Befehl erkannt
                </p>
                {item.status === "pending_review" && !editingCommand && (
                  <button
                    onClick={() => setEditingCommand(true)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Pencil className="w-3 h-3" />Bearbeiten
                  </button>
                )}
              </div>

              {editingCommand ? (
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Befehlsname (z.B. <code className="font-mono">BREDSUM\E</code>)</p>
                    <Input
                      value={commandDraft}
                      onChange={(e) => setCommandDraft(e.target.value)}
                      placeholder="Befehlsname eingeben…"
                      className="text-sm font-mono h-8"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Synonyme (eine Zeile pro Synonym)</p>
                    <Textarea
                      value={synonymsDraft}
                      onChange={(e) => setSynonymsDraft(e.target.value)}
                      placeholder="Synonym 1&#10;Synonym 2&#10;…"
                      rows={4}
                      className="text-sm resize-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={() => {
                        const synonymsArray = synonymsDraft
                          .split(/[\n,]/)
                          .map((s) => s.trim())
                          .filter(Boolean);
                        saveMutation.mutate({
                          editedCommand: commandDraft.trim() || null,
                          editedCommandSynonyms: synonymsArray.length ? synonymsArray : null,
                        } as any);
                        setEditingCommand(false);
                      }}
                    >
                      Speichern
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7"
                      onClick={() => {
                        setCommandDraft(item.editedCommand ?? item.extractedCommand ?? "");
                        setSynonymsDraft(
                          (item.editedCommandSynonyms ?? item.extractedCommandSynonyms ?? []).join("\n"),
                        );
                        setEditingCommand(false);
                      }}
                    >
                      Abbrechen
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {(item.editedCommand ?? item.extractedCommand) ? (
                    <code className="text-xs font-mono text-foreground block">
                      {item.editedCommand ?? item.extractedCommand}
                    </code>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Kein Befehl erkannt — manuell eintragen</p>
                  )}
                  {(() => {
                    const syns = item.editedCommandSynonyms ?? item.extractedCommandSynonyms;
                    return syns?.length ? (
                      <p className="text-xs text-muted-foreground">
                        Synonyme: {syns.join(" · ")}
                      </p>
                    ) : null;
                  })()}
                  <p className="text-xs text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Wird nach Bestätigung automatisch dem DairyComp-Glossar hinzugefügt
                  </p>
                </>
              )}
            </div>
          )}

          {/* Interpretation pattern */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-muted-foreground">Interpretationsmuster</p>
              {item.status === "pending_review" && !editingPattern && (
                <button
                  onClick={() => setEditingPattern(true)}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Pencil className="w-3 h-3" />Bearbeiten
                </button>
              )}
            </div>
            {editingPattern ? (
              <div className="space-y-2">
                <Textarea
                  value={patternDraft}
                  onChange={(e) => setPatternDraft(e.target.value)}
                  rows={5}
                  className="text-sm resize-none"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => {
                      saveMutation.mutate({ editedPattern: patternDraft });
                      setEditingPattern(false);
                    }}
                  >Speichern</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { setPatternDraft(currentPattern); setEditingPattern(false); }}>Abbrechen</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {currentPattern || <span className="text-muted-foreground italic">Kein Muster extrahiert</span>}
              </p>
            )}
          </div>

          {/* Classification logic */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-muted-foreground">Einstufungslogik (Ampel)</p>
              {item.status === "pending_review" && !editingClass && (
                <button
                  onClick={() => setEditingClass(true)}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Pencil className="w-3 h-3" />Bearbeiten
                </button>
              )}
            </div>
            {editingClass ? (
              <div className="space-y-2">
                <Textarea
                  value={classDraft}
                  onChange={(e) => setClassDraft(e.target.value)}
                  rows={4}
                  className="text-sm resize-none"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => {
                      saveMutation.mutate({ editedClassification: classDraft });
                      setEditingClass(false);
                    }}
                  >Speichern</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { setClassDraft(currentClass); setEditingClass(false); }}>Abbrechen</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {currentClass || <span className="text-muted-foreground italic">Keine Einstufungslogik extrahiert</span>}
              </p>
            )}
          </div>

          {/* Action buttons */}
          {item.status === "pending_review" && (
            <div className="space-y-2 pt-1">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => confirmMutation.mutate()}
                  disabled={confirmMutation.isPending || rejectMutation.isPending || reextractMutation.isPending}
                >
                  {confirmMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />In Wissensbibliothek übernehmen</>
                  }
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/5"
                  onClick={() => rejectMutation.mutate()}
                  disabled={confirmMutation.isPending || rejectMutation.isPending || reextractMutation.isPending}
                >
                  <XCircle className="w-3.5 h-3.5 mr-1.5" />Ablehnen
                </Button>
              </div>
              {item.rawInput?.trim() && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => reextractMutation.mutate()}
                  disabled={confirmMutation.isPending || rejectMutation.isPending || reextractMutation.isPending}
                >
                  {reextractMutation.isPending
                    ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />KI extrahiert neu…</>
                    : <><RefreshCw className="w-3 h-3 mr-1.5" />Mit aktuellem Prompt neu extrahieren</>
                  }
                </Button>
              )}
            </div>
          )}

          {item.status === "confirmed" && item.knowledgeDocId && (
            <p className="text-xs text-emerald-700 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              Wissenseintrag gespeichert (ID: {item.knowledgeDocId.slice(0, 8)}…)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function ReferenceAnalysesPage() {
  const queryClient = useQueryClient();
  const queryKey = ["reference-analyses"];

  const { data, isLoading, isError } = useQuery<ReferenceAnalysis[]>({
    queryKey,
    queryFn: () => apiFetch("/api/admin/reference-analyses"),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const pending = data?.filter((r) => r.status === "pending_review") ?? [];
  const confirmed = data?.filter((r) => r.status === "confirmed") ?? [];
  const rejected = data?.filter((r) => r.status === "rejected") ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          Referenzanalysen
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lade DairyComp-Auswertungen oder andere Berichte hoch. Die KI extrahiert daraus generalisierte
          Interpretationsmuster <em>ohne</em> konkrete Betriebszahlen. Nach deiner Bestätigung fließen
          die Muster in die Wissensbibliothek ein und werden bei User-Antworten mit
          „Führende Betriebe in diesem Bereich zeigen…" zitiert.
        </p>
      </div>

      <UploadForm onCreated={refresh} />

      {isLoading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />Lade…
        </div>
      )}
      {isError && (
        <p className="text-sm text-destructive">Fehler beim Laden der Referenzanalysen.</p>
      )}

      {/* Pending section */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-amber-700 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
            Ausstehende Bestätigung ({pending.length})
          </h2>
          {pending.map((item) => (
            <ReferenceAnalysisCard key={item.id} item={item} onUpdate={refresh} />
          ))}
        </section>
      )}

      {/* Confirmed section */}
      {confirmed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            In Wissensbibliothek übernommen ({confirmed.length})
          </h2>
          {confirmed.map((item) => (
            <ReferenceAnalysisCard key={item.id} item={item} onUpdate={refresh} />
          ))}
        </section>
      )}

      {/* Rejected section */}
      {rejected.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground" />
            Abgelehnt ({rejected.length})
          </h2>
          {rejected.map((item) => (
            <ReferenceAnalysisCard key={item.id} item={item} onUpdate={refresh} />
          ))}
        </section>
      )}

      {data?.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Noch keine Referenzanalysen hochgeladen.</p>
          <p className="text-xs mt-1">Starte mit dem Upload-Formular oben.</p>
        </div>
      )}
    </div>
  );
}
