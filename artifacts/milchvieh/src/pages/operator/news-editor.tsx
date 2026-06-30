import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { PageLayout } from "@/components/PageLayout";
import { Plus, Pencil, Trash2, Send, X } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

interface NewsEdition {
  id: string;
  title: string;
  teaser: string | null;
  bodyMarkdown: string | null;
  topicBadges: string[] | null;
  status: "draft" | "published";
  publishedAt: string | null;
  createdAt: string;
}

interface FormState {
  title: string;
  teaser: string;
  bodyMarkdown: string;
  topicBadges: string;
}

const emptyForm = (): FormState => ({
  title: "",
  teaser: "",
  bodyMarkdown: "",
  topicBadges: "",
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function NewsEditorPage() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [editions, setEditions] = useState<NewsEdition[] | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  async function apiFetch(path: string, opts?: RequestInit) {
    const token = await getToken();
    return fetch(`${API_BASE}/api${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...opts?.headers,
      },
    });
  }

  async function loadEditions() {
    try {
      const resp = await apiFetch("/operator/news");
      if (!resp.ok) throw new Error("Laden fehlgeschlagen");
      const data = await resp.json() as NewsEdition[];
      setEditions(data);
    } catch {
      toast({ variant: "destructive", title: "Fehler beim Laden der Ausgaben" });
      setEditions([]);
    }
  }

  useEffect(() => { loadEditions(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startNew() {
    setForm(emptyForm());
    setEditingId("new");
  }

  function startEdit(ed: NewsEdition) {
    setForm({
      title: ed.title,
      teaser: ed.teaser ?? "",
      bodyMarkdown: ed.bodyMarkdown ?? "",
      topicBadges: (ed.topicBadges ?? []).join(", "),
    });
    setEditingId(ed.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast({ variant: "destructive", title: "Titel ist erforderlich" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        teaser: form.teaser.trim() || undefined,
        bodyMarkdown: form.bodyMarkdown.trim() || undefined,
        topicBadges: form.topicBadges
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      const resp = editingId === "new"
        ? await apiFetch("/operator/news", { method: "POST", body: JSON.stringify(body) })
        : await apiFetch(`/operator/news/${editingId}`, { method: "PUT", body: JSON.stringify(body) });

      if (!resp.ok) throw new Error("Speichern fehlgeschlagen");
      toast({ title: editingId === "new" ? "Entwurf erstellt" : "Entwurf gespeichert" });
      cancelEdit();
      await loadEditions();
    } catch {
      toast({ variant: "destructive", title: "Fehler beim Speichern" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(id: string) {
    try {
      const resp = await apiFetch(`/operator/news/${id}/publish`, { method: "POST" });
      if (!resp.ok) throw new Error("Veröffentlichen fehlgeschlagen");
      toast({ title: "Ausgabe veröffentlicht" });
      await loadEditions();
    } catch {
      toast({ variant: "destructive", title: "Fehler beim Veröffentlichen" });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Entwurf löschen?")) return;
    try {
      const resp = await apiFetch(`/operator/news/${id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error("Löschen fehlgeschlagen");
      toast({ title: "Entwurf gelöscht" });
      await loadEditions();
    } catch {
      toast({ variant: "destructive", title: "Fehler beim Löschen" });
    }
  }

  return (
    <PageLayout>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Nachrichten-Editor</h1>
          {editingId === null && (
            <Button onClick={startNew} size="sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Neue Ausgabe
            </Button>
          )}
        </div>

        {editingId !== null && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="font-semibold text-base text-foreground">
              {editingId === "new" ? "Neue Ausgabe erstellen" : "Entwurf bearbeiten"}
            </h2>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Titel *</label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Titelzeile der Ausgabe"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Teaser <span className="font-normal">(2–3 Sätze Vorschautext)</span>
              </label>
              <Textarea
                value={form.teaser}
                onChange={(e) => setForm((f) => ({ ...f, teaser: e.target.value }))}
                placeholder="Kurze Vorschau für die Übersichtsseite…"
                rows={3}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Inhalt <span className="font-normal">(Markdown)</span>
              </label>
              <Textarea
                value={form.bodyMarkdown}
                onChange={(e) => setForm((f) => ({ ...f, bodyMarkdown: e.target.value }))}
                placeholder="## Überschrift&#10;&#10;Text mit **Fettschrift**, Listen, Tabellen…"
                rows={12}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Themen-Badges <span className="font-normal">(kommagetrennt)</span>
              </label>
              <Input
                value={form.topicBadges}
                onChange={(e) => setForm((f) => ({ ...f, topicBadges: e.target.value }))}
                placeholder="z. B. Fütterung, Tiergesundheit, Benchmarking"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Speichern…" : "Speichern"}
              </Button>
              <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                <X className="w-4 h-4 mr-1" />
                Abbrechen
              </Button>
            </div>
          </div>
        )}

        {editions === undefined && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        )}

        {editions !== undefined && editions.length === 0 && editingId === null && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Noch keine Ausgaben — erstelle deine erste mit „Neue Ausgabe".
          </p>
        )}

        {editions !== undefined && editions.length > 0 && (
          <div className="space-y-3">
            {editions.map((ed) => (
              <div
                key={ed.id}
                className="rounded-xl border border-border bg-card p-4 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                        ed.status === "published"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {ed.status === "published" ? "Veröffentlicht" : "Entwurf"}
                    </span>
                    {ed.publishedAt && (
                      <span className="text-xs text-muted-foreground">
                        {formatDate(ed.publishedAt)}
                      </span>
                    )}
                    {!ed.publishedAt && (
                      <span className="text-xs text-muted-foreground">
                        Erstellt {formatDate(ed.createdAt)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-medium text-sm text-foreground truncate">{ed.title}</p>
                  {ed.teaser && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{ed.teaser}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {ed.status === "draft" && editingId !== ed.id && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => startEdit(ed)}
                        title="Bearbeiten"
                        className="w-8 h-8"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handlePublish(ed.id)}
                        title="Veröffentlichen"
                        className="w-8 h-8 text-primary hover:text-primary"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(ed.id)}
                        title="Löschen"
                        className="w-8 h-8 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
