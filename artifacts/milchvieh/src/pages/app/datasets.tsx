import { useListDatasets, useCreateDataset } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Home as HomeIcon, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";

export function DatasetList() {
  const { data: datasets, isLoading } = useListDatasets();
  const createDataset = useCreateDataset();
  const [, setLocation] = useLocation();

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

  const handleCreate = () => {
    if (createDataset.isPending) return;
    createDataset.mutate(
      {
        data: {
          name: `Neuer Betrieb ${datasets?.length ? datasets.length + 1 : 1}`,
          description: ""
        }
      },
      {
        onSuccess: (newDataset) => {
          setLocation(`/app/overview?datasetId=${newDataset.id}`);
        }
      }
    );
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Ihre Betriebe</h1>
          <p className="text-muted-foreground mt-1">Wählen Sie einen Betrieb aus oder legen Sie einen neuen an.</p>
        </div>
        <Button onClick={handleCreate} disabled={createDataset.isPending} className="gap-2">
          {createDataset.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
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
              Legen Sie Ihren ersten Betrieb an, um Daten hochzuladen und mit der Analyse zu beginnen.
            </p>
            <Button onClick={handleCreate} disabled={createDataset.isPending} className="gap-2">
              {createDataset.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Ersten Betrieb anlegen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {datasets.map((ds) => (
            <Card key={ds.id} className="hover:border-primary/50 transition-colors cursor-pointer group">
              <Link href={`/app/overview?datasetId=${ds.id}`}>
                <div className="p-6">
                  <CardHeader className="p-0 mb-4">
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
                        <div className="font-medium text-primary mt-1">{ds.status === 'ready' ? 'Bereit' : ds.status}</div>
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
