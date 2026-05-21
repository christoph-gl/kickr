# Legacy Hermes Hook Notes

This file is intentionally deprecated.

The current KICKR app architecture does not use Hermes for live coaching, trainer control, route control, workout adaptation, or app wakeups. The app owns those flows internally through its own LLM routes and browser-owned Bluetooth session.

Fresh Hermes agents should install `dist/agent-skill.hermes.md` and use only:

- `GET /api/rider`
- `PUT /api/rider`
- `GET /api/sessions`
- `GET /api/monthly-summaries`

Use Hermes for personal fitness tracking after rides: onboarding age and fitness context, summarizing completed rides, exporting results, and proposing rider-memory updates from app-generated `llmSummary` fields.

Do not configure Hermes API Server hooks for KICKR unless the user explicitly asks to revive the old external-agent-control architecture.
