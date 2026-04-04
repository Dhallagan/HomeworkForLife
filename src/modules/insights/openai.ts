import { formatCompactDate, formatDuration } from "../../lib/date";
import type { EntryListItem, ExtractedPerson } from "../journal/types";
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
export type ObservationCard = {
  type: "person" | "task" | "pattern" | "reminder" | "insight";
  title: string;
  detail: string;
};

const observationsCache = new Map<string, ObservationCard[]>();
const observationsInFlight = new Map<string, Promise<ObservationCard[]>>();
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
    "Write a 1-2 sentence reflection for the user's journal.",
    "Be specific. Name the actual things they wrote about.",
    "Focus on what seems to matter most right now.",
    `Time window: ${formatTimeframeLabel(timeframe)}.`,
    "Do not mention missing data or that you are an AI.",
    "",
    "Entries:",
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

export type OpenTask = {
  title: string;
  timeframe: string | null;
  createdAt: string;
};

export async function generateSmartObservations(
  entries: EntryListItem[],
  timeframe: InsightTimeframe,
  openTasks: OpenTask[] = [],
): Promise<ObservationCard[]> {
  const { apiKey, model } = getInsightsConfig();
  const { cacheKey, contextEntries } = getReflectionRequestContext(
    entries,
    timeframe,
    model,
  );

  const obsKey = `obs::${cacheKey}`;
  const cached = observationsCache.get(obsKey);
  if (cached) return cached;

  const inFlight = observationsInFlight.get(obsKey);
  if (inFlight) return inFlight;

  const prompt = [
    "Read these journal entries and produce 3-5 observation cards.",
    "Each card has a type, a short title (2-5 words), and a short detail (one sentence, max 12 words).",
    "Focus on reflective insights, self-care suggestions, and personal growth. Not errands.",
    "",
    "Types:",
    '- "insight": a reflective observation with a gentle suggestion. Title = what you noticed. Detail = a thoughtful nudge or remedy.',
    '- "person": someone they mention often. Title = the person\'s name. Detail = relationship or frequency.',
    '- "pattern": a recurring theme, habit, or topic. Title = the theme. Detail = what you noticed.',
    '- "reminder": something unresolved or worth circling back to. Title = the topic. Detail = why it matters.',
    "",
    "At least 2 cards should be type 'insight' with self-care, wellness, or growth suggestions grounded in the entries.",
    "",
    "Examples:",
    '[',
    '  {"type":"insight","title":"You sound stressed","detail":"Try a walk without recording. Just breathe."},',
    '  {"type":"insight","title":"Sleep keeps coming up","detail":"Maybe track bedtime for a week."},',
    '  {"type":"person","title":"Sarah","detail":"Mentioned 4 times this week."},',
    '  {"type":"pattern","title":"Coding binges","detail":"5-hour sessions, no breaks."},',
    '  {"type":"reminder","title":"Browserbase","detail":"Did they get back to you?"}',
    ']',
    "",
    "Keep titles and details SHORT. This is a card UI, not paragraphs.",
    "Do NOT create task cards for things already in the open tasks list below.",
    "Instead, create reminder cards that nudge about overdue open tasks.",
    "Return JSON only.",
    "",
    `Time window: ${formatTimeframeLabel(timeframe)}.`,
    "",
    openTasks.length > 0
      ? `Open tasks (already tracked, don't duplicate):\n${openTasks.map((t) => `- "${t.title}" (${t.timeframe ?? "no deadline"}, created ${t.createdAt})`).join("\n")}\n`
      : "",
    "Entries:",
    buildEntryContext(contextEntries),
  ].join("\n");

  const promise = createInsightsResponse({
    apiKey,
    model,
    instructions:
      "You generate structured observation cards for a journal app. Ultra-short titles and details. Output valid JSON array only.",
    input: prompt,
  })
    .then((response) => {
      const normalized = response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(normalized) as unknown;
      const cards = Array.isArray(parsed)
        ? parsed
            .filter(
              (item: unknown): item is ObservationCard =>
                typeof item === "object" &&
                item !== null &&
                typeof (item as Record<string, unknown>).type === "string" &&
                typeof (item as Record<string, unknown>).title === "string" &&
                typeof (item as Record<string, unknown>).detail === "string",
            )
            .slice(0, 5)
        : [];
      observationsCache.set(obsKey, cards);
      observationsInFlight.delete(obsKey);
      return cards;
    })
    .catch((error) => {
      observationsInFlight.delete(obsKey);
      throw error;
    });

  observationsInFlight.set(obsKey, promise);
  return promise;
}

