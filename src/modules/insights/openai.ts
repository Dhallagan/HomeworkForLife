import { formatCompactDate, formatDuration } from "../../lib/date";
import type { EntryListItem } from "../journal/types";
import {
  buildInsightSnapshot,
  filterEntriesForTimeframe,
  type InsightTimeframe,
  type InsightSnapshot,
} from "./analysis";
import { buildInsightAnswerChain } from "./chain";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_INSIGHTS_MODEL = "gpt-5-mini";
const MAX_CONTEXT_ENTRIES = 8;
const reflectionCache = new Map<string, string>();
const reflectionInFlight = new Map<string, Promise<string>>();
const dailyHomeCardsCache = new Map<string, DailyHomeCards>();
const dailyHomeCardsInFlight = new Map<string, Promise<DailyHomeCards>>();

type InsightChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type OpenAIResponsesResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export type DailyHomeCards = {
  thinkingAbout: string;
  whatSeemsTrue: string;
  closeTheDay: string | null;
};

export async function generateReflection(
  entries: EntryListItem[],
  timeframe: InsightTimeframe,
) {
  const { apiKey, model } = getInsightsConfig();
  const { cacheKey, contextEntries, snapshot } = getReflectionRequestContext(
    entries,
    timeframe,
    model,
  );

  const cachedReflection = reflectionCache.get(cacheKey);

  if (cachedReflection) {
    return cachedReflection;
  }

  const inFlightReflection = reflectionInFlight.get(cacheKey);

  if (inFlightReflection) {
    return inFlightReflection;
  }

  const prompt = [
    "Write a concise reflection blurb for the user's journal app.",
    "Ground every statement in the provided entries.",
    "Keep it to 3 short paragraphs max.",
    "Focus on recurring themes, energy, tension, and what seems to matter most right now.",
    `The requested time window is ${formatTimeframeLabel(timeframe)}.`,
    "Do not mention missing data, prompt design, or that you are an AI.",
    "",
    buildSnapshotContext(snapshot),
    "",
    "Recent entries:",
    buildEntryContext(contextEntries),
  ].join("\n");

  const reflectionPromise = createInsightsResponse({
    apiKey,
    model,
    instructions:
      "You are the reflection layer for a personal journaling app. Be specific, observant, and emotionally intelligent. Never invent events. If evidence is weak, use cautious language.",
    input: prompt,
  })
    .then((reflection) => {
      reflectionCache.set(cacheKey, reflection);
      reflectionInFlight.delete(cacheKey);
      return reflection;
    })
    .catch((error) => {
      reflectionInFlight.delete(cacheKey);
      throw error;
    });

  reflectionInFlight.set(cacheKey, reflectionPromise);

  return reflectionPromise;
}

export function peekCachedReflection(
  entries: EntryListItem[],
  timeframe: InsightTimeframe,
) {
  if (!hasInsightsConfig()) {
    return null;
  }

  const { model } = getInsightsConfig();
  const { cacheKey } = getReflectionRequestContext(entries, timeframe, model);
  return reflectionCache.get(cacheKey) ?? null;
}

export async function answerInsightQuestion(
  entries: EntryListItem[],
  messages: InsightChatMessage[],
  question: string,
  timeframe: InsightTimeframe,
) {
  const { apiKey, model } = getInsightsConfig();
  const answerChain = buildInsightAnswerChain(entries, messages, question, timeframe);

  return createInsightsResponse({
    apiKey,
    model,
    instructions: answerChain.instructions,
    input: answerChain.prompt,
  });
}

