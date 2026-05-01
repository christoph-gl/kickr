# OpenClaw Hook First Cut

Use this for the KICKR app outbound hook path. The minimal path exists; future work should keep the same server-side token pattern.

## Fixed Decisions

- The KICKR app should not contain Telegram-specific code.
- Use one outbound hook target configured by env vars.
- Use a mapped OpenClaw hook named `kickr`.
- Keep hook payloads structured JSON.
- Use a dedicated hook token. Do not reuse gateway auth tokens.
- First wake events only: `ride_started`, `ride_ended`, `rider_feedback`, `coach_check`.

## Guided Setup Checklist

The agent should guide the user through setup rather than inventing values.

1. Discover OpenClaw status:

```bash
openclaw status
openclaw gateway status
```

2. If needed, inspect OpenClaw config for hook settings, gateway port, hook path, and token. Prefer OpenClaw's own status/config commands when available.

3. If hooks are not enabled, guide the user to configure:

```json
{
  "hooks": {
    "enabled": true,
    "token": "replace-with-dedicated-hook-token",
    "path": "/hooks"
  }
}
```

If OpenClaw asks whether to construct a full `config.apply` payload, the answer is yes. Build the full payload by merging in the `hooks` section while preserving unrelated config. Show the final payload to the user before applying it unless the user already explicitly approved applying it.

Required config properties:

```json
{
  "hooks": {
    "enabled": true,
    "token": "replace-with-dedicated-hook-token",
    "path": "/hooks"
  }
}
```

Rules:
- Use a dedicated hook token; do not reuse gateway auth tokens.
- Prefer a clean ASCII random token, for example from `openssl rand -hex 32`.
- Do not use Unicode characters in tokens; avoid smart punctuation and ellipses.
- Keep `hooks.path` as `/hooks`.
- Do not set `hooks.path` to `/`.
- Do not change unrelated OpenClaw config fields.
- If OpenClaw supports mapped hooks, use the mapped KICKR hook at `/hooks/kickr`.

If OpenClaw's config tool locks sensitive fields during `config.apply`, it is acceptable to edit the OpenClaw JSON config directly, but only for the `hooks` section and only while preserving unrelated config. After a direct config file edit, restart the OpenClaw gateway.

Safe fallback pattern:

```bash
TOKEN="$(openssl rand -hex 32)"
python3 - <<PY
import json
path = "/Users/christophgl/.openclaw/openclaw.json"
with open(path) as f:
    config = json.load(f)
hooks = config.setdefault("hooks", {})
hooks["enabled"] = True
hooks["path"] = "/hooks"
hooks["token"] = "$TOKEN"
with open(path, "w") as f:
    json.dump(config, f, indent=2)
print("$TOKEN")
PY
openclaw gateway restart
```

Then use the exact printed token in the KICKR app `.env.local`.

4. Confirm the mapped KICKR hook URL. Expected shape:

```txt
http://127.0.0.1:<openclaw-port>/hooks/kickr
```

5. Guide the user to add these to the KICKR app `.env.local`:

```txt
OPENCLAW_HOOKS_URL=http://127.0.0.1:<openclaw-port>/hooks/kickr
OPENCLAW_HOOKS_TOKEN=<same-dedicated-hook-token>
```

   And **comment out or remove any `HERMES_API_URL`** in the same file. If both are set, the route prefers Hermes and OpenClaw will never see the call.

6. Tell the user to restart the Next.js dev server. Next.js does not reliably pick up `.env.local` changes without restart.

7. Verify the no-browser route path:

```bash
BASE_URL="$(portless get kickr 2>/dev/null || printf http://localhost:3000)"
curl -X POST "$BASE_URL/api/agent/hooks/trigger" \
  -H "Content-Type: application/json" \
  -d '{"event":"coach_check","sessionId":null,"snapshot":{"source":"setup-smoke-test"}}'
```

Expected result:
- `{"sent":true,"target":"openclaw"}` when OpenClaw is reachable and accepts the hook.
- `{"sent":true,"target":"hermes"}` means `HERMES_API_URL` is also set and is winning — remove it if you want OpenClaw to handle this.
- `{"skipped":true}` when neither `OPENCLAW_HOOKS_URL` nor `HERMES_API_URL` is set.
- non-2xx means inspect OpenClaw hook config/token/path.

