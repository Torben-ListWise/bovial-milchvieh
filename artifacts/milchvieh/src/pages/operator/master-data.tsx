import { useListMasterData } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MasterDataPage() {
  const { data: masterData, isLoading } = useListMasterData();

  if (isLoading) return <div className="p-8">Laden...</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Stammdaten</h1>
          <p className="text-muted-foreground mt-1">Verwaltung der zentralen Referenzdaten (Rassen, Schlüssel, Einheiten).</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Neuer Eintrag
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="text-center py-12 text-muted-foreground flex flex-col items-center">
            <Database className="w-12 h-12 mb-4 text-muted" />
            <p>Stammdaten-Verwaltung befindet sich im Aufbau.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
