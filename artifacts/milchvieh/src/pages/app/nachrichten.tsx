import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { useLocation, useSearch } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLayout } from "@/components/PageLayout";
import { Newspaper, ExternalLink, ArrowRight, Clock, ChevronLeft, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  ctaType: "route" | "chat_prompt";
  ctaTarget: string;
  status: string;
  batchRunAt: string | null;
}

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

function estimateReadTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

// ── Markdown prose styles ─────────────────────────────────────────────────────

const PROSE_CLASSES =
  "text-sm text-foreground leading-relaxed " +
  "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-4 " +
  "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 " +
  "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-3 " +
  "[&_p]:mb-3 [&_p:last-child]:mb-0 " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ul]:space-y-1 " +
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_ol]:space-y-1 " +
  "[&_li]:leading-relaxed " +
  "[&_strong]:font-semibold " +
  "[&_em]:italic " +
  "[&_blockquote]:border-l-4 [&_blockquote]:border-primary/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:mb-3 " +
  "[&_hr]:border-border [&_hr]:my-4 " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:opacity-80";

// ── CTA Button ────────────────────────────────────────────────────────────────

function CtaButton({
  ctaType,
  ctaTarget,
  datasetId,
}: {
  ctaType: "route" | "chat_prompt";
  ctaTarget: string;
  datasetId?: string;
}) {
  const [, navigate] = useLocation();

  if (!ctaTarget) return null;

  function handleClick() {
    if (ctaType === "route") {
      navigate(ctaTarget);
    } else {
      const promptParam = encodeURIComponent(ctaTarget);
      if (datasetId) {
        navigate(`/app/analyses?datasetId=${datasetId}&prompt=${promptParam}`);
      } else {
        navigate(`/app/analyses?prompt=${promptParam}`);
      }
    }
  }

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
    >
      {ctaType === "route" ? "Jetzt ansehen" : "Im Chat besprechen"}
      <ArrowRight className="w-4 h-4" />
    </button>
  );
}

// ── Edition card (shared by current + archive detail) ─────────────────────────

function EditionCard({ edition, datasetId }: { edition: NewsletterEdition; datasetId?: string }) {
  const readTime = estimateReadTime(edition.appBody);
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  function handleCopyLink() {
    const params = new URLSearchParams();
    params.set("edition", edition.id);
    if (datasetId) params.set("datasetId", datasetId);
    const url = `${window.location.origin}/app/nachrichten?${params.toString()}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast({ description: "Link wurde in die Zwischenablage kopiert." });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <article className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Meta bar */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border/60 bg-muted/30">
        <span
          className={`text-xs font-semibold rounded-full px-3 py-1 ${topicColorClass(edition.topicColor)}`}
        >
          {edition.topic}
        </span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            {readTime} Min. Lesezeit
          </span>
          <button
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Link kopieren"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            Link kopieren
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5 space-y-4">
        {/* Title + date */}
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">
            {formatDate(edition.scheduledDate)}
          </p>
          <h2 className="text-xl font-bold text-foreground leading-snug">
            {edition.title}
          </h2>
        </div>

        {/* Full body rendered as markdown */}
        <div className={PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {edition.appBody}
          </ReactMarkdown>
        </div>

        {/* Sources */}
        {edition.sources && edition.sources.length > 0 && (
          <div className="border-t border-border/60 pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Quellen
            </p>
            <ul className="space-y-1">
              {edition.sources.map((s, i) => (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    {s.name}
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTA */}
        {edition.ctaTarget && (
          <div className="pt-1">
            <CtaButton ctaType={edition.ctaType} ctaTarget={edition.ctaTarget} datasetId={datasetId} />
          </div>
        )}
      </div>
    </article>
  );
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
        <p className="text-muted-foreground text-sm py-8 text-center">
          Ausgabe nicht gefunden.
        </p>
      )}

      {edition && <EditionCard edition={edition} datasetId={datasetId} />}
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
              <EditionCard edition={current} datasetId={datasetId} />
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
