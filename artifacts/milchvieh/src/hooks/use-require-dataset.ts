import { useEffect } from "react";
import { useLocation } from "wouter";
import { useListDatasets, getListDatasetsQueryKey } from "@workspace/api-client-react";

/**
 * Returns the current datasetId from the URL query string.
 * If none is present but datasets exist, redirects to the same page
 * with the first dataset's id. If no datasets exist, redirects to /app/datasets.
 *
 * Uses wouter's location as the single source of truth so reading and
 * writing the URL are always in sync (window.location.search can lag
 * behind wouter's pushState on the same render cycle).
 */
export function useRequireDataset(): { datasetId: string | null; isLoading: boolean } {
  const [location, setLocation] = useLocation();

  // Parse datasetId from wouter's location (includes query string)
  const search = location.includes("?") ? location.slice(location.indexOf("?")) : "";
  const datasetId = new URLSearchParams(search).get("datasetId") || null;

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
