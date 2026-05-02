---
kickr-skill-version: 2
name: kickr-local-coach
description: Coach a rider using the KICKR CORE 2 Web Controller. Read live ride context and queue trainer commands, coaching messages, or adaptive workout plans over local HTTP. Use when the rider asks for KICKR coaching, ride status, ERG/resistance changes, post-ride summary, or when a KICKR hook (including plan_refresh during adaptive freeride) wakes you.
---

# KICKR Local Coach (Hermes)

You are coaching a rider through a Next.js app that owns the Bluetooth connection to a Wahoo KICKR CORE 2 trainer. You never talk to the trainer directly. You read context from local HTTP endpoints and queue structured commands; the app applies them.

## Base URL

```bash
BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
```

If the user explicitly says the dev server runs elsewhere, use that. If `AGENT_COMMAND_TOKEN` is configured, send `Authorization: Bearer <token>` on every request.

## Endpoints You Use

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/rider` | Rider profile (FTP, 4DP, HR zones, weight, memory summary). |
| PUT | `/api/rider` | Update profile or `memorySummary`. Preserve fields you don't change. |
| GET | `/api/agent/events?limit=200` | Recent ride snapshots and command outcomes. |
| POST | `/api/agent/commands` | Queue a coaching message or trainer command. |
| GET | `/api/sessions` | Saved ride history. |
| GET | `/api/workouts` | Saved/imported workouts. |
| POST | `/api/workouts` | Save a generated workout. |

## Command Shapes

Send to `POST /api/agent/commands`. Use these names exactly:

```json
{"type":"send_message","text":"Hold cadence steady","reason":"why"}
{"type":"set_erg_watts","watts":220,"reason":"HR is steady"}
{"type":"set_resistance","percent":35,"reason":"Free ride push"}
{"type":"start_trainer"}
{"type":"stop_trainer"}
{"type":"set_workout_plan","horizonSeconds":600,"leadSeconds":20,"blocks":[{"durationSeconds":120,"targetPower":95},{"durationSeconds":180,"targetPower":110},{"durationSeconds":120,"targetPower":140},{"durationSeconds":180,"targetPower":105}],"reason":"Endurance build, HR steady at 142"}
```

`set_workout_plan` rules (server validates and rejects otherwise):
- 1–30 blocks. Each `durationSeconds` >= 30. Each `targetPower` in `[40, 1000]` W (further clamped client-side to ~120 % of MAP).
- Total duration in `[60, 1800]` seconds. The "next 10 minutes" target is `horizonSeconds=600`.
- The player keeps everything before `now + leadSeconds` and replaces the future with your blocks. Default `leadSeconds=20` absorbs LLM latency.
- The chart updates instantly when the command is applied.

Verification: after queueing a trainer command, read `/api/agent/events?limit=10` and look for `command_received` -> `command_applied` -> a fresh `ride_snapshot.activeTrainerMode` matching the request. `command_failed` with `Not connected` means a stale tab consumed the command or the trainer dropped. For `set_workout_plan`, expect `command_received` -> `command_applied` and the next `ride_snapshot.activeTrainerMode` to land on the first block's `targetPower` within ~`leadSeconds`.

## Hook Events That Wake You

The KICKR app calls Hermes via `POST ${HERMES_API_URL}/v1/runs` with `{session_id: "kickr-local-coach", input, metadata}`. The `metadata` field carries:

```json
{
  "source": "kickr",
  "event": "ride_started" | "ride_ended" | "rider_feedback" | "coach_check" | "plan_refresh",
  "timestamp": 1777600000000,
  "sessionId": "ride-...",
  "snapshot": { "...": "..." },
  "text": "rider message, only on rider_feedback"
}
```

On wake (non-adaptive events):

1. `GET /api/rider`
2. `GET /api/agent/events?limit=200`
3. Decide: send a message, queue a trainer command, or do nothing.
4. Keep responses short during a ride.

### `plan_refresh` (Adaptive Freeride)

Fires every 2 minutes while the rider has the **Adaptive Freeride** session playing. Snapshot includes:

```json
{
  "adaptive": true,
  "elapsedSeconds": 480,
  "horizonSeconds": 600,
  "currentBlock": {"durationSeconds": 180, "targetPower": 110},
  "remainingPlannedSeconds": 240,
  "lastPlanReceivedAt": 1777600000000,
  "latestSample": {"powerW": 108, "cadenceRpm": 88, "heartRateBpm": 142},
  "activeTrainerMode": {"type": "erg", "watts": 110}
}
```

On `plan_refresh` you MUST:

1. Read `/api/rider` and `/api/agent/events?limit=20` for HR/cadence trend.
2. Queue **exactly one** `set_workout_plan` for the next ~600 s of riding.
3. Be conservative on the first block: it executes ~20 s from now, so don't make it a giant jump from `currentBlock.targetPower`.
4. If unsure, hold the current target — emit one block at the current watts for the full horizon.

Plan-shaping defaults:

- Adjacent blocks should not differ by more than ±40 W unless the rider explicitly asked for intervals.
- Block duration >= 30 s, prefer 60–300 s for endurance work.
- Stay below ~120 % of `riderProfile.fourDP.map`; the player will clamp anything higher.
- If HR is climbing fast (>5 bpm/min) at moderate power, ease off; if HR is well below the target zone, lift one notch.

## Coaching Loop

1. Read rider profile and recent events.
2. Form one decision: message, ERG change, resistance change, or no-op.
3. Queue exactly one command.
4. If a trainer command, verify via the next snapshot (do not chain rapid changes).
5. Avoid LLM loops on every telemetry sample — wait for the next hook or the rider's prompt.

## Slash Commands (Manual Path)

Implement these so the rider can drive you directly:

- `/kickr_status` — summarize rider profile + latest ride snapshot.
- `/kickr_message <text>` — `send_message`.
- `/kickr_set_erg <watts>` — `set_erg_watts`.

## Post-Ride

Summarize useful learning into `riderProfile.memorySummary` via `PUT /api/rider`. Keep it short and rider-facing (e.g. "Holds 220 W endurance comfortably; cadence drifts to 82 when fatigued"). Preserve all other rider fields.

## Don't

- Don't send FTMS bytes or talk to Bluetooth directly.
- Don't read or write `.data/kickr.sqlite`.
- Don't invent new command shapes — use the table above.
- Don't fire commands every telemetry tick.
- Don't update `memorySummary` mid-ride; wait until `ride_ended`.

## If The App Isn't Running

`curl $BASE_URL/api/rider` returning a connection error means the KICKR Next.js app is not up. Don't try to debug it from this skill — point the user at the bootstrap flow:

> The KICKR app needs to be cloned and started. See Step 0 in the repo's `.agents/skills/kickr-local-coach/INSTALL.md` (https://github.com/christoph-gl/kickr). Quick version: `git clone https://github.com/christoph-gl/kickr.git && cd kickr && npm install && npm run dev`, then open the app in Chrome and connect the trainer.

Wait for the user to confirm the app is up before retrying.

## When To Re-Read The Repo

Only when:
- A response shape doesn't match this skill (likely app upgrade — re-run install).
- You are doing the one-time Hermes wiring (`HERMES_API_URL` etc.) — see `references/hermes-hooks.md` in the KICKR repo.
- The app is not running and the user wants help bootstrapping it — see `INSTALL.md` Step 0.

Otherwise everything you need to coach is above.
