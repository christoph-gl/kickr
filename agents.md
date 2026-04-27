# LLM AI Agents Guidelines (`agents.md`)

This document provides instructions and context for any Large Language Model (LLM) or AI agent working on the KICKR CORE 2 Web Controller project.

## Context & Domain

This is a **Next.js (App Router) / React / TypeScript** application interacting directly with a Wahoo KICKR CORE 2 Smart Trainer and an external Bluetooth Heart Rate Monitor (HRM).
Communication relies heavily on the **Web Bluetooth API** (`navigator.bluetooth`).

### FTMS (Trainer) Constraints
- **FTMS Service UUID:** `0x1826`
- **Indoor Bike Data Characteristic UUID:** `0x2ad2`
- **Fitness Machine Control Point Characteristic UUID:** `0x2ad9`

### HRM Constraints
- **Heart Rate Service UUID:** `0x180d`
- **Heart Rate Measurement Characteristic UUID:** `0x2a37`

## Core Concepts to Retain

1. **Bluetooth Constraints:** 
   - Bluetooth connection requests MUST be triggered by user interactions (e.g. `onClick` of a button).
   - Web Bluetooth requires HTTPS or `localhost` (secure context) to function.
   - Disconnect handling is crucial (`gattserverdisconnected` events) for multiple parallel connections.
2. **FTMS Specifics:**
   - **ERG Mode (Target Power):** Uses Opcode `0x05`. Sends watts as `int16`. Trainer auto-adjusts resistance based on cadence.
   - **Resistance Mode:** Uses Opcode `0x04`. Sends percentage as `int16` scaled by `10` (resolution `0.1`).
   - The trainer will drop the control link or fail to execute commands if `requestControl()` (Opcode `0x00`) or `reset()` (Opcode `0x01`) is missing during initialization.
3. **Data Decoding:**
   - The Indoor Bike Data parser requires reading a `flags` bitmask to determine exactly which values (cadence, power, speed, distance) are present in the byte array.
   - Heart rate is pulled primarily from the external HRM (`hr-client.ts`), but can be supplemented via the FTMS payload if the trainer provides it natively.

## UI/UX Rules

- Follow the existing **shadcn/ui** design system (e.g. `components/ui/button.tsx`).
- Tailwind CSS is used for all styling. Use standard layout primitives (`flex`, `gap-*`, `p-*`, `grid`).
- Emphasize visual feedback for hardware state (e.g., connected, connecting, disconnected, loading spinners, connection status dots).
- Validate state and throw sensible/alert errors if the Bluetooth hardware connection drops or fails.

## Future Development Roadmap

- **Simulation Mode:** Implement FTMS Opcode `0x11` (Set Indoor Bike Simulation Parameters) for simulated grade/incline. This requires sending simulated wind resistance and track gradient.
- **Workout Builder:** Create a timeline UI where a user can define custom workouts (e.g., 5 mins at 100W, 2 mins at 250W). Provide a tick loop (e.g. `setInterval`) that updates the ERG Mode wattage automatically based on the timeline.
- **Chart Visualization:** Use a charting library (like Recharts, which is compatible with shadcn/ui) to plot Power/Cadence/HR data in real time.
- **Save Workouts:** Add offline persistence (e.g. IndexedDB or LocalStorage) to keep history of `KickrCore2Client.samples` rather than only relying on immediate CSV downloads.
