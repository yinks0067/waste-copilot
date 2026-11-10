/**
 * Store service: reads the database and runs the deterministic engines (planner + ordering check).
 * The numbers all come from here. Claude never does arithmetic; it reads these results through tools.
 */
import pg from "pg";
import { type Batch, type Product, copilot, orderingCheck, weekdayForecast, weekday, DAY_NAMES } from "./model";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

const gbp = (n: number) => Math.round(n * 100) / 100;

export type StoreProduct = Omit<Product, "base_demand" | "order_buffer">;
type DailyRow = { sku: string; day: number; delivered: number; wasted: number; sold_full: number; sold_reduced: number; revenue: number; markdown_given: number };

export async function getProducts(): Promise<StoreProduct[]> {
  const rows = await q<StoreProduct>("SELECT * FROM products ORDER BY sku");
  return rows.map((r) => ({ ...r, unit_cost: Number(r.unit_cost), unit_price: Number(r.unit_price) }));
}

export async function today(): Promise<number> {
  const [r] = await q<{ d: number }>("SELECT COALESCE(MAX(day), 0) + 1 AS d FROM daily");
  return Number(r.d);
}

async function daily(fromDay = 0): Promise<DailyRow[]> {
  const rows = await q<DailyRow>("SELECT * FROM daily WHERE day >= $1 ORDER BY sku, day", [fromDay]);
  return rows.map((r) => ({ ...r, revenue: Number(r.revenue), markdown_given: Number(r.markdown_given) }));
}

export const dayLabel = (day: number) => DAY_NAMES[weekday(day)];

// ---------- today's reductions (Markdown planner) ----------
export type Reduction = {
  sku: string; product: string; category: string; batch_id: string; qty: number;
  use_by: string; days_left: number; reduce_by_pct: number; full_price_gbp: number; new_price_gbp: number;
  stock_cost_at_risk_gbp: number;
};

export async function todaysReductions(): Promise<{ day: number; weekday: string; reductions: Reduction[] }> {
  const [products, t, rows, batchRows] = await Promise.all([
    getProducts(), today(), daily(),
    q<{ batch_id: string; sku: string; received_day: number; expiry_day: number; qty: number }>("SELECT * FROM batches"),
  ]);
  const reductions: Reduction[] = [];
  for (const p of products) {
    const hist = rows.filter((r) => r.sku === p.sku).map((r) => ({ day: r.day, sold: r.sold_full + r.sold_reduced }));
    const batches: Batch[] = batchRows.filter((b) => b.sku === p.sku).map((b) => ({ ...b, discount: 0 }));
    copilot({ ...p, base_demand: 0, order_buffer: 1 }, t, batches, weekdayForecast(hist));
    for (const b of batches.filter((b) => b.discount > 0)) {
      const days_left = b.expiry_day - t;
      reductions.push({
        sku: p.sku, product: p.name, category: p.category, batch_id: b.batch_id, qty: b.qty,
        use_by: days_left === 0 ? "today" : days_left === 1 ? "tomorrow" : dayLabel(b.expiry_day), days_left,
        reduce_by_pct: Math.round(b.discount * 100), full_price_gbp: p.unit_price,
        new_price_gbp: gbp(p.unit_price * (1 - b.discount)), stock_cost_at_risk_gbp: gbp(b.qty * p.unit_cost),
      });
    }
  }
  reductions.sort((a, b) => a.days_left - b.days_left || b.stock_cost_at_risk_gbp - a.stock_cost_at_risk_gbp);
  return { day: t, weekday: dayLabel(t), reductions };
}

// ---------- ordering check ----------
export type OrderFix = {
  sku: string; product: string; category: string; shelf_life_days: number;
  delivered_4wk: number; sold_4wk: number; wasted_4wk: number; reduced_4wk: number;
  waste_rate_pct: number; reduced_rate_pct: number; suggested_order_change_pct: number;
  weekly_cost_gbp: number; worst_waste_day: string | null;
};

