# KICKR CORE 2 Web Controller

A Next.js, TypeScript, and React-based web application that connects directly to your Wahoo KICKR CORE 2 smart trainer and a Bluetooth Heart Rate Monitor via **Web Bluetooth**.

## Features

- **Connect & Disconnect:** Manage Bluetooth GATT connections securely and see real-time UI state for both the Smart Trainer and a separate Heart Rate Monitor (like an Amazfit pulse watch).
- **Live Telemetry:** Streams real-time Power (Watts) and Cadence (RPM) from the `Indoor Bike Data` FTMS characteristic, synchronized with live Heart Rate (BPM) from a secondary Bluetooth HRM.
- **Trainer Modes:**
  - **ERG Mode:** Set a target power (e.g. 200 W) and the trainer dynamically adjusts resistance to maintain it regardless of cadence/gearing.
  - **Resistance Mode:** Set a static percentage resistance (0-100%).
- **Interactive Workout Player:**
  - Visualize your workout timeline with a dynamic, color-coded SVG chart scaled to your personal 4DP® profile.
  - Play, pause, or click to seek to any point in the workout—your trainer's ERG resistance will instantly update.
  - Real-time calculations of workout metrics including Normalized Power (NP), Intensity Factor (IF®), and Training Stress Score (TSS®).
  - **Screen Wake Lock:** Automatically prevents your computer or tablet from sleeping or dimming the screen during an active workout session.
- **Workout Imports:**
  - **ZWO Files:** Parse and load industry-standard Zwift XML workout files directly in the browser.
  - **AI Image Import:** Upload a screenshot of a 4DP® or ERG workout chart, and the Vercel AI SDK (via Vercel AI Gateway) will automatically extract the structure and translate it into a playable workout scaled to your profile.
- **Rider Profile Management:** Configure and store your Neuromuscular Power (NM), Anaerobic Capacity (AC), Maximal Aerobic Power (MAP), Functional Threshold Power (FTP), and Cycling Threshold Heart Rate (cTHR) zones.
- **Data Export:** Download a `.csv` record of your ride telemetry containing timestamps, power, cadence, speed, heart rate, and resistance level.
- **Local Agent Control Bridge:** Queue local agent commands through `/api/agent/commands`, apply them in the browser-owned Bluetooth session, and persist ride snapshots plus command outcomes to SQLite.
- **SQLite-backed Rider Context:** Store FTP/4DP, HR zones, age, weight, gender, and an LLM-ready rider memory summary in `.data/kickr.sqlite`.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up your AI Gateway (Required for Image Imports):
   Create a `.env.local` file in the root directory and add your Vercel AI Gateway Key:
   ```
   AI_GATEWAY_API_KEY=your_key_here
   AI_GATEWAY_MODEL=google/gemini-3-flash
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) with your browser.

> **Note:** Web Bluetooth requires a secure context (HTTPS) or `localhost`. It is currently fully supported in **Chrome** and **Edge**. Ensure no other apps (like Zwift or Wahoo app) are actively connected to your trainer, as they typically only accept one active Bluetooth control connection at a time.

## Technology Stack
- Next.js (App Router)
- React
- TypeScript
- Web Bluetooth API (FTMS protocol for trainer, standard HRM protocol for heart rate)
- Vercel AI SDK (`ai` and `zod`) for image-to-workout extraction
- Tailwind CSS
- shadcn/ui components

## Local Agent Bridge

The browser remains the Bluetooth owner. A local agent such as OpenClaw or Hermes should enqueue high-level commands through the Next.js server; the browser tab polls the command inbox and applies commands through the existing Web Bluetooth client.

The app polls `GET /api/agent/commands` every 3 seconds while open, so repeated request lines in dev logs are normal.

Queue an ERG command:

```bash
curl -X POST http://localhost:3000/api/agent/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"set_erg_watts","watts":220,"reason":"HR is steady; lift the target."}'
```

Supported command types:

```json
{"type":"set_erg_watts","watts":220,"reason":"HR is steady"}
{"type":"set_resistance","percent":35,"reason":"Free ride push"}
{"type":"send_message","text":"Hold this effort for two more minutes"}
{"type":"start_trainer"}
{"type":"stop_trainer"}
```

Read recent agent/ride events:

```bash
curl http://localhost:3000/api/agent/events?limit=200
```

Read rider context:

```bash
curl http://localhost:3000/api/rider
```

Read saved sessions:

```bash
curl http://localhost:3000/api/sessions
```

For the later OpenClaw/Hermes step, point the local agent at this command endpoint and read live ride context from `GET /api/agent/events?limit=200`, rider context from `GET /api/rider`, and history from `GET /api/sessions`. If you set `AGENT_COMMAND_TOKEN`, external callers must include `Authorization: Bearer <token>`.

The agent should send structured intent such as “set ERG to 240 W,” not FTMS bytes. FTMS encoding stays inside `lib/kickr-client.ts`.

## SQLite Persistence

Runtime data is stored in `.data/kickr.sqlite`, which is intentionally ignored by git. The database currently contains `ride_sessions`, `ride_samples`, `agent_events`, `agent_commands`, and `rider_profile`.

The browser still keeps a localStorage fallback for existing history and offline resilience. On first load, if SQLite has no sessions but localStorage does, the app backfills those sessions into SQLite.

The rider profile is seeded from the original static profile and now includes:

- 4DP values: NM, AC, MAP, FTP
- cycling threshold heart rate (`cTHR`)
- heart-rate zones
- age
- weight in kg
- gender (`male`, `female`, or unset)
- `memorySummary` for future LLM-updated ride/performance notes

Use the cog button in the top right of the app to edit these values manually.

## Current Agent Boundary

The project currently has the Next.js-side agent bridge only. The next OpenClaw/Hermes work should likely be:

1. Add an OpenClaw skill or slash command to start a coaching session.
2. Read `GET /api/rider`, `GET /api/sessions`, and `GET /api/agent/events?limit=...`.
3. Periodically produce coaching messages or commands by writing to `POST /api/agent/commands`.
4. After a completed ride, summarize useful learning into `rider_profile.memorySummary` through `PUT /api/rider`.

Repo-local agent instructions are available at `.agents/skills/kickr-local-coach/SKILL.md`. For a fresh OpenClaw/Hermes pass, start with that skill's Fresh Agent Discovery Script. Phase 1 is OpenClaw-only and should not edit the KICKR Next.js app.

## Further Development
See `agents.md` for guidelines and instructions for LLMs (like Gemini) working on this project in the future.
