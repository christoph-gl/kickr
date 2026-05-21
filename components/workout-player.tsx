"use client";

import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from "react";
import {
  WORKOUTS,
  Workout,
  WorkoutBlock,
  parseLLMWorkout,
  saveWorkout,
  deleteWorkout,
  getWorkoutLibrary,
  updateWorkout,
  parseZwoWorkout,
  calculateWorkoutMetrics,
  ADAPTIVE_FREERIDE,
  isAdaptiveFreeride,
  spliceUpcomingBlocks,
} from "@/lib/workouts";
import { WorkoutChart } from "./workout-chart";
import { Button } from "./ui/button";
import { Trash2 } from "lucide-react";
import { RIDER_PROFILE, type RiderProfile } from "@/lib/profile";
import { audioService } from "@/lib/audio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type WorkoutPlayerHandle = {
  applyPlanCommand: (blocks: WorkoutBlock[], leadSeconds?: number) => void;
  applyErgOverrideUntilNextStep: (watts: number) => void;
  getRemainingWorkoutSnapshot: () => RemainingWorkoutSnapshot;
};

type WorkoutPlayerProps = {
  onPowerTargetChange: (watts: number) => void;
  onStopSession: (workoutName: string, riderComments?: string) => void;
  onWorkoutChange?: (workout: Workout) => void;
  disabled: boolean;
  power?: number;
  cadence?: number;
  heartRate?: number;
  currentHrZone?: RiderProfile["hrZones"][number];
  activeTrainerMode:
    | { type: "none" }
    | { type: "erg"; watts: number }
    | { type: "resistance"; level: number };
  riderProfile?: RiderProfile;
};

type WakeLockCapableNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<{ release: () => Promise<void> }>;
  };
};

type TelemetrySnapshot = {
  offsetSeconds: number;
  durationSeconds: number;
  avgPowerW: number | null;
  avgCadenceRpm: number | null;
  avgHeartRateBpm: number | null;
  targetPower: number | null;
  hrZone: string | null;
};

function averageNullable(values: Array<number | undefined>) {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return null;
  return Math.round(present.reduce((total, value) => total + value, 0) / present.length);
}

type RemainingWorkoutSnapshot = {
  workoutId: string;
  workoutName: string;
  isPlaying: boolean;
  elapsedSeconds: number;
  totalDurationSeconds: number;
  remainingSeconds: number;
  currentTargetPower: number | null;
  remainingBlocks: Array<{
    offsetSeconds: number;
    durationSeconds: number;
    targetPower: number;
    isCurrent: boolean;
  }>;
  truncated: boolean;
};

