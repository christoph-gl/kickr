import { NextResponse } from "next/server";
import { buildWorkout } from "@/lib/workout-builder";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const instructions = typeof body?.instructions === "string"
      ? body.instructions.trim()
      : "";

    if (!instructions) {
      return NextResponse.json({ error: "Missing workout instructions" }, { status: 400 });
    }

    const result = await buildWorkout(instructions);
    return NextResponse.json({ success: true, ...result, saved: false });
  } catch (error) {
    console.error("Failed to build workout:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
