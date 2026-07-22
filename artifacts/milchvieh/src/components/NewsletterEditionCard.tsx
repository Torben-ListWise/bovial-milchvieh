import { useState } from "react";
import { useLocation } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, ExternalLink, Clock, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getNewsletterTheme } from "@workspace/db/schema";

interface NewsSource {
  name: string;
  url: string;
}

interface KpiTile {
  value: string;
  label: string;
  sourceIndex: number;
}

export interface NewsletterEdition {
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
  kpiTiles?: KpiTile[] | null;
  causeEffect?: string[] | null;
  checklist?: string[] | null;
}

const PROSE_CLASSES =
  "text-sm text-foreground leading-relaxed " +
  "[&_p]:mb-3 [&_p:last-child]:mb-0 " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ul]:space-y-1 " +
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_ol]:space-y-1 " +
  "[&_li]:leading-relaxed " +
  "[&_strong]:font-semibold " +
  "[&_em]:italic " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2";

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

export function NewsletterEditionCard({
  edition,
  datasetId,
}: {
  edition: NewsletterEdition;
  datasetId?: string;
}) {
  const theme = getNewsletterTheme(edition.topic);
  const readTime = estimateReadTime(edition.appBody);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState(false);

  const kpiTiles = edition.kpiTiles ?? [];
  const causeEffect = edition.causeEffect ?? [];
  const checklist = edition.checklist ?? [];

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

  function handleCta() {
    if (!edition.ctaTarget) return;
    if (edition.ctaType === "route") {
      navigate(edition.ctaTarget);
    } else {
      const promptParam = encodeURIComponent(edition.ctaTarget);
      if (datasetId) {
        navigate(`/app/analyses?datasetId=${datasetId}&prompt=${promptParam}`);
      } else {
        navigate(`/app/analyses?prompt=${promptParam}`);
      }
    }
  }

  return (
    <article className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Colored header */}
      <div
        className="px-5 py-4"
        style={{ background: theme.bg, borderBottom: `3px solid ${theme.color}` }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">{theme.emoji}</span>
            <span
              className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
              style={{ background: theme.color, color: "#fff" }}
            >
              {edition.topic}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <Clock className="w-3.5 h-3.5" />
              {readTime} Min.
            </span>
            <button
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
              title="Link kopieren"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              Link
            </button>
          </div>
        </div>
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-1">{formatDate(edition.scheduledDate)}</p>
          <h2 className="text-xl font-bold leading-snug" style={{ color: theme.color }}>
            {edition.title}
          </h2>
        </div>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* KPI tiles */}
        {kpiTiles.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {kpiTiles.map((tile, i) => (
              <div
                key={i}
                className="rounded-xl p-4 flex flex-col gap-1"
                style={{ background: theme.bg, border: `1px solid ${theme.color}22` }}
              >
                <span
                  className="text-2xl font-extrabold leading-none"
                  style={{ color: theme.color }}
                >
                  {tile.value}
                </span>
                <span className="text-xs font-medium text-gray-700">{tile.label}</span>
                {tile.sourceIndex >= 0 && (
                  <span className="text-xs text-gray-400 mt-auto">
                    [{tile.sourceIndex + 1}]
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Cause → Effect chain */}
        {causeEffect.length === 3 && (
          <div
            className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-2 text-sm font-medium"
            style={{ background: theme.bg }}
          >
            {causeEffect.map((step, i) => (
              <span key={i} className="flex items-center gap-2">
                <span style={{ color: theme.color }}>{step}</span>
                {i < causeEffect.length - 1 && (
                  <span className="text-gray-400 font-bold">→</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Article body */}
        <div className={PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{edition.appBody}</ReactMarkdown>
        </div>

        {/* Checklist */}
        {checklist.length > 0 && (
          <div className="rounded-xl border border-border p-4 space-y-2">
            <p
              className="text-xs font-bold uppercase tracking-wide mb-2"
              style={{ color: theme.color }}
            >
              Handlungsempfehlungen
            </p>
            {checklist.map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-foreground">
                <span
                  className="mt-0.5 shrink-0 font-bold"
                  style={{ color: theme.color }}
                >
                  ✓
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        )}

        {/* Sources */}
        {edition.sources && edition.sources.length > 0 && (
          <div className="border-t border-border/60 pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Quellen
            </p>
            <ol className="space-y-1 list-none">
              {edition.sources.map((s, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 shrink-0 w-5">[{i + 1}]</span>
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
            </ol>
          </div>
        )}

        {/* CTA */}
        {edition.ctaTarget && (
          <div className="pt-1">
            <button
              onClick={handleCta}
              className="inline-flex items-center gap-2 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
              style={{ background: theme.color }}
            >
              {edition.ctaType === "route" ? "Jetzt ansehen" : "Im Chat besprechen"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
