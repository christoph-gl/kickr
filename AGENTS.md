# LLM AI Agents Guidelines (`AGENTS.md`)

This document provides instructions and context for any Large Language Model (LLM) or AI agent working on the KICKR CORE 2 Web Controller project.

## Fresh Public-URL Agent Behavior

If the user gives only the public GitHub URL, or says “try this again”, “implement it”, “first”, or similar after sharing the URL, assume they want the first useful setup path:

1. Clone/open the repo.
2. Install dependencies with `npm install`.
3. Start the KICKR app locally.
4. Verify `GET /api/rider`.
5. Install the lean Hermes/OpenClaw skill from `.agents/skills/kickr-local-coach/dist/` if the user is using an external coach agent.
6. Guide the user through browser Bluetooth connection and optional hook/env wiring.

Do not ask “implement what?” for this bootstrap request. Ask a narrow question only when needed, such as where to clone the repo or whether the user wants Hermes or OpenClaw hooks.

Fresh setup footguns:
- Do not run `cp .env.example .env.local`; `.env.example` contains optional placeholders, not runnable secrets.
- Do not set both Hermes and OpenClaw hook backends. Hermes wins if both are present.
- Do not append `-- --turbopack` to `npm run dev`; the script already includes Turbopack.
- Do not decide the server failed after a short wait. First Next.js compile can take 30-90 seconds.
- Probe `http://localhost:3000/api/rider` or `https://kickr.localhost/api/rider`, not just the root page.
- Web Bluetooth must be completed by the user in Chrome or Edge via UI button clicks.

## Context & Domain

This is a **Next.js (App Router) / React / TypeScript** application interacting directly with a Wahoo KICKR CORE 2 Smart Trainer and an external Bluetooth Heart Rate Monitor (HRM).
Communication relies heavily on the **Web Bluetooth API** (`navigator.bluetooth`).

### FTMS (Trainer) Constraints
- **FTMS Service UUID:** `0x1826`
- **Indoor Bike Data Characteristic UUID:** `0x2ad2`
- **Fitness Machine Control Point Characteristic UUID:** `0x2ad9`

### HRM Constraints
- **Heart Rate Service UUID:** `0x180d`
- **Heart Rate Measurement Characteristic UUID:** `0x2a37`

## Core Concepts to Retain

1. **Bluetooth Constraints:** 
   - Bluetooth connection requests MUST be triggered by user interactions (e.g. `onClick` of a button).
   - Web Bluetooth requires HTTPS or `localhost` (secure context) to function.
   - Disconnect handling is crucial (`gattserverdisconnected` events) for multiple parallel connections.
   - Device discovery should stay service-filtered: KICKR/trainer uses FTMS (`filters: [{ services: [0x1826] }]`), HRM uses Heart Rate (`filters: [{ services: [0x180d] }]`). Do not return to broad `acceptAllDevices: true` unless the user explicitly wants a troubleshooting mode.
2. **FTMS Specifics:**
   - **ERG Mode (Target Power):** Uses Opcode `0x05`. Sends watts as `int16`. Trainer auto-adjusts resistance based on cadence.
   - **Resistance Mode:** Uses Opcode `0x04`. Sends percentage as `int16`. Note: While the FTMS spec defines a resolution of `0.1` (so 100% = 1000), Wahoo trainers deviate from the spec and expect a direct `0-100` scale (100% = 100).
   - The trainer will drop the control link or fail to execute commands if `requestControl()` (Opcode `0x00`) or `reset()` (Opcode `0x01`) is missing during initialization.
3. **Data Decoding:**
   - The Indoor Bike Data parser requires reading a `flags` bitmask to determine exactly which values (cadence, power, speed, distance) are present in the byte array.
   - Heart rate is pulled primarily from the external HRM (`hr-client.ts`), but can be supplemented via the FTMS payload if the trainer provides it natively.
4. **Workout Player Engine:**
   - The app features a robust workout player (`components/workout-player.tsx`) that reads from `lib/workouts.ts`. 
   - Workouts are scaled against the loaded rider profile (FTP, MAP, AC, NM). `lib/profile.ts` contains the default seed profile, but runtime values are SQLite-backed.
   - The player handles automatic ERG mode adjustments as the timeline progresses.
   - The chart calculates real-time NP, TSS, and IF based on the loaded workout blocks.
   - **Screen Wake Lock:** Uses the `navigator.wakeLock` API to prevent the device from sleeping while a workout is playing. It re-requests the lock on `visibilitychange` to handle tab switching.
