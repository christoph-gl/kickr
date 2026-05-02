import { NextResponse } from "next/server";
import type { KickrHookEvent } from "@/lib/openclaw-hooks";

export const dynamic = "force-dynamic";

function isKnownHookEvent(payload: KickrHookEvent) {
  return (
    payload.event === "ride_started" ||
    payload.event === "ride_ended" ||
    payload.event === "rider_feedback" ||
    payload.event === "coach_check" ||
    payload.event === "plan_refresh"
  );
}

function getHookMessage(payload: KickrHookEvent) {
  const eventLabel = payload.event.replaceAll("_", " ");
  return `KICKR ${eventLabel}: read the local KICKR context APIs, then decide whether to send coaching text or queue a trainer command.`;
}

function buildKickrPayload(payload: KickrHookEvent) {
  return {
    source: "kickr",
    timestamp: Date.now(),
    ...payload,
    message: getHookMessage(payload),
    instruction:
      "Read KICKR context APIs, decide whether to coach or queue a command.",
  };
}

async function forwardToHermes(payload: KickrHookEvent) {
  const baseUrl = process.env.HERMES_API_URL!.replace(/\/+$/, "");
  const apiKey = process.env.HERMES_API_KEY;
  const sessionId =
    process.env.HERMES_KICKR_SESSION_ID || "kickr-local-coach";

  const kickrPayload = buildKickrPayload(payload);

  return fetch(`${baseUrl}/v1/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      session_id: sessionId,
      input: kickrPayload.message,
      metadata: kickrPayload,
    }),
  });
}

async function forwardToOpenClaw(payload: KickrHookEvent) {
  const url = process.env.OPENCLAW_HOOKS_URL!;
  const token = process.env.OPENCLAW_HOOKS_TOKEN;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(buildKickrPayload(payload)),
  });
}

export async function POST(req: Request) {
  const hermesUrl = process.env.HERMES_API_URL;
  const openclawUrl = process.env.OPENCLAW_HOOKS_URL;

  if (!hermesUrl && !openclawUrl) {
    return NextResponse.json({ skipped: true });
  }

  try {
    const payload = (await req.json()) as KickrHookEvent;
    if (!payload?.event || !isKnownHookEvent(payload)) {
      return NextResponse.json({ error: "Invalid hook event" }, { status: 400 });
    }

    const target = hermesUrl ? "hermes" : "openclaw";
    const res = hermesUrl
      ? await forwardToHermes(payload)
      : await forwardToOpenClaw(payload);

    if (!res.ok) {
      return NextResponse.json(
        { error: `${target} hook returned ${res.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ sent: true, target });
  } catch (error) {
    console.error("[agent-hooks] Failed to forward hook:", error);
    return NextResponse.json(
      { error: "Failed to forward agent hook" },
      { status: 500 }
    );
  }
}
