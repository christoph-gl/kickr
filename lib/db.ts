import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type { AgentCommand, AgentEvent } from "./agent";
import type { BikeSample } from "./kickr-client";
import { DEFAULT_RIDER_PROFILE, type RiderProfile } from "./profile";
import type { RideSession, SessionMetrics } from "./sessions";

type SessionRow = {
  id: string;
  workout_name: string;
  timestamp: number;
  metrics_json: string;
  rider_comments: string | null;
  llm_summary_json: string | null;
  llm_summary_status: string | null;
  llm_summary_error: string | null;
};

type SampleRow = {
  timestamp: number;
  power_w: number | null;
  cadence_rpm: number | null;
  speed_kph: number | null;
  resistance: number | null;
  heart_rate_bpm: number | null;
};

type AgentCommandRow = {
  command_json: string;
};

type AgentEventRow = {
  event_json: string;
};

type MonthlySummaryRow = {
  month: string;
  summary_json: string;
  model: string | null;
  generated_at: number;
};

type RiderProfileRow = {
  nm: number;
  ac: number;
  map: number;
  ftp: number;
  c_thr: number;
  age: number | null;
  weight_kg: number | null;
  gender: string | null;
  hr_zones_json: string;
  colors_json: string;
  memory_summary: string | null;
};

const dbDir = path.join(process.cwd(), ".data");
const dbPath = path.join(dbDir, "kickr.sqlite");

let database: DatabaseSync | null = null;

