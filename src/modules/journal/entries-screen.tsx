import { startTransition, useCallback, useRef, useState } from "react";
import {
  Alert,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatLongDay } from "../../lib/date";
import { deleteEntry, listDailySummaries, listEntries } from "./repository";
import type { DailySummary, EntryListItem } from "./types";
import { colors } from "../../theme";

export default function EntriesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [days, setDays] = useState<DailySummary[]>([]);
  const [entriesByDay, setEntriesByDay] = useState<Record<string, EntryListItem[]>>({});
  const openRowRef = useRef<{ close: () => void } | null>(null);

  const loadDays = useCallback(async () => {
    try {
      const [loadedDays, loadedEntries] = await Promise.all([
        listDailySummaries(db),
        listEntries(db),
      ]);

      const nextEntriesByDay = groupEntriesByDay(loadedEntries);

      startTransition(() => {
        setDays(loadedDays);
        setEntriesByDay(nextEntriesByDay);
      });
    } catch (error) {
      console.error("Failed to load day history", error);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadDays();
    }, [loadDays]),
  );

  function handleRowOpen(handle: { close: () => void }) {
    openRowRef.current?.close();
    openRowRef.current = handle;
  }

  function handleDelete(entry: EntryListItem) {
    Alert.alert("Delete Entry", "This entry will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteEntry(db, entry.id);
          void loadDays();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.header}>
            <Text style={styles.title}>Logs</Text>
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {days.map((day, index) => (
            <View key={day.date}>
              {index > 0 ? <View style={styles.dayDivider} /> : null}
              <View style={styles.dayRow}>
                <View style={styles.dateGutter}>
                  <Text style={styles.dayDate}>{formatShortDate(day.date)}</Text>
                  <Text style={styles.dayWeekday}>{formatWeekday(day.date)}</Text>
                </View>

                {entriesByDay[day.date]?.length ? (
                  <View style={styles.entryList}>
                    {entriesByDay[day.date].map((entry) => (
                      <SwipeDeleteRow
                        key={entry.id}
                        onDelete={() => handleDelete(entry)}
                        onOpen={handleRowOpen}
                        onPress={() => router.push(`/entry/${entry.id}`)}
                      >
                        <View style={styles.entryRow}>
                          <Text style={styles.entryEmoji}>
                            {entry.titleEmoji?.trim() || "\u00b7"}
                          </Text>
                          <View style={styles.entryContent}>
                            <Text numberOfLines={1} style={styles.entryTitle}>
                              {entry.title}
                            </Text>
                            {entry.body.trim() ? (
                              <Text numberOfLines={1} style={styles.entryPreview}>
                                {entry.body.trim()}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      </SwipeDeleteRow>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.dayPreviewMuted}>No entries</Text>
                )}
              </View>
            </View>
          ))}

          {days.length === 0 ? (
            <Text style={styles.emptyText}>No history yet.</Text>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function formatDayLabel(dayKey: string) {
  const parsed = new Date(`${dayKey}T12:00:00`);
  return formatLongDay(parsed);
}

function formatShortDate(dayKey: string) {
  const [year, month, day] = dayKey.split("-");

  if (!year || !month || !day) {
    return dayKey;
  }

  return `${Number(month)}/${Number(day)}`;
}

function formatWeekday(dayKey: string) {
  const label = formatDayLabel(dayKey);
  return label.split(",")[0] ?? label;
}

const SWIPE_ACTION_WIDTH = 80;
const SWIPE_OPEN_THRESHOLD = SWIPE_ACTION_WIDTH * 0.45;

function SwipeDeleteRow({
  children,
  onDelete,
  onOpen,
  onPress,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  onOpen: (handle: { close: () => void }) => void;
  onPress: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);
  const isOpenRef = useRef(false);
  const suppressUntilRef = useRef(0);

  const suppress = () => {
    suppressUntilRef.current = Date.now() + 200;
  };

  const animateTo = (toValue: number) => {
    offsetRef.current = toValue;
    isOpenRef.current = toValue !== 0;
    Animated.spring(translateX, {
      toValue,
      useNativeDriver: true,
      bounciness: 0,
      speed: 22,
    }).start();
  };

  const closeRow = () => {
    suppress();
    animateTo(0);
  };

  const openRow = () => {
    suppress();
    onOpen({ close: closeRow });
    animateTo(-SWIPE_ACTION_WIDTH);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => {
        const hTravel = Math.abs(gs.dx);
        if (hTravel < 8 || hTravel <= Math.abs(gs.dy) * 1.2) return false;
        return gs.dx < 0 || isOpenRef.current;
      },
      onPanResponderGrant: () => {
        translateX.stopAnimation((v) => {
          offsetRef.current = v;
        });
      },
      onPanResponderMove: (_, gs) => {
        suppress();
        translateX.setValue(
          Math.min(0, Math.max(-SWIPE_ACTION_WIDTH, offsetRef.current + gs.dx)),
        );
      },
      onPanResponderRelease: (_, gs) => {
        const proj = offsetRef.current + gs.dx;
        if (gs.vx < -0.35 || proj <= -SWIPE_OPEN_THRESHOLD) {
          openRow();
        } else {
          closeRow();
        }
      },
      onPanResponderTerminate: () => closeRow(),
    }),
  ).current;

  return (
    <View style={swipeStyles.container}>
      <View style={swipeStyles.actionWrap}>
        <Pressable
          style={({ pressed }) => [
            swipeStyles.deleteBtn,
            pressed && swipeStyles.deleteBtnPressed,
          ]}
          onPress={() => {
            closeRow();
            onDelete();
          }}
        >
          <Text style={swipeStyles.deleteText}>Delete</Text>
        </Pressable>
      </View>
      <Animated.View
        style={[swipeStyles.rowForeground, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={() => {
            if (isOpenRef.current) {
              closeRow();
              return;
            }
            if (Date.now() < suppressUntilRef.current) return;
            onPress();
          }}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const swipeStyles = StyleSheet.create({
  container: {
    overflow: "hidden",
    backgroundColor: colors.background,
  },
  actionWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "flex-end",
  },
  deleteBtn: {
    width: SWIPE_ACTION_WIDTH,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#C94D3F",
  },
  deleteBtnPressed: {
    backgroundColor: "#B64235",
  },
  deleteText: {
    color: "#FFF8F2",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  rowForeground: {
    backgroundColor: colors.background,
  },
});

function groupEntriesByDay(entries: EntryListItem[]) {
  const grouped: Record<string, EntryListItem[]> = {};

  for (const entry of entries) {
    const dayKey = entry.createdAt.toISOString().slice(0, 10);

    if (!grouped[dayKey]) {
      grouped[dayKey] = [];
    }

    grouped[dayKey].push(entry);
  }

  return grouped;
}


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  header: {
    flex: 1,
    paddingLeft: 18,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "300",
    letterSpacing: -1.2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 18,
    gap: 22,
  },
  rowPressed: {
    opacity: 0.82,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  dayDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.rule,
    marginBottom: 4,
  },
  dateGutter: {
    width: 52,
    alignItems: "flex-end",
    paddingTop: 2,
    gap: 1,
  },
  dayDate: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "right",
  },
  dayWeekday: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 0.8,
    fontFamily: "Courier",
    textTransform: "uppercase",
    textAlign: "right",
  },
  entryList: {
    flex: 1,
    gap: 12,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  entryEmoji: {
    fontSize: 16,
    lineHeight: 22,
    width: 24,
    textAlign: "center",
    color: colors.muted,
  },
  entryContent: {
    flex: 1,
    gap: 2,
  },
  entryTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "300",
    letterSpacing: -0.4,
  },
  entryPreview: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 17,
  },
  dayPreviewMuted: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    paddingLeft: 34,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
});
