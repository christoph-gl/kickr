# Hermes Integration Notes

Use this when the local coach agent is Hermes rather than OpenClaw.

## Important Distinction

Hermes hook docs describe hooks that run inside Hermes at lifecycle points:

- Gateway hooks: `HOOK.yaml` plus `handler.py` under `~/.hermes/hooks/`, gateway only.
- Plugin hooks: Python plugins that call `ctx.register_hook()`, CLI plus gateway.
- Shell hooks: `hooks:` entries in `~/.hermes/config.yaml` that run scripts, CLI plus gateway.

These are not the same as OpenClaw's mapped inbound HTTP endpoint at `/hooks/kickr`.

Do not assume the KICKR app can POST directly to Hermes just because Hermes has hooks. First confirm whether the user's Hermes setup exposes an inbound HTTP/message surface. If it does not, keep Phase 1 agent-only and postpone app-initiated wakeups or build a tiny local relay outside the KICKR app.

Hermes also has an API Server feature. That is the preferred KICKR -> Hermes wakeup path when enabled, because it exposes HTTP endpoints that can start agent runs.

## Phase 1: Hermes Agent Commands

The first Hermes integration should use the same KICKR API contract as OpenClaw:

1. Discover the KICKR base URL:
   ```bash
   portless get kickr
   ```
   Fallback: `http://localhost:3000`.
2. Read:
   - `GET <base-url>/api/rider`
   - `GET <base-url>/api/agent/events?limit=5`
   - `GET <base-url>/api/sessions`
3. Implement or document Hermes-side commands:
   - `/kickr_status`
   - `/kickr_message <text>`
   - `/kickr_set_erg <watts>`
4. Queue trainer commands through `POST <base-url>/api/agent/commands`.
5. Verify trainer commands by reading a later `ride_snapshot.activeTrainerMode`.

Canonical command payloads:

```json
{"type":"send_message","text":"KICKR Hermes bridge connected","reason":"integration smoke test"}
{"type":"send_message","text":"Text only; do not speak this one","speak":false}
{"type":"set_erg_watts","watts":220,"reason":"Hermes command"}
{"type":"set_resistance","percent":35,"reason":"Hermes command"}
```

## Useful Hermes Hook Uses

Hermes hooks are still useful around the agent:

- Gateway hook on `gateway:startup`: run a startup checklist that confirms the KICKR app is reachable and logs status.
- Gateway hook on `command:*`: log `/kickr_*` command usage.
- Plugin or shell hook on `pre_tool_call`: block accidental direct Bluetooth, FTMS, or `.data/kickr.sqlite` edits from Hermes glue.
- Plugin or shell hook on `pre_llm_call`: inject current KICKR context from `/api/rider` and `/api/agent/events?limit=20` before a coaching turn.

Keep these hooks agent-side. They should call the KICKR HTTP APIs; they should not import app code or talk directly to Web Bluetooth.

## Example Gateway Hook: Log KICKR Commands

Create:

```txt
~/.hermes/hooks/kickr-command-log/
  HOOK.yaml
  handler.py
```

`HOOK.yaml`:

```yaml
name: kickr-command-log
description: Log KICKR slash command usage
events:
  - command:*
```

`handler.py`:

```python
import json
from datetime import datetime
from pathlib import Path

LOG = Path.home() / ".hermes" / "logs" / "kickr_commands.jsonl"

def handle(event_type: str, context: dict):
    command = context.get("command", "")
    if not str(command).startswith("kickr"):
        return

    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a") as f:
        f.write(json.dumps({
            "ts": datetime.now().isoformat(),
            "event": event_type,
            "command": command,
            "args": context.get("args"),
            "platform": context.get("platform"),
            "session_id": context.get("session_id"),
        }) + "\n")
```

Restart Hermes gateway after adding gateway hooks.

## Example Shell Hook: Inject KICKR Context

Use this only if the user wants every Hermes turn to see a small KICKR summary. Keep it short to avoid noisy prompts.

`~/.hermes/config.yaml`:

```yaml
hooks:
  pre_llm_call:
    - command: "~/.hermes/agent-hooks/inject-kickr-context.sh"
```

`~/.hermes/agent-hooks/inject-kickr-context.sh`:

```bash
#!/usr/bin/env bash
cat - >/dev/null

base_url="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
rider="$(curl -fsS "$base_url/api/rider" 2>/dev/null || true)"
events="$(curl -fsS "$base_url/api/agent/events?limit=5" 2>/dev/null || true)"

if [[ -z "$rider" && -z "$events" ]]; then
  printf '{}\n'
  exit 0
fi

jq --null-input \
  --arg rider "$rider" \
  --arg events "$events" \
  '{context: ("KICKR local context:\nRider: " + $rider + "\nRecent events: " + $events)}'
```

