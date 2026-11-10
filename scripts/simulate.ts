/**
 * Builds the demo store and scores the markdown policies.
 *
 * 1. History: days 1-56 trading under the store's current habit (reduce 50% on the use-by day).
 *    Written to data/*.csv for PostgreSQL. The app treats day 57 as "today".
 * 2. Evaluation: from the same starting point, trade days 57-84 under each policy, on
 *    5 different shopper scenarios, with identical shoppers for every policy.
 *    Written to eval/results.json.
 *
 * Run: npm run simulate   (deterministic)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  type Product, type DayResult, type Policy, config, copilot, fixedRule, noMarkdown,
  newState, cloneState, runDay, metrics, orderQty, weekdayForecast, rng, orderingCheck,
} from "../src/model";

export const HISTORY_DAYS = 56;
export const TODAY = HISTORY_DAYS + 1;
const EVAL_DAYS = 28;
const SCENARIOS = ["s0", "s1", "s2", "s3", "s4"];

// ---------- catalogue ----------
const r = rng("catalogue");
const between = (lo: number, hi: number) => lo + r() * (hi - lo);
const cats: { category: string; life: [number, number]; cost: [number, number]; margin: number; items: string[] }[] = [
  { category: "Bakery", life: [2, 3], cost: [0.45, 1.6], margin: 1.55, items: ["White Bloomer", "Sourdough Loaf", "Croissants 4pk", "Pain au Chocolat 4pk", "Bagels 5pk", "Hot Cross Buns 6pk", "Iced Doughnuts", "Baguette", "Cookies 4pk", "Seeded Rolls 6pk"] },
  { category: "Dairy", life: [6, 10], cost: [0.55, 2.4], margin: 1.4, items: ["Fresh Cream 300ml", "Greek Yoghurt 500g", "Fresh Milk 2L", "Cottage Cheese", "Fresh Custard", "Halloumi", "Mozzarella Ball", "Kefir 1L"] },
  { category: "Fruit & Veg", life: [4, 6], cost: [0.4, 1.8], margin: 1.6, items: ["Strawberries 400g", "Raspberries 150g", "Salad Bag", "Avocados 2pk", "Baby Spinach", "Tenderstem Broccoli", "Blueberries 150g", "Mushrooms 250g", "Cherry Tomatoes", "Bananas"] },
  { category: "Meat & Fish", life: [4, 6], cost: [2.0, 5.5], margin: 1.45, items: ["Chicken Breast 600g", "Beef Mince 500g", "Salmon Fillets 2pk", "Pork Sausages 8pk", "Chicken Thighs 1kg", "Cod Fillets 2pk", "Diced Lamb 400g", "Smoked Bacon"] },
  { category: "Ready Meals", life: [3, 4], cost: [1.4, 3.2], margin: 1.6, items: ["Lasagne", "Chicken Tikka Masala", "Macaroni Cheese", "Cottage Pie", "Meal Deal Sandwich", "Sushi Box", "Pasta Salad", "Fresh Soup 600g"] },
];

export const products: Product[] = [];
let n = 1;
for (const c of cats) {
  for (const name of c.items) {
    const cost = +between(...c.cost).toFixed(2);
    // most lines are ordered sensibly; about 1 in 6 is ordered far too generously
    const generous = r() < 0.17;
    products.push({
      sku: `PB${String(n++).padStart(3, "0")}`, name, category: c.category,
      unit_cost: cost, unit_price: +(Math.round(cost * c.margin * 4) / 4 - 0.01).toFixed(2),
      shelf_life_days: Math.round(between(...c.life)),
      base_demand: +between(4, c.category === "Meat & Fish" ? 14 : 22).toFixed(1),
      order_buffer: +(generous ? between(1.65, 2.0) : between(1.15, 1.35)).toFixed(2),
    });
  }
}

// ---------- history ----------
config.scenario = "history";
const state = newState(products);
const history: DayResult[] = [];
for (let day = 1; day <= HISTORY_DAYS; day++) history.push(...runDay(products, state, day, fixedRule));

// today's morning delivery (so the app sees what is on the shelf this morning)
const todayState = cloneState(state);
for (const p of products) {
  const hist = todayState.history.get(p.sku)!;
  const batches = todayState.batches.get(p.sku)!;
  const q = orderQty(p, TODAY, batches, weekdayForecast(hist));
  if (q > 0) batches.push({ batch_id: `B${String(todayState.seq++).padStart(6, "0")}`, sku: p.sku, received_day: TODAY, expiry_day: TODAY + p.shelf_life_days - 1, qty: q, discount: 0 });
}

// ---------- evaluation ----------
// ordering fixes come from the last 4 weeks of history, exactly as the app suggests them today
const recent = history.filter((h) => h.day > HISTORY_DAYS - 28);
const checks = products.map((p) => orderingCheck(p.sku, recent.filter((h) => h.sku === p.sku)));
const fixes = new Map(checks.filter((c) => c.flag).map((c) => [c.sku, 1 + c.suggested_order_change_pct / 100]));

const runs: Record<string, { policy: Policy; fixOrders: boolean }> = {
  no_markdown: { policy: noMarkdown, fixOrders: false },
  fixed_rule: { policy: fixedRule, fixOrders: false },
  copilot: { policy: copilot, fixOrders: false },
  fixed_rule_plus_ordering: { policy: fixedRule, fixOrders: true },
  copilot_plus_ordering: { policy: copilot, fixOrders: true },
};
type M = ReturnType<typeof metrics>;
const results: Record<string, M[]> = Object.fromEntries(Object.keys(runs).map((k) => [k, []]));
for (const sc of SCENARIOS) {
  config.scenario = sc;
  for (const [name, { policy, fixOrders }] of Object.entries(runs)) {
    const s = cloneState(state);
    if (fixOrders) s.orderFactor = new Map(fixes);
    const rows: DayResult[] = [];
    for (let day = TODAY; day < TODAY + EVAL_DAYS; day++) rows.push(...runDay(products, s, day, policy));
    results[name].push(metrics(products, rows));
  }
}

const avg = (xs: M[]) => {
  const keys = Object.keys(xs[0]) as (keyof M)[];
  return Object.fromEntries(keys.map((k) => [k, Math.round((xs.reduce((a, x) => a + x[k], 0) / xs.length) * 100) / 100])) as M;
};
const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, avg(v)])) as Record<string, M>;
const f = summary.fixed_rule;
const vs = (key: string) => {
  const c = summary[key];
  return {
    waste_cost_cut_pct: +((100 * (f.waste_cost_gbp - c.waste_cost_gbp)) / f.waste_cost_gbp).toFixed(1),
    waste_units_cut_pct: +((100 * (f.waste_units - c.waste_units)) / f.waste_units).toFixed(1),
    extra_margin_gbp_per_4_weeks: +(c.gross_margin_gbp - f.gross_margin_gbp).toFixed(2),
    extra_margin_gbp_per_year: +(((c.gross_margin_gbp - f.gross_margin_gbp) * 365) / EVAL_DAYS).toFixed(0),
    markdown_given_cut_pct: +((100 * (f.markdown_given_gbp - c.markdown_given_gbp)) / f.markdown_given_gbp).toFixed(1),
    better_margin_in_scenarios: SCENARIOS.filter((_, i) => results[key][i].gross_margin_gbp > results.fixed_rule[i].gross_margin_gbp).length,
    less_waste_in_scenarios: SCENARIOS.filter((_, i) => results[key][i].waste_cost_gbp < results.fixed_rule[i].waste_cost_gbp).length,
  };
};
const comparison = { copilot: vs("copilot"), fixed_rule_plus_ordering: vs("fixed_rule_plus_ordering"), copilot_plus_ordering: vs("copilot_plus_ordering"), scenarios: SCENARIOS.length };
const orderingCheckSummary = {
  lines_flagged: checks.filter((c) => c.flag).length, of: products.length,
  flagged: checks.filter((c) => c.flag).map((c) => ({ sku: c.sku, change_pct: c.suggested_order_change_pct })),
};

// ---------- write ----------
mkdirSync("data", { recursive: true });
mkdirSync("eval", { recursive: true });
const csv = (rows: Record<string, unknown>[]) =>
  [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map((v) => (typeof v === "string" && v.includes(",") ? `"${v}"` : v)).join(","))].join("\n") + "\n";

writeFileSync("data/products.csv", csv(products.map(({ order_buffer, base_demand, ...p }) => p)));
writeFileSync("data/daily.csv", csv(history.map(({ lost_sales, ...h }) => ({ ...h, revenue: h.revenue.toFixed(2), markdown_given: h.markdown_given.toFixed(2) }))));
writeFileSync("data/batches.csv", csv([...todayState.batches.values()].flat().map(({ discount, ...b }) => b)));
writeFileSync("eval/results.json", JSON.stringify({
  today: TODAY, history_days: HISTORY_DAYS, eval_days: EVAL_DAYS, scenarios: SCENARIOS.length, products: products.length,
  policies: {
    no_markdown: "Never reduce",
    fixed_rule: "Reduce 50% on the use-by day (current store habit)",
    copilot: "Markdown Copilot planner (timing and depth of reductions)",
    fixed_rule_plus_ordering: "Current habit plus the ordering fixes only",
    copilot_plus_ordering: "Planner plus the ordering fixes it suggests from the last 4 weeks",
  },
  waste_weight: config.wasteWeight,
  average: summary, comparison, ordering_check: orderingCheckSummary,
}, null, 2) + "\n");

console.log(`products: ${products.length}, history rows: ${history.length}, batches on shelf today: ${[...todayState.batches.values()].flat().length}`);
console.table(summary);
console.log(JSON.stringify(comparison, null, 1));
console.log(`${orderingCheckSummary.lines_flagged} of ${products.length} lines flagged for smaller orders`);
