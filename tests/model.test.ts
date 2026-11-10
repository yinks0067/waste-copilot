/** Simulation and planner logic. No database needed. */
import { describe, expect, it } from "vitest";
import { type Batch, type Product, sellDay, fixedRule, copilot, orderingCheck, orderQty, poisson, rng, weekdayForecast } from "../src/model";

const bread: Product = { sku: "T1", name: "Test Loaf", category: "Bakery", unit_cost: 1, unit_price: 2, shelf_life_days: 3, base_demand: 10, order_buffer: 1.2 };
const batch = (id: string, expiry: number, qty: number, discount = 0): Batch => ({ batch_id: id, sku: "T1", received_day: expiry - 2, expiry_day: expiry, qty, discount });

describe("selling a day", () => {
  it("never sells more than is on the shelf and conserves units", () => {
    const bs = [batch("a", 5, 4), batch("b", 6, 3)];
    const r = sellDay(bread, bs, 20, 0);
    expect(r.sold_full + r.sold_reduced).toBe(7);
    expect(r.unmet).toBe(13);
    expect(bs.every((b) => b.qty === 0)).toBe(true);
  });

  it("charges the reduced price and records the markdown given away", () => {
    const r = sellDay(bread, [batch("a", 5, 10, 0.5)], 4, 0);
    expect(r.sold_reduced).toBe(4);
    expect(r.revenue).toBeCloseTo(4);
    expect(r.markdown_given).toBeCloseTo(4);
  });

  it("extra shoppers attracted by a discount only buy reduced stock", () => {
    const r = sellDay(bread, [batch("a", 6, 10)], 0, 5);
    expect(r.sold_full + r.sold_reduced).toBe(0);
  });

  it("most full-price shoppers take the freshest date", () => {
    const old = batch("old", 5, 10), fresh = batch("fresh", 7, 10);
    sellDay(bread, [old, fresh], 10, 0);
    expect(fresh.qty).toBeLessThan(old.qty);
  });
});

describe("policies", () => {
  it("fixed rule reduces only the batch at its use-by day, by 50%", () => {
    const bs = [batch("a", 5, 4), batch("b", 6, 4)];
    fixedRule(bread, 5, bs, () => 10);
    expect(bs.map((b) => b.discount)).toEqual([0.5, 0]);
  });

  it("copilot leaves stock alone when demand will clear it", () => {
    const bs = [batch("a", 5, 2)];
    copilot(bread, 5, bs, () => 30);
    expect(bs[0].discount).toBe(0);
  });

  it("copilot reduces a large batch that won't sell in time", () => {
    const bs = [batch("a", 5, 40), batch("b", 7, 20)];
    copilot(bread, 5, bs, () => 6);
    expect(bs[0].discount).toBeGreaterThan(0);
  });
});

describe("ordering", () => {
  it("flags a line where a big share is binned or reduced and suggests a smaller order", () => {
    const rows = Array.from({ length: 28 }, () => ({ delivered: 20, sold_full: 10, sold_reduced: 5, wasted: 5 }));
    const c = orderingCheck("T1", rows);
    expect(c.flag).toBe(true);
    expect(c.suggested_order_change_pct).toBeLessThan(0);
    expect(c.suggested_order_change_pct).toBeGreaterThanOrEqual(-35);
  });

  it("leaves a healthy line alone", () => {
    const rows = Array.from({ length: 28 }, () => ({ delivered: 20, sold_full: 19, sold_reduced: 1, wasted: 0 }));
    expect(orderingCheck("T1", rows).flag).toBe(false);
  });

  it("orders less when the order factor is lowered", () => {
    expect(orderQty(bread, 10, [], () => 10, 0.7)).toBeLessThan(orderQty(bread, 10, [], () => 10, 1));
  });
});

describe("helpers", () => {
  it("random numbers are repeatable for the same key", () => {
    expect(poisson(5, rng("k"))).toBe(poisson(5, rng("k")));
  });
  it("weekday forecast averages the same weekday", () => {
    const hist = [{ day: 1, sold: 10 }, { day: 8, sold: 20 }, { day: 2, sold: 99 }];
    expect(weekdayForecast(hist)(15)).toBe(15);
  });
});
