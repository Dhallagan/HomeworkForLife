import type { SQLiteDatabase } from "expo-sqlite";

import { formatDayKey, formatEntryTitle } from "../../lib/date";
import type {
  DailySteps,
  JournalExportData,
  DailySummary,
  EntryDetail,
  EntryListItem,
  JournalEntry,
  WalkSession,
} from "./types";

type EntryRow = {
  id: string;
  created_at: string;
  source: "walk" | "manual";
  title: string;
  title_emoji: string | null;
  body: string;
  session_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  step_count: number | null;
};

function createId(prefix: string) {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function initializeDatabase(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      title_emoji TEXT,
      body TEXT NOT NULL,
      session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS walk_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      step_count INTEGER NOT NULL,
      entry_id TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS daily_steps (
      date TEXT PRIMARY KEY NOT NULL,
      total_steps INTEGER NOT NULL
    );
  `);

  const journalColumns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(journal_entries)",
  );

  if (!journalColumns.some((column) => column.name === "title_emoji")) {
    await db.execAsync(`
      ALTER TABLE journal_entries
      ADD COLUMN title_emoji TEXT;
    `);
  }
}

export async function listEntries(db: SQLiteDatabase): Promise<EntryListItem[]> {
  const rows = await db.getAllAsync<EntryRow>(`
    SELECT
      journal_entries.id,
      journal_entries.created_at,
      journal_entries.source,
      journal_entries.title,
      journal_entries.title_emoji,
      journal_entries.body,
      journal_entries.session_id,
      walk_sessions.started_at,
      walk_sessions.ended_at,
      walk_sessions.duration_sec,
      walk_sessions.step_count
    FROM journal_entries
    LEFT JOIN walk_sessions
      ON walk_sessions.entry_id = journal_entries.id
    ORDER BY journal_entries.created_at DESC
  `);

  return rows.map(mapEntryRow);
}

export async function getEntryById(
  db: SQLiteDatabase,
  id: string,
): Promise<EntryDetail | null> {
  const row = await db.getFirstAsync<EntryRow>(
    `
      SELECT
        journal_entries.id,
        journal_entries.created_at,
        journal_entries.source,
        journal_entries.title,
        journal_entries.title_emoji,
        journal_entries.body,
        journal_entries.session_id,
        walk_sessions.started_at,
        walk_sessions.ended_at,
        walk_sessions.duration_sec,
        walk_sessions.step_count
      FROM journal_entries
      LEFT JOIN walk_sessions
        ON walk_sessions.entry_id = journal_entries.id
      WHERE journal_entries.id = ?
      LIMIT 1
    `,
    id,
  );

  return row ? mapEntryRow(row) : null;
}

export async function createManualEntry(db: SQLiteDatabase) {
  const now = new Date();
  const entry: JournalEntry = {
    id: createId("manual"),
    createdAt: now,
    source: "manual",
    title: formatEntryTitle(now),
    body: "",
  };

  await db.runAsync(
    `
      INSERT INTO journal_entries (
        id,
        created_at,
        source,
        title,
        title_emoji,
        body,
        session_id
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `,
    entry.id,
    entry.createdAt.toISOString(),
    entry.source,
    entry.title,
    null,
    entry.body,
  );

  return entry;
}

export async function createWalkEntry(
  db: SQLiteDatabase,
  input: {
    body: string;
    startedAt: Date;
    endedAt: Date;
    durationSec: number;
    stepCount: number;
  },
) {
  const entryId = createId("entry");
  const sessionId = createId("session");
  const createdAt = input.endedAt;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        INSERT INTO journal_entries (
          id,
          created_at,
          source,
          title,
          title_emoji,
          body,
          session_id
        )
        VALUES (?, ?, 'walk', ?, ?, ?, ?)
      `,
      entryId,
      createdAt.toISOString(),
      formatEntryTitle(createdAt),
      null,
      input.body.trim(),
      sessionId,
    );

    await db.runAsync(
      `
        INSERT INTO walk_sessions (id, started_at, ended_at, duration_sec, step_count, entry_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      sessionId,
      input.startedAt.toISOString(),
      input.endedAt.toISOString(),
      input.durationSec,
      input.stepCount,
      entryId,
    );
  });

  return getEntryById(db, entryId);
}

export async function updateEntry(
  db: SQLiteDatabase,
  id: string,
  updates: Pick<JournalEntry, "title" | "titleEmoji" | "body">,
) {
  await db.runAsync(
    `
      UPDATE journal_entries
      SET title = ?, title_emoji = ?, body = ?
      WHERE id = ?
    `,
    updates.title.trim() || formatEntryTitle(new Date()),
    updates.titleEmoji?.trim() || null,
    updates.body,
    id,
  );
}

export async function deleteEntry(db: SQLiteDatabase, id: string) {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        DELETE FROM walk_sessions
        WHERE entry_id = ?
      `,
      id,
    );

    await db.runAsync(
      `
        DELETE FROM journal_entries
        WHERE id = ?
      `,
      id,
    );
  });
}

