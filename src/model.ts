/**
 * Store model for short-life (perishable) stock.
 *
 * Stock arrives in batches with a use-by day. Each day:
 *   1. morning delivery arrives (same ordering rule for every policy)
 *   2. the markdown policy sets a discount on some batches
 *   3. shoppers buy: reduced items first (deepest discount first), then full price oldest-first;
 *      a discount also pulls in some extra shoppers who only buy reduced items
 *   4. anything at its use-by day that is still unsold is thrown away
 *
 * All randomness is keyed by (sku, day), so every policy faces exactly the same shoppers
 * ("common random numbers"). That makes policy comparisons fair.
 */

export type Product = {
  sku: string; name: string; category: string;
  unit_cost: number; unit_price: number; shelf_life_days: number;
  base_demand: number;   // average units/day on a normal weekday
  order_buffer: number;  // how generously the store orders (1.2 = 20% over forecast). Hidden from the tools.
};

export type Batch = { batch_id: string; sku: string; received_day: number; expiry_day: number; qty: number; discount: number };

export type DayResult = {
  sku: string; day: number; delivered: number; sold_full: number; sold_reduced: number;
  revenue: number; markdown_given: number; wasted: number;
  lost_sales: number; // regular shoppers who found nothing on the shelf
};

/** Markdown steps used in UK "reduced to clear" practice. */
export const DISCOUNTS = [0, 0.25, 0.5, 0.75] as const;

/**
 * Extra demand from a discount, as a share of normal daily demand per unit of discount.
 * 1.6 means a 50% reduction brings in 80% more shoppers for the reduced items.
 * This is a modelling assumption, documented in the README.
 */
export const UPLIFT = 1.6;

/** Share of regular shoppers who pick a reduced item over full price when both are on the shelf. Assumption. */
export const SWITCH = 0.35;

/** Share of full-price shoppers who pick the freshest date rather than the front of the shelf. Assumption. */
export const FRESH_PICK = 0.6;

/** Demand by day of week, day 1 = Monday. */
export const WEEKDAY = [0.85, 0.85, 0.9, 1.0, 1.25, 1.35, 0.8]; // Mon..Sun
export const weekday = (day: number) => (day - 1) % 7;
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------- deterministic random ----------
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(key: string) {
  let a = hash(key);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function poisson(lambda: number, r: () => number) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}

export const meanDemand = (p: Product, day: number) => p.base_demand * WEEKDAY[weekday(day)];

/** Demand for one product on one day (identical for every policy). */
/** Change `scenario` to replay the same store with different shoppers (used to check results hold up). */
export const config = {
  scenario: "s0",
  /**
   * How much a binned item counts against the plan beyond lost sales, as a multiple of its cost price.
   * 0 = money only. Higher values trade a little margin for less waste (waste targets, disposal cost).
   */
  wasteWeight: Number(process.env.WASTE_WEIGHT ?? 1),
};

export function shoppers(p: Product, day: number) {
  const r = rng(`${config.scenario}:${p.sku}:${day}`);
  const noise = 0.8 + 0.4 * r();                       // day-level variation (weather, events)
  const lambda = meanDemand(p, day) * noise;
  return { base: poisson(lambda, r), extraPerDiscount: (d: number) => poisson(lambda * UPLIFT * d, rng(`${config.scenario}:${p.sku}:${day}:x`)) };
}

// ---------- the core of one trading day ----------
/**
 * Sell through the batches for one day, given demand. Mutates batch quantities.
 * Used by the simulation (random demand) and by the planner (expected demand).
 */
export function sellDay(p: Product, batches: Batch[], baseDemand: number, extraDemand: number) {
  let sold_full = 0, sold_reduced = 0, revenue = 0, markdown_given = 0;
  const reduced = batches.filter((b) => b.discount > 0 && b.qty > 0).sort((a, b) => b.discount - a.discount || a.expiry_day - b.expiry_day);
  const full = batches.filter((b) => b.discount === 0 && b.qty > 0).sort((a, b) => a.expiry_day - b.expiry_day);

  const buy = (list: Batch[], want: number) => {
    for (const b of list) {
      const take = Math.min(want, b.qty);
      if (take <= 0) continue;
      b.qty -= take; want -= take;
      revenue += take * p.unit_price * (1 - b.discount);
      if (b.discount > 0) { sold_reduced += take; markdown_given += take * p.unit_price * b.discount; } else sold_full += take;
    }
    return want;
  };

  // Some regular shoppers spot the reduced items and switch to them; the rest buy full price
  // and only fall back to reduced items if full price has run out. Extra shoppers only buy reduced.
  const switchers = reduced.length ? (Number.isInteger(baseDemand) ? Math.round(baseDemand * SWITCH) : baseDemand * SWITCH) : 0;
  const loyal = baseDemand - switchers;
  buy(reduced, extraDemand);
  const leftSwitch = buy(reduced, switchers);
  // Full-price shoppers mostly reach for the freshest date at the back of the shelf
  const freshFirst = [...full].sort((a, b) => b.expiry_day - a.expiry_day);
  const fullWant = loyal + leftSwitch;
  const freshPickers = Number.isInteger(fullWant) ? Math.round(fullWant * FRESH_PICK) : fullWant * FRESH_PICK;
  const leftFresh = buy(freshFirst, freshPickers);
  const leftLoyal = buy(full, fullWant - freshPickers + leftFresh);
  const unmet = buy(reduced, leftLoyal);
  return { sold_full, sold_reduced, revenue, markdown_given, unmet };
}

