---
name: kickr-local-fitness-tracker-install
description: One-time installer flow for optional external agents. Copy the lean KICKR fitness-tracking skill into the agent workspace, bootstrap the app if needed, and collect rider onboarding context.
---

# Install KICKR Fitness Tracking Helper

The KICKR app now owns live coaching, workout building, ride-summary LLM calls, Bluetooth, and trainer control. External agents such as Hermes or OpenClaw are optional helpers for personal fitness tracking after rides.

After install, the agent should use the copied skill and should not reread this repo unless the skill version changes.

## Step 0: Bootstrap The KICKR App

If the user only gave the GitHub URL and says “try this”, “set it up”, “first”, or similar, use this path.

1. Check whether the app is already reachable:

   ```bash
   curl -sf "$(portless get kickr 2>/dev/null || echo http://localhost:3000)/api/rider" >/dev/null \
     && echo "KICKR app is up" || echo "KICKR app is not running"
   ```

2. If the app is not running, ask where to clone it. Default suggestion: `~/coding/kickr`.

3. Clone and install:

   ```bash
   git clone https://github.com/christoph-gl/kickr.git ~/coding/kickr
   cd ~/coding/kickr
   npm install
   ```

4. Create `.env.local` only when the user provides real API keys for in-app LLM features such as live feedback, workout building, ride summaries, TTS, or screenshot import. Do not copy `.env.example` blindly.

5. Start the dev server:

   ```bash
   npm run dev          # http://localhost:3000
   # or
   npm run dev:portless # https://kickr.localhost
   ```

   Do not append `-- --turbopack`; the script already includes Turbopack. Wait 30-90 seconds on first compile before deciding it failed.

6. Verify readiness:

   ```bash
   BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
   curl -sf "$BASE_URL/api/rider" | head -c 200
   ```

7. Tell the rider to open Chrome or Edge and connect Bluetooth from the app UI. Agents cannot grant Web Bluetooth permission.

## Step 1: Install The Agent Skill

Choose the matching pre-built skill:

- Hermes: [`dist/agent-skill.hermes.md`](dist/agent-skill.hermes.md)
- OpenClaw: [`dist/agent-skill.openclaw.md`](dist/agent-skill.openclaw.md)

Hermes:

```bash
mkdir -p ~/.hermes/skills/kickr-local-coach
cp .agents/skills/kickr-local-coach/dist/agent-skill.hermes.md \
   ~/.hermes/skills/kickr-local-coach/SKILL.md
head -1 ~/.hermes/skills/kickr-local-coach/SKILL.md
# should print: kickr-skill-version: 4
```

OpenClaw:

```bash
mkdir -p ~/.openclaw/skills/kickr-local-coach
cp .agents/skills/kickr-local-coach/dist/agent-skill.openclaw.md \
   ~/.openclaw/skills/kickr-local-coach/SKILL.md
head -1 ~/.openclaw/skills/kickr-local-coach/SKILL.md
# should print: kickr-skill-version: 4
```

## Step 2: Rider Onboarding

On first install, ask the rider:

- age
- broad fitness level and cycling background
- current goals and constraints
- optional: weight, gender, known FTP/4DP/cTHR, HR-zone preferences

Then read `GET /api/rider` and update only supported fields:

- `age` for numeric age
- `weightKg`, `gender`, `cTHR`, `fourDP` only when the rider provided explicit values
- `memorySummary` for qualitative fitness level, goals, constraints, and tracking preferences

Preserve all other profile fields in `PUT /api/rider`.

## What External Agents Do Now

Agents should use:

- `GET /api/rider` for profile and memory
- `PUT /api/rider` for approved profile or memory updates
- `GET /api/sessions` for completed rides and in-app LLM summaries
- `GET /api/monthly-summaries` for rollups when available

Agents should not use normal operation time on:

- trainer commands
- ERG/resistance control
- workout route control
- `/api/agent/commands`
- `/api/agent/hooks/trigger`

Those old endpoints can remain for compatibility experiments, but the current app path is in-app LLM calls plus post-ride fitness tracking.

## Drift Checklist

If behavior or response shapes no longer match:

1. Compare `kickr-skill-version` in the installed skill with `dist/agent-skill.<agent>.md`.
2. If they differ, re-copy the skill.
3. If they match, use `references/api.md` for the current HTTP contract.
