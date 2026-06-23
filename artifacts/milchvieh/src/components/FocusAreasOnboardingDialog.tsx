import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUpdateMe, useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FOCUS_OPTIONS: { value: string; label: string; emoji: string; description: string }[] = [
  { value: "milchvieh", label: "Milchvieh", emoji: "🐄", description: "Milchkühe, Herde, Eutergesundheit" },
  { value: "schweine", label: "Schweinehaltung", emoji: "🐷", description: "Mast, Sauen, Ferkelproduktion" },
  { value: "geflügel", label: "Geflügel", emoji: "🐔", description: "Legehennen, Mastgeflügel, Puten" },
  { value: "ackerbau", label: "Ackerbau", emoji: "🌾", description: "Getreide, Raps, Feldfrucht" },
  { value: "mischbetrieb", label: "Mischbetrieb", emoji: "🏡", description: "Mehrere Betriebszweige kombiniert" },
  { value: "sonstiges", label: "Sonstiges", emoji: "🌱", description: "Anderer Schwerpunkt" },
];

const FOCUS_LABELS: Record<string, string> = {
  milchvieh: "Milchviehdaten",
  schweine: "Schweinedaten",
  geflügel: "Geflügeldaten",
  ackerbau: "Ackerbaudaten",
  biogas: "Biogasdaten",
  mischbetrieb: "Mischbetriebsdaten",
};

interface Props {
  open: boolean;
  onClose: () => void;
  detectedFocusArea?: string | null;
  detectedFocusAreaConfidence?: number | null;
}

export function FocusAreasOnboardingDialog({
  open,
  onClose,
  detectedFocusArea,
  detectedFocusAreaConfidence,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateMe = useUpdateMe({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data);
        onClose();
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Betriebsschwerpunkt konnte nicht gespeichert werden." });
      },
    },
  });

  // Pre-select the detected focus area when suggestion is first available.
  // Only pre-select values that actually exist in the option list to avoid
  // submitting unsupported focus areas (e.g. "biogas" is a valid detection
  // output but is not a user-facing focus area).
  useEffect(() => {
    const isSelectable = FOCUS_OPTIONS.some((o) => o.value === detectedFocusArea);
    if (
      detectedFocusArea &&
      isSelectable &&
      !suggestionDismissed &&
      selected.length === 0
    ) {
      setSelected([detectedFocusArea]);
    }
  }, [detectedFocusArea]);

  function toggle(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function handleSave() {
    // Filter to only backend-allowed values before submitting.
    const validSelected = selected.filter((v) =>
      FOCUS_OPTIONS.some((o) => o.value === v),
    );
    updateMe.mutate({ focusAreas: validSelected.length > 0 ? validSelected : ["sonstiges"] });
  }

  function handleSkip() {
    updateMe.mutate({ focusAreas: [] });
  }

  const showSuggestion =
    !suggestionDismissed &&
    !!detectedFocusArea &&
    FOCUS_OPTIONS.some((o) => o.value === detectedFocusArea);

  const detectedLabel = detectedFocusArea
    ? (FOCUS_LABELS[detectedFocusArea] ?? detectedFocusArea)
    : null;

  const confidencePct = detectedFocusAreaConfidence != null
    ? Math.round(detectedFocusAreaConfidence * 100)
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Willkommen! Was ist dein Betriebsschwerpunkt?</DialogTitle>
          <DialogDescription>
            Wähle einen oder mehrere Schwerpunkte, damit wir dir die passenden Auswertungen anzeigen.
          </DialogDescription>
        </DialogHeader>

        {showSuggestion && (
          <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground">
                Wir haben {detectedLabel} erkannt — möchtest du das bestätigen?
              </p>
              {confidencePct !== null && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Erkennungssicherheit: {confidencePct}&nbsp;%
                </p>
              )}
            </div>
            <button
              onClick={() => setSuggestionDismissed(true)}
              className="text-muted-foreground hover:text-foreground text-xs shrink-0 mt-0.5"
              aria-label="Vorschlag schließen"
            >
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 py-2">
          {FOCUS_OPTIONS.map((opt) => {
            const isSelected = selected.includes(opt.value);
            const isSuggested = showSuggestion && opt.value === detectedFocusArea;
            return (
              <button
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/40 hover:bg-muted/50"
                }`}
              >
                <span className="text-2xl leading-none mt-0.5">{opt.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-sm text-foreground">{opt.label}</p>
                    {isSuggested && (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary leading-none">
                        Erkannt
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                </div>
                <div
                  className={`ml-auto w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                    isSelected
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/40"
                  }`}
                >
                  {isSelected && (
                    <svg viewBox="0 0 12 12" className="w-3 h-3 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={handleSkip}
            disabled={updateMe.isPending}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Überspringen
          </button>
          <Button
            onClick={handleSave}
            disabled={updateMe.isPending || selected.length === 0}
            className="gap-2"
          >
            {updateMe.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Speichern & starten
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
