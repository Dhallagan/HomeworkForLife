export type JournalEntry = {
  id: string;
  createdAt: Date;
  source: "walk" | "manual";
  title: string;
  titleEmoji?: string;
  body: string;
  sessionId?: string;
};

export type WalkSession = {
  id: string;
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
  stepCount: number;
  entryId: string;
};

export type DailySteps = {
  date: string;
  totalSteps: number;
};

export type EntryListItem = JournalEntry & {
  startedAt?: Date;
  endedAt?: Date;
  durationSec?: number;
  stepCount?: number;
};

export type EntryDetail = EntryListItem;

export type DailySummary = {
  date: string;
  entryCount: number;
  walkCount: number;
  totalWords: number;
  walkSteps: number;
  totalSteps: number | null;
  latestEntryPreview: string | null;
};

export type Person = {
  id: string;
  name: string;
  aliases: string[];
  emoji?: string;
  summary?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonListItem = Person & {
  entryCount: number;
};

export type ExtractedPerson = {
  name: string;
  existingPersonId: string | null;
};

export type JournalExportEntry = {
  id: string;
  createdAt: string;
  source: "walk" | "manual";
  title: string;
  titleEmoji?: string;
  body: string;
  sessionId?: string;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  stepCount?: number;
};

export type JournalExportData = {
  version: 1;
  exportedAt: string;
  entries: JournalExportEntry[];
  dailySteps: DailySteps[];
};