export async function generateDailyHomeCards(entries: EntryListItem[]) {
  const { apiKey, model } = getInsightsConfig();
  const contextEntries = [...entries]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, MAX_CONTEXT_ENTRIES);
  const cacheKey = buildDailyHomeCardsCacheKey(model, contextEntries);

  const cachedCards = dailyHomeCardsCache.get(cacheKey);

  if (cachedCards) {
    return cachedCards;
  }

  const inFlightCards = dailyHomeCardsInFlight.get(cacheKey);

  if (inFlightCards) {
    return inFlightCards;
  }

  const prompt = [
    "Summarize the user's journal entries for today.",
    "Return JSON only.",
    'Use this shape: {"thinkingAbout":"", "whatSeemsTrue":"", "closeTheDay":""}.',
    "Rules:",
    "- Ground every statement in the provided entries.",
    "- Treat all entries as one day-level set, not separate moments.",
    "- thinkingAbout must answer: what were you thinking about today?",
    "- thinkingAbout must be one short sentence, 8 to 18 words.",
    "- whatSeemsTrue must answer: what seems to be going on beneath the day?",
    "- whatSeemsTrue must be one short sentence, 8 to 18 words.",
    "- closeTheDay may offer one grounded suggestion to remedy, follow through, or close something out.",
    "- closeTheDay must be concrete, gentle, and specific if present.",
    "- Never return generic filler like 'keep going', 'stay on track', or 'keep pushing'.",
    "- If there is no clear grounded suggestion, return an empty string for closeTheDay.",
    "- Do not invent actions, advice, recommendations, or emotional interpretation not supported by the entries.",
    "",
    "Today's entries:",
    buildEntryContext(contextEntries),
  ].join("\n");

  const cardsPromise = createInsightsResponse({
    apiKey,
    model,
    instructions:
      "You extract grounded day-level home summaries for a personal journal app. Be concise, observant, and emotionally intelligent without inventing. Output valid JSON only.",
    input: prompt,
  })
    .then((responseText) => {
      const parsed = parseDailyHomeCards(responseText);
      dailyHomeCardsCache.set(cacheKey, parsed);
      dailyHomeCardsInFlight.delete(cacheKey);
      return parsed;
    })
    .catch((error) => {
      dailyHomeCardsInFlight.delete(cacheKey);
      throw error;
    });

  dailyHomeCardsInFlight.set(cacheKey, cardsPromise);

  return cardsPromise;
}

export async function generateEntryTitle(entry: EntryListItem) {
  const { apiKey, model } = getInsightsConfig();
  const prompt = [
    "Create a title package for a single journal entry.",
    "Return JSON only.",
    'Use this shape: {"title":"","emoji":""}.',
    "Rules:",
    "- title must be 2 to 10 words.",
    "- title must be specific and grounded in the entry.",
    "- title must not include emoji or quotes.",
    "- emoji must be exactly one leading emoji that fits the day's main theme.",
    "- Prefer concrete subject matter over abstract self-help phrasing.",
    "- If a place or travel location clearly anchors the entry, it is good to include that in the title.",
    "- If the entry naturally supports a pattern like location + theme, use it.",
    "- Good examples: Nicaragua Sunday Chill, TPA to LGA, Dentist Day, CRM Drama.",
    "- Avoid vague titles like Reflections, Busy Day, Mixed Emotions, or Another Day.",
    "",
    "Entry details:",
    buildEntryContext([entry]),
  ].join("\n");

  const response = await createInsightsResponse({
    apiKey,
    model,
    instructions:
      "You write concise, grounded journal titles and choose a single fitting emoji. Be specific, natural, and avoid generic phrasing. Output valid JSON only.",
    input: prompt,
  });

  return parseEntryTitlePackage(response);
}

