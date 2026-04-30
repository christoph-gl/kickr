import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const workoutsDir = path.join(process.cwd(), 'workouts');

async function ensureDir() {
  try {
    await fs.access(workoutsDir);
  } catch {
    await fs.mkdir(workoutsDir, { recursive: true });
  }
}

export async function GET() {
  await ensureDir();
  try {
    const files = await fs.readdir(workoutsDir);
    const workouts = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(workoutsDir, file), 'utf-8');
        try {
          workouts.push(JSON.parse(content));
        } catch (e) {
          console.error(`Failed to parse ${file}:`, e);
        }
      }
    }
    return NextResponse.json(workouts);
  } catch (error) {
    console.error("Failed to read workouts directory:", error);
    return NextResponse.json({ error: 'Failed to load workouts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  await ensureDir();
  try {
    const workout = await request.json();
    if (!workout || !workout.id) {
      return NextResponse.json({ error: 'Invalid workout data' }, { status: 400 });
    }
    
    // Sanitize filename to prevent directory traversal
    const safeId = workout.id.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(workoutsDir, `${safeId}.json`);
    
    await fs.writeFile(filePath, JSON.stringify(workout, null, 2), 'utf-8');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save workout:", error);
    return NextResponse.json({ error: 'Failed to save workout' }, { status: 500 });
  }
}
