"use client";

import { useState, useEffect, useRef } from "react";
import { WORKOUTS, Workout, parseLLMWorkout, saveWorkout, getSavedWorkouts, updateWorkout, parseZwoWorkout, calculateWorkoutMetrics } from "@/lib/workouts";
import { WorkoutChart } from "./workout-chart";
import { Button } from "./ui/button";
import { RIDER_PROFILE } from "@/lib/profile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function WorkoutPlayer({ 
  onPowerTargetChange,
  onStopSession,
  disabled
}: { 
  onPowerTargetChange: (watts: number) => void;
  onStopSession: (workoutName: string) => void;
  disabled: boolean;
}) {
  const [allWorkouts, setAllWorkouts] = useState<Workout[]>(WORKOUTS);
  const [workout, setWorkout] = useState<Workout>(WORKOUTS[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const lastTargetRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zwoFileInputRef = useRef<HTMLInputElement>(null);
  const wakeLockRef = useRef<any>(null);

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
    const saved = getSavedWorkouts();
    if (saved.length > 0) {
      setAllWorkouts([...WORKOUTS, ...saved]);
    }
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
      return;
    }

    const currentTarget = workout.blocks[newBlockIndex].targetPower;
    if (currentTarget !== lastTargetRef.current) {
      lastTargetRef.current = currentTarget;
      onPowerTargetChange(currentTarget);
    }
  }, [elapsedSeconds, isPlaying, workout, onPowerTargetChange]);

  const handlePlayPause = () => {
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
    lastTargetRef.current = null;
  };

  const handleStopSession = () => {
    if (window.confirm("End workout session and save data?")) {
      onStopSession(workout.name);
      handleStop();
    }
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
      const parsedWorkout = parseLLMWorkout(llmWorkout);

      saveWorkout(parsedWorkout);
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
      const parsedWorkout = parseZwoWorkout(text);

      saveWorkout(parsedWorkout);
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
            {workout.id.startsWith("imported-") && (
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => {
                  const newName = prompt("Enter new name for this workout:", workout.name);
                  if (newName && newName.trim() !== "") {
                    const updated = { ...workout, name: newName.trim() };
                    updateWorkout(updated);
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
                  const metrics = calculateWorkoutMetrics(w, RIDER_PROFILE.fourDP.ftp);
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
                      <WorkoutChart workout={w} progressSeconds={0} preview={true} />
                    </div>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <WorkoutChart workout={workout} progressSeconds={elapsedSeconds} onSeek={handleSeek} />

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
            <Button 
              onClick={handleStopSession} 
              variant="destructive"
            >
              Stop Session
            </Button>
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
}