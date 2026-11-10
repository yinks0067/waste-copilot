import { NextResponse } from "next/server";
import { pool } from "@/src/store";
import { aiEnabled } from "@/src/briefing";

export const dynamic = "force-dynamic";

/** GET /api/health — liveness check for Docker and Azure Container Apps. */
export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ ok: true, engine: aiEnabled() ? "ai" : "rules" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
