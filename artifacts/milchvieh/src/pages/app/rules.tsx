import { useListRules, getListRulesQueryKey, useCreateRule } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Sliders, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

export function RulesPage() {
  const queryClient = useQueryClient();
  const { data: rules, isLoading } = useListRules({
    query: { queryKey: getListRulesQueryKey() }
  });

  const createRule = useCreateRule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
      }
    }
  });

  const handleCreate = () => {
    createRule.mutate({
      data: {
        name: "Zellzahl > 250k",
        description: "Warnung bei erhöhter Zellzahl",
        metric: "Zellzahl",
        comparator: "gt",
        threshold: 250,
        unit: "k",
        severity: "warning",
        enabled: true
      }
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Regeln & Schwellenwerte</h1>
          <p className="text-muted-foreground mt-1">Definieren Sie, ab wann das System eine Warnung ausgeben soll.</p>
        </div>
        <Button className="gap-2" onClick={handleCreate} disabled={createRule.isPending}>
          <Plus className="w-4 h-4" />
          Neue Regel
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !rules || rules.length === 0 ? (
        <Card className="border-dashed bg-secondary/10">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Sliders className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Noch keine Regeln definiert</h3>
            <p className="text-muted-foreground mb-6 max-w-md">
              Erstellen Sie eigene Regeln für Kennzahlen wie Milchleistung, Zellzahl oder Inhaltsstoffe, um automatisch gewarnt zu werden, wenn Schwellenwerte über- oder unterschritten werden.
            </p>
            <Button onClick={handleCreate}>Erste Regel erstellen</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rules.map((rule) => (
            <Card key={rule.id} className={!rule.enabled ? "opacity-60" : ""}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-full ${rule.severity === 'critical' ? 'bg-destructive/20 text-destructive' : rule.severity === 'warning' ? 'bg-orange-500/20 text-orange-600' : 'bg-blue-500/20 text-blue-600'}`}>
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                      {rule.name}
                      {!rule.enabled && <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">Deaktiviert</span>}
                    </h3>
                    <p className="text-sm text-muted-foreground">{rule.description}</p>
                    <div className="text-sm font-medium mt-1">
                      Wenn <span className="text-primary">{rule.metric}</span> {
                        rule.comparator === 'gt' ? '>' : 
                        rule.comparator === 'lt' ? '<' : 
                        rule.comparator === 'gte' ? '>=' : 
                        rule.comparator === 'lte' ? '<=' : 
                        rule.comparator === 'eq' ? '=' : '!='
                      } <span className="text-foreground">{rule.threshold}</span> {rule.unit}
                    </div>
                  </div>
                </div>
                <div>
                  <Button variant="outline" size="sm">Bearbeiten</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
