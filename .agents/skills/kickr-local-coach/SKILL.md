---
name: kickr-local-coach
description: Use when integrating OpenClaw, Hermes, Telegram, or another local LLM agent with this KICKR CORE 2 Next.js app for ride coaching, workout planning, rider memory, hooks, or trainer control through the app's local HTTP APIs.
---

# KICKR Local Coach

Use this skill when building or operating a local agent that coaches or controls rides through the KICKR CORE 2 Web Controller.

## If You Are An External Agent Pointed At This Repo

Do not operate from this file at runtime. Install the lean per-agent skill into your own workspace once, then operate from there:

1. Read [INSTALL.md](INSTALL.md).
2. Copy [`dist/agent-skill.hermes.md`](dist/agent-skill.hermes.md) or [`dist/agent-skill.openclaw.md`](dist/agent-skill.openclaw.md) into your agent's skills directory as instructed.
3. Do the one-time wiring in `references/<agent>-hooks.md` if not already done.
4. Stop reading this repo. Coaching turns should run entirely from the installed skill.

The rest of this document is for someone authoring or editing the skill itself, not for a running agent.

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
- Poll queued agent commands only while the browser tab has an active trainer connection.
- Forward app wakeups to OpenClaw/Hermes through `/api/agent/hooks/trigger` when hook env vars are configured.

## Local App Assumptions

Preferred base URL when Portless is running:

```txt
https://kickr.localhost
```

Discover it with:

```bash
portless get kickr
```

Fallback base URL when the app is run with plain `npm run dev`:

```txt
http://localhost:3000
```

Use a different host/port if the user says the Next.js dev server runs elsewhere. If an HTTPS client rejects the Portless certificate, either trust the Portless CA for that process or fall back to the direct localhost URL/port the dev server reports.

If `AGENT_COMMAND_TOKEN` is configured, external callers must include:

```txt
Authorization: Bearer <token>
```

## Integration Workflow

1. Read [references/api.md](references/api.md) before writing code that calls the KICKR app.
2. For Telegram slash commands, read [references/telegram.md](references/telegram.md).
3. For workout creation and “what should I ride today?” flows, read [references/workout-planning.md](references/workout-planning.md).
4. For future app-initiated wakeups, choose the adapter doc for the user's agent:
   - OpenClaw: [references/openclaw-hooks.md](references/openclaw-hooks.md)
   - Hermes: [references/hermes-hooks.md](references/hermes-hooks.md)
   Do not implement wakeups during Phase 1.
5. Keep all trainer changes as structured commands. Examples: set ERG watts, set resistance, send a message.
6. After a ride, summarize useful persistent learning into `riderProfile.memorySummary` through `PUT /api/rider`.

## Fresh Agent Discovery Script

When a fresh OpenClaw/Hermes agent is pointed at this repo, it should do exactly this before proposing or editing code:

1. Confirm the KICKR app base URL. Prefer `portless get kickr`, then `https://kickr.localhost`, then `http://localhost:3000`.
2. Read only:
   - this `SKILL.md`
   - `references/api.md`
   - `references/openclaw-hooks.md` if OpenClaw hooks are in scope
   - `references/hermes-hooks.md` if Hermes hooks are in scope
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
   - whether OpenClaw/Hermes hook setup appears configured, if hooks are in scope
5. Then implement only Phase 1 below, or stop with a concrete patch plan if asked not to edit.

Do not re-derive the architecture from scratch. Do not ask broad questions that this skill already answers.

## Phase 1: Agent-Only Integration

When asked to build the first OpenClaw/Hermes integration, do **not** edit the KICKR Next.js app. Treat it as a stable local service and implement only OpenClaw/Hermes-side behavior.

If the user's instruction is brief, such as “use this skill” or “follow Phase 1,” assume this complete task:

1. Read this skill and only the references needed for Phase 1.
2. Smoke-check:
   - `GET <base-url>/api/rider`
   - `GET <base-url>/api/agent/events?limit=5`
   - `POST <base-url>/api/agent/commands` with a `send_message` command
3. Implement or configure agent-side support for:
   - `/kickr_status`
   - `/kickr_message <text>`
   - `/kickr_set_erg <watts>`
4. Test that:
   - `/kickr_status` summarizes rider/live context
   - `/kickr_message` appears in the KICKR app UI
   - `/kickr_set_erg` queues a `set_erg_watts` command
   - a later ride snapshot reports the requested `activeTrainerMode`
5. If something is missing, report the smallest required change, but do not modify the KICKR repo.

Phase 1 goals:

1. Implement or document only these local agent commands:
   - `/kickr_status`
   - `/kickr_message`
   - `/kickr_set_erg`
