# KICKR App API Reference

Preferred base URL is `https://kickr.localhost` when Portless is running. Discover it with:

```bash
portless get kickr
```

Fallback base URL is `http://localhost:3000` when the app is run with plain `npm run dev`.

## First Smoke Test

Before building a larger integration, verify:

```bash
BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
curl "$BASE_URL/api/rider"
curl "$BASE_URL/api/agent/events?limit=5"
curl -X POST "$BASE_URL/api/agent/commands" \
  -H "Content-Type: application/json" \
  -d '{"type":"send_message","text":"KICKR agent bridge connected","reason":"integration smoke test"}'
```

If a browser tab is connected to the trainer, the message should appear in the app's Agent Controller panel. If no tab is connected, the command remains queued until a connected tab consumes it.

## Rider Context

```txt
GET /api/rider
PUT /api/rider
```

`GET /api/rider` returns:

```ts
type RiderProfile = {
  fourDP: { nm: number; ac: number; map: number; ftp: number };
  cTHR: number;
  age: number | null;
  weightKg: number | null;
  gender: "male" | "female" | string | null;
  hrZones: {
    id: string;
    name: string;
    percentageRange: string;
    minBpm: number;
    maxBpm: number;
    color: string;
  }[];
  colors: { nm: string; ac: string; map: string; ftp: string };
  memorySummary: string;
};
```

Use `PUT /api/rider` to persist manual changes or post-ride LLM memory updates. Preserve fields you are not changing.

## Sessions

```txt
GET /api/sessions
POST /api/sessions
DELETE /api/sessions?id=<session-id>
```

`GET /api/sessions` returns saved ride sessions with samples and metrics. Use it for historical context and post-ride analysis.

## Workouts

```txt
GET /api/workouts
POST /api/workouts
```

`GET /api/workouts` returns imported/saved workout JSON files. Built-in workouts live in `lib/workouts.ts` and are available in the app UI; expose them through an API later if agents need reliable discovery of built-ins.

Known limitation: there is no agent command yet to select/start a workout in the player. Agents can save a generated workout, but the rider must select it manually until app-side player commands are added.

Workout shape:

```ts
type Workout = {
  id: string;
  name: string;
  description: string;
  blocks: { durationSeconds: number; targetPower: number }[];
};
```

Use `POST /api/workouts` to save a newly generated workout.

## Agent Commands

```txt
POST /api/agent/commands
GET /api/agent/commands
GET /api/agent/commands?consume=false
```

The browser tab polls `GET /api/agent/commands` every 3 seconds and applies queued commands. This is expected behavior during an active trainer connection.

Only the browser tab with `connectionState: "connected"` should consume commands. Disconnected or stale tabs should not poll the consuming endpoint, because they do not own a live Bluetooth control characteristic.

Supported commands:

```json
{"type":"set_erg_watts","watts":220,"reason":"HR is steady"}
{"type":"set_resistance","percent":35,"reason":"Free ride push"}
{"type":"send_message","text":"Hold cadence steady"}
{"type":"start_trainer"}
{"type":"stop_trainer"}
{"type":"set_workout_plan","horizonSeconds":600,"leadSeconds":20,"blocks":[{"durationSeconds":300,"targetPower":180},{"durationSeconds":300,"targetPower":190}],"reason":"Adaptive freeride refresh"}
```

Use `send_message`, `set_erg_watts`, and `set_resistance` for the first integration. Treat `start_trainer` and `stop_trainer` as lower-level trainer commands, not workout-player controls. Use `set_workout_plan` only for adaptive freeride or explicitly planned agent workouts; the browser workout player applies it when connected.

Use the exact command names above. The app accepts these compatibility fallbacks, but fresh agents should queue the canonical commands so behavior stays predictable:

```json
{"type":"set_trainer_mode","mode":"erg","targetWatts":220}
{"type":"set_trainer_mode","mode":"resistance","percent":35}
```

Example:

```bash
BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
curl -X POST "$BASE_URL/api/agent/commands" \
  -H "Content-Type: application/json" \
  -d '{"type":"set_erg_watts","watts":220,"reason":"HR is steady"}'
```

After a trainer command, verify it with:

```bash
BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
curl "$BASE_URL/api/agent/events?limit=10"
```

Look for `command_received`, then `command_applied`, then a newer `ride_snapshot.activeTrainerMode` showing the requested ERG watts or resistance level. If you see `command_failed` with `Not connected`, a stale/disconnected tab likely consumed the command or the trainer connection dropped.

## Agent Events

```txt
POST /api/agent/events
GET /api/agent/events?limit=200
```

Recent ride snapshots include:
- `sessionId`
- `workoutName`
- connection states
- active trainer mode
- latest sample
- sample count
- `riderProfile`

Agents should read recent events before deciding whether to coach, adjust ERG, or ask the rider a question.

## Authentication

If `AGENT_COMMAND_TOKEN` is configured, external callers should send:

```txt
Authorization: Bearer <token>
```

Same-origin browser requests are allowed so the app can poll and log events.
