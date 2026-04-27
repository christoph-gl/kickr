"use client";

import { useRef, useState } from "react";
import { KickrCore2Client } from "@/lib/kickr-client";
import { HeartRateClient } from "@/lib/hr-client";
import { Button } from "@/components/ui/button";

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

  async function connect() {
    try {
      setConnectionState("connecting");
      await clientRef.current.connect(
        (sample) => {
          setPower(sample.powerW);
          setCadence(sample.cadenceRpm);
          // Only update local HR state if trainer provides it AND external HRM is not connected
          if (sample.heartRateBpm !== undefined && !hrClientRef.current.isConnected) {
            setHeartRate(sample.heartRateBpm);
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
  
  async function applyTargetPower() {
    try {
      await clientRef.current.setTargetPower(targetPower);
      setActiveTrainerMode({ type: "erg", watts: targetPower });
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  }

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
      <div className="flex max-w-md min-w-0 flex-col gap-6 text-sm w-full">
        <h1 className="text-2xl font-bold">Workout Controller</h1>

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

          {/* Telemetry Card */}
          <div className="flex flex-col rounded-md border bg-muted/20 overflow-hidden">
            <div className="p-4 grid grid-cols-3 gap-4 text-center">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground uppercase font-semibold">Power</span>
                <span className="text-2xl font-mono">{power ?? "-"} <span className="text-sm">W</span></span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground uppercase font-semibold">Cadence</span>
                <span className="text-2xl font-mono">{cadence ?? "-"} <span className="text-sm">rpm</span></span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground uppercase font-semibold">HR</span>
                <span className="text-2xl font-mono">{heartRate ?? "-"} <span className="text-sm">bpm</span></span>
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
                    onClick={applyTargetPower} 
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

          <Button 
            onClick={exportCsv} 
            variant="outline" 
            className="w-full"
            disabled={clientRef.current.samples.length === 0}
          >
            Export CSV ({clientRef.current.samples.length} samples)
          </Button>
        </div>
      </div>
    </main>
  );
}
