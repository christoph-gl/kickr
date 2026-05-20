"use client";

import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from "react";
import {
  WORKOUTS,
  Workout,
  WorkoutBlock,
  parseLLMWorkout,
  saveWorkout,
  getSavedWorkouts,
  updateWorkout,
  parseZwoWorkout,
  calculateWorkoutMetrics,
  ADAPTIVE_FREERIDE,
  isAdaptiveFreeride,
  spliceUpcomingBlocks,
} from "@/lib/workouts";
import { WorkoutChart } from "./workout-chart";
import { Button } from "./ui/button";
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
  currentHrZone?: any;
  activeTrainerMode: any;
  riderProfile?: RiderProfile;
};

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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [upcomingChange, setUpcomingChange] = useState<{ nextTarget: number, currentTarget: number, seconds: number } | null>(null);
  const lastTargetRef = useRef<number | null>(null);
  const elapsedSecondsRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zwoFileInputRef = useRef<HTMLInputElement>(null);
  const wakeLockRef = useRef<any>(null);
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
    if ("wakeLock" in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
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
      const saved = await getSavedWorkouts();
      if (saved.length > 0) {
        setAllWorkouts([...WORKOUTS, ...saved]);
      }
    }
    loadSaved();
  }, []);

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
      handleStop();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to parse ZWO file");
    } finally {
      if (zwoFileInputRef.current) zwoFileInputRef.current.value = "";
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">Workout Player</h2>
          <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-muted/20">
            <span className="font-bold text-sm truncate max-w-[250px]">{workout.name}</span>
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
              handleStop();
            }}
            disabled={isPlaying}
            title="Start an LLM-coached freeride. Begins at 80 W; use the live coach chat to request plan changes."
          >
            {adaptive ? "Adaptive Loaded" : "Adaptive Freeride"}
          </Button>
          <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">Change Workout</Button>
            </DialogTrigger>
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

              <div className="flex-1 overflow-y-auto p-6 pt-2 flex flex-col gap-3">                {allWorkouts.map((w) => {
                  const metrics = calculateWorkoutMetrics(w, riderProfile.fourDP.ftp);
                  const duration = w.blocks.reduce((acc, b) => acc + b.durationSeconds, 0);
                  const isActive = workout.id === w.id;

                  return (
                    <div 
                      key={w.id} 
                      className={`flex flex-col gap-3 p-4 border rounded-md cursor-pointer transition-all hover:border-primary/50 group ${
                        isActive ? "bg-primary/5 border-primary shadow-sm" : "bg-card hover:bg-muted/30"
                      }`}
                      onClick={() => {
                        setWorkout(w);
                        handleStop();
                        setIsPickerOpen(false);
                      }}
                    >
                      <div className="flex justify-between items-start">
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
                        {isActive && (
                          <div className="px-2 py-0.5 bg-primary text-[10px] text-primary-foreground font-bold rounded-full uppercase tracking-wider">
                            Active
                          </div>
                        )}
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
