import { NextResponse } from "next/server";
import type { AgentEvent } from "@/lib/agent";
import { insertAgentEvent, listAgentEvents } from "@/lib/db";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  const token = process.env.AGENT_EVENT_TOKEN || process.env.AGENT_COMMAND_TOKEN;
  if (!token) return true;
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;

  const auth = req.headers.get("authorization");
  return auth === `Bearer ${token}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const event = (await req.json()) as AgentEvent;
    insertAgentEvent(event);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to log agent event:", error);
    return NextResponse.json({ error: "Failed to log agent event" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || 200);

  try {
    return NextResponse.json({ events: listAgentEvents(limit) });
  } catch (error) {
    console.error("Failed to list agent events:", error);
    return NextResponse.json({ error: "Failed to load agent events" }, { status: 500 });
  }
}
