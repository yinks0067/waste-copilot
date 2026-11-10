import { NextResponse } from "next/server";
import { overview } from "@/src/store";

export const dynamic = "force-dynamic";

/** GET /api/overview — last 4 weeks of waste and reductions, by category. */
export async function GET() {
  try { return NextResponse.json(await overview()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
