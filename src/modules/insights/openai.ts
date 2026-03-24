import { formatCompactDate, formatDayKey, formatDuration } from "../../lib/date";
import type { EntryListItem, ExtractedPerson } from "../journal/types";
import {
  buildInsightSnapshot,
  filterEntriesForTimeframe,
  type InsightTimeframe,
  type InsightSnapshot,
} from "./analysis";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_INSIGHTS_MODEL = "gpt-4o-mini";
const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const MAX_CONTEXT_ENTRIES = 8;
const MAX_TOOL_ROUNDS = 6;
const reflectionCache = new Map<string, string>();
const reflectionInFlight = new Map<string, Promise<string>>();
const dailyHomeCardsCache = new Map<string, DailyHomeCards>();
const dailyHomeCardsInFlight = new Map<string, Promise<DailyHomeCards>>();

export type InsightChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// ── Chat agent types ──────────────────────────────────────────

type ChatApiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatCompletionResponse = {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  error?: { message: string };
};

const CHAT_SYSTEM_PROMPT = `You are a warm, grounded journal companion. The user is talking to their own journal.

You have one tool: search_entries. Use it to look up journal entries before answering any factual question about the user's history — specific dates, how often something happened, who was mentioned, where they went, etc. For purely reflective or emotional questions, you can answer from the conversation context.

Guidelines:
- Be conversational and natural, not clinical or report-like
- When asked about specific events or patterns ("what days did I go to the gym", "when did I last see X"), always call search_entries first — and if the first search returns nothing, try again with different or broader keywords before giving up
- When listing dates or events, include every match the tool returns — don't truncate
- Mention dates naturally in sentences ("last Tuesday", "on March 3rd"), not as bullet citations
- Keep answers to 2–4 sentences unless the user asks for more
- If evidence is thin or ambiguous, say so gently and ask one short follow-up question
- Never mention tools, search, retrieval, or that you looked anything up`;

const SEARCH_ENTRIES_TOOL = {
  type: "function",
  function: {
    name: "search_entries",
    description:
      "Search the user's journal entries by keywords and/or date range. Returns matching entries with their full text and dates. Call this before answering any question about specific events, dates, or patterns.",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description:
            "Words or short phrases to search for in entry text. Case-insensitive. Each keyword is matched independently (OR logic). Use synonyms or related terms if the first search returns nothing.",
        },
        date_from: {
          type: "string",
          description: "Start of date range, inclusive, in YYYY-MM-DD format.",
        },
        date_to: {
          type: "string",
          description: "End of date range, inclusive, in YYYY-MM-DD format.",
        },
        limit: {
          type: "integer",
          description: "Maximum entries to return. Defaults to 30, max 50.",
          minimum: 1,
          maximum: 50,
        },
      },
      required: [],
    },
  },
} as const;

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
): Promise<string> {
  const { apiKey } = getInsightsConfig();
  const model = process.env.EXPO_PUBLIC_OPENAI_CHAT_MODEL ?? DEFAULT_CHAT_MODEL;

  const apiMessages: ChatApiMessage[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];

  return runChatAgentLoop(apiKey, model, entries, apiMessages);
}

function executeSearchEntries(
  entries: EntryListItem[],
  args: {
    keywords?: string[];
    date_from?: string;
    date_to?: string;
    limit?: number;
  },
): string {
  let results = [...entries];

  if (args.date_from) {
    results = results.filter((e) => formatDayKey(e.createdAt) >= args.date_from!);
  }

  if (args.date_to) {
    results = results.filter((e) => formatDayKey(e.createdAt) <= args.date_to!);
  }

  if (args.keywords?.length) {
    results = results.filter((e) => {
      const text = `${e.title} ${e.body}`.toLowerCase();
      return args.keywords!.some((kw) => text.includes(kw.toLowerCase()));
    });
  }

  results = results
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, args.limit ?? 30);

  if (results.length === 0) {
    return "No journal entries found matching these criteria.";
  }

  return results
    .map((entry, i) => {
      const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(
        entry.createdAt,
      );
      const header = [`[${i + 1}] ${formatCompactDate(entry.createdAt)} (${weekday})`];

      if (entry.source === "walk") {
        if (typeof entry.durationSec === "number") {
          header.push(`${formatDuration(entry.durationSec)} walk`);
        }

        if (typeof entry.stepCount === "number") {
          header.push(`${entry.stepCount} steps`);
        }
      }

      const body = entry.body.trim() || "(empty entry)";
      return `${header.join(" | ")}\n${body}`;
    })
    .join("\n\n");
}

async function runChatAgentLoop(
  apiKey: string,
  model: string,
  entries: EntryListItem[],
  initialMessages: ChatApiMessage[],
): Promise<string> {
  const messages = [...initialMessages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        tools: [SEARCH_ENTRIES_TOOL],
        tool_choice: "auto",
      }),
    });

    const payload = (await response.json()) as ChatCompletionResponse;

    if (!response.ok) {
      const requestId = response.headers.get("x-request-id");
      const errorMessage = payload.error?.message ?? "OpenAI request failed.";
      throw new Error(requestId ? `${errorMessage} [request ${requestId}]` : errorMessage);
    }

    const choice = payload.choices[0];

    if (!choice) {
      throw new Error("OpenAI returned no choices.");
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    if (choice.finish_reason !== "tool_calls" || !assistantMessage.tool_calls?.length) {
      return (assistantMessage.content ?? "").trim();
    }

    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.function.name === "search_entries") {
        const args = JSON.parse(toolCall.function.arguments) as {
          keywords?: string[];
          date_from?: string;
          date_to?: string;
          limit?: number;
        };
        const result = executeSearchEntries(entries, args);
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
      }
    }
  }

  throw new Error("Chat agent exceeded maximum reasoning rounds.");
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

