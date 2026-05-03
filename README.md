# KICKR CORE 2 Web Controller

A Next.js, TypeScript, and React-based web application that connects directly to your Wahoo KICKR CORE 2 smart trainer and a Bluetooth Heart Rate Monitor via **Web Bluetooth**.

## For Local Agents Given This URL

If an agent such as Hermes or OpenClaw is pointed at `https://github.com/christoph-gl/kickr` and the user says “try this”, “implement it”, “first”, or similar, treat that as a request to **bootstrap the KICKR app locally and install/configure the local coach bridge**. Do not ask “implement what?” unless the user explicitly asks for a code feature.

Fresh-agent default path:

1. Clone the repo to a user-approved directory, or use the directory the user already has.
2. Run `npm install`.
3. Do **not** copy `.env.example` to `.env.local`. It contains optional placeholders. Create `.env.local` only when the user provides real image-extraction or hook credentials.
4. Start with `npm run dev` or `npm run dev:portless`; the script already includes Turbopack.
5. Wait for the first Next.js compile. It can take 30-90 seconds on a fresh install. Probe `http://localhost:3000/api/rider`, not only `/`.
6. Tell the user to open Chrome or Edge and connect Bluetooth from the UI. Agents cannot grant Web Bluetooth permission.
7. If setting up coaching, follow [`.agents/skills/kickr-local-coach/INSTALL.md`](./.agents/skills/kickr-local-coach/INSTALL.md).

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
  - **AI Image Import:** Upload a screenshot of a 4DP® or ERG workout chart, and an image-capable AI model will extract the structure and translate it into a playable workout scaled to your profile.
- **Rider Profile Management:** Configure and store your Neuromuscular Power (NM), Anaerobic Capacity (AC), Maximal Aerobic Power (MAP), Functional Threshold Power (FTP), and Cycling Threshold Heart Rate (cTHR) zones.
- **Data Export:** Download a `.csv` record of your ride telemetry containing timestamps, power, cadence, speed, heart rate, and resistance level.
- **Local Agent Control Bridge:** Queue local agent commands through `/api/agent/commands`, apply them in the browser-owned Bluetooth session, and persist ride snapshots plus command outcomes to SQLite.
- **SQLite-backed Rider Context:** Store FTP/4DP, HR zones, age, weight, gender, and an LLM-ready rider memory summary in `.data/kickr.sqlite`.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Optional image-to-workout extraction:
   Create a `.env.local` file in the root directory if you want screenshot imports. Add an AI SDK / Vercel AI Gateway-compatible key and a multimodal model that can read images:
   ```
   WORKOUT_IMAGE_EXTRACTOR_API_KEY=your_image_capable_ai_api_key_here
   WORKOUT_IMAGE_EXTRACTOR_MODEL=google/gemini-3-flash
   ```

   Plain trainer control, workout playback, and local agent commands work without these values. The app still accepts the older `AI_GATEWAY_API_KEY` / `AI_GATEWAY_MODEL` names as a compatibility fallback.

   Do not create `.env.local` by blindly copying `.env.example`; leave optional placeholders unset unless you have real values.

   Optional outbound agent wakeups. Configure **one** backend in `.env.local`. If both are set, Hermes wins.

   Hermes (uses the Hermes API Server, requires `API_SERVER_ENABLED=true` in `~/.hermes/.env` and a running `hermes gateway`):
   ```
   HERMES_API_URL=http://127.0.0.1:8642
   HERMES_API_KEY=<API_SERVER_KEY from ~/.hermes/.env>
   HERMES_KICKR_SESSION_ID=kickr-local-coach
   ```

   OpenClaw (uses a mapped HTTP hook at `/hooks/kickr`):
   ```
   OPENCLAW_HOOKS_URL=http://127.0.0.1:<openclaw-port>/hooks/kickr
   OPENCLAW_HOOKS_TOKEN=replace-with-dedicated-hook-token
   ```

   Restart `next dev` after editing `.env.local` — Next.js only reads env vars at server start.

