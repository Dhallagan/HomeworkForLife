import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import { listEntries } from "../journal/repository";
import type { EntryListItem } from "../journal/types";
import {
  answerInsightQuestion,
  generateReflection,
  hasInsightsConfig,
  peekCachedReflection,
} from "./openai";
import { colors, layout, spacing } from "../../theme";

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
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);
  const chatDraftRef = useRef("");
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [profilePreview, setProfilePreview] = useState("");
  const [profilePreviewError, setProfilePreviewError] = useState<string | null>(null);
  const [isLoadingProfilePreview, setIsLoadingProfilePreview] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [thinkingFrame, setThinkingFrame] = useState(0);
  const aiReady = hasInsightsConfig();

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      void listEntries(db).then((loadedEntries) => {
        if (!isActive) {
          return;
        }

        setEntries(loadedEntries);

        if (aiReady && loadedEntries.length > 0 && messages.length === 0) {
          const cachedPreview = peekCachedReflection(loadedEntries, "30d");

          if (cachedPreview) {
            setProfilePreviewError(null);
            setProfilePreview(cachedPreview);
            setIsLoadingProfilePreview(false);
            return;
          }

          void loadProfilePreview(loadedEntries, () => isActive);
          return;
        }

        if (loadedEntries.length === 0) {
          setProfilePreview("");
          setProfilePreviewError(null);
        }
      });

      return () => {
        isActive = false;
      };
    }, [aiReady, db, messages.length]),
  );

  const starterPrompts = useMemo(
    () => [
      "What feels most alive in my journal right now?",
      "What am I circling emotionally these days?",
      "What seems top of mind beneath the surface?",
    ],
    [],
  );

  useEffect(() => {
    if (!isSending) {
      setThinkingFrame(0);
      return;
    }

    const intervalId = setInterval(() => {
      setThinkingFrame((currentFrame) => (currentFrame + 1) % 3);
    }, 360);

    return () => {
      clearInterval(intervalId);
    };
  }, [isSending]);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    if (messages.length === 0 && !isSending) {
      return;
    }

    scrollToBottom();
  }, [isSending, messages.length, scrollToBottom]);

  async function handleSendQuestion(nextQuestion?: string) {
    const question = (nextQuestion ?? chatDraftRef.current).trim();

    if (!question || isSending || entries.length === 0 || !aiReady) {
      return;
    }

    const priorMessages = messages.map(({ role, content }) => ({ role, content }));
    const nextUserMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: question,
    };

    chatDraftRef.current = "";
    setChatDraft("");
    setChatError(null);
    setIsSending(true);
    setMessages((currentMessages) => [...currentMessages, nextUserMessage]);
    scrollToBottom(false);

    try {
      const assistantReply = await answerInsightQuestion(
        entries,
        priorMessages,
        question,
        "all",
      );

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          content: assistantReply,
        },
      ]);
      scrollToBottom();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not answer right now.";
      setChatError(message);
      setMessages((currentMessages) =>
        currentMessages.filter((messageItem) => messageItem.id !== nextUserMessage.id),
      );
      chatDraftRef.current = question;
      setChatDraft(question);
      scrollToBottom();
    } finally {
      setIsSending(false);
    }
  }

  async function loadProfilePreview(
    loadedEntries: EntryListItem[],
    isActive = () => true,
  ) {
    const cachedPreview = peekCachedReflection(loadedEntries, "30d");

    if (cachedPreview) {
      setProfilePreviewError(null);
      setProfilePreview(cachedPreview);
      setIsLoadingProfilePreview(false);
      return;
    }

    setIsLoadingProfilePreview(true);
    setProfilePreviewError(null);

    try {
      const nextPreview = await generateReflection(loadedEntries, "30d");

      if (!isActive()) {
        return;
      }

      setProfilePreview(nextPreview);
    } catch (error) {
      if (!isActive()) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Could not load profile insight.";
      setProfilePreviewError(message);
      setProfilePreview("");
    } finally {
      if (isActive()) {
        setIsLoadingProfilePreview(false);
      }
    }
  }

  const handleOpenOverflow = useCallback(() => {
    const actions = [
      { label: "Profile", onPress: () => router.push("/profile") },
      { label: "Settings", onPress: () => router.push("/settings") },
    ];

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...actions.map((action) => action.label), "Cancel"],
          cancelButtonIndex: actions.length,
        },
        (selectedIndex) => {
          if (selectedIndex >= 0 && selectedIndex < actions.length) {
            actions[selectedIndex]?.onPress();
          }
        },
      );
      return;
    }

    Alert.alert("More", undefined, [
      ...actions.map((action) => ({
        text: action.label,
        onPress: action.onPress,
      })),
      {
        text: "Cancel",
        style: "cancel",
      },
    ]);
  }, [router]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>Ask Your Journal</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More options"
            hitSlop={10}
            onPress={handleOpenOverflow}
            style={({ pressed }) => [
              styles.menuButton,
              pressed && styles.menuButtonPressed,
            ]}
          >
            <Text style={styles.menuButtonText}>...</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollBody}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="always"
          onContentSizeChange={() => {
            if (messages.length > 0 || isSending) {
              scrollToBottom();
            }
          }}
        >
          {entries.length > 0 ? (
            <View style={styles.previewCard}>
              <Text style={styles.previewEyebrow}>Top Of Mind</Text>
              <Text numberOfLines={5} style={styles.previewBody}>
                {!aiReady
                  ? "Open Profile to see the journal overview."
                  : isLoadingProfilePreview
                    ? "Reading the past month..."
                    : profilePreviewError
                      ? profilePreviewError
                      : profilePreview}
              </Text>
              {aiReady && !isLoadingProfilePreview && !profilePreviewError ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/profile")}
                  style={({ pressed }) => [
                    styles.previewLink,
                    pressed && styles.previewLinkPressed,
                  ]}
                >
                  <Text style={styles.previewLinkText}>Read more</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.starterList}>
                {starterPrompts.map((prompt) => (
                  <Pressable
                    key={prompt}
                    style={styles.promptChip}
                    onPress={() => void handleSendQuestion(prompt)}
                  >
                    <Text style={styles.promptText}>{prompt}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
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
                    {message.role === "user" ? "You" : "Journal"}
                  </Text>
                  <Text style={styles.chatText}>{message.content}</Text>
                </View>
              ))}
              {isSending ? (
                <View style={[styles.chatBubble, styles.assistantBubble, styles.thinkingBubble]}>
                  <Text style={styles.chatRole}>Journal</Text>
                  <Text style={styles.thinkingText}>
                    Thinking{".".repeat(thinkingFrame + 1)}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {!aiReady ? (
            <Text style={styles.emptyText}>
              Chat needs an OpenAI key configured through env. Production should move
              this behind a proxy.
            </Text>
          ) : null}

          {entries.length === 0 ? (
            <Text style={styles.emptyText}>
              Add a few entries first. Then this screen can answer questions about
              what feels latest, repeated, unresolved, or most important.
            </Text>
          ) : null}

          {chatError ? <Text style={styles.errorText}>{chatError}</Text> : null}
        </ScrollView>

        <View style={styles.composerShell}>
          <View style={styles.composer}>
            <TextInput
              value={chatDraft}
              onChangeText={(nextValue) => {
                chatDraftRef.current = nextValue;
                setChatDraft(nextValue);
              }}
              onSubmitEditing={() => void handleSendQuestion()}
              placeholder="Ask your journal anything."
              placeholderTextColor={colors.muted}
              multiline
              returnKeyType="send"
              rejectResponderTermination={false}
              submitBehavior="submit"
              style={styles.chatInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={isSending}
              onPressIn={() => void handleSendQuestion()}
              style={({ pressed }) => [
                styles.sendIconButton,
                pressed && !isSending && styles.sendIconButtonPressed,
                isSending && styles.sendIconButtonDisabled,
              ]}
            >
              <Text style={styles.sendIcon}>{isSending ? "…" : "↑"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPadding,
    paddingTop: layout.screenTop,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    color: colors.text,
    fontWeight: "300",
    letterSpacing: -1.1,
    marginTop: 2,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  menuButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  menuButtonText: {
    color: colors.muted,
    fontSize: 20,
    lineHeight: 20,
    letterSpacing: 1.2,
    marginTop: -6,
  },
  scrollBody: {
    flex: 1,
    marginTop: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  emptyState: {
    gap: spacing.md,
  },
  previewCard: {
    gap: spacing.sm,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  previewEyebrow: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  previewBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  previewLink: {
    alignSelf: "flex-start",
    marginTop: 2,
    paddingVertical: 2,
  },
  previewLinkPressed: {
    opacity: 0.6,
  },
  previewLinkText: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 0.9,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  starterList: {
    gap: spacing.xs,
  },
  promptChip: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  promptText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
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
    alignSelf: "flex-end",
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  thinkingBubble: {
    minHeight: 74,
    justifyContent: "center",
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
  thinkingText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  composerShell: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  composer: {
    position: "relative",
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 74,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chatInput: {
    minHeight: 40,
    maxHeight: 120,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 0,
    paddingTop: 4,
    paddingBottom: 28,
    paddingRight: 52,
    textAlignVertical: "top",
  },
  sendIconButton: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    flexShrink: 0,
  },
  sendIconButtonPressed: {
    opacity: 0.88,
  },
  sendIconButtonDisabled: {
    opacity: 0.6,
  },
  sendIcon: {
    color: "#FFF8F2",
    fontSize: 20,
    lineHeight: 20,
    fontWeight: "600",
    marginTop: -2,
  },
});
