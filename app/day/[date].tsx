import { useEffect, useLayoutEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import { PaperRow } from "../../src/components/notebook";
import { formatEntryTime, formatLongDay } from "../../src/lib/date";
import { listEntriesForDay, listDailySummaries } from "../../src/modules/journal/repository";
import type { DailySummary, EntryListItem } from "../../src/modules/journal/types";
import { colors } from "../../src/theme";

export default function DayDetailScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const navigation = useNavigation();
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [entries, setEntries] = useState<EntryListItem[]>([]);

  useEffect(() => {
    if (!date) {
      return;
    }

    void loadDay(date);
  }, [date]);

  async function loadDay(dayKey: string) {
    const [dailySummaries, dayEntries] = await Promise.all([
      listDailySummaries(db),
      listEntriesForDay(db, dayKey),
    ]);

    setSummary(dailySummaries.find((item) => item.date === dayKey) ?? null);
    setEntries(dayEntries);
  }

  const dayDate = parseDayKey(date);
  const title = dayDate ? formatLongDay(dayDate) : "Day";

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title,
    });
  }, [navigation, title]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          {summary ? (
            <Text style={styles.subtitle}>
              {formatDayStats(summary)}
            </Text>
          ) : null}
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {entries.map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => router.push(`/entry/${entry.id}`)}
              style={({ pressed }) => [pressed && styles.rowPressed]}
            >
              <PaperRow style={styles.entryRow}>
                <Text numberOfLines={1} style={styles.entryTitle}>
                  {formatEntryTitle(entry)}
                </Text>
                <Text numberOfLines={3} style={styles.entryBody}>
                  {entry.body.trim() || "Empty entry"}
                </Text>
                <Text style={styles.entryMeta}>{formatEntryTime(entry.createdAt)}</Text>
              </PaperRow>
            </Pressable>
          ))}

          {entries.length === 0 ? (
            <Text style={styles.emptyText}>No entries for this day.</Text>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function parseDayKey(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDayStats(summary: DailySummary) {
  const parts = [];

  if (summary.entryCount > 0) {
    parts.push(summary.entryCount === 1 ? "1 entry" : `${summary.entryCount} entries`);
  }

  if (summary.totalSteps !== null) {
    parts.push(`${summary.totalSteps.toLocaleString()} steps`);
  }

  return parts.join("  |  ");
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
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 4,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 18,
  },
  entryRow: {
    backgroundColor: colors.background,
  },
  rowPressed: {
    opacity: 0.8,
  },
  entryTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
    paddingRight: 18,
    paddingBottom: 2,
  },
  entryBody: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 24,
    paddingRight: 18,
  },
  entryMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Courier",
    paddingTop: 8,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
});
