"use client";

import { useRef, useState, useEffect } from "react";
import { KickrCore2Client } from "@/lib/kickr-client";
import { HeartRateClient } from "@/lib/hr-client";
import { Button } from "@/components/ui/button";
import { RIDER_PROFILE } from "@/lib/profile";
import { WorkoutPlayer } from "@/components/workout-player";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ConnectionState = "disconnected" | "connecting" | "connected";
type TrainerMode = "erg" | "resistance";
type ActiveTrainerMode = { type: "none" } | { type: "erg", watts: number } | { type: "resistance", level: number };

export default function App() {
  const clientRef = useRef(new KickrCore2Client());
  const hrClientRef = useRef(new HeartRateClient());

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [hrConnectionState, setHrConnectionState] = useState<ConnectionState>("disconnected");

  const [power, setPower] = useState<number | undefined>();
  const [cadence, setCadence] = useState<number | undefined>();
  const [heartRate, setHeartRate] = useState<number | undefined>();
  
  // Controls
  const [mode, setMode] = useState<TrainerMode>("erg");
  const [resistance, setResistance] = useState(20);
  const [targetPower, setTargetPower] = useState(150);
  
  // What the trainer is currently running
  const [activeTrainerMode, setActiveTrainerMode] = useState<ActiveTrainerMode>({ type: "none" });

  const [sessions, setSessions] = useState<RideSession[]>([]);
  const currentSessionFilenameRef = useRef<string | null>(null);
  const activeWorkoutNameRef = useRef<string>("Manual Ride");
  const unsavedSamplesRef = useRef<any[]>([]);

  useEffect(() => {
    setSessions(getSavedRideSessions());
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
            profile: RIDER_PROFILE.fourDP
          } : undefined,
          finalMetrics
        }),
      });
    } catch (e) {
      console.error("Failed to log samples to server:", e);
    }
  };

  const currentHrZone = heartRate 
    ? RIDER_PROFILE.hrZones.find(z => heartRate >= z.minBpm && heartRate <= z.maxBpm) 
    : undefined;

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
        }
      );
      setConnectionState("connected");
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

  async function applyResistance() {
    try {
      await clientRef.current.setResistance(resistance);
      setActiveTrainerMode({ type: "resistance", level: resistance });
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  }
  
  async function applyTargetPower(watts?: number) {
    const powerToSet = typeof watts === "number" ? watts : targetPower;
    try {
      await clientRef.current.setTargetPower(powerToSet);
      setActiveTrainerMode({ type: "erg", watts: powerToSet });
      if (typeof watts === "number") {
        setTargetPower(watts);
      }
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const handleStopSession = (workoutName: string) => {
    const samples = [...clientRef.current.samples];
    if (samples.length === 0) return;

    const metrics = calculateActualMetrics(samples, RIDER_PROFILE.fourDP.ftp);
    
    // Final log of remaining samples and metrics before ending session
    logSamples(unsavedSamplesRef.current, false, metrics);
    unsavedSamplesRef.current = [];

    const newSession: RideSession = {
      id: "session-" + Date.now(),
      workoutName,
      timestamp: Date.now(),
      samples,
      metrics
    };

    saveRideSession(newSession);
    setSessions(prev => [newSession, ...prev]);
    clientRef.current.samples = []; // Clear samples for next session
    currentSessionFilenameRef.current = null; // Mark session as ended
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

  const handleDeleteSession = (id: string) => {
    if (window.confirm("Delete this session?")) {
      deleteRideSession(id);
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

  return (
    <main className="flex min-h-svh p-6">
      {/* Left Column - Controls & Telemetry */}
      <div className="flex max-w-md min-w-0 flex-col gap-6 text-sm w-full">
        
        {/* Header with Settings */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Workout Controller</h1>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">Settings</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Profile Settings</DialogTitle>
                <DialogDescription>
                  Your current rider profile and target zones.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-6 mt-4">
                {/* 4DP Profile Card */}
                <div className="flex flex-col border rounded-md bg-card overflow-hidden">
                  <div className="p-4 bg-muted/20 border-b">
                    <h3 className="font-semibold text-base">Four Dimensional Power (4DP®) Profile</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your Neuromuscular Power (NM), Anaerobic Capacity (AC), Maximal Aerobic Power (MAP) and Functional Threshold Power (FTP) are used to set your workout targets.
                    </p>
                  </div>
                  <div className="flex flex-col divide-y">
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: RIDER_PROFILE.colors.nm }}></div>
                        <span className="font-medium">NM (5 second)</span>
                      </div>
                      <span className="font-mono">{RIDER_PROFILE.fourDP.nm} watts</span>
                    </div>
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: RIDER_PROFILE.colors.ac }}></div>
                        <span className="font-medium">AC (1 minute)</span>
                      </div>
                      <span className="font-mono">{RIDER_PROFILE.fourDP.ac} watts</span>
                    </div>
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: RIDER_PROFILE.colors.map }}></div>
                        <span className="font-medium">MAP (5 minute)</span>
                      </div>
                      <span className="font-mono">{RIDER_PROFILE.fourDP.map} watts</span>
                    </div>
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: RIDER_PROFILE.colors.ftp }}></div>
                        <span className="font-medium">FTP (20 minute)</span>
                      </div>
                      <span className="font-mono">{RIDER_PROFILE.fourDP.ftp} watts</span>
                    </div>
                  </div>
                </div>

                {/* Heart Rate Zones Card */}
                <div className="flex flex-col border rounded-md bg-card overflow-hidden">
                  <div className="p-4 bg-muted/20 border-b flex justify-between items-center">
                    <div>
                      <h3 className="font-semibold text-base">cTHR and Heart Rate Zones</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Cycling Threshold Heart Rate (cTHR) is your expected heart rate when riding at FTP.
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground uppercase font-semibold">cTHR</div>
                      <div className="font-mono text-lg">{RIDER_PROFILE.cTHR} bpm</div>
                    </div>
                  </div>
                  <div className="flex flex-col divide-y">
                    <div className="grid grid-cols-3 gap-4 p-3 px-4 text-xs font-semibold text-muted-foreground uppercase bg-muted/10">
                      <div>Zone</div>
                      <div>Range (%cTHR)</div>
                      <div className="text-right">BPM</div>
                    </div>
                    {RIDER_PROFILE.hrZones.map((zone) => (
                      <div key={zone.id} className="grid grid-cols-3 gap-4 p-4 items-center">
                        <div className="font-medium">{zone.name}</div>
                        <div className="text-muted-foreground">{zone.percentageRange}</div>
                        <div className="text-right font-mono">
                          {zone.id === "z1" ? `< ${zone.maxBpm}` : zone.id === "z5" ? `> ${zone.minBpm}` : `${zone.minBpm} - ${zone.maxBpm}`}
                        </div>
                      </div>
                    ))}
                  </div>
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
                  onClick={applyResistance} 
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

          <div className="flex flex-col gap-2 pt-2 border-t">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Session History</h3>
            
            {/* Current unsaved samples if any */}
            {clientRef.current.samples.length > 0 && (
              <div className="p-3 border rounded-md bg-muted/10 border-dashed flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-xs">Unsaved Session</span>
                  <span className="text-[10px] text-muted-foreground">{clientRef.current.samples.length} samples</span>
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
      <div className="hidden lg:flex min-w-0 flex-col gap-6 w-full max-w-4xl">
        <WorkoutPlayer 
           disabled={connectionState !== "connected"} 
           onPowerTargetChange={applyTargetPower} 
           onStopSession={handleStopSession}
           onWorkoutChange={(w) => activeWorkoutNameRef.current = w.name}
           power={power}
           cadence={cadence}
           heartRate={heartRate}
           currentHrZone={currentHrZone}
           activeTrainerMode={activeTrainerMode}
        />
      </div>
    </main>
  );
}
