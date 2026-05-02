---
name: kickr-local-coach-install
description: One-time installer flow. When an external agent (Hermes, OpenClaw, etc.) is pointed at this KICKR repo, follow this doc to copy the lean operating skill into the agent's own workspace, then stop reading this repo until the KICKR app is upgraded.
---

# Install KICKR Local Coach Into Your Agent Workspace

This repo is the source of truth for the KICKR local-coach skill. The intent is **install once, then operate without coming back here**. After install, day-to-day coaching turns should not need to re-read this repo, the app source, or these references.

## Step 0: Bootstrap The KICKR App (Skip If Already Running)

The skill talks to a running Next.js app. If the user does not already have it running, do this first.

If the user only gave the GitHub URL and then says “implement it”, “first”, “try this”, or “set it up”, this Step 0 is the intended default. Do not ask a broad “implement what?” question. Ask only narrow setup questions that block progress, such as the clone location or which agent backend to wire.

1. Check whether the app is already reachable. Either Portless or plain dev server is fine:

   ```bash
   curl -sf "$(portless get kickr 2>/dev/null || echo http://localhost:3000)/api/rider" >/dev/null \
     && echo "KICKR app is up" || echo "KICKR app is not running"
   ```

   If "is up", skip to Step 1.

2. Confirm with the user where they want the repo. Default suggestion: `~/coding/kickr`. Do not pick a path silently.

3. Clone:

   ```bash
   git clone https://github.com/christoph-gl/kickr.git ~/coding/kickr
   cd ~/coding/kickr
   ```

   If the user already has the repo somewhere else, just `cd` into it.

4. Install dependencies:

   ```bash
   npm install
   ```

5. Create `.env.local` only if the user wants screenshot/image-to-workout extraction during setup. Ask the user for an image-capable AI API key — do not fabricate one. Hook adapter env vars are added in Step 2 below; leave them out for now.

   ```bash
   cat > .env.local <<'EOF'
   WORKOUT_IMAGE_EXTRACTOR_API_KEY=<paste from user>
   WORKOUT_IMAGE_EXTRACTOR_MODEL=google/gemini-3-flash
   EOF
   ```

   If the user only wants trainer control and local coaching, it is fine to skip this file for now. The KICKR app can still start without image extraction credentials. Do **not** run `cp .env.example .env.local`; the example file intentionally contains optional placeholders.

   Web Bluetooth requires a secure context (HTTPS or `localhost`). If the user has Portless, prefer it for stable HTTPS at `https://kickr.localhost`; otherwise plain `http://localhost:3000` works for dev.

6. Start the dev server in a terminal the user owns. Do not background it from inside the agent unless the user's tool environment has a proper long-running process manager:

   ```bash
   npm run dev          # http://localhost:3000
   # or
   npm run dev:portless # https://kickr.localhost
   ```

   Do not run `npm run dev -- --turbopack`; the script already includes Turbopack. Do not kill the process after a short timeout. A fresh Next.js start can spend 30-90 seconds compiling before the readiness probe succeeds.

7. Tell the user to open the app in Chrome or Edge and connect their KICKR + HRM via the on-screen buttons. Web Bluetooth requires a user gesture; the agent cannot do this.

8. Verify the app responds:

   ```bash
   BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
   curl -sf "$BASE_URL/api/rider" | head -c 200
   ```

   A JSON rider profile means the app is up. Move on to Step 1.

   If the root page hangs or returns slowly during first compile, keep waiting and retry `/api/rider`. A 000/connection error during the first minute is not enough evidence that startup failed.

## Step 1: Pick The Right Skill File

There is one pre-built skill file per agent flavor, in [`dist/`](dist/):

- Hermes -> [`dist/agent-skill.hermes.md`](dist/agent-skill.hermes.md)
- OpenClaw -> [`dist/agent-skill.openclaw.md`](dist/agent-skill.openclaw.md)

These files are self-contained: endpoints, command shapes, hook events, and the operating loop. No fetches needed at runtime.

Each file starts with a `kickr-skill-version` line. If your installed copy's version differs from the one here, replace it.

## Step 2: Hermes Install

1. Read [`dist/agent-skill.hermes.md`](dist/agent-skill.hermes.md) and copy it to your Hermes skills directory:

   ```bash
   mkdir -p ~/.hermes/skills/kickr-local-coach
   cp .agents/skills/kickr-local-coach/dist/agent-skill.hermes.md \
      ~/.hermes/skills/kickr-local-coach/SKILL.md
   ```

2. If this is the **first** install on this machine, also do the one-time wiring described in [`references/hermes-hooks.md`](references/hermes-hooks.md):
   - Enable the Hermes API Server in `~/.hermes/.env`.
   - Add `HERMES_API_URL`, `HERMES_API_KEY`, `HERMES_KICKR_SESSION_ID` to the KICKR app `.env.local`.
   - Restart `next dev`.
   - Smoke-test `POST /api/agent/hooks/trigger`.

3. Confirm install:

   ```bash
   head -1 ~/.hermes/skills/kickr-local-coach/SKILL.md
   # should print: kickr-skill-version: 2
   ```

4. From now on, coaching turns should rely on the installed skill. Do not re-open this repo unless step 5 fires.

5. Re-run install when the KICKR app is upgraded **or** when a coaching turn fails with a contract mismatch (unknown endpoint, unexpected field).

## Step 2: OpenClaw Install

1. Read [`dist/agent-skill.openclaw.md`](dist/agent-skill.openclaw.md) and copy it to your OpenClaw skills directory (adjust path to match your OpenClaw install):

   ```bash
   mkdir -p ~/.openclaw/skills/kickr-local-coach
   cp .agents/skills/kickr-local-coach/dist/agent-skill.openclaw.md \
      ~/.openclaw/skills/kickr-local-coach/SKILL.md
   ```

2. If this is the **first** install on this machine, also do the one-time wiring described in [`references/openclaw-hooks.md`](references/openclaw-hooks.md):
   - Enable hooks in OpenClaw config with a dedicated token.
   - Add `OPENCLAW_HOOKS_URL`, `OPENCLAW_HOOKS_TOKEN` to the KICKR app `.env.local`.
   - Comment out any `HERMES_API_URL` to make sure the OpenClaw branch is selected.
   - Restart `next dev`.
   - Smoke-test `POST /api/agent/hooks/trigger`.

3. Confirm install:

   ```bash
   head -1 ~/.openclaw/skills/kickr-local-coach/SKILL.md
   # should print: kickr-skill-version: 2
   ```

4. Same as Hermes: do not re-read this repo until upgrade or contract mismatch.

## What Lives Where

| Information | Location | Read When |
| --- | --- | --- |
| Operating contract (endpoints, commands, hooks) | Installed skill in agent workspace | Every coaching turn |
| One-time setup (env vars, gateway config, smoke tests) | `references/*.md` in this repo | First install, troubleshooting |
| KICKR app internals (FTMS, SQLite, Bluetooth, workout player) | `AGENTS.md` and source in this repo | Only when editing the app itself |

The installed skill intentionally omits app internals. Agents do not need to know how the app talks to the trainer; they only need to know how to talk to the app.

## Drift Checklist

If a coaching turn produces an error like "endpoint not found", "field missing", or unexpected hook payloads:

1. Compare `kickr-skill-version` in your installed skill vs `dist/agent-skill.<agent>.md` in this repo.
2. If they differ, re-copy and overwrite.
3. If they match, the bug is in the app or the wiring — see the matching `references/*.md`.
