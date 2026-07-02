/**
 * E2E test: Investment question → "Investition" badge + 3 KPI tiles
 *
 * Tests the complete round-trip:
 *   UI input → POST /api/analyses + POST /api/analyses/:id/questions
 *   → agent calls calculate_investment + emit_chart(type="kpi")
 *   → SSE stream delivers chart event
 *   → ResultCard.inferAnswerType detects kpi → badge "Investition"
 *   → DynamicChart type="kpi" renders 3 KpiTile components
 *
 * The test creates a fresh analysis each run and does not rely on pre-seeded
 * assistant messages, so regressions in the agent prompt or emit_chart
 * handling will surface as test failures.
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
 * and picks the first available dataset owned by the bypass user.
 */
async function getDatasetId(request: import("@playwright/test").APIRequestContext): Promise<string> {
  if (process.env.PLAYWRIGHT_DATASET_ID) {
    return process.env.PLAYWRIGHT_DATASET_ID;
  }
  const resp = await request.get(`${BASE_URL}/api/datasets`);
  if (!resp.ok()) {
    throw new Error(`GET /api/datasets failed: ${resp.status()} ${await resp.text()}`);
  }
  const datasets = await resp.json() as Array<{ id: string }>;
  if (!datasets.length) {
    throw new Error(
      "No datasets found. Create a dataset first or set PLAYWRIGHT_DATASET_ID.",
    );
  }
  return datasets[0].id;
}

/**
 * A parameter-rich investment question that gives the agent enough data to call
 * calculate_investment and emit 3 KPI tiles without asking back-questions.
 */
const INVESTMENT_QUESTION =
  "Lohnt sich ein neuer Melkroboter für 120.000 €? " +
  "Wir halten 80 Kühe, erwarten 5 % mehr Milchleistung und sparen täglich 2 Arbeitsstunden.";

test.describe("Investment question → KPI tiles", () => {
  let datasetId: string;

  test.beforeAll(async ({ request }) => {
    datasetId = await getDatasetId(request);
  });

  test(
    "submitting an investment question renders the Investition badge and 3 KPI tiles",
    async ({ page }) => {
      // ── Navigate to the analyses page ─────────────────────────────────────
      await page.goto(`/app/analyses?datasetId=${datasetId}`);

      // Wait for the question input to appear (confirms auto-login worked)
      const questionInput = page.getByPlaceholder("Stelle eine Frage zu deinen Daten…");
      await expect(questionInput).toBeVisible({ timeout: 15_000 });

      // ── Submit the investment question ────────────────────────────────────
      await questionInput.fill(INVESTMENT_QUESTION);
      await page.locator('[data-testid="question-submit"]').click();

      // ── Wait for the agent to finish (up to 120 s) ────────────────────────
      // The result card's answer-badge appears only after the full response
      // including charts has been delivered through the SSE stream.
      const badge = page.locator('[data-testid="answer-badge"]').filter({ hasText: "Investition" });
      await expect(badge).toBeVisible({ timeout: 120_000 });

      // ── Assert: badge shows "Investition" ────────────────────────────────
      await expect(badge.first()).toHaveText("Investition");

      // ── Assert: KPI grid with 3 tiles ────────────────────────────────────
      const grid = page.locator('[data-testid="kpi-grid"]').first();
      await expect(grid).toBeVisible();

      const tiles = grid.locator('[data-testid="kpi-tile"]');
      await expect(tiles).toHaveCount(3);

      // ── Assert: each tile value is non-empty ─────────────────────────────
      const values = grid.locator('[data-testid="kpi-value"]');
      await expect(values).toHaveCount(3);

      for (let i = 0; i < 3; i++) {
        const text = (await values.nth(i).textContent())?.trim() ?? "";
        expect(text, `KPI tile ${i} should have a non-empty value`).toBeTruthy();
        expect(text, `KPI tile ${i} value should not be the placeholder "—"`).not.toBe("—");
      }
    },
  );
});