/** Same ordering rule for every policy: cover tomorrow's forecast plus a buffer, minus usable stock. */
export function orderQty(p: Product, day: number, batches: Batch[], forecast: (day: number) => number, factor = 1) {
  const usable = batches.filter((b) => b.expiry_day > day).reduce((a, b) => a + b.qty, 0);
  const cover = forecast(day) * p.order_buffer * factor + 1;
  return Math.max(0, Math.round(cover - usable));
}

// ---------- forecasting ----------
/** Same-weekday average of the last 4 weeks of sales, falling back to the overall average. */
export function weekdayForecast(history: { day: number; sold: number }[]) {
  return (day: number) => {
    const same = history.filter((h) => weekday(h.day) === weekday(day) && h.day < day && h.day >= day - 28);
    const pool = same.length ? same : history.filter((h) => h.day < day);
    return pool.length ? pool.reduce((a, h) => a + h.sold, 0) / pool.length : 0;
  };
}

// ---------- ordering check ----------
export type OrderingCheck = {
  sku: string; delivered: number; sold: number; wasted: number; reduced: number;
  waste_rate: number; reduced_rate: number; suggested_order_change_pct: number; flag: boolean;
};

/** Healthy waste rate for short-life lines; above this the order is too big. */
export const TARGET_WASTE_RATE = 0.04;

/**
 * Looks at recent days for one product and says whether the store is ordering too much.
 * Flags lines whose waste rate is well above target and suggests a smaller order.
 */
export function orderingCheck(sku: string, rows: { delivered: number; sold_full: number; sold_reduced: number; wasted: number }[]): OrderingCheck {
  const sum = (k: "delivered" | "sold_full" | "sold_reduced" | "wasted") => rows.reduce((a, r) => a + Number(r[k]), 0);
  const delivered = sum("delivered"), wasted = sum("wasted"), reduced = sum("sold_reduced"), sold = sum("sold_full") + reduced;
  const waste_rate = delivered ? wasted / delivered : 0;
  // stock that had to be binned or cleared at a discount was, mostly, not needed at full price
  const excess = delivered ? (wasted + 0.5 * reduced) / delivered : 0;
  const flag = excess > 0.12;
  const cut = flag ? Math.min(0.35, Math.max(0.05, excess - TARGET_WASTE_RATE)) : 0;
  return {
    sku, delivered, sold, wasted, reduced, waste_rate: +waste_rate.toFixed(3), reduced_rate: delivered ? +(reduced / delivered).toFixed(3) : 0,
    suggested_order_change_pct: -Math.round(cut * 100), flag,
  };
}

// ---------- policies ----------
export type Policy = (p: Product, day: number, batches: Batch[], forecast: (d: number) => number) => void;

/** Never reduce anything. */
export const noMarkdown: Policy = (_p, _day, batches) => { for (const b of batches) b.discount = 0; };

/** Common store practice: reduce everything on its use-by day by 50%. */
export const fixedRule: Policy = (_p, day, batches) => {
  for (const b of batches) b.discount = b.expiry_day === day ? 0.5 : 0;
};

/**
 * Markdown Copilot planner.
 * For each batch close to its use-by day, try each discount step and project the next few
 * days with the forecast. Pick the discount that earns the most money across ALL batches of
 * the product, so it accounts for reduced items stealing sales from full-price stock.
 */
export const copilot: Policy = (p, day, batches, forecast) => {
  const lead = p.shelf_life_days <= 3 ? 1 : 2;
  const candidates = batches.filter((b) => b.qty > 0 && b.expiry_day - day <= lead).sort((a, b) => a.expiry_day - b.expiry_day);
  for (const b of batches) if (!candidates.includes(b)) b.discount = 0;
  for (const b of candidates) {
    let best = { d: 0, value: -Infinity };
    for (const d of DISCOUNTS) {
      b.discount = d;
      const value = projectValue(p, day, batches, forecast, b.expiry_day);
      if (value > best.value + 0.005) best = { d, value };
    }
    b.discount = best.d;
  }
};

/**
 * Expected money from this product's stock from `day` to `until`, with the current discounts held,
 * averaged over sampled demand scenarios (a single average day hides the slow days that cause waste).
 * Binned items count against the plan by `config.wasteWeight` x cost price. Fresher stock left at the
 * end is valued at 75% of its price, since some of it will need reducing too.
 */
