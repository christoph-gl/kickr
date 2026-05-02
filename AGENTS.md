# LLM AI Agents Guidelines (`AGENTS.md`)

This document provides instructions and context for any Large Language Model (LLM) or AI agent working on the KICKR CORE 2 Web Controller project.

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
   - The app can extract workouts from screenshots using the **Vercel AI SDK** and an image-capable multimodal model. The backend endpoint (`/api/extract-workout/route.ts`) expects `WORKOUT_IMAGE_EXTRACTOR_API_KEY` and `WORKOUT_IMAGE_EXTRACTOR_MODEL` in `.env.local` for screenshot imports. It still accepts `AI_GATEWAY_API_KEY` and `AI_GATEWAY_MODEL` as compatibility fallbacks.
6. **SQLite Persistence:**
   - Runtime data lives in `.data/kickr.sqlite`, ignored by git.
   - `lib/db.ts` owns schema creation and persistence functions. Keep DB initialization lazy and server-side.
   - Current tables: `ride_sessions`, `ride_samples`, `agent_events`, `agent_commands`, and `rider_profile`.
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
- Agent control is applied by polling `/api/agent/commands` from the browser and then calling existing KICKR client methods.
- Polling currently happens every 3 seconds only from a tab whose trainer connection state is `connected`. Repeated `GET /api/agent/commands` lines in dev logs are expected during an active connection.
- Disconnected or stale browser tabs must not consume trainer commands. If command execution looks wrong, compare `command_received` / `command_applied` / `command_failed` session ids with the latest `ride_snapshot.sessionId`.

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
{"type":"start_trainer"}
{"type":"stop_trainer"}
```

Use `set_erg_watts` and `set_resistance` as the canonical trainer-control commands. The app accepts `{"type":"set_trainer_mode","mode":"erg","targetWatts":220}` and `{"type":"set_trainer_mode","mode":"resistance","percent":35}` as compatibility fallbacks, but fresh agents should not invent new command shapes.

### Agent Event / Context Endpoints
- `POST /api/agent/events` stores structured agent/ride events in SQLite.
- `GET /api/agent/events?limit=200` returns recent agent events, newest first.
- Ride snapshots include telemetry, active trainer mode, workout name, sample count, and the current `riderProfile`.
- After queueing a trainer command, verify a later `ride_snapshot.activeTrainerMode` changed as expected, not only that the command was queued.
- `GET /api/sessions` returns saved ride sessions with samples and metrics.
- `GET /api/rider` returns the current rider profile.
- `PUT /api/rider` updates the rider profile.

### Outbound Agent Wakeups
- Browser/client code calls `POST /api/agent/hooks/trigger`.
- The route picks an adapter from server-only env vars. Set exactly one backend:
  - **Hermes** (preferred when Hermes API Server is enabled): `HERMES_API_URL`, `HERMES_API_KEY`, `HERMES_KICKR_SESSION_ID`. The route forwards to `${HERMES_API_URL}/v1/runs` with `Authorization: Bearer ${HERMES_API_KEY}` and a body of `{session_id, input, metadata}` where `metadata` carries the full KICKR payload.
  - **OpenClaw**: `OPENCLAW_HOOKS_URL`, `OPENCLAW_HOOKS_TOKEN`. The route forwards the KICKR payload to the mapped `/hooks/kickr` endpoint with `Authorization: Bearer ${OPENCLAW_HOOKS_TOKEN}`.
- If both are set, Hermes takes precedence. If neither is set, the route returns `{skipped: true}` and never throws.
- First supported wake events: `ride_started`, `ride_ended`, `rider_feedback`, manual `coach_check`.
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
- Avoid high-frequency LLM loops. Use snapshots/events and let the app handle real-time trainer execution.
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
- **OpenClaw/Hermes Integration:** Phase 1 (agent installs the skill, reads context, queues commands) and Phase 2 (KICKR app -> agent wakeups via the dual adapter route) are wired. Future work: bump `kickr-skill-version` whenever the contract changes, add player commands (select/start/pause workout), and only then add physiological triggers (high HR, cadence collapse, power-target-missed).
