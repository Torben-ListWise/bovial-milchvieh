import { useState } from "react";
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
import { Loader2 } from "lucide-react";

const FOCUS_OPTIONS: { value: string; label: string; emoji: string; description: string }[] = [
  { value: "milchvieh", label: "Milchvieh", emoji: "🐄", description: "Milchkühe, Herde, Eutergesundheit" },
  { value: "schweine", label: "Schweinehaltung", emoji: "🐷", description: "Mast, Sauen, Ferkelproduktion" },
  { value: "geflügel", label: "Geflügel", emoji: "🐔", description: "Legehennen, Mastgeflügel, Puten" },
  { value: "ackerbau", label: "Ackerbau", emoji: "🌾", description: "Getreide, Raps, Feldfrucht" },
  { value: "mischbetrieb", label: "Mischbetrieb", emoji: "🏡", description: "Mehrere Betriebszweige kombiniert" },
  { value: "sonstiges", label: "Sonstiges", emoji: "🌱", description: "Anderer Schwerpunkt" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FocusAreasOnboardingDialog({ open, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data);
        onClose();
      },
    },
  });

  function toggle(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function handleSave() {
    updateMe.mutate({ focusAreas: selected.length > 0 ? selected : ["sonstiges"] });
  }

  function handleSkip() {
    updateMe.mutate({ focusAreas: [] });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) return; }}>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Willkommen! Was ist dein Betriebsschwerpunkt?</DialogTitle>
          <DialogDescription>
            Wähle einen oder mehrere Schwerpunkte, damit wir dir die passenden Auswertungen anzeigen.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          {FOCUS_OPTIONS.map((opt) => {
            const isSelected = selected.includes(opt.value);
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
                <div className="min-w-0">
                  <p className="font-medium text-sm text-foreground">{opt.label}</p>
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
