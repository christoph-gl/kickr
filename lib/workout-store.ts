import fs from "fs/promises";
import path from "path";
import { WORKOUTS, type Workout } from "./workouts";

const workoutsDir = path.join(process.cwd(), "workouts");
const deletedWorkoutsFile = path.join(workoutsDir, ".deleted-workouts.json");

async function ensureDir() {
  await fs.mkdir(workoutsDir, { recursive: true });
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

export function safeWorkoutId(id: string) {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return safeId && safeId === id ? safeId : null;
}

export async function readDeletedWorkoutIds() {
  try {
    const content = await fs.readFile(deletedWorkoutsFile, "utf-8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
}

async function writeDeletedWorkoutIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids)).sort();
  await fs.writeFile(deletedWorkoutsFile, JSON.stringify(uniqueIds, null, 2), "utf-8");
}

export async function readSavedWorkouts(): Promise<Workout[]> {
  await ensureDir();
  const files = await fs.readdir(workoutsDir);
  const workouts: Workout[] = [];
  for (const file of files) {
    if (file.startsWith(".") || !file.endsWith(".json")) continue;
    const content = await fs.readFile(path.join(workoutsDir, file), "utf-8");
    try {
      workouts.push(JSON.parse(content));
    } catch (e) {
      console.error(`Failed to parse ${file}:`, e);
    }
  }
  return workouts;
}

/** Built-in workouts (minus deleted ones) followed by saved workouts, as the picker shows them. */
export async function readWorkoutLibrary(): Promise<Workout[]> {
  const [saved, deletedIds] = await Promise.all([readSavedWorkouts(), readDeletedWorkoutIds()]);
  const deleted = new Set(deletedIds);
  return [...WORKOUTS, ...saved].filter((workout) => !deleted.has(workout.id));
}

export async function writeWorkout(workout: Workout) {
  await ensureDir();
  const safeId = safeWorkoutId(workout.id);
  if (!safeId) throw new Error("Invalid workout id");
  await fs.writeFile(path.join(workoutsDir, `${safeId}.json`), JSON.stringify(workout, null, 2), "utf-8");
  const deletedIds = await readDeletedWorkoutIds();
  await writeDeletedWorkoutIds(deletedIds.filter((id) => id !== safeId));
}

export async function removeWorkout(id: string) {
  await ensureDir();
  const safeId = safeWorkoutId(id);
  if (!safeId) throw new Error("Invalid workout id");
  await fs.unlink(path.join(workoutsDir, `${safeId}.json`)).catch((error) => {
    if (errorCode(error) !== "ENOENT") throw error;
  });
  const deletedIds = await readDeletedWorkoutIds();
  await writeDeletedWorkoutIds([...deletedIds, safeId]);
}
