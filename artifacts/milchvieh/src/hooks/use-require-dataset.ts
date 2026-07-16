import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useListDatasets, getListDatasetsQueryKey } from "@workspace/api-client-react";

const LAST_DATASET_KEY = "milchvieh_last_dataset_id";

function readLastDatasetId(): string | null {
  try { return localStorage.getItem(LAST_DATASET_KEY) || null; } catch { return null; }
}

function saveLastDatasetId(id: string) {
  try { localStorage.setItem(LAST_DATASET_KEY, id); } catch { /* ignore */ }
}

/**
 * Returns the current datasetId from the URL query string.
 * If none is present but datasets exist, redirects to the same page
 * with the first dataset's id. If no datasets exist, redirects to /app/datasets.
 *
 * Last-used datasetId is persisted in localStorage so reloads / navigation
 * without a ?datasetId= param restore the previous context instead of always
 * picking datasets[0].
 *
 * useSearch() is reactive to query-string changes (unlike useLocation which
 * only tracks the pathname). window.location.search can lag behind on the
 * same render cycle after setLocation().
 */
export function useRequireDataset(): { datasetId: string | null; isLoading: boolean } {
  const [location, setLocation] = useLocation();
  const search = useSearch(); // reactive to ?foo=bar changes
  const datasetId = new URLSearchParams(search).get("datasetId") || null;

  // Persist the active datasetId so future navigation without the param
  // can restore the last known context.
  useEffect(() => {
    if (datasetId) saveLastDatasetId(datasetId);
  }, [datasetId]);

  const { data: datasets, isLoading } = useListDatasets({
    query: { enabled: !datasetId, queryKey: getListDatasetsQueryKey() },
  });

  useEffect(() => {
    if (datasetId || isLoading) return;
    if (datasets && datasets.length > 0) {
      const path = location.split("?")[0];
      // Prefer the last-used dataset if it still exists in the list.
      const lastId = readLastDatasetId();
      const lastExists = lastId && datasets.some((d) => d.id === lastId);
      const targetId = lastExists ? lastId : datasets[0].id;
      setLocation(`${path}?datasetId=${targetId}`);
    } else if (datasets && datasets.length === 0) {
      setLocation("/app/datasets");
    }
  }, [datasetId, datasets, isLoading, location, setLocation]);

  return { datasetId, isLoading: !datasetId && isLoading };
}
