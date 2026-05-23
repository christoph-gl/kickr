import {
  generateObject,
  type ModelMessage,
  getOpenRouterModel,
  openRouterApiKey,
  openRouterDefaultModel,
} from "@/lib/llm-calls-env";
import { z } from "zod";
import { NextResponse } from "next/server";
import type { AgentCommand } from "@/lib/agent";
import { makeAgentCommandId } from "@/lib/agent";

export const dynamic = "force-dynamic";

const liveCoachApiKey = process.env.LIVE_COACH_API_KEY || openRouterApiKey;

const liveCoachModelName =
  process.env.LIVE_COACH_MODEL || openRouterDefaultModel;

const liveCoachModel = getOpenRouterModel(liveCoachModelName);

const liveCoachTimeoutMs = Math.min(
  30_000,
  Math.max(1_000, Number(process.env.LIVE_COACH_TIMEOUT_MS || 8_000))
);
const adaptiveCoachTimeoutMs = Math.min(
  30_000,
  Math.max(liveCoachTimeoutMs, Number(process.env.ADAPTIVE_COACH_TIMEOUT_MS || 15_000))
);

const LiveCoachActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("none"),
    reason: z.string().optional().describe("Brief internal reason for taking no action."),
  }),
  z.object({
    action: z.literal("send_message"),
    text: z
      .string()
      .min(1)
      .describe("Short rider-facing cue to display when action is send_message."),
    reason: z.string().optional().describe("Brief internal reason for the chosen action."),
    speak: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("set_erg_watts"),
    watts: z
      .number()
      .describe("ERG target watts to apply immediately when action is set_erg_watts."),
    text: z
      .string()
      .optional()
      .describe("Short rider-facing explanation to display when this changes trainer load."),
    reason: z.string().optional().describe("Brief internal reason for the chosen action."),
  }),
  z.object({
    action: z.literal("set_resistance"),
    percent: z
      .number()
      .describe("Resistance percent from 0 to 100 when action is set_resistance."),
    text: z
      .string()
      .optional()
      .describe("Short rider-facing explanation to display when this changes trainer load."),
    reason: z.string().optional().describe("Brief internal reason for the chosen action."),
  }),
  z.object({
    action: z.literal("set_workout_plan"),
    leadSeconds: z
      .number()
      .optional()
      .describe("Delay before a workout-plan splice takes effect."),
    blocks: z
      .array(
        z.object({
          durationSeconds: z.number(),
          targetPower: z.number(),
        })
      )
      .min(1)
      .describe("Upcoming workout blocks that replace the current remaining workout plan."),
    text: z
      .string()
      .optional()
      .describe("Short rider-facing explanation to display when this changes the adaptive plan."),
    reason: z.string().optional().describe("Brief internal reason for the chosen action."),
  }),
]);

