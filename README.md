# Waste Copilot

**Cutting short-life food waste in grocery stores: ordering fixes, a daily reduce list, and a morning briefing written by Claude.**

![Dashboard](docs/screenshot-dashboard.png)

## The problem

Food waste on short-life lines (bakery, dairy, fruit & veg, meat & fish, ready meals) is one of the most expensive everyday problems in UK grocery, and retailers are under pressure to fix it:

- Lidl GB has set a target to cut food waste by **70% by FY2030**.
- Retailers already pay specialist vendors for markdown and waste tools, and co-ops have published results from them.
- Yet most stores still reduce by habit: a yellow sticker at a fixed % on the use-by day, with only a small share of UK markdowns driven by data.
- Labour costs keep rising, so time spent walking the aisles deciding what to reduce costs more every year.

## What Waste Copilot does

Every morning, for every short-life line in the store:

1. **Ordering check.** Looks at the last 4 weeks and finds lines where the store keeps ordering more than sells (a big share binned or cleared at a discount). It suggests a smaller order and shows what each line is costing per week and the day it's worst.
2. **Reduce list.** A markdown planner looks at each batch near its use-by date and tries each reduction step (25 / 50 / 75%). It projects sales across 24 sampled demand scenarios and picks the step that earns the most across the whole product line. That accounts for yellow-sticker items stealing sales from full-price stock.
3. **Morning briefing (Claude).** A Claude agent reads the store data through tools and writes a short briefing: what to reduce first, which orders to change, and why, in plain English for shop-floor colleagues and the store manager.

## Results (simulated store)

28 days, 44 short-life lines, 5 different shopper scenarios. **Every approach faces exactly the same shoppers**, so the comparison is like-for-like. The baseline is the store's current habit: reduce 50% on the use-by day.

| Approach | Margin (4 wks) | Stock binned | Given away in reductions |
| --- | --- | --- | --- |
| Never reduce | £11,276 | £4,814 | £0 |
| **Current habit: 50% off on the use-by day** | £11,510 | £2,349 | £4,703 |
| Reduce planner only | £11,746 | £2,543 | £3,931 |
| **Current habit + ordering fixes** | **£14,664** | **£367 (−84%)** | £2,998 |
| Reduce planner + ordering fixes | £14,763 | £856 (−64%) | £1,831 |

**What this shows**

- **The waste problem is mostly an ordering problem.** Fixing orders on 9 of 44 lines cuts the cost of binned stock by **84%** and adds about **£3,150 margin per store every 4 weeks (≈ £41k a year)**. It beats the current habit on both waste and margin in **all 5 scenarios**.
- **Smaller orders don't empty the shelves.** Shoppers who found nothing went from 351 to 377 over 4 weeks, out of about 19,000.
- **Cleverer reductions matter less than you'd think.** The planner earns +£236 margin per 4 weeks and gives away 16% less in reductions, but it bins more than the simple 50% rule, because it's tuned for margin. That's a business choice. `WASTE_WEIGHT` sets how much a binned item counts against the plan, so a store with a waste target can trade margin for less waste.

These are results from a model, not a real store. The assumptions are listed below and are deliberately simple. The value is in the method: a seeded simulation with common random numbers, baselines, and every number reproducible with `npm run simulate`.

## How Claude is used, and how it's kept honest

```
              ┌──────────────────────────── deterministic engines (src/model.ts, src/store.ts) ───┐
PostgreSQL ──►│ overview · reduce planner · ordering check · product history                       │
              └──────────────┬────────────────────────────────────────────────────────────────────┘
                             │ read-only tools
                             ▼
                      Claude agent (src/briefing.ts)
                      tool-use loop → must finish with report_briefing (structured JSON)
                             │
                             ▼
                      Grounding check: every figure compared with the engines;
                      wrong numbers corrected, invented items dropped, missing items added
                             │
                             ▼
                      Next.js dashboard  ·  POST /api/briefing
```