function parseEntryTitlePackage(responseText: string) {
  let parsed: { title?: unknown; emoji?: unknown } | null = null;

  try {
    parsed = JSON.parse(responseText) as { title?: unknown; emoji?: unknown };
  } catch {
    const normalized = responseText.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(normalized) as { title?: unknown; emoji?: unknown };
  }

  const title =
    typeof parsed.title === "string"
      ? parsed.title
          .replace(/^["'“”]+|["'“”]+$/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80)
      : "";
  const emoji =
    typeof parsed.emoji === "string"
      ? parsed.emoji.replace(/\s+/g, " ").trim().slice(0, 8)
      : "";

  if (!title) {
    throw new Error("OpenAI returned an invalid title payload.");
  }

  return { title, emoji: emoji || undefined };
}

const backfillInFlight = new Set<string>();

export function backfillMissingTitles(
  entries: EntryListItem[],
  onUpdate: (entryId: string, title: string, emoji: string) => void,
) {
  if (!hasInsightsConfig()) {
    return;
  }

  const candidates = entries.filter(
    (entry) =>
      entry.body.trim().length > 0 &&
      !backfillInFlight.has(entry.id) &&
      (isDefaultTitle(entry) || !entry.titleEmoji?.trim()),
  );

  if (candidates.length === 0) {
    return;
  }

  void processBackfillQueue(candidates, onUpdate);
}

function isDefaultTitle(entry: EntryListItem) {
  const defaultTitle = formatCompactDate(entry.createdAt);
  const entryTitle = entry.title.trim();

  if (entryTitle === defaultTitle) {
    return true;
  }

  const altDefault = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(entry.createdAt);

  return entryTitle === altDefault;
}

async function processBackfillQueue(
  entries: EntryListItem[],
  onUpdate: (entryId: string, title: string, emoji: string) => void,
) {
  for (const entry of entries) {
    if (backfillInFlight.has(entry.id)) {
      continue;
    }

    backfillInFlight.add(entry.id);

    try {
      const titlePackage = await generateEntryTitle(entry);

      if (titlePackage.title) {
        onUpdate(entry.id, titlePackage.title, titlePackage.emoji ?? "");
      }
    } catch (error) {
      console.error("Backfill title failed for", entry.id, error);
    } finally {
      backfillInFlight.delete(entry.id);
    }
  }
}

export function peekCachedDailyHomeCards(entries: EntryListItem[]) {
  if (!hasInsightsConfig()) {
    return null;
  }

  const { model } = getInsightsConfig();
  const contextEntries = [...entries]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, MAX_CONTEXT_ENTRIES);
  const cacheKey = buildDailyHomeCardsCacheKey(model, contextEntries);
  return dailyHomeCardsCache.get(cacheKey) ?? null;
}

export function hasInsightsConfig() {
  return Boolean(process.env.EXPO_PUBLIC_OPENAI_API_KEY);
}

function getInsightsConfig() {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing EXPO_PUBLIC_OPENAI_API_KEY for Insights.");
  }

  return {
    apiKey,
    model: process.env.EXPO_PUBLIC_OPENAI_INSIGHTS_MODEL ?? DEFAULT_INSIGHTS_MODEL,
  };
}

async function createInsightsResponse({
  apiKey,
  model,
  instructions,
  input,
}: {
  apiKey: string;
  model: string;
  instructions: string;
  input: string;
}) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: {
        effort: "low",
      },
      instructions,
      input,
    }),
  });

  const payload = (await response.json()) as OpenAIResponsesResponse;

  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    const requestSuffix = requestId ? ` [request ${requestId}]` : "";
    const message = payload.error?.message ?? "OpenAI request failed.";
    throw new Error(`${message}${requestSuffix}`);
  }

  const text = payload.output_text ?? flattenOutputText(payload.output);

  if (!text.trim()) {
    throw new Error("OpenAI returned an empty response.");
  }

  return text.trim();
}

function flattenOutputText(output: OpenAIResponsesResponse["output"]) {
  return (
    output
      ?.flatMap((item) =>
        item.content
          ?.filter((contentPart) => contentPart.type === "output_text")
          .map((contentPart) => contentPart.text ?? "") ?? [],
      )
      .join("\n") ?? ""
  );
}

function buildSnapshotContext(snapshot: InsightSnapshot) {
  return [
    `Recent entries: ${snapshot.activeEntryCount}`,
    `Total entries: ${snapshot.totalEntryCount}`,
    `Walk entries: ${snapshot.walkCount}`,
    `Recent words: ${snapshot.totalWords}`,
    `Recent steps: ${snapshot.totalSteps}`,
    `Average words per entry: ${snapshot.averageWords}`,
    `Most active day: ${snapshot.strongestDay ?? "unknown"}`,
    `Topics: ${snapshot.topTopics.join(", ") || "none"}`,
    `Lenses: ${snapshot.focusAreas.join(", ") || "none"}`,
  ].join("\n");
}