const WorkoutPlanEditSchema = z.object({
  leadSeconds: z
    .number()
    .optional()
    .describe("Delay before the workout-plan splice takes effect."),
  blocks: z
    .array(
      z.object({
        durationSeconds: z.number(),
        targetPower: z.number(),
      })
    )
    .describe("Upcoming workout blocks that replace the current remaining workout plan."),
  reason: z.string().optional().describe("Brief internal reason for the workout edit."),
});

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function toCommand(action: z.infer<typeof LiveCoachActionSchema>): AgentCommand | null {
  const reason = action.reason?.trim() || "Live coach check";

  if (action.action === "send_message") {
    const text = action.text?.trim();
    if (!text) return null;
    return {
      id: makeAgentCommandId(),
      type: "send_message",
      text: text.slice(0, 180),
      speak: action.speak,
      reason,
    };
  }

  if (action.action === "set_erg_watts" && typeof action.watts === "number") {
    return {
      id: makeAgentCommandId(),
      type: "set_erg_watts",
      watts: clampNumber(action.watts, 50, 500),
      reason,
    };
  }

  if (action.action === "set_resistance" && typeof action.percent === "number") {
    return {
      id: makeAgentCommandId(),
      type: "set_resistance",
      percent: clampNumber(action.percent, 0, 100),
      reason,
    };
  }

  if (action.action === "set_workout_plan" && action.blocks?.length) {
    const blocks = action.blocks.slice(0, 30).map((block) => ({
      durationSeconds: clampNumber(block.durationSeconds, 30, 600),
      targetPower: clampNumber(block.targetPower, 50, 500),
    }));

    return {
      id: makeAgentCommandId(),
      type: "set_workout_plan",
      horizonSeconds: Math.min(
        30 * 60,
        Math.max(
          60,
          blocks.reduce((total, block) => total + block.durationSeconds, 0)
        )
      ),
      leadSeconds: clampNumber(action.leadSeconds ?? 5, 0, 60),
      blocks,
      reason,
    };
  }

  return null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isTimeoutError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const record = getRecord(current);
    const message =
      current instanceof Error
        ? current.message
        : typeof record?.message === "string"
          ? record.message
          : "";
    const name =
      current instanceof Error
        ? current.name
        : typeof record?.name === "string"
          ? record.name
          : "";

    if (
      name === "TimeoutError" ||
      name === "AbortError" ||
      (typeof record?.code === "string" && record.code === "ABORT_ERR") ||
      (typeof record?.code === "number" && record.code === 20) ||
      message.toLowerCase().includes("timeout") ||
      message.toLowerCase().includes("aborted") ||
      message.toLowerCase().includes("aborted due to timeout")
    ) {
      return true;
    }

    current = record?.cause;
    if (!current) return false;
  }

  return false;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function planEditToAction(plan: z.infer<typeof WorkoutPlanEditSchema>) {
  return {
    action: "set_workout_plan" as const,
    leadSeconds: plan.leadSeconds ?? 0,
    blocks: plan.blocks,
    reason: plan.reason || "Workout plan edited by live coach.",
  };
}

function compactNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function compactString(value: unknown, maxLength = 220) {
  return typeof value === "string" ? value.slice(0, maxLength) : null;
}

function compactConversationHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-6)
    .map((turn) => {
      const record = getRecord(turn);
      if (!record) return null;
      const role = record.role === "assistant" ? "assistant" : "user";
      return {
        role,
        text: compactString(record.text, 180),
        command: compactString(record.command, 80),
        execution:
          record.execution === "applied" ||
          record.execution === "failed" ||
          record.execution === "none"
            ? record.execution
            : undefined,
      };
    })
    .filter(Boolean);
}

function compactWorkout(value: unknown) {
  const workout = getRecord(value);
  if (!workout) return null;
  const blocks = Array.isArray(workout.remainingBlocks)
    ? workout.remainingBlocks
        .slice(0, 30)
        .map((block) => {
          const record = getRecord(block);
          if (!record) return null;
          return {
            offsetSeconds: compactNumber(record.offsetSeconds),
            durationSeconds: compactNumber(record.durationSeconds),
            targetPower: compactNumber(record.targetPower),
            isCurrent: Boolean(record.isCurrent),
          };
        })
        .filter(Boolean)
    : [];

  return {
    workoutName: compactString(workout.workoutName, 120),
    isPlaying: Boolean(workout.isPlaying),
    elapsedSeconds: compactNumber(workout.elapsedSeconds),
    remainingSeconds: compactNumber(workout.remainingSeconds),
    currentTargetPower: compactNumber(workout.currentTargetPower),
    remainingBlocks: blocks,
    truncated: Boolean(workout.truncated),
  };
}

