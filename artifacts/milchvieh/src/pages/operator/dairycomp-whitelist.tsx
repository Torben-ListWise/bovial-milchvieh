import { useState, useEffect, useMemo, useCallback } from "react";
import { getAuthToken } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Upload,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

const KATEGORIEN = [
  "Fruchtbarkeit & Besamung",
  "Milchleistung",
  "Eutergesundheit",
  "Tiergesundheit",
  "Fütterung",
  "Herdenmanagement",
  "Betriebswirtschaft",
  "Sonstiges",
];

interface WhitelistEntry {
  id: string;
  befehl: string;
  befehlsfamilie: string;
  beschreibung: string | null;
  kategorie: string | null;
  benoetigtZeitraum: boolean;
  benoetigtJungrinderFilter: boolean;
  quelleReferenz: string | null;
  createdAt: string;
}

interface ParsedEntry {
  befehl: string;
  befehlsfamilie: string;
  beschreibung?: string;
  kategorie?: string;
  benoetigtZeitraum?: boolean;
  benoetigtJungrinderFilter?: boolean;
  quelleReferenz?: string;
  _skip?: boolean;
}

const EMPTY_FORM: Omit<WhitelistEntry, "id" | "createdAt"> = {
  befehl: "",
  befehlsfamilie: "",
  beschreibung: "",
  kategorie: "",
  benoetigtZeitraum: false,
  benoetigtJungrinderFilter: false,
  quelleReferenz: "",
};

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = await getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function DairycompWhitelistPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filter state ─────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [filterFamilie, setFilterFamilie] = useState<string>("all");
  const [filterKategorie, setFilterKategorie] = useState<string>("all");
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(new Set());

  // ── Add/Edit modal state ─────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<WhitelistEntry | null>(null);
  const [form, setForm] = useState<Omit<WhitelistEntry, "id" | "createdAt">>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ── Delete confirmation ──────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<WhitelistEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Bulk import state ────────────────────────────────────────────────────
  const [bulkText, setBulkText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsedEntries, setParsedEntries] = useState<ParsedEntry[] | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/admin/dairycomp-whitelist");
      setEntries(data as WhitelistEntry[]);
    } catch (err) {
      toast({ title: "Fehler beim Laden", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const families = useMemo(() => {
    const s = new Set(entries.map((e) => e.befehlsfamilie));
    return Array.from(s).sort();
  }, [entries]);

  const kategorien = useMemo(() => {
    const s = new Set(entries.map((e) => e.kategorie).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return entries.filter((e) => {
      if (filterFamilie !== "all" && e.befehlsfamilie !== filterFamilie) return false;
      if (filterKategorie !== "all" && e.kategorie !== filterKategorie) return false;
      if (q && !e.befehl.toLowerCase().includes(q) && !e.beschreibung?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, searchQuery, filterFamilie, filterKategorie]);

  const groupedByFamily = useMemo(() => {
    const groups = new Map<string, WhitelistEntry[]>();
    for (const e of filtered) {
      const g = groups.get(e.befehlsfamilie) ?? [];
      g.push(e);
      groups.set(e.befehlsfamilie, g);
    }
    return groups;
  }, [filtered]);

  // ── Add/Edit handlers ─────────────────────────────────────────────────────
  function openAdd() {
    setEditingEntry(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(entry: WhitelistEntry) {
    setEditingEntry(entry);
    setForm({
      befehl: entry.befehl,
      befehlsfamilie: entry.befehlsfamilie,
      beschreibung: entry.beschreibung ?? "",
      kategorie: entry.kategorie ?? "",
      benoetigtZeitraum: entry.benoetigtZeitraum,
      benoetigtJungrinderFilter: entry.benoetigtJungrinderFilter,
      quelleReferenz: entry.quelleReferenz ?? "",
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.befehl.trim() || !form.befehlsfamilie.trim()) {
      toast({ title: "Befehl und Befehlsfamilie sind Pflichtfelder", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editingEntry) {
        await apiFetch(`/api/admin/dairycomp-whitelist/${editingEntry.id}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
        toast({ title: "Eintrag aktualisiert" });
      } else {
        await apiFetch("/api/admin/dairycomp-whitelist", {
          method: "POST",
          body: JSON.stringify(form),
        });
        toast({ title: "Eintrag gespeichert" });
      }
      setModalOpen(false);
      await fetchEntries();
    } catch (err) {
      toast({ title: "Speichern fehlgeschlagen", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/dairycomp-whitelist/${deleteTarget.id}`, { method: "DELETE" });
      toast({ title: "Eintrag gelöscht" });
      setDeleteTarget(null);
      await fetchEntries();
    } catch (err) {
      toast({ title: "Löschen fehlgeschlagen", description: String(err), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  // ── Bulk import handlers ──────────────────────────────────────────────────
  async function handleParse() {
    if (!bulkText.trim()) return;
    setParsing(true);
    setParsedEntries(null);
    try {
      const data = await apiFetch("/api/admin/dairycomp-whitelist/parse", {
        method: "POST",
        body: JSON.stringify({ text: bulkText }),
      });
      setParsedEntries((data as { entries: ParsedEntry[] }).entries.map((e) => ({ ...e, _skip: false })));
    } catch (err) {
      toast({ title: "Parsing fehlgeschlagen", description: String(err), variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }

  async function handleBulkImport() {
    if (!parsedEntries) return;
    const toImport = parsedEntries.filter((e) => !e._skip);
    if (toImport.length === 0) {
      toast({ title: "Keine Einträge zum Importieren ausgewählt" });
      return;
    }
    setBulkImporting(true);
    try {
      const data = await apiFetch("/api/admin/dairycomp-whitelist/bulk", {
        method: "POST",
        body: JSON.stringify({ entries: toImport }),
      }) as { inserted: number; skipped: number };
      toast({ title: `Import abgeschlossen: ${data.inserted} neu, ${data.skipped} bereits vorhanden` });
      setParsedEntries(null);
      setBulkText("");
      await fetchEntries();
    } catch (err) {
      toast({ title: "Bulk-Import fehlgeschlagen", description: String(err), variant: "destructive" });
    } finally {
      setBulkImporting(false);
    }
  }

  function toggleFamilyCollapse(family: string) {
    setCollapsedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">DairyComp-Befehls-Whitelist</h1>
            <p className="text-sm text-muted-foreground">
              Geprüfte Befehlsliste — nur gelistete Befehle darf der Agent ausgeben
            </p>
          </div>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="w-4 h-4" />
          Befehl hinzufügen
        </Button>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-3">
        <div className="bg-muted/50 rounded-lg px-4 py-2 text-sm">
          <span className="text-muted-foreground">Gesamt:</span>{" "}
          <span className="font-semibold">{entries.length} Befehle</span>
        </div>
        <div className="bg-muted/50 rounded-lg px-4 py-2 text-sm">
          <span className="text-muted-foreground">Familien:</span>{" "}
          <span className="font-semibold">{families.length}</span>
        </div>
        <div className="bg-muted/50 rounded-lg px-4 py-2 text-sm">
          <span className="text-muted-foreground">Kategorien:</span>{" "}
          <span className="font-semibold">{kategorien.length}</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Befehl oder Beschreibung suchen…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterFamilie} onValueChange={setFilterFamilie}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Alle Familien" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Familien</SelectItem>
            {families.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterKategorie} onValueChange={setFilterKategorie}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Alle Kategorien" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Kategorien</SelectItem>
            {KATEGORIEN.map((k) => (
              <SelectItem key={k} value={k}>{k}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(searchQuery || filterFamilie !== "all" || filterKategorie !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearchQuery(""); setFilterFamilie("all"); setFilterKategorie("all"); }}
            className="gap-1 text-muted-foreground"
          >
            <X className="w-3.5 h-3.5" /> Filter zurücksetzen
          </Button>
        )}
      </div>

      {/* Table grouped by family */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Lade Whitelist…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Terminal className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Noch keine Befehle in der Whitelist</p>
          <p className="text-sm mt-1">Füge einzelne Befehle hinzu oder nutze den Bulk-Import unten.</p>
        </div>
      ) : groupedByFamily.size === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Keine Treffer für die gewählten Filter.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden divide-y">
          {Array.from(groupedByFamily.entries()).map(([family, rows]) => {
            const collapsed = collapsedFamilies.has(family);
            return (
              <div key={family}>
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
                  onClick={() => toggleFamilyCollapse(family)}
                >
                  {collapsed ? <ChevronRight className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
                  <span className="font-mono font-semibold text-sm">{family}</span>
                  <Badge variant="secondary" className="ml-1 text-xs">{rows.length}</Badge>
                  {rows[0]?.kategorie && (
                    <span className="text-xs text-muted-foreground ml-2">{rows[0].kategorie}</span>
                  )}
                </button>
                {!collapsed && (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/20">
                        <TableHead className="w-40">Befehl</TableHead>
                        <TableHead>Beschreibung</TableHead>
                        <TableHead className="w-28 text-center">Zeitraum</TableHead>
                        <TableHead className="w-28 text-center">Jungrinder</TableHead>
                        <TableHead className="w-36">Quelle</TableHead>
                        <TableHead className="w-20 text-right">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((entry) => (
                        <TableRow key={entry.id} className="group">
                          <TableCell>
                            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                              {entry.befehl}
                            </code>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                            {entry.beschreibung ?? "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {entry.benoetigtZeitraum ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                            ) : (
                              <span className="text-muted-foreground/30 text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {entry.benoetigtJungrinderFilter ? (
                              <CheckCircle2 className="w-4 h-4 text-blue-500 mx-auto" />
                            ) : (
                              <span className="text-muted-foreground/30 text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[140px]">
                            {entry.quelleReferenz ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => openEdit(entry)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(entry)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Bulk Import ───────────────────────────────────────────────────── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-muted/40 border-b">
          <Upload className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">KI-gestützter Bulk-Import</h2>
          <span className="text-xs text-muted-foreground ml-1">
            — Handbuch-Abschnitt einfügen, KI parst automatisch in strukturierte Einträge
          </span>
        </div>
        <div className="p-4 space-y-4">
          {parsedEntries === null ? (
            <>
              <Textarea
                placeholder="Befehlsliste hier einfügen — z.B. einen ganzen Handbuch-Abschnitt mit BREDSUM-Varianten inkl. Beschreibungen…"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="min-h-[120px] font-mono text-sm"
              />
              <div className="flex gap-3">
                <Button
                  onClick={handleParse}
                  disabled={parsing || !bulkText.trim()}
                  className="gap-2"
                  variant="secondary"
                >
                  {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Terminal className="w-4 h-4" />}
                  {parsing ? "Wird geparst…" : "Parsen"}
                </Button>
                {bulkText && (
                  <Button variant="ghost" size="sm" onClick={() => setBulkText("")} className="text-muted-foreground">
                    Leeren
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Vorschau der geparsten Einträge */}
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">
                  Vorschau — {parsedEntries.filter((e) => !e._skip).length} von {parsedEntries.length} Einträgen ausgewählt
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setParsedEntries((prev) => prev?.map((e) => ({ ...e, _skip: false })) ?? null)}
                  >
                    Alle wählen
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setParsedEntries((prev) => prev?.map((e) => ({ ...e, _skip: true })) ?? null)}
                  >
                    Alle abwählen
                  </Button>
                </div>
              </div>
              <div className="border rounded overflow-hidden max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="w-36">Befehl</TableHead>
                      <TableHead>Beschreibung</TableHead>
                      <TableHead className="w-44">Kategorie</TableHead>
                      <TableHead className="w-20 text-center">Zeitraum</TableHead>
                      <TableHead className="w-20 text-center">Jungrind.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedEntries.map((entry, idx) => (
                      <TableRow key={idx} className={entry._skip ? "opacity-40" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={!entry._skip}
                            onCheckedChange={(checked) =>
                              setParsedEntries((prev) =>
                                prev?.map((e, i) => i === idx ? { ...e, _skip: !checked } : e) ?? null
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                            {entry.befehl}
                          </code>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                          {entry.beschreibung ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {entry.kategorie ?? "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {entry.benoetigtZeitraum ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mx-auto" /> : <span className="text-muted-foreground/30 text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {entry.benoetigtJungrinderFilter ? <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 mx-auto" /> : <span className="text-muted-foreground/30 text-xs">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex gap-3 pt-1">
                <Button
                  onClick={handleBulkImport}
                  disabled={bulkImporting || parsedEntries.filter((e) => !e._skip).length === 0}
                  className="gap-2"
                >
                  {bulkImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {bulkImporting ? "Wird importiert…" : `${parsedEntries.filter((e) => !e._skip).length} Einträge importieren`}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setParsedEntries(null); }}
                  className="text-muted-foreground"
                >
                  Abbrechen
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Add/Edit Modal ────────────────────────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEntry ? "Befehl bearbeiten" : "Neuen Befehl hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="befehl">Befehl *</Label>
                <Input
                  id="befehl"
                  placeholder='z.B. BREDSUM\E'
                  value={form.befehl}
                  onChange={(e) => setForm((f) => ({ ...f, befehl: e.target.value }))}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">Exakter Befehlsstring inkl. Modifikator</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="befehlsfamilie">Befehlsfamilie *</Label>
                <Input
                  id="befehlsfamilie"
                  placeholder="z.B. BREDSUM"
                  value={form.befehlsfamilie}
                  onChange={(e) => setForm((f) => ({ ...f, befehlsfamilie: e.target.value }))}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="beschreibung">Beschreibung</Label>
              <Input
                id="beschreibung"
                placeholder="Kurze Beschreibung was der Befehl anzeigt"
                value={form.beschreibung ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, beschreibung: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kategorie">Kategorie</Label>
              <Select
                value={form.kategorie || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, kategorie: v === "none" ? "" : v }))}
              >
                <SelectTrigger id="kategorie">
                  <SelectValue placeholder="Kategorie wählen…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine</SelectItem>
                  {KATEGORIEN.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quelleReferenz">Quelle / Handbuch-Referenz</Label>
              <Input
                id="quelleReferenz"
                placeholder="z.B. DairyComp 305 Handbuch, S. 47"
                value={form.quelleReferenz ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, quelleReferenz: e.target.value }))}
              />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={form.benoetigtZeitraum}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, benoetigtZeitraum: !!v }))}
                />
                <span className="text-sm">Zeitraumfilter <code className="text-xs bg-muted px-1 rounded">\D</code></span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={form.benoetigtJungrinderFilter}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, benoetigtJungrinderFilter: !!v }))}
                />
                <span className="text-sm">Jungrinder-Filter <code className="text-xs bg-muted px-1 rounded">\*</code></span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editingEntry ? "Aktualisieren" : "Hinzufügen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ───────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              Eintrag löschen?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Der Befehl{" "}
            <code className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
              {deleteTarget?.befehl}
            </code>{" "}
            wird unwiderruflich aus der Whitelist entfernt. Der Agent darf diesen Befehl danach nicht mehr ausgeben.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Abbrechen</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="gap-2">
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DairycompWhitelistPage;
