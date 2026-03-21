import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
import { useSQLiteContext } from "expo-sqlite";

import { PaperSheet } from "../../src/components/notebook";
import { Screen } from "../../src/components/ui";
import {
  formatCompactDate,
  formatDuration,
  formatEntryMeta,
} from "../../src/lib/date";
import {
  createManualEntry,
  getEntryById,
  updateEntry,
} from "../../src/modules/journal/repository";
import type { EntryDetail } from "../../src/modules/journal/types";
import { colors } from "../../src/theme";

const ENTRY_RULE_GAP = 24;
const ENTRY_RULE_OFFSET = 56;

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const navigation = useNavigation();
  const router = useRouter();

  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [title, setTitle] = useState("");
  const [titleEmoji, setTitleEmoji] = useState("");
  const [body, setBody] = useState("");
  const dirtyRef = useRef(false);
  const hasCreatedManualRef = useRef(false);

  useEffect(() => {
    void loadEntry();
  }, [id]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useFocusEffect(() => {
    return () => {
      if (dirtyRef.current && entry) {
        void saveChanges(entry.id, title, titleEmoji, body);
      }
    };
  });

  async function loadEntry() {
    if (id === "new") {
      if (hasCreatedManualRef.current) {
        return;
      }

      hasCreatedManualRef.current = true;
      const created = await createManualEntry(db);
      const persisted = await getEntryById(db, created.id);

      if (persisted) {
        setEntry(persisted);
        setTitle(persisted.title);
        setTitleEmoji(persisted.titleEmoji ?? "");
        setBody(persisted.body);
      }

      return;
    }

    const persisted = await getEntryById(db, id);

    if (persisted) {
      setEntry(persisted);
      setTitle(persisted.title);
      setTitleEmoji(persisted.titleEmoji ?? "");
      setBody(persisted.body);
    }
  }

  async function saveChanges(
    nextId: string,
    nextTitle: string,
    nextTitleEmoji: string,
    nextBody: string,
  ) {
    dirtyRef.current = false;
    await updateEntry(db, nextId, {
      title: nextTitle.trim() || entry?.title || "",
      titleEmoji: nextTitleEmoji,
      body: nextBody,
    });
  }

  async function handleDone() {
    if (dirtyRef.current && entry) {
      await saveChanges(entry.id, title, titleEmoji, body);
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    router.replace("/");
  }

  if (!entry) {
    return (
      <Screen includeTopInset>
        <Text style={styles.loadingText}>Loading entry…</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll includeTopInset>
      <View style={styles.headerRow}>
        <View style={styles.header}>
          <Text style={styles.dateText}>{formatCompactDate(entry.createdAt)}</Text>
          <Text style={styles.metaText}>{formatEntryMeta(entry.createdAt)}</Text>
          {entry.source === "walk" ? (
            <Text style={styles.walkMetaText}>{formatWalkMeta(entry)}</Text>
          ) : null}
        </View>
        <Pressable hitSlop={10} onPress={() => void handleDone()}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>

      <PaperSheet
        style={styles.sheet}
        contentStyle={styles.sheetContent}
        lineGap={ENTRY_RULE_GAP}
        lineOffset={ENTRY_RULE_OFFSET}
      >
        <View style={styles.titleRow}>
          <TextInput
            value={titleEmoji}
            onChangeText={(nextValue) => {
              dirtyRef.current = true;
              setTitleEmoji(nextValue);
            }}
            onBlur={() => {
              if (dirtyRef.current) {
                void saveChanges(entry.id, title, titleEmoji, body);
              }
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="🌤️"
            placeholderTextColor={colors.muted}
            style={styles.emojiInput}
          />
          <TextInput
            value={title}
            onChangeText={(nextValue) => {
              dirtyRef.current = true;
              setTitle(nextValue);
            }}
            onBlur={() => {
              if (dirtyRef.current) {
                void saveChanges(entry.id, title, titleEmoji, body);
              }
            }}
            placeholder="Give this entry a title."
            placeholderTextColor={colors.muted}
            style={styles.titleInput}
          />
        </View>
        <TextInput
          value={body}
          onChangeText={(nextValue) => {
            dirtyRef.current = true;
            setBody(nextValue);
          }}
          onBlur={() => {
            if (dirtyRef.current) {
              void saveChanges(entry.id, title, titleEmoji, body);
            }
          }}
          multiline
          textAlignVertical="top"
          style={styles.bodyInput}
          placeholder="Write what happened today."
          placeholderTextColor={colors.muted}
        />
      </PaperSheet>
    </Screen>
  );
}

function formatWalkMeta(entry: EntryDetail) {
  const parts: string[] = [];

  if (typeof entry.stepCount === "number") {
    parts.push(`${entry.stepCount.toLocaleString()} steps`);
  }

  if (typeof entry.durationSec === "number") {
    parts.push(formatDuration(entry.durationSec));
  }

  return parts.join("  |  ");
}

const styles = StyleSheet.create({
  loadingText: {
    color: colors.text,
    fontSize: 16,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  header: {
    gap: 4,
    paddingTop: 2,
    flex: 1,
  },
  dateText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: "300",
    letterSpacing: -0.6,
  },
  metaText: {
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: "Courier",
  },
  walkMetaText: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    fontFamily: "Courier",
    paddingTop: 2,
  },
  doneText: {
    color: colors.text,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    paddingTop: 4,
  },
  sheet: {
    minHeight: 460,
    marginBottom: 16,
  },
  sheetContent: {
    paddingTop: 10,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 12,
  },
  emojiInput: {
    width: 42,
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    paddingVertical: 0,
    paddingHorizontal: 0,
    textAlign: "center",
  },
  titleInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: -0.5,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  bodyInput: {
    minHeight: 360,
    color: colors.text,
    fontSize: 12,
    lineHeight: ENTRY_RULE_GAP,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
});
