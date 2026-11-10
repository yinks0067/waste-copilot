/**
 * Morning briefing agent.
 *
 * Claude gets read-only tools over the store data and must finish by calling `report_briefing`.
 * The maths (which batches to reduce, by how much, which orders to cut) is done by deterministic
 * code in store.ts. Claude's job is judgement and communication: what matters most today, why,
 * and how to say it to a busy colleague and a store manager.
 *
 * After Claude answers, a grounding check compares every number it reported with the tool output
 * and corrects anything that doesn't match, so the briefing can't invent figures.
 */
import Anthropic from "@anthropic-ai/sdk";
import { overview, todaysReductions, orderingFixes, productHistory, type Reduction, type OrderFix } from "./store";

const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";
const MAX_TURNS = 8;
let client: Anthropic | undefined;

export type Briefing = {
  headline: string;
  reductions: { sku: string; product: string; batch_id: string; qty: number; reduce_by_pct: number; new_price_gbp: number; why: string }[];
  order_changes: { sku: string; product: string; change_pct: number; weekly_cost_gbp: number; why: string }[];
  manager_summary: string;
  watch_outs: string[];
};

export type BriefingResult = {
  briefing: Briefing; engine: "ai" | "rules"; toolCalls: string[]; durationMs: number;
  grounding: { checked: number; corrected: number; dropped: number; notes: string[] };
};

export const tools: Anthropic.Tool[] = [
  {
    name: "get_store_overview",
    description: "Last 4 weeks for the short-life range: £ cost of stock binned, £ given away in reductions, waste rate, split by category, and the 5 lines with the most waste.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_todays_reductions",
    description: "The markdown planner's list for this morning: each batch to reduce, quantity, use-by, % off, new price and the cost of the stock at risk. These numbers are final; do not change them.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_ordering_check",
    description: "Lines where the last 4 weeks show the store is ordering more than it sells: delivered, sold, binned and reduced units, waste and reduced rates, suggested % change to the order, what it is costing per week, and the weekday with the most waste.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_product_history",
    description: "One product: weekly delivered / sold / reduced / binned for 8 weeks, waste by weekday for the last 4 weeks, and the batches on the shelf today.",
    input_schema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
  },
  {
    name: "report_briefing",
    description: "Call once, last. The morning briefing for store colleagues and the manager. Plain English, short. Use only numbers from the tools.",
    input_schema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "One sentence: the single most important thing today." },
        reductions: {
          type: "array",
          description: "Today's reductions in the order colleagues should do them (most urgent and most valuable first). Include every batch from get_todays_reductions.",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" }, product: { type: "string" }, batch_id: { type: "string" }, qty: { type: "integer" },
              reduce_by_pct: { type: "integer" }, new_price_gbp: { type: "number" },
              why: { type: "string", description: "Under 15 words, for the colleague doing it." },
            },
            required: ["sku", "product", "batch_id", "qty", "reduce_by_pct", "new_price_gbp", "why"],
          },
        },
        order_changes: {
          type: "array",
          description: "Order changes for the manager, biggest weekly cost first. Include every line from get_ordering_check.",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" }, product: { type: "string" }, change_pct: { type: "integer" },
              weekly_cost_gbp: { type: "number" }, why: { type: "string", description: "One sentence with the evidence." },
            },
            required: ["sku", "product", "change_pct", "weekly_cost_gbp", "why"],
          },
        },
        manager_summary: { type: "string", description: "3-4 sentences for the store manager: where the money is going and what to change this week." },
        watch_outs: { type: "array", items: { type: "string" }, description: "Up to 3 short things to keep an eye on (patterns by day or category)." },
      },
      required: ["headline", "reductions", "order_changes", "manager_summary", "watch_outs"],
    },
  },
];

