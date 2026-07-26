import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SECURITY: PUBLIC — minimal health probe; exposes no auth or configuration. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