5. **Workout Imports (ZWO & AI):**
   - The app natively parses standard XML `.zwo` (Zwift) files directly in the browser via `DOMParser`.
   - The app can extract workouts from screenshots using the **Vercel AI SDK** and an image-capable multimodal model. The backend endpoint (`/api/extract-workout/route.ts`) expects `WORKOUT_IMAGE_EXTRACTOR_API_KEY` and `WORKOUT_IMAGE_EXTRACTOR_MODEL` in `.env.local` for screenshot imports only. It still accepts `AI_GATEWAY_API_KEY` and `AI_GATEWAY_MODEL` as compatibility fallbacks.
   - All other in-app LLM lanes share `LLM_CALLS_API_KEY` / `LLM_CALLS_MODEL` via `lib/llm-calls-env.ts`, with optional per-lane overrides and `AI_GATEWAY_*` as a legacy fallback.
6. **Live In-Ride LLM Lane:**
   - During rides, avoid the Hermes/OpenClaw wakeup -> callback -> command polling path for time-sensitive UI feedback. Use `POST /api/coach/live`, which calls a fast AI SDK model directly.
   - Configure `LIVE_COACH_API_KEY` and `LIVE_COACH_MODEL` for this lane, or rely on shared `LLM_CALLS_API_KEY` / `LLM_CALLS_MODEL` (then `AI_GATEWAY_*` as a legacy fallback). Do not use `WORKOUT_IMAGE_EXTRACTOR_*` for live coach. `LIVE_COACH_TIMEOUT_MS` defaults to 8000 so a slow provider does not stall the ride UI indefinitely.
   - For preplanned workouts, the current UI uses this lane as feedback-only. At Play from `0:00`, it sends `intent: "ride_start_summary"` with rider profile, HR zones, and remaining workout blocks. Every five minutes while playing, it sends `intent: "periodic_ride_check"` with rider profile, HR zones, latest sample, ride-so-far averages, 30-second telemetry snapshots, and the remaining workout.
   - For `ride_start_summary` and `periodic_ride_check`, the model is instructed to return `send_message` only, and the client does not apply trainer/workout commands from these periodic checks. Preplanned workout ERG targets remain owned by the workout timeline.
   - External agents are better suited for pre-ride planning, route/workout creation, post-ride summaries, and rider-profile/memory updates.
7. **Workout Builder and Post-Ride Summary LLM Lanes:**
   - `POST /api/workout-builder` creates an ERG workout from rider instructions, current Europe/Berlin date/time, the SQLite rider profile, and the last five saved ride summaries. It returns a draft workout and rationale; it must not persist the workout automatically. The browser shows **Save Track** for drafts the rider wants to keep permanently in `workouts/`.
   - Configure `WORKOUT_BUILDER_API_KEY` / `WORKOUT_BUILDER_MODEL` for this lane. It falls back through `RIDE_SUMMARY_API_KEY`, `LIVE_COACH_API_KEY`, `LLM_CALLS_API_KEY`, and `AI_GATEWAY_API_KEY`.
   - `POST /api/sessions` enriches finished rides with a structured LLM summary before SQLite persistence. The payload is derived in `lib/ride-summary.ts` from metrics, HR/power zone distributions, splits, aerobic decoupling, data quality, rider profile, and rider comments. It should not send raw telemetry as the primary prompt context.
   - Configure `RIDE_SUMMARY_API_KEY` / `RIDE_SUMMARY_MODEL` for this lane, or rely on `LLM_CALLS_*`. If no key is configured, saving still succeeds with `llmSummaryStatus: "skipped"`.
8. **SQLite Persistence:**
   - Runtime data lives in `.data/kickr.sqlite`, ignored by git.
   - `lib/db.ts` owns schema creation and persistence functions. Keep DB initialization lazy and server-side.
   - Current tables: `ride_sessions`, `ride_samples`, `agent_events`, `agent_commands`, `rider_profile`, and `monthly_summaries`.
   - The app still keeps localStorage fallback/backfill for old ride history, but new saved sessions go through `/api/sessions`.

## Local Agent / LLM Control Architecture

The architecture intentionally does **not** expose an MCP server. The browser remains the Bluetooth owner and the Next.js app exposes small local HTTP endpoints for local agents like OpenClaw or Hermes.

### Three layers, three audiences

| Layer | Lives in | Audience | Read when |
| --- | --- | --- | --- |
| **App internals** (FTMS, SQLite, Web Bluetooth, workout player) | `AGENTS.md`, `lib/`, `components/` | Someone editing the KICKR app itself | Code changes |
| **One-time setup** (env vars, gateway config, smoke tests) | `.agents/skills/kickr-local-coach/references/*.md` | Agent doing first-time install | Once per machine, plus troubleshooting |
| **Operating contract** (endpoints, command shapes, hook payloads, coaching loop) | `.agents/skills/kickr-local-coach/dist/agent-skill.<agent>.md` | The running agent | Every coaching turn |

