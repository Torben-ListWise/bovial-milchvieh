import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminTemplates,
  useCreateAdminTemplate,
  useUpdateAdminTemplate,
  useDeleteAdminTemplate,
  useReorderAdminTemplates,
  getListAdminTemplatesQueryKey,
  type AdminTemplate,
} from "@workspace/api-client-react";
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown, Loader2, ToggleLeft, ToggleRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_OPTIONS = [
  { value: "", label: "Alle Sektoren" },
  { value: "milchvieh", label: "Milchvieh" },
  { value: "biogas", label: "Biogas" },
  { value: "ackerbau", label: "Ackerbau" },
];

function categoryLabel(tag: string | null | undefined) {
  return CATEGORY_OPTIONS.find((o) => o.value === (tag ?? ""))?.label ?? "Alle Sektoren";
}

type DialogMode = "create" | "edit";

interface TemplateFormState {
  title: string;
  emoji: string;
  shortDescription: string;
  promptText: string;
  categoryTag: string;
  active: boolean;
  sortOrder: number;
}

const EMPTY_FORM: TemplateFormState = {
  title: "",
  emoji: "📊",
  shortDescription: "",
  promptText: "",
  categoryTag: "",
  active: true,
  sortOrder: 0,
};

function TemplateDialog({
  mode,
  initial,
  onClose,
  onSave,
  isSaving,
}: {
  mode: DialogMode;
  initial: TemplateFormState;
  onClose: () => void;
  onSave: (data: TemplateFormState) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<TemplateFormState>(initial);

  function update(patch: Partial<TemplateFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background rounded-2xl shadow-xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold">
            {mode === "create" ? "Neue Vorlage anlegen" : "Vorlage bearbeiten"}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-[80px_1fr] gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Emoji
                </label>
                <Input
                  value={form.emoji}
                  onChange={(e) => update({ emoji: e.target.value })}
                  placeholder="📊"
                  className="text-center text-xl"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Titel *
                </label>
                <Input
                  value={form.title}
                  onChange={(e) => update({ title: e.target.value })}
                  placeholder="z.B. Milchleistungs-Trend"
                  required
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Kurzbeschreibung
              </label>
              <Input
                value={form.shortDescription}
                onChange={(e) => update({ shortDescription: e.target.value })}
                placeholder="Kurze Beschreibung (max. 80 Zeichen)"
                maxLength={80}
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {form.shortDescription.length}/80 Zeichen
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Prompt-Text *
              </label>
              <textarea
                value={form.promptText}
                onChange={(e) => update({ promptText: e.target.value })}
                placeholder="Der vollständige Analyseauftrag, der an den KI-Agenten gesendet wird…"
                className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Kategorie
                </label>
                <select
                  value={form.categoryTag}
                  onChange={(e) => update({ categoryTag: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Sortierung
                </label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => update({ sortOrder: parseInt(e.target.value, 10) || 0 })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={form.active}
                onChange={(e) => update({ active: e.target.checked })}
                className="h-4 w-4 rounded border-input"
              />
              <label htmlFor="active" className="text-sm font-medium">
                Aktiv (wird Kunden angezeigt)
              </label>
            </div>
          </div>
          <div className="px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {mode === "create" ? "Anlegen" : "Speichern"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirm({
  template,
  onClose,
  onConfirm,
  isDeleting,
}: {
  template: AdminTemplate;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background rounded-2xl shadow-xl border border-border w-full max-w-sm p-6 space-y-4">
        <h2 className="font-semibold text-lg">Vorlage löschen?</h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium">{template.emoji} {template.title}</span> wird dauerhaft
          gelöscht. Alle damit erstellten Analysen werden ebenfalls entfernt.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Löschen
          </Button>
        </div>
      </div>
    </div>
  );
}

export function OperatorTemplatesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates, isLoading } = useListAdminTemplates();

  const [dialog, setDialog] = useState<{
    mode: DialogMode;
    initial: TemplateFormState;
    templateId?: string;
  } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminTemplate | null>(null);

  const createMutation = useCreateAdminTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminTemplatesQueryKey() });
        setDialog(null);
        toast({ title: "Vorlage angelegt" });
      },
      onError: () => toast({ variant: "destructive", title: "Fehler beim Anlegen" }),
    },
  });

  const updateMutation = useUpdateAdminTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminTemplatesQueryKey() });
        setDialog(null);
        toast({ title: "Vorlage gespeichert" });
      },
      onError: () => toast({ variant: "destructive", title: "Fehler beim Speichern" }),
    },
  });

  const deleteMutation = useDeleteAdminTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminTemplatesQueryKey() });
        setDeleteTarget(null);
        toast({ title: "Vorlage gelöscht" });
      },
      onError: () => toast({ variant: "destructive", title: "Fehler beim Löschen" }),
    },
  });

  const reorderMutation = useReorderAdminTemplates({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminTemplatesQueryKey() });
      },
    },
  });

  function handleSave(data: TemplateFormState) {
    const payload = {
      title: data.title,
      emoji: data.emoji,
      shortDescription: data.shortDescription,
      promptText: data.promptText,
      categoryTag: data.categoryTag || null,
      sortOrder: data.sortOrder,
      active: data.active,
    };
    if (dialog?.mode === "create") {
      createMutation.mutate({ data: payload as any });
    } else if (dialog?.templateId) {
      updateMutation.mutate({ templateId: dialog.templateId, data: payload as any });
    }
  }

  function handleMove(template: AdminTemplate, direction: "up" | "down") {
    if (!templates) return;
    const sorted = [...templates].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((t) => t.id === template.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const a = sorted[idx];
    const b = sorted[swapIdx];
    const newA = a.sortOrder;
    const newB = b.sortOrder;

    reorderMutation.mutate({
      data: {
        items: [
          { id: a.id, sortOrder: newB },
          { id: b.id, sortOrder: newA },
        ],
      },
    });
  }

  const sorted = templates ? [...templates].sort((a, b) => a.sortOrder - b.sortOrder) : [];
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vorlagen</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Standard-Auswertungen verwalten, die Kunden mit einem Klick starten können
          </p>
        </div>
        <Button
          onClick={() => setDialog({ mode: "create", initial: EMPTY_FORM })}
        >
          <Plus className="w-4 h-4 mr-2" />
          Neue Vorlage
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Noch keine Vorlagen angelegt.</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground w-8">
                  #
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Vorlage
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
                  Kategorie
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Aktiv
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Reihenfolge
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, idx) => (
                <tr
                  key={t.id}
                  className={cn(
                    "border-b border-border last:border-0 transition-colors",
                    !t.active && "opacity-50",
                  )}
                >
                  <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <span className="text-xl leading-none mt-0.5">{t.emoji}</span>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{t.title}</p>
                        {t.shortDescription && (
                          <p className="text-xs text-muted-foreground truncate">
                            {t.shortDescription}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                      {categoryLabel(t.categoryTag)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        updateMutation.mutate({
                          templateId: t.id,
                          data: { active: !t.active } as any,
                        })
                      }
                      disabled={updateMutation.isPending}
                      title={t.active ? "Deaktivieren" : "Aktivieren"}
                      className="flex items-center gap-1.5 group"
                    >
                      {t.active ? (
                        <ToggleRight className="w-5 h-5 text-green-600 group-hover:text-green-700 transition-colors" />
                      ) : (
                        <ToggleLeft className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                      )}
                      <span
                        className={cn(
                          "text-xs font-medium",
                          t.active ? "text-green-700" : "text-muted-foreground",
                        )}
                      >
                        {t.active ? "Aktiv" : "Inaktiv"}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleMove(t, "up")}
                        disabled={idx === 0 || reorderMutation.isPending}
                        className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
                        title="Nach oben"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMove(t, "down")}
                        disabled={idx === sorted.length - 1 || reorderMutation.isPending}
                        className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
                        title="Nach unten"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() =>
                          setDialog({
                            mode: "edit",
                            templateId: t.id,
                            initial: {
                              title: t.title,
                              emoji: t.emoji,
                              shortDescription: t.shortDescription,
                              promptText: t.promptText,
                              categoryTag: t.categoryTag ?? "",
                              active: t.active,
                              sortOrder: t.sortOrder,
                            },
                          })
                        }
                        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        title="Bearbeiten"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(t)}
                        className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                        title="Löschen"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <TemplateDialog
          mode={dialog.mode}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onSave={handleSave}
          isSaving={isSaving}
        />
      )}

      {deleteTarget && (
        <DeleteConfirm
          template={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate({ templateId: deleteTarget.id })}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