3. Run the development server:
   ```bash
   npm run dev
   ```

   Or run through Portless for a stable HTTPS project URL:
   ```bash
   npm run dev:portless
   ```

   On first launch, wait for compilation before deciding it failed. A good readiness check is:
   ```bash
   curl -fsS http://localhost:3000/api/rider | head -c 200
   ```

4. Open [http://localhost:3000](http://localhost:3000) with your browser.

   With Portless, open [https://kickr.localhost](https://kickr.localhost). The project name comes from `package.json`, and agents can discover the URL with:
   ```bash
   npx portless get kickr
   ```

> **Note:** Web Bluetooth requires a secure context (HTTPS) or `localhost`. It is currently fully supported in **Chrome** and **Edge**. Ensure no other apps (like Zwift or Wahoo app) are actively connected to your trainer, as they typically only accept one active Bluetooth control connection at a time.
>
> Portless command note: use `npm run dev:portless`, `npx portless`, or `npx portless run next dev --turbopack`. Do not use `portless run dev`; that tries to execute a shell command named `dev` instead of the npm script.

## Technology Stack
- Next.js (App Router)
- React
- TypeScript
- Web Bluetooth API (FTMS protocol for trainer, standard HRM protocol for heart rate)
- Vercel AI SDK (`ai` and `zod`) for image-to-workout extraction
- Tailwind CSS
- shadcn/ui components

## Local Agent Bridge

The browser remains the Bluetooth owner. A local agent such as OpenClaw or Hermes should enqueue high-level commands through the Next.js server; the browser tab with the active trainer connection polls the command inbox and applies commands through the existing Web Bluetooth client.

The app polls `GET /api/agent/commands` every 3 seconds only while the tab is connected to the trainer, so repeated request lines in dev logs are normal during an active connection. Disconnected or stale tabs should not consume trainer commands.

Queue an ERG command:

```bash
curl -X POST https://kickr.localhost/api/agent/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"set_erg_watts","watts":220,"reason":"HR is steady; lift the target."}'
```

If you are not using Portless, replace `https://kickr.localhost` with `http://localhost:3000`.

Supported command types:

```json
{"type":"set_erg_watts","watts":220,"reason":"HR is steady"}
{"type":"set_resistance","percent":35,"reason":"Free ride push"}
{"type":"send_message","text":"Hold this effort for two more minutes"}
{"type":"send_message","text":"Text only; do not speak this one","speak":false}
{"type":"request_rider_voice_feedback","prompt":"How does this effort feel?","durationSeconds":10}
{"type":"start_trainer"}
{"type":"stop_trainer"}
```

Use `set_erg_watts` as the canonical ERG command. The browser also accepts `{"type":"set_trainer_mode","mode":"erg","targetWatts":220}` as a compatibility fallback for agents that already emit that shape, but fresh integrations should prefer `set_erg_watts`.

`request_rider_voice_feedback` opens a visible 10-second browser speech-recognition window in Chrome/Edge, then forwards the transcript as a `rider_feedback` hook. The current implementation uses browser Web Speech recognition first; agent-side STT can be added later by attaching recorded audio to the same feedback flow once the target agent exposes a concrete audio/STT endpoint.

Read recent agent/ride events:

```bash
curl https://kickr.localhost/api/agent/events?limit=200
```

Read rider context:

```bash
curl https://kickr.localhost/api/rider
```

Read saved sessions:

```bash
curl https://kickr.localhost/api/sessions
```

For the later OpenClaw/Hermes step, point the local agent at this command endpoint and read live ride context from `GET /api/agent/events?limit=200`, rider context from `GET /api/rider`, and history from `GET /api/sessions`. If you set `AGENT_COMMAND_TOKEN`, external callers must include `Authorization: Bearer <token>`.

The agent should send structured intent such as “set ERG to 240 W,” not FTMS bytes. FTMS encoding stays inside `lib/kickr-client.ts`.

When testing trainer commands, confirm both `command_applied` and a following `ride_snapshot.activeTrainerMode` change. If a command is consumed by a stale tab, the event log will show a different session id or a `command_failed` event such as `Not connected`.

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

## Local Agent Architecture

The browser owns Bluetooth. External agents (Hermes, OpenClaw, ...) operate through local HTTP — they never speak FTMS or talk to the trainer directly. Two directions:

- **Agent -> KICKR:** queue commands via `POST /api/agent/commands`. Read context via `GET /api/rider`, `GET /api/sessions`, `GET /api/agent/events?limit=200`.
- **KICKR -> agent wakeups:** the browser calls `POST /api/agent/hooks/trigger`. The server route picks an adapter from env vars:
  - `HERMES_API_URL` (+ `HERMES_API_KEY`, `HERMES_KICKR_SESSION_ID`) -> `POST ${HERMES_API_URL}/v1/runs` with `{session_id, input, metadata}` (preferred when Hermes API Server is enabled).
  - `OPENCLAW_HOOKS_URL` (+ `OPENCLAW_HOOKS_TOKEN`) -> mapped OpenClaw `/hooks/kickr`.
  - Hermes wins if both are set. Neither set -> the route returns `{skipped: true}` and never throws.

The hook payload includes a compact `runtimeContract` and ride snapshot so a live agent does not need to reread repo docs before acting. Manual coach checks use `mode:"fast"`: the agent should prefer one short `send_message` and avoid fetching history unless the included context is clearly insufficient.

The hook trigger response confirms forwarding only: target backend, local target URL, HTTP status, and any response body/run id returned by Hermes/OpenClaw. Actual agent processing is confirmed later when the agent queues a `send_message`, trainer command, or event through the KICKR APIs.

Initial wake events are intentionally minimal: `ride_started`, `ride_ended`, `rider_feedback`, and manual `coach_check` from the Agent Controller panel. Physiological triggers (high HR, cadence collapse) are later work.

### Install-once skill model

External agents do not operate by reading this repo on every coaching turn. They install a lean per-agent skill into their own workspace once and operate from there:

```
.agents/skills/kickr-local-coach/
├── INSTALL.md                   ← read this first when an agent is pointed at the repo
├── dist/
│   ├── agent-skill.hermes.md    ← copy into ~/.hermes/skills/kickr-local-coach/SKILL.md
│   └── agent-skill.openclaw.md  ← copy into ~/.openclaw/skills/kickr-local-coach/SKILL.md
└── references/
    ├── api.md                   ← endpoint reference
    ├── hermes-hooks.md          ← one-time Hermes wiring
    └── openclaw-hooks.md        ← one-time OpenClaw wiring
```

What lives where:

- **Hot path** (in the installed skill, ~1–2 screens): endpoints, command shapes, hook payload, coaching loop, slash commands, "don't" rules. Self-contained — no repo fetches at runtime.
- **Cold path** (in `references/`): env-var wiring, gateway config, smoke tests. Read once during install, then forgotten.
- **Not in the skill at all**: FTMS opcodes, SQLite schema, Web Bluetooth, workout player internals. Those live in `AGENTS.md` for someone editing the app.

Each `dist/agent-skill.*.md` starts with a `kickr-skill-version` line. Bump it whenever the operating contract changes; installed copies use it to detect drift and re-install.

Workflow: agent points at repo once → reads [`INSTALL.md`](./.agents/skills/kickr-local-coach/INSTALL.md) → if the KICKR app isn't running yet, walks the user through Step 0 (clone, `npm install`, `.env.local`, `npm run dev`) → copies the right `dist/*.md` into its own skills dir → does env wiring from `references/` → never opens this repo again until version bumps.

## Further Development
See `AGENTS.md` for guidelines and instructions for LLMs working on this project in the future.
