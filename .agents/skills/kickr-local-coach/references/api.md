# KICKR App API Reference

Base URL defaults to `http://localhost:3000`.

## First Smoke Test

Before building a larger integration, verify:

```bash
curl http://localhost:3000/api/rider
curl 'http://localhost:3000/api/agent/events?limit=5'
curl -X POST http://localhost:3000/api/agent/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"send_message","text":"KICKR agent bridge connected","reason":"integration smoke test"}'
```

If the browser tab is open, the message should appear in the app's Agent Controller panel.

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

The browser tab polls `GET /api/agent/commands` every 3 seconds and applies queued commands. This is expected behavior.

Supported commands:

```json
{"type":"set_erg_watts","watts":220,"reason":"HR is steady"}
{"type":"set_resistance","percent":35,"reason":"Free ride push"}
{"type":"send_message","text":"Hold cadence steady"}
{"type":"start_trainer"}
{"type":"stop_trainer"}
```

Use `send_message`, `set_erg_watts`, and `set_resistance` for the first integration. Treat `start_trainer` and `stop_trainer` as lower-level trainer commands, not workout-player controls.

Example:

```bash
curl -X POST http://localhost:3000/api/agent/commands \
  -H "Content-Type: application/json" \
  -d '{"type":"set_erg_watts","watts":220,"reason":"HR is steady"}'
```

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