export function peekCachedObservations(
  entries: EntryListItem[],
  timeframe: InsightTimeframe,
): ObservationCard[] | null {
  if (!hasInsightsConfig()) return null;
  const { model } = getInsightsConfig();
  const { cacheKey } = getReflectionRequestContext(entries, timeframe, model);
  return observationsCache.get(`obs::${cacheKey}`) ?? null;
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

const todaySummaryCache = new Map<string, string[]>();
const todaySummaryInFlight = new Map<string, Promise<string[]>>();

export async function generateTodaySummary(
  entries: EntryListItem[],
): Promise<string[]> {
  const { apiKey, model } = getInsightsConfig();
  const contextEntries = [...entries]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, MAX_CONTEXT_ENTRIES);
  const cacheKey = buildDailyHomeCardsCacheKey(model, contextEntries);
  const sumKey = `sum::${cacheKey}`;

  const cached = todaySummaryCache.get(sumKey);
  if (cached) return cached;

  const inFlight = todaySummaryInFlight.get(sumKey);
  if (inFlight) return inFlight;

  const prompt = [
    "Read today's journal entries and write 2-4 short bullet points summarizing the day.",
    "Each bullet is one sentence, max 12 words. Specific, grounded in the entries.",
    "Write like a friend recapping your day back to you. Casual, not formal.",
    "Return JSON only. Shape: [\"bullet 1\", \"bullet 2\", ...]",
    "",
    "Today's entries:",
    buildEntryContext(contextEntries),
  ].join("\n");

  const promise = createInsightsResponse({
    apiKey,
    model,
    instructions: "You summarize a person's day from their journal entries. Ultra-short bullets. Output valid JSON array only.",
    input: prompt,
  })
    .then((response) => {
      const normalized = response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(normalized) as unknown;
      const bullets = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string").slice(0, 4)
        : [];
      todaySummaryCache.set(sumKey, bullets);
      todaySummaryInFlight.delete(sumKey);
      return bullets;
    })
    .catch((error) => {
      todaySummaryInFlight.delete(sumKey);
      throw error;
    });

  todaySummaryInFlight.set(sumKey, promise);
  return promise;
}

export function peekCachedTodaySummary(entries: EntryListItem[]): string[] | null {
  if (!hasInsightsConfig()) return null;
  const { model } = getInsightsConfig();
  const contextEntries = [...entries]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, MAX_CONTEXT_ENTRIES);
  const cacheKey = buildDailyHomeCardsCacheKey(model, contextEntries);
  return todaySummaryCache.get(`sum::${cacheKey}`) ?? null;
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

// ── Task extraction ────────────────────────────────────────

export type ExtractedTask = {
  title: string;
  timeframe: string | null;
};

export async function extractTasksFromEntry(
  entry: EntryListItem,
): Promise<ExtractedTask[]> {
  const { apiKey, model } = getInsightsConfig();

  const prompt = [
    "Extract any tasks, goals, intentions, or things this person said they want to do from this journal entry.",
    "Return JSON only.",
    'Shape: [{"title":"short task description","timeframe":"today|this week|this month|someday|null"}]',
    "Rules:",
    "- title: 2-8 words, specific and actionable.",
    '- timeframe: when they implied they want to do it. Use null if no timeframe mentioned.',
    "- Only extract things the person is asking themselves to REMEMBER to do.",
    "- The test: would they be upset if they forgot this? If yes, it's a task.",
    "- 'I need to take out the trash' = task (they want to remember).",
    "- 'I'm getting dinner with Maggie tonight' = NOT a task (they're just describing plans).",
    "- 'I should call the dentist' = task (they want to be reminded).",
    "- 'We went to the gym' = NOT a task (already happened).",
    "- 'I'm going to start running more' = task (intention they want to track).",
    "- 'Had a meeting with the team' = NOT a task (just a fact).",
    "- Skip things they already did in the entry.",
    "- Skip descriptions of plans that are already happening.",
    "- Max 2 tasks per entry. Only the most important ones.",
    "- NEVER create a task about adding tasks. No meta-tasks like 'add X to tasks' or 'remember to do X'.",
    "- Just extract the action itself: 'Get Chipotle', not 'Add Chipotle to tasks'.",
    "- One task per idea. 'Get Chipotle' is one task, not three variations of it.",
    "- If nothing feels like a real reminder, return an empty array [].",
    "",
    "Entry:",
    entry.body,
  ].join("\n");

  const response = await createInsightsResponse({
    apiKey,
    model,
    instructions:
      "You extract actionable tasks and intentions from journal entries. Output valid JSON only.",
    input: prompt,
  });

  const normalized = response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(normalized) as unknown;

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (item: unknown): item is { title: string; timeframe: string | null } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).title === "string" &&
        (item as Record<string, unknown>).title !== "",
    )
    .map((item) => ({
      title: item.title.trim().slice(0, 100),
      timeframe:
        typeof item.timeframe === "string" && item.timeframe.trim()
          ? item.timeframe.trim()
          : null,
    }));
}

const taskBackfillInFlight = new Set<string>();

export function backfillTasks(
  entries: EntryListItem[],
  onExtracted: (entryId: string, tasks: ExtractedTask[]) => Promise<void>,
) {
  if (!hasInsightsConfig()) return;

  const candidates = entries.filter(
    (entry) =>
      entry.body.trim().length > 0 && !taskBackfillInFlight.has(entry.id),
  );

  if (candidates.length === 0) return;

  void processTaskBackfillQueue(candidates, onExtracted);
}

async function processTaskBackfillQueue(
  entries: EntryListItem[],
  onExtracted: (entryId: string, tasks: ExtractedTask[]) => Promise<void>,
) {
  for (const entry of entries) {
    if (taskBackfillInFlight.has(entry.id)) continue;
    taskBackfillInFlight.add(entry.id);

    try {
      const tasks = await extractTasksFromEntry(entry);
      await onExtracted(entry.id, tasks);
    } catch (error) {
      console.error("Task extraction failed for", entry.id, error);
    } finally {
      taskBackfillInFlight.delete(entry.id);
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
