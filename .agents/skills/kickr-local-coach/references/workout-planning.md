# Legacy External Workout Planning Notes

This file is intentionally deprecated for fresh external-agent installs.

The KICKR app now owns workout building through `POST /api/workout-builder`, using the rider profile and the last saved ride summaries. External agents should not create routes, rewrite workouts, or control trainer load by default.

Fresh agents should focus on post-ride tracking:

- read `/api/sessions`
- use app-generated `llmSummary` fields
- help the rider export results to their personal fitness tracking system
- propose concise `memorySummary` updates after completed rides

Only revisit external workout planning if the user explicitly asks to revive that older architecture.
