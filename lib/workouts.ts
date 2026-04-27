import { RIDER_PROFILE } from "./profile";

export type WorkoutBlock = {
  durationSeconds: number;
  targetPower: number;
};

export type Workout = {
  id: string;
  name: string;
  description: string;
  blocks: WorkoutBlock[];
};

export type LLMWorkoutBlock = {
  duration_seconds: number;
  zone: string;
  intensity_percent: number;
  reference_metric: "FTP" | "MAP" | "AC" | "NM";
};

export type LLMWorkout = {
  name: string;
  total_duration_minutes: number;
  blocks: LLMWorkoutBlock[];
};

export function parseLLMWorkout(llmJson: LLMWorkout): Workout {
  return {
    id: "imported-" + Date.now(),
    name: llmJson.name || "Imported Workout",
    description: "Imported via AI extraction",
    blocks: llmJson.blocks.map((block) => {
      let basePower = RIDER_PROFILE.fourDP.ftp;
      if (block.reference_metric === "MAP") basePower = RIDER_PROFILE.fourDP.map;
      if (block.reference_metric === "AC") basePower = RIDER_PROFILE.fourDP.ac;
      if (block.reference_metric === "NM") basePower = RIDER_PROFILE.fourDP.nm;

      return {
        durationSeconds: block.duration_seconds,
        targetPower: Math.round(basePower * (block.intensity_percent / 100)),
      };
    }),
  };
}

export function parseZwoWorkout(xmlString: string): Workout {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  
  const nameNode = xmlDoc.querySelector("name");
  const descNode = xmlDoc.querySelector("description");
  
  const name = nameNode ? nameNode.textContent || "ZWO Workout" : "ZWO Workout";
  const description = descNode ? descNode.textContent || "Imported from ZWO file" : "Imported from ZWO file";
  
  const workoutNodes = xmlDoc.querySelector("workout")?.children;
  const blocks: WorkoutBlock[] = [];
  
  if (workoutNodes) {
    for (let i = 0; i < workoutNodes.length; i++) {
      const node = workoutNodes[i];
      const tag = node.tagName.toLowerCase();
      
      if (tag === "steadystate" || tag === "warmup" || tag === "cooldown" || tag === "freeride") {
        // Technically Warmup/Cooldown might have PowerLow/PowerHigh for ramps, but we'll simplify to Power or average if needed
        const duration = parseFloat(node.getAttribute("Duration") || "0");
        let powerRatio = parseFloat(node.getAttribute("Power") || "0");
        
        if (node.hasAttribute("PowerLow") && node.hasAttribute("PowerHigh")) {
          const powerLow = parseFloat(node.getAttribute("PowerLow") || "0");
          const powerHigh = parseFloat(node.getAttribute("PowerHigh") || "0");
          powerRatio = (powerLow + powerHigh) / 2; // simplified ramp
        }
        
        blocks.push({
          durationSeconds: duration,
          targetPower: Math.round(RIDER_PROFILE.fourDP.ftp * powerRatio)
        });
      } else if (tag === "intervalst") {
        const repeat = parseInt(node.getAttribute("Repeat") || "1", 10);
        const onDuration = parseFloat(node.getAttribute("OnDuration") || "0");
        const onPower = parseFloat(node.getAttribute("OnPower") || "0");
        const offDuration = parseFloat(node.getAttribute("OffDuration") || "0");
        const offPower = parseFloat(node.getAttribute("OffPower") || "0");
        
        for (let r = 0; r < repeat; r++) {
          blocks.push({
            durationSeconds: onDuration,
            targetPower: Math.round(RIDER_PROFILE.fourDP.ftp * onPower)
          });
          if (offDuration > 0) {
            blocks.push({
              durationSeconds: offDuration,
              targetPower: Math.round(RIDER_PROFILE.fourDP.ftp * offPower)
            });
          }
        }
      }
    }
  }

  return {
    id: "imported-zwo-" + Date.now(),
    name,
    description,
    blocks
  };
}

