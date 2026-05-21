# Legacy OpenClaw Hook Notes

This file is intentionally deprecated.

The current KICKR app architecture does not use OpenClaw for live coaching, trainer control, route control, workout adaptation, or app wakeups. The app owns those flows internally through its own LLM routes and browser-owned Bluetooth session.

Fresh OpenClaw agents should install `dist/agent-skill.openclaw.md` and use only:

- `GET /api/rider`
- `PUT /api/rider`
- `GET /api/sessions`
- `GET /api/monthly-summaries`

Use OpenClaw for personal fitness tracking after rides: onboarding age and fitness context, summarizing completed rides, exporting results, and proposing rider-memory updates from app-generated `llmSummary` fields.

Do not configure OpenClaw inbound hooks for KICKR unless the user explicitly asks to revive the old external-agent-control architecture.
