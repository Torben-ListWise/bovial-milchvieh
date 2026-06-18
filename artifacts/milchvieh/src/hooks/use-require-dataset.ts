import { useEffect } from "react";
import { useLocation } from "wouter";
import { useListDatasets, getListDatasetsQueryKey } from "@workspace/api-client-react";

/**
 * Returns the current datasetId from the URL query string.
 * If none is present but datasets exist, redirects to the same page
 * with the first dataset's id. If no datasets exist, redirects to /app/datasets.
 */
export function useRequireDataset(): { datasetId: string | null; isLoading: boolean } {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const datasetId = searchParams.get("datasetId");

  const { data: datasets, isLoading } = useListDatasets({
    query: { enabled: !datasetId, queryKey: getListDatasetsQueryKey() },
  });

  useEffect(() => {
    if (datasetId || isLoading) return;
    if (datasets && datasets.length > 0) {
      const path = location.split("?")[0];
      setLocation(`${path}?datasetId=${datasets[0].id}`);
    } else if (datasets && datasets.length === 0) {
      setLocation("/app/datasets");
    }
  }, [datasetId, datasets, isLoading, location, setLocation]);

  return { datasetId, isLoading: !datasetId && isLoading };
}
