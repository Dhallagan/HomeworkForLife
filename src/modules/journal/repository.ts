import type { SQLiteDatabase } from "expo-sqlite";

import { formatDayKey, formatEntryTitle } from "../../lib/date";
import type {
  DailySteps,
  ExtractedPerson,
  JournalExportData,
  DailySummary,
  EntryDetail,
  EntryListItem,
  JournalEntry,
  Person,
  PersonListItem,
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

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      aliases TEXT DEFAULT '[]',
      emoji TEXT,
      summary TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS people_entries (
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      PRIMARY KEY (person_id, entry_id)
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

  if (!journalColumns.some((column) => column.name === "people_extracted_at")) {
    await db.execAsync(`
      ALTER TABLE journal_entries
      ADD COLUMN people_extracted_at TEXT;
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

export async function getAdjacentEntryIds(
  db: SQLiteDatabase,
  currentId: string,
): Promise<{ prevId: string | null; nextId: string | null }> {
  const currentEntry = await db.getFirstAsync<{ created_at: string }>(
    `SELECT created_at FROM journal_entries WHERE id = ?`,
    currentId,
  );

  if (!currentEntry) {
    return { prevId: null, nextId: null };
  }

  const prev = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM journal_entries
     WHERE created_at < ? OR (created_at = ? AND id < ?)
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    currentEntry.created_at,
    currentEntry.created_at,
    currentId,
  );

  const next = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM journal_entries
     WHERE created_at > ? OR (created_at = ? AND id > ?)
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    currentEntry.created_at,
    currentEntry.created_at,
    currentId,
  );

  return {
    prevId: next?.id ?? null,
    nextId: prev?.id ?? null,
  };
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

// ── People CRUD ──────────────────────────────────────────────

export async function listPeople(db: SQLiteDatabase): Promise<PersonListItem[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    aliases: string;
    emoji: string | null;
    summary: string | null;
    first_seen_at: string;
    last_seen_at: string;
    created_at: string;
    updated_at: string;
    entry_count: number;
  }>(`
    SELECT p.*, COUNT(pe.entry_id) as entry_count
    FROM people p
    LEFT JOIN people_entries pe ON p.id = pe.person_id
    GROUP BY p.id
    ORDER BY entry_count DESC, p.last_seen_at DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: JSON.parse(row.aliases || "[]"),
    emoji: row.emoji ?? undefined,
    summary: row.summary ?? undefined,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entryCount: row.entry_count,
  }));
}

export async function getPersonById(
  db: SQLiteDatabase,
  id: string,
): Promise<PersonListItem | null> {
  const row = await db.getFirstAsync<{
    id: string;
    name: string;
    aliases: string;
    emoji: string | null;
    summary: string | null;
    first_seen_at: string;
    last_seen_at: string;
    created_at: string;
    updated_at: string;
  }>(`SELECT * FROM people WHERE id = ? LIMIT 1`, id);

  if (!row) return null;

  const countRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM people_entries WHERE person_id = ?`,
    id,
  );

  return {
    id: row.id,
    name: row.name,
    aliases: JSON.parse(row.aliases || "[]"),
    emoji: row.emoji ?? undefined,
    summary: row.summary ?? undefined,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entryCount: countRow?.c ?? 0,
  };
}

export async function getEntriesForPerson(
  db: SQLiteDatabase,
  personId: string,
): Promise<EntryListItem[]> {
  const rows = await db.getAllAsync<EntryRow>(
    `
    SELECT
      je.id, je.created_at, je.source, je.title, je.title_emoji,
      je.body, je.session_id,
      ws.started_at, ws.ended_at, ws.duration_sec, ws.step_count
    FROM people_entries pe
    JOIN journal_entries je ON je.id = pe.entry_id
    LEFT JOIN walk_sessions ws ON ws.entry_id = je.id
    WHERE pe.person_id = ?
    ORDER BY je.created_at DESC
    `,
    personId,
  );

  return rows.map(mapEntryRow);
}

export async function getExistingPeopleContext(
  db: SQLiteDatabase,
): Promise<{ id: string; name: string; aliases: string[] }[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    aliases: string;
  }>(`
    SELECT p.id, p.name, p.aliases
    FROM people p
    LEFT JOIN people_entries pe ON p.id = pe.person_id
    GROUP BY p.id
    ORDER BY COUNT(pe.entry_id) DESC
    LIMIT 50
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: JSON.parse(row.aliases || "[]"),
  }));
}

