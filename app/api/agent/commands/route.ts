import { NextResponse } from "next/server";
import type { AgentCommand, AgentCommandRecord } from "@/lib/agent";
import { makeAgentCommandId } from "@/lib/agent";
import {
  insertAgentCommand,
  listQueuedAgentCommands,
  markAgentCommandsDispatched,
} from "@/lib/db";

export const dynamic = "force-dynamic";

const globalForAgentCommands = globalThis as typeof globalThis & {
  __kickrAgentCommandQueue?: AgentCommandRecord[];
  __kickrAgentCommandHistory?: AgentCommandRecord[];
};

function getQueue() {
  globalForAgentCommands.__kickrAgentCommandQueue ??= [];
  return globalForAgentCommands.__kickrAgentCommandQueue;
}

function getHistory() {
  globalForAgentCommands.__kickrAgentCommandHistory ??= [];
  return globalForAgentCommands.__kickrAgentCommandHistory;
}

function isAuthorized(req: Request) {
  const token = process.env.AGENT_COMMAND_TOKEN;
  if (!token) return true;
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;

  const auth = req.headers.get("authorization");
  return auth === `Bearer ${token}`;
}

function normalizeCommand(command: AgentCommand): AgentCommand {
  return {
    ...command,
    id: command.id || makeAgentCommandId(),
  } as AgentCommand;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const consume = url.searchParams.get("consume") !== "false";
  const queue = getQueue();

  if (!consume) {
    const persisted = listQueuedAgentCommands();
    return NextResponse.json({
      commands: [...queue.map((record) => record.command), ...persisted],
    });
  }

  const records = queue.splice(0, queue.length);
  const commands = records.length > 0
    ? records.map((record) => record.command)
    : listQueuedAgentCommands();
  markAgentCommandsDispatched(commands);

  return NextResponse.json({ commands });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const rawCommands: unknown[] = Array.isArray(body.commands) ? body.commands : [body];
    const records: AgentCommandRecord[] = rawCommands.map((rawCommand: unknown) => {
      const command = normalizeCommand(rawCommand as AgentCommand);
      return {
        id: command.id || makeAgentCommandId(),
        command,
        status: "queued",
        timestamp: Date.now(),
      };
    });

    const queue = getQueue();
    const history = getHistory();
    queue.push(...records);
    history.unshift(...records);
    history.splice(100);
    records.forEach((record) => insertAgentCommand(record.command));

    return NextResponse.json({
      success: true,
      queued: records.map((record) => record.command),
    });
  } catch (error) {
    console.error("Failed to queue agent command:", error);
    return NextResponse.json({ error: "Invalid command payload" }, { status: 400 });
  }
}
