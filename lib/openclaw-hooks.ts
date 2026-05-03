export type KickrHookMode = "fast" | "deep";

export type KickrHookEvent =
  | { event: "ride_started"; sessionId: string | null; snapshot?: unknown; mode?: KickrHookMode }
  | { event: "ride_ended"; sessionId: string | null; snapshot?: unknown; mode?: KickrHookMode }
  | { event: "rider_feedback"; sessionId: string | null; text: string; snapshot?: unknown; mode?: KickrHookMode }
  | { event: "coach_check"; sessionId: string | null; snapshot?: unknown; mode?: KickrHookMode }
  | { event: "plan_refresh"; sessionId: string | null; snapshot?: unknown; mode?: KickrHookMode };

export type AgentHookTarget = "hermes" | "openclaw";

export type AgentHookResult =
  | {
      sent: true;
      target: AgentHookTarget;
      targetUrl?: string;
      status?: number;
      response?: unknown;
    }
  | { skipped: true }
  | {
      error: string;
      target?: AgentHookTarget;
      targetUrl?: string;
      status?: number;
      response?: unknown;
    };

export async function sendOpenClawHook(
  payload: KickrHookEvent
): Promise<AgentHookResult> {
  try {
    const res = await fetch("/api/agent/hooks/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        error: result?.error || "Failed to trigger agent hook",
        target: result?.target,
        targetUrl: result?.targetUrl,
        status: result?.status,
        response: result?.response,
      };
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

export function hookCoachCheck(
  sessionId: string | null,
  snapshot?: unknown,
  mode: KickrHookMode = "fast"
) {
  return sendOpenClawHook({ event: "coach_check", sessionId, snapshot, mode });
}

export function hookPlanRefresh(sessionId: string | null, snapshot?: unknown) {
  return sendOpenClawHook({ event: "plan_refresh", sessionId, snapshot });
}
