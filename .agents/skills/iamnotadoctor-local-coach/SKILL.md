---
name: iamnotadoctor-local-coach
description: Use when integrating an agent with this iamnotadoctor app - choosing Local or Hosted setup, connecting over MCP or HTTP, rider onboarding, ride history and summaries, rider memory, workouts, or trainer control on request.
---

# iamnotadoctor Agent Integration

The iamnotadoctor app owns Bluetooth, the workout player, live coaching, workout building, and ride-summary LLM calls. Agents connect over the app's MCP server (`/api/mcp`) or HTTP endpoints, either locally or on the rider's own domain.

## If You Are An Agent Pointed At This Repo

Do not operate from this authoring file at runtime:

1. Read [INSTALL.md](INSTALL.md). It starts by explaining the **Local** and **Hosted** setups and their trade-offs; let the user choose.
2. Set up the chosen path, connect to `/api/mcp`, and copy [`dist/agent-skill.md`](dist/agent-skill.md) into your skills directory.
3. Ask the rider for first-run onboarding context: age, broad fitness level, cycling background, goals, and constraints.
4. Stop reading this repo. Use the installed skill for future turns.

## Agent Scope

Agents may:

- read and update the rider profile and `memorySummary` (with approval)
- query saved rides, ride stats, LLM ride summaries, and monthly summaries
- list, build, save, and delete workouts
- control the trainer through the MCP trainer tools when the rider asks, via the open app tab

Agents must not:

- talk directly to Bluetooth or FTMS
- read/write `.data/iamnotadoctor.sqlite`
- run high-frequency loops against trainer tools; live in-ride coaching belongs to the app
- update FTP, cTHR, HR zones, or other rider-entered values without explicit confirmation
- print or commit the hosted `APP_AUTH_TOKEN`

## Authoring Notes

- `dist/agent-skill.md` is the self-contained operating contract. Bump its `iamnotadoctor-skill-version` whenever the contract changes so installed copies detect drift.
- Keep app internals (FTMS, SQLite schema, player internals) out of the dist skill; they live in `AGENTS.md`.

## References

- [INSTALL.md](INSTALL.md) - setup choice, Local and Hosted steps, agent connection, onboarding
- [`docs/HOSTING.md`](../../../docs/HOSTING.md) - full hosted setup
- [references/api.md](references/api.md) - HTTP API contract for rider profile and sessions
