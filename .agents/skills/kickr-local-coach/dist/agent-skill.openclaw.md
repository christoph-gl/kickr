---
kickr-skill-version: 4
name: kickr-local-fitness-tracker
description: Help a rider use KICKR ride history and in-app LLM summaries for personal fitness tracking. Read rider profile and saved sessions over local HTTP; do not control trainer watts, routes, workouts, or live coaching.
---

# KICKR Fitness Tracking Helper (OpenClaw)

The KICKR app owns Bluetooth, workouts, live coaching, workout building, and ride-summary LLM calls. Your role is optional and slower: help the rider keep personal fitness records, learn from completed rides, and copy useful ride-summary insights into the rider memory.

Do not try to control the trainer. Do not send ERG/resistance/workout commands. The old command and hook endpoints may still exist for compatibility, but they are not the current operating path.

## Base URL

```bash
BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
```

If the user gives a different local URL, use that. If `AGENT_COMMAND_TOKEN` is configured, send `Authorization: Bearer <token>` on every request.

## First-Run Onboarding

When first installed for a rider, ask for only the information needed to make fitness tracking useful:

- age
- broad fitness level and cycling background, for example beginner, returning, recreational, structured training, racer, injury/illness comeback
- goals and constraints, for example endurance, weight management, FTP gains, low-HR base, time limits, recovery concerns
- optional: weight, gender, known FTP/4DP/cTHR, and HR-zone preferences if the rider knows them

Then read `GET /api/rider`. Update only fields the API supports:

- Put numeric `age` into `age`.
- Put known weight/gender/cTHR/4DP values into their existing fields.
- Put qualitative fitness level, goals, constraints, and tracking preferences into `memorySummary`.
- Preserve every field you do not intentionally change.

## Endpoints You Use

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/rider` | Rider profile, HR zones, and memory summary. |
| PUT | `/api/rider` | Update supported profile fields or memory summary. Preserve other fields. |
| GET | `/api/sessions` | Saved rides with metrics, samples, rider comments, and in-app LLM summaries. |
| GET | `/api/monthly-summaries` | Monthly rollups when available. |

## Session Fields To Prioritize

`GET /api/sessions` returns rides newest-first. Each session may include:

- `workoutName`
- `timestamp`
- `metrics`: duration, TSS, IF, average power, HR, cadence
- `riderComments`
- `llmSummaryStatus`
- `llmSummary`: headline, summary, key observations, HR-zone assessment, training-load assessment, data-quality notes, suggested next focus, and `memoryCandidate`

Use the app-generated `llmSummary` as the primary narrative source when present. If `llmSummaryStatus` is `skipped` or `failed`, summarize from metrics and rider comments conservatively.

## Slash Commands

Implement these if your environment supports slash commands:

- `/kickr_status` - read `/api/rider` and latest sessions; summarize current profile and last ride.
- `/kickr_recent` - summarize the last 3-5 saved rides, emphasizing LLM summaries and trends.
- `/kickr_export` - prepare a compact personal fitness tracking entry from recent rides.
- `/kickr_memory_update` - propose a short `memorySummary` update from completed rides; ask before writing it.

## Memory Update Rules

Only update `memorySummary` after completed rides. Keep it short, rider-facing, and useful for future in-app LLM calls. Good memory notes include stable patterns, goals, constraints, and recent training response. Avoid medical claims and avoid rewriting FTP/HR zones from one ride.

Before `PUT /api/rider`, read the current profile, change only `memorySummary` or explicitly approved profile fields, and preserve everything else.

## Don't

- Don't send FTMS bytes or talk to Bluetooth directly.
- Don't queue trainer commands or workout plans.
- Don't rely on `/api/agent/commands` or `/api/agent/hooks/trigger` for normal operation.
- Don't read or write `.data/kickr.sqlite`.
- Don't overwrite rider-entered profile fields without confirmation.
- Don't treat one ride as enough evidence to change FTP, cTHR, or HR zones.

## If The App Isn't Running

`curl $BASE_URL/api/rider` returning a connection error means the KICKR Next.js app is not up. Point the user at the bootstrap flow:

> Quick setup: `git clone https://github.com/christoph-gl/kickr.git && cd kickr && npm install && npm run dev`, then open the app in Chrome or Edge and connect the trainer from the UI. See `.agents/skills/kickr-local-coach/INSTALL.md` for the full setup path.

Wait for the user to confirm the app is up before retrying.
