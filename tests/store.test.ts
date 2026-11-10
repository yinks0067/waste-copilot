/** Service layer, grounding check and simulation results. Needs DATABASE_URL with the demo data loaded. */
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { pool, overview, todaysReductions, orderingFixes, productHistory } from "../src/store";
import { ground, rulesBriefing } from "../src/briefing";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("store data", () => {
  afterAll(() => pool.end());

  it("overview adds up and is split by category", async () => {
    const o = await overview();
    const sum = o.by_category.reduce((a, c) => a + c.waste_cost_gbp, 0);
    expect(sum).toBeCloseTo(o.waste_cost_gbp, 1);
    expect(o.today).toBe(57);
  });

  it("reductions refer to real batches, at a valid discount, priced correctly", async () => {
    const { reductions } = await todaysReductions();
    expect(reductions.length).toBeGreaterThan(0);
    for (const r of reductions) {
      expect([25, 50, 75]).toContain(r.reduce_by_pct);
      expect(Math.abs(r.new_price_gbp - r.full_price_gbp * (1 - r.reduce_by_pct / 100))).toBeLessThanOrEqual(0.01); // rounded to the penny
      expect(r.days_left).toBeGreaterThanOrEqual(0);
    }
  });

  it("ordering check flags lines and sorts them by weekly cost", async () => {
    const f = await orderingFixes();
    expect(f.length).toBeGreaterThan(0);
    expect(f.map((x) => x.weekly_cost_gbp)).toEqual([...f.map((x) => x.weekly_cost_gbp)].sort((a, b) => b - a));
  });

  it("product history has 8 weeks and a 7-day waste profile", async () => {
    const h = await productHistory("PB001");
    expect(h?.weekly.length).toBe(8);
    expect(h?.waste_by_weekday_last_4wk.length).toBe(7);
    expect(await productHistory("NOPE")).toBeNull();
  });

  it("grounding check corrects wrong numbers, drops invented items and adds missing ones", async () => {
    const [{ reductions }, fixes] = await Promise.all([todaysReductions(), orderingFixes()]);
    const [r0] = reductions;
    const bad = {
      headline: "x", manager_summary: "y", watch_outs: [],
      reductions: [
        { sku: r0.sku, product: r0.product, batch_id: r0.batch_id, qty: r0.qty + 5, reduce_by_pct: 90, new_price_gbp: 0.01, why: "" },
        { sku: "PB999", product: "Made up", batch_id: "B999999", qty: 1, reduce_by_pct: 50, new_price_gbp: 1, why: "" },
      ],
      order_changes: [],
    };
    const g = ground(bad, reductions, fixes);
    expect(g.grounding.dropped).toBe(1);
    expect(g.briefing.reductions.find((r) => r.batch_id === r0.batch_id)?.reduce_by_pct).toBe(r0.reduce_by_pct);
    expect(g.briefing.reductions.length).toBe(reductions.length);
    expect(g.briefing.order_changes.length).toBe(fixes.length);
  });

  it("offline briefing passes its own grounding check untouched", async () => {
    const [{ briefing }, { reductions }, fixes] = await Promise.all([rulesBriefing(), todaysReductions(), orderingFixes()]);
    const g = ground(briefing, reductions, fixes);
    expect(g.grounding.corrected + g.grounding.dropped).toBe(0);
  });
});

describe("simulation results", () => {
  const r = JSON.parse(readFileSync("eval/results.json", "utf8"));
  it("copilot plus ordering beats the current habit on both waste and margin in every scenario", () => {
    const c = r.comparison.copilot_plus_ordering;
    expect(c.less_waste_in_scenarios).toBe(r.scenarios);
    expect(c.better_margin_in_scenarios).toBe(r.scenarios);
  });
  it("cutting orders does not noticeably empty the shelves", () => {
    const a = r.average;
    expect(a.copilot_plus_ordering.lost_sales_units).toBeLessThan(a.fixed_rule.lost_sales_units * 1.15);
  });
});