2. Use only existing KICKR APIs:
   - `GET /api/rider`
   - `GET /api/agent/events?limit=5`
   - `POST /api/agent/commands` with `send_message`
   - `POST /api/agent/commands` with `set_erg_watts`
3. Smoke test agent -> KICKR:
   - read rider profile
   - read recent events
   - queue a `send_message`
   - optionally queue a low-watt ERG command if the user approves
   - verify ERG by reading a later `ride_snapshot.activeTrainerMode`, not only the queue response

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
2. The server route reads hook target env vars and picks an adapter.
3. The server forwards to the selected agent adapter target.
4. First app events: `ride_started`, `ride_ended`, `rider_feedback`, manual `coach_check`.

The route in `app/api/agent/hooks/trigger/route.ts` selects the adapter as follows:

- If `HERMES_API_URL` is set -> Hermes adapter -> `POST ${HERMES_API_URL}/v1/runs` with `{session_id, input, metadata}` and `Authorization: Bearer ${HERMES_API_KEY}`.
- Else if `OPENCLAW_HOOKS_URL` is set -> OpenClaw adapter -> `POST ${OPENCLAW_HOOKS_URL}` with the KICKR payload and `Authorization: Bearer ${OPENCLAW_HOOKS_TOKEN}`.
- Else -> `{skipped: true}`. The app must not crash.

Set **only one** backend at a time in `.env.local`. Hermes wins if both are set. **Always restart `next dev` after editing `.env.local`** — Next.js does not pick up env changes via hot reload.

Phase 2 setup is guided by the OpenClaw/Hermes agent, not guessed. First decide which adapter is in use.

### OpenClaw setup walkthrough

The OpenClaw agent should walk the user through:

1. Discover or ask for the OpenClaw gateway port and confirm hooks are enabled.
2. Generate or read a dedicated hook token (do not reuse gateway auth tokens).
3. Set the OpenClaw side: `hooks.enabled=true`, `hooks.path=/hooks`, `hooks.token=<token>`. Restart the OpenClaw gateway.
4. Tell the user to add to KICKR `.env.local`:
   ```
   OPENCLAW_HOOKS_URL=http://127.0.0.1:<openclaw-port>/hooks/kickr
   OPENCLAW_HOOKS_TOKEN=<same-token>
   ```
   And to **comment out or remove any `HERMES_API_URL`** so OpenClaw is selected.
5. Tell the user to restart the Next.js dev server.
6. Verify with `curl -X POST <kickr-base>/api/agent/hooks/trigger -H 'Content-Type: application/json' -d '{"event":"coach_check","sessionId":null}'`. Expect `{"sent":true,"target":"openclaw"}`.

Full details: [references/openclaw-hooks.md](references/openclaw-hooks.md).

### Hermes setup walkthrough

The Hermes agent should walk the user through:

1. In `~/.hermes/.env` set:
   ```
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<random secret>
   ```
2. Start the gateway: `hermes gateway`. Confirm it listens on `http://127.0.0.1:8642`.
3. Sanity check from a shell:
   ```
   curl -X POST http://127.0.0.1:8642/v1/runs \
     -H "Authorization: Bearer <API_SERVER_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"session_id":"kickr-local-coach","input":"ping"}'
   ```
4. Tell the user to add to KICKR `.env.local`:
   ```
   HERMES_API_URL=http://127.0.0.1:8642
   HERMES_API_KEY=<API_SERVER_KEY>
   HERMES_KICKR_SESSION_ID=kickr-local-coach
   ```
   And to **comment out or remove any `OPENCLAW_HOOKS_URL`** if it was previously set, to avoid confusion (Hermes wins, but a stale OpenClaw URL muddles diagnostics).
5. Tell the user to restart the Next.js dev server.
6. Verify with `curl -X POST <kickr-base>/api/agent/hooks/trigger -H 'Content-Type: application/json' -d '{"event":"coach_check","sessionId":null}'`. Expect `{"sent":true,"target":"hermes"}`.
7. If you still see `ECONNREFUSED 127.0.0.1:18789`, the Next.js process is still on the OpenClaw fallback — confirm `HERMES_API_URL` is in `.env.local` (not just `.env.example`) and that `next dev` was restarted.

Full details: [references/hermes-hooks.md](references/hermes-hooks.md).

Future trigger intelligence such as high-HR or cadence-collapse detection is still not implemented.

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
  OpenClaw: POST /hooks/<mapped-name> or /hooks/agent
  Hermes: use a Hermes-supported inbound mechanism or local relay; Hermes lifecycle hooks are not the same as inbound app webhooks
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
