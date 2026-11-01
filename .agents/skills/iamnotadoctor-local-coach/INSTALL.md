---
name: iamnotadoctor-local-fitness-tracker-install
description: One-time setup flow for agents pointed at the iamnotadoctor repo. Explain the Local and Hosted setups, set up the one the user picks, connect the agent over MCP or HTTP, install the portable skill, and collect rider onboarding context.
---

# Set Up iamnotadoctor With An Agent

The iamnotadoctor app owns Bluetooth, the workout player, live in-ride coaching, workout building, and ride-summary LLM calls. Agents connect to it to read and track rides, manage the rider profile and workouts, and, when the rider asks, drive the trainer through the app's MCP trainer tools.

After setup, operate from the installed skill and do not reread this repo unless the skill version changes.

## Step 0: Choose A Setup With The User

Before installing anything, explain both official setups and ask which one they want. Keep it short:

| | **Local** (default) | **Hosted on your own domain** |
| --- | --- | --- |
| Runs on | The computer next to the trainer | An always-on server the user controls (home server, NAS, mini PC, Raspberry Pi, VPS) |
| Address | `http://localhost:3000` | `https://kickr.example.com` |
| Pros | Zero config; no login; nothing exposed to the internet; data stays on that computer | Any agent can connect, including cloud bots; ride history available any time; stable `https://` address |
| Cons | Only agents running on that same computer can use it, and only while the app runs | Needs a domain, HTTPS reverse proxy, background service, and an access token; riding depends on internet and the server; anyone with the token can read rides and control the trainer |

Recommend **Local** unless the agent runs on a different machine than the trainer, or the user wants their agent to query rides while the riding computer is off. If you are a cloud-hosted agent, say plainly: you can only use a Local setup if the user also runs an agent on that computer; otherwise they need Hosted.

Bluetooth always runs in Chrome or Edge on the device next to the trainer, in both setups. Agents can never connect Bluetooth devices; the rider clicks **Connect** in the app.

## Step 1a: Local Setup

1. Check whether the app is already reachable:

   ```bash
   curl -sf "$(portless get iamnotadoctor 2>/dev/null || echo http://localhost:3000)/api/rider" >/dev/null \
     && echo "iamnotadoctor app is up" || echo "iamnotadoctor app is not running"
   ```

2. If not, ask where to clone it. Default suggestion: `~/coding/iamnotadoctor`.

   ```bash
   git clone https://github.com/christoph-gl/iamnotadoctor.git ~/coding/iamnotadoctor
   cd ~/coding/iamnotadoctor
   npm install
   ```

3. Create `.env.local` only when the user provides real API keys for in-app LLM features (live feedback, workout building, ride summaries, TTS, screenshot import). Do not copy `.env.example`. Do not set `APP_AUTH_TOKEN` locally; it turns on the hosted login.

4. Start the dev server:

   ```bash
   npm run dev          # http://localhost:3000
   # or
   npm run dev:portless # https://iamnotadoctor.localhost
   ```

   Do not append `-- --turbopack`. Wait 30-90 seconds on first compile before deciding it failed.

5. Verify: `curl -sf "$BASE_URL/api/rider" | head -c 200` with `BASE_URL="$(portless get iamnotadoctor 2>/dev/null || printf http://localhost:3000)"`.

6. Tell the rider to open the app in Chrome or Edge and click **Connect** for the trainer and heart-rate monitor.

## Step 1b: Hosted Setup

Follow [`docs/HOSTING.md`](../../../docs/HOSTING.md) in the repo. Ask the user for: the server (and whether you can run commands on it or they will), the domain, and which reverse proxy they use or prefer (Caddy is simplest; a named Cloudflare Tunnel suits home machines without port forwarding). In short:

1. On the server: clone, `npm install` (Node 24+).
2. `printf 'APP_AUTH_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env.local`, plus any LLM keys.
3. `npm run build`, then run `npm run start -- -H 127.0.0.1 -p 3000` as a service (systemd example in the doc).
4. HTTPS reverse proxy from the domain to `127.0.0.1:3000`, forwarding the original Host and `X-Forwarded-Proto`.
5. Verify: `/api/rider` returns **401** without the token and **200** with `Authorization: Bearer <token>`.
6. The rider opens `https://<domain>` in Chrome or Edge next to the trainer, enters the token once (stays signed in 30 days), and clicks **Connect**.

Never print, log, or commit the token. Tell the user it is in `.env.local` on the server, and store it in your own secret storage if you need it.

Not supported: serverless platforms (Vercel, Netlify, Lambda). The app needs one long-running Node process with a writable disk.

## Step 2: Connect The Agent

**Preferred: MCP.** Add the app's MCP server (Streamable HTTP) to your runtime:

- Local: `http://localhost:3000/api/mcp`, no auth. Claude Code: `claude mcp add --transport http iamnotadoctor http://localhost:3000/api/mcp`. Stdio-only runtimes: `npx -y mcp-remote http://localhost:3000/api/mcp`.
- Hosted: `https://<domain>/api/mcp` with header `Authorization: Bearer <APP_AUTH_TOKEN>`.

Smoke test: call `get_rider_profile` and `list_rides`.

**Also install the portable skill** (it carries the operating rules, and the HTTP fallback for runtimes without MCP). Copy it into your runtime's custom-skill directory as `SKILL.md`:

```bash
mkdir -p "$AGENT_SKILLS_DIR/iamnotadoctor-local-coach"
cp .agents/skills/iamnotadoctor-local-coach/dist/agent-skill.md \
   "$AGENT_SKILLS_DIR/iamnotadoctor-local-coach/SKILL.md"
head -2 "$AGENT_SKILLS_DIR/iamnotadoctor-local-coach/SKILL.md"
# should print: iamnotadoctor-skill-version: 9
```

If you cannot read the repo files directly (for example a cloud agent and the repo lives on the user's machine), fetch the same file from `https://raw.githubusercontent.com/christoph-gl/iamnotadoctor/public-facing/.agents/skills/iamnotadoctor-local-coach/dist/agent-skill.md`.

Record in your own memory which setup the user chose and the base URL. Keep the token in secret storage, not in plain notes.

## Step 3: Rider Onboarding

On first setup, ask the rider:

- age
- broad fitness level and cycling background
- current goals and constraints
- optional: weight, gender, known FTP/4DP/cTHR, HR-zone preferences

Then read the profile (`get_rider_profile` or `GET /api/rider`) and update only supported fields:

- `age` for numeric age
- `weightKg`, `gender`, `cTHR`, `fourDP` only when the rider provided explicit values
- `memorySummary` for qualitative fitness level, goals, constraints, and tracking preferences

## Drift Checklist

If behavior or response shapes no longer match:

1. Compare `iamnotadoctor-skill-version` in the installed skill with `dist/agent-skill.md`.
2. If they differ, re-copy the skill.
3. If they match, use `references/api.md` for the current HTTP contract, or list the MCP server's tools.