function compactSnapshot(value: unknown) {
  const snapshot = getRecord(value);
  if (!snapshot) return null;
  const latestSample = getRecord(snapshot.latestSample);
  const riderProfile = getRecord(snapshot.riderProfile);
  const fourDP = getRecord(riderProfile?.fourDP);
  const rolling = getRecord(snapshot.rolling);
  const adaptiveRideIntent = getRecord(snapshot.adaptiveRideIntent);
  const rollingSnapshots = Array.isArray(rolling?.snapshots)
    ? rolling.snapshots
        .slice(-20)
        .map((item) => {
          const record = getRecord(item);
          if (!record) return null;
          return {
            offsetSeconds: compactNumber(record.offsetSeconds),
            durationSeconds: compactNumber(record.durationSeconds),
            avgPowerW: compactNumber(record.avgPowerW),
            avgCadenceRpm: compactNumber(record.avgCadenceRpm),
            avgHeartRateBpm: compactNumber(record.avgHeartRateBpm),
            targetPower: compactNumber(record.targetPower),
            hrZone: compactString(record.hrZone, 80),
          };
        })
        .filter(Boolean)
    : [];
  const rideSoFar = getRecord(rolling?.rideSoFar);

  return {
    generatedAtIso: compactString(snapshot.generatedAtIso, 40),
    connectionState: compactString(snapshot.connectionState, 40),
    hrConnectionState: compactString(snapshot.hrConnectionState, 40),
    activeTrainerMode: snapshot.activeTrainerMode ?? null,
    adaptivePlanHorizonSeconds: compactNumber(snapshot.adaptivePlanHorizonSeconds),
    adaptiveRideIntent: adaptiveRideIntent
      ? {
          presetId: compactString(adaptiveRideIntent.presetId, 40),
          label: compactString(adaptiveRideIntent.label, 80),
          durationMinutes: compactNumber(adaptiveRideIntent.durationMinutes),
          prompt: compactString(adaptiveRideIntent.prompt, 500),
          riderText: compactString(adaptiveRideIntent.riderText, 500),
        }
      : null,
    workoutName: compactString(snapshot.workoutName, 120),
    latestSample: latestSample
      ? {
          powerW: compactNumber(latestSample.powerW),
          cadenceRpm: compactNumber(latestSample.cadenceRpm),
          heartRateBpm: compactNumber(latestSample.heartRateBpm),
        }
      : null,
    rolling: rolling
      ? {
          sampleWindowSeconds: compactNumber(rolling.sampleWindowSeconds),
          rideSoFar: rideSoFar
            ? {
                elapsedSeconds: compactNumber(rideSoFar.elapsedSeconds),
                avgPowerW: compactNumber(rideSoFar.avgPowerW),
                avgCadenceRpm: compactNumber(rideSoFar.avgCadenceRpm),
                avgHeartRateBpm: compactNumber(rideSoFar.avgHeartRateBpm),
              }
            : null,
          snapshots: rollingSnapshots,
        }
      : null,
    currentHrZone: snapshot.currentHrZone ?? null,
    riderProfile: riderProfile
      ? {
          ftp: compactNumber(fourDP?.ftp ?? riderProfile.ftp),
          map: compactNumber(fourDP?.map ?? riderProfile.map),
          ac: compactNumber(fourDP?.ac ?? riderProfile.ac),
          nm: compactNumber(fourDP?.nm ?? riderProfile.nm),
          cTHR: compactNumber(riderProfile.cTHR),
          age: compactNumber(riderProfile.age),
          weightKg: compactNumber(riderProfile.weightKg),
          gender: compactString(riderProfile.gender, 40),
          hrZones: Array.isArray(riderProfile.hrZones)
            ? riderProfile.hrZones
                .map((zone) => {
                  const record = getRecord(zone);
                  if (!record) return null;
                  return {
                    id: compactString(record.id, 20),
                    name: compactString(record.name, 80),
                    percentageRange: compactString(record.percentageRange, 40),
                    minBpm: compactNumber(record.minBpm),
                    maxBpm: compactNumber(record.maxBpm),
                  };
                })
                .filter(Boolean)
            : [],
          memorySummary: compactString(riderProfile.memorySummary, 260),
        }
      : null,
    lastAgentEntry: snapshot.lastAgentEntry ?? null,
    remainingWorkout: compactWorkout(snapshot.remainingWorkout),
  };
}