// ── People extraction ────────────────────────────────────────

const peopleBackfillInFlight = new Set<string>();

export async function extractPeopleFromEntry(
  entry: EntryListItem,
  existingPeople: { id: string; name: string; aliases: string[] }[],
): Promise<ExtractedPerson[]> {
  const { apiKey, model } = getInsightsConfig();

  const peopleContext =
    existingPeople.length > 0
      ? existingPeople
          .map(
            (p) =>
              `ID:${p.id} Name:"${p.name}"${p.aliases.length > 0 ? ` Aliases:${p.aliases.map((a) => `"${a}"`).join(",")}` : ""}`,
          )
          .join("\n")
      : "No existing people yet.";

  const prompt = [
    "Extract all people mentioned in this journal entry.",
    "Return JSON only.",
    'Use this shape: [{"name":"","existingPersonId":null}].',
    "Rules:",
    "- name: the name as used in the text.",
    "- existingPersonId: if the person matches an existing one (considering aliases), use their ID. Otherwise null.",
    "- Skip group references without individual names (e.g. 'the team', 'everyone').",
    "- Skip generic relationship terms without a name (e.g. 'a friend', 'someone').",
    "- If no people are mentioned, return an empty array [].",
    "",
    "Existing people:",
    peopleContext,
    "",
    "Journal entry:",
    entry.body,
  ].join("\n");

  const response = await createInsightsResponse({
    apiKey,
    model,
    instructions:
      "You extract people names from journal entries and match them to existing records. Output valid JSON only.",
    input: prompt,
  });

  return parsePeopleExtraction(response);
}

function parsePeopleExtraction(responseText: string): ExtractedPerson[] {
  const normalized = responseText.trim();
  const jsonText = normalized.startsWith("```")
    ? normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : normalized;

  const parsed = JSON.parse(jsonText) as unknown;

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(
      (item: unknown): item is { name: string; existingPersonId: string | null } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === "string" &&
        (item as Record<string, unknown>).name !== "",
    )
    .map((item) => ({
      name: item.name.trim().slice(0, 80),
      existingPersonId: typeof item.existingPersonId === "string" ? item.existingPersonId : null,
    }));
}

export async function generatePersonSummary(
  personName: string,
  aliases: string[],
  entries: EntryListItem[],
): Promise<{ summary: string; emoji: string } | null> {
  if (entries.length === 0) return null;

  const { apiKey, model } = getInsightsConfig();

  const context = entries
    .slice(0, 10)
    .map(
      (e, i) =>
        `${i + 1}. ${formatCompactDate(e.createdAt)}: ${e.body.trim().slice(0, 300)}`,
    )
    .join("\n\n");

  const prompt = [
    `Write a one-line description and pick an emoji for "${personName}"${aliases.length > 0 ? ` (also known as: ${aliases.join(", ")})` : ""}.`,
    'Return JSON only: {"summary":"","emoji":""}.',
    "Rules:",
    "- summary: max 12 words. Be specific: relationship, shared activities, context.",
    "- emoji: one emoji that represents this person's role in the author's life.",
    "- Good examples: 'Your wife. SoulCycle partner.', 'College friend. Beach day regular.'",
    "",
    "Journal entries mentioning this person:",
    context,
  ].join("\n");

  const response = await createInsightsResponse({
    apiKey,
    model,
    instructions:
      "You write concise person descriptions for a journal app. Output valid JSON only.",
    input: prompt,
  });

  try {
    const normalized = response.trim();
    const jsonText = normalized.startsWith("```")
      ? normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
      : normalized;
    const parsed = JSON.parse(jsonText) as { summary?: string; emoji?: string };
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 120) : "",
      emoji: typeof parsed.emoji === "string" ? parsed.emoji.trim().slice(0, 8) : "",
    };
  } catch {
    return null;
  }
}

export function backfillPeople(
  entries: EntryListItem[],
  getExistingPeople: () => Promise<{ id: string; name: string; aliases: string[] }[]>,
  onExtracted: (entryId: string, people: ExtractedPerson[]) => Promise<void>,
  onAllDone: () => void,
) {
  if (!hasInsightsConfig()) return;

  const candidates = entries.filter(
    (entry) =>
      entry.body.trim().length > 0 && !peopleBackfillInFlight.has(entry.id),
  );

  if (candidates.length === 0) {
    onAllDone();
    return;
  }

  void processPeopleBackfillQueue(candidates, getExistingPeople, onExtracted, onAllDone);
}

async function processPeopleBackfillQueue(
  entries: EntryListItem[],
  getExistingPeople: () => Promise<{ id: string; name: string; aliases: string[] }[]>,
  onExtracted: (entryId: string, people: ExtractedPerson[]) => Promise<void>,
  onAllDone: () => void,
) {
  for (const entry of entries) {
    if (peopleBackfillInFlight.has(entry.id)) continue;

    peopleBackfillInFlight.add(entry.id);

    try {
      const existingPeople = await getExistingPeople();
      const extracted = await extractPeopleFromEntry(entry, existingPeople);
      await onExtracted(entry.id, extracted);
    } catch (error) {
      console.error("People backfill failed for", entry.id, error);
    } finally {
      peopleBackfillInFlight.delete(entry.id);
    }
  }

  onAllDone();
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