export const SYSTEM = `You write the morning waste briefing for a UK grocery store's short-life range (bakery, dairy, fruit & veg, meat & fish, ready meals).
Readers: shop-floor colleagues (who do the reductions) and the store manager (who owns ordering).
Always call get_store_overview, get_todays_reductions and get_ordering_check before writing. Look at get_product_history for the 1-3 most costly lines if it helps you explain a pattern.
Rules:
- Numbers come only from the tools. Never calculate new prices or percentages yourself; copy them.
- Include every reduction and every flagged order line.
- Explain the "why" in plain English: no jargon, no "SKU" in prose, money in £ with two decimals.
- Waste usually comes from ordering more than sells. Reductions recover some of it; smaller orders stop it happening.
Finish by calling report_briefing exactly once.`;

const handlers: Record<string, (input: { sku?: string }) => Promise<unknown>> = {
  get_store_overview: () => overview(),
  get_todays_reductions: () => todaysReductions(),
  get_ordering_check: () => orderingFixes(),
  get_product_history: ({ sku }) => productHistory(String(sku ?? "")).then((r) => r ?? { error: "unknown product" }),
};

// ---------- Claude ----------
async function claudeBriefing(): Promise<{ briefing: Briefing; toolCalls: string[] }> {
  client ??= new Anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: "Write this morning's waste briefing." }];
  const toolCalls: string[] = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 4000, system: SYSTEM, tools, messages });
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const final = uses.find((u) => u.name === "report_briefing");
    if (final) return { briefing: final.input as Briefing, toolCalls };
    if (!uses.length) { messages.push({ role: "user", content: "Please finish by calling report_briefing." }); continue; }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      toolCalls.push(u.name);
      const h = handlers[u.name];
      const out = h ? await h(u.input as { sku?: string }) : { error: `unknown tool ${u.name}` };
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error(`No briefing after ${MAX_TURNS} turns`);
}

// ---------- rules (offline) ----------
const money = (n: number) => `£${n.toFixed(2)}`;

export async function rulesBriefing(): Promise<{ briefing: Briefing; toolCalls: string[] }> {
  const [ov, red, fixes] = await Promise.all([overview(), todaysReductions(), orderingFixes()]);
  const top = fixes[0];
  const fixCost = fixes.reduce((a, f) => a + f.weekly_cost_gbp, 0);
  const worstCat = ov.by_category[0];
  return {
    toolCalls: ["get_store_overview", "get_todays_reductions", "get_ordering_check"],
    briefing: {
      headline: top
        ? `${top.product} is the biggest leak: about ${money(top.weekly_cost_gbp)} a week binned or reduced. Cut the order by ${-top.suggested_order_change_pct}%.`
        : `${red.reductions.length} batches to reduce this morning; ordering looks healthy.`,
      reductions: red.reductions.map((r) => ({
        sku: r.sku, product: r.product, batch_id: r.batch_id, qty: r.qty, reduce_by_pct: r.reduce_by_pct, new_price_gbp: r.new_price_gbp,
        why: r.days_left === 0 ? "Use-by today: clear it before close." : `Use-by ${r.use_by}: start now so it sells in time.`,
      })),
      order_changes: fixes.map((f) => ({
        sku: f.sku, product: f.product, change_pct: f.suggested_order_change_pct, weekly_cost_gbp: f.weekly_cost_gbp,
        why: `In 4 weeks ${f.delivered_4wk} came in, ${f.wasted_4wk} were binned and ${f.reduced_4wk} had to be reduced${f.worst_waste_day ? `; most waste on ${f.worst_waste_day}` : ""}.`,
      })),
      manager_summary:
        `Over the last 4 weeks the short-life range binned ${money(ov.waste_cost_gbp)} of stock and gave away ${money(ov.markdown_given_gbp)} in reductions (waste rate ${ov.waste_rate_pct}%). ` +
        `${worstCat ? `${worstCat.category} is the biggest source at ${money(worstCat.waste_cost_gbp)} binned. ` : ""}` +
        `${fixes.length} lines are ordered well above what sells, costing about ${money(fixCost)} a week between them. Cutting those orders is the quickest win; reductions only recover part of the loss.`,
      watch_outs: ov.by_category.filter((c) => c.waste_rate_pct >= 2).slice(0, 3).map((c) => `${c.category}: ${c.waste_rate_pct}% of deliveries binned in 4 weeks.`),
    },
  };
}

