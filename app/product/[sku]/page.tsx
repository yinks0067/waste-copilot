import Link from "next/link";
import { notFound } from "next/navigation";
import { productHistory, orderingFixes } from "@/src/store";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const d = await productHistory(sku.toUpperCase());
  if (!d) notFound();
  const fix = (await orderingFixes(true)).find((f) => f.sku === d.product.sku)!;
  const max = Math.max(1, ...d.weekly.map((w) => w.delivered));
  const maxDay = Math.max(1, ...d.waste_by_weekday_last_4wk.map((w) => w.wasted));
  const p = d.product;

  return (
    <main>
      <Link href="/" className="back">← Back to today</Link>
      <h1>{p.name}</h1>
      <p className="sub">{p.category} · cost £{p.unit_cost.toFixed(2)} · price £{p.unit_price.toFixed(2)} · {p.shelf_life_days}-day life</p>

      <section className="stats">
        <div className="stat"><div className="k">Delivered (4 wks)</div><div className="v">{fix.delivered_4wk}</div></div>
        <div className="stat"><div className="k">Binned</div><div className="v loss">{fix.wasted_4wk} <span className="muted small">({fix.waste_rate_pct}%)</span></div></div>
        <div className="stat"><div className="k">Sold reduced</div><div className="v">{fix.reduced_4wk} <span className="muted small">({fix.reduced_rate_pct}%)</span></div></div>
        <div className="stat"><div className="k">Suggested order change</div><div className={`v ${fix.suggested_order_change_pct < 0 ? "loss" : ""}`}>{fix.suggested_order_change_pct === 0 ? "None" : `${fix.suggested_order_change_pct}%`}</div></div>
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Week by week: where the deliveries went</h2>
          <div className="bar3">
            {d.weekly.map((w) => (
              <div key={w.week} className="wk" style={{ height: `${(w.delivered / max) * 100}%` }} title={`Week ${w.week}: ${w.delivered} in, ${w.sold_full} full price, ${w.sold_reduced} reduced, ${w.wasted} binned`}>
                <div className="s" style={{ flex: w.sold_full }} />
                <div className="r" style={{ flex: w.sold_reduced }} />
                <div className="w" style={{ flex: w.wasted }} />
              </div>
            ))}
          </div>
          <div className="legend"><span><i style={{ background: "var(--brand)" }} />Sold full price</span><span><i style={{ background: "#e0a43a" }} />Sold reduced</span><span><i style={{ background: "var(--loss)" }} />Binned</span></div>
        </section>

        <div className="stack">
          <section className="card">
            <h2>Binned by day of week (4 wks)</h2>
            <div className="bars">
              {d.waste_by_weekday_last_4wk.map((w) => <div key={w.day} title={`${w.day}: ${w.wasted}`} style={{ height: `${(w.wasted / maxDay) * 100}%`, background: "var(--loss)" }} />)}
            </div>
            <div className="legend">{d.waste_by_weekday_last_4wk.map((w) => <span key={w.day} style={{ flex: 1, textAlign: "center" }}>{w.day}</span>)}</div>
          </section>
          <section className="card">
            <h2>On the shelf this morning</h2>
            {d.on_shelf_today.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing in stock.</p> :
              d.on_shelf_today.map((b) => (
                <div key={b.batch_id} className="calc">
                  <span><span className="sku">{b.batch_id}</span> · use by {b.days_left === 0 ? "today" : b.days_left === 1 ? "tomorrow" : b.use_by}</span>
                  <span className="num">{b.qty}</span>
                </div>
              ))}
          </section>
        </div>
      </div>
    </main>
  );
}
