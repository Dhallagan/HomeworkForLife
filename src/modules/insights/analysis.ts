import type { EntryListItem } from "../journal/types";

const LOOKBACK_DAYS = 7;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "been",
  "being",
  "came",
  "could",
  "from",
  "have",
  "into",
  "just",
  "know",
  "like",
  "made",
  "more",
  "much",
  "only",
  "really",
  "said",
  "some",
  "that",
  "them",
  "then",
  "there",
  "they",
  "this",
  "today",
  "very",
  "want",
  "went",
  "were",
  "what",
  "when",
  "with",
  "work",
  "would",
  "your",
]);

const LENSES = [
  {
    label: "Business",
    keywords: ["client", "launch", "meeting", "product", "revenue", "sale", "team"],
  },
  {
    label: "Relationships",
    keywords: ["dad", "family", "friend", "kids", "love", "mom", "partner"],
  },
  {
    label: "Health",
    keywords: ["energy", "gym", "health", "sleep", "steps", "tired", "walk"],
  },
];

export type InsightSnapshot = {
  activeEntryCount: number;
  totalEntryCount: number;
  walkCount: number;
  totalWords: number;
  totalSteps: number;
  averageWords: number;
  strongestDay: string | null;
  topTopics: string[];
  focusAreas: string[];
  lead: string;
  questions: string[];
};

export function buildInsightSnapshot(entries: EntryListItem[]): InsightSnapshot {
  const sortedEntries = [...entries].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
  const lookbackStart = new Date();
  lookbackStart.setHours(0, 0, 0, 0);
  lookbackStart.setDate(lookbackStart.getDate() - (LOOKBACK_DAYS - 1));

  const windowEntries =
    sortedEntries.filter((entry) => entry.createdAt >= lookbackStart) ||
    sortedEntries.slice(0, LOOKBACK_DAYS);
  const activeEntries = windowEntries.length > 0 ? windowEntries : sortedEntries.slice(0, 7);
  const wordCounts = activeEntries.map((entry) => countWords(entry.body));
  const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
  const walkCount = activeEntries.filter((entry) => entry.source === "walk").length;
  const totalSteps = activeEntries.reduce(
    (sum, entry) => sum + (entry.stepCount ?? 0),
    0,
  );
  const strongestDay = getStrongestDay(activeEntries);
  const topTopics = getTopTopics(activeEntries);
  const focusAreas = getFocusAreas(activeEntries);

  return {
    activeEntryCount: activeEntries.length,
    totalEntryCount: sortedEntries.length,
    walkCount,
    totalWords,
    totalSteps,
    averageWords: activeEntries.length > 0 ? Math.round(totalWords / activeEntries.length) : 0,
    strongestDay,
    topTopics,
    focusAreas,
    lead: buildLead(activeEntries.length, walkCount, topTopics, focusAreas),
    questions: buildQuestions(topTopics, focusAreas, strongestDay),
  };
}

function countWords(body: string) {
  return tokenize(body).length;
}

function tokenize(body: string) {
  return body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

function getTopTopics(entries: EntryListItem[]) {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    for (const word of tokenize(entry.body)) {
      if (STOP_WORDS.has(word) || /^\d+$/.test(word)) {
        continue;
      }

      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([word]) => word);
}

function getFocusAreas(entries: EntryListItem[]) {
  const tokens = entries.flatMap((entry) => tokenize(entry.body));

  return LENSES.map((lens) => ({
    label: lens.label,
    hits: lens.keywords.reduce(
      (sum, keyword) => sum + tokens.filter((token) => token === keyword).length,
      0,
    ),
  }))
    .filter((lens) => lens.hits > 0)
    .sort((left, right) => right.hits - left.hits)
    .slice(0, 2)
    .map((lens) => `${lens.label} (${lens.hits})`);
}

function getStrongestDay(entries: EntryListItem[]) {
  if (entries.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();

  for (const entry of entries) {
    const label = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(
      entry.createdAt,
    );
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const [bestDay] =
    [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];

  return bestDay ?? null;
}

function buildLead(
  activeEntryCount: number,
  walkCount: number,
  topTopics: string[],
  focusAreas: string[],
) {
  if (activeEntryCount === 0) {
    return "No signal yet. Once you have a few entries, this side can start reflecting patterns back.";
  }

  const parts = [`${activeEntryCount} recent entries`];

  if (walkCount > 0) {
    parts.push(`${walkCount} voice walks`);
  }

  if (topTopics.length > 0) {
    parts.push(`recurring topics: ${topTopics.join(", ")}`);
  }

  if (focusAreas.length > 0) {
    parts.push(`strongest lens: ${focusAreas[0]}`);
  }

  return parts.join(" | ");
}

function buildQuestions(
  topTopics: string[],
  focusAreas: string[],
  strongestDay: string | null,
) {
  const questions = [];

  if (topTopics[0]) {
    questions.push(`When ${topTopics[0]} comes up, is it energizing you or draining you?`);
  }

  if (focusAreas[0]) {
    const lensLabel = focusAreas[0].split(" ")[0].toLowerCase();
    questions.push(`Is ${lensLabel} taking more space than you want this week?`);
  }

  if (strongestDay) {
    questions.push(`Why does ${strongestDay} tend to carry the most journal activity?`);
  }

  return questions.slice(0, 3);
}

export function selectEntriesForQuestion(
  entries: EntryListItem[],
  question: string,
  limit = 6,
) {
  const queryTokens = new Set(
    tokenize(question).filter((token) => !STOP_WORDS.has(token)),
  );

  return [...entries]
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, queryTokens),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.entry.createdAt.getTime() - left.entry.createdAt.getTime();
    })
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function scoreEntry(entry: EntryListItem, queryTokens: Set<string>) {
  const entryTokens = tokenize(entry.body);
  const uniqueTokens = new Set(entryTokens);
  let overlap = 0;

  for (const token of queryTokens) {
    if (uniqueTokens.has(token)) {
      overlap += 1;
    }
  }

  const recencyBoost = Math.max(0, 14 - daysSince(entry.createdAt)) * 0.12;
  const bodyBoost = Math.min(3, entryTokens.length / 80);

  return overlap * 3 + recencyBoost + bodyBoost;
}

function daysSince(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}
