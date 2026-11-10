/**
 * Scores Claude's morning briefing over several runs (needs ANTHROPIC_API_KEY).
 *  - grounding: share of reported figures that already matched the engines before correction
 *  - coverage: did it include every reduction and every flagged order line on its own
 *  - tool use: did it call the three required tools
 *  - readability: headline length, manager summary length
 * Usage: npm run eval:briefing -- 5
 */
import { writeFileSync } from "node:fs";
import { morningBriefing, aiEnabled } from "../src/briefing";
import { todaysReductions, orderingFixes, pool } from "../src/store";

if (!aiEnabled()) { console.error("Set ANTHROPIC_API_KEY to evaluate the Claude briefing."); process.exit(1); }
const runs = Number(process.argv[2] ?? 3);
const [red, fixes] = await Promise.all([todaysReductions(), orderingFixes()]);
const expected = red.reductions.length + fixes.length;
type Row = { run: number; figures_matched_pct: number; coverage_pct: number; invented_items: number; required_tools_called: boolean; headline_words: number; summary_words: number; seconds: number };
const rows: Row[] = [];
for (let i = 0; i < runs; i++) {
  const r = await morningBriefing(true);
  const g = r.grounding;
  const added = g.notes.filter((n) => n.startsWith("Added")).length;
  const row: Row = {
    run: i + 1,
    figures_matched_pct: g.checked ? Math.round((100 * (g.checked - (g.corrected - added))) / g.checked) : 0,
    coverage_pct: Math.round((100 * (expected - added)) / expected),
    invented_items: g.dropped,
    required_tools_called: ["get_store_overview", "get_todays_reductions", "get_ordering_check"].every((t) => r.toolCalls.includes(t)),
    headline_words: r.briefing.headline.split(/\s+/).length,
    summary_words: r.briefing.manager_summary.split(/\s+/).length,
    seconds: +(r.durationMs / 1000).toFixed(1),
  };
  rows.push(row);
  console.log(row);
}
const mean = (k: keyof Row) => +(rows.reduce((a, r) => a + Number(r[k]), 0) / rows.length).toFixed(1);
const summary = { runs, figures_matched_pct: mean("figures_matched_pct"), coverage_pct: mean("coverage_pct"), invented_items: mean("invented_items"), seconds: mean("seconds") };
console.log("\nSummary:", summary);
writeFileSync("eval/briefing-results.json", JSON.stringify({ summary, rows }, null, 2) + "\n");
await pool.end();
