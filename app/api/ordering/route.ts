import { NextResponse } from "next/server";
import { orderingFixes } from "@/src/store";

export const dynamic = "force-dynamic";

/** GET /api/ordering — lines ordered well above what sells, with a suggested order change. ?all=1 returns every line. */
export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get("all") === "1";
  try { return NextResponse.json({ lines: await orderingFixes(all) }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
