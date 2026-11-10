import { NextResponse } from "next/server";
import { morningBriefing } from "@/src/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/briefing — Claude writes the morning briefing from the tools; numbers are grounding-checked. ?fresh=1 skips the 10-minute cache. */
export async function POST(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  try { return NextResponse.json(await morningBriefing(fresh)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
