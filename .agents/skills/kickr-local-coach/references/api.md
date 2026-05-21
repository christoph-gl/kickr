# KICKR App API Reference

Preferred base URL is `https://kickr.localhost` when Portless is running:

```bash
BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
```

## Current Agent Contract

The KICKR app now handles live coaching, workout building, ride summaries, and trainer control internally. External agents should focus on personal fitness tracking after rides.

Use these endpoints:

```txt
GET /api/rider
PUT /api/rider
GET /api/sessions
GET /api/monthly-summaries
```

Do not rely on `/api/agent/commands` or `/api/agent/hooks/trigger` for normal operation. Those routes may exist for compatibility experiments, but fresh agents should not use them to control watts, routes, workouts, or live coaching.

## First Smoke Test

```bash
curl -sf "$BASE_URL/api/rider"
curl -sf "$BASE_URL/api/sessions"
```

If `AGENT_COMMAND_TOKEN` is configured, external callers should send:

```txt
Authorization: Bearer <token>
```

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

On first install, ask the rider for age, broad fitness level, cycling background, goals, and constraints. Store:

- numeric age in `age`
- explicitly provided weight, gender, cTHR, and 4DP values in their matching fields
- qualitative fitness level, goals, constraints, and tracking preferences in `memorySummary`

When using `PUT /api/rider`, preserve every field you are not intentionally changing.

## Sessions

```txt
GET /api/sessions
```

`GET /api/sessions` returns saved ride sessions, usually newest-first:

```ts
type RideSession = {
  id: string;
  workoutName: string;
  timestamp: number;
  samples: BikeSample[];
  metrics: {
    tss: number;
    iff: number;
    durationSeconds: number;
    avgPower?: number;
    avgHr?: number;
    avgCadence?: number;
  };
  riderComments?: string;
  llmSummaryStatus?: "skipped" | "generated" | "failed";
  llmSummary?: {
    headline: string;
    summary: string;
    keyObservations: string[];
    heartRateZoneAssessment: string;
    riderCommentsReflection?: string;
    trainingLoadAssessment: string;
    dataQualityNotes: string[];
    suggestedNextFocus: string[];
    memoryCandidate: string;
  };
  llmSummaryError?: string;
};
```

Use `llmSummary` as the primary narrative source for personal tracking. If a summary is skipped or failed, summarize from metrics and rider comments conservatively.

## Monthly Summaries

```txt
GET /api/monthly-summaries
```

Use monthly summaries when available for trend-level exports or memory updates. If unavailable or empty, fall back to recent sessions.

## Memory Update Pattern

1. Read `/api/rider`.
2. Read recent `/api/sessions`.
3. Build a short proposed `memorySummary` from stable patterns and the app's `llmSummary.memoryCandidate` fields.
4. Ask the rider before writing it.
5. `PUT /api/rider` with all existing fields preserved and only approved changes applied.

Avoid medical claims. Do not change FTP, cTHR, or HR zones based on one ride.
