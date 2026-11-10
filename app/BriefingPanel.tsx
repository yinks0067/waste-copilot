"use client";

import { useState } from "react";

type Result = {
  briefing: {
    headline: string; manager_summary: string; watch_outs: string[];
    reductions: { batch_id: string; product: string; qty: number; reduce_by_pct: number; new_price_gbp: number; why: string }[];
    order_changes: { sku: string; product: string; change_pct: number; weekly_cost_gbp: number; why: string }[];
  };
  engine: "ai" | "rules"; toolCalls: string[]; durationMs: number;
  grounding: { checked: number; corrected: number; dropped: number };
};

export default function BriefingPanel() {
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run(fresh = false) {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/briefing${fresh ? "?fresh=1" : ""}`, { method: "POST" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Briefing failed");
      setRes(body);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!res) {
    return (
      <section className="card finding">
        <h2>Morning briefing</h2>
        <p className="muted" style={{ marginTop: 0 }}>Reads today&apos;s reduce plan, the ordering check and the last 4 weeks, then writes a short briefing for the team and the manager.</p>
        <button className="btn" onClick={() => run()} disabled={busy}>{busy ? "Writing the briefing…" : "Write this morning's briefing"}</button>
        {err && <p className="err">{err}</p>}
      </section>
    );
  }

  const b = res.briefing;
  const g = res.grounding;
  return (
    <section className="card finding">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span className="eyebrow" style={{ margin: 0 }}>Morning briefing</span>
        <span className="grounded" title="Every number was checked against the planner and ordering check">
          {g.checked} figures checked{g.corrected + g.dropped > 0 ? ` · ${g.corrected + g.dropped} fixed` : " · all matched"}
        </span>
      </div>
      <p className="headline">{b.headline}</p>
      <p style={{ marginTop: 0, lineHeight: 1.55 }}>{b.manager_summary}</p>

      <div className="two" style={{ marginTop: 14 }}>
        <div>
          <h2 style={{ fontSize: 14 }}>For the team: reduce now</h2>
          <ul className="ev">
            {b.reductions.slice(0, 6).map((r) => (
              <li key={r.batch_id}><b>{r.product}</b> ×{r.qty}: {r.reduce_by_pct}% off, £{r.new_price_gbp.toFixed(2)}. <span className="muted">{r.why}</span></li>
            ))}
            {b.reductions.length > 6 && <li className="muted">…and {b.reductions.length - 6} more in the list below.</li>}
          </ul>
        </div>
        <div>
          <h2 style={{ fontSize: 14 }}>For the manager: change orders</h2>
          <ul className="ev">
            {b.order_changes.slice(0, 5).map((o) => (
              <li key={o.sku}><b>{o.product}</b> {o.change_pct}% (costing £{o.weekly_cost_gbp.toFixed(2)}/wk). <span className="muted">{o.why}</span></li>
            ))}
          </ul>
        </div>
      </div>

      {b.watch_outs.length > 0 && (
        <div className="action"><b>Watch out for</b>{b.watch_outs.join(" · ")}</div>
      )}
      <div className="meta">
        {res.engine === "ai" ? "Written by Claude" : "Rule-based (offline)"} · {res.toolCalls.length} tool calls · {(res.durationMs / 1000).toFixed(1)}s
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn ghost" onClick={() => run(true)} disabled={busy}>{busy ? "Rewriting…" : "Write again"}</button>
      </div>
      {err && <p className="err">{err}</p>}
    </section>
  );
}
