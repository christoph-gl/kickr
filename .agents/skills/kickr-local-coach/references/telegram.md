# Telegram Command Ideas

Use Telegram commands as a thin conversation/control layer. Keep trainer control routed through the KICKR app API.

This is Phase 1 and should be implemented entirely in OpenClaw/Hermes. Do not edit the KICKR Next.js app for these commands.

## First-Cut Slash Commands

Implement only these first:

```txt
/kickr_status
/kickr_message Hold cadence steady
/kickr_set_erg 220
```

## Later Slash Commands

```txt
/kickr_start_coach
/kickr_stop_coach
/kickr_resistance 35
/kickr_plan_today
/kickr_analyze_last_ride
/kickr_update_memory
```

## Command Behavior

`/kickr_status`
- Read `GET /api/rider`.
- Read `GET /api/agent/events?limit=20`.
- Summarize connection state, latest telemetry, active mode, and current rider context.

`/kickr_set_erg 220`
- Queue `{"type":"set_erg_watts","watts":220,"reason":"Telegram command"}`.
- Then read `GET /api/agent/events?limit=10` and report whether a later `ride_snapshot.activeTrainerMode` shows `{"type":"erg","watts":220}`.
- If the command stays queued or fails with `Not connected`, tell the rider to keep exactly one KICKR browser tab connected to the trainer.

`/kickr_message ...`
- Queue `{"type":"send_message","text":"..."}`.

## Later Command Behavior

`/kickr_resistance 35`
- Queue `{"type":"set_resistance","percent":35,"reason":"Telegram command"}`.

`/kickr_plan_today`
- Start a short conversation to choose or create a workout. See `workout-planning.md`.

`/kickr_analyze_last_ride`
- Read `GET /api/sessions`.
- Analyze the newest completed ride.
- Mention limitations if no session is available.

`/kickr_update_memory`
- Read rider profile and recent sessions.
- Propose a concise `memorySummary` update.
- Use `PUT /api/rider` only after preserving the full existing profile object.

## Telegram Style

Be concise during rides. Prefer short coaching text. For direct commands, report what was queued and why.

Do not put Telegram bot code inside the KICKR Next.js app. Telegram belongs in OpenClaw/Hermes.