export function getDb() {
  if (!database) {
    fs.mkdirSync(dbDir, { recursive: true });
    database = new DatabaseSync(dbPath);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE IF NOT EXISTS ride_sessions (
        id TEXT PRIMARY KEY,
        workout_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metrics_json TEXT NOT NULL,
        rider_comments TEXT,
        llm_summary_json TEXT,
        llm_summary_status TEXT,
        llm_summary_error TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS ride_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        power_w REAL,
        cadence_rpm REAL,
        speed_kph REAL,
        resistance REAL,
        heart_rate_bpm REAL,
        FOREIGN KEY (session_id) REFERENCES ride_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS ride_samples_session_timestamp_idx
        ON ride_samples(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS agent_commands (
        id TEXT PRIMARY KEY,
        command_json TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        queued_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        session_id TEXT,
        timestamp INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS agent_events_session_timestamp_idx
        ON agent_events(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS rider_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        nm REAL NOT NULL,
        ac REAL NOT NULL,
        map REAL NOT NULL,
        ftp REAL NOT NULL,
        c_thr REAL NOT NULL,
        age INTEGER,
        weight_kg REAL,
        gender TEXT,
        hr_zones_json TEXT NOT NULL,
        colors_json TEXT NOT NULL,
        memory_summary TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS monthly_summaries (
        month TEXT PRIMARY KEY,
        summary_json TEXT NOT NULL,
        model TEXT,
        generated_at INTEGER NOT NULL
      );
    `);
    migrateRideSessionSummaries();
    seedRiderProfile();
  }

  return database;
}

function migrateRideSessionSummaries() {
  const columns = database
    ?.prepare("PRAGMA table_info(ride_sessions)")
    .all() as { name: string }[] | undefined;
  const names = new Set(columns?.map((column) => column.name) ?? []);

  if (!names.has("rider_comments")) {
    database?.exec("ALTER TABLE ride_sessions ADD COLUMN rider_comments TEXT");
  }
  if (!names.has("llm_summary_json")) {
    database?.exec("ALTER TABLE ride_sessions ADD COLUMN llm_summary_json TEXT");
  }
  if (!names.has("llm_summary_status")) {
    database?.exec("ALTER TABLE ride_sessions ADD COLUMN llm_summary_status TEXT");
  }
  if (!names.has("llm_summary_error")) {
    database?.exec("ALTER TABLE ride_sessions ADD COLUMN llm_summary_error TEXT");
  }
}

function seedRiderProfile() {
  const exists = database
    ?.prepare("SELECT 1 FROM rider_profile WHERE id = 1")
    .get();

  if (!exists) {
    upsertRiderProfile(DEFAULT_RIDER_PROFILE);
  }
}

export function getRiderProfileFromDb(): RiderProfile {
  const row = getDb()
    .prepare(
      `SELECT nm, ac, map, ftp, c_thr, age, weight_kg, gender,
              hr_zones_json, colors_json, memory_summary
       FROM rider_profile
       WHERE id = 1`
    )
    .get() as RiderProfileRow | undefined;

  if (!row) return DEFAULT_RIDER_PROFILE;

  return {
    fourDP: {
      nm: row.nm,
      ac: row.ac,
      map: row.map,
      ftp: row.ftp,
    },
    cTHR: row.c_thr,
    age: row.age,
    weightKg: row.weight_kg,
    gender: row.gender,
    hrZones: JSON.parse(row.hr_zones_json) as RiderProfile["hrZones"],
    colors: JSON.parse(row.colors_json) as RiderProfile["colors"],
    memorySummary: row.memory_summary ?? "",
  };
}

export function upsertRiderProfile(profile: RiderProfile) {
  getDb()
    .prepare(
      `INSERT INTO rider_profile (
        id, nm, ac, map, ftp, c_thr, age, weight_kg, gender,
        hr_zones_json, colors_json, memory_summary, updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        nm = excluded.nm,
        ac = excluded.ac,
        map = excluded.map,
        ftp = excluded.ftp,
        c_thr = excluded.c_thr,
        age = excluded.age,
        weight_kg = excluded.weight_kg,
        gender = excluded.gender,
        hr_zones_json = excluded.hr_zones_json,
        colors_json = excluded.colors_json,
        memory_summary = excluded.memory_summary,
        updated_at = excluded.updated_at`
    )
    .run(
      profile.fourDP.nm,
      profile.fourDP.ac,
      profile.fourDP.map,
      profile.fourDP.ftp,
      profile.cTHR,
      profile.age,
      profile.weightKg,
      profile.gender,
      JSON.stringify(profile.hrZones),
      JSON.stringify(profile.colors),
      profile.memorySummary,
      Date.now()
    );
}

export function insertRideSession(session: RideSession) {
  const db = getDb();
  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO ride_sessions (
      id,
      workout_name,
      timestamp,
      metrics_json,
      rider_comments,
      llm_summary_json,
      llm_summary_status,
      llm_summary_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteSamples = db.prepare("DELETE FROM ride_samples WHERE session_id = ?");
  const insertSample = db.prepare(`
    INSERT INTO ride_samples (
      session_id,
      timestamp,
      power_w,
      cadence_rpm,
      speed_kph,
      resistance,
      heart_rate_bpm
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    insertSession.run(
      session.id,
      session.workoutName,
      session.timestamp,
      JSON.stringify(session.metrics),
      session.riderComments?.trim() || null,
      session.llmSummary ? JSON.stringify(session.llmSummary) : null,
      session.llmSummaryStatus ?? null,
      session.llmSummaryError ?? null
    );
    deleteSamples.run(session.id);

    for (const sample of session.samples) {
      insertSample.run(
        session.id,
        sample.timestamp,
        sample.powerW ?? null,
        sample.cadenceRpm ?? null,
        sample.speedKph ?? null,
        sample.resistance ?? null,
        sample.heartRateBpm ?? null
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listRideSessions(): RideSession[] {
  const db = getDb();
  const sessions = db
    .prepare(
      `SELECT id, workout_name, timestamp, metrics_json, rider_comments,
              llm_summary_json, llm_summary_status, llm_summary_error
       FROM ride_sessions
       ORDER BY timestamp DESC`
    )
    .all() as SessionRow[];

  const sampleStatement = db.prepare(`
    SELECT timestamp, power_w, cadence_rpm, speed_kph, resistance, heart_rate_bpm
    FROM ride_samples
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `);

  return sessions.map((session) => {
    const samples = sampleStatement.all(session.id) as SampleRow[];

    return {
      id: session.id,
      workoutName: session.workout_name,
      timestamp: session.timestamp,
      metrics: JSON.parse(session.metrics_json) as SessionMetrics,
      samples: samples.map(rowToBikeSample),
      riderComments: session.rider_comments ?? undefined,
      llmSummary: session.llm_summary_json
        ? JSON.parse(session.llm_summary_json)
        : undefined,
      llmSummaryStatus:
        session.llm_summary_status === "generated" ||
        session.llm_summary_status === "failed" ||
        session.llm_summary_status === "skipped"
          ? session.llm_summary_status
          : undefined,
      llmSummaryError: session.llm_summary_error ?? undefined,
    };
  });
}

export function deleteRideSessionById(id: string) {
  getDb().prepare("DELETE FROM ride_sessions WHERE id = ?").run(id);
}

export function upsertMonthlySummary(month: string, summary: unknown, model?: string) {
  getDb()
    .prepare(
      `INSERT INTO monthly_summaries (month, summary_json, model, generated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(month) DO UPDATE SET
         summary_json = excluded.summary_json,
         model = excluded.model,
         generated_at = excluded.generated_at`
    )
    .run(month, JSON.stringify(summary), model ?? null, Date.now());
}

export function listMonthlySummaries() {
  const rows = getDb()
    .prepare(
      `SELECT month, summary_json, model, generated_at
       FROM monthly_summaries
       ORDER BY month DESC`
    )
    .all() as MonthlySummaryRow[];

  return rows.map((row) => ({
    month: row.month,
    summary: JSON.parse(row.summary_json),
    model: row.model ?? undefined,
    generatedAt: row.generated_at,
  }));
}

export function insertAgentCommand(command: AgentCommand) {
  if (!command.id) {
    throw new Error("Agent command requires an id before persistence");
  }

  const timestamp = Date.now();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO agent_commands
       (id, command_json, status, message, queued_at, updated_at)
       VALUES (?, ?, 'queued', NULL, ?, ?)`
    )
    .run(command.id, JSON.stringify(command), timestamp, timestamp);
}

export function listQueuedAgentCommands() {
  const rows = getDb()
    .prepare(
      `SELECT command_json
       FROM agent_commands
       WHERE status = 'queued'
       ORDER BY queued_at ASC`
    )
    .all() as AgentCommandRow[];

  return rows.map((row) => JSON.parse(row.command_json) as AgentCommand);
}

export function markAgentCommandsDispatched(commands: AgentCommand[]) {
  const ids = commands.map((command) => command.id).filter(Boolean) as string[];
  if (ids.length === 0) return;

  const db = getDb();
  const statement = db.prepare(`
    UPDATE agent_commands
    SET status = 'dispatched', updated_at = ?
    WHERE id = ? AND status = 'queued'
  `);
  const timestamp = Date.now();

  db.exec("BEGIN");
  try {
    for (const id of ids) {
      statement.run(timestamp, id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateAgentCommandStatus(
  command: AgentCommand,
  status: "applied" | "failed",
  message?: string
) {
  if (!command.id) return;

  getDb()
    .prepare(
      `UPDATE agent_commands
       SET status = ?, message = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(status, message ?? null, Date.now(), command.id);
}

export function insertAgentEvent(event: AgentEvent) {
  getDb()
    .prepare(
      `INSERT INTO agent_events (type, session_id, timestamp, event_json)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      event.type,
      "sessionId" in event ? event.sessionId : null,
      event.timestamp,
      JSON.stringify(event)
    );

  if (event.type === "command_applied") {
    updateAgentCommandStatus(event.command, "applied");
  } else if (event.type === "command_failed") {
    updateAgentCommandStatus(event.command, "failed", event.message);
  }
}

export function listAgentEvents(limit = 200): AgentEvent[] {
  const boundedLimit = Math.min(Math.max(Math.round(limit), 1), 1000);
  const rows = getDb()
    .prepare(
      `SELECT event_json
       FROM agent_events
       ORDER BY timestamp DESC, id DESC
       LIMIT ?`
    )
    .all(boundedLimit) as AgentEventRow[];

  return rows.map((row) => JSON.parse(row.event_json) as AgentEvent);
}

function rowToBikeSample(row: SampleRow): BikeSample {
  return {
    timestamp: row.timestamp,
    powerW: row.power_w ?? undefined,
    cadenceRpm: row.cadence_rpm ?? undefined,
    speedKph: row.speed_kph ?? undefined,
    resistance: row.resistance ?? undefined,
    heartRateBpm: row.heart_rate_bpm ?? undefined,
  };
}
