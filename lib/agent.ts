import type { BikeSample } from "./kickr-client";
import type { RiderProfile } from "./profile";

export type AgentCommand =
  | {
      id?: string;
      type: "set_erg_watts";
      watts: number;
      reason?: string;
    }
  | {
      id?: string;
      type: "set_resistance";
      percent: number;
      reason?: string;
    }
  | {
      id?: string;
      type: "send_message";
      text: string;
      reason?: string;
    }
  | {
      id?: string;
      type: "start_trainer";
      reason?: string;
    }
  | {
      id?: string;
      type: "stop_trainer";
      reason?: string;
    };

export type AgentCommandStatus = "queued" | "dispatched" | "applied" | "failed";

export type AgentCommandRecord = {
  id: string;
  command: AgentCommand;
  status: AgentCommandStatus;
  timestamp: number;
  message?: string;
};

export type RideSnapshotEvent = {
  type: "ride_snapshot";
  sessionId: string | null;
  timestamp: number;
  workoutName: string;
  connectionState: string;
  hrConnectionState: string;
  activeTrainerMode:
    | { type: "none" }
    | { type: "erg"; watts: number }
    | { type: "resistance"; level: number };
  latestSample?: BikeSample;
  sampleCount: number;
  riderProfile: RiderProfile;
};

export type AgentEvent =
  | RideSnapshotEvent
  | {
      type: "command_received" | "command_applied" | "command_failed";
      sessionId: string | null;
      timestamp: number;
      command: AgentCommand;
      message?: string;
    }
  | {
      type: "rider_feedback";
      sessionId: string | null;
      timestamp: number;
      text: string;
    };

export function makeAgentCommandId() {
  return `agent-command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