export const WorkoutPlayer = forwardRef<WorkoutPlayerHandle, WorkoutPlayerProps>(function WorkoutPlayer(
  {
    onPowerTargetChange,
    onStopSession,
    onWorkoutChange,
    disabled,
    power,
    cadence,
    heartRate,
    currentHrZone,
    activeTrainerMode,
    riderProfile = RIDER_PROFILE,
  },
  ref,
) {
  const [allWorkouts, setAllWorkouts] = useState<Workout[]>(WORKOUTS);
  const [workout, setWorkout] = useState<Workout>(WORKOUTS[0]);

  useEffect(() => {
    if (onWorkoutChange) {
      onWorkoutChange(workout);
    }
  }, [workout, onWorkoutChange]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isFinishOpen, setIsFinishOpen] = useState(false);
  const [finishComments, setFinishComments] = useState("");
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [builderInstructions, setBuilderInstructions] = useState("");
  const [builderRationale, setBuilderRationale] = useState<string | null>(null);
  const [isBuildingWorkout, setIsBuildingWorkout] = useState(false);
  const [unsavedBuiltWorkoutId, setUnsavedBuiltWorkoutId] = useState<string | null>(null);
  const [isSavingBuiltWorkout, setIsSavingBuiltWorkout] = useState(false);
  const [deletingWorkoutId, setDeletingWorkoutId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveCoachFeedback, setLiveCoachFeedback] = useState<string | null>(null);
  const [liveCoachDetail, setLiveCoachDetail] = useState<string | null>(null);
  const [liveCoachStatus, setLiveCoachStatus] = useState<"idle" | "checking" | "error">("idle");
  const [upcomingChange, setUpcomingChange] = useState<{ nextTarget: number, currentTarget: number, seconds: number } | null>(null);
  const lastTargetRef = useRef<number | null>(null);
  const elapsedSecondsRef = useRef(0);
  const telemetrySamplesRef = useRef<Array<{
    elapsedSeconds: number;
    power?: number;
    cadence?: number;
    heartRate?: number;
    targetPower: number | null;
    hrZoneName: string | null;
  }>>([]);
  const liveCoachRunningRef = useRef(false);
  const initialLiveCoachRequestedRef = useRef(false);
  const lastLiveCoachCheckSecondRef = useRef(0);
  const coachSpeechRequestRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zwoFileInputRef = useRef<HTMLInputElement>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const adaptive = isAdaptiveFreeride(workout);

  useEffect(() => {
    elapsedSecondsRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  const clampPlanWatts = useCallback(
    (watts: number) => {
      const ceiling = Math.max(120, Math.round(riderProfile.fourDP.map * 1.2));
      return Math.max(40, Math.min(watts, ceiling));
    },
    [riderProfile.fourDP.map]
  );

  const applyPlanCommand = useCallback(
    (blocks: WorkoutBlock[], leadSeconds: number = 20) => {
      if (!Array.isArray(blocks) || blocks.length === 0) return;
      const safeBlocks: WorkoutBlock[] = blocks
        .map((b) => ({
          durationSeconds: Math.max(30, Math.round(Number(b.durationSeconds) || 0)),
          targetPower: clampPlanWatts(Math.round(Number(b.targetPower) || 0)),
        }))
        .filter((b) => b.durationSeconds > 0);
      if (safeBlocks.length === 0) return;

      setWorkout((prev) =>
        spliceUpcomingBlocks(prev, elapsedSecondsRef.current, leadSeconds, safeBlocks)
      );
    },
    [clampPlanWatts]
  );

  const mergeAdjacentBlocks = useCallback((blocks: WorkoutBlock[]) => {
    const merged: WorkoutBlock[] = [];
    for (const block of blocks) {
      if (block.durationSeconds <= 0) continue;
      const previous = merged[merged.length - 1];
      if (previous && previous.targetPower === block.targetPower) {
        previous.durationSeconds += block.durationSeconds;
      } else {
        merged.push({ ...block });
      }
    }
    return merged;
  }, []);

  const applyErgOverrideUntilNextStep = useCallback(
    (watts: number) => {
      const overrideWatts = clampPlanWatts(Math.round(Number(watts) || 0));
      const elapsed = Math.max(0, Math.round(elapsedSecondsRef.current));

      setWorkout((prev) => {
        let acc = 0;
        const nextBlocks: WorkoutBlock[] = [];
        let applied = false;

        for (const block of prev.blocks) {
          const blockStart = acc;
          const blockEnd = acc + block.durationSeconds;
          acc = blockEnd;

          if (applied || elapsed >= blockEnd) {
            nextBlocks.push(block);
            continue;
          }

          if (elapsed <= blockStart) {
            nextBlocks.push({ durationSeconds: block.durationSeconds, targetPower: overrideWatts });
            applied = true;
            continue;
          }

          nextBlocks.push({
            durationSeconds: elapsed - blockStart,
            targetPower: block.targetPower,
          });
          nextBlocks.push({
            durationSeconds: blockEnd - elapsed,
            targetPower: overrideWatts,
          });
          applied = true;
        }

        if (!applied) return prev;
        return { ...prev, blocks: mergeAdjacentBlocks(nextBlocks) };
      });

      lastTargetRef.current = overrideWatts;
    },
    [clampPlanWatts, mergeAdjacentBlocks]
  );

  const getRemainingWorkoutSnapshot = useCallback((): RemainingWorkoutSnapshot => {
    const elapsed = Math.max(0, Math.round(elapsedSeconds));
    const totalDurationSeconds = workout.blocks.reduce(
      (total, block) => total + block.durationSeconds,
      0
    );
    const remainingBlocks: RemainingWorkoutSnapshot["remainingBlocks"] = [];
    let acc = 0;
    let offsetSeconds = 0;
    let currentTargetPower: number | null = null;

    for (const block of workout.blocks) {
      const blockStart = acc;
      const blockEnd = acc + block.durationSeconds;
      acc = blockEnd;

      if (elapsed >= blockEnd) continue;

      const remainingStart = Math.max(elapsed, blockStart);
      const durationSeconds = Math.max(0, blockEnd - remainingStart);
      if (durationSeconds <= 0) continue;

      const isCurrent = elapsed >= blockStart && elapsed < blockEnd;
      if (isCurrent) {
        currentTargetPower = block.targetPower;
      }

      const previous = remainingBlocks[remainingBlocks.length - 1];
      if (previous && previous.targetPower === block.targetPower) {
        previous.durationSeconds += durationSeconds;
      } else {
        remainingBlocks.push({
          offsetSeconds,
          durationSeconds,
          targetPower: block.targetPower,
          isCurrent,
        });
      }
      offsetSeconds += durationSeconds;
    }

    return {
      workoutId: workout.id,
      workoutName: workout.name,
      isPlaying,
      elapsedSeconds: elapsed,
      totalDurationSeconds,
      remainingSeconds: Math.max(0, totalDurationSeconds - elapsed),
      currentTargetPower,
      remainingBlocks: remainingBlocks.slice(0, 30),
      truncated: remainingBlocks.length > 30,
    };
  }, [elapsedSeconds, isPlaying, workout]);

  useImperativeHandle(
    ref,
    () => ({
      applyPlanCommand,
      applyErgOverrideUntilNextStep,
      getRemainingWorkoutSnapshot,
    }),
    [applyErgOverrideUntilNextStep, applyPlanCommand, getRemainingWorkoutSnapshot]
  );

  // Wake Lock implementation
  const requestWakeLock = async () => {
    const wakeNavigator = navigator as WakeLockCapableNavigator;
    if (wakeNavigator.wakeLock) {
      try {
        wakeLockRef.current = await wakeNavigator.wakeLock.request("screen");
        console.log("Wake Lock active");
      } catch (err) {
        console.error(`${(err as Error).name}, ${(err as Error).message}`);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log("Wake Lock released");
      } catch (err) {
        console.error(`${(err as Error).name}, ${(err as Error).message}`);
      }
    }
  };

  useEffect(() => {
    if (isPlaying) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = async () => {
      if (wakeLockRef.current !== null && document.visibilityState === "visible") {
        await requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseWakeLock();
    };
  }, [isPlaying]);

  useEffect(() => {
    async function loadSaved() {
      const { savedWorkouts, deletedWorkoutIds } = await getWorkoutLibrary();
      const deletedIds = new Set(deletedWorkoutIds);
      const visibleWorkouts = [
        ...WORKOUTS.filter((savedWorkout) => !deletedIds.has(savedWorkout.id)),
        ...savedWorkouts.filter((savedWorkout) => !deletedIds.has(savedWorkout.id)),
      ];
      setAllWorkouts(visibleWorkouts);

      if (!visibleWorkouts.some((savedWorkout) => savedWorkout.id === workout.id)) {
        setWorkout(visibleWorkouts[0] ?? ADAPTIVE_FREERIDE);
      }
    }
    loadSaved();
  }, [workout.id]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setElapsedSeconds(e => e + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // No automatic periodic coaching loop or ticker for Adaptive Freeride.

  useEffect(() => {
    if (!isPlaying) return;

    let timeAcc = 0;
    let newBlockIndex = -1;

    for (let i = 0; i < workout.blocks.length; i++) {
      timeAcc += workout.blocks[i].durationSeconds;
      if (elapsedSeconds < timeAcc) {
        newBlockIndex = i;
        break;
      }
    }

    if (newBlockIndex === -1) {
      setIsPlaying(false);
      setUpcomingChange(null);
      return;
    }

    // Determine upcoming changes and play notification
    let accTime = 0;
    let foundUpcoming = false;
    for (let i = 0; i < workout.blocks.length; i++) {
      const blockStart = accTime;
      const blockEnd = accTime + workout.blocks[i].durationSeconds;
      accTime = blockEnd;
      
      if (i > newBlockIndex && workout.blocks[i].targetPower !== workout.blocks[newBlockIndex].targetPower) {
        const timeUntilNextChange = blockStart - elapsedSeconds;
        if (timeUntilNextChange > 0 && timeUntilNextChange <= 10) {
          setUpcomingChange({ 
            nextTarget: workout.blocks[i].targetPower, 
            currentTarget: workout.blocks[newBlockIndex].targetPower,
            seconds: timeUntilNextChange 
          });
          foundUpcoming = true;
          if (timeUntilNextChange === 10) {
            audioService.playNotification();
          }
        }
        break;
      }
    }
    if (!foundUpcoming) {
      setUpcomingChange(null);
    }

    const currentTarget = workout.blocks[newBlockIndex].targetPower;
    if (currentTarget !== lastTargetRef.current) {
      // Play change sounds if it's not the initial target setting
      if (lastTargetRef.current !== null) {
        if (currentTarget > lastTargetRef.current) {
          audioService.playAcceleration();
        } else if (currentTarget < lastTargetRef.current) {
          audioService.playDeceleration();
        }
      }
      lastTargetRef.current = currentTarget;
      onPowerTargetChange(currentTarget);
    }
  }, [elapsedSeconds, isPlaying, workout, onPowerTargetChange]);

  const handlePlayPause = () => {
    audioService.init();
    if (!isPlaying) {
      // Force immediate update on play
      let timeAcc = 0;
      let newBlockIndex = -1;
      for (let i = 0; i < workout.blocks.length; i++) {
        timeAcc += workout.blocks[i].durationSeconds;
        if (elapsedSeconds < timeAcc) {
          newBlockIndex = i;
          break;
        }
      }
      if (newBlockIndex !== -1) {
        const currentTarget = workout.blocks[newBlockIndex].targetPower;
        lastTargetRef.current = currentTarget;
        onPowerTargetChange(currentTarget);
      }
    }
    setIsPlaying(!isPlaying);
  };

  const handleStop = () => {
    setIsPlaying(false);
    setElapsedSeconds(0);
    setUpcomingChange(null);
    lastTargetRef.current = null;
  };

  const handleFinishSession = () => {
    onStopSession(workout.name, finishComments.trim() || undefined);
    setFinishComments("");
    setIsFinishOpen(false);
    handleStop();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/extract-workout", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to extract workout");
      }

      const llmWorkout = await res.json();
      const parsedWorkout = parseLLMWorkout(llmWorkout, riderProfile);

      await saveWorkout(parsedWorkout);
      setAllWorkouts(prev => [...prev, parsedWorkout]);
      setWorkout(parsedWorkout);
      setUnsavedBuiltWorkoutId(null);
      setBuilderRationale(null);
      handleStop();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleZwoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsedWorkout = parseZwoWorkout(text, riderProfile);

      await saveWorkout(parsedWorkout);
      setAllWorkouts(prev => [...prev, parsedWorkout]);
      setWorkout(parsedWorkout);
      setUnsavedBuiltWorkoutId(null);
      setBuilderRationale(null);
      handleStop();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to parse ZWO file");
    } finally {
      if (zwoFileInputRef.current) zwoFileInputRef.current.value = "";
    }
  };

  const handleBuildWorkout = async () => {
    const instructions = builderInstructions.trim();
    if (!instructions || isBuildingWorkout) return;

    setIsBuildingWorkout(true);
    setBuilderRationale(null);
    try {
      const res = await fetch("/api/workout-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Failed to build workout");
      }

      const generatedWorkout = data.workout as Workout;
      setWorkout(generatedWorkout);
      setBuilderRationale(typeof data.rationale === "string" ? data.rationale : null);
      setUnsavedBuiltWorkoutId(generatedWorkout.id);
      setBuilderInstructions("");
      setIsBuilderOpen(false);
      setIsPickerOpen(false);
      handleStop();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBuildingWorkout(false);
    }
  };

  const handleSaveBuiltWorkout = async () => {
    if (!unsavedBuiltWorkoutId || workout.id !== unsavedBuiltWorkoutId || isSavingBuiltWorkout) return;

    setIsSavingBuiltWorkout(true);
    try {
      await saveWorkout(workout);
      setAllWorkouts((prev) =>
        prev.some((savedWorkout) => savedWorkout.id === workout.id)
          ? prev
          : [...prev, workout]
      );
      setUnsavedBuiltWorkoutId(null);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingBuiltWorkout(false);
    }
  };

  const handleDeleteWorkout = async (target: Workout) => {
    if (deletingWorkoutId) return;
    const confirmed = window.confirm(`Delete "${target.name}"?`);
    if (!confirmed) return;

    setDeletingWorkoutId(target.id);
    try {
      await deleteWorkout(target.id);
      const remainingWorkouts = allWorkouts.filter((savedWorkout) => savedWorkout.id !== target.id);
      setAllWorkouts(remainingWorkouts);

      if (workout.id === target.id) {
        const fallback = remainingWorkouts[0] ?? ADAPTIVE_FREERIDE;
        setWorkout(fallback);
        setUnsavedBuiltWorkoutId(null);
        setBuilderRationale(null);
        handleStop();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingWorkoutId(null);
    }
  };

  const handleSeek = (seconds: number) => {
    setElapsedSeconds(seconds);
    let timeAcc = 0;
    let newBlockIndex = -1;
    for (let i = 0; i < workout.blocks.length; i++) {
      timeAcc += workout.blocks[i].durationSeconds;
      if (seconds < timeAcc) {
        newBlockIndex = i;
        break;
      }
    }
    if (newBlockIndex !== -1) {
      const currentTarget = workout.blocks[newBlockIndex].targetPower;
      lastTargetRef.current = currentTarget;
      onPowerTargetChange(currentTarget);
    } else {
      handleStop();
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const totalDuration = workout.blocks.reduce((acc, b) => acc + b.durationSeconds, 0);

  const speakCoachText = useCallback(async (text: string) => {
    const requestId = coachSpeechRequestRef.current + 1;
    coachSpeechRequestRef.current = requestId;

    try {
      const response = await fetch("/api/coach/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Coach speech failed");
      }

      const audio = await response.arrayBuffer();
      if (coachSpeechRequestRef.current !== requestId) return;
      await audioService.playArrayBuffer(audio);
    } catch (err) {
      console.warn("Coach speech unavailable:", err);
    }
  }, []);

  const buildTelemetrySnapshots = useCallback((): TelemetrySnapshot[] => {
    const samples = telemetrySamplesRef.current;
    if (samples.length === 0) return [];

    const windowSeconds = 30;
    const firstBucket = Math.floor(samples[0].elapsedSeconds / windowSeconds) * windowSeconds;
    const lastBucket = Math.floor(samples[samples.length - 1].elapsedSeconds / windowSeconds) * windowSeconds;
    const snapshots: TelemetrySnapshot[] = [];

    for (let bucketStart = firstBucket; bucketStart <= lastBucket; bucketStart += windowSeconds) {
      const bucketSamples = samples.filter(
        (sample) =>
          sample.elapsedSeconds >= bucketStart &&
          sample.elapsedSeconds < bucketStart + windowSeconds
      );
      if (bucketSamples.length === 0) continue;

      const lastSample = bucketSamples[bucketSamples.length - 1];
      snapshots.push({
        offsetSeconds: bucketStart,
        durationSeconds: Math.min(windowSeconds, bucketSamples.length),
        avgPowerW: averageNullable(bucketSamples.map((sample) => sample.power)),
        avgCadenceRpm: averageNullable(bucketSamples.map((sample) => sample.cadence)),
        avgHeartRateBpm: averageNullable(bucketSamples.map((sample) => sample.heartRate)),
        targetPower: lastSample.targetPower,
        hrZone: lastSample.hrZoneName,
      });
    }

    return snapshots.slice(-20);
  }, []);

  const requestLiveCoachCheck = useCallback(async (intent: "ride_start_summary" | "periodic_ride_check") => {
    if (liveCoachRunningRef.current) return;
    liveCoachRunningRef.current = true;
    setLiveCoachStatus("checking");

    try {
      const remainingWorkout = getRemainingWorkoutSnapshot();
      const telemetrySnapshots = buildTelemetrySnapshots();
      const latestSnapshot = telemetrySamplesRef.current[telemetrySamplesRef.current.length - 1] ?? null;
      const response = await fetch("/api/coach/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          snapshot: {
            generatedAtIso: new Date().toISOString(),
            workoutName: workout.name,
            latestSample: latestSnapshot
              ? {
                  powerW: latestSnapshot.power,
                  cadenceRpm: latestSnapshot.cadence,
                  heartRateBpm: latestSnapshot.heartRate,
                }
              : null,
            currentHrZone: currentHrZone
              ? {
                  id: currentHrZone.id,
                  name: currentHrZone.name,
                  minBpm: currentHrZone.minBpm,
                  maxBpm: currentHrZone.maxBpm,
                }
              : null,
            activeTrainerMode,
            riderProfile: {
              fourDP: riderProfile.fourDP,
              cTHR: riderProfile.cTHR,
              age: riderProfile.age,
              weightKg: riderProfile.weightKg,
              gender: riderProfile.gender,
              hrZones: riderProfile.hrZones.map((zone) => ({
                id: zone.id,
                name: zone.name,
                percentageRange: zone.percentageRange,
                minBpm: zone.minBpm,
                maxBpm: zone.maxBpm,
              })),
              memorySummary: riderProfile.memorySummary || null,
            },
            rolling: {
              sampleWindowSeconds: 30,
              snapshots: telemetrySnapshots,
              rideSoFar: {
                elapsedSeconds,
                avgPowerW: averageNullable(telemetrySamplesRef.current.map((sample) => sample.power)),
                avgCadenceRpm: averageNullable(telemetrySamplesRef.current.map((sample) => sample.cadence)),
                avgHeartRateBpm: averageNullable(telemetrySamplesRef.current.map((sample) => sample.heartRate)),
              },
            },
            remainingWorkout,
          },
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Live coach check failed");
      }

      const text =
        typeof data?.action?.text === "string" && data.action.text.trim()
          ? data.action.text.trim()
          : typeof data?.command?.text === "string" && data.command.text.trim()
            ? data.command.text.trim()
            : null;

      if (text) {
        setLiveCoachFeedback(text);
        audioService.playCoachMessage();
        void speakCoachText(text);
      }
      if (typeof data?.action?.reason === "string") {
        setLiveCoachDetail(data.action.reason);
      } else if (typeof data?.command?.reason === "string") {
        setLiveCoachDetail(data.command.reason);
      }
      setLiveCoachStatus("idle");
    } catch (err) {
      console.error(err);
      setLiveCoachStatus("error");
      setLiveCoachDetail(err instanceof Error ? err.message : String(err));
    } finally {
      liveCoachRunningRef.current = false;
    }
  }, [
    activeTrainerMode,
    buildTelemetrySnapshots,
    currentHrZone,
    elapsedSeconds,
    getRemainingWorkoutSnapshot,
    riderProfile,
    speakCoachText,
    workout.name,
  ]);

  useEffect(() => {
    if (!isPlaying) return;

    if (elapsedSeconds === 0 && !initialLiveCoachRequestedRef.current) {
      initialLiveCoachRequestedRef.current = true;
      void requestLiveCoachCheck("ride_start_summary");
      return;
    }

    if (elapsedSeconds <= 0) return;

    telemetrySamplesRef.current.push({
      elapsedSeconds,
      power,
      cadence,
      heartRate,
      targetPower: getRemainingWorkoutSnapshot().currentTargetPower,
      hrZoneName: currentHrZone?.name ?? null,
    });
    telemetrySamplesRef.current = telemetrySamplesRef.current.filter(
      (sample) => elapsedSeconds - sample.elapsedSeconds <= 10 * 60
    );

    if (
      elapsedSeconds >= 5 * 60 &&
      elapsedSeconds % (5 * 60) === 0 &&
      lastLiveCoachCheckSecondRef.current !== elapsedSeconds
    ) {
      lastLiveCoachCheckSecondRef.current = elapsedSeconds;
      void requestLiveCoachCheck("periodic_ride_check");
    }
  }, [
    cadence,
    currentHrZone,
    elapsedSeconds,
    getRemainingWorkoutSnapshot,
    heartRate,
    isPlaying,
    power,
    requestLiveCoachCheck,
  ]);

  useEffect(() => {
    if (elapsedSeconds === 0) {
      telemetrySamplesRef.current = [];
      initialLiveCoachRequestedRef.current = false;
      lastLiveCoachCheckSecondRef.current = 0;
      liveCoachRunningRef.current = false;
      setLiveCoachStatus("idle");
      setLiveCoachFeedback(null);
      setLiveCoachDetail(null);
    }
  }, [elapsedSeconds]);

  const renderBuilderDialogContent = () => (
    <DialogContent className="sm:max-w-xl rounded-md">
      <DialogHeader>
        <DialogTitle>Build Ride</DialogTitle>
        <DialogDescription>
          Describe today&apos;s workout target.
        </DialogDescription>
      </DialogHeader>
      <textarea
        value={builderInstructions}
        onChange={(event) => setBuilderInstructions(event.target.value)}
        placeholder="Example: 45 minutes endurance, mostly Z2, keep it gentle because HR ran high last ride."
        className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => setIsBuilderOpen(false)}
          disabled={isBuildingWorkout}
        >
          Cancel
        </Button>
        <Button
          onClick={handleBuildWorkout}
          disabled={!builderInstructions.trim() || isBuildingWorkout}
        >
          {isBuildingWorkout ? "Building..." : "Build & Load"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">Workout Player</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/20 px-3 py-1.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Select workout"
            >
              <span className="max-w-[250px] truncate text-sm font-bold">{workout.name}</span>
              <span className="text-xs text-muted-foreground" aria-hidden="true">▾</span>
            </button>
            {/* Adaptive Freeride ticker removed */}
            {workout.id.startsWith("imported-") && (
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={async () => {
                  const newName = prompt("Enter new name for this workout:", workout.name);
                  if (newName && newName.trim() !== "") {
                    const updated = { ...workout, name: newName.trim() };
                    await updateWorkout(updated);
                    setWorkout(updated);
                    setAllWorkouts(prev => prev.map(w => w.id === updated.id ? updated : w));
                  }
                }}
                disabled={isPlaying || isUploading}
                title="Rename Workout"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Button
            variant={adaptive ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setWorkout(ADAPTIVE_FREERIDE);
              setUnsavedBuiltWorkoutId(null);
              setBuilderRationale(null);
              handleStop();
            }}
            disabled={isPlaying}
            title="Load a flexible freeride plan that starts at 80 W."
          >
            {adaptive ? "Adaptive Loaded" : "Adaptive Freeride"}
          </Button>
          <Dialog open={isBuilderOpen} onOpenChange={setIsBuilderOpen}>
            <DialogTrigger asChild>
              <Button
                variant="default"
                size="sm"
                disabled={isPlaying || isUploading || isBuildingWorkout}
              >
                Build Ride
              </Button>
            </DialogTrigger>
            {renderBuilderDialogContent()}
          </Dialog>
          <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
              <DialogHeader className="p-6 pb-2 flex flex-row items-center justify-between space-y-0">
                <div>
                  <DialogTitle>Select Workout</DialogTitle>
                  <DialogDescription>
                    Choose from built-in or imported workouts.
                  </DialogDescription>
                </div>
                <div className="flex gap-2 pr-6">
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleUpload} 
                  />
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={() => fileInputRef.current?.click()} 
                    disabled={isPlaying || isUploading}
                  >
                    {isUploading ? "Extracting..." : "Import Image"}
                  </Button>

                  <input 
                    type="file" 
                    accept=".zwo" 
                    className="hidden" 
                    ref={zwoFileInputRef} 
                    onChange={handleZwoUpload} 
                  />
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={() => zwoFileInputRef.current?.click()} 
                    disabled={isPlaying}
                  >
                    Import ZWO
                  </Button>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto p-6 pt-2 flex flex-col gap-3">
                {allWorkouts.map((w) => {
                  const metrics = calculateWorkoutMetrics(w, riderProfile.fourDP.ftp);
                  const duration = w.blocks.reduce((acc, b) => acc + b.durationSeconds, 0);
                  const isActive = workout.id === w.id;
                  const isDeleting = deletingWorkoutId === w.id;

                  return (
                    <div 
                      key={w.id} 
                      className={`flex flex-col gap-3 p-4 border rounded-md cursor-pointer transition-all hover:border-primary/50 group ${
                        isActive ? "bg-primary/5 border-primary shadow-sm" : "bg-card hover:bg-muted/30"
                      }`}
                      onClick={() => {
                        setWorkout(w);
                        setUnsavedBuiltWorkoutId(null);
                        setBuilderRationale(null);
                        handleStop();
                        setIsPickerOpen(false);
                      }}
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className={`font-bold text-base ${isActive ? "text-primary" : ""}`}>
                            {w.name}
                          </span>
                          <div className="flex gap-4 text-xs text-muted-foreground font-medium">
                            <span className="flex gap-1 items-center">
                              <span className="opacity-70">Duration:</span>
                              <span className="font-mono text-foreground">{Math.floor(duration / 60)}m</span>
                            </span>
                            <span className="flex gap-1 items-center">
                              <span className="opacity-70">TSS:</span>
                              <span className="font-mono text-foreground">{Math.round(metrics.tss)}</span>
                            </span>
                            <span className="flex gap-1 items-center">
                              <span className="opacity-70">IF:</span>
                              <span className="font-mono text-foreground">{metrics.iff.toFixed(2)}</span>
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {isActive && (
                            <div className="px-2 py-0.5 bg-primary text-[10px] text-primary-foreground font-bold rounded-full uppercase tracking-wider">
                              Active
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={isPlaying || isDeleting}
                            title="Delete workout"
                            aria-label={`Delete ${w.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteWorkout(w);
                            }}
                            className="text-muted-foreground opacity-100 hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      <WorkoutChart workout={w} progressSeconds={0} preview={true} riderProfile={riderProfile} />
                    </div>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <WorkoutChart workout={workout} progressSeconds={elapsedSeconds} onSeek={handleSeek} riderProfile={riderProfile} />

      {builderRationale && (
        <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 font-bold uppercase tracking-wider text-foreground">
                Builder Rationale
              </div>
              {builderRationale}
            </div>
            {unsavedBuiltWorkoutId === workout.id && (
              <Button
                size="sm"
                onClick={handleSaveBuiltWorkout}
                disabled={isSavingBuiltWorkout}
                className="shrink-0"
              >
                {isSavingBuiltWorkout ? "Saving..." : "Save Track"}
              </Button>
            )}
          </div>
          {unsavedBuiltWorkoutId === workout.id && (
            <p className="text-[10px] text-muted-foreground">
              This AI-built ride is loaded as a draft. Save it to keep it in Change Workout.
            </p>
          )}
        </div>
      )}

      {/* Telemetry Card - Integrated into Player */}
      <div className="flex flex-col rounded-md border bg-muted/20 overflow-hidden">
        <div className="p-4 grid grid-cols-3 gap-4 text-center">
          <div className="flex flex-col items-center">
            <span className="text-xs text-muted-foreground uppercase font-semibold h-8 flex flex-col items-center justify-end pb-1 gap-0.5">
              <span>Power</span>
              {activeTrainerMode.type === "erg" && (
                <span className="text-[10px] text-primary normal-case font-medium leading-none">
                  Target: {activeTrainerMode.watts}W
                </span>
              )}
            </span>
            <span className="text-2xl font-mono">{power ?? "-"} <span className="text-sm">W</span></span>
            
            <div className="h-6 w-full mt-1">
              {upcomingChange && (
                <div className="flex flex-col items-center w-full max-w-[100px] mx-auto gap-1">
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-1000 ease-linear ${upcomingChange.nextTarget > upcomingChange.currentTarget ? 'bg-orange-500' : 'bg-blue-400'}`} 
                      style={{ width: `${(upcomingChange.seconds / 10) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-none">
                    <span className={upcomingChange.nextTarget > upcomingChange.currentTarget ? 'text-orange-500' : 'text-blue-400'}>
                      {upcomingChange.nextTarget > upcomingChange.currentTarget ? '▲' : '▼'} {upcomingChange.nextTarget}W
                    </span>
                    <span className="ml-1 opacity-70">in {upcomingChange.seconds}s</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground uppercase font-semibold h-8 flex flex-col items-center justify-end pb-1">
              Cadence
            </span>
            <span className="text-2xl font-mono">{cadence ?? "-"} <span className="text-sm">rpm</span></span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground uppercase font-semibold h-8 flex flex-col items-center justify-end pb-1 gap-0.5">
              <span>HR</span>
              {currentHrZone && (
                <span 
                  className="text-[10px] normal-case font-medium leading-none"
                  style={{ color: currentHrZone.color }}
                >
                  {currentHrZone.name.split(" ")[0]} ({currentHrZone.minBpm}-{currentHrZone.maxBpm})
                </span>
              )}
            </span>
            <span 
              className="text-2xl font-mono"
              style={{ color: currentHrZone?.color }}
            >
              {heartRate ?? "-"} <span className="text-sm opacity-75">bpm</span>
            </span>
          </div>
        </div>
        <div className="px-4 py-2 bg-muted/40 border-t flex justify-between items-center">
          <span className="text-xs text-muted-foreground uppercase font-semibold">Active Mode</span>
          <span className="text-sm font-medium">
            {activeTrainerMode.type === "none" && <span className="text-muted-foreground">None</span>}
            {activeTrainerMode.type === "erg" && <span className="text-primary">ERG ({activeTrainerMode.watts} W)</span>}
            {activeTrainerMode.type === "resistance" && <span className="text-primary">Resistance ({activeTrainerMode.level}%)</span>}
          </span>
        </div>
        {(liveCoachFeedback || liveCoachStatus !== "idle") && (
          <div className="border-t px-4 py-3">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                Ride Coach
              </span>
              {liveCoachStatus === "checking" && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Checking
                </span>
              )}
              {liveCoachStatus === "error" && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-destructive">
                  Offline
                </span>
              )}
            </div>
            {liveCoachFeedback && (
              <p className="text-sm font-medium leading-relaxed">{liveCoachFeedback}</p>
            )}
            {liveCoachDetail && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {liveCoachDetail}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between bg-muted/20 p-4 rounded-md border mt-2">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Time</span>
          <span className="font-mono text-xl">{formatTime(elapsedSeconds)} <span className="text-sm text-muted-foreground">/ {formatTime(totalDuration)}</span></span>
        </div>

        <div className="flex gap-2">
          {disabled ? (
            <p className="text-xs text-red-500 font-medium self-center mr-4">Connect trainer to play</p>
          ) : null}

          {elapsedSeconds > 0 && !isPlaying && (
            <Dialog open={isFinishOpen} onOpenChange={setIsFinishOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive">Finish & Save</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg rounded-md">
                <DialogHeader>
                  <DialogTitle>Finish Session</DialogTitle>
                  <DialogDescription>
                    Add rider notes for the post-ride summary.
                  </DialogDescription>
                </DialogHeader>
                <textarea
                  value={finishComments}
                  onChange={(event) => setFinishComments(event.target.value)}
                  placeholder="How did it feel? Fueling, heat, legs, HR strap, anything unusual..."
                  className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsFinishOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleFinishSession}>
                    Finish & Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          <Button 
            onClick={handleStop} 
            variant="outline" 
            disabled={elapsedSeconds === 0}
          >
            Reset Timer
          </Button>
          <Button 
            onClick={handlePlayPause}
            variant={isPlaying ? "secondary" : "default"}
            disabled={disabled || elapsedSeconds >= totalDuration}
            className="w-24"
          >
            {isPlaying ? "Pause" : "Play"}
          </Button>
        </div>
      </div>
    </div>
  );
});
