# LLM AI Agents Guidelines (`agents.md`)

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
   - The app can extract workouts from screenshots using the **Vercel AI SDK** and **Vercel AI Gateway**. The backend endpoint (`/api/extract-workout/route.ts`) expects `AI_GATEWAY_API_KEY` and `AI_GATEWAY_MODEL` to be set in `.env.local` to securely route multimodal requests to models like Gemini Flash.
6. **SQLite Persistence:**
   - Runtime data lives in `.data/kickr.sqlite`, ignored by git.
   - `lib/db.ts` owns schema creation and persistence functions. Keep DB initialization lazy and server-side.
   - Current tables: `ride_sessions`, `ride_samples`, `agent_events`, `agent_commands`, and `rider_profile`.
   - The app still keeps localStorage fallback/backfill for old ride history, but new saved sessions go through `/api/sessions`.

## Local Agent / LLM Control Architecture

The current architecture intentionally does **not** expose an MCP server. The browser remains the Bluetooth owner and the Next.js app exposes small local HTTP endpoints for local agents like OpenClaw or Hermes.

### Browser Ownership
- The browser tab owns Web Bluetooth and sends FTMS commands.
- External agents should not attempt to talk directly to the trainer.
- Agent control is applied by polling `/api/agent/commands` from the browser and then calling existing KICKR client methods.
- Polling currently happens every 3 seconds. Repeated `GET /api/agent/commands` lines in dev logs are expected while the app is open.

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

### Agent Event / Context Endpoints
- `POST /api/agent/events` stores structured agent/ride events in SQLite.
- `GET /api/agent/events?limit=200` returns recent agent events, newest first.
- Ride snapshots include telemetry, active trainer mode, workout name, sample count, and the current `riderProfile`.
- `GET /api/sessions` returns saved ride sessions with samples and metrics.
- `GET /api/rider` returns the current rider profile.
- `PUT /api/rider` updates the rider profile.

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
- **OpenClaw/Hermes Integration:** Add a local OpenClaw skill or slash command that reads `/api/rider`, `/api/sessions`, and `/api/agent/events`, then writes commands to `/api/agent/commands`.
