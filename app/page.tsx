"use client";

import { useRef, useState, useEffect } from "react";
import { KickrCore2Client } from "@/lib/kickr-client";
import { HeartRateClient } from "@/lib/hr-client";
import { Button } from "@/components/ui/button";
import { Cog, LoaderCircle, Volume2, VolumeX } from "lucide-react";
import { getRiderProfile, RIDER_PROFILE, saveRiderProfile, type RiderProfile } from "@/lib/profile";
import type { AgentCommand, AgentEvent } from "@/lib/agent";
import { hookRideEnded, hookRideStarted } from "@/lib/openclaw-hooks";
import { WorkoutPlayer, type WorkoutPlayerHandle } from "@/components/workout-player";
import { 
  RideSession, 
  saveRideSession, 
  getSavedRideSessions, 
  deleteRideSession, 
  calculateActualMetrics 
} from "@/lib/sessions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ConnectionState = "disconnected" | "connecting" | "connected";
type TrainerMode = "erg" | "resistance";
type ActiveTrainerMode = { type: "none" } | { type: "erg", watts: number } | { type: "resistance", level: number };
type AgentJournalEntry = {
  id: string;
  timestamp: number;
  label: string;
  reason?: string;
  status: "received" | "applied" | "failed";
  message?: string;
};
type LiveCoachTurn = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  command?: string;
  execution?: "applied" | "failed" | "none";
};
type LiveCoachChatMessage = LiveCoachTurn & {
  id: string;
  kind: "text" | "audio" | "action" | "status";
};
// Voice feedback states & helper types removed

