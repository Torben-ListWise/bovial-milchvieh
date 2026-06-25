import { useState } from "react";
import {
  useListRules,
  getListRulesQueryKey,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  useListFarmNotes,
  getListFarmNotesQueryKey,
  useCreateFarmNote,
  useUpdateFarmNote,
  useDeleteFarmNote,
} from "@workspace/api-client-react";
import type { Rule, FarmNote } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { Switch } from "@/components/ui/switch";
import { Plus, Sliders, Activity, Trash2, Pencil, BookOpen, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// Canonical metric keys exposed to users with German labels
const METRIC_OPTIONS = [
  { key: "milk_yield_kg", label: "Milchleistung (kg)" },
  { key: "fat_pct", label: "Fettgehalt (%)" },
  { key: "protein_pct", label: "Eiweißgehalt (%)" },
  { key: "scc", label: "Zellzahl (× 1.000/ml)" },
  { key: "urea", label: "Harnstoff (mg/dl)" },
  { key: "lactose_pct", label: "Laktose (%)" },
  { key: "body_weight_kg", label: "Körpergewicht (kg)" },
  { key: "days_in_milk", label: "Laktationstage" },
  { key: "lactation_number", label: "Laktationsnummer" },
  { key: "feed_intake_kg", label: "Futteraufnahme (kg)" },
  { key: "milking_count", label: "Melkfrequenz" },
];

const COMPARATOR_OPTIONS = [
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "eq", label: "=" },
];

const SEVERITY_OPTIONS = [
  { value: "info", label: "Information" },
  { value: "warning", label: "Warnung" },
  { value: "critical", label: "Kritisch" },
];

interface RuleFormValues {
  name: string;
  description: string;
  metric: string;
  comparator: "gt" | "gte" | "lt" | "lte" | "eq";
  threshold: string;
  unit: string;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
}

const defaultForm: RuleFormValues = {
  name: "",
  description: "",
  metric: "scc",
  comparator: "gt",
  threshold: "",
  unit: "",
  severity: "warning",
  enabled: true,
};

function metricLabel(key: string) {
  return METRIC_OPTIONS.find((m) => m.key === key)?.label ?? key;
}

function severityBadge(severity: string | null) {
  if (severity === "critical")
    return "bg-destructive/20 text-destructive border-destructive/30";
  if (severity === "warning")
    return "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400";
  return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400";
}

// ── Dialog for create / edit ──────────────────────────────────────────────────

