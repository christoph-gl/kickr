import { NextResponse } from "next/server";
import type { RiderProfile } from "@/lib/profile";
import { getRiderProfileFromDb, upsertRiderProfile } from "@/lib/db";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  const token = process.env.AGENT_COMMAND_TOKEN;
  if (!token) return true;
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;

  const auth = req.headers.get("authorization");
  return auth === `Bearer ${token}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(getRiderProfileFromDb());
  } catch (error) {
    console.error("Failed to load rider profile:", error);
    return NextResponse.json({ error: "Failed to load rider profile" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const profile = (await req.json()) as RiderProfile;
    if (!profile?.fourDP?.ftp || !Array.isArray(profile.hrZones)) {
      return NextResponse.json({ error: "Invalid rider profile" }, { status: 400 });
    }

    upsertRiderProfile(profile);
    return NextResponse.json({ success: true, profile: getRiderProfileFromDb() });
  } catch (error) {
    console.error("Failed to save rider profile:", error);
    return NextResponse.json({ error: "Failed to save rider profile" }, { status: 500 });
  }
}
