---
name: kickr-local-coach
description: Use when integrating OpenClaw, Hermes, Telegram, or another local LLM agent with this KICKR CORE 2 Next.js app for ride coaching, workout planning, rider memory, hooks, or trainer control through the app's local HTTP APIs.
---

# KICKR Local Coach

Use this skill when building or operating a local agent that coaches or controls rides through the KICKR CORE 2 Web Controller.

## Core Model

The browser owns Bluetooth. The agent never sends FTMS bytes and never talks directly to the trainer.

Agent responsibilities:
- Read rider context, sessions, workouts, and recent ride events from the app APIs.
- Decide on coaching messages or high-level trainer/workout commands.
- Queue commands through `/api/agent/commands`.
- Optionally receive wakeups through OpenClaw/Hermes hooks in a later phase when the app adds outbound hook support.
- Summarize post-ride learning into the rider profile memory.

App responsibilities:
- Connect to KICKR/HRM over Web Bluetooth.
- Decode telemetry.
- Execute FTMS commands.
- Persist sessions, samples, commands, events, and rider profile in SQLite.
- Poll queued agent commands while the browser tab is open.
- Forward app wakeups to OpenClaw/Hermes through `/api/agent/hooks/trigger` when hook env vars are configured.

## Local App Assumptions

Default base URL:

```txt
http://localhost:3000
```

Use a different host/port if the user says the Next.js dev server runs elsewhere.

If `AGENT_COMMAND_TOKEN` is configured, external callers must include:

```txt
Authorization: Bearer <token>
```

## Integration Workflow

1. Read [references/api.md](references/api.md) before writing code that calls the KICKR app.
2. For Telegram slash commands, read [references/telegram.md](references/telegram.md).
3. For workout creation and “what should I ride today?” flows, read [references/workout-planning.md](references/workout-planning.md).
4. For future app-initiated wakeups, read [references/openclaw-hooks.md](references/openclaw-hooks.md), but do not implement it during Phase 1.
5. Keep all trainer changes as structured commands. Examples: set ERG watts, set resistance, send a message.
6. After a ride, summarize useful persistent learning into `riderProfile.memorySummary` through `PUT /api/rider`.

## Fresh Agent Discovery Script

When a fresh OpenClaw/Hermes agent is pointed at this repo, it should do exactly this before proposing or editing code:

1. Confirm the KICKR app base URL, defaulting to `http://localhost:3000`.
2. Read only:
   - this `SKILL.md`
   - `references/api.md`
   - `references/openclaw-hooks.md` if hooks are in scope
   - `references/telegram.md` if Telegram is in scope
3. Smoke-check the app API:
   - `GET /api/rider`
   - `GET /api/agent/events?limit=5`
   - `GET /api/sessions`
4. Report a short status:
   - app reachable or not
   - rider profile reachable or not
   - recent events present or empty
   - whether `AGENT_COMMAND_TOKEN` appears required
   - whether OpenClaw hook setup appears configured
5. Then implement only Phase 1 below, or stop with a concrete patch plan if asked not to edit.

Do not re-derive the architecture from scratch. Do not ask broad questions that this skill already answers.

## Phase 1: OpenClaw-Only Integration

When asked to build the first OpenClaw/Hermes integration, do **not** edit the KICKR Next.js app. Treat it as a stable local service and implement only OpenClaw/Hermes-side behavior.

If the user's instruction is brief, such as “use this skill” or “follow Phase 1,” assume this complete task:

1. Read this skill and only the references needed for Phase 1.
2. Smoke-check:
   - `GET http://localhost:3000/api/rider`
   - `GET http://localhost:3000/api/agent/events?limit=5`
   - `POST http://localhost:3000/api/agent/commands` with a `send_message` command
3. Implement or configure OpenClaw/Hermes-side support for:
   - `/kickr_status`
   - `/kickr_message <text>`
   - `/kickr_set_erg <watts>`
4. Test that:
   - `/kickr_status` summarizes rider/live context
   - `/kickr_message` appears in the KICKR app UI
   - `/kickr_set_erg` queues a `set_erg_watts` command