export const PLAN_SAMPLES = 24;
export function projectValue(p: Product, day: number, batches: Batch[], forecast: (d: number) => number, until: number) {
  let total = 0;
  for (let k = 0; k < PLAN_SAMPLES; k++) {
    const r = rng(`plan:${p.sku}:${day}:${k}`); // planner's own scenarios, independent of the real shoppers
    const sim = batches.map((b) => ({ ...b }));
    let value = 0;
    for (let t = day; t <= until; t++) {
      const lambda = forecast(t) * (0.8 + 0.4 * r());
      const maxD = Math.max(0, ...sim.filter((b) => b.qty > 0 && b.discount > 0 && b.expiry_day >= t).map((b) => b.discount));
      const live = sim.filter((b) => b.expiry_day >= t);
      value += sellDay(p, live, poisson(lambda, r), maxD > 0 ? poisson(lambda * UPLIFT * maxD, r) : 0).revenue;
      for (const b of sim) if (b.expiry_day === t) { value -= b.qty * p.unit_cost * config.wasteWeight; b.qty = 0; }
    }
    const leftover = sim.filter((b) => b.expiry_day > until).reduce((a, b) => a + b.qty, 0);
    total += value + leftover * p.unit_price * 0.75;
  }
  return total / PLAN_SAMPLES;
}

// ---------- full simulation ----------
export type SimState = { batches: Map<string, Batch[]>; history: Map<string, { day: number; sold: number }[]>; seq: number; orderFactor: Map<string, number> };

export function newState(products: Product[]): SimState {
  return { batches: new Map(products.map((p) => [p.sku, []])), history: new Map(products.map((p) => [p.sku, []])), seq: 1, orderFactor: new Map() };
}

export function cloneState(s: SimState): SimState {
  return {
    batches: new Map([...s.batches].map(([k, v]) => [k, v.map((b) => ({ ...b }))])),
    history: new Map([...s.history].map(([k, v]) => [k, v.map((h) => ({ ...h }))])),
    seq: s.seq,
    orderFactor: new Map(s.orderFactor),
  };
}

/** Run one trading day for every product. Returns per-product results. */
export function runDay(products: Product[], state: SimState, day: number, policy: Policy): DayResult[] {
  const out: DayResult[] = [];
  for (const p of products) {
    const hist = state.history.get(p.sku)!;
    const forecast = hist.length >= 7 ? weekdayForecast(hist) : (d: number) => meanDemand(p, d);
    let batches = state.batches.get(p.sku)!;

    const delivered = orderQty(p, day, batches, forecast, state.orderFactor.get(p.sku) ?? 1);
    if (delivered > 0) {
      batches.push({ batch_id: `B${String(state.seq++).padStart(6, "0")}`, sku: p.sku, received_day: day, expiry_day: day + p.shelf_life_days - 1, qty: delivered, discount: 0 });
    }

    policy(p, day, batches, forecast);

    const s = shoppers(p, day);
    const maxD = Math.max(0, ...batches.filter((b) => b.qty > 0 && b.discount > 0).map((b) => b.discount));
    const { unmet, ...sold } = sellDay(p, batches, s.base, maxD > 0 ? s.extraPerDiscount(maxD) : 0);

    const wasted = batches.filter((b) => b.expiry_day <= day).reduce((a, b) => a + b.qty, 0);
    batches = batches.filter((b) => b.expiry_day > day && b.qty > 0);
    state.batches.set(p.sku, batches);
    hist.push({ day, sold: sold.sold_full + sold.sold_reduced });

    out.push({ sku: p.sku, day, delivered, wasted, ...sold, lost_sales: unmet });
  }
  return out;
}

export type Metrics = {
  revenue_gbp: number; cost_of_stock_gbp: number; gross_margin_gbp: number; margin_pct: number;
  waste_units: number; waste_cost_gbp: number; units_sold: number; full_price_units: number; reduced_units: number;
  markdown_given_gbp: number; lost_sales_units: number;
};

export function metrics(products: Product[], rows: DayResult[]): Metrics {
  const by = new Map(products.map((p) => [p.sku, p]));
  let revenue = 0, cost = 0, waste = 0, wasteCost = 0, sold = 0, reduced = 0, md = 0, lost = 0;
  for (const r of rows) {
    const p = by.get(r.sku)!;
    revenue += r.revenue; cost += r.delivered * p.unit_cost; waste += r.wasted; wasteCost += r.wasted * p.unit_cost;
    sold += r.sold_full + r.sold_reduced; reduced += r.sold_reduced; md += r.markdown_given; lost += r.lost_sales;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    revenue_gbp: r2(revenue), cost_of_stock_gbp: r2(cost), gross_margin_gbp: r2(revenue - cost),
    margin_pct: r2((100 * (revenue - cost)) / revenue), waste_units: waste, waste_cost_gbp: r2(wasteCost),
    units_sold: sold, full_price_units: sold - reduced, reduced_units: reduced, markdown_given_gbp: r2(md), lost_sales_units: lost,
  };
}
