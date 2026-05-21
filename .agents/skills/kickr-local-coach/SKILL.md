---
name: kickr-local-coach
description: Use when integrating Hermes, OpenClaw, or another local agent with this KICKR app for optional post-ride fitness tracking, rider onboarding, ride-summary export, or rider memory updates.
---

# KICKR Local Fitness Tracking Helper

The KICKR app owns Bluetooth, workouts, live coaching, workout building, and ride-summary LLM calls. External agents are optional helpers for slower personal tracking workflows after rides.

## If You Are An External Agent Pointed At This Repo

Do not operate from this authoring file at runtime. Install the lean per-agent skill into your own workspace:

1. Read [INSTALL.md](INSTALL.md).
2. Copy [`dist/agent-skill.hermes.md`](dist/agent-skill.hermes.md) or [`dist/agent-skill.openclaw.md`](dist/agent-skill.openclaw.md).
3. Ask the rider for first-run onboarding context: age, broad fitness level, cycling background, goals, and constraints.
4. Stop reading this repo. Use the installed skill for future turns.

## Current Agent Scope

Agents may:

- read rider profile with `GET /api/rider`
- update approved profile fields or `memorySummary` with `PUT /api/rider`
- read completed rides with `GET /api/sessions`
- use `llmSummary` and `llmSummary.memoryCandidate` from saved rides as the primary post-ride learning source
- help the rider add KICKR results to personal fitness tracking systems

Agents must not:

- control trainer watts, resistance, routes, or workouts
- rely on `/api/agent/commands` or `/api/agent/hooks/trigger` for normal operation
- talk directly to Bluetooth or FTMS
- read/write `.data/kickr.sqlite`
- update FTP, cTHR, HR zones, or other rider-entered values without explicit confirmation

## Fresh Agent Discovery

1. Confirm the base URL:

   ```bash
   BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
   ```

2. Smoke-check:

   ```bash
   curl -sf "$BASE_URL/api/rider"
   curl -sf "$BASE_URL/api/sessions"
   ```

3. If this is first install, collect age and fitness context, then update `memorySummary` and any explicitly provided supported fields.

## References

- [references/api.md](references/api.md) - current HTTP API contract for rider profile and sessions
- [references/hermes-hooks.md](references/hermes-hooks.md) and [references/openclaw-hooks.md](references/openclaw-hooks.md) - legacy notes only; not part of the current default setup
