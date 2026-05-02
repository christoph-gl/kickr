export type KickrHookEvent =
  | { event: "ride_started"; sessionId: string | null; snapshot?: unknown }
  | { event: "ride_ended"; sessionId: string | null; snapshot?: unknown }
  | { event: "rider_feedback"; sessionId: string | null; text: string; snapshot?: unknown }
  | { event: "coach_check"; sessionId: string | null; snapshot?: unknown }
  | { event: "plan_refresh"; sessionId: string | null; snapshot?: unknown };

export type OpenClawHookResult =
  | { sent: true }
  | { skipped: true }
  | { error: string };

export async function sendOpenClawHook(
  payload: KickrHookEvent
): Promise<OpenClawHookResult> {
  try {
    const res = await fetch("/api/agent/hooks/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await res.json().catch(() => null);
    if (!res.ok) {
      return { error: result?.error || "Failed to trigger OpenClaw hook" };
    }

    return result;
  } catch (error) {
    console.error("[openclaw-hooks] Failed to trigger hook:", error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function hookRideStarted(sessionId: string | null, snapshot?: unknown) {
  return sendOpenClawHook({ event: "ride_started", sessionId, snapshot });
}

export function hookRideEnded(sessionId: string | null, snapshot?: unknown) {
  return sendOpenClawHook({ event: "ride_ended", sessionId, snapshot });
}

export function hookRiderFeedback(
  sessionId: string | null,
  text: string,
  snapshot?: unknown
) {
  return sendOpenClawHook({ event: "rider_feedback", sessionId, text, snapshot });
}

export function hookCoachCheck(sessionId: string | null, snapshot?: unknown) {
  return sendOpenClawHook({ event: "coach_check", sessionId, snapshot });
}

export function hookPlanRefresh(sessionId: string | null, snapshot?: unknown) {
  return sendOpenClawHook({ event: "plan_refresh", sessionId, snapshot });
}