// ---------- grounding check ----------
/** Make every number in the briefing match the deterministic engines. Fill in anything missing. */
export function ground(b: Briefing, reductions: Reduction[], fixes: OrderFix[]) {
  const notes: string[] = [];
  let checked = 0, corrected = 0, dropped = 0;
  const red = new Map(reductions.map((r) => [r.batch_id, r]));
  const fix = new Map(fixes.map((f) => [f.sku, f]));

  const outRed: Briefing["reductions"] = [];
  for (const r of b.reductions ?? []) {
    const truth = red.get(r.batch_id);
    if (!truth) { dropped++; notes.push(`Removed reduction for unknown batch ${r.batch_id}.`); continue; }
    checked++;
    if (r.qty !== truth.qty || r.reduce_by_pct !== truth.reduce_by_pct || Math.abs(r.new_price_gbp - truth.new_price_gbp) > 0.005 || r.sku !== truth.sku) {
      corrected++; notes.push(`Corrected numbers for batch ${r.batch_id}.`);
    }
    outRed.push({ ...r, sku: truth.sku, product: truth.product, qty: truth.qty, reduce_by_pct: truth.reduce_by_pct, new_price_gbp: truth.new_price_gbp });
    red.delete(r.batch_id);
  }
  for (const t of red.values()) {
    corrected++; notes.push(`Added missing reduction for batch ${t.batch_id}.`);
    outRed.push({ sku: t.sku, product: t.product, batch_id: t.batch_id, qty: t.qty, reduce_by_pct: t.reduce_by_pct, new_price_gbp: t.new_price_gbp, why: `Use-by ${t.use_by}.` });
  }

  const outFix: Briefing["order_changes"] = [];
  for (const o of b.order_changes ?? []) {
    const truth = fix.get(o.sku);
    if (!truth) { dropped++; notes.push(`Removed order change for ${o.sku}: not flagged by the ordering check.`); continue; }
    checked++;
    if (o.change_pct !== truth.suggested_order_change_pct || Math.abs(o.weekly_cost_gbp - truth.weekly_cost_gbp) > 0.005) {
      corrected++; notes.push(`Corrected numbers for ${truth.product}.`);
    }
    outFix.push({ ...o, product: truth.product, change_pct: truth.suggested_order_change_pct, weekly_cost_gbp: truth.weekly_cost_gbp });
    fix.delete(o.sku);
  }
  for (const t of fix.values()) {
    corrected++; notes.push(`Added missing order change for ${t.product}.`);
    outFix.push({ sku: t.sku, product: t.product, change_pct: t.suggested_order_change_pct, weekly_cost_gbp: t.weekly_cost_gbp, why: `Waste rate ${t.waste_rate_pct}% over 4 weeks.` });
  }
  return { briefing: { ...b, reductions: outRed, order_changes: outFix, watch_outs: (b.watch_outs ?? []).slice(0, 3) }, grounding: { checked, corrected, dropped, notes } };
}

// ---------- entry point ----------
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY) && process.env.ENGINE !== "rules";

let cache: { at: number; result: BriefingResult } | undefined;

export async function morningBriefing(fresh = false): Promise<BriefingResult> {
  if (!fresh && cache && Date.now() - cache.at < 10 * 60_000) return cache.result;
  const started = Date.now();
  const engine = aiEnabled() ? "ai" : "rules";
  const { briefing, toolCalls } = engine === "ai" ? await claudeBriefing() : await rulesBriefing();
  const [red, fixes] = await Promise.all([todaysReductions(), orderingFixes()]);
  const g = ground(briefing, red.reductions, fixes);
  const result: BriefingResult = { briefing: g.briefing, engine, toolCalls, durationMs: Date.now() - started, grounding: g.grounding };
  cache = { at: Date.now(), result };
  return result;
}
