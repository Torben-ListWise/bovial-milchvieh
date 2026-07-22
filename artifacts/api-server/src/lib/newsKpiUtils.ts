/**
 * Pure utilities for KPI tile validation in the newsletter batch pipeline.
 * Kept in a separate module so they can be unit-tested without importing
 * the heavy db/embeddings/storage chain.
 */

/**
 * Filter raw LLM kpiTiles output to only valid, in-range entries.
 *
 * Invariant enforced here:
 *   - If knowledgeContext is empty string, result is always [].
 *   - If knowledgeContext is non-empty, only tiles whose sourceIndex is within
 *     [0, maxSourceIndex] and have non-empty string value+label are kept (max 4).
 *
 * Callers should log a warning when knowledgeContext is non-empty and the
 * result is empty — that signals the LLM ignored or misused the knowledge
 * library (hallucinated out-of-range sourceIndex values, or returned no tiles).
 */
export function filterKpiTiles(
  rawKpiTiles: unknown[],
  knowledgeContext: string,
  maxSourceIndex: number,
): { value: string; label: string; sourceIndex: number }[] {
  if (!knowledgeContext) return [];
  return rawKpiTiles
    .filter(
      (t): t is { value: string; label: string; sourceIndex: number } =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as { value?: unknown }).value === "string" &&
        (t as { value: string }).value.trim() !== "" &&
        typeof (t as { label?: unknown }).label === "string" &&
        (t as { label: string }).label.trim() !== "" &&
        typeof (t as { sourceIndex?: unknown }).sourceIndex === "number" &&
        Number.isFinite((t as { sourceIndex: number }).sourceIndex) &&
        (t as { sourceIndex: number }).sourceIndex >= 0 &&
        (t as { sourceIndex: number }).sourceIndex <= maxSourceIndex,
    )
    .slice(0, 4);
}
