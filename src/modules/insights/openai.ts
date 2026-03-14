import { formatCompactDate, formatDuration } from "../../lib/date";
import type { EntryListItem } from "../journal/types";
import {
  buildInsightSnapshot,
  selectEntriesForQuestion,
  type InsightSnapshot,
} from "./analysis";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_INSIGHTS_MODEL = "gpt-5-mini";
const MAX_CONTEXT_ENTRIES = 8;

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

export async function generateReflection(entries: EntryListItem[]) {
  const { apiKey, model } = getInsightsConfig();
  const snapshot = buildInsightSnapshot(entries);
  const contextEntries = entries.slice(0, MAX_CONTEXT_ENTRIES);
  const prompt = [
    "Write a concise reflection blurb for the user's journal app.",
    "Ground every statement in the provided entries.",
    "Keep it to 3 short paragraphs max.",
    "Focus on recurring themes, energy, tension, and what seems to matter most right now.",
    "Do not mention missing data, prompt design, or that you are an AI.",
    "",
    buildSnapshotContext(snapshot),
    "",
    "Recent entries:",
    buildEntryContext(contextEntries),
  ].join("\n");

  return createInsightsResponse({
    apiKey,
    model,
    instructions:
      "You are the reflection layer for a personal journaling app. Be specific, observant, and emotionally intelligent. Never invent events. If evidence is weak, use cautious language.",
    input: prompt,
  });
}

export async function answerInsightQuestion(
  entries: EntryListItem[],
  messages: InsightChatMessage[],
  question: string,
) {
  const { apiKey, model } = getInsightsConfig();
  const snapshot = buildInsightSnapshot(entries);
  const relevantEntries = selectEntriesForQuestion(entries, question, 6);
  const fallbackEntries =
    relevantEntries.length > 0 ? relevantEntries : entries.slice(0, MAX_CONTEXT_ENTRIES);
  const conversation = [...messages, { role: "user" as const, content: question }]
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  const prompt = [
    "Answer the user's question about their own journal entries.",
    "Use only the supplied entries and conversation context.",
    "Be direct, useful, and grounded.",
    "If the evidence is mixed, say so.",
    "When relevant, mention the specific day or entry timing.",
    "",
    buildSnapshotContext(snapshot),
    "",
    "Relevant entries:",
    buildEntryContext(fallbackEntries),
    "",
    "Conversation:",
    conversation,
  ].join("\n");

  return createInsightsResponse({
    apiKey,
    model,
    instructions:
      "You are answering questions about the user's life from their own journal. Stay inside the evidence. Prefer synthesis over quoting. If the entries do not support a conclusion, say what is missing.",
    input: prompt,
  });
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
