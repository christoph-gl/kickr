import { NextResponse } from 'next/server';
import {
  readDeletedWorkoutIds,
  readSavedWorkouts,
  removeWorkout,
  safeWorkoutId,
  writeWorkout,
} from '@/lib/workout-store';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workouts = await readSavedWorkouts();
    if (url.searchParams.get('includeDeleted') === 'true') {
      return NextResponse.json({
        workouts,
        deletedWorkoutIds: await readDeletedWorkoutIds(),
      });
    }
    return NextResponse.json(workouts);
  } catch (error) {
    console.error("Failed to read workouts directory:", error);
    return NextResponse.json({ error: 'Failed to load workouts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const workout = await request.json();
    if (!workout || !workout.id) {
      return NextResponse.json({ error: 'Invalid workout data' }, { status: 400 });
    }
    if (!safeWorkoutId(workout.id)) {
      return NextResponse.json({ error: 'Invalid workout id' }, { status: 400 });
    }

    await writeWorkout(workout);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save workout:", error);
    return NextResponse.json({ error: 'Failed to save workout' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing workout id' }, { status: 400 });
    }
    if (!safeWorkoutId(id)) {
      return NextResponse.json({ error: 'Invalid workout id' }, { status: 400 });
    }

    await removeWorkout(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete workout:", error);
    return NextResponse.json({ error: 'Failed to delete workout' }, { status: 500 });
  }
}