- **Claude doesn't do the maths.** Which batch to reduce, by how much, and which orders to cut all come from tested, deterministic code. Claude decides what matters most today and explains it to people.
- **Structured output.** The agent must end with the `report_briefing` tool, so the briefing is always JSON with the same shape.
- **Grounding check.** After Claude answers, every quantity, % and £ figure is compared with the engines. Anything wrong is corrected, anything invented is removed, and anything missed is added. The dashboard shows "N figures checked".
- **Offline mode.** Without `ANTHROPIC_API_KEY`, a rule-based writer produces the briefing from the same tools, so the demo always works.
- **Evaluation.** `npm run eval:briefing -- 5` runs Claude 5 times and reports figure accuracy (before correction), coverage, invented items, tool use and latency.

## Run it

### Docker (one command)

```bash
docker compose up --build        # Postgres + loader + app → http://localhost:3000
```

Put `ANTHROPIC_API_KEY=...` in a `.env` file to have Claude write the briefing.

### Local

```bash
npm install
export DATABASE_URL="postgresql://user:pass@localhost:5432/waste"
export ANTHROPIC_API_KEY="..."      # optional

npm run simulate          # build the store, run every policy, write data/ and eval/results.json
npm run db:reset          # load the store into PostgreSQL (needs psql)
npm run dev               # http://localhost:3000

npm test                  # 20 tests: model, planner, ordering check, grounding, results
npm run briefing          # print this morning's briefing in the terminal
npm run eval:briefing -- 5
```

### API

| Endpoint | Returns |
| --- | --- |
| `GET /api/overview` | Last 4 weeks: £ binned, £ given away, waste rate, by category, top 5 lines |
| `GET /api/reductions` | This morning's reduce list: batch, qty, use-by, % off, new price |
| `GET /api/ordering` | Over-ordered lines with suggested order change and weekly cost (`?all=1` for every line) |
| `POST /api/briefing` | The morning briefing (Claude or offline), with grounding stats |
| `GET /api/health` | Database check, used by Docker and Azure health probes |

## Model assumptions

- Each day: a delivery arrives (same ordering rule for every approach), reductions are set, shoppers buy, and anything at its use-by day that's still unsold is binned.
- 35% of regular shoppers pick a reduced item over full price when both are on the shelf. 60% of full-price shoppers reach for the freshest date.
- A reduction brings in extra shoppers: +1.6 × the discount × normal demand (50% off → +80%).
- Demand varies by weekday (busier Friday and Saturday) and day to day (±20%, then Poisson).
- The ordering check flags a line when (binned + half of reduced) is over 12% of deliveries. It suggests cutting the order by that excess, down to a 4% target, capped at 35%.

## Testing and CI

- **Vitest (20 tests):** selling logic conserves stock, shoppers' date-picking, fixed rule and planner behaviour, ordering check, store queries against real PostgreSQL, the grounding check catching wrong, invented and missing items, and the published results holding in every scenario.
- **GitHub Actions:** re-runs the simulation and fails if the committed results change, loads Postgres, type-checks, tests, scores the Claude briefing when the API key secret is set, builds the app and the Docker image.

## Deploy to Azure Container Apps

```bash
az group create -n waste-rg -l uksouth
az acr create -n <registry> -g waste-rg --sku Basic --admin-enabled true
az acr build -r <registry> -t waste-copilot:latest .
az postgres flexible-server create -g waste-rg -n <pg-server> --tier Burstable --sku-name Standard_B1ms \
  --admin-user app --admin-password '<password>' --public-access 0.0.0.0
psql "<azure connection string>" -f db/schema.sql -f db/load.sql
az containerapp up -n waste-copilot -g waste-rg --image <registry>.azurecr.io/waste-copilot:latest \
  --target-port 3000 --ingress external \
  --env-vars DATABASE_URL='<azure connection string>?sslmode=require' ANTHROPIC_API_KEY='<key>'
```

## Tech

TypeScript · Next.js 16 · React 19 · PostgreSQL 16 · Anthropic Claude API (tool use, structured output) · Vitest · Docker · GitHub Actions · Azure Container Apps

## Layout

| Path | What it is |
| --- | --- |
| `src/model.ts` | Store model, shoppers, reduce planner, ordering check, metrics |
| `src/store.ts` | Database queries and today's plan, built on the model |
| `src/briefing.ts` | Claude agent, tools, offline writer, grounding check |
| `scripts/simulate.ts` | Builds the store, runs every approach, writes `data/` and `eval/results.json` |
| `eval/eval-briefing.ts` | Scores the Claude briefing over several runs |
| `app/` | Dashboard, product page, API routes |
| `tests/` | Vitest suites |