export async function orderingFixes(all = false): Promise<OrderFix[]> {
  const [products, t] = await Promise.all([getProducts(), today()]);
  const rows = await daily(t - 28);
  const out: OrderFix[] = [];
  for (const p of products) {
    const r = rows.filter((x) => x.sku === p.sku);
    const c = orderingCheck(p.sku, r);
    if (!all && !c.flag) continue;
    const byDay = new Map<string, number>();
    for (const x of r) byDay.set(dayLabel(x.day), (byDay.get(dayLabel(x.day)) ?? 0) + x.wasted);
    const worst = [...byDay].sort((a, b) => b[1] - a[1])[0];
    const md = r.reduce((a, x) => a + x.markdown_given, 0);
    out.push({
      sku: p.sku, product: p.name, category: p.category, shelf_life_days: p.shelf_life_days,
      delivered_4wk: c.delivered, sold_4wk: c.sold, wasted_4wk: c.wasted, reduced_4wk: c.reduced,
      waste_rate_pct: Math.round(c.waste_rate * 1000) / 10, reduced_rate_pct: Math.round(c.reduced_rate * 1000) / 10,
      suggested_order_change_pct: c.suggested_order_change_pct,
      weekly_cost_gbp: gbp((c.wasted * p.unit_cost + md) / 4),
      worst_waste_day: worst && worst[1] > 0 ? worst[0] : null,
    });
  }
  return out.sort((a, b) => b.weekly_cost_gbp - a.weekly_cost_gbp);
}

// ---------- overview ----------
export async function overview() {
  const [products, t] = await Promise.all([getProducts(), today()]);
  const rows = await daily(t - 28);
  const by = new Map(products.map((p) => [p.sku, p]));
  const cats = new Map<string, { waste_gbp: number; markdown_gbp: number; delivered: number; wasted: number }>();
  let waste = 0, md = 0, revenue = 0, delivered = 0, wasted = 0;
  for (const r of rows) {
    const p = by.get(r.sku)!;
    const c = cats.get(p.category) ?? { waste_gbp: 0, markdown_gbp: 0, delivered: 0, wasted: 0 };
    c.waste_gbp += r.wasted * p.unit_cost; c.markdown_gbp += r.markdown_given; c.delivered += r.delivered; c.wasted += r.wasted;
    cats.set(p.category, c);
    waste += r.wasted * p.unit_cost; md += r.markdown_given; revenue += r.revenue; delivered += r.delivered; wasted += r.wasted;
  }
  const lines = products.map((p) => {
    const r = rows.filter((x) => x.sku === p.sku);
    return { sku: p.sku, product: p.name, waste_gbp: gbp(r.reduce((a, x) => a + x.wasted * p.unit_cost, 0)) };
  }).sort((a, b) => b.waste_gbp - a.waste_gbp);
  return {
    today: t, weekday: dayLabel(t), period: "last 4 weeks", products: products.length,
    waste_cost_gbp: gbp(waste), markdown_given_gbp: gbp(md), revenue_gbp: gbp(revenue),
    waste_rate_pct: Math.round((1000 * wasted) / delivered) / 10,
    by_category: [...cats].map(([category, c]) => ({
      category, waste_cost_gbp: gbp(c.waste_gbp), markdown_given_gbp: gbp(c.markdown_gbp), waste_rate_pct: Math.round((1000 * c.wasted) / c.delivered) / 10,
    })).sort((a, b) => b.waste_cost_gbp - a.waste_cost_gbp),
    top_waste_lines: lines.slice(0, 5),
  };
}

// ---------- one product ----------
export async function productHistory(sku: string) {
  const [p] = (await getProducts()).filter((x) => x.sku === sku);
  if (!p) return null;
  const t = await today();
  const rows = (await daily()).filter((r) => r.sku === sku);
  const weeks = new Map<number, { week: number; delivered: number; sold_full: number; sold_reduced: number; wasted: number }>();
  for (const r of rows) {
    const w = Math.ceil(r.day / 7);
    const x = weeks.get(w) ?? { week: w, delivered: 0, sold_full: 0, sold_reduced: 0, wasted: 0 };
    x.delivered += r.delivered; x.sold_full += r.sold_full; x.sold_reduced += r.sold_reduced; x.wasted += r.wasted;
    weeks.set(w, x);
  }
  const wasteByWeekday = DAY_NAMES.map((d) => ({ day: d, wasted: rows.filter((r) => dayLabel(r.day) === d && r.day > t - 29).reduce((a, r) => a + r.wasted, 0) }));
  const batches = await q<{ batch_id: string; qty: number; expiry_day: number }>("SELECT batch_id, qty, expiry_day FROM batches WHERE sku=$1 ORDER BY expiry_day", [sku]);
  return {
    product: p, today: t,
    weekly: [...weeks.values()],
    waste_by_weekday_last_4wk: wasteByWeekday,
    on_shelf_today: batches.map((b) => ({ ...b, days_left: b.expiry_day - t, use_by: dayLabel(b.expiry_day) })),
  };
}