External agents are expected to **install** the lean per-agent skill from `.agents/skills/kickr-local-coach/dist/` into their own workspace once, then operate without re-reading this repo. Install flow: [`.agents/skills/kickr-local-coach/INSTALL.md`](.agents/skills/kickr-local-coach/INSTALL.md). Authoring guidance for the skill itself: `.agents/skills/kickr-local-coach/SKILL.md`. Each `dist/agent-skill.*.md` carries a `kickr-skill-version` line; bump it when the operating contract changes so installed copies can detect drift.

Phase 1 is agent-only: do not edit the KICKR Next.js app; use the existing local APIs as a stable service.

### Base URL

When the app is started with Portless, prefer the stable project URL `https://kickr.localhost`. Discover it with `portless get kickr`. If Portless is not running or the HTTPS certificate is not trusted by the calling process, fall back to the direct dev-server URL such as `http://localhost:3000`.

### Browser Ownership
- The browser tab owns Web Bluetooth and sends FTMS commands.
- External agents should not attempt to talk directly to the trainer.
- The older `/api/agent/commands` and `/api/agent/events` routes still exist server-side, but the current UI no longer shows the Agent Controller card or polls the command inbox during normal operation.
- Do not document or build new behavior assuming a browser tab consumes `/api/agent/commands` unless you also add an explicit client surface for it.

### Agent Command Endpoint
- `POST /api/agent/commands` queues commands.
- `GET /api/agent/commands` consumes queued commands for the browser tab.
- `GET /api/agent/commands?consume=false` reads queued commands without consuming.
- If `AGENT_COMMAND_TOKEN` is set, external callers must send `Authorization: Bearer <token>`. Same-origin browser calls are allowed so the app can keep polling.

Supported command payloads:

```json
{"type":"set_erg_watts","watts":220,"reason":"HR is steady"}
{"type":"set_resistance","percent":35,"reason":"Free ride push"}
{"type":"send_message","text":"Hold this effort for two more minutes"}
{"type":"send_message","text":"Text only; do not speak this one","speak":false}
{"type":"request_rider_voice_feedback","prompt":"How does this effort feel?","durationSeconds":10}
{"type":"start_trainer"}
{"type":"stop_trainer"}
```

Use `set_erg_watts` and `set_resistance` as the canonical trainer-control commands. The app accepts `{"type":"set_trainer_mode","mode":"erg","targetWatts":220}` and `{"type":"set_trainer_mode","mode":"resistance","percent":35}` as compatibility fallbacks, but fresh agents should not invent new command shapes.

`request_rider_voice_feedback` is a short, visible rider mic window. For the in-app live coach lane, the browser records roughly 10 seconds of audio with `MediaRecorder` and sends it directly to the multimodal model instead of sending a speech transcript. Do not expect always-on listening.

### Agent Event / Context Endpoints
- `POST /api/agent/events` stores structured agent/ride events in SQLite.
- `GET /api/agent/events?limit=200` returns recent agent events, newest first.
- Ride snapshots include telemetry, active trainer mode, workout name, sample count, and the current `riderProfile`.
- After queueing a trainer command, verify a later `ride_snapshot.activeTrainerMode` changed as expected, not only that the command was queued.
- `GET /api/sessions` returns saved ride sessions with samples and metrics.
- `GET /api/rider` returns the current rider profile.
- `PUT /api/rider` updates the rider profile.

### Live Coaching vs Outbound Agent Wakeups
- Use `POST /api/coach/live` for in-ride, latency-sensitive app feedback. For preplanned workouts, `ride_start_summary` and `periodic_ride_check` are text-only and must not adapt the workout or trainer load.
- Keep Hermes/OpenClaw for deeper asynchronous work: initial route/workout planning, creating a workout from scratch, end-of-ride ingestion, and rider profile/memory adaptation.

### Outbound Agent Wakeups
- Browser/client code calls `POST /api/agent/hooks/trigger`.
- The route picks an adapter from server-only env vars. Set exactly one backend:
  - **Hermes** (preferred when Hermes API Server is enabled): `HERMES_API_URL`, `HERMES_API_KEY`, `HERMES_KICKR_SESSION_ID`. The route forwards to `${HERMES_API_URL}/v1/runs` with `Authorization: Bearer ${HERMES_API_KEY}` and a body of `{session_id, input, metadata}` where `metadata` carries the full KICKR payload.
  - **OpenClaw**: `OPENCLAW_HOOKS_URL`, `OPENCLAW_HOOKS_TOKEN`. The route forwards the KICKR payload to the mapped `/hooks/kickr` endpoint with `Authorization: Bearer ${OPENCLAW_HOOKS_TOKEN}`.