export async function linkPeopleToEntry(
  db: SQLiteDatabase,
  entryId: string,
  extractedPeople: ExtractedPerson[],
): Promise<void> {
  if (extractedPeople.length === 0) return;

  const now = new Date().toISOString();
  const entryRow = await db.getFirstAsync<{ created_at: string }>(
    `SELECT created_at FROM journal_entries WHERE id = ?`,
    entryId,
  );
  const entryDate = entryRow?.created_at ?? now;

  await db.withTransactionAsync(async () => {
    for (const person of extractedPeople) {
      let personId = person.existingPersonId;

      if (personId) {
        const exists = await db.getFirstAsync<{ id: string }>(
          `SELECT id FROM people WHERE id = ?`,
          personId,
        );
        if (!exists) personId = null;
      }

      if (!personId) {
        personId = createId("person");
        await db.runAsync(
          `INSERT INTO people (id, name, aliases, emoji, summary, first_seen_at, last_seen_at, created_at, updated_at)
           VALUES (?, ?, '[]', NULL, NULL, ?, ?, ?, ?)`,
          personId,
          person.name,
          entryDate,
          entryDate,
          now,
          now,
        );
      } else {
        await db.runAsync(
          `UPDATE people SET last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?`,
          entryDate,
          now,
          personId,
        );
      }

      await db.runAsync(
        `INSERT OR IGNORE INTO people_entries (person_id, entry_id) VALUES (?, ?)`,
        personId,
        entryId,
      );
    }

    await db.runAsync(
      `UPDATE journal_entries SET people_extracted_at = ? WHERE id = ?`,
      now,
      entryId,
    );
  });
}

export async function getEntriesNeedingPeopleExtraction(
  db: SQLiteDatabase,
): Promise<EntryListItem[]> {
  const rows = await db.getAllAsync<EntryRow>(`
    SELECT
      je.id, je.created_at, je.source, je.title, je.title_emoji,
      je.body, je.session_id,
      ws.started_at, ws.ended_at, ws.duration_sec, ws.step_count
    FROM journal_entries je
    LEFT JOIN walk_sessions ws ON ws.entry_id = je.id
    WHERE je.people_extracted_at IS NULL
      AND length(trim(je.body)) > 0
    ORDER BY je.created_at ASC
  `);

  return rows.map(mapEntryRow);
}

export async function updatePerson(
  db: SQLiteDatabase,
  id: string,
  updates: { name?: string; emoji?: string; summary?: string; aliases?: string[] },
): Promise<void> {
  const sets: string[] = [];
  const values: (string | null)[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.emoji !== undefined) {
    sets.push("emoji = ?");
    values.push(updates.emoji || null);
  }
  if (updates.summary !== undefined) {
    sets.push("summary = ?");
    values.push(updates.summary || null);
  }
  if (updates.aliases !== undefined) {
    sets.push("aliases = ?");
    values.push(JSON.stringify(updates.aliases));
  }

  if (sets.length === 0) return;

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  await db.runAsync(
    `UPDATE people SET ${sets.join(", ")} WHERE id = ?`,
    ...values,
  );
}

export async function mergePeople(
  db: SQLiteDatabase,
  sourceId: string,
  targetId: string,
): Promise<void> {
  if (sourceId === targetId) return;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE OR IGNORE people_entries SET person_id = ? WHERE person_id = ?`,
      targetId,
      sourceId,
    );

    await db.runAsync(
      `DELETE FROM people_entries WHERE person_id = ?`,
      sourceId,
    );

    const source = await db.getFirstAsync<{ name: string; aliases: string }>(
      `SELECT name, aliases FROM people WHERE id = ?`,
      sourceId,
    );
    if (source) {
      const target = await db.getFirstAsync<{ aliases: string }>(
        `SELECT aliases FROM people WHERE id = ?`,
        targetId,
      );
      const existingAliases: string[] = JSON.parse(target?.aliases || "[]");
      const sourceAliases: string[] = JSON.parse(source.aliases || "[]");
      const merged = [...new Set([...existingAliases, source.name, ...sourceAliases])];
      await db.runAsync(
        `UPDATE people SET aliases = ? WHERE id = ?`,
        JSON.stringify(merged),
        targetId,
      );
    }

    const dates = await db.getFirstAsync<{ min_date: string; max_date: string }>(
      `SELECT
         MIN(je.created_at) as min_date,
         MAX(je.created_at) as max_date
       FROM people_entries pe
       JOIN journal_entries je ON je.id = pe.entry_id
       WHERE pe.person_id = ?`,
      targetId,
    );

    if (dates) {
      await db.runAsync(
        `UPDATE people SET first_seen_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?`,
        dates.min_date,
        dates.max_date,
        new Date().toISOString(),
        targetId,
      );
    }

    await db.runAsync(`DELETE FROM people WHERE id = ?`, sourceId);
  });
}

export async function deletePerson(
  db: SQLiteDatabase,
  id: string,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM people_entries WHERE person_id = ?`, id);
    await db.runAsync(`DELETE FROM people WHERE id = ?`, id);
  });
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