function isLikelyWorkoutPlanEdit(riderText: string, snapshot: ReturnType<typeof compactSnapshot>) {
  if (!riderText.trim() || !snapshot?.remainingWorkout?.remainingBlocks.length) return false;
  const text = riderText.toLowerCase();
  const hasPlanScope =
    /\b(workout|ride|plan|track|remaining|rest|whole|all|next|more|again)\b/.test(text);
  const hasPlanVerb =
    /\b(reduce|decrease|lower|drop|cut|increase|raise|add|harder|easier|compress|shorten|extend|stretch|intensity|effort|power|watts?)\b/.test(
      text
    );
  return hasPlanScope && hasPlanVerb;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = (await request.json()) as Record<string, unknown>;

  const snapshot = body?.snapshot ?? null;
  const intent =
    body?.intent === "adaptive_plan" ||
    body?.intent === "periodic_ride_check" ||
    body?.intent === "ride_start_summary"
      ? body.intent
      : "coach_check";
  const riderText = typeof body?.riderText === "string" ? body.riderText : "";
  const conversationHistory = compactConversationHistory(body?.conversationHistory);
  const compactedSnapshot = compactSnapshot(snapshot);

  if (!liveCoachApiKey) {
    return NextResponse.json(
      {
        error:
          "No live coach API key configured. Set LIVE_COACH_API_KEY, OPENROUTER_API_KEY, or LLM_CALLS_API_KEY.",
      },
      { status: 503 }
    );
  }

  try {
    if (isLikelyWorkoutPlanEdit(riderText, compactedSnapshot)) {
      const result = await generateObject({
        model: liveCoachModel,
        apiKey: liveCoachApiKey,
        abortSignal: AbortSignal.timeout(liveCoachTimeoutMs),
        maxRetries: 1,
        schema: WorkoutPlanEditSchema,
        system: `You edit the remaining workout track for a KICKR trainer web app.
Return only the replacement remaining workout blocks.
Use the current remainingWorkout.remainingBlocks as the source plan.
Preserve block order unless the rider asks to compress, shorten, extend, or otherwise reshape duration.
For "reduce/decrease/lower/cut intensity/effort/power 10%" multiply each current remaining targetPower by 0.9 and keep durations.
For "reduce/decrease/lower/cut 10% more" apply another 0.9 multiplier to the current remaining blocks you receive now.
For "increase/raise/add/harder 10%" multiply by 1.1 and keep durations.
"More", "again", and "another" refer to the previous rider request in conversationHistory, but the math must be applied to the current remaining blocks.
For compression to N minutes, scale durations to N*60 seconds while preserving relative proportions; keep each block at least 30 seconds.
Use leadSeconds 0 for rider-requested edits.
At most 30 blocks. At most 30 minutes total. Keep whole watts.`,
        prompt: JSON.stringify({
          riderText,
          conversationHistory,
          remainingWorkout: compactedSnapshot?.remainingWorkout,
        }),
      });

      const action = planEditToAction(result.object);
      const command = toCommand(action);

      return NextResponse.json({
        model: liveCoachModelName,
        mode: "workout_plan_edit",
        durationMs: Date.now() - startedAt,
        action,
        command,
      });
    }

    const userContent: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              intent,
              executionContract: {
                returnedActionWillBeAppliedByBrowser: true,
                sendMessageDoesNotChangeTrainerLoad: true,
                setErgWattsChangesTrainerLoad: true,
                setResistanceChangesTrainerLoad: true,
                setWorkoutPlanChangesUpcomingWorkoutTargets: true,
              },
              conversationHistory,
              riderText: riderText || null,
              snapshot: compactedSnapshot,
            }),
          },
        ],
      },
    ];

    const result = await generateObject({
      model: liveCoachModel,
      apiKey: liveCoachApiKey,
      abortSignal: AbortSignal.timeout(
        intent === "adaptive_plan" ? adaptiveCoachTimeoutMs : liveCoachTimeoutMs
      ),
      maxRetries: 1,
      schema: LiveCoachActionSchema,
      system: `You are the low-latency live ride coach inside a KICKR trainer web app.
Return one structured action only. This structured action is executed by the browser as the trainer-control tool call.
Available executable actions:
- set_erg_watts: immediately changes ERG target watts.
- set_resistance: immediately changes trainer resistance percent.
- set_workout_plan: replaces the upcoming workout track after leadSeconds.
- send_message: rider-facing text only; it does not change trainer load.
When action is send_message, include a non-empty text field with the exact rider-facing words to display.
Do not use send_message when the rider clearly asks to change watts or resistance and the snapshot says the trainer is connected.
For coach_check without a specific rider request, prefer a short rider-facing cue under 12 words unless telemetry clearly calls for ERG or resistance adjustment.
For ride_start_summary during a preplanned workout, return send_message only. Summarize the course the rider is starting: duration, target-power pattern, likely purpose, and one simple focus cue. Keep it under 35 words. Do not return set_workout_plan, set_erg_watts, or set_resistance for ride_start_summary.
For periodic_ride_check during a preplanned workout, return send_message only. Use the rider profile, heart-rate zones, 30-second rolling snapshots, and remainingWorkout to give one short motivating cue under 18 words. Do not return set_workout_plan, set_erg_watts, or set_resistance for periodic_ride_check.
When rider text is included, treat it as the latest chat message from the rider.
Use set_workout_plan for requests that mention the workout, track, plan, remaining work, rest of workout, next N minutes, compressing duration, stretching duration, or scaling effort over time.
snapshot.remainingWorkout.remainingBlocks is the source of truth for the remaining track. It starts at the rider's current point with offsetSeconds 0 and includes durationSeconds and targetPower for each block.
For "decrease effort 10% for the rest of the workout", preserve the remaining block durations and return each targetPower multiplied by 0.9, rounded to whole watts.
For "increase effort 10% for the rest of the workout", preserve durations and multiply each targetPower by 1.1.
For "compress the rest of the workout to 10 minutes", preserve block order and relative duration proportions, scale total duration to 600 seconds, keep every returned block at least 30 seconds, and merge or omit tiny adjacent blocks if needed.
For "make the next 10 minutes easier/harder", return blocks covering about 600 seconds and preserve the rest only when it fits within the 30 block and 30 minute command limit.
set_workout_plan accepts at most 30 blocks and at most 30 minutes total. If the rider asks to rewrite more than that, apply the best next 30 minutes and explain the scope briefly in reason.
Use leadSeconds 0 to 5 for rider-requested changes so the UI reflects the new plan immediately or near-immediately.
If intent is adaptive_plan, use snapshot.adaptiveRideIntent as the ride goal. Return set_workout_plan with 5 to 10 blocks covering roughly the requested horizonSeconds. The plan should usually change target watts when telemetry supports a change, not merely describe one. Respect requested duration, heart-rate goals, hard/easy intent, and rider notes over generic workout structure. Include a short rider-facing text field under 18 words explaining what changed and why. If the plan is effectively unchanged, say that it is holding steady and why. Keep reason under 120 characters.
Never mention implementation details, APIs, agents, hooks, or JSON to the rider.
If the rider reports pain, dizziness, chest pain, or wants to stop, lower intensity or stop escalating and send a safety-first cue.`,
      messages: userContent,
    });

    const command = toCommand(result.object);

    return NextResponse.json({
      model: liveCoachModelName,
      mode: "live_coach",
      durationMs: Date.now() - startedAt,
      action: result.object,
      command,
    });
  } catch (error) {
    const message = getErrorMessage(error);

    if (isTimeoutError(error)) {
      console.warn(
        `[live-coach] Timed out after ${Date.now() - startedAt}ms; no command applied.`
      );
      return NextResponse.json({
        model: liveCoachModelName,
        degraded: true,
        durationMs: Date.now() - startedAt,
        error: "Live coach timed out.",
        action: { action: "none", reason: "Live coach timed out; no local command fallback." },
        command: null,
      });
    }

    console.error("[live-coach] Failed to generate live coach action:", error);
    return NextResponse.json(
      {
        model: liveCoachModelName,
        degraded: true,
        durationMs: Date.now() - startedAt,
        error: message,
        action: { action: "none", reason: "Live coach failed; no local command fallback." },
        command: null,
      },
      { status: 200 }
    );
  }
}
