import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
  getAdjacentEntryIds,
  getEntriesForPerson,
  getEntryById,
  getExistingPeopleContext,
  linkPeopleToEntry,
  updateEntry,
  updateEntryTitle,
  updatePerson,
} from "../../src/modules/journal/repository";
import {
  extractPeopleFromEntry,
  generateEntryTitle,
  generatePersonSummary,
  hasInsightsConfig,
} from "../../src/modules/insights/openai";
import { formatEntryTitle as formatDefaultTitle } from "../../src/lib/date";
import type { EntryDetail } from "../../src/modules/journal/types";
import { colors } from "../../src/theme";

const ENTRY_RULE_GAP = 28;
const ENTRY_RULE_OFFSET = 46;

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const navigation = useNavigation();
  const router = useRouter();

  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [title, setTitle] = useState("");
  const [titleEmoji, setTitleEmoji] = useState("");
  const [body, setBody] = useState("");
  const [prevId, setPrevId] = useState<string | null>(null);
  const [nextId, setNextId] = useState<string | null>(null);
  const [editing, setEditing] = useState(id === "new");
  const dirtyRef = useRef(false);
  const hasCreatedManualRef = useRef(false);
  const emojiInputRef = useRef<TextInput>(null);
  const bodyInputRef = useRef<TextInput>(null);

  useEffect(() => {
    void loadEntry();
    setEditing(id === "new");
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

      const adjacent = await getAdjacentEntryIds(db, id);
      setPrevId(adjacent.prevId);
      setNextId(adjacent.nextId);
    }
  }

  async function saveChanges(
    entryId: string,
    nextTitle: string,
    nextTitleEmoji: string,
    nextBody: string,
  ) {
    dirtyRef.current = false;
    await updateEntry(db, entryId, {
      title: nextTitle.trim() || entry?.title || "",
      titleEmoji: nextTitleEmoji,
      body: nextBody,
    });
  }

  async function navigateTo(targetId: string) {
    if (dirtyRef.current && entry) {
      await saveChanges(entry.id, title, titleEmoji, body);
    }
    router.replace(`/entry/${targetId}`);
  }

  function handleEdit() {
    setEditing(true);
    setTimeout(() => {
      bodyInputRef.current?.focus();
    }, 100);
  }

  async function handleDone() {
    if (editing) {
      Keyboard.dismiss();

      if (dirtyRef.current && entry) {
        await saveChanges(entry.id, title, titleEmoji, body);
      }

      if (entry && hasInsightsConfig()) {
        const needsTitle =
          body.trim().length > 0 &&
          (!titleEmoji.trim() ||
            title.trim() === formatDefaultTitle(entry.createdAt));

        if (needsTitle) {
          void autoGenerateTitle(entry.id, body, entry.createdAt);
        }

        if (body.trim().length > 0) {
          void autoExtractPeople(entry.id, body, entry.createdAt);
        }
      }

      setEditing(false);
      return;
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    router.replace("/");
  }

  async function autoGenerateTitle(
    entryId: string,
    entryBody: string,
    createdAt: Date,
  ) {
    try {
      const titlePackage = await generateEntryTitle({
        id: entryId,
        createdAt,
        source: "manual",
        title: formatDefaultTitle(createdAt),
        body: entryBody,
      });

      await updateEntryTitle(db, entryId, {
        title: titlePackage.title || formatDefaultTitle(createdAt),
        titleEmoji: titlePackage.emoji || "",
      });
    } catch (error) {
      console.error("Auto-generate title failed", error);
    }
  }

  async function autoExtractPeople(
    entryId: string,
    entryBody: string,
    createdAt: Date,
  ) {
    try {
      const existingPeople = await getExistingPeopleContext(db);
      const extracted = await extractPeopleFromEntry(
        {
          id: entryId,
          createdAt,
          source: "manual",
          title: "",
          body: entryBody,
        },
        existingPeople,
      );

      if (extracted.length > 0) {
        await linkPeopleToEntry(db, entryId, extracted);

        for (const person of extracted) {
          if (!person.existingPersonId) {
            void generateSummaryForNewPerson(entryId, person.name);
          }
        }
      }
    } catch (error) {
      console.error("Auto-extract people failed", error);
    }
  }

  async function generateSummaryForNewPerson(entryId: string, personName: string) {
    try {
      const people = await getExistingPeopleContext(db);
      const match = people.find(
        (p) => p.name.toLowerCase() === personName.toLowerCase(),
      );
      if (!match) return;

      const personEntries = await getEntriesForPerson(db, match.id);
      const result = await generatePersonSummary(match.name, match.aliases, personEntries);
      if (result) {
        await updatePerson(db, match.id, {
          summary: result.summary,
          emoji: result.emoji,
        });
      }
    } catch (error) {
      console.error("Generate person summary failed", error);
    }
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
          <View style={styles.dateNav}>
            <Pressable
              hitSlop={12}
              onPress={() => prevId && void navigateTo(prevId)}
              style={{ opacity: prevId ? 1 : 0.2 }}
              disabled={!prevId}
            >
              <Text style={styles.navArrow}>‹</Text>
            </Pressable>
            <Text style={styles.dateText}>
              {formatCompactDate(entry.createdAt)}
            </Text>
            <Pressable
              hitSlop={12}
              onPress={() => nextId && void navigateTo(nextId)}
              style={{ opacity: nextId ? 1 : 0.2 }}
              disabled={!nextId}
            >
              <Text style={styles.navArrow}>›</Text>
            </Pressable>
          </View>
          <Text style={styles.metaText}>
            {formatEntryMeta(entry.createdAt)}
          </Text>
          {entry.source === "walk" ? (
            <Text style={styles.walkMetaText}>{formatWalkMeta(entry)}</Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          {!editing ? (
            <Pressable hitSlop={10} onPress={handleEdit}>
              <Text style={styles.actionText}>Edit</Text>
            </Pressable>
          ) : null}
          <Pressable hitSlop={10} onPress={() => void handleDone()}>
            <Text style={styles.actionText}>
              {editing ? "Done" : "Close"}
            </Text>
          </Pressable>
        </View>
      </View>

      <PaperSheet
        style={styles.sheet}
        contentStyle={styles.sheetContent}
        lineGap={ENTRY_RULE_GAP}
        lineOffset={ENTRY_RULE_OFFSET}
      >
        {editing ? (
          <>
            <View style={styles.titleRow}>
              <Pressable
                onPress={() => {
                  emojiInputRef.current?.focus();
                }}
              >
                <TextInput
                  ref={emojiInputRef}
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
                  onFocus={() => {
                    emojiInputRef.current?.setSelection(
                      0,
                      titleEmoji.length || 0,
                    );
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="🌤️"
                  placeholderTextColor={colors.muted}
                  style={styles.emojiInput}
                />
              </Pressable>
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
              ref={bodyInputRef}
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
          </>
        ) : (
          <>
            <View style={styles.titleRow}>
              <Text style={styles.emojiDisplay}>
                {titleEmoji?.trim() || "🌤️"}
              </Text>
              <Text style={styles.titleDisplay}>
                {title || "Untitled"}
              </Text>
            </View>
            <Text style={styles.bodyDisplay}>
              {body || "No content yet."}
            </Text>
          </>
        )}
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

  return parts.join("  ·  ");
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
  headerActions: {
    flexDirection: "row",
    gap: 16,
    paddingTop: 4,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  navArrow: {
    color: colors.muted,
    fontSize: 22,
    lineHeight: 22,
    fontWeight: "300",
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
  actionText: {
    color: colors.text,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
  },
  sheet: {
    minHeight: 460,
    marginBottom: 16,
  },
  sheetContent: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 10,
  },
  emojiInput: {
    width: 42,
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    paddingVertical: 0,
    paddingHorizontal: 0,
    textAlign: "center",
  },
  emojiDisplay: {
    width: 42,
    fontSize: 16,
    lineHeight: 20,
    textAlign: "center",
  },
  titleInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "300",
    letterSpacing: -0.4,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  titleDisplay: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "300",
    letterSpacing: -0.4,
  },
  bodyInput: {
    minHeight: 360,
    color: colors.text,
    fontSize: 15,
    lineHeight: ENTRY_RULE_GAP,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  bodyDisplay: {
    color: colors.text,
    fontSize: 15,
    lineHeight: ENTRY_RULE_GAP,
  },
});