5. If something is missing, report the smallest required change, but do not modify the KICKR repo.

Phase 1 goals:

1. Implement or document only these Telegram/OpenClaw commands:
   - `/kickr_status`
   - `/kickr_message`
   - `/kickr_set_erg`
2. Use only existing KICKR APIs:
   - `GET /api/rider`
   - `GET /api/agent/events?limit=5`
   - `POST /api/agent/commands` with `send_message`
   - `POST /api/agent/commands` with `set_erg_watts`
3. Smoke test OpenClaw -> KICKR:
   - read rider profile
   - read recent events
   - queue a `send_message`
   - optionally queue a low-watt ERG command if the user approves

Phase 1 non-goals:
- no edits to `app/`, `components/`, or `lib/` in the KICKR repo
- no KICKR app outbound hooks
- no Telegram-specific code in the KICKR app
- no `.env.local` changes in the KICKR repo
- no physiological trigger detection
- no workout player selection/start/pause/reset commands
- no full `/kickr_plan_today`
- no post-ride memory automation

## Phase 2: KICKR App Wakeups

The KICKR app includes the minimal outbound hook path:

1. Browser/client code calls `/api/agent/hooks/trigger`.
2. The server route reads `OPENCLAW_HOOKS_URL` and `OPENCLAW_HOOKS_TOKEN`.
3. The server forwards to the mapped OpenClaw hook.
4. First app events: `ride_started`, `ride_ended`, and manual `coach_check`.

Phase 2 setup is guided by the OpenClaw/Hermes agent, not guessed:

1. Discover or ask for the OpenClaw gateway port.
2. Confirm hooks are enabled in OpenClaw config.
3. Confirm or generate a dedicated hook token.
4. Guide the user to set `OPENCLAW_HOOKS_URL` and `OPENCLAW_HOOKS_TOKEN` in `.env.local`.
5. Tell the user to restart the Next.js dev server after changing `.env.local`.
6. Verify `POST /api/agent/hooks/trigger` reaches `/hooks/kickr`.

Read [references/openclaw-hooks.md](references/openclaw-hooks.md) for the exact setup checklist. Future trigger intelligence such as high-HR or cadence-collapse detection is still not implemented.

## Handling Prior Partial Attempts

If the repo contains partial OpenClaw/Hermes changes from an earlier attempt:

1. Do not automatically continue them.
2. Compare them against this skill's Phase 1 / Phase 2 split.
3. Keep compatible pieces only if they reduce work and preserve the same architecture.
4. Prefer a clean, small patch over repairing a broad partial implementation.
5. Never replace root project documentation with Telegram-only notes.

## Coaching Loop

For live coaching:

1. Read rider profile with `GET /api/rider`.
2. Read recent ride context with `GET /api/agent/events?limit=200`.
3. Decide whether to send text feedback or a trainer command.
4. Queue the result with `POST /api/agent/commands`.
5. Avoid rapid-fire changes; if you are running a loop, prefer event-triggered or low-frequency checks.

## Hook Direction

Use both directions clearly:

```txt
Agent / Telegram -> Next.js app
  POST /api/agent/commands

Next.js app -> OpenClaw / Hermes
  POST /hooks/<mapped-name> or /hooks/agent
```

Hooks are for waking the agent on meaningful events such as ride started, ride ended, rider feedback, sustained high HR, cadence collapse, or manual “coach me now.”

Hooks are Phase 2. Do not add them during Phase 1.

## Do Not

- Do not bypass the app and write Bluetooth code in the agent.
- Do not add Telegram-specific code to the KICKR app; Telegram belongs in OpenClaw/Hermes.
- Do not put FTMS opcodes in Telegram slash command handlers.
- Do not wake the LLM on every telemetry sample.
- Do not overwrite `.data/kickr.sqlite` directly from agent glue; use the app APIs unless the user explicitly asks for a DB maintenance task.
- Do not assume workouts are all in SQLite; current saved/imported workouts are still served by `/api/workouts`.