function RuleDialog({
  open,
  initial,
  onClose,
  onSave,
  isPending,
}: {
  open: boolean;
  initial: RuleFormValues;
  onClose: () => void;
  onSave: (v: RuleFormValues) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<RuleFormValues>(initial);

  // Reset when dialog opens with new initial value
  useState(() => {
    setForm(initial);
  });

  const set = <K extends keyof RuleFormValues>(k: K, v: RuleFormValues[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const valid = form.name.trim() && form.metric && form.threshold.trim() && !isNaN(Number(form.threshold));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial.name ? "Regel bearbeiten" : "Neue Regel erstellen"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="z.B. Zellzahl-Warnung"
            />
          </div>
          <div className="space-y-1">
            <Label>Beschreibung (optional)</Label>
            <Input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="z.B. Warnung wenn Zellzahl erhöht"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Kennzahl</Label>
              <Select value={form.metric} onValueChange={(v) => set("metric", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRIC_OPTIONS.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Vergleich</Label>
              <Select value={form.comparator} onValueChange={(v) => set("comparator", v as RuleFormValues["comparator"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPARATOR_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Schwellenwert</Label>
              <Input
                type="number"
                value={form.threshold}
                onChange={(e) => set("threshold", e.target.value)}
                placeholder="z.B. 250"
              />
            </div>
            <div className="space-y-1">
              <Label>Einheit (optional)</Label>
              <Input
                value={form.unit}
                onChange={(e) => set("unit", e.target.value)}
                placeholder="z.B. k Zellen/ml"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Schweregrad</Label>
            <Select value={form.severity} onValueChange={(v) => set("severity", v as RuleFormValues["severity"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => set("enabled", v)}
              id="rule-enabled"
            />
            <Label htmlFor="rule-enabled">Regel aktiv</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Abbrechen
          </Button>
          <Button onClick={() => onSave(form)} disabled={!valid || isPending}>
            {isPending ? "Wird gespeichert…" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Farm Notes section ────────────────────────────────────────────────────────

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

  const handleAdd = () => {
    if (!noteText.trim()) return;
    createNote.mutate({ data: { content: noteText.trim() } });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          Betriebshinweise
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Schreibe Hinweise in natürlicher Sprache — z.&thinsp;B. welche Kennzahlen für deinen
          Betrieb besonders wichtig sind. Der Assistent berücksichtigt diese bei jeder Analyse.
        </p>
      </div>

      {/* Add new note */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label>Neuer Hinweis</Label>
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={'z.\u202FB. \u201EPregrate ist die wichtigste Fertilitatskennzahl.\u201C oder \u201EWir halten uberwiegend Erstlaktierende \u2013 bitte Laktationsnummer beachten.\u201C'}
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
              onClick={handleAdd}
            >
              <Plus className="w-3.5 h-3.5" />
              Hinweis hinzufügen
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* List of notes */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !notes || notes.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-4">
          Noch keine Betriebshinweise angelegt.
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <Card key={note.id} className={cn(!note.enabled && "opacity-55")}>
              <CardContent className="p-4">
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

// ── Main page ────────────────────────────────────────────────────────────────

export function RulesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Rule | null>(null);

  const { data: rules, isLoading } = useListRules({
    query: { queryKey: getListRulesQueryKey() },
  });

  const createRule = useCreateRule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
        setDialogOpen(false);
        toast({ title: "Regel erstellt" });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Regel konnte nicht gespeichert werden." });
      },
    },
  });

  const updateRule = useUpdateRule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
        setDialogOpen(false);
        setEditTarget(null);
        toast({ title: "Regel aktualisiert" });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Regel konnte nicht aktualisiert werden." });
      },
    },
  });

  const deleteRule = useDeleteRule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
        toast({ title: "Regel gelöscht" });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Regel konnte nicht gelöscht werden." });
      },
    },
  });

  const openCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (rule: Rule) => {
    setEditTarget(rule);
    setDialogOpen(true);
  };

  const handleSave = (v: RuleFormValues) => {
    const payload = {
      name: v.name,
      description: v.description || undefined,
      metric: v.metric,
      comparator: v.comparator,
      threshold: Number(v.threshold),
      unit: v.unit || undefined,
      severity: v.severity,
      enabled: v.enabled,
    };
    if (editTarget) {
      updateRule.mutate({ ruleId: editTarget.id, data: payload });
    } else {
      createRule.mutate({ data: payload });
    }
  };

  const isMutating = createRule.isPending || updateRule.isPending;

  const dialogInitial: RuleFormValues = editTarget
    ? {
        name: editTarget.name,
        description: editTarget.description ?? "",
        metric: editTarget.metric ?? "scc",
        comparator: (editTarget.comparator as RuleFormValues["comparator"]) ?? "gt",
        threshold: String(editTarget.threshold ?? ""),
        unit: editTarget.unit ?? "",
        severity: (editTarget.severity as RuleFormValues["severity"]) ?? "warning",
        enabled: editTarget.enabled ?? true,
      }
    : defaultForm;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Regeln & Schwellenwerte</h1>
          <p className="text-muted-foreground mt-1">
            Definiere, ab wann das System eine Warnung ausgeben soll. Die Regeln fließen
            automatisch in jede Analyse ein.
          </p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus className="w-4 h-4" />
          Neue Regel
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !rules || rules.length === 0 ? (
        <Card className="border-dashed bg-secondary/10">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Sliders className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Noch keine Regeln definiert</h3>
            <p className="text-muted-foreground mb-6 max-w-md">
              Erstelle eigene Regeln für Kennzahlen wie Milchleistung, Zellzahl oder
              Inhaltsstoffe, um automatisch gewarnt zu werden und den Assistenten zu steuern.
            </p>
            <Button onClick={openCreate}>Erste Regel erstellen</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rules.map((rule) => (
            <Card key={rule.id} className={cn(!rule.enabled && "opacity-60")}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div
                    className={cn(
                      "p-2 rounded-full shrink-0 border",
                      severityBadge(rule.severity ?? null),
                    )}
                  >
                    <Activity className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground flex items-center gap-2 flex-wrap">
                      {rule.name}
                      {!rule.enabled && (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                          Deaktiviert
                        </span>
                      )}
                    </h3>
                    {rule.description && (
                      <p className="text-sm text-muted-foreground truncate">{rule.description}</p>
                    )}
                    <div className="text-sm font-medium mt-1">
                      Wenn{" "}
                      <span className="text-primary">{metricLabel(rule.metric ?? "")}</span>{" "}
                      <span className="font-mono">{
                        rule.comparator === "gt" ? ">" :
                        rule.comparator === "lt" ? "<" :
                        rule.comparator === "gte" ? ">=" :
                        rule.comparator === "lte" ? "<=" : "="
                      }</span>{" "}
                      <span className="text-foreground font-semibold">{rule.threshold}</span>{" "}
                      {rule.unit && <span className="text-muted-foreground">{rule.unit}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => openEdit(rule)}>
                    <Pencil className="w-3.5 h-3.5" />
                    Bearbeiten
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    disabled={deleteRule.isPending}
                    onClick={() => deleteRule.mutate({ ruleId: rule.id })}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RuleDialog
        key={editTarget?.id ?? "new"}
        open={dialogOpen}
        initial={dialogInitial}
        onClose={() => {
          setDialogOpen(false);
          setEditTarget(null);
        }}
        onSave={handleSave}
        isPending={isMutating}
      />

      {/* Divider */}
      <div className="border-t pt-6">
        <FarmNotesSection />
      </div>
    </div>
  );
}