function buildEntryContext(entries: EntryListItem[]) {
  if (entries.length === 0) {
    return "No journal entries available.";
  }

  return entries
    .map((entry, index) => {
      const parts = [
        `${index + 1}. ${formatCompactDate(entry.createdAt)} | ${entry.source}`,
      ];

      if (typeof entry.durationSec === "number") {
        parts.push(`duration ${formatDuration(entry.durationSec)}`);
      }

      if (typeof entry.stepCount === "number") {
        parts.push(`steps ${entry.stepCount}`);
      }

      const header = parts.join(" | ");
      const body = entry.body.trim() || "Empty entry.";

      return `${header}\n${body}`;
    })
    .join("\n\n");
}

function formatTimeframeLabel(timeframe: InsightTimeframe) {
  if (timeframe === "30d") {
    return "the last 30 days";
  }

  if (timeframe === "90d") {
    return "the last 90 days";
  }

  if (timeframe === "all") {
    return "all available entries";
  }

  return "the last 7 days";
}

function getReflectionRequestContext(
  entries: EntryListItem[],
  timeframe: InsightTimeframe,
  model: string,
) {
  const filteredEntries = filterEntriesForTimeframe(entries, timeframe);
  const snapshot = buildInsightSnapshot(entries, timeframe);
  const contextEntries = filteredEntries.slice(0, MAX_CONTEXT_ENTRIES);
  const cacheKey = buildReflectionCacheKey(model, timeframe, contextEntries);

  return {
    cacheKey,
    contextEntries,
    snapshot,
  };
}

function buildDailyHomeCardsCacheKey(model: string, entries: EntryListItem[]) {
  const entrySignature = entries
    .map((entry) =>
      [
        entry.id,
        entry.createdAt.toISOString(),
        entry.body,
        entry.stepCount ?? "",
        entry.durationSec ?? "",
      ].join("|"),
    )
    .join("||");

  return `${model}::daily-home::${entrySignature}`;
}

function parseDailyHomeCards(responseText: string): DailyHomeCards {
  const normalized = responseText.trim();
  const jsonText =
    normalized.startsWith("```")
      ? normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
      : normalized;

  const parsed = JSON.parse(jsonText) as Partial<DailyHomeCards>;

  if (
    typeof parsed.thinkingAbout !== "string" ||
    parsed.thinkingAbout.trim().length === 0 ||
    typeof parsed.whatSeemsTrue !== "string" ||
    parsed.whatSeemsTrue.trim().length === 0
  ) {
    throw new Error("OpenAI returned an invalid daily home payload.");
  }

  return {
    thinkingAbout: normalizeSentence(parsed.thinkingAbout),
    whatSeemsTrue: normalizeSentence(parsed.whatSeemsTrue),
    closeTheDay:
      typeof parsed.closeTheDay === "string"
        ? normalizeOptionalSuggestion(parsed.closeTheDay)
        : null,
  };
}

function normalizeSentence(value: string) {
  const cleaned = value.trim().replace(/\s+/g, " ");

  if (!cleaned) {
    return "";
  }

  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  if (/[.!?]$/.test(capitalized)) {
    return capitalized;
  }

  return `${capitalized}.`;
}

function normalizeOptionalSuggestion(value: string) {
  const normalized = normalizeSentence(value);
  return normalized && !isWeakAction(normalized) ? normalized : null;
}

function isWeakAction(action: string) {
  const normalized = action.toLowerCase();
  return WEAK_ACTION_PATTERNS.some((pattern) => normalized.includes(pattern));
}

const WEAK_ACTION_PATTERNS = [
  "keep going",
  "stay on track",
  "keep pushing",
  "be on track",
  "keep working",
  "try harder",
  "stay productive",
];

function buildReflectionCacheKey(
  model: string,
  timeframe: InsightTimeframe,
  entries: EntryListItem[],
) {
  const entrySignature = entries
    .map((entry) =>
      [
        entry.id,
        entry.createdAt.toISOString(),
        entry.body,
        entry.stepCount ?? "",
        entry.durationSec ?? "",
      ].join("|"),
    )
    .join("||");

  return `${model}::${timeframe}::${entrySignature}`;
}