export default function App() {
  const clientRef = useRef(new KickrCore2Client());
  const hrClientRef = useRef(new HeartRateClient());

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [hrConnectionState, setHrConnectionState] = useState<ConnectionState>("disconnected");

  const [power, setPower] = useState<number | undefined>();
  const [cadence, setCadence] = useState<number | undefined>();
  const [heartRate, setHeartRate] = useState<number | undefined>();
  const [riderProfile, setRiderProfile] = useState<RiderProfile>(RIDER_PROFILE);
  const [settingsProfile, setSettingsProfile] = useState<RiderProfile>(RIDER_PROFILE);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  // Controls
  const [mode, setMode] = useState<TrainerMode>("erg");
  const [resistance, setResistance] = useState(20);
  const [targetPower, setTargetPower] = useState(150);
  
  // What the trainer is currently running
  const [activeTrainerMode, setActiveTrainerMode] = useState<ActiveTrainerMode>({ type: "none" });
  const [agentJournal, setAgentJournal] = useState<AgentJournalEntry[]>([]);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [voiceFeedbackEnabled, setVoiceFeedbackEnabled] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [liveCoachInput, setLiveCoachInput] = useState("");
  const [liveCoachMessages, setLiveCoachMessages] = useState<LiveCoachChatMessage[]>([]);
  const [liveCoachSending, setLiveCoachSending] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [savedSummarySession, setSavedSummarySession] = useState<RideSession | null>(null);
  const [isSavedSummaryOpen, setIsSavedSummaryOpen] = useState(false);

  const [sessions, setSessions] = useState<RideSession[]>([]);
  const currentSessionFilenameRef = useRef<string | null>(null);
  const activeWorkoutNameRef = useRef<string>("Manual Ride");
  const workoutPlayerRef = useRef<WorkoutPlayerHandle | null>(null);
  const unsavedSamplesRef = useRef<any[]>([]);
  const pollingAgentCommandsRef = useRef(false);
  const activeHookSessionRef = useRef<string | null>(null);
  const lastSpokenAgentMessageRef = useRef<{ text: string; timestamp: number } | null>(null);
  const liveCoachTurnsRef = useRef<LiveCoachTurn[]>([]);

  useEffect(() => {
    getSavedRideSessions().then(setSessions);
    getRiderProfile().then((profile) => {
      setRiderProfile(profile);
      setSettingsProfile(profile);
    });

    const hydrateVoiceFeedback = window.setTimeout(() => {
      setSpeechSupported(
        "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
      );
      setVoiceFeedbackEnabled(
        window.localStorage.getItem("kickr.voiceFeedbackEnabled") === "true"
      );
    }, 0);

    return () => window.clearTimeout(hydrateVoiceFeedback);
  }, []);

  const logSamples = async (samples: any[], isNew: boolean, finalMetrics?: any) => {
    if (!currentSessionFilenameRef.current) return;
    try {
      await fetch("/api/log-ride", {
        method: "POST",
        body: JSON.stringify({
          filename: currentSessionFilenameRef.current,
          samples,
          isNew,
          metadata: isNew ? {
            workoutName: activeWorkoutNameRef.current,
            profile: riderProfile.fourDP
          } : undefined,
          finalMetrics
        }),
      });
    } catch (e) {
      console.error("Failed to log samples to server:", e);
    }
  };

  const logAgentEvent = async (event: AgentEvent) => {
    try {
      await fetch("/api/agent/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
    } catch (e) {
      console.error("Failed to log agent event:", e);
    }
  };

  const describeAgentCommand = (command: AgentCommand) => {
    if (command.type === "set_erg_watts") return `Set ERG to ${command.watts} W`;
    if (command.type === "set_resistance") return `Set resistance to ${command.percent}%`;
    if (command.type === "set_trainer_mode" && command.mode === "erg") {
      return `Set ERG to ${command.targetWatts} W`;
    }
    if (command.type === "set_trainer_mode" && command.mode === "resistance") {
      return `Set resistance to ${command.percent ?? command.level}%`;
    }
    if (command.type === "send_message") return command.text;
    if (command.type === "request_rider_voice_feedback") {
      return command.prompt || "Request rider voice feedback";
    }
    if (command.type === "start_trainer") return "Start trainer";
    if (command.type === "stop_trainer") return "Stop trainer";
    if (command.type === "set_workout_plan") {
      const total = command.blocks.reduce((s, b) => s + (b.durationSeconds || 0), 0);
      return `New plan: ${command.blocks.length} blocks, ${Math.round(total / 60)} min`;
    }
    return "Agent command";
  };

  const updateAgentJournal = (
    command: AgentCommand,
    status: AgentJournalEntry["status"],
    message?: string
  ) => {
    const id = command.id || `agent-command-${Date.now()}`;

    setAgentJournal((prev) => {
      const existing = prev.find((entry) => entry.id === id);
      if (existing) {
        return prev.map((entry) =>
          entry.id === id
            ? { ...entry, status, message, timestamp: Date.now() }
            : entry
        );
      }

      return [
        {
          id,
          timestamp: Date.now(),
          label: describeAgentCommand(command),
          reason: command.reason,
          status,
          message,
        },
        ...prev,
      ].slice(0, 12);
    });
  };

  const setDraftProfileNumber = (
    section: "fourDP",
    key: keyof RiderProfile["fourDP"],
    value: string
  ) => {
    setSettingsProfile((profile) => ({
      ...profile,
      [section]: {
        ...profile[section],
        [key]: Number(value) || 0,
      },
    }));
  };

  const setDraftRootNumber = (key: "age" | "weightKg", value: string) => {
    setSettingsProfile((profile) => ({
      ...profile,
      [key]: value === "" ? null : Number(value),
    }));
  };

  const updateDraftHrZone = (
    zoneId: string,
    key: "name" | "percentageRange" | "minBpm" | "maxBpm" | "color",
    value: string
  ) => {
    setSettingsProfile((profile) => ({
      ...profile,
      hrZones: profile.hrZones.map((zone) =>
        zone.id === zoneId
          ? {
              ...zone,
              [key]: key === "minBpm" || key === "maxBpm" ? Number(value) || 0 : value,
            }
          : zone
      ),
    }));
  };

  const handleSettingsOpenChange = (open: boolean) => {
    if (open) {
      setSettingsProfile(riderProfile);
    }
    setIsSettingsOpen(open);
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    try {
      await saveRiderProfile(settingsProfile);
      const saved = await getRiderProfile();
      setRiderProfile(saved);
      setSettingsProfile(saved);
      setIsSettingsOpen(false);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const speakAgentMessage = (text: string, force = false) => {
    if ((!voiceFeedbackEnabled && !force) || !speechSupported) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const spokenText = text.trim().replace(/\s+/g, " ").slice(0, 240);
    if (!spokenText) return;

    const now = Date.now();
    const last = lastSpokenAgentMessageRef.current;
    if (!force && last?.text === spokenText && now - last.timestamp < 30_000) return;

    lastSpokenAgentMessageRef.current = { text: spokenText, timestamp: now };
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = navigator.language || "en-US";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const handleVoiceFeedbackToggle = (enabled: boolean) => {
    setVoiceFeedbackEnabled(enabled);
    window.localStorage.setItem("kickr.voiceFeedbackEnabled", String(enabled));

    if (!enabled) {
      window.speechSynthesis?.cancel();
      return;
    }

    speakAgentMessage("Voice feedback enabled.", true);
  };

  // Voice feedback helpers removed

  const makeLiveCoachMessageId = () =>
    `live-coach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const rememberLiveCoachTurn = (
    turn: LiveCoachTurn,
    kind: LiveCoachChatMessage["kind"] = turn.role === "assistant" ? "action" : "text"
  ) => {
    liveCoachTurnsRef.current = [...liveCoachTurnsRef.current, turn].slice(-12);
    setLiveCoachMessages((messages) =>
      [
        ...messages,
        {
          id: makeLiveCoachMessageId(),
          kind,
          ...turn,
        },
      ].slice(-24)
    );
  };

  const requestLiveCoachCommand = async (input?: { riderText?: string }) => {
    const payload = {
      snapshot: getHookSnapshot(),
      riderText: input?.riderText,
      conversationHistory: liveCoachTurnsRef.current,
    };

    const res = await fetch("/api/coach/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || "Live coach request failed");
    }

    return data as {
      model?: string;
      degraded?: boolean;
      error?: string;
      command?: AgentCommand | null;
      action?: { action?: string; reason?: string };
    };
  };

  const sendLiveCoachTurn = async (input?: {
    userText?: string;
    userKind?: LiveCoachChatMessage["kind"];
  }) => {
    if (input?.userText) {
      await logAgentEvent({
        type: "rider_feedback",
        sessionId: currentSessionFilenameRef.current,
        timestamp: Date.now(),
        text: input.userText,
      });
      rememberLiveCoachTurn(
        {
          role: "user",
          text: input.userText,
          timestamp: Date.now(),
          execution: "none",
        },
        input.userKind || "text"
      );
    }

    const response = await requestLiveCoachCommand({
      riderText: input?.userText,
    });
    let executionResult: Awaited<ReturnType<typeof executeAgentCommand>> | null = null;
    if (response.command) {
      executionResult = await executeAgentCommand(response.command);
    }
    const assistantText = response.command
      ? executionResult?.ok === false
        ? `I tried ${describeCommand(response.command)}, but it failed: ${executionResult.message}`
        : `I applied ${describeCommand(response.command)}.`
      : response.degraded
        ? `No trainer action: ${response.error || response.action?.reason || "live coach unavailable"}.`
        : `No trainer action: ${response.action?.action || "none"}.`;

    rememberLiveCoachTurn(
      {
        role: "assistant",
        text: assistantText,
        timestamp: Date.now(),
        command: response.command ? describeCommand(response.command) : undefined,
        execution: executionResult?.ok === false ? "failed" : response.command ? "applied" : "none",
      },
      response.command ? "action" : "status"
    );

    return { response, executionResult };
  };

  const describeCommand = (command: AgentCommand) => {
    if (command.type === "set_erg_watts") return `ERG ${command.watts} W`;
    if (command.type === "set_resistance") return `resistance ${command.percent}%`;
    if (command.type === "set_workout_plan") {
      const firstTarget = command.blocks[0]?.targetPower;
      return firstTarget ? `workout plan from ${firstTarget} W` : "workout plan";
    }
    if (command.type === "send_message") return "coach message";
    if (command.type === "request_rider_voice_feedback") return "voice feedback request";
    if (command.type === "start_trainer") return "trainer start";
    if (command.type === "stop_trainer") return "trainer stop";
    if (command.type === "set_trainer_mode" && command.mode === "erg") {
      return `ERG ${command.targetWatts} W`;
    }
    if (command.type === "set_trainer_mode" && command.mode === "resistance") {
      return `resistance ${command.percent ?? command.level}%`;
    }
    return (command as { type: string }).type;
  };

  const sendLiveCoachText = async () => {
    const text = liveCoachInput.trim();
    if (!text || liveCoachSending) return;
    setLiveCoachInput("");
    setLiveCoachSending(true);

    try {
      await sendLiveCoachTurn({ userText: text, userKind: "text" });
    } catch (error) {
      console.error("Error sending live coach text:", error);
    } finally {
      setLiveCoachSending(false);
    }
  };

  const currentHrZone = heartRate 
    ? riderProfile.hrZones.find(z => heartRate >= z.minBpm && heartRate <= z.maxBpm) 
    : undefined;

  const averageRecentSampleValue = (
    samples: typeof clientRef.current.samples,
    windowMs: number,
    key: "powerW" | "cadenceRpm" | "heartRateBpm"
  ) => {
    const cutoff = Date.now() - windowMs;
    const values = samples
      .filter((sample) => sample.timestamp >= cutoff)
      .map((sample) => sample[key])
      .filter((value): value is number => typeof value === "number");

    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  };

  const getHeartRateTrend = (samples: typeof clientRef.current.samples) => {
    const cutoff = Date.now() - 60_000;
    const values = samples
      .filter(
        (sample) =>
          sample.timestamp >= cutoff && typeof sample.heartRateBpm === "number"
      )
      .map((sample) => ({
        timestamp: sample.timestamp,
        heartRateBpm: sample.heartRateBpm as number,
      }));

    if (values.length < 2) return null;

    const first = values[0];
    const last = values[values.length - 1];
    const minutes = (last.timestamp - first.timestamp) / 60_000;
    if (minutes <= 0) return null;

    return Number(((last.heartRateBpm - first.heartRateBpm) / minutes).toFixed(1));
  };

  const getRollingSnapshot = (samples: typeof clientRef.current.samples) => ({
    powerAvg15s: averageRecentSampleValue(samples, 15_000, "powerW"),
    powerAvg60s: averageRecentSampleValue(samples, 60_000, "powerW"),
    cadenceAvg15s: averageRecentSampleValue(samples, 15_000, "cadenceRpm"),
    cadenceAvg60s: averageRecentSampleValue(samples, 60_000, "cadenceRpm"),
    heartRateAvg15s: averageRecentSampleValue(samples, 15_000, "heartRateBpm"),
    heartRateAvg60s: averageRecentSampleValue(samples, 60_000, "heartRateBpm"),
    heartRateTrendBpmPerMin: getHeartRateTrend(samples),
  });

  const getHookSnapshot = () => {
    const samples = clientRef.current.samples;
    const latestSample = samples.length > 0 ? samples[samples.length - 1] : undefined;
    const lastAgentEntry = agentJournal[0];

    return {
      activeTrainerMode,
      latestSample,
      workoutName: activeWorkoutNameRef.current,
      remainingWorkout: workoutPlayerRef.current?.getRemainingWorkoutSnapshot() ?? null,
      sampleCount: samples.length,
      connectionState,
      hrConnectionState,
      currentHrZone,
      rolling: getRollingSnapshot(samples),
      riderProfile: {
        ftp: riderProfile.fourDP.ftp,
        map: riderProfile.fourDP.map,
        ac: riderProfile.fourDP.ac,
        nm: riderProfile.fourDP.nm,
        cTHR: riderProfile.cTHR,
        memorySummary: riderProfile.memorySummary,
      },
      lastAgentEntry: lastAgentEntry
        ? {
            label: lastAgentEntry.label,
            status: lastAgentEntry.status,
            reason: lastAgentEntry.reason,
            message: lastAgentEntry.message,
          }
        : null,
    };
  };

  async function connect() {
    try {
      setConnectionState("connecting");
      // Reset logging for a potential new session
      currentSessionFilenameRef.current = `ride-${Date.now()}`;
      unsavedSamplesRef.current = [];

      await clientRef.current.connect(
        (sample) => {
          setPower(sample.powerW);
          setCadence(sample.cadenceRpm);
          // Only update local HR state if trainer provides it AND external HRM is not connected
          if (sample.heartRateBpm !== undefined && !hrClientRef.current.isConnected) {
            setHeartRate(sample.heartRateBpm);
          }

          // Buffer and log samples
          unsavedSamplesRef.current.push(sample);
          if (unsavedSamplesRef.current.length >= 10) {
            const toLog = [...unsavedSamplesRef.current];
            const isNew = clientRef.current.samples.length <= 10;
            unsavedSamplesRef.current = [];
            logSamples(toLog, isNew);
          }
        },
        () => {
          const endedSessionId = activeHookSessionRef.current;
          activeHookSessionRef.current = null;

          setConnectionState("disconnected");
          setPower(undefined);
          setCadence(undefined);
          setActiveTrainerMode({ type: "none" });
          if (!hrClientRef.current.isConnected) {
            setHeartRate(undefined);
          }
          // Final log of remaining samples
          if (unsavedSamplesRef.current.length > 0) {
            logSamples(unsavedSamplesRef.current, false);
            unsavedSamplesRef.current = [];
          }

          if (endedSessionId) {
            hookRideEnded(endedSessionId, {
              ...getHookSnapshot(),
              connectionState: "disconnected",
            });
          }
        }
      );
      setConnectionState("connected");
      activeHookSessionRef.current = currentSessionFilenameRef.current;
      hookRideStarted(currentSessionFilenameRef.current, {
        ...getHookSnapshot(),
        connectionState: "connected",
      });
    } catch (e) {
      setConnectionState("disconnected");
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function disconnect() {
    try {
      await clientRef.current.disconnect();
    } catch (e) {
      console.error(e);
    }
  }

  async function connectHRM() {
    try {
      setHrConnectionState("connecting");
      await hrClientRef.current.connect(
        (bpm) => {
          setHeartRate(bpm);
          clientRef.current.currentHeartRate = bpm;
        },
        () => {
          setHrConnectionState("disconnected");
          setHeartRate(undefined);
          clientRef.current.currentHeartRate = undefined;
        }
      );
      setHrConnectionState("connected");
    } catch (e) {
      setHrConnectionState("disconnected");
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function disconnectHRM() {
    try {
      await hrClientRef.current.disconnect();
    } catch (e) {
      console.error(e);
    }
  }

  async function setTrainerResistance(level: number) {
    await clientRef.current.setResistance(level);
    setActiveTrainerMode({ type: "resistance", level });
    setResistance(level);
  }

  async function setTrainerTargetPower(watts: number) {
    await clientRef.current.setTargetPower(watts);
    setActiveTrainerMode({ type: "erg", watts });
    setTargetPower(watts);
  }

  async function applyResistance(level?: number) {
    const levelToSet = typeof level === "number" ? level : resistance;
    try {
      await setTrainerResistance(levelToSet);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  }
  
  async function applyTargetPower(watts?: number) {
    const powerToSet = typeof watts === "number" ? watts : targetPower;
    try {
      await setTrainerTargetPower(powerToSet);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const executeAgentCommand = async (command: AgentCommand) => {
    updateAgentJournal(command, "received");
    await logAgentEvent({
      type: "command_received",
      sessionId: currentSessionFilenameRef.current,
      timestamp: Date.now(),
      command,
    });

    try {
      if (command.type === "set_erg_watts") {
        await setTrainerTargetPower(command.watts);
        workoutPlayerRef.current?.applyErgOverrideUntilNextStep(command.watts);
      } else if (command.type === "set_resistance") {
        await setTrainerResistance(command.percent);
      } else if (command.type === "set_trainer_mode" && command.mode === "erg") {
        if (typeof command.targetWatts !== "number") {
          throw new Error("set_trainer_mode erg requires targetWatts");
        }
        await setTrainerTargetPower(command.targetWatts);
        workoutPlayerRef.current?.applyErgOverrideUntilNextStep(command.targetWatts);
      } else if (command.type === "set_trainer_mode" && command.mode === "resistance") {
        const level = typeof command.percent === "number" ? command.percent : command.level;
        if (typeof level !== "number") {
          throw new Error("set_trainer_mode resistance requires percent or level");
        }
        await setTrainerResistance(level);
      } else if (command.type === "send_message") {
        setAgentMessage(command.text);
        if (command.speak !== false) {
          speakAgentMessage(command.text);
        }
      } else if (command.type === "request_rider_voice_feedback") {
        setAgentMessage("Rider voice feedback requested, but voice input is disabled.");
      } else if (command.type === "start_trainer") {
        await clientRef.current.start();
      } else if (command.type === "stop_trainer") {
        await clientRef.current.stop();
      } else if (command.type === "set_workout_plan") {
        if (!workoutPlayerRef.current) {
          throw new Error("Workout player not ready to apply plan");
        }
        workoutPlayerRef.current.applyPlanCommand(
          command.blocks,
          typeof command.leadSeconds === "number" ? command.leadSeconds : 20
        );
      } else {
        const unsupported = command as { type?: string };
        throw new Error(`Unsupported agent command: ${unsupported.type ?? "unknown"}`);
      }

      updateAgentJournal(command, "applied");
      await logAgentEvent({
        type: "command_applied",
        sessionId: currentSessionFilenameRef.current,
        timestamp: Date.now(),
        command,
      });
      return { ok: true as const };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updateAgentJournal(command, "failed", message);
      await logAgentEvent({
        type: "command_failed",
        sessionId: currentSessionFilenameRef.current,
        timestamp: Date.now(),
        command,
        message,
      });
      return { ok: false as const, message };
    }
  };

  useEffect(() => {
    if (connectionState !== "connected") return;

    const pollAgentCommands = async () => {
      if (pollingAgentCommandsRef.current) return;
      if (!clientRef.current.isConnected) return;

      pollingAgentCommandsRef.current = true;

      try {
        const res = await fetch("/api/agent/commands");
        if (!res.ok) return;

        const data = await res.json();
        const commands = Array.isArray(data.commands) ? data.commands as AgentCommand[] : [];

        for (const command of commands) {
          await executeAgentCommand(command);
        }
      } catch (e) {
        console.error("Failed to poll agent commands:", e);
      } finally {
        pollingAgentCommandsRef.current = false;
      }
    };

    const interval = window.setInterval(pollAgentCommands, 3000);
    pollAgentCommands();

    return () => window.clearInterval(interval);
  }, [connectionState]);

  useEffect(() => {
    if (connectionState !== "connected") return;

    const sendSnapshot = () => {
      const samples = clientRef.current.samples;
      const latestSample = samples.length > 0 ? samples[samples.length - 1] : undefined;

      logAgentEvent({
        type: "ride_snapshot",
        sessionId: currentSessionFilenameRef.current,
        timestamp: Date.now(),
        workoutName: activeWorkoutNameRef.current,
        connectionState,
        hrConnectionState,
        activeTrainerMode,
        latestSample,
        sampleCount: samples.length,
        riderProfile,
      });
    };

    const interval = window.setInterval(sendSnapshot, 5000);
    sendSnapshot();

    return () => window.clearInterval(interval);
  }, [activeTrainerMode, connectionState, hrConnectionState, riderProfile]);

  const handleStopSession = async (workoutName: string, riderComments?: string) => {
    const samples = [...clientRef.current.samples];
    if (samples.length === 0) return;
    setIsSavingSession(true);

    const metrics = calculateActualMetrics(samples, riderProfile.fourDP.ftp);

    try {
      // Final log of remaining samples and metrics before ending session
      logSamples(unsavedSamplesRef.current, false, metrics);
      unsavedSamplesRef.current = [];

      const newSession: RideSession = {
        id: "session-" + Date.now(),
        workoutName,
        timestamp: Date.now(),
        samples,
        metrics,
        riderComments: riderComments?.trim() || undefined,
      };

      const savedSession = await saveRideSession(newSession);
      setSessions(prev => [savedSession, ...prev]);
      setSavedSummarySession(savedSession);
      setIsSavedSummaryOpen(true);
      clientRef.current.samples = []; // Clear samples for next session
      currentSessionFilenameRef.current = null; // Mark session as ended
    } catch (error) {
      console.error("Failed to finish session:", error);
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingSession(false);
    }
  };

  const handleExportSession = (session: RideSession) => {
    const rows = session.samples.map((s) => ({
      timestamp: new Date(s.timestamp).toISOString(),
      powerW: s.powerW ?? "",
      cadenceRpm: s.cadenceRpm ?? "",
      speedKph: s.speedKph ?? "",
      resistance: s.resistance ?? "",
      heartRateBpm: s.heartRateBpm ?? "",
    }));

    const csv = [
      "timestamp,powerW,cadenceRpm,speedKph,resistance,heartRateBpm",
      ...rows.map((r) =>
        [r.timestamp, r.powerW, r.cadenceRpm, r.speedKph, r.resistance, r.heartRateBpm].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `kickr-${session.workoutName.replace(/\s+/g, '-')}-${session.timestamp}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  const handleDeleteSession = async (id: string) => {
    if (window.confirm("Delete this session?")) {
      await deleteRideSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    }
  };

  async function exportCsv() {
    const rows = clientRef.current.samples.map((s) => ({
      timestamp: new Date(s.timestamp).toISOString(),
      powerW: s.powerW ?? "",
      cadenceRpm: s.cadenceRpm ?? "",
      speedKph: s.speedKph ?? "",
      resistance: s.resistance ?? "",
      heartRateBpm: s.heartRateBpm ?? "",
    }));

    const csv = [
      "timestamp,powerW,cadenceRpm,speedKph,resistance,heartRateBpm",
      ...rows.map((r) =>
        [r.timestamp, r.powerW, r.cadenceRpm, r.speedKph, r.resistance, r.heartRateBpm].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `kickr-session-${Date.now()}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  }

  const inputClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const labelClass = "flex flex-col gap-1 text-xs font-semibold text-muted-foreground";

  const renderRideSummary = (session: RideSession, compact = false) => {
    if (!session.llmSummary) {
      return (
        <p className="text-xs text-muted-foreground">
          Summary {session.llmSummaryStatus || "not available"}
          {session.llmSummaryError ? `: ${session.llmSummaryError}` : ""}
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-sm font-semibold">{session.llmSummary.headline}</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {session.llmSummary.summary}
          </p>
        </div>

        {!compact && (
          <>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Observations
              </div>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {session.llmSummary.keyObservations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="grid gap-3 text-xs text-muted-foreground">
              <div>
                <span className="font-semibold text-foreground">HR zones: </span>
                {session.llmSummary.heartRateZoneAssessment}
              </div>
              <div>
                <span className="font-semibold text-foreground">Load: </span>
                {session.llmSummary.trainingLoadAssessment}
              </div>
              {session.llmSummary.riderCommentsReflection && (
                <div>
                  <span className="font-semibold text-foreground">Rider notes: </span>
                  {session.llmSummary.riderCommentsReflection}
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Next Focus
              </div>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {session.llmSummary.suggestedNextFocus.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <main className="flex min-h-svh flex-col gap-6 p-6 lg:flex-row">
      {/* Left Column - Controls & Telemetry */}
      <div className="flex max-w-md min-w-0 flex-col gap-6 text-sm w-full">
        
        {/* Header with Settings */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Workout Controller</h1>
          <Dialog open={isSavedSummaryOpen} onOpenChange={setIsSavedSummaryOpen}>
            <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto rounded-md">
              <DialogHeader>
                <DialogTitle>Session Saved</DialogTitle>
                <DialogDescription>
                  {savedSummarySession?.workoutName || "Ride summary"}
                </DialogDescription>
              </DialogHeader>
              {savedSummarySession && (
                <div className="rounded-md border bg-muted/20 p-4">
                  {renderRideSummary(savedSummarySession)}
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => setIsSavedSummaryOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isSettingsOpen} onOpenChange={handleSettingsOpenChange}>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open rider settings">
                <Cog className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Rider Settings</DialogTitle>
                <DialogDescription>
                  Profile values used by workouts, ride metrics, and the local agent.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-6 mt-4">
                <div className="flex flex-col border rounded-md bg-card overflow-hidden">
                  <div className="p-4 bg-muted/20 border-b">
                    <h3 className="font-semibold text-base">Four Dimensional Power (4DP®) Profile</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                    {([
                      ["nm", "NM (5s)"],
                      ["ac", "AC (1m)"],
                      ["map", "MAP (5m)"],
                      ["ftp", "FTP (20m)"],
                    ] as const).map(([key, label]) => (
                      <label key={key} className={labelClass}>
                        <span>{label}</span>
                        <input
                          type="number"
                          min="0"
                          value={settingsProfile.fourDP[key]}
                          onChange={(e) => setDraftProfileNumber("fourDP", key, e.target.value)}
                          className={inputClass}
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col border rounded-md bg-card overflow-hidden">
                  <div className="p-4 bg-muted/20 border-b">
                    <h3 className="font-semibold text-base">Body Profile</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-4">
                    <label className={labelClass}>
                      <span>Age</span>
                      <input
                        type="number"
                        min="0"
                        value={settingsProfile.age ?? ""}
                        onChange={(e) => setDraftRootNumber("age", e.target.value)}
                        className={inputClass}
                      />
                    </label>
                    <label className={labelClass}>
                      <span>Weight (kg)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={settingsProfile.weightKg ?? ""}
                        onChange={(e) => setDraftRootNumber("weightKg", e.target.value)}
                        className={inputClass}
                      />
                    </label>
                    <label className={labelClass}>
                      <span>Gender</span>
                      <select
                        value={settingsProfile.gender ?? ""}
                        onChange={(e) => setSettingsProfile((profile) => ({ ...profile, gender: e.target.value || null }))}
                        className={inputClass}
                      >
                        <option value="">Unset</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </label>
                    <label className={labelClass}>
                      <span>cTHR</span>
                      <input
                        type="number"
                        min="0"
                        value={settingsProfile.cTHR}
                        onChange={(e) => setSettingsProfile((profile) => ({ ...profile, cTHR: Number(e.target.value) || 0 }))}
                        className={inputClass}
                      />
                    </label>
                  </div>
                </div>

                <div className="flex flex-col border rounded-md bg-card overflow-hidden">
                  <div className="p-4 bg-muted/20 border-b flex justify-between items-center">
                    <div>
                      <h3 className="font-semibold text-base">Heart Rate Zones</h3>
                    </div>
                  </div>
                  <div className="flex flex-col divide-y">
                    <div className="grid grid-cols-[1fr_1fr_72px_72px_44px] gap-2 p-3 px-4 text-xs font-semibold text-muted-foreground uppercase bg-muted/10">
                      <div>Name</div>
                      <div>Range</div>
                      <div>Min</div>
                      <div>Max</div>
                      <div>Color</div>
                    </div>
                    {settingsProfile.hrZones.map((zone) => (
                      <div key={zone.id} className="grid grid-cols-[1fr_1fr_72px_72px_44px] gap-2 p-3 items-center">
                        <input
                          value={zone.name}
                          onChange={(e) => updateDraftHrZone(zone.id, "name", e.target.value)}
                          className={inputClass}
                        />
                        <input
                          value={zone.percentageRange}
                          onChange={(e) => updateDraftHrZone(zone.id, "percentageRange", e.target.value)}
                          className={inputClass}
                        />
                        <input
                          type="number"
                          min="0"
                          value={zone.minBpm}
                          onChange={(e) => updateDraftHrZone(zone.id, "minBpm", e.target.value)}
                          className={inputClass}
                        />
                        <input
                          type="number"
                          min="0"
                          value={zone.maxBpm}
                          onChange={(e) => updateDraftHrZone(zone.id, "maxBpm", e.target.value)}
                          className={inputClass}
                        />
                        <input
                          type="color"
                          value={zone.color}
                          onChange={(e) => updateDraftHrZone(zone.id, "color", e.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-transparent p-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col border rounded-md bg-card overflow-hidden">
                  <div className="p-4 bg-muted/20 border-b">
                    <h3 className="font-semibold text-base">Rider Memory Summary</h3>
                  </div>
                  <div className="p-4">
                    <textarea
                      value={settingsProfile.memorySummary}
                      onChange={(e) => setSettingsProfile((profile) => ({ ...profile, memorySummary: e.target.value }))}
                      className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => handleSettingsOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveProfile} disabled={isSavingProfile}>
                    {isSavingProfile ? "Saving..." : "Save Settings"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-col gap-4">
          
          {/* Device Connection Cards */}
          <div className="grid grid-cols-1 gap-3">
            {/* KICKR Card */}
            <div className="flex flex-col gap-3 p-4 border rounded-md bg-card">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-base">KICKR CORE 2</h2>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    {connectionState === "connecting" && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${
                      connectionState === "connected" ? "bg-green-500" :
                      connectionState === "connecting" ? "bg-yellow-500" :
                      "bg-red-500"
                    }`}></span>
                  </span>
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {connectionState}
                  </span>
                </div>
              </div>
              {connectionState === "disconnected" ? (
                <Button onClick={connect} className="w-full">
                  Connect Trainer
                </Button>
              ) : (
                <Button onClick={disconnect} variant="destructive" className="w-full" disabled={connectionState === "connecting"}>
                  Disconnect Trainer
                </Button>
              )}
            </div>

            {/* HRM Card */}
            <div className="flex flex-col gap-3 p-4 border rounded-md bg-card">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-base">Heart Rate Monitor</h2>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    {hrConnectionState === "connecting" && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${
                      hrConnectionState === "connected" ? "bg-green-500" :
                      hrConnectionState === "connecting" ? "bg-yellow-500" :
                      "bg-red-500"
                    }`}></span>
                  </span>
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {hrConnectionState}
                  </span>
                </div>
              </div>
              {hrConnectionState === "disconnected" ? (
                <Button onClick={connectHRM} variant="secondary" className="w-full">
                  Connect HRM
                </Button>
              ) : (
                <Button onClick={disconnectHRM} variant="destructive" className="w-full" disabled={hrConnectionState === "connecting"}>
                  Disconnect HRM
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 p-4 rounded-md border">
            {/* Mode Switcher */}
            <div className="flex p-1 bg-muted/50 rounded-md">
              <button
                className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors ${
                  mode === "erg" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setMode("erg")}
              >
                ERG Mode (Watts)
              </button>
              <button
                className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors ${
                  mode === "resistance" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setMode("resistance")}
              >
                Resistance (%)
              </button>
            </div>

            {/* ERG Mode Controls */}
            {mode === "erg" && (
              <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-1">
                <label className="flex flex-col gap-2 font-medium">
                  <div className="flex justify-between">
                    <span>Target Power</span>
                    <span className="text-muted-foreground font-mono">{targetPower} W</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="1000"
                    step="5"
                    value={targetPower}
                    onChange={(e) => setTargetPower(Number(e.target.value))}
                    className="w-full accent-primary"
                    disabled={connectionState !== "connected"}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>50 W</span>
                    <span>1000 W</span>
                  </div>
                </label>
                
                <div className="flex gap-2 items-center">
                  <input 
                    type="number" 
                    min="0" 
                    max="2000" 
                    value={targetPower} 
                    onChange={(e) => setTargetPower(Number(e.target.value))}
                    className="flex h-9 w-20 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={connectionState !== "connected"}
                  />
                  <Button 
                    onClick={() => applyTargetPower()} 
                    className="flex-1"
                    disabled={connectionState !== "connected"}
                  >
                    {activeTrainerMode.type === "erg" ? "Update Target Power" : "Activate ERG Mode"}
                  </Button>
                </div>
              </div>
            )}

            {/* Resistance Mode Controls */}
            {mode === "resistance" && (
              <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-1">
                <label className="flex flex-col gap-2 font-medium">
                  <div className="flex justify-between">
                    <span>Resistance Level</span>
                    <span className="text-muted-foreground">{resistance}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.5"
                    value={resistance}
                    onChange={(e) => setResistance(Number(e.target.value))}
                    className="w-full accent-primary"
                    disabled={connectionState !== "connected"}
                  />
                </label>

                <Button 
                  onClick={() => applyResistance()} 
                  className="w-full"
                  disabled={connectionState !== "connected"}
                >
                  {activeTrainerMode.type === "resistance" ? "Update Resistance" : "Activate Resistance Mode"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  In resistance mode, power output will scale with your cadence and gearing.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 p-4 rounded-md border bg-card">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-base">Agent Controller</h2>
                <p className="text-xs text-muted-foreground">
                  Local command inbox: <span className="font-mono">/api/agent/commands</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={voiceFeedbackEnabled ? "secondary" : "outline"}
                  size="icon-sm"
                  aria-label={voiceFeedbackEnabled ? "Disable voice feedback" : "Enable voice feedback"}
                  title={speechSupported ? "Voice feedback" : "Voice feedback is not supported in this browser"}
                  disabled={!speechSupported}
                  onClick={() => handleVoiceFeedbackToggle(!voiceFeedbackEnabled)}
                >
                  {voiceFeedbackEnabled ? <Volume2 /> : <VolumeX />}
                </Button>
                <span className="rounded-sm bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Direct
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold">Voice feedback</div>
                <div className="text-[11px] text-muted-foreground">
                  {speechSupported ? (voiceFeedbackEnabled ? "On" : "Off") : "Unavailable"}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={!speechSupported || !voiceFeedbackEnabled}
                onClick={() => speakAgentMessage("KICKR voice feedback is ready.", true)}
              >
                Test
              </Button>
            </div>

            {agentMessage && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Latest Agent Note
                </div>
                <p>{agentMessage}</p>
              </div>
            )}

            <div className="flex min-h-[220px] flex-col rounded-md border bg-muted/20">
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {liveCoachMessages.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    Ask the live coach by text.
                  </div>
                ) : (
                  liveCoachMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-md border px-3 py-2 text-xs ${
                          message.role === "user"
                            ? "border-primary/30 bg-primary/10"
                            : message.execution === "failed"
                              ? "border-red-500/30 bg-red-500/10 text-red-700"
                              : "bg-background/80"
                        }`}
                      >
                        <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          <span>{message.role === "user" ? "You" : "Live Coach"}</span>
                          {message.command && <span>{message.command}</span>}
                        </div>
                        <div>{message.text}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t bg-background/60 p-2">
                <div className="flex gap-2">
                  <input
                    value={liveCoachInput}
                    onChange={(e) => setLiveCoachInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendLiveCoachText();
                      }
                    }}
                    placeholder="Ask: did you change power, make it easier, hold this..."
                    className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    disabled={liveCoachSending}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={sendLiveCoachText}
                    disabled={!liveCoachInput.trim() || liveCoachSending}
                  >
                    {liveCoachSending ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      "Send"
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {agentJournal.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">
                  Waiting for local agent commands.
                </p>
              ) : (
                agentJournal.map((entry) => (
                  <div key={entry.id} className="rounded-md border bg-muted/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{entry.label}</div>
                        {entry.reason && (
                          <div className="mt-1 text-xs text-muted-foreground">{entry.reason}</div>
                        )}
                        {entry.message && (
                          <div className="mt-1 text-xs text-red-500">{entry.message}</div>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase ${
                          entry.status === "applied"
                            ? "bg-green-500/15 text-green-600"
                            : entry.status === "failed"
                              ? "bg-red-500/15 text-red-600"
                              : "bg-yellow-500/15 text-yellow-600"
                        }`}
                      >
                        {entry.status}
                      </span>
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Session History</h3>
            
            {/* Current unsaved samples if any */}
            {clientRef.current.samples.length > 0 && (
              <div className="p-3 border rounded-md bg-muted/10 border-dashed flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-xs">Unsaved Session</span>
                  <span className="text-[10px] text-muted-foreground">
                    {isSavingSession ? "Saving summary..." : `${clientRef.current.samples.length} samples`}
                  </span>
                </div>
                <Button onClick={exportCsv} variant="outline" size="sm" className="w-full h-7 text-xs">
                  Export Temporary CSV
                </Button>
              </div>
            )}

            {sessions.length === 0 && clientRef.current.samples.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No sessions recorded yet.</p>
            )}

            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
              {sessions.map((session) => (
                <div key={session.id} className="p-3 border rounded-md bg-card flex flex-col gap-2 group relative">
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-sm truncate pr-6">{session.workoutName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(session.timestamp).toLocaleDateString()} at {new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <button 
                      onClick={() => handleDeleteSession(session.id)}
                      className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 text-muted-foreground hover:text-destructive transition-opacity"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-center">
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase">Power</span>
                      <span className="font-mono text-xs">{session.metrics.avgPower || "-"}W</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase">TSS</span>
                      <span className="font-mono text-xs">{Math.round(session.metrics.tss)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase">Time</span>
                      <span className="font-mono text-xs">
                        {Math.floor(session.metrics.durationSeconds / 60)}m
                      </span>
                    </div>
                  </div>

                  {session.riderComments && (
                    <p className="rounded-sm bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
                      {session.riderComments}
                    </p>
                  )}

                  {session.llmSummary && (
                    <div className="rounded-sm border bg-muted/20 p-2">
                      <div className="mb-1 font-bold uppercase tracking-wider text-muted-foreground">
                        AI Summary
                      </div>
                      {renderRideSummary(session, true)}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          More
                        </summary>
                        <div className="mt-2 border-t pt-2">
                          {renderRideSummary(session)}
                        </div>
                      </details>
                    </div>
                  )}

                  {!session.llmSummary && session.llmSummaryStatus && (
                    <p className="text-[10px] text-muted-foreground">
                      Summary {session.llmSummaryStatus}
                    </p>
                  )}

                  <Button 
                    onClick={() => handleExportSession(session)} 
                    variant="secondary" 
                    size="sm" 
                    className="w-full h-7 text-[10px] font-bold"
                  >
                    DOWNLOAD CSV
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right Column - Workout Player */}
      <div className="flex min-w-0 w-full max-w-4xl flex-col gap-6">
        <WorkoutPlayer
           ref={workoutPlayerRef}
           disabled={connectionState !== "connected"}
           onPowerTargetChange={applyTargetPower}
           onStopSession={handleStopSession}
           onWorkoutChange={(w) => activeWorkoutNameRef.current = w.name}
           power={power}
           cadence={cadence}
           heartRate={heartRate}
           currentHrZone={currentHrZone}
           activeTrainerMode={activeTrainerMode}
           riderProfile={riderProfile}
        />
      </div>
    </main>
  );
}
