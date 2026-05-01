import { NextResponse } from "next/server";
import type { KickrHookEvent } from "@/lib/openclaw-hooks";

export const dynamic = "force-dynamic";

function isKnownHookEvent(payload: KickrHookEvent) {
  return (
    payload.event === "ride_started" ||
    payload.event === "ride_ended" ||
    payload.event === "rider_feedback" ||
    payload.event === "coach_check"
  );
}

function getHookMessage(payload: KickrHookEvent) {
  const eventLabel = payload.event.replaceAll("_", " ");
  return `KICKR ${eventLabel}: read the local KICKR context APIs, then decide whether to send coaching text or queue a trainer command.`;
}

export async function POST(req: Request) {
  const url = process.env.OPENCLAW_HOOKS_URL;

  if (!url) {
    return NextResponse.json({ skipped: true });
  }

  try {
    const payload = (await req.json()) as KickrHookEvent;
    if (!payload?.event || !isKnownHookEvent(payload)) {
      return NextResponse.json({ error: "Invalid hook event" }, { status: 400 });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.OPENCLAW_HOOKS_TOKEN
          ? { Authorization: `Bearer ${process.env.OPENCLAW_HOOKS_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        source: "kickr",
        timestamp: Date.now(),
        ...payload,
        message: getHookMessage(payload),
        instruction:
          "Read KICKR context APIs, decide whether to coach or queue a command.",
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `OpenClaw hook returned ${res.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error("[openclaw-hooks] Failed to forward hook:", error);
    return NextResponse.json(
      { error: "Failed to forward OpenClaw hook" },
      { status: 500 }
    );
  }
}
