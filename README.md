# KICKR CORE 2 Web Controller

A Next.js, TypeScript, and React-based web application that connects directly to your Wahoo KICKR CORE 2 smart trainer and a Bluetooth Heart Rate Monitor via **Web Bluetooth**.

## Features

- **Connect & Disconnect:** Manage Bluetooth GATT connections securely and see real-time UI state for both the Smart Trainer and a separate Heart Rate Monitor (like an Amazfit pulse watch).
- **Live Telemetry:** Streams real-time Power (Watts) and Cadence (RPM) from the `Indoor Bike Data` FTMS characteristic, synchronized with live Heart Rate (BPM) from a secondary Bluetooth HRM.
- **Trainer Modes:**
  - **ERG Mode:** Set a target power (e.g. 200 W) and the trainer dynamically adjusts resistance to maintain it regardless of cadence/gearing.
  - **Resistance Mode:** Set a static percentage resistance (0-100%).
- **Interactive Workout Player:**
  - Visualize your workout timeline with a dynamic, color-coded SVG chart scaled to your personal 4DP® profile.
  - Play, pause, or click to seek to any point in the workout—your trainer's ERG resistance will instantly update.
  - Real-time calculations of workout metrics including Normalized Power (NP), Intensity Factor (IF®), and Training Stress Score (TSS®).
  - **Screen Wake Lock:** Automatically prevents your computer or tablet from sleeping or dimming the screen during an active workout session.
- **Workout Imports:**
  - **ZWO Files:** Parse and load industry-standard Zwift XML workout files directly in the browser.
  - **AI Image Import:** Upload a screenshot of a 4DP® or ERG workout chart, and the Vercel AI SDK (via Vercel AI Gateway) will automatically extract the structure and translate it into a playable workout scaled to your profile.
- **Rider Profile Management:** Configure and store your Neuromuscular Power (NM), Anaerobic Capacity (AC), Maximal Aerobic Power (MAP), Functional Threshold Power (FTP), and Cycling Threshold Heart Rate (cTHR) zones.
- **Data Export:** Download a `.csv` record of your ride telemetry containing timestamps, power, cadence, speed, heart rate, and resistance level.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up your AI Gateway (Required for Image Imports):
   Create a `.env.local` file in the root directory and add your Vercel AI Gateway Key:
   ```
   AI_GATEWAY_API_KEY=your_key_here
   AI_GATEWAY_MODEL=google/gemini-3-flash
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) with your browser.

> **Note:** Web Bluetooth requires a secure context (HTTPS) or `localhost`. It is currently fully supported in **Chrome** and **Edge**. Ensure no other apps (like Zwift or Wahoo app) are actively connected to your trainer, as they typically only accept one active Bluetooth control connection at a time.

## Technology Stack
- Next.js (App Router)
- React
- TypeScript
- Web Bluetooth API (FTMS protocol for trainer, standard HRM protocol for heart rate)
- Vercel AI SDK (`ai` and `zod`) for image-to-workout extraction
- Tailwind CSS
- shadcn/ui components

## Further Development
See `agents.md` for guidelines and instructions for LLMs (like Gemini) working on this project in the future.