export function calculateWorkoutMetrics(workout: Workout, ftp: number) {
  const totalSeconds = workout.blocks.reduce((acc, b) => acc + b.durationSeconds, 0);
  if (totalSeconds === 0) return { np: 0, iff: 0, tss: 0 };

  let secData: number[] = [];
  for (const b of workout.blocks) {
    for (let i = 0; i < b.durationSeconds; i++) {
      secData.push(b.targetPower);
    }
  }
  
  let rollingSum4 = 0;
  let count = 0;
  for (let i = 29; i < secData.length; i++) {
    let sum30 = 0;
    for (let j = 0; j < 30; j++) {
      sum30 += secData[i - j];
    }
    const avg30 = sum30 / 30;
    rollingSum4 += Math.pow(avg30, 4);
    count++;
  }
  
  const np = count > 0 ? Math.pow(rollingSum4 / count, 0.25) : 0;
  const iff = ftp > 0 ? np / ftp : 0;
  const tss = ftp > 0 ? (totalSeconds * np * iff) / (ftp * 36) : 0;

  return { np, iff, tss };
}

export function saveWorkout(workout: Workout) {
  if (typeof window === "undefined") return;
  const saved = getSavedWorkouts();
  saved.push(workout);
  localStorage.setItem("saved_workouts", JSON.stringify(saved));
}

export function updateWorkout(workout: Workout) {
  if (typeof window === "undefined") return;
  const saved = getSavedWorkouts();
  const index = saved.findIndex((w) => w.id === workout.id);
  if (index !== -1) {
    saved[index] = workout;
    localStorage.setItem("saved_workouts", JSON.stringify(saved));
  }
}

export function getSavedWorkouts(): Workout[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem("saved_workouts");
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

export const WORKOUTS: Workout[] = [
  {
    id: "the-shovel-simulated",
    name: "The Shovel (Simulated)",
    description: "A challenging set of Anaerobic Capacity efforts mimicking your profile screenshot.",
    blocks: [
      // Warmup
      { durationSeconds: 300, targetPower: 110 },
      { durationSeconds: 60, targetPower: 130 },
      { durationSeconds: 60, targetPower: 150 },
      { durationSeconds: 60, targetPower: 172 }, // FTP
      { durationSeconds: 120, targetPower: 120 },
      // Primer
      { durationSeconds: 30, targetPower: 216 }, // MAP
      { durationSeconds: 30, targetPower: 335 }, // AC
      { durationSeconds: 180, targetPower: 110 },
      // Main Intervals
      { durationSeconds: 60, targetPower: 335 }, { durationSeconds: 120, targetPower: 110 },
      { durationSeconds: 60, targetPower: 335 }, { durationSeconds: 120, targetPower: 110 },
      { durationSeconds: 60, targetPower: 335 }, { durationSeconds: 120, targetPower: 110 },
      { durationSeconds: 60, targetPower: 335 }, { durationSeconds: 120, targetPower: 110 },
      { durationSeconds: 60, targetPower: 335 }, { durationSeconds: 120, targetPower: 110 },
      { durationSeconds: 60, targetPower: 335 }, { durationSeconds: 120, targetPower: 110 },
      // Cooldown
      { durationSeconds: 300, targetPower: 100 },
    ]
  },
  {
    id: "sweet-spot-3x10",
    name: "Sweet Spot 3x10",
    description: "Build muscular endurance with 3x 10-minute intervals just below threshold.",
    blocks: [
      { durationSeconds: 300, targetPower: 100 },
      { durationSeconds: 300, targetPower: 130 },
      // Interval 1
      { durationSeconds: 600, targetPower: 160 },
      { durationSeconds: 180, targetPower: 100 },
      // Interval 2
      { durationSeconds: 600, targetPower: 160 },
      { durationSeconds: 180, targetPower: 100 },
      // Interval 3
      { durationSeconds: 600, targetPower: 160 },
      { durationSeconds: 300, targetPower: 100 },
    ]
  }
];