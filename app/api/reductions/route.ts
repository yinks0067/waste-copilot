import { NextResponse } from "next/server";
import { todaysReductions } from "@/src/store";

export const dynamic = "force-dynamic";

/** GET /api/reductions — this morning's markdown plan: batch, quantity, % off, new price. */
export async function GET() {
  try { return NextResponse.json(await todaysReductions()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
