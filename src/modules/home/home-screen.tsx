import { startTransition, useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  EntrySwipeRow,
  type EntrySwipeRowHandle,
} from "../../components/entry-swipe-row";
import { PaperRecordButton, PaperRow } from "../../components/notebook";
import { formatLongDay } from "../../lib/date";
import {
  deleteEntry,
  listEntries,
  upsertDailySteps,
} from "../journal/repository";
import type { EntryListItem } from "../journal/types";
import {
  getTodayStepSnapshot,
  makeDailyStepsRecord,
  type HealthPermissionStatus,
} from "../steps/health";
import { colors } from "../../theme";

type EntrySection = {
  title: string;
  data: EntryListItem[];
};

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [todaySteps, setTodaySteps] = useState<number | null>(null);
  const [stepPermission, setStepPermission] =
    useState<HealthPermissionStatus>("undetermined");
  const openSwipeableRef = useRef<EntrySwipeRowHandle | null>(null);

  const loadHome = useCallback(async () => {
    const [nextEntries, stepSnapshot] = await Promise.all([
      listEntries(db),
      getTodayStepSnapshot(),
    ]);

    startTransition(() => {
      setEntries(nextEntries);
      setTodaySteps(stepSnapshot.totalSteps);
      setStepPermission(stepSnapshot.permission);
    });

    if (stepSnapshot.permission === "granted") {
      void upsertDailySteps(db, makeDailyStepsRecord(stepSnapshot.totalSteps));
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadHome();

      return () => {
        openSwipeableRef.current?.close();
        openSwipeableRef.current = null;
      };
    }, [loadHome]),
  );

  const handleRowOpen = useCallback((nextSwipeable: EntrySwipeRowHandle) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== nextSwipeable) {
      openSwipeableRef.current.close();
    }

    openSwipeableRef.current = nextSwipeable;
  }, []);

  const handleDelete = useCallback(
    async (entryId: string) => {
      openSwipeableRef.current?.close();
      openSwipeableRef.current = null;

      startTransition(() => {
        setEntries((currentEntries) =>
          currentEntries.filter((entry) => entry.id !== entryId),
        );
      });

      try {
        await deleteEntry(db, entryId);
      } catch (error) {
        console.error("Failed to delete entry", error);
        Alert.alert("Couldn't delete entry", "Please try again.");
        await loadHome();
      }
    },
    [db, loadHome],
  );

  const sections = useMemo(() => groupEntriesByDay(entries), [entries]);
  const todayLabel = formatLongDay(new Date());
  const stepsLabel = formatStepsLabel(stepPermission, todaySteps);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.header}>
            <Text style={styles.title}>Today</Text>
            <Text style={styles.dateText}>{todayLabel}</Text>
            <Text style={styles.stepsLabel}>{stepsLabel}</Text>
          </View>
          <Pressable hitSlop={10} onPress={() => router.push("/settings")}>
            <Text style={styles.settingsText}>Settings</Text>
          </Pressable>
        </View>

        {sections.length === 0 ? (
          <View style={styles.listWrap}>
            <PaperRow>
              <Text style={styles.emptyText}>No entry yet.</Text>
            </PaperRow>
          </View>
        ) : (
          <SectionList
            style={styles.list}
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.listContent}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionTitle}>
                {section.title === todayLabel ? "Today" : section.title}
              </Text>
            )}
            renderItem={({ item }) => (
              <EntrySwipeRow
                entry={item}
                onOpen={handleRowOpen}
                onDelete={() => void handleDelete(item.id)}
                onPress={() => router.push(`/entry/${item.id}`)}
              />
            )}
            SectionSeparatorComponent={() => <View style={styles.sectionGap} />}
          />
        )}

        <View style={styles.bottomAction}>
          <PaperRecordButton label="Start Walk" onPress={() => router.push("/walk")} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function groupEntriesByDay(entries: EntryListItem[]): EntrySection[] {
  const sections = new Map<string, EntryListItem[]>();

  for (const entry of entries) {
    const key = formatLongDay(entry.createdAt);
    const nextGroup = sections.get(key) ?? [];
    nextGroup.push(entry);
    sections.set(key, nextGroup);
  }

  return Array.from(sections.entries()).map(([title, data]) => ({
    title,
    data,
  }));
}

function formatStepsLabel(
  permission: HealthPermissionStatus,
  todaySteps: number | null,
) {
  if (todaySteps === null) {
    return "Loading steps...";
  }

  if (permission === "granted") {
    return `${todaySteps.toLocaleString()} steps`;
  }

  if (permission === "denied") {
    return "Health access off";
  }

  if (permission === "unavailable") {
    return "Health unavailable";
  }

  return "Allow Health for steps";
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
    gap: 16,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 4,
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "300",
    letterSpacing: -1.2,
  },
  dateText: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "300",
    letterSpacing: -0.6,
  },
  stepsLabel: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 1,
    fontFamily: "Courier",
  },
  settingsText: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    paddingTop: 18,
    paddingRight: 18,
    textTransform: "uppercase",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingTop: 2,
    paddingBottom: 12,
  },
  listWrap: {
    flex: 1,
    paddingTop: 2,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: 0.8,
    fontFamily: "Courier",
    paddingHorizontal: 18,
    paddingBottom: 4,
  },
  sectionGap: {
    height: 12,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
  },
  bottomAction: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: colors.background,
  },
});
