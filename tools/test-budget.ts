import type { Reporter, TestSpecification } from "vitest/node";

/**
 * The test time budget (CLAUDE.md, "Test time budget"): after a run, a loud line when the run took longer than its
 * budget, wall time: the quick suite (`npm test`) 30 s; with the scenarios 300 s, or 90 s for one CI shard. Over it, find the file
 * that grew (`--reporter=verbose` lists each file's time) and make it faster or move it to SCENARIOS in vite.config.ts.
 */
export const BUDGET_S = { quick: 30, scenarios: process.env.CI ? 90 : 300 } as const;

export default class BudgetReporter implements Reporter {
  private t0 = 0;
  private budget = 0;

  onTestRunStart(specs: ReadonlyArray<TestSpecification>) {
    this.t0 = performance.now();
    const names = new Set(specs.map((s) => s.project.name));
    // (balance and soak are long by design: no budget)
    this.budget = names.has("balance") || names.has("soak") ? 0 : names.has("scenarios") ? BUDGET_S.scenarios : BUDGET_S.quick;
  }

  onTestRunEnd() {
    const s = (performance.now() - this.t0) / 1000;
    if (this.budget && s > this.budget) {
      console.warn(`\n!! TEST TIME BUDGET EXCEEDED: ${s.toFixed(1)} s, budget ${this.budget} s. Speed the file that grew up or move it to SCENARIOS (vite.config.ts).\n`);
    }
  }
}
