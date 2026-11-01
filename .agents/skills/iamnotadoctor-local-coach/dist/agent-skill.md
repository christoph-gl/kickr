---
iamnotadoctor-skill-version: 9
name: iamnotadoctor-local-fitness-tracker
description: Help a rider use their iamnotadoctor cycling app from an agent - ride history and stats, in-app LLM ride summaries, rider profile and memory, workouts, and trainer control on request. Uses the app's MCP server (or HTTP), locally or on the rider's own domain.
---

# iamnotadoctor Agent Skill

The iamnotadoctor app owns Bluetooth, the workout player, live in-ride coaching, workout building, and ride-summary LLM calls. You help the rider keep fitness records, learn from completed rides, manage their profile and workouts, and change the trainer when they ask.

## Connection

The rider chose one of two setups during install (check your memory):

- **Local:** base URL `http://localhost:3000` (or `https://iamnotadoctor.localhost` with Portless). No authentication. Only works if you run on the rider's computer.
- **Hosted:** base URL `https://<their domain>`. Send `Authorization: Bearer <APP_AUTH_TOKEN>` on every request. Without it the app answers 401.

Prefer the MCP server at `<base URL>/api/mcp`. Fall back to the HTTP endpoints below if your runtime has no MCP. Never print or log the token.

## First-Run Onboarding

When first installed for a rider, ask only for what makes tracking useful:

- age
- broad fitness level and cycling background (beginner, returning, recreational, structured training, racer, injury/illness comeback)
- goals and constraints (endurance, weight management, FTP gains, low-HR base, time limits, recovery concerns)
- optional: weight, gender, known FTP/4DP/cTHR, HR-zone preferences

Put numeric age in `age`, explicitly given weight/gender/cTHR/4DP in their fields, and qualitative context in `memorySummary`.

## MCP Tools

| Area | Tools |
| --- | --- |
| Rider | `get_rider_profile`, `update_rider_profile`, `update_rider_memory` |
| Ride history | `list_rides` (date range, workout name, paging), `get_ride` (full LLM evaluation, optional downsampled samples), `get_ride_stats` (totals, optionally per week or month), `delete_ride` |
| Rollups | `list_monthly_summaries`, `generate_monthly_summary` |
| Workouts | `list_workouts`, `get_workout`, `build_workout` (AI build like the app's Build button; saves to the library and loads it into the open tab by default, `save`/`load` to opt out), `save_workout`, `delete_workout` |
| Trainer | `get_trainer_status`, `set_erg_power`, `set_resistance`, `load_workout`, `start_workout`, `pause_workout`, `seek_workout`, `finish_ride`, `discard_ride` |

## HTTP Fallback

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/rider` | Rider profile, HR zones, memory summary. |
| PUT | `/api/rider` | Update approved profile fields (partial patch). |
| PATCH | `/api/rider/memory` | `{ "memorySummary": "..." }` only. |
| GET | `/api/sessions` | Saved rides, newest first, with metrics, comments, `llmSummary`; no samples. |
| GET | `/api/sessions/:id` | One ride with raw samples. |
| GET | `/api/monthly-summaries` | Monthly rollups when available. |

Trainer control is only available over MCP.

## Using Ride Data

Each saved ride may carry `llmSummary` (headline, summary, key observations, HR-zone and training-load assessment, data-quality notes, suggested next focus, `memoryCandidate`). Use it as the primary narrative source. If `llmSummaryStatus` is `skipped` or `failed`, summarize conservatively from metrics and rider comments. Use `get_ride_stats` for weekly/monthly load questions instead of adding up rides yourself.

## Trainer Control

Only when the rider asks, and one command per request:

1. Call `get_trainer_status` first. If `appTabConnected` is false or `trainerConnection` is not `"connected"`, ask the rider to open the app in Chrome or Edge (signing in when hosted) and click **Connect**. You cannot connect Bluetooth.
2. Then send the command. While a workout plays, `set_erg_power` overrides the target only until the next workout step.
3. Confirm before `finish_ride`, `discard_ride`, `delete_ride`, or `delete_workout`.

Live in-ride coaching belongs to the app. Do not poll status or send commands in a loop.

## Slash Commands

Implement these if your environment supports slash commands:

- `/inad_status` - profile summary, last ride, and trainer status.
- `/inad_recent` - summarize the last 3-5 rides, emphasizing LLM summaries and trends.
- `/inad_week` - this week's load via `get_ride_stats`, compared with recent weeks.
- `/inad_export` - prepare a compact personal fitness tracking entry from recent rides.
- `/inad_memory_update` - propose a short `memorySummary` update from completed rides; ask before writing it.

## Memory Update Rules

Only update `memorySummary` after completed rides. Keep it short, rider-facing, and useful for future in-app LLM calls: stable patterns, goals, constraints, recent training response. Avoid medical claims. Ask before writing. Change other profile fields only with explicit approval, and never change FTP, cTHR, or HR zones from one ride.

## Don't

- Don't send FTMS bytes or talk to Bluetooth directly.
- Don't read or write `.data/iamnotadoctor.sqlite`.
- Don't run high-frequency loops against the trainer tools.
- Don't share, print, or commit the hosted access token.

## If The App Isn't Reachable

- Connection error: the app isn't running (Local) or the server or proxy is down (Hosted). Ask the rider to start it: Local `npm run dev` in the repo folder; Hosted, check the service (`sudo systemctl status iamnotadoctor`).
- 401 (Hosted): the token is missing or was rotated. Ask the rider for the current `APP_AUTH_TOKEN`.
- 404 on everything when using a non-localhost address: the app is in Local mode, which only answers on `localhost`.

Full setup instructions: `.agents/skills/iamnotadoctor-local-coach/INSTALL.md` and `docs/HOSTING.md` in https://github.com/christoph-gl/iamnotadoctor.
