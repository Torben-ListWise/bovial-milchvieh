import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLayout } from "@/components/PageLayout";
import { Newspaper } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

interface FullEdition {
  id: string;
  title: string;
  teaser: string | null;
  bodyMarkdown: string | null;
  topicBadges: string[] | null;
  publishedAt: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function NachrichtenPage() {
  const { getToken } = useAuth();
  const [edition, setEdition] = useState<FullEdition | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const resp = await fetch(`${API_BASE}/api/news/latest/full`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) { setEdition(null); return; }
        const data = await resp.json() as FullEdition | null;
        if (!cancelled) setEdition(data);
      } catch {
        if (!cancelled) setEdition(null);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [getToken]);

  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Newspaper className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Nachrichten</h1>
        </div>

        {edition === undefined && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-3/4 rounded-lg" />
            <Skeleton className="h-4 w-1/3 rounded-lg" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        )}

        {edition === null && (
          <p className="text-muted-foreground text-sm py-8 text-center">
            Aktuell keine Nachrichten veröffentlicht.
          </p>
        )}

        {edition && (
          <article className="space-y-4">
            {edition.topicBadges && edition.topicBadges.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {edition.topicBadges.map((badge) => (
                  <span
                    key={badge}
                    className="bg-primary/10 text-primary text-xs font-medium rounded-full px-3 py-1"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}

            {edition.publishedAt && (
              <p className="text-xs text-muted-foreground">
                {formatDate(edition.publishedAt)}
              </p>
            )}

            <h2 className="text-xl font-semibold text-foreground leading-snug">
              {edition.title}
            </h2>

            {edition.teaser && (
              <p className="text-muted-foreground text-sm leading-relaxed border-l-2 border-primary/30 pl-3 italic">
                {edition.teaser}
              </p>
            )}

            {edition.bodyMarkdown && (
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {edition.bodyMarkdown}
                </ReactMarkdown>
              </div>
            )}
          </article>
        )}
      </div>
    </PageLayout>
  );
}
