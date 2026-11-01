# Optional Telegram Tracking Notes

Telegram can be used as a conversation surface for personal fitness tracking. A Telegram bot usually runs on a server, so it needs the **Hosted** setup (`docs/HOSTING.md`) unless it runs on the rider's own computer.

Recommended commands:

- `/inad_status` - summarize rider profile, latest saved ride, and trainer status.
- `/inad_recent` - summarize the last 3-5 saved rides, prioritizing `llmSummary`.
- `/inad_week` - this week's training load compared with recent weeks.
- `/inad_export` - prepare a compact fitness-tracking entry from recent rides.
- `/inad_memory_update` - propose a short rider memory update and ask before writing it.

Trainer changes from chat (for example "set 180 watts") go through the MCP trainer tools, one command per rider message, after checking `get_trainer_status`. Do not build automated loops that adjust the trainer; live in-ride coaching belongs to the app.
