import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";

import {
  Panel,
  Pill,
  PrimaryButton,
  SecondaryButton,
  Screen,
  ScreenHeader,
  SectionLabel,
} from "../../components/ui";
import { listEntries } from "../journal/repository";
import { buildInsightSnapshot, type InsightSnapshot } from "./analysis";
import {
  answerInsightQuestion,
  generateReflection,
  hasInsightsConfig,
} from "./openai";
import type { EntryListItem } from "../journal/types";
import { colors, spacing } from "../../theme";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export default function InsightsScreen({
  onNavigateHome,
}: {
  onNavigateHome: () => void;
}) {
  const db = useSQLiteContext();
  const [snapshot, setSnapshot] = useState<InsightSnapshot | null>(null);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [reflection, setReflection] = useState("");
  const [reflectionError, setReflectionError] = useState<string | null>(null);
  const [isRefreshingReflection, setIsRefreshingReflection] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const aiReady = hasInsightsConfig();

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      void listEntries(db).then((loadedEntries) => {
        if (!isActive) {
          return;
        }

        setEntries(loadedEntries);
        setSnapshot(buildInsightSnapshot(loadedEntries));

        if (aiReady && loadedEntries.length > 0) {
          void loadReflection(loadedEntries, () => isActive);
          return;
        }

        if (loadedEntries.length === 0) {
          setReflection("");
          setReflectionError(null);
        }
      });

      return () => {
        isActive = false;
      };
    }, [aiReady, db]),
  );

  const suggestionPills = useMemo(
    () => snapshot?.questions.slice(0, 3) ?? [],
    [snapshot],
  );

  async function loadReflection(
    loadedEntries: EntryListItem[],
    isActive = () => true,
  ) {
    setIsRefreshingReflection(true);
    setReflectionError(null);

    try {
      const nextReflection = await generateReflection(loadedEntries);

      if (!isActive()) {
        return;
      }

      setReflection(nextReflection);
    } catch (error) {
      if (!isActive()) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Could not load reflection.";
      setReflectionError(message);
      setReflection("");
    } finally {
      if (isActive()) {
        setIsRefreshingReflection(false);
      }
    }
  }

  async function handleSendQuestion(nextQuestion?: string) {
    const question = (nextQuestion ?? chatDraft).trim();

    if (!question || isSending || entries.length === 0) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: question,
    };

    setChatDraft("");
    setChatError(null);
    setIsSending(true);
    setMessages((currentMessages) => [...currentMessages, nextUserMessage]);

    try {
      const assistantReply = await answerInsightQuestion(
        entries,
        messages.map(({ role, content }) => ({ role, content })),
        question,
      );

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          content: assistantReply,
        },
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not answer right now.";
      setChatError(message);
      setMessages((currentMessages) =>
        currentMessages.filter((messageItem) => messageItem.id !== nextUserMessage.id),
      );
      setChatDraft(question);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Screen scroll style={styles.screenContent}>
      <ScreenHeader
        eyebrow="Pattern Deck"
        title="Insights"
        description="This side is where the app starts reflecting your life back to you instead of just storing transcripts."
        trailing={
          <Pressable hitSlop={10} onPress={onNavigateHome}>
            <Text style={styles.homeLink}>Home</Text>
          </Pressable>
        }
      />

      <Panel tone="soft">
        <Text style={styles.heroEyebrow}>Reflection</Text>
        <Text style={styles.heroTitle}>What stands out right now</Text>
        {entries.length === 0 ? (
          <Text style={styles.heroBody}>
            Add a few entries and this side can start reflecting them back to you.
          </Text>
        ) : !aiReady ? (
          <Text style={styles.heroBody}>
            Add `EXPO_PUBLIC_OPENAI_API_KEY` to enable the LLM reflection and chat.
          </Text>
        ) : isRefreshingReflection ? (
          <Text style={styles.heroBody}>Writing your reflection...</Text>
        ) : reflectionError ? (
          <Text style={styles.heroBody}>{reflectionError}</Text>
        ) : (
          <Text style={styles.heroBody}>{reflection}</Text>
        )}
        {aiReady && entries.length > 0 ? (
          <SecondaryButton onPress={() => void loadReflection(entries)}>
            Refresh Reflection
          </SecondaryButton>
        ) : null}
      </Panel>

      <SectionLabel>Volume</SectionLabel>
      <View style={styles.metricGrid}>
        <MetricCard
          label="Entries"
          value={snapshot ? `${snapshot.activeEntryCount}` : "--"}
          note="Recent window"
        />
        <MetricCard
          label="Walks"
          value={snapshot ? `${snapshot.walkCount}` : "--"}
          note="Voice captures"
        />
        <MetricCard
          label="Words"
          value={snapshot ? `${snapshot.totalWords}` : "--"}
          note="Recent text"
        />
        <MetricCard
          label="Steps"
          value={snapshot ? `${snapshot.totalSteps}` : "--"}
          note="Walk sessions"
        />
      </View>

      <SectionLabel>Patterns</SectionLabel>
      <Panel style={styles.panel}>
        <PatternRow
          label="Average entry size"
          value={snapshot ? `${snapshot.averageWords} words` : "--"}
        />
        <PatternRow
          label="Most active day"
          value={snapshot?.strongestDay ?? "No data yet"}
        />
        <PatternRow
          label="Recurring topics"
          value={snapshot?.topTopics.join(", ") || "No repeated topics yet"}
        />
        <PatternRow
          label="Strongest lenses"
          value={snapshot?.focusAreas.join(", ") || "No clear lens yet"}
        />
      </Panel>

      <SectionLabel>Prompts</SectionLabel>
      <Panel style={styles.panel}>
        {suggestionPills.length ? (
          suggestionPills.map((question) => (
            <Pressable
              key={question}
              style={styles.questionRow}
              onPress={() => void handleSendQuestion(question)}
            >
              <Pill>{`Ask`}</Pill>
              <Text style={styles.questionText}>{question}</Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.emptyText}>
            Add a few entries and this side can start generating reflection prompts.
          </Text>
        )}
      </Panel>

      <SectionLabel>Chat</SectionLabel>
      <Panel style={styles.panel}>
        {!aiReady ? (
          <Text style={styles.emptyText}>
            Chat needs an OpenAI key configured through env. Keep in mind that a
            client-side Expo key is not secret, so production should use a proxy.
          </Text>
        ) : entries.length === 0 ? (
          <Text style={styles.emptyText}>
            Chat becomes useful once there are entries to reason over.
          </Text>
        ) : (
          <>
            {messages.length === 0 ? (
              <Text style={styles.emptyText}>
                Ask about business, relationships, health, repeated themes, or what
                seems to be taking your attention.
              </Text>
            ) : (
              <View style={styles.chatThread}>
                {messages.map((message) => (
                  <View
                    key={message.id}
                    style={[
                      styles.chatBubble,
                      message.role === "user"
                        ? styles.userBubble
                        : styles.assistantBubble,
                    ]}
                  >
                    <Text style={styles.chatRole}>
                      {message.role === "user" ? "You" : "Insight"}
                    </Text>
                    <Text style={styles.chatText}>{message.content}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.composer}>
              <TextInput
                value={chatDraft}
                onChangeText={setChatDraft}
                placeholder="Ask what your entries say about your week."
                placeholderTextColor={colors.muted}
                multiline
                style={styles.chatInput}
              />
              <PrimaryButton
                onPress={() => void handleSendQuestion()}
                style={styles.sendButton}
              >
                {isSending ? "Thinking..." : "Send"}
              </PrimaryButton>
            </View>

            {chatError ? <Text style={styles.errorText}>{chatError}</Text> : null}
          </>
        )}
      </Panel>
    </Screen>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Panel style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricNote}>{note}</Text>
    </Panel>
  );
}

function PatternRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.patternRow}>
      <Text style={styles.patternLabel}>{label}</Text>
      <Text style={styles.patternValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingLeft: 24,
  },
  homeLink: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
    paddingTop: 4,
  },
  heroEyebrow: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  heroTitle: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "300",
    letterSpacing: -0.8,
  },
  heroBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricCard: {
    width: "48%",
    minWidth: 150,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  metricValue: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "300",
  },
  metricNote: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  panel: {
    gap: spacing.md,
  },
  patternRow: {
    gap: 4,
  },
  patternLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  patternValue: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 24,
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  questionText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  chatThread: {
    gap: spacing.sm,
  },
  chatBubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  userBubble: {
    backgroundColor: colors.accentSoft,
    alignSelf: "flex-start",
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chatRole: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  chatText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  composer: {
    gap: spacing.sm,
  },
  chatInput: {
    minHeight: 100,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  sendButton: {
    alignSelf: "flex-start",
    minWidth: 120,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
