/**
 * E2E test: Frischmelker question → FreshCowWidget visible, no grounding fallback
 *
 * Tests the complete round-trip:
 *   UI input → POST /api/datasets/:id/analyses + POST /api/analyses/:id/questions
 *   → agent calls show_fresh_cow_calculator (grounded tool)
 *   → SSE stream delivers widget event
 *   → widget panel renders "🐄 Frischmelker-ROI-Rechner"
 *   → no grounding-fallback text appears in the assistant reply
 *
 * Also verifies via API that "Zeige Frischmelker-ROI-Rechner" was recorded in
 * agentSteps, proving the tool was actually invoked (not silently skipped).
 *
 * Prerequisites:
 *   - App running at PLAYWRIGHT_BASE_URL (default http://localhost:8080)
 *   - DEV mode with VITE_DEV_BYPASS_USER_ID (auto-login, no Clerk UI)
 *   - At least one dataset in the DB for the bypass user
 *     (PLAYWRIGHT_DATASET_ID env var, or auto-discovered via GET /api/datasets)
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

/**
 * Discover a dataset to use for the test.
 * Uses PLAYWRIGHT_DATASET_ID env var if set; otherwise calls GET /api/datasets
 * using page.request (shares browser auth cookies) and picks the first dataset.
 */
async function getDatasetId(
  pageRequest: import("@playwright/test").APIRequestContext,
): Promise<string> {
  if (process.env.PLAYWRIGHT_DATASET_ID) {
    return process.env.PLAYWRIGHT_DATASET_ID;
  }
  const resp = await pageRequest.get(`${BASE_URL}/api/datasets`);
  if (!resp.ok()) {
    throw new Error(`GET /api/datasets failed: ${resp.status()} ${await resp.text()}`);
  }
  const datasets = (await resp.json()) as Array<{ id: string }>;
  if (!datasets.length) {
    throw new Error(
      "No datasets found. Create a dataset first or set PLAYWRIGHT_DATASET_ID.",
    );
  }
  return datasets[0].id;
}

/**
 * A self-contained Frischmelker/Transitphase question that gives the agent
 * enough context to call show_fresh_cow_calculator without asking back-questions.
 */
const FRESH_COW_QUESTION =
  "Lohnt sich ein besseres Frischmelker-Programm für unsere Herde? " +
  "Wir haben rund 100 Abkalbungen pro Jahr, Metritis-Rate 25 %, Ketose-Rate 20 %, " +
  "Hypokalzämie-Rate 30 %. Zeig mir bitte den ROI-Rechner.";

/** Grounding fallback text injected when the agent answers without using any tool. */
const GROUNDING_FALLBACK_FRAGMENT =
  "Für diese Frage wurden allgemeine Richtwerte verwendet";

/** Progress label emitted by agent.ts progressLabel() for show_fresh_cow_calculator. */
const FRESH_COW_PROGRESS_LABEL = "Zeige Frischmelker-ROI-Rechner";

test.describe("Frischmelker question → FreshCowWidget", () => {
  test(
    "submitting a Frischmelker question renders the ROI calculator widget without grounding fallback",
    async ({ page }) => {
      // ── Navigate to the app so cookies / bypass-auth are established ──────
      // We use page.request for all API calls so they share the browser's
      // cookie jar (required for requireAuth middleware in dev bypass mode).
      await page.goto(`/app/analyses`);

      // Wait for the app to load (confirms auto-login worked)
      const questionInput = page.getByPlaceholder("Stelle eine Frage zu deinen Daten…");
      await expect(questionInput).toBeVisible({ timeout: 15_000 });

      // ── Discover or use the configured dataset ────────────────────────────
      const datasetId = await getDatasetId(page.request);

      // Navigate to the correct dataset
      await page.goto(`/app/analyses?datasetId=${datasetId}`);
      await expect(questionInput).toBeVisible({ timeout: 10_000 });

      // ── Intercept the analysis-creation response to capture the ID ────────
      // The UI POSTs to /api/datasets/:id/analyses when submitting a new
      // question.  We capture the response body so we have the exact analysis
      // ID — this avoids relying on list ordering, which is affected by pinned
      // analyses appearing first.
      let createdAnalysisId: string | null = null;
      page.on("response", async (response) => {
        if (
          response.request().method() === "POST" &&
          response.url().includes("/api/datasets/") &&
          response.url().includes("/analyses") &&
          response.ok()
        ) {
          try {
            const body = await response.json() as { id?: string };
            if (body.id) createdAnalysisId = body.id;
          } catch {
            // ignore parse errors
          }
        }
      });

      // ── Submit the Frischmelker question ──────────────────────────────────
      await questionInput.fill(FRESH_COW_QUESTION);
      await page.locator('[data-testid="question-submit"]').click();

      // ── Wait for the widget panel to appear (up to 120 s) ─────────────────
      // The floating widget panel header renders once the agent emits a
      // widgetSpec with type="fresh_cow" through the SSE stream.
      const widgetHeader = page.getByText("🐄 Frischmelker-ROI-Rechner");
      await expect(widgetHeader).toBeVisible({ timeout: 120_000 });

      // ── Assert: widget result (€/Jahr) is rendered ────────────────────────
      // The FreshCowWidget always computes a net annual benefit and renders it
      // with the "€/Jahr" suffix. This confirms the widget mounted correctly.
      const euroPerYear = page.getByText(/€\/Jahr/);
      await expect(euroPerYear.first()).toBeVisible({ timeout: 5_000 });

      // ── Assert: no grounding fallback text on the page ────────────────────
      const fallback = page.getByText(GROUNDING_FALLBACK_FRAGMENT, { exact: false });
      await expect(fallback).toHaveCount(0);

      // ── Assert via API: agentSteps includes the fresh-cow progress label ──
      // After the SSE stream closes, agentSteps[] is persisted on the analysis
      // record with every progressLabel() value that was emitted. Reading it
      // here proves show_fresh_cow_calculator was actually invoked — not silently
      // skipped — so a future grounding regression will surface as a test failure.
      //
      // We use page.request (not the standalone request fixture) so the call
      // shares the browser's cookie jar and passes requireAuth in dev bypass mode.
      expect(createdAnalysisId, "Analysis creation response was not intercepted").toBeTruthy();
      const detailResp = await page.request.get(
        `${BASE_URL}/api/analyses/${createdAnalysisId}`,
      );
      expect(
        detailResp.ok(),
        `GET /api/analyses/${createdAnalysisId} returned ${detailResp.status()}`,
      ).toBeTruthy();
      const analysis = (await detailResp.json()) as { agentSteps?: string[] | null };

      const steps: string[] = analysis.agentSteps ?? [];
      const hasCalcStep = steps.some((s) => s.includes(FRESH_COW_PROGRESS_LABEL));
      expect(
        hasCalcStep,
        `Expected agentSteps to contain "${FRESH_COW_PROGRESS_LABEL}" but got: ${JSON.stringify(steps)}`,
      ).toBeTruthy();
    },
  );
});