export async function upsertDailySteps(
  db: SQLiteDatabase,
  dailySteps: DailySteps,
) {
  await db.runAsync(
    `
      INSERT INTO daily_steps (date, total_steps)
      VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET total_steps = excluded.total_steps
    `,
    dailySteps.date,
    dailySteps.totalSteps,
  );
}

export async function getDailySteps(
  db: SQLiteDatabase,
  date = formatDayKey(new Date()),
): Promise<DailySteps | null> {
  const row = await db.getFirstAsync<{ date: string; total_steps: number }>(
    `
      SELECT date, total_steps
      FROM daily_steps
      WHERE date = ?
      LIMIT 1
    `,
    date,
  );

  if (!row) {
    return null;
  }

  return {
    date: row.date,
    totalSteps: row.total_steps,
  };
}

export async function listDailySummaries(db: SQLiteDatabase): Promise<DailySummary[]> {
  const [entries, dailyStepsRows] = await Promise.all([
    listEntries(db),
    db.getAllAsync<{ date: string; total_steps: number }>(`
      SELECT date, total_steps
      FROM daily_steps
      ORDER BY date DESC
    `),
  ]);

  const dailyStepsByDate = new Map(
    dailyStepsRows.map((row) => [row.date, row.total_steps]),
  );
  const summaries = new Map<string, DailySummary>();

  for (const entry of entries) {
    const dayKey = formatDayKey(entry.createdAt);
    const existing = summaries.get(dayKey);
    const wordCount = countWords(entry.body);
    const walkSteps = entry.stepCount ?? 0;
    const preview = entry.body.trim() || null;

    if (existing) {
      existing.entryCount += 1;
      existing.totalWords += wordCount;
      existing.walkCount += entry.source === "walk" ? 1 : 0;
      existing.walkSteps += walkSteps;

      if (!existing.latestEntryPreview && preview) {
        existing.latestEntryPreview = preview;
      }

      continue;
    }

    summaries.set(dayKey, {
      date: dayKey,
      entryCount: 1,
      walkCount: entry.source === "walk" ? 1 : 0,
      totalWords: wordCount,
      walkSteps,
      totalSteps: dailyStepsByDate.get(dayKey) ?? null,
      latestEntryPreview: preview,
    });
  }

  for (const [date, totalSteps] of dailyStepsByDate.entries()) {
    if (summaries.has(date)) {
      continue;
    }

    summaries.set(date, {
      date,
      entryCount: 0,
      walkCount: 0,
      totalWords: 0,
      walkSteps: 0,
      totalSteps,
      latestEntryPreview: null,
    });
  }

  return [...summaries.values()].sort((left, right) => right.date.localeCompare(left.date));
}

export async function listEntriesForDay(
  db: SQLiteDatabase,
  date: string,
): Promise<EntryListItem[]> {
  const entries = await listEntries(db);
  return entries.filter((entry) => formatDayKey(entry.createdAt) === date);
}

export async function buildJournalExport(
  db: SQLiteDatabase,
): Promise<JournalExportData> {
  const [entries, dailyStepsRows] = await Promise.all([
    listEntries(db),
    db.getAllAsync<{ date: string; total_steps: number }>(`
      SELECT date, total_steps
      FROM daily_steps
      ORDER BY date DESC
    `),
  ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt.toISOString(),
      source: entry.source,
      title: entry.title,
      titleEmoji: entry.titleEmoji,
      body: entry.body,
      sessionId: entry.sessionId,
      startedAt: entry.startedAt?.toISOString(),
      endedAt: entry.endedAt?.toISOString(),
      durationSec: entry.durationSec,
      stepCount: entry.stepCount,
    })),
    dailySteps: dailyStepsRows.map((row) => ({
      date: row.date,
      totalSteps: row.total_steps,
    })),
  };
}

function countWords(body: string) {
  return body
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function mapEntryRow(row: EntryRow): EntryDetail {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    source: row.source,
    title: row.title,
    titleEmoji: row.title_emoji ?? undefined,
    body: row.body,
    sessionId: row.session_id ?? undefined,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
    durationSec: row.duration_sec ?? undefined,
    stepCount: row.step_count ?? undefined,
  };
}
