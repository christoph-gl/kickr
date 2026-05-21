# Optional Telegram Tracking Notes

Telegram can be used as a conversation surface for personal fitness tracking, not trainer control.

Recommended commands:

- `/kickr_status` - summarize rider profile and latest saved ride.
- `/kickr_recent` - summarize the last 3-5 saved rides, prioritizing `llmSummary`.
- `/kickr_export` - prepare a compact fitness-tracking entry from recent rides.
- `/kickr_memory_update` - propose a short rider memory update and ask before writing it.

Do not implement Telegram commands that set ERG watts, resistance, routes, workouts, or live ride control unless the user explicitly asks to revive the old external-agent-control architecture.