Hermes shell hooks require consent unless the user enables one of Hermes' hook auto-accept paths. Do not silently add this to a user's config.

## App-Initiated Wakeups

The KICKR app has a generic server-side outbound hook route:

```txt
POST /api/agent/hooks/trigger
```

The route now has a built-in Hermes adapter. If `HERMES_API_URL` is set, the route forwards to `${HERMES_API_URL}/v1/runs` with `{session_id, input, metadata}` and `Authorization: Bearer ${HERMES_API_KEY}`. The full KICKR payload (event, sessionId, snapshot, message) is preserved inside `metadata` so the Hermes agent still gets full context.

**Do not set `OPENCLAW_HOOKS_URL` to a Hermes endpoint.** That payload shape will not match. Use the Hermes-specific env vars below.

Preferred Hermes wakeup path:

1. Enable the Hermes API Server in `~/.hermes/.env`:

```txt
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev
```

2. Start the Hermes gateway:

```bash
hermes gateway
```

3. Confirm it is listening. The documented default is:

```txt
http://127.0.0.1:8642
```

4. Trigger a Hermes run from a trusted local caller:

```bash
curl -X POST http://127.0.0.1:8642/v1/runs \
  -H "Authorization: Bearer <API_SERVER_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "kickr-local-coach",
    "input": "KICKR coach check: read the local KICKR APIs, inspect recent ride context, then decide whether to send coaching text or queue a trainer command."
  }'
```

5. Poll or stream the run if needed:

```bash
curl http://127.0.0.1:8642/v1/runs/<run_id> \
  -H "Authorization: Bearer <API_SERVER_KEY>"
curl http://127.0.0.1:8642/v1/runs/<run_id>/events \
  -H "Authorization: Bearer <API_SERVER_KEY>"
```

This path preserves a coaching conversation by using a stable `session_id`, for example `kickr-local-coach`.

5. Add the Hermes adapter env vars to the KICKR app `.env.local`:

```txt
HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=<API_SERVER_KEY>
HERMES_KICKR_SESSION_ID=kickr-local-coach
```

   And **comment out or remove `OPENCLAW_HOOKS_URL`** in the same file to keep diagnostics clean (Hermes wins when both are set, but a stale OpenClaw URL can mislead during debugging).

6. Restart the Next.js dev server. Next.js does not pick up `.env.local` via hot reload.

7. Smoke-test the round trip:

```bash
BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
curl -X POST "$BASE_URL/api/agent/hooks/trigger" \
  -H "Content-Type: application/json" \
  -d '{"event":"coach_check","sessionId":null,"snapshot":{"source":"setup-smoke-test"}}'
```

Expected result:
- `{"sent":true,"target":"hermes"}` when Hermes is reachable.
- `{"sent":true,"target":"openclaw"}` means `HERMES_API_URL` is missing from `.env.local` — the route fell back to OpenClaw.
- `ECONNREFUSED 127.0.0.1:18789` means the same: Next.js did not see `HERMES_API_URL`. Confirm it is in `.env.local` (not only `.env.example`) and that `next dev` was restarted.
- `ECONNREFUSED 127.0.0.1:8642` means the Hermes gateway is not running. Start it with `hermes gateway`.
- non-2xx with `target:"hermes"` means inspect Hermes API Server config and `API_SERVER_KEY`.

Older fallback options if API Server is unavailable:

1. If the user's Hermes gateway exposes a different inbound HTTP/message API, build a tiny local relay outside the KICKR app that translates the KICKR payload to that surface.
2. If Hermes only has lifecycle hooks, create a tiny local relay outside the KICKR app. The relay receives KICKR POSTs and triggers Hermes through a supported CLI, gateway, or messaging path.
3. If neither exists yet, keep manual `coach_check` and slash commands as Phase 1 and postpone app-initiated wakeups.

The relay, if built, should preserve the same KICKR payload shape:

```json
{
  "source": "kickr",
  "event": "coach_check",
  "timestamp": 1777600000000,
  "sessionId": "ride-1777600000000",
  "message": "KICKR coach check: read the local KICKR context APIs, then decide whether to send coaching text or queue a trainer command.",
  "snapshot": {}
}
```

## Do Not

- Do not edit the KICKR Next.js app for Hermes Phase 1.
- Do not treat Hermes gateway hooks as inbound HTTP endpoints.
- Do not put KICKR Bluetooth or FTMS code in Hermes hooks.
- Do not wake Hermes on every telemetry sample.
- Do not read or write `.data/kickr.sqlite` directly from Hermes glue unless the user explicitly asks for DB maintenance.
