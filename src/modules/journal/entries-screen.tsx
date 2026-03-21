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

import { PaperRow } from "../../components/notebook";
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
          {days.map((day) => (
            <Pressable
              key={day.date}
              onPress={() => router.push(`/day/${day.date}`)}
              style={({ pressed }) => [pressed && styles.rowPressed]}
            >
              <PaperRow style={styles.dayRow}>
                <View style={styles.dayLedgerRow}>
                  <View style={styles.dayColumn}>
                    <Text style={styles.dayDate}>{formatShortDate(day.date)}</Text>
                    <Text style={styles.dayWeekday}>{formatWeekday(day.date)}</Text>
                  </View>

                  <View style={styles.dayDivider} />

                  {entriesByDay[day.date]?.length ? (
                    <View style={styles.entryList}>
                      {entriesByDay[day.date].map((entry) => (
                        <View key={entry.id} style={styles.entryPreviewRow}>
                          <Text numberOfLines={1} style={styles.entryTitle}>
                            {formatEntryTitle(entry)}
                          </Text>
                          {entry.body.trim() ? (
                            <Text numberOfLines={2} style={styles.dayPreview}>
                              {entry.body.trim()}
                            </Text>
                          ) : (
                            <Text style={styles.dayPreviewMuted}>Empty entry</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.entryList}>
                      <Text style={styles.dayPreviewMuted}>No journal entries saved.</Text>
                    </View>
                  )}
                </View>
              </PaperRow>
            </Pressable>
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

function formatEntryTitle(entry: EntryListItem) {
  const emoji = entry.titleEmoji?.trim();

  if (emoji) {
    return `${emoji} ${entry.title}`;
  }

  return entry.title;
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
    paddingTop: 4,
    paddingBottom: 18,
  },
  rowPressed: {
    opacity: 0.82,
  },
  dayRow: {
    backgroundColor: colors.background,
  },
  dayLedgerRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  dayColumn: {
    width: 56,
    alignItems: "flex-end",
    paddingTop: 2,
    gap: 1,
  },
  dayDate: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 15,
    fontWeight: "700",
    textAlign: "right",
  },
  dayWeekday: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 14,
    textAlign: "right",
  },
  dayDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: colors.rule,
  },
  entryList: {
    flex: 1,
    gap: 8,
    paddingTop: 1,
  },
  entryPreviewRow: {
    gap: 1,
  },
  entryTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  dayPreview: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 15,
  },
  dayPreviewMuted: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
});
