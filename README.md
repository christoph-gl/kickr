# KICKR CORE 2 Web Controller

A Next.js, TypeScript, and React-based web application that connects directly to your Wahoo KICKR CORE 2 smart trainer via **Web Bluetooth** using the **Bluetooth FTMS (Fitness Machine Service)** protocol. 

## Features

- **Connect & Disconnect:** Manage Bluetooth GATT connections securely and see real-time UI state.
- **Live Telemetry:** Streams real-time Power (Watts) and Cadence (RPM) from the `Indoor Bike Data` FTMS characteristic.
- **Trainer Modes:**
  - **ERG Mode:** Set a target power (e.g. 200 W) and the trainer dynamically adjusts resistance to maintain it regardless of cadence/gearing.
  - **Resistance Mode:** Set a static percentage resistance (0-100%).
- **Data Export:** Download a `.csv` record of your ride telemetry containing timestamps, power, cadence, speed, and resistance level.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) with your browser.

> **Note:** Web Bluetooth requires a secure context (HTTPS) or `localhost`. It is currently fully supported in **Chrome** and **Edge**. Ensure no other apps (like Zwift or Wahoo app) are actively connected to your trainer, as they typically only accept one active Bluetooth control connection at a time.

## Technology Stack
- Next.js (App Router)
- React
- TypeScript
- Web Bluetooth API
- Tailwind CSS
- shadcn/ui components

## Further Development
See `agents.md` for guidelines and instructions for LLMs (like Gemini) working on this project in the future.
