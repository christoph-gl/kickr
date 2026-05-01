# Workout Planning

Use this reference for conversational workout selection or generation.

This is a second-phase feature. Do not build it before the basic status/message/set-ERG Telegram commands and app wakeup hook round trip work.

## Conversation Flow

Example rider prompt:

```txt
Today I want about 45 minutes, feeling medium good, focus endurance.
```

Agent response should ask whether to use an existing workout or create one:

```txt
Want me to pick from existing workouts, or create a new endurance ride from scratch?
```

If existing:
- Read `GET /api/workouts`.
- Read `GET /api/sessions` for recent fatigue/preferences.
- Offer 2-4 suitable options.

If new:
- Read `GET /api/rider`.
- Create a `Workout` object with `durationSeconds` and absolute `targetPower` values.
- Save it with `POST /api/workouts`.
- Tell the rider the name, duration, and basic structure.

## Endurance Workout Guidelines

Use `riderProfile.fourDP.ftp` for power targets.

For a 45-minute medium-good endurance ride:
- 8-10 min progressive warmup from 45-70% FTP.
- 25-30 min mostly 65-78% FTP.
- Optional short tempo checks at 80-88% FTP if the rider asked for “slightly spicy.”
- 5 min cooldown from 60% FTP downward.

Example block pattern:

```ts
[
  { durationSeconds: 300, targetPower: Math.round(ftp * 0.50) },
  { durationSeconds: 300, targetPower: Math.round(ftp * 0.65) },
  { durationSeconds: 900, targetPower: Math.round(ftp * 0.72) },
  { durationSeconds: 180, targetPower: Math.round(ftp * 0.84) },
  { durationSeconds: 600, targetPower: Math.round(ftp * 0.74) },
  { durationSeconds: 180, targetPower: Math.round(ftp * 0.84) },
  { durationSeconds: 300, targetPower: Math.round(ftp * 0.60) },
  { durationSeconds: 180, targetPower: Math.round(ftp * 0.45) }
]
```

## Missing App Commands

The app can currently save workouts and set trainer power/resistance, but it does not yet expose agent commands to:
- select a workout in the player
- start workout playback
- pause workout playback
- reset workout playback

Until those exist, agents can create/save a workout and instruct the rider to select it in the UI, or they can control the trainer directly with ERG commands.

Future useful commands:

```ts
{ type: "select_workout"; workoutId: string }
{ type: "start_workout" }
{ type: "pause_workout" }
{ type: "reset_workout" }
```
