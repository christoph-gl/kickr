# OpenClaw Hook First Cut

Use this only for Phase 2, after the OpenClaw-only Phase 1 commands work. Phase 1 must not edit the KICKR Next.js app.

## Fixed Decisions

- The KICKR app should not contain Telegram-specific code.
- Use one outbound hook target configured by env vars.
- Use a mapped OpenClaw hook named `kickr`.
- Keep hook payloads structured JSON.
- Use a dedicated hook token. Do not reuse gateway auth tokens.
- First wake events only: `ride_started`, `ride_ended`, `rider_feedback`, `coach_check`.

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
    body: JSON.stringify({ source: "kickr", timestamp: Date.now(), ...payload }),
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
