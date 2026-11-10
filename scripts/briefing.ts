// Usage: npm run briefing    (Claude if ANTHROPIC_API_KEY is set, otherwise the offline rules)
import { morningBriefing } from "../src/briefing";
import { pool } from "../src/store";

const r = await morningBriefing(true);
console.log(`Engine: ${r.engine} · tools: ${r.toolCalls.join(", ")} · ${(r.durationMs / 1000).toFixed(1)}s`);
console.log(`Grounding: ${r.grounding.checked} checked, ${r.grounding.corrected} corrected, ${r.grounding.dropped} dropped\n`);
console.log(JSON.stringify(r.briefing, null, 2));
await pool.end();