## OpenClaw Config Shape

OpenClaw should expose hooks similar to:

```json
{
  "hooks": {
    "enabled": true,
    "token": "shared-secret",
    "path": "/hooks"
  }
}
```

The mapped hook endpoint is expected to be:

```txt
POST http://127.0.0.1:<openclaw-port>/hooks/kickr
Authorization: Bearer <shared-secret>
```

Confirm the exact OpenClaw gateway port from the user's OpenClaw config/status.

## KICKR App Env Vars

Add these to `.env.local` when using hooks:

```txt
OPENCLAW_HOOKS_URL=http://127.0.0.1:<openclaw-port>/hooks/kickr
OPENCLAW_HOOKS_TOKEN=shared-secret
```

If `OPENCLAW_HOOKS_URL` is unset, the app should skip outbound hooks without throwing.

## App Helper Pattern

Preferred implementation for a future KICKR app patch:

1. Browser/client code should call a same-origin KICKR API route such as `POST /api/agent/hooks/trigger`.
2. That route should read server-only `OPENCLAW_HOOKS_URL` and `OPENCLAW_HOOKS_TOKEN`.
3. The route should forward the hook payload to OpenClaw.
4. This keeps the hook token out of the client bundle.

Client helper shape:

```ts
type KickrHookEvent =
  | { event: "ride_started"; sessionId: string | null; snapshot?: unknown }
  | { event: "ride_ended"; sessionId: string | null; snapshot?: unknown }
  | { event: "rider_feedback"; sessionId: string | null; text: string; snapshot?: unknown }
  | { event: "coach_check"; sessionId: string | null; snapshot?: unknown };

export async function sendOpenClawHook(payload: KickrHookEvent) {
  const res = await fetch("/api/agent/hooks/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return res.json();
}
```

Server route forwarding shape:

```ts
function getHookMessage(payload: KickrHookEvent) {
  const eventLabel = payload.event.replaceAll("_", " ");
  return `KICKR ${eventLabel}: read the local KICKR context APIs, then decide whether to send coaching text or queue a trainer command.`;
}

export async function POST(req: Request) {
  const url = process.env.OPENCLAW_HOOKS_URL;
  if (!url) return Response.json({ skipped: true });

  const payload = await req.json();
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.OPENCLAW_HOOKS_TOKEN
        ? { Authorization: `Bearer ${process.env.OPENCLAW_HOOKS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      source: "kickr",
      timestamp: Date.now(),
      ...payload,
      message: getHookMessage(payload),
    }),
  });

  return Response.json({ sent: true });
}
```

Do not import `process.env.OPENCLAW_HOOKS_TOKEN` into a client component or client-imported module.

## Hook Payload Guidance

A useful payload includes:

```json
{
  "source": "kickr",
  "event": "coach_check",
  "timestamp": 1777600000000,
  "sessionId": "ride-1777600000000",
  "message": "KICKR coach check: read the local KICKR context APIs, then decide whether to send coaching text or queue a trainer command.",
  "snapshot": {
    "activeTrainerMode": {"type": "erg", "watts": 210},
    "latestSample": {"powerW": 208, "cadenceRpm": 88, "heartRateBpm": 171},
    "workoutName": "Endurance 45"
  },
  "instruction": "Read KICKR context APIs, decide whether to coach or queue a command."
}
```

## OpenClaw Agent Behavior On Wake

When the `kickr` hook wakes the agent:

1. Read `GET /api/rider`.
2. Read `GET /api/agent/events?limit=200`.
3. Optionally read `GET /api/sessions`.
4. If action is useful, queue a message or command with `POST /api/agent/commands`.
5. Keep response concise, especially during rides.

## Do Not Build Yet

For the first cut, do not implement:
- high-HR trigger detection
- cadence-collapse trigger detection
- power-target-missed trigger detection
- workout player remote start/select
- full workout planning conversation

Add those after the basic wakeup round trip works.
