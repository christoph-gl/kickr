import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const xaiApiKey =
  process.env.XAI_API_KEY ||
  process.env.GROK_TTS_API_KEY ||
  process.env.VOICE_CREATION_API_KEY;
const xaiTtsVoiceId = process.env.GROK_TTS_VOICE_ID || "sal";
const xaiTtsTimeoutMs = Math.min(
  30_000,
  Math.max(2_000, Number(process.env.GROK_TTS_TIMEOUT_MS || 20_000))
);

function sanitizeForSpeech(text: string) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

export async function POST(request: Request) {
  if (!xaiApiKey) {
    return NextResponse.json(
      { error: "No Grok TTS API key configured. Set XAI_API_KEY or GROK_TTS_API_KEY." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = sanitizeForSpeech(typeof body?.text === "string" ? body.text : "");

  if (!text) {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }

  const response = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: `<loud>${text}</loud>`,
      voice_id: xaiTtsVoiceId,
      output_format: { codec: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "en",
    }),
    signal: AbortSignal.timeout(xaiTtsTimeoutMs),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Grok TTS error ${response.status}: ${await response.text()}` },
      { status: 502 }
    );
  }

  const audio = await response.arrayBuffer();

  return new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
