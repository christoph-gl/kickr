"use client";

import { useState, useEffect, useRef } from "react";
import { WORKOUTS, Workout, parseLLMWorkout, saveWorkout, getSavedWorkouts, updateWorkout, parseZwoWorkout } from "@/lib/workouts";
import { WorkoutChart } from "./workout-chart";
import { Button } from "./ui/button";

export function WorkoutPlayer({ 
  onPowerTargetChange,
  disabled
}: { 
  onPowerTargetChange: (watts: number) => void;
  disabled: boolean;
}) {
  const [allWorkouts, setAllWorkouts] = useState<Workout[]>(WORKOUTS);
  const [workout, setWorkout] = useState<Workout>(WORKOUTS[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const lastTargetRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zwoFileInputRef = useRef<HTMLInputElement>(null);

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
        <h2 className="text-2xl font-bold">Workout Player</h2>
        <div className="flex gap-2 items-center">
          <select 
            className="border rounded-md px-3 py-1.5 bg-background text-sm max-w-[200px] truncate"
            value={workout.id}
            onChange={(e) => {
              const w = allWorkouts.find(w => w.id === e.target.value);
              if (w) {
                setWorkout(w);
                handleStop();
              }
            }}
            disabled={isPlaying || isUploading}
          >
            {allWorkouts.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          {workout.id.startsWith("imported-") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
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
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </Button>
          )}
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleUpload} 
          />
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => fileInputRef.current?.click()} 
            disabled={isPlaying || isUploading}
            title="Import from Image"
          >
            {isUploading ? "Extracting..." : "Image"}
          </Button>

          <input 
            type="file" 
            accept=".zwo" 
            className="hidden" 
            ref={zwoFileInputRef} 
            onChange={handleZwoUpload} 
          />
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => zwoFileInputRef.current?.click()} 
            disabled={isPlaying}
            title="Import ZWO file"
          >
            ZWO
          </Button>
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
          <Button 
            onClick={handleStop} 
            variant="outline" 
            disabled={elapsedSeconds === 0}
          >
            Reset
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