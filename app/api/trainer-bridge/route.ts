import { NextResponse } from "next/server";
import {
  getTrainerBridgeStatus,
  syncTrainerBridge,
  type TrainerBridgeResult,
  type TrainerBridgeStatus,
} from "@/lib/trainer-bridge";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getTrainerBridgeStatus());
}

// The app tab polls this to report live status and receive queued MCP trainer commands.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.status || typeof body.status !== "object") {
    return NextResponse.json({ error: "Missing status" }, { status: 400 });
  }

  const results = Array.isArray(body.results) ? (body.results as TrainerBridgeResult[]) : [];
  const commands = syncTrainerBridge(body.status as TrainerBridgeStatus, results);
  return NextResponse.json({ commands });
}
