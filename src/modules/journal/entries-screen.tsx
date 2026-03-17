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
                <Text style={styles.dayLabel}>{formatDayLabel(day.date)}</Text>
                <Text style={styles.dayStats}>{formatSummaryStats(day)}</Text>
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
                  <Text style={styles.dayPreviewMuted}>No journal entries saved.</Text>
                )}
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

function formatSummaryStats(day: DailySummary) {
  const parts: string[] = [];

  if (day.entryCount > 0) {
    parts.push(day.entryCount === 1 ? "1 entry" : `${day.entryCount} entries`);
  }

  if (day.totalSteps !== null) {
    parts.push(`${day.totalSteps.toLocaleString()} steps`);
  } else if (day.walkSteps > 0) {
    parts.push(`${day.walkSteps.toLocaleString()} walk steps`);
  }

  if (parts.length === 0) {
    return "No entries or steps recorded.";
  }

  return parts.join("  |  ");
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
  dayLabel: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "300",
    letterSpacing: -0.4,
  },
  dayStats: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Courier",
  },
  entryList: {
    gap: 10,
    paddingTop: 2,
    paddingLeft: 14,
  },
  entryPreviewRow: {
    gap: 2,
  },
  entryTitle: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  dayPreview: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  dayPreviewMuted: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
});
