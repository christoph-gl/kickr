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

function getRuntimeContract(origin: string, payload: KickrHookEvent) {
  return {
    baseUrl: origin,
    contextAlreadyIncluded: true,
    useAtMostOneCommand: true,
    commandEndpoint: `${origin}/api/agent/commands`,
    contextEndpoints: {
      rider: `${origin}/api/rider`,
      recentEvents: `${origin}/api/agent/events?limit=20`,
      sessions: `${origin}/api/sessions`,
    },
    commands: [
      { type: "send_message", text: "short rider-facing cue" },
      { type: "set_erg_watts", watts: 220, reason: "why" },
      { type: "set_resistance", percent: 35, reason: "why" },
      {
        type: "request_rider_voice_feedback",
        prompt: "How does this effort feel?",
        durationSeconds: 10,
      },
    ],
    rules:
      payload.mode === "fast"
        ? [
            "Do not inspect the repo.",
            "Do not fetch ride history unless the included snapshot is insufficient.",
            "Prefer one send_message under 12 words.",
            "Only change trainer power/resistance if clearly needed.",
          ]
        : [
            "Use the included snapshot first.",
            "Fetch more context only if needed.",
            "Queue at most one rider-facing command unless explicitly asked otherwise.",
          ],
  };
}

function getHookMessage(payload: KickrHookEvent) {
  const eventLabel = payload.event.replaceAll("_", " ");
  if (payload.event === "coach_check" && payload.mode === "fast") {
    return "KICKR fast coach check: use the included snapshot and return one short rider-facing cue or one clear command.";
  }
  if (payload.event === "rider_feedback") {
    return "KICKR rider feedback: use the rider transcript and included snapshot, then decide whether to send one short cue or command.";
  }
  return `KICKR ${eventLabel}: use the included KICKR context first, then decide whether to send coaching text or queue a trainer command.`;
}

function getHookInstruction(payload: KickrHookEvent) {
  if (payload.event === "coach_check" && payload.mode === "fast") {
    return "Fast mode. Do not browse, inspect files, or reread docs. The snapshot is sufficient for a quick cue. Queue at most one command through runtimeContract.commandEndpoint, preferably send_message under 12 words.";
  }
  if (payload.event === "rider_feedback") {
    return "Respond to the rider feedback using the included transcript and snapshot. Queue at most one concise send_message or trainer command.";
  }
  return "Use included context first. If action is useful, queue at most one coaching message or trainer command through runtimeContract.commandEndpoint.";
}

function buildKickrPayload(payload: KickrHookEvent, origin: string) {
  return {
    source: "kickr",
    timestamp: Date.now(),
    ...payload,
    message: getHookMessage(payload),
    instruction: getHookInstruction(payload),
    runtimeContract: getRuntimeContract(origin, payload),
  };
}

async function forwardToHermes(payload: KickrHookEvent, origin: string) {
  const baseUrl = process.env.HERMES_API_URL!.replace(/\/+$/, "");
  const apiKey = process.env.HERMES_API_KEY;
  const sessionId =
    process.env.HERMES_KICKR_SESSION_ID || "kickr-local-coach";

  const kickrPayload = buildKickrPayload(payload, origin);

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

function getHermesTargetUrl() {
  const baseUrl = process.env.HERMES_API_URL!.replace(/\/+$/, "");
  return `${baseUrl}/v1/runs`;
}

function getOpenClawTargetUrl() {
  return process.env.OPENCLAW_HOOKS_URL!;
}

async function forwardToOpenClaw(payload: KickrHookEvent, origin: string) {
  const url = process.env.OPENCLAW_HOOKS_URL!;
  const token = process.env.OPENCLAW_HOOKS_TOKEN;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(buildKickrPayload(payload, origin)),
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

    const origin =
      req.headers.get("origin") ||
      `${new URL(req.url).protocol}//${new URL(req.url).host}`;
    const target = hermesUrl ? "hermes" : "openclaw";
    const targetUrl = hermesUrl ? getHermesTargetUrl() : getOpenClawTargetUrl();
    const res = hermesUrl
      ? await forwardToHermes(payload, origin)
      : await forwardToOpenClaw(payload, origin);
    const responseText = await res.text();
    let responseJson: unknown = null;

    if (responseText) {
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        responseJson = null;
      }
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          error: `${target} hook returned ${res.status}`,
          target,
          targetUrl,
          status: res.status,
          response: responseJson ?? responseText.slice(0, 500),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      sent: true,
      target,
      targetUrl,
      status: res.status,
      response: responseJson ?? responseText.slice(0, 500),
    });
  } catch (error) {
    console.error("[agent-hooks] Failed to forward hook:", error);
    return NextResponse.json(
      { error: "Failed to forward agent hook" },
      { status: 500 }
    );
  }
}
