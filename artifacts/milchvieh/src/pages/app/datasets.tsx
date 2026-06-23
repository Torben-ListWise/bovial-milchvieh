import { useState } from "react";
import {
  useListDatasets,
  useCreateDataset,
  useDeleteDataset,
  getListDatasetsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Home as HomeIcon, Loader2, Trash2, Milk, Zap, Wheat, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type Sector = "dairy" | "biogas" | "arable";

const SECTORS: {
  id: Sector;
  emoji: string;
  label: string;
  description: string;
}[] = [
  {
    id: "dairy",
    emoji: "🐄",
    label: "Milchvieh",
    description: "Analyse von Milchleistung, Gesundheit und Fruchtbarkeit",
  },
  {
    id: "biogas",
    emoji: "⚡",
    label: "Biogas",
    description: "Analyse von Gasproduktion, Substrat und Anlagenleistung",
  },
  {
    id: "arable",
    emoji: "🌾",
    label: "Ackerbau",
    description: "Analyse von Erträgen, Fruchtfolge und Deckungsbeiträgen",
  },
];

function sectorLabel(sector?: string): string {
  return SECTORS.find((s) => s.id === sector)?.label ?? "Milchvieh";
}

function SectorIcon({ sector, className }: { sector?: string; className?: string }) {
  const icons: Record<string, React.ElementType> = { dairy: Milk, biogas: Zap, arable: Wheat };
  const Icon = icons[sector ?? "dairy"] ?? Milk;
  return <Icon className={className} />;
}

type DatasetRow = {
  id: string;
  name: string;
  description?: string | null;
  sector?: string | null;
  fileCount?: number;
  status?: string;
};

function useHostDatasets(hostId: string) {
  const { getToken } = useAuth();
  return useQuery<DatasetRow[]>({
    queryKey: ["host-datasets", hostId],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/datasets?hostId=${encodeURIComponent(hostId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Fehler beim Laden");
      return res.json();
    },
    enabled: !!hostId,
  });
}

function GuestDatasetList({ hostId }: { hostId: string }) {
  const { data: datasets, isLoading } = useHostDatasets(hostId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-primary/70" />
        <div>
          <h1 className="text-3xl font-bold text-foreground">Geteilte Betriebe</h1>
          <p className="text-muted-foreground mt-1">Du hast Lesezugriff auf diese Betriebe.</p>
        </div>
      </div>

      {!datasets || datasets.length === 0 ? (
        <Card className="border-dashed bg-secondary/30">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Keine Betriebe gefunden</h3>
            <p className="text-muted-foreground max-w-md">
              Dieser Betrieb hat noch keine Datensätze angelegt.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {datasets.map((ds) => (
            <Card key={ds.id} className="hover:border-primary/50 transition-colors group relative">
              <Link href={`/app/overview?datasetId=${ds.id}&hostId=${hostId}`}>
                <div className="p-6">
                  <CardHeader className="p-0 mb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <SectorIcon sector={ds.sector ?? undefined} className="w-5 h-5 text-primary/70" />
                      <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                        {sectorLabel(ds.sector ?? undefined)}
                      </span>
                      <span className="text-xs text-muted-foreground bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full ml-auto">
                        Lesezugriff
                      </span>
                    </div>
                    <CardTitle className="group-hover:text-primary transition-colors">{ds.name}</CardTitle>
                    <CardDescription>{ds.description || "Keine Beschreibung"}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Dateien</div>
                        <div className="font-semibold text-lg">{ds.fileCount ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Status</div>
                        <div className="font-medium text-primary mt-1">
                          {ds.status === "ready" ? "Bereit" : ds.status === "empty" ? "Leer" : ds.status}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function DatasetList() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const hostId = params.get("hostId");

  if (hostId) {
    return <GuestDatasetList hostId={hostId} />;
  }

  return <OwnDatasetList />;
}

function OwnDatasetList() {
  const { data: datasets, isLoading } = useListDatasets();
  const createDataset = useCreateDataset();
  const deleteDataset = useDeleteDataset();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newSector, setNewSector] = useState<Sector>("dairy");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const openCreate = () => {
    setNewName("");
    setNewDescription("");
    setNewSector("dairy");
    setShowCreateDialog(true);
  };

  const handleCreate = () => {
    if (!newName.trim() || createDataset.isPending) return;
    createDataset.mutate(
      { data: { name: newName.trim(), description: newDescription.trim(), sector: newSector } },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListDatasetsQueryKey() });
          setShowCreateDialog(false);
          setLocation(`/app/upload?datasetId=${created.id}`);
        },
        onError: () => {
          toast({ variant: "destructive", title: "Fehler", description: "Betrieb konnte nicht angelegt werden." });
        },
      }
    );
  };

  const handleDelete = (id: string) => {
    deleteDataset.mutate(
      { datasetId: id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDatasetsQueryKey() });
          toast({ title: "Betrieb gelöscht", description: "Der Betrieb und alle zugehörigen Daten wurden entfernt." });
          setDeleteId(null);
        },
        onError: () => {
          toast({ variant: "destructive", title: "Fehler", description: "Betrieb konnte nicht gelöscht werden." });
          setDeleteId(null);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Deine Betriebe</h1>
            <p className="text-muted-foreground mt-1">Wähle einen Betrieb aus oder lege einen neuen an.</p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            Neuer Betrieb
          </Button>
        </div>

        {!datasets || datasets.length === 0 ? (
          <Card className="border-dashed bg-secondary/30">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <HomeIcon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Noch keine Betriebe</h3>
              <p className="text-muted-foreground mb-6 max-w-md">
                Lege deinen ersten Betrieb an, um Daten hochzuladen und mit der Analyse zu beginnen.
              </p>
              <Button onClick={openCreate} className="gap-2">
                <Plus className="w-4 h-4" />
                Ersten Betrieb anlegen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {datasets.map((ds) => (
              <Card key={ds.id} className="hover:border-primary/50 transition-colors group relative">
                <Link href={`/app/overview?datasetId=${ds.id}`}>
                  <div className="p-6 pr-14">
                    <CardHeader className="p-0 mb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <SectorIcon sector={ds.sector} className="w-5 h-5 text-primary/70" />
                        <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                          {sectorLabel(ds.sector)}
                        </span>
                      </div>
                      <CardTitle className="group-hover:text-primary transition-colors">{ds.name}</CardTitle>
                      <CardDescription>{ds.description || "Keine Beschreibung"}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground">Dateien</div>
                          <div className="font-semibold text-lg">{ds.fileCount}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Status</div>
                          <div className="font-medium text-primary mt-1">
                            {ds.status === "ready" ? "Bereit" : ds.status === "empty" ? "Leer" : ds.status}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </div>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-3 right-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteId(ds.id); }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Neuen Betrieb anlegen</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Sector picker */}
            <div className="space-y-2">
              <Label>Betriebstyp *</Label>
              <div className="grid grid-cols-3 gap-3">
                {SECTORS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setNewSector(s.id)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all focus:outline-none focus:ring-2 focus:ring-primary/50",
                      newSector === s.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 bg-transparent",
                    )}
                  >
                    <span className="text-2xl">{s.emoji}</span>
                    <span className="text-sm font-semibold leading-none">{s.label}</span>
                    <span className="text-[11px] text-muted-foreground leading-snug">{s.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ds-name">Name des Betriebs *</Label>
              <Input
                id="ds-name"
                placeholder="z.B. Musterhof GbR"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ds-desc">Beschreibung (optional)</Label>
              <Textarea
                id="ds-desc"
                placeholder="z.B. Milchviehbetrieb mit 120 Kühen, Bayern"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} disabled={createDataset.isPending}>
              Abbrechen
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createDataset.isPending} className="gap-2">
              {createDataset.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Anlegen & Dateien hochladen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Betrieb löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle Daten dieses Betriebs — Dateien, Analysen, Berichte und Warnungen — werden unwiderruflich gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDataset.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteDataset.isPending}
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              {deleteDataset.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Endgültig löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
