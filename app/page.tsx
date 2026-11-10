import Link from "next/link";
import { readFileSync } from "node:fs";
import path from "node:path";
import { overview, todaysReductions, orderingFixes } from "@/src/store";
import BriefingPanel from "./BriefingPanel";

export const dynamic = "force-dynamic";

const gbp = (n: number, dp = 2) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

type Results = {
  eval_days: number; scenarios: number;
  average: Record<string, { gross_margin_gbp: number; waste_cost_gbp: number; markdown_given_gbp: number; lost_sales_units: number; margin_pct: number }>;
  comparison: Record<string, { waste_cost_cut_pct: number; extra_margin_gbp_per_4_weeks: number; extra_margin_gbp_per_year: number; better_margin_in_scenarios: number; less_waste_in_scenarios: number }>;
  policies: Record<string, string>;
};

export default async function Home() {
  const [ov, red, fixes] = await Promise.all([overview(), todaysReductions(), orderingFixes()]);
  const results = JSON.parse(readFileSync(path.join(process.cwd(), "eval/results.json"), "utf8")) as Results;
  const best = results.comparison.copilot_plus_ordering;
  const ordering = results.comparison.fixed_rule_plus_ordering;
  const fixCost = fixes.reduce((a, f) => a + f.weekly_cost_gbp, 0);

  return (
    <main>
      <div className="hero">
        <div>
          <div className="eyebrow">{red.weekday} morning · trading day {red.day}</div>
          <h1>Short-life waste, and how to stop it</h1>
          <p className="sub" style={{ margin: 0 }}>Bakery, dairy, fruit & veg, meat & fish and ready meals. Last 4 weeks.</p>
        </div>
      </div>

      <section className="stats">
        <div className="stat"><div className="k">Stock binned</div><div className="v loss">{gbp(ov.waste_cost_gbp)}</div></div>
        <div className="stat"><div className="k">Given away in reductions</div><div className="v">{gbp(ov.markdown_given_gbp)}</div></div>
        <div className="stat"><div className="k">Waste rate</div><div className="v">{ov.waste_rate_pct}%</div></div>
        <div className="stat"><div className="k">Over-ordered lines</div><div className="v">{fixes.length} <span className="muted small">· {gbp(fixCost)}/wk</span></div></div>
      </section>

      <BriefingPanel />

      <div className="section-title">
        <h2>Reduce this morning</h2>
        <span className="muted small">{red.reductions.length} batches · planned against the sales forecast</span>
      </div>
      <section className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead><tr><th>Product</th><th className="hide-sm">Batch</th><th className="num">Qty</th><th>Use by</th><th className="num">Off</th><th className="num">New price</th></tr></thead>
          <tbody>
            {red.reductions.map((r) => (
              <tr key={r.batch_id} className="row">
                <td><Link href={`/product/${r.sku}`}><div style={{ fontWeight: 600 }}>{r.product}</div><div className="sku">{r.category}</div></Link></td>
                <td className="sku hide-sm">{r.batch_id}</td>
                <td className="num">{r.qty}</td>
                <td><span className={`tag ${r.days_left === 0 ? "today" : "soon"}`}>{r.use_by}</span></td>
                <td className="num off">−{r.reduce_by_pct}%</td>
                <td className="num price"><s>{gbp(r.full_price_gbp)}</s><b>{gbp(r.new_price_gbp)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="section-title">
        <h2>Order less of these</h2>
        <span className="muted small">where most of the waste really comes from</span>
      </div>
      <section className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead><tr><th>Product</th><th className="num hide-sm">In (4 wks)</th><th className="num hide-sm">Binned</th><th className="num hide-sm">Reduced</th><th className="num">Costing</th><th className="num">Change order</th></tr></thead>
          <tbody>
            {fixes.map((f) => (
              <tr key={f.sku} className="row">
                <td><Link href={`/product/${f.sku}`}><div style={{ fontWeight: 600 }}>{f.product}</div><div className="sku">{f.category}{f.worst_waste_day ? ` · worst on ${f.worst_waste_day}` : ""}</div></Link></td>
                <td className="num hide-sm">{f.delivered_4wk}</td>
                <td className="num hide-sm loss">{f.wasted_4wk}</td>
                <td className="num hide-sm">{f.reduced_4wk}</td>
                <td className="num">{gbp(f.weekly_cost_gbp)}/wk</td>
                <td className="num off">{f.suggested_order_change_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="section-title">
        <h2>What it&apos;s worth</h2>
        <span className="muted small">{results.eval_days}-day simulation · {results.scenarios} shopper scenarios · same shoppers for every approach</span>
      </div>
      <section className="stats">
        <div className="stat result-hl"><div className="k">Waste cut by ordering fixes</div><div className="v">{ordering.waste_cost_cut_pct}%</div></div>
        <div className="stat result-hl"><div className="k">Extra margin per store</div><div className="v">{gbp(Math.min(ordering.extra_margin_gbp_per_year, best.extra_margin_gbp_per_year), 0)}–{gbp(Math.max(ordering.extra_margin_gbp_per_year, best.extra_margin_gbp_per_year), 0).slice(1)}/yr</div></div>
        <div className="stat"><div className="k">Beats current habit</div><div className="v">{Math.min(ordering.better_margin_in_scenarios, best.better_margin_in_scenarios)}/{results.scenarios} <span className="muted small">scenarios</span></div></div>
      </section>
      <section className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead><tr><th>Approach</th><th className="num">Margin (4 wks)</th><th className="num">Binned</th><th className="num hide-sm">Given away</th><th className="num hide-sm">Shoppers who found an empty shelf</th></tr></thead>
          <tbody>
            {Object.entries(results.average).map(([k, a]) => (
              <tr key={k}>
                <td style={{ fontWeight: k.endsWith("plus_ordering") ? 700 : 400 }}>{results.policies[k]}</td>
                <td className="num">{gbp(a.gross_margin_gbp, 0)} <span className="muted small">({a.margin_pct}%)</span></td>
                <td className="num loss">{gbp(a.waste_cost_gbp, 0)}</td>
                <td className="num hide-sm">{gbp(a.markdown_given_gbp, 0)}</td>
                <td className="num hide-sm">{Math.round(a.lost_sales_units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="muted small">Compared with the store&apos;s current habit (reduce 50% on the use-by day). Almost all the gain comes from ordering less of the lines that keep getting binned. The reduce planner on its own earns a little more margin and gives away less, but bins more than the 50% habit; it is tuned for margin and can be set to favour waste (WASTE_WEIGHT).</p>
    </main>
  );
}
