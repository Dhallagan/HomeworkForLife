import { startTransition, useCallback, useState } from "react";
import {
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
import { listDailySummaries, listEntries } from "./repository";
import type { DailySummary, EntryListItem } from "./types";
import { colors } from "../../theme";

export default function EntriesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [days, setDays] = useState<DailySummary[]>([]);
  const [entriesByDay, setEntriesByDay] = useState<Record<string, EntryListItem[]>>({});

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

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.header}>
            <Text style={styles.title}>History</Text>
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {days.map((day, index) => (
            <View key={day.date}>
              {index > 0 ? <View style={styles.daySeparator} /> : null}
              <View style={styles.dayRow}>
                <View style={styles.dateGutter}>
                  <Text style={styles.dayDate}>{formatShortDate(day.date)}</Text>
                  <Text style={styles.dayWeekday}>{formatWeekday(day.date)}</Text>
                </View>

                {entriesByDay[day.date]?.length ? (
                  <View style={styles.entryList}>
                    {entriesByDay[day.date].map((entry) => (
                      <Pressable
                        key={entry.id}
                        onPress={() => router.push(`/entry/${entry.id}`)}
                        style={({ pressed }) => [styles.entryRow, pressed && styles.rowPressed]}
                      >
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
                      </Pressable>
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
  daySeparator: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.rule,
    alignSelf: "center",
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
