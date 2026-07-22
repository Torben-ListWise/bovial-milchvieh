import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { useLocation, useSearch } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLayout } from "@/components/PageLayout";
import { Newspaper, ChevronLeft } from "lucide-react";
import { NewsletterEditionCard } from "@/components/NewsletterEditionCard";
import type { NewsletterEdition } from "@/components/NewsletterEditionCard";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

interface ArchiveItem {
  id: string;
  scheduledDate: string;
  topic: string;
  topicColor: string;
  title: string;
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOPIC_COLORS: Record<string, string> = {
  blue:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  green:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  amber:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  rose:   "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  cyan:   "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
};

function topicColorClass(color: string): string {
  return TOPIC_COLORS[color] ?? TOPIC_COLORS.blue;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ── Archive detail view ───────────────────────────────────────────────────────

function ArchiveDetailView({
  editionId,
  datasetId,
  onBack,
}: {
  editionId: string;
  datasetId?: string;
  onBack: () => void;
}) {
  const { getToken } = useAuth();
  const [edition, setEdition] = useState<NewsletterEdition | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const token = await getToken();
        const resp = await fetch(`${API_BASE}/api/news/newsletter/${editionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) {
          setEdition(resp.ok ? (await resp.json() as NewsletterEdition) : null);
        }
      } catch {
        if (!cancelled) setEdition(null);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [editionId, getToken]);

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Zurück zur Übersicht
      </button>

      {edition === undefined && (
        <div className="space-y-3">
          <Skeleton className="h-6 w-3/4 rounded-lg" />
          <Skeleton className="h-4 w-1/3 rounded-lg" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      )}

      {edition === null && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Newspaper className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-semibold text-foreground">
              Diese Ausgabe ist gerade nicht verfügbar
            </p>
            <p className="text-sm text-muted-foreground max-w-xs">
              Der Link könnte veraltet sein oder die Ausgabe wurde noch nicht veröffentlicht.
              Im Archiv finden Sie alle verfügbaren Beiträge.
            </p>
          </div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <ChevronLeft className="w-4 h-4" />
            Zum Archiv
          </button>
        </div>
      )}

      {edition && <NewsletterEditionCard edition={edition} datasetId={datasetId} />}
    </div>
  );
}

// ── Archive list ──────────────────────────────────────────────────────────────

function ArchiveList({
  items,
  currentId,
  onSelect,
}: {
  items: ArchiveItem[];
  currentId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const filtered = items.filter((i) => i.id !== currentId);
  if (filtered.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Ältere Ausgaben</h3>
      <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
        {filtered.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors group"
          >
            <span
              className={`text-xs font-medium rounded-full px-2.5 py-0.5 shrink-0 ${topicColorClass(item.topicColor)}`}
            >
              {item.topic}
            </span>
            <p className="flex-1 text-sm font-medium text-foreground truncate">
              {item.title}
            </p>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatDate(item.scheduledDate)}
            </span>
            <span className="text-xs font-medium text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              Lesen
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function NachrichtenPage() {
  const { getToken } = useAuth();
  const search = useSearch();
  const [, navigate] = useLocation();

  const params = new URLSearchParams(search);
  const datasetId = params.get("datasetId") ?? undefined;
  const editionId = params.get("edition") ?? undefined;

  const [current, setCurrent] = useState<NewsletterEdition | null | undefined>(undefined);
  const [archive, setArchive] = useState<ArchiveItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };

        const [curResp, archResp] = await Promise.all([
          fetch(`${API_BASE}/api/news/newsletter/current`, { headers }),
          fetch(`${API_BASE}/api/news/newsletter/archive`, { headers }),
        ]);

        if (!cancelled) {
          if (curResp.ok) {
            const data = await curResp.json() as NewsletterEdition | null;
            setCurrent(data);
          } else {
            setCurrent(null);
          }

          if (archResp.ok) {
            const data = await archResp.json() as ArchiveItem[];
            setArchive(data);
          }
        }
      } catch {
        if (!cancelled) setCurrent(null);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [getToken]);

  function handleSelectArchive(id: string) {
    const next = new URLSearchParams(search);
    next.set("edition", id);
    navigate(`/app/nachrichten?${next.toString()}`);
  }

  function handleBack() {
    const next = new URLSearchParams(search);
    next.delete("edition");
    const qs = next.toString();
    navigate(qs ? `/app/nachrichten?${qs}` : "/app/nachrichten");
  }

  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Newspaper className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Nachrichten</h1>
        </div>

        {/* Archive detail view */}
        {editionId ? (
          <ArchiveDetailView
            editionId={editionId}
            datasetId={datasetId}
            onBack={handleBack}
          />
        ) : (
          <>
            {/* Loading */}
            {current === undefined && (
              <div className="space-y-3">
                <Skeleton className="h-6 w-3/4 rounded-lg" />
                <Skeleton className="h-4 w-1/3 rounded-lg" />
                <Skeleton className="h-56 rounded-xl" />
              </div>
            )}

            {/* No content */}
            {current === null && archive.length === 0 && (
              <p className="text-muted-foreground text-sm py-8 text-center">
                Aktuell keine Nachrichten verfügbar.
              </p>
            )}

            {/* Current edition */}
            {current && (
              <NewsletterEditionCard edition={current} datasetId={datasetId} />
            )}

            {/* Archive */}
            {archive.length > 0 && (
              <ArchiveList
                items={archive}
                currentId={current?.id}
                onSelect={handleSelectArchive}
              />
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}