- If both are set, Hermes takes precedence. If neither is set, the route returns `{skipped: true}` and never throws.
- First supported wake events: `ride_started`, `ride_ended`, `rider_feedback`, manual `coach_check`. Prefer the live coach endpoint for rider feedback and manual coach checks during an active ride; keep these hook events for compatibility and non-urgent external-agent flows.
- `/api/agent/hooks/trigger` can confirm that Next.js forwarded the wakeup to Hermes/OpenClaw and report the selected target, local target URL, HTTP status, and any response body/run id. It cannot universally prove the agent finished processing. Treat a later queued `send_message`, trainer command, or event as the processing confirmation.
- Hook payloads include a compact `runtimeContract` with base URL, command endpoint, allowed command shapes, and fast-mode rules. The callback instruction is also embedded in the top-level `message` for OpenClaw mappings that only pass `message`, `event`, `sessionId`, and `snapshot`. Manual coach checks use `mode:"fast"` and include rolling telemetry plus rider profile essentials, so agents should not fetch repo/docs/history before giving a short cue.
- For OpenClaw, prefer a stable hook session (`openclaw config set hooks.defaultSessionKey kickr-local-coach`) and allowlist only the local KICKR callback command, for example `curl -sS -X POST http://localhost:*/api/agent/commands*`.
- `AGENT_CALLBACK_BASE_URL` can override the callback base URL when Hermes/OpenClaw cannot reach the URL inferred from the incoming request.
- Keep hook tokens out of client components and client-imported modules.
- Restart `next dev` after editing `.env.local`; Next.js does not pick up env changes via hot reload.
- Do not add high-HR, cadence-collapse, or power-target-missed triggers until the basic hook round trip works.

### Rider Profile
The rider profile is seeded from `DEFAULT_RIDER_PROFILE` and stored in SQLite. It currently includes:
- 4DP values: `nm`, `ac`, `map`, `ftp`
- `cTHR`
- HR zones with names, percentage labels, min/max BPM, and colors
- `age`
- `weightKg`
- `gender` (`male`, `female`, or unset)
- `memorySummary`

The settings cog in the app opens a modal for manual profile editing. Future LLM-generated ride summaries should update `memorySummary` or a future related table after a full ride, not during every telemetry snapshot.

### Important Future Agent Rules
- Keep LLM decisions as structured commands. Do not put FTMS byte encoding in prompts or agent glue.
- Store agent decisions and outcomes; this is the debugging trail for coaching behavior.
- Avoid high-frequency external-agent loops. Use `/api/coach/live` for sparse in-ride LLM decisions and let the app handle real-time trainer execution.
- Use `/api/rider`, `/api/sessions`, and `/api/agent/events` as the initial OpenClaw/Hermes context surface.
- Prefer adding new server routes or DB helpers over reading `.data/kickr.sqlite` directly from external scripts.

## UI/UX Rules

- Follow the existing **shadcn/ui** design system (e.g. `components/ui/button.tsx`, `dialog.tsx`).
- Tailwind CSS is used for all styling. Use standard layout primitives (`flex`, `gap-*`, `p-*`, `grid`).
- Emphasize visual feedback for hardware state (e.g., connected, connecting, disconnected, loading spinners, connection status dots).
- Validate state and throw sensible/alert errors if the Bluetooth hardware connection drops or fails.

## Future Development Roadmap

- **Simulation Mode:** Implement FTMS Opcode `0x11` (Set Indoor Bike Simulation Parameters) for simulated grade/incline. This requires sending simulated wind resistance and track gradient.
- **Workout Builder UI:** Create a drag-and-drop timeline UI where a user can manually construct custom workouts without needing to write JSON or import ZWO files.
- **Live Telemetry Charting:** Use a charting library (like Recharts, which is compatible with shadcn/ui) to plot actual live Power/Cadence/HR data as the ride progresses, overlaying it on top of the planned workout chart.
- **Save Workouts via Database:** Imported/saved workouts still use JSON files under `workouts/`; consider moving them behind SQLite later.
- **OpenClaw/Hermes Integration:** Phase 1 (agent installs the skill, reads context, queues commands) and Phase 2 (KICKR app -> agent wakeups via the dual adapter route) are wired for asynchronous planning and post-ride work. Live in-ride coaching now belongs to `/api/coach/live`.
