import { useState, useEffect } from "react";
import { AiIcon } from "../components/AiIcon";
import {
  Upload,
  Zap,
  Share2,
  ShieldCheck,
  FileText,
  ChevronDown,
  ArrowRight,
  Check,
  Star,
  X,
  ChevronLeft,
  ChevronRight,
  Play,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

interface LandingPageProps {
  basePath: string;
}

// ── Demo Modal ──────────────────────────────────────────────────────────────

const DEMO_SLIDES = [
  {
    title: "Daten hochladen — in 30 Sekunden",
    desc: "Ziehe deine Excel- oder CSV-Tabelle direkt ins Fenster. Der Assistent erkennt deinen Betriebstyp automatisch.",
    screen: (
      <div className="w-full h-full flex flex-col bg-[hsl(40_33%_97%)] rounded-xl overflow-hidden border border-[hsl(40_20%_88%)]">
        <div className="h-9 bg-white border-b flex items-center px-3 gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          <div className="ml-3 flex-1 h-4 bg-gray-100 rounded-md" />
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-36 bg-white border-r p-3 space-y-1.5">
            <div className="h-6 bg-[hsl(155_30%_25%)]/15 rounded-md" />
            <div className="h-5 bg-gray-100 rounded-md" />
            <div className="h-5 bg-gray-100 rounded-md" />
          </div>
          <div className="flex-1 p-5 flex flex-col items-center justify-center gap-4">
            <div className="w-full max-w-sm border-2 border-dashed border-[hsl(155_30%_25%)]/40 rounded-xl p-8 flex flex-col items-center gap-3 bg-[hsl(155_30%_25%)]/5">
              <div className="w-10 h-10 rounded-full bg-[hsl(155_30%_25%)]/20 flex items-center justify-center">
                <Upload className="w-5 h-5 text-[hsl(155_30%_25%)]" />
              </div>
              <div className="h-3 w-40 bg-[hsl(155_30%_25%)]/30 rounded" />
              <div className="h-2.5 w-28 bg-gray-200 rounded" />
            </div>
            <div className="flex gap-2">
              <div className="h-6 w-16 bg-gray-100 rounded-full text-[10px] flex items-center justify-center text-gray-400 font-medium">.xlsx</div>
              <div className="h-6 w-16 bg-gray-100 rounded-full text-[10px] flex items-center justify-center text-gray-400 font-medium">.csv</div>
              <div className="h-6 w-16 bg-gray-100 rounded-full text-[10px] flex items-center justify-center text-gray-400 font-medium">.pdf</div>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Fragen auf Deutsch stellen",
    desc: "Kein SQL, keine Formeln. Tippe deine Frage wie in einer WhatsApp-Nachricht — die KI findet die Antwort in deinen echten Zahlen.",
    screen: (
      <div className="w-full h-full flex flex-col bg-[hsl(40_33%_97%)] rounded-xl overflow-hidden border border-[hsl(40_20%_88%)]">
        <div className="h-9 bg-white border-b flex items-center px-3 gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <div className="flex flex-1 min-h-0 flex-col p-4 gap-3 overflow-hidden">
          <div className="flex gap-2.5 items-end">
            <div className="w-7 h-7 rounded-full bg-[hsl(155_30%_25%)]/20 shrink-0" />
            <div className="bg-[hsl(155_30%_25%)]/10 rounded-xl rounded-bl-sm px-3.5 py-2.5 max-w-[75%]">
              <div className="text-[10px] font-medium text-[hsl(155_30%_25%)] mb-1.5">Assistent</div>
              <div className="space-y-1">
                <div className="h-2 bg-[hsl(155_30%_25%)]/40 rounded w-52" />
                <div className="h-2 bg-[hsl(155_30%_25%)]/30 rounded w-44" />
                <div className="h-2 bg-[hsl(155_30%_25%)]/30 rounded w-36" />
              </div>
            </div>
          </div>
          <div className="flex gap-2.5 items-end justify-end">
            <div className="bg-white border rounded-xl rounded-br-sm px-3.5 py-2.5 max-w-[70%] shadow-sm">
              <div className="text-[10px] text-gray-400 mb-1">Du</div>
              <div className="text-[10px] font-medium text-gray-700">Warum ist die Zellzahl in Laktation 2 gestiegen?</div>
            </div>
            <div className="w-7 h-7 rounded-full bg-gray-200 shrink-0" />
          </div>
          <div className="flex gap-2.5 items-end">
            <div className="w-7 h-7 rounded-full bg-[hsl(155_30%_25%)]/20 shrink-0" />
            <div className="bg-[hsl(155_30%_25%)]/10 rounded-xl rounded-bl-sm px-3.5 py-2.5 max-w-[80%]">
              <div className="text-[10px] font-medium text-[hsl(155_30%_25%)] mb-1.5">Assistent</div>
              <div className="space-y-1">
                <div className="h-2 bg-[hsl(155_30%_25%)]/40 rounded w-56" />
                <div className="h-2 bg-[hsl(155_30%_25%)]/30 rounded w-48" />
                <div className="h-2 bg-[hsl(155_30%_25%)]/30 rounded w-40" />
                <div className="h-2 bg-[hsl(155_30%_25%)]/20 rounded w-44" />
              </div>
            </div>
          </div>
          <div className="mt-auto border-t pt-3 flex gap-2">
            <div className="flex-1 h-8 bg-white border rounded-lg shadow-sm" />
            <div className="w-8 h-8 bg-[hsl(155_30%_25%)] rounded-lg" />
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Betriebsspiegel auf Knopfdruck",
    desc: "Ein Template startet eine komplette Auswertung deines Betriebs — mit Kennzahlen, Auffälligkeiten und Handlungsempfehlungen. Als PDF exportierbar.",
    screen: (
      <div className="w-full h-full flex flex-col bg-[hsl(40_33%_97%)] rounded-xl overflow-hidden border border-[hsl(40_20%_88%)]">
        <div className="h-9 bg-white border-b flex items-center px-3 gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-4 w-32 bg-gray-800/20 rounded-md font-bold" />
            <div className="h-6 w-20 bg-[hsl(155_30%_25%)] rounded-md" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[["Ø Milchleistung", "#4da"], ["Zellzahl", "#da4"], ["Trockenstehzeit", "#4ad"]].map(([label, color]) => (
              <div key={label} className="bg-white rounded-lg border p-3 space-y-1.5">
                <div className="h-2 w-16 bg-gray-200 rounded" />
                <div className="h-5 w-12 rounded" style={{ background: color + "33" }} />
              </div>
            ))}
          </div>
          <div className="bg-white rounded-lg border p-3 space-y-2">
            <div className="h-2.5 w-28 bg-gray-300 rounded" />
            <div className="space-y-1.5">
              {[70, 50, 85, 60].map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-1.5 rounded-full bg-[hsl(155_30%_25%)]" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
            <div className="h-2.5 w-36 bg-amber-300 rounded" />
            <div className="h-2 w-48 bg-amber-200 rounded" />
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Ergebnisse teilen & archivieren",
    desc: "Teile Analysen mit deinem Berater per Link oder exportiere als PDF. Alle früheren Analysen bleiben im Archiv abrufbar.",
    screen: (
      <div className="w-full h-full flex flex-col bg-[hsl(40_33%_97%)] rounded-xl overflow-hidden border border-[hsl(40_20%_88%)]">
        <div className="h-9 bg-white border-b flex items-center px-3 gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 p-4 space-y-3">
          <div className="h-3.5 w-28 bg-gray-300 rounded-md" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white border rounded-lg p-3 flex items-center justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <div className="h-2.5 w-36 bg-gray-300 rounded" />
                <div className="h-2 w-24 bg-gray-200 rounded" />
              </div>
              <div className="flex gap-1.5">
                <div className="h-6 w-14 bg-[hsl(155_30%_25%)]/10 rounded text-[9px] flex items-center justify-center text-[hsl(155_30%_25%)] font-medium">PDF</div>
                <div className="h-6 w-14 bg-gray-100 rounded text-[9px] flex items-center justify-center text-gray-500 font-medium">Teilen</div>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 bg-[hsl(155_30%_25%)]/5 border border-[hsl(155_30%_25%)]/20 rounded-lg p-3">
            <Share2 className="w-4 h-4 text-[hsl(155_30%_25%)]" />
            <div className="flex-1 h-2.5 bg-[hsl(155_30%_25%)]/20 rounded" />
            <div className="h-5 w-16 bg-[hsl(155_30%_25%)] rounded text-[9px] flex items-center justify-center text-white font-medium">Kopieren</div>
          </div>
        </div>
      </div>
    ),
  },
];

function DemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [slide, setSlide] = useState(0);

  if (!open) return null;

  const current = DEMO_SLIDES[slide];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-card rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 rounded-lg p-1.5">
              <Play className="w-4 h-4 text-primary fill-primary" />
            </div>
            <span className="font-bold text-sm text-foreground">Produkt-Demo</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Screen */}
        <div className="p-5">
          <div className="aspect-[16/9] rounded-xl overflow-hidden bg-muted/30 border border-border">
            {current.screen}
          </div>
        </div>

        {/* Caption */}
        <div className="px-6 pb-2 text-center space-y-1">
          <h3 className="font-bold text-foreground">{current.title}</h3>
          <p className="text-sm text-muted-foreground">{current.desc}</p>
        </div>

        {/* Navigation */}
        <div className="px-6 py-5 flex items-center justify-between">
          <button
            onClick={() => setSlide((s) => Math.max(0, s - 1))}
            disabled={slide === 0}
            className="w-9 h-9 rounded-full border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Dots */}
          <div className="flex gap-2">
            {DEMO_SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                className={`rounded-full transition-all ${
                  i === slide
                    ? "w-5 h-2 bg-primary"
                    : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                }`}
              />
            ))}
          </div>

          <button
            onClick={() => setSlide((s) => Math.min(DEMO_SLIDES.length - 1, s + 1))}
            disabled={slide === DEMO_SLIDES.length - 1}
            className="w-9 h-9 rounded-full border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pricing Card ────────────────────────────────────────────────────────────

function PricingCard({
  name,
  price,
  subtitle,
  features,
  cta,
  ctaHref,
  highlighted,
  badge,
  trialNote,
}: {
  name: string;
  price: string;
  subtitle: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlighted?: boolean;
  badge?: string;
  trialNote?: string;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-8 ${
        highlighted
          ? "border-primary bg-primary text-primary-foreground shadow-2xl scale-[1.03]"
          : "border-border bg-card text-card-foreground shadow-sm"
      }`}
    >
      {badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="bg-amber-400 text-amber-900 text-xs font-bold px-3 py-1 rounded-full shadow">
            {badge}
          </span>
        </div>
      )}
      <div className="mb-6">
        <div className={`text-sm font-semibold uppercase tracking-widest mb-2 ${highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          {name}
        </div>
        <div className="flex items-end gap-1">
          <span className="text-4xl font-bold">{price}</span>
          <span className={`text-sm pb-1.5 ${highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
            /Monat
          </span>
        </div>
        <div className={`text-xs mt-1 ${highlighted ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
          inkl. 19 % MwSt.
        </div>
        <p className={`mt-3 text-sm ${highlighted ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
          {subtitle}
        </p>
      </div>
      <ul className="space-y-3 flex-1 mb-8">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check
              className={`w-4 h-4 mt-0.5 shrink-0 ${
                highlighted ? "text-primary-foreground" : "text-primary"
              }`}
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <a
        href={ctaHref}
        className={`w-full inline-flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-all ${
          highlighted
            ? "bg-white text-primary hover:bg-white/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        {cta}
        <ArrowRight className="w-4 h-4" />
      </a>
      {trialNote && (
        <p className={`mt-2.5 text-center text-[11px] ${highlighted ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
          {trialNote}
        </p>
      )}
    </div>
  );
}

// ── FAQ Item ────────────────────────────────────────────────────────────────

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        className="w-full flex items-center justify-between py-5 text-left gap-4 text-sm font-semibold text-foreground hover:text-primary transition-colors"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{question}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <p className="pb-5 text-sm text-muted-foreground leading-relaxed">
          {answer}
        </p>
      )}
    </div>
  );
}

// ── Main Landing Page ───────────────────────────────────────────────────────

export function LandingPage({ basePath }: LandingPageProps) {
  const [demoOpen, setDemoOpen] = useState(false);
  const { isDark, toggle } = useTheme();
  const [aiWorking, setAiWorking] = useState(true);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    function cycle() {
      timers.push(setTimeout(() => { setAiWorking(false); cycle2(); }, 4000));
    }
    function cycle2() {
      timers.push(setTimeout(() => { setAiWorking(true); cycle(); }, 2500));
    }
    cycle();
    return () => timers.forEach(clearTimeout);
  }, []);

  const pricingPlans = [
    {
      name: "Basis",
      price: "1,99 €",
      subtitle: "Einstieg in die KI-gestützte Betriebsanalyse",
      features: [
        "Einfache Auswertungen & Wissensfragen",
        "Wissensdatenbank & Referenzwerte",
        "Community-Support",
      ],
      cta: "Jetzt starten",
      ctaHref: `${basePath}/sign-up`,
    },
    {
      name: "Professional",
      price: "19 €",
      subtitle: "Für aktive Betriebe und Herdenmanager",
      features: [
        "Umfangreiche Auswertungen & Analysen",
        "Alle Vorlagen & Auswertungen",
        "Unbegrenzte Wissensfragen",
        "E-Mail-Support",
      ],
      cta: "14 Tage kostenlos testen",
      ctaHref: `${basePath}/app/upgrade?trial=1`,
      highlighted: true,
      badge: "Empfohlen",
      trialNote: "Danach 19 €/Monat · jederzeit kündbar",
    },
    {
      name: "Premium",
      price: "49 €",
      subtitle: "Für Betriebsleiter mit eigenem Datenzugang",
      features: [
        "Tiefenanalysen & KI-Investitionsprüfung",
        "Daten-Upload (Excel, CSV, PDF)",
        "3 Team-Einladungen",
        "Prioritäts-Support (24 h)",
      ],
      cta: "Premium wählen",
      ctaHref: `${basePath}/app/upgrade`,
    },
    {
      name: "Premium Max",
      price: "99 €",
      subtitle: "Maximale Leistung für Berater & große Betriebe",
      features: [
        "Unbegrenzte Analysen ohne Kontingent",
        "Daten-Upload (Excel, CSV, PDF)",
        "3 Team-Einladungen",
        "Prioritäts-Support",
        "Ideal für Landwirtschaftsberater",
      ],
      cta: "Premium Max wählen",
      ctaHref: `${basePath}/app/upgrade`,
      badge: "Unbegrenzt",
    },
  ];

  const faqs = [
    {
      question: "Was zählt als eine Analyse?",
      answer:
        "Eine Analyse ist jede vollständige KI-gestützte Auswertung, die du über den Chat oder einen Bericht-Template startest — vom ersten gesendeten Auftrag bis zum fertigen Ergebnis. Rückfragen innerhalb derselben Sitzung zählen nicht extra.",
    },
    {
      question: "Wer hat Zugriff auf meine Betriebsdaten?",
      answer:
        "Nur du. Deine Daten werden ausschließlich auf Servern in Deutschland gespeichert und niemals an Dritte weitergegeben oder für das Training von KI-Modellen verwendet. Anthropic (der KI-Anbieter) verarbeitet Abfragen ohne dauerhafte Speicherung.",
    },
    {
      question: "Welche Dateiformate kann ich hochladen?",
      answer:
        "Im Premium-Tarif kannst du CSV-Dateien, Excel-Tabellen (.xlsx) und PDFs (z. B. MLP-Berichte, LKV-Auswertungen) hochladen. Der Assistent erkennt das Format automatisch.",
    },
    {
      question: "Wie kündige ich mein Abo?",
      answer:
        "Du kannst jederzeit in den Einstellungen deines Kontos kündigen — ohne Fristen, ohne Anruf, ohne Formulare. Dein aktueller Tarif läuft bis zum Ende des bezahlten Monats weiter.",
    },
    {
      question: "Kann ich Mitarbeiter einladen?",
      answer:
        "Ja — im Premium-Tarif kannst du bis zu 3 Mitarbeiter (z. B. deinen Herdenmanager) einladen. Sie sehen deine Betriebsdaten und können Analysen starten, können aber keine Dateien hochladen.",
    },
    {
      question: "Funktioniert der Assistent auch für Schweine- oder Ackerbaubetriebe?",
      answer:
        "Ja. Der Assistent erkennt automatisch deinen Betriebstyp anhand der hochgeladenen Daten — Milchvieh, Schweine, Geflügel und Ackerbau werden unterstützt. Die KI passt ihre Fragen und Benchmarks entsprechend an.",
    },
    {
      question: "Gibt es eine Vertragsbindung?",
      answer:
        "Nein. Alle Tarife laufen monatlich und können jederzeit gekündigt werden. Du bezahlst nur, was du nutzt.",
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06] bg-card/80 backdrop-blur-xl">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <img src={`${basePath}/logo.svg`} alt="Logo" className="w-8 h-8 shrink-0" />
          <span className="font-bold text-lg text-primary hidden sm:block">Bovial</span>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition-colors">Funktionen</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Preise</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
        </nav>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={toggle}
            aria-label={isDark ? "Helles Design aktivieren" : "Dunkles Design aktivieren"}
            title={isDark ? "Helles Design" : "Dunkles Design"}
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <a href={`${basePath}/sign-in`} className="hidden sm:inline text-sm font-medium hover:underline text-foreground">
            Anmelden
          </a>
          <a
            href={`${basePath}/sign-up`}
            className="text-sm font-semibold bg-primary text-primary-foreground px-3 sm:px-4 py-2 rounded-lg hover:bg-primary/90 transition-all glow-sm whitespace-nowrap"
          >
            Jetzt starten
          </a>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="relative px-6 py-16 md:py-24 aurora-bg overflow-hidden">
          {/* Aurora glow orbs */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-primary/8 blur-[120px]" />
            <div className="absolute top-20 -right-20 w-[400px] h-[400px] rounded-full bg-cyan-500/6 blur-[100px]" />
            <div className="absolute top-40 -left-20 w-[300px] h-[300px] rounded-full bg-violet-500/5 blur-[80px]" />
          </div>
          <div className="max-w-5xl mx-auto text-center space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary">
              🇩🇪 Daten in Deutschland · DSGVO-konform
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white leading-[1.1]">
              Deine Betriebsdaten.<br className="hidden sm:block" />
              <span className="text-primary"> KI-Analyse.</span><br className="hidden sm:block" />
              Made in Germany.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Lade deine Zahlen hoch — egal ob Milchvieh, Schweine, Ackerbau oder Mischbetrieb.
              Stelle Fragen auf Deutsch. Erhalte klare Antworten, direkt aus deinen echten Daten.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href={`${basePath}/sign-up`}
                className="inline-flex items-center gap-2 text-base font-semibold bg-primary text-primary-foreground px-8 py-4 rounded-xl shadow-lg hover:bg-primary/90 hover:-translate-y-0.5 transition-all w-full sm:w-auto justify-center glow-md"
              >
                Jetzt starten
                <ArrowRight className="w-5 h-5" />
              </a>
              <button
                onClick={() => setDemoOpen(true)}
                className="inline-flex items-center gap-2 text-base font-semibold text-white glass px-8 py-4 rounded-xl hover:bg-white/10 transition-all w-full sm:w-auto justify-center"
              >
                <Play className="w-4 h-4 text-primary fill-primary" />
                Demo ansehen
              </button>
            </div>
            {/* Animated AiIcon centrepiece */}
            <div className="relative mx-auto flex items-center justify-center" style={{ width: 260, height: 260 }}>
              {/* Aurora glow rings */}
              <div className="absolute inset-0 rounded-full" style={{
                background: "radial-gradient(ellipse at center, hsl(var(--primary)/0.18) 0%, transparent 70%)",
                animation: "glow-pulse 3s ease-in-out infinite",
              }} />
              <div className="absolute rounded-full border border-primary/15" style={{
                inset: 20,
                animation: "spin-arc 18s linear infinite",
              }} />
              <div className="absolute rounded-full border border-cyan-400/10" style={{
                inset: 8,
                animation: "spin-arc 28s linear infinite reverse",
              }} />
              <div className="absolute rounded-full border border-violet-400/10" style={{
                inset: 36,
                animation: "spin-arc 22s linear infinite",
              }} />

              {/* Floating data-node dots */}
              {[
                { top: "14%",  left: "12%",  size: 6,  delay: "0s",    dur: "3.2s" },
                { top: "72%",  left: "8%",   size: 5,  delay: "0.8s",  dur: "4s"   },
                { top: "18%",  left: "80%",  size: 7,  delay: "0.4s",  dur: "3.6s" },
                { top: "76%",  left: "78%",  size: 5,  delay: "1.2s",  dur: "2.9s" },
                { top: "50%",  left: "4%",   size: 4,  delay: "1.6s",  dur: "3.8s" },
                { top: "50%",  left: "91%",  size: 4,  delay: "0.6s",  dur: "3.3s" },
                { top: "88%",  left: "42%",  size: 5,  delay: "1.0s",  dur: "4.1s" },
              ].map((dot, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-primary/50"
                  style={{
                    top: dot.top,
                    left: dot.left,
                    width: dot.size,
                    height: dot.size,
                    animation: `spark-pulse ${dot.dur} ease-in-out infinite`,
                    animationDelay: dot.delay,
                  }}
                />
              ))}

              {/* The icon itself */}
              <div className="relative z-10" style={{ transition: "opacity 0.6s ease" }}>
                <AiIcon
                  size={88}
                  working={aiWorking}
                  className="text-primary drop-shadow-[0_0_18px_hsl(var(--primary)/0.6)]"
                />
              </div>

              {/* State label */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: "hsl(var(--primary)/0.8)", transition: "opacity 0.4s" }}>
                {aiWorking ? "Analysiert…" : "Bereit"}
              </div>
            </div>

            {/* App mockup */}
            <div className="mx-auto max-w-3xl mt-8">
              <div className="aspect-[16/9] bg-card rounded-2xl shadow-2xl ring-1 ring-border/50 overflow-hidden flex flex-col">
                <div className="h-10 border-b flex items-center px-4 gap-2 bg-muted/30 shrink-0">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                  <div className="w-3 h-3 rounded-full bg-green-400"></div>
                  <div className="ml-4 h-5 w-48 bg-muted/60 rounded-md"></div>
                </div>
                <div className="flex flex-1 min-h-0">
                  <div className="w-44 border-r bg-muted/20 p-3 space-y-2 hidden sm:flex flex-col">
                    <div className="h-7 bg-primary/20 rounded-md"></div>
                    <div className="h-6 bg-muted/60 rounded-md"></div>
                    <div className="h-6 bg-muted/60 rounded-md"></div>
                    <div className="h-6 bg-muted/40 rounded-md"></div>
                  </div>
                  <div className="flex-1 p-5 space-y-4 overflow-hidden">
                    <div className="flex gap-3 items-end">
                      <div className="w-8 h-8 rounded-full bg-primary/20 shrink-0"></div>
                      <div className="bg-primary/10 rounded-xl rounded-bl-sm px-4 py-3 max-w-[70%]">
                        <div className="h-3 bg-primary/40 rounded w-48 mb-2"></div>
                        <div className="h-3 bg-primary/30 rounded w-32"></div>
                      </div>
                    </div>
                    <div className="flex gap-3 items-end justify-end">
                      <div className="bg-muted rounded-xl rounded-br-sm px-4 py-3 max-w-[65%]">
                        <div className="h-3 bg-muted-foreground/30 rounded w-40"></div>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-muted/60 shrink-0"></div>
                    </div>
                    <div className="flex gap-3 items-end">
                      <div className="w-8 h-8 rounded-full bg-primary/20 shrink-0"></div>
                      <div className="bg-primary/10 rounded-xl rounded-bl-sm px-4 py-3 max-w-[75%] space-y-2">
                        <div className="h-3 bg-primary/40 rounded w-56"></div>
                        <div className="h-3 bg-primary/30 rounded w-44"></div>
                        <div className="h-3 bg-primary/30 rounded w-36"></div>
                      </div>
                    </div>
                    <div className="mt-auto pt-3 border-t flex gap-2">
                      <div className="flex-1 h-9 bg-muted/50 rounded-lg"></div>
                      <div className="w-9 h-9 bg-primary/30 rounded-lg"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Trust bar ── */}
        <section className="border-y border-border/50 bg-card/60 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-6 py-5">
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="text-lg">🇩🇪</span>
                <span>Daten in Deutschland</span>
              </div>
              <div className="hidden sm:block w-px h-4 bg-border"></div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span>DSGVO-konform</span>
              </div>
              <div className="hidden sm:block w-px h-4 bg-border"></div>
              <div className="flex items-center gap-2">
                <span className="text-lg">📋</span>
                <span>Keine Vertragsbindung</span>
              </div>
              <div className="hidden sm:block w-px h-4 bg-border"></div>
              <div className="flex items-center gap-2">
                <span className="text-lg">🤖</span>
                <span>KI von Anthropic</span>
              </div>
              <div className="hidden sm:block w-px h-4 bg-border"></div>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span>Keine Datenweitergabe</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section id="features" className="px-6 py-20">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                In drei Schritten zur Analyse
              </h2>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                Kein Schulungsaufwand, keine Technik-Kenntnisse nötig — du kennst deinen Betrieb, der Assistent kennt die Zahlen.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  icon: Upload,
                  step: "01",
                  title: "Daten hochladen",
                  desc: "Lade deine Tabellen oder PDFs hoch — Milchleistungsprüfung, Buchführung, Fütterungsdaten. Excel und CSV werden sofort erkannt.",
                },
                {
                  icon: Zap,
                  step: "02",
                  title: "KI analysiert sofort",
                  desc: "Stelle deine Frage auf Deutsch. Die KI durchsucht deine echten Zahlen, erkennt Auffälligkeiten und erklärt Zusammenhänge — ohne Fachchinesisch.",
                },
                {
                  icon: Share2,
                  step: "03",
                  title: "Ergebnisse teilen",
                  desc: "Exportiere Berichte als PDF, teile Analysen mit deinem Berater oder speichere Erkenntnisse für den nächsten Beratungstermin.",
                },
              ].map(({ icon: Icon, step, title, desc }) => (
                <div
                  key={step}
                  className="relative bg-card/60 border border-white/[0.08] rounded-2xl p-8 shadow-sm hover:shadow-[0_0_24px_rgba(52,211,153,0.1)] hover:border-primary/30 transition-all duration-200 glass-card"
                >
                  <div className="absolute -top-3 -right-3 text-xs font-bold text-primary/30 text-6xl leading-none select-none">
                    {step}
                  </div>
                  <div className="bg-primary/10 rounded-xl p-3 w-fit mb-5">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-3">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" className="px-6 py-20 relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-primary/5 blur-[100px]" />
          </div>
          <div className="max-w-5xl mx-auto relative">
            <div className="text-center mb-14">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                Einfache, transparente Preise
              </h2>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                Transparente Monatstarife — upgrade oder kündige jederzeit ohne Vertragsbindung.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
              {pricingPlans.map((plan) => (
                <PricingCard key={plan.name} {...plan} />
              ))}
            </div>
            <p className="text-center text-xs text-muted-foreground mt-8">
              Alle Preise verstehen sich inkl. der gesetzlichen Mehrwertsteuer (19 %). Es gibt keine versteckten Kosten und keine Mindestlaufzeit.{" "}
              <a href={`${basePath}/agb`} className="underline hover:text-foreground transition-colors">
                Zu den AGB
              </a>
            </p>

            {/* Pricing FAQ */}
            <div className="mt-12 bg-card/60 border border-white/[0.07] glass-card rounded-2xl px-6 md:px-10 max-w-2xl mx-auto">
              <div className="py-6 border-b border-border">
                <h3 className="text-base font-bold text-foreground">Häufige Fragen zum Pricing</h3>
              </div>
              {[
                {
                  question: "Was passiert, wenn ich mein Analyse-Kontingent ausschöpfe?",
                  answer:
                    "Du bekommst eine Warnung, bevor das Kontingent aufgebraucht ist. Danach kannst du jederzeit upgraden oder auf den nächsten Monat warten — deine Daten bleiben erhalten.",
                },
                {
                  question: "Kann ich meinen Tarif jederzeit wechseln?",
                  answer:
                    "Ja, jederzeit. Ein Upgrade greift sofort, und dein bestehendes Kontingent wird anteilig berechnet.",
                },
                {
                  question: "Gibt es einen Jahrestarif mit Rabatt?",
                  answer:
                    "Noch nicht — aktuell sind alle Tarife monatlich. Wir planen Jahrestarife mit Rabatt für die Zukunft.",
                },
              ].map((item) => (
                <FaqItem key={item.question} {...item} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Social Proof ── */}
        <section className="px-6 py-20 bg-muted/20">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
                Was Landwirte sagen
              </h2>
              <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>
                Platzhalter — echte Erfahrungsberichte folgen nach dem Launch
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  name: "M. H.",
                  farm: "Milchviehbetrieb · Bayern · 180 Kühe",
                  quote:
                    "Ich habe endlich verstanden, warum die Zellzahl in Stall 2 immer im Sommer steigt. Der Assistent hat die Verbindung zu unseren Lüftungsdaten hergestellt — das hätte ich allein nie so schnell gesehen.",
                },
                {
                  name: "K. L.",
                  farm: "Ackerbau & Schweinehaltung · Niedersachsen",
                  quote:
                    "Die Investitionsprüfung hat mir 20 Seiten Tabellenarbeit erspart. Ich habe die Frage auf Deutsch gestellt und innerhalb von Minuten eine klare Gegenüberstellung gehabt.",
                },
                {
                  name: "T. B.",
                  farm: "Landwirtschaftsberater · NRW",
                  quote:
                    "Ich nutze den Assistenten für mehrere Kundenberichte. Die Daten bleiben beim Kunden, die Analysen sind nachvollziehbar — genau das, was ich für meine Beratung brauche.",
                },
              ].map(({ name, farm, quote }) => (
                <div
                  key={name}
                  className="bg-card/50 border border-white/[0.08] glass-card rounded-2xl p-6 shadow-sm space-y-4 relative hover:border-primary/20 transition-all"
                >
                  <div className="absolute top-4 right-4 text-[10px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                    Platzhalter
                  </div>
                  <div className="flex gap-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm text-foreground leading-relaxed italic">„{quote}"</p>
                  <div className="pt-2 border-t border-border">
                    <div className="font-semibold text-sm text-foreground">{name}</div>
                    <div className="text-xs text-muted-foreground">{farm}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="px-6 py-20 bg-muted/10">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                Häufige Fragen
              </h2>
              <p className="text-muted-foreground">Alles, was du wissen musst, bevor du startest.</p>
            </div>
            <div className="bg-card/60 border border-white/[0.07] glass-card rounded-2xl px-6 md:px-10">
              {faqs.map((faq) => (
                <FaqItem key={faq.question} {...faq} />
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA Banner ── */}
        <section className="px-6 py-20">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground">
              Bereit, deine Betriebsdaten zu verstehen?
            </h2>
            <p className="text-lg text-muted-foreground">
              Starte jetzt und verstehe deine Betriebsdaten — monatlich, ohne Vertragsbindung.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href={`${basePath}/sign-up`}
                className="inline-flex items-center gap-2 text-base font-semibold bg-primary text-primary-foreground px-10 py-4 rounded-xl shadow-lg hover:bg-primary/90 hover:-translate-y-0.5 transition-all"
              >
                Jetzt starten
                <ArrowRight className="w-5 h-5" />
              </a>
              <button
                onClick={() => setDemoOpen(true)}
                className="inline-flex items-center gap-2 text-base font-semibold text-foreground bg-secondary px-8 py-4 rounded-xl hover:bg-secondary/80 transition-all"
              >
                <Play className="w-4 h-4 text-primary fill-primary" />
                Demo ansehen
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground pt-4">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                Monatlich kündbar
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                Keine Vertragsbindung
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                Daten in Deutschland
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t bg-card">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src={`${basePath}/logo.svg`} alt="Logo" className="w-7 h-7" />
              <div>
                <div className="font-bold text-foreground">Bovial</div>
                <div className="text-xs text-muted-foreground">
                  KI-Analyse für Landwirte · Made in Germany 🇩🇪
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
              <a href={`${basePath}/impressum`} className="hover:text-foreground transition-colors">
                Impressum
              </a>
              <a href={`${basePath}/agb`} className="hover:text-foreground transition-colors">
                AGB
              </a>
              <a href={`${basePath}/datenschutz`} className="hover:text-foreground transition-colors">
                Datenschutz
              </a>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-border text-xs text-muted-foreground">
            © {new Date().getFullYear()} Bovial. Alle Rechte vorbehalten.
          </div>
        </div>
      </footer>
    </div>
  );
}
