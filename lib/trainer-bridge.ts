import type { Workout } from "./workouts";

// In-memory relay between MCP tools (server) and the open app tab (browser).
// The browser owns Web Bluetooth, so trainer commands are queued here and the
// tab picks them up through POST /api/trainer-bridge, executes them, and
// reports results on its next sync.

export type TrainerBridgeCommandInput =
  | { type: "set_erg_power"; watts: number }
  | { type: "set_resistance"; level: number }
  | { type: "load_workout"; workout: Workout }
  | { type: "play_workout" }
  | { type: "pause_workout" }
  | { type: "seek_workout"; seconds: number }
  | { type: "finish_ride"; comments?: string }
  | { type: "discard_ride" };

export type TrainerBridgeCommand = TrainerBridgeCommandInput & {
  id: string;
  createdAt: number;
};

export type TrainerBridgeResult = {
  id: string;
  ok: boolean;
  message?: string;
};

export type TrainerBridgeStatus = {
  trainerConnection: "disconnected" | "connecting" | "connected";
  hrConnection: "disconnected" | "connecting" | "connected";
  powerW: number | null;
  cadenceRpm: number | null;
  heartRateBpm: number | null;
  activeMode: { type: "none" } | { type: "erg"; watts: number } | { type: "resistance"; level: number };
  workout: {
    id: string;
    name: string;
    durationSeconds: number;
    isPlaying: boolean;
    elapsedSeconds: number;
    currentTargetWatts: number | null;
    nextTargetWatts: number | null;
    secondsToNextTarget: number | null;
  } | null;
  sessionSampleCount: number;
};

type PendingCommand = {
  command: TrainerBridgeCommand;
  delivered: boolean;
  resolve: (result: TrainerBridgeResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

type BridgeState = {
  status: TrainerBridgeStatus | null;
  lastSyncAt: number | null;
  pending: Map<string, PendingCommand>;
};

/** A tab that has not synced within this window is treated as gone. */
export const TAB_STALE_MS = 5000;
const COMMAND_TIMEOUT_MS = 10000;

const globalForBridge = globalThis as typeof globalThis & { __trainerBridge?: BridgeState };

function bridge(): BridgeState {
  globalForBridge.__trainerBridge ??= { status: null, lastSyncAt: null, pending: new Map() };
  return globalForBridge.__trainerBridge;
}

export function isAppTabConnected() {
  const { lastSyncAt } = bridge();
  return lastSyncAt !== null && Date.now() - lastSyncAt < TAB_STALE_MS;
}

export function getTrainerBridgeStatus() {
  const state = bridge();
  return {
    appTabConnected: isAppTabConnected(),
    lastSyncAt: state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : null,
    status: state.status,
  };
}

/** Queue a command for the app tab and wait until it reports back or times out. */
export function sendTrainerCommand(input: TrainerBridgeCommandInput): Promise<TrainerBridgeResult> {
  const id = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!isAppTabConnected()) {
    return Promise.resolve({
      id,
      ok: false,
      message: "No iamnotadoctor app tab is open. Open the app in Chrome or Edge and connect the trainer first.",
    });
  }

  const state = bridge();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const entry = state.pending.get(id);
      state.pending.delete(id);
      resolve({
        id,
        ok: false,
        message: entry?.delivered
          ? "The app tab received the command but did not confirm it in time."
          : "The app tab did not pick up the command in time.",
      });
    }, COMMAND_TIMEOUT_MS);

    state.pending.set(id, {
      command: { ...input, id, createdAt: Date.now() },
      delivered: false,
      resolve,
      timer,
    });
  });
}

/** Called by the app tab: stores its status, settles reported results, hands out new commands. */
export function syncTrainerBridge(status: TrainerBridgeStatus, results: TrainerBridgeResult[]) {
  const state = bridge();
  state.status = status;
  state.lastSyncAt = Date.now();

  for (const result of results) {
    const entry = state.pending.get(result.id);
    if (!entry) continue;
    clearTimeout(entry.timer);
    state.pending.delete(result.id);
    entry.resolve(result);
  }

  const commands: TrainerBridgeCommand[] = [];
  for (const entry of state.pending.values()) {
    if (entry.delivered) continue;
    entry.delivered = true;
    commands.push(entry.command);
  }
  return commands;
}
