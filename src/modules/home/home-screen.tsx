import { startTransition, useCallback, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
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
  type StepPermissionStatus,
  type StepSource,
} from "../steps/service";
import { colors } from "../../theme";

type EntrySection = {
  title: string;
  data: EntryListItem[];
};

type HomeScreenMemoryState = {
  entries: EntryListItem[];
  todaySteps: number | null;
  stepPermission: StepPermissionStatus;
  stepSource: StepSource;
  hasLoadedOnce: boolean;
};

type TodayOverview = {
  journalValue: string;
  journalDetail: string;
  latestEntryRoute?: Href;
  stepsValue: string;
  stepsDetail: string;
};

const initialMemoryState: HomeScreenMemoryState = {
  entries: [],
  todaySteps: null,
  stepPermission: "undetermined",
  stepSource: "apple-health",
  hasLoadedOnce: false,
};

let homeScreenMemoryState: HomeScreenMemoryState = initialMemoryState;

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [entries, setEntries] = useState<EntryListItem[]>(homeScreenMemoryState.entries);
  const [todaySteps, setTodaySteps] = useState<number | null>(
    homeScreenMemoryState.todaySteps,
  );
  const [stepPermission, setStepPermission] = useState<StepPermissionStatus>(
    homeScreenMemoryState.stepPermission,
  );
  const [stepSource, setStepSource] = useState<StepSource>(homeScreenMemoryState.stepSource);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(homeScreenMemoryState.hasLoadedOnce);
  const openSwipeableRef = useRef<EntrySwipeRowHandle | null>(null);

  const loadHome = useCallback(async () => {
    try {
      const [nextEntries, stepSnapshot] = await Promise.all([
        listEntries(db),
        getTodayStepSnapshot(),
      ]);

      startTransition(() => {
        setEntries(nextEntries);
        setTodaySteps(stepSnapshot.totalSteps);
        setStepPermission(stepSnapshot.permission);
        setStepSource(stepSnapshot.source);
        setHasLoadedOnce(true);
      });

      homeScreenMemoryState = {
        entries: nextEntries,
        todaySteps: stepSnapshot.totalSteps,
        stepPermission: stepSnapshot.permission,
        stepSource: stepSnapshot.source,
        hasLoadedOnce: true,
      };

      if (stepSnapshot.permission === "granted") {
        void upsertDailySteps(db, makeDailyStepsRecord(stepSnapshot.totalSteps));
      }
    } catch (error) {
      console.error("Failed to load Home", error);
      startTransition(() => {
        setHasLoadedOnce(true);
      });
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
        setEntries((currentEntries) => {
          const nextEntries = currentEntries.filter((entry) => entry.id !== entryId);
          homeScreenMemoryState = {
            ...homeScreenMemoryState,
            entries: nextEntries,
          };
          return nextEntries;
        });
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
  const todayOverview = useMemo(
    () =>
      buildTodayOverview({
        entries,
        hasLoadedOnce,
        permission: stepPermission,
        source: stepSource,
        todaySteps,
      }),
    [
      entries,
      hasLoadedOnce,
      stepPermission,
      stepSource,
      todaySteps,
    ],
  );

  const handleOpenMenu = useCallback(() => {
    const actions = [
      { label: "Profile", onPress: () => router.push("/profile") },
      { label: "Control Center", onPress: () => router.push("/settings") },
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

  const handleOpenLatestEntry = useCallback(() => {
    if (!todayOverview.latestEntryRoute) {
      return;
    }

    router.push(todayOverview.latestEntryRoute);
  }, [router, todayOverview.latestEntryRoute]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.header}>
            <Text style={styles.title}>Today</Text>
            <Text style={styles.dateText}>{todayLabel}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More options"
            hitSlop={10}
            onPress={handleOpenMenu}
            style={({ pressed }) => [
              styles.menuButton,
              pressed && styles.menuButtonPressed,
            ]}
          >
            <Text style={styles.menuButtonText}>...</Text>
          </Pressable>
        </View>

        <SectionList
          style={styles.list}
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <View style={styles.summaryRow}>
                <Pressable
                  accessibilityRole={todayOverview.latestEntryRoute ? "button" : undefined}
                  disabled={!todayOverview.latestEntryRoute}
                  onPress={handleOpenLatestEntry}
                  style={({ pressed }) => [
                    styles.summaryCard,
                    styles.summaryCardLeft,
                    pressed && todayOverview.latestEntryRoute && styles.summaryCardPressed,
                  ]}
                >
                  <Text style={styles.summaryLabel}>Journal</Text>
                  <Text style={styles.summaryValue}>{todayOverview.journalValue}</Text>
                  <Text style={styles.summaryDetail}>{todayOverview.journalDetail}</Text>
                </Pressable>

                <View style={styles.summaryDivider} />

                <View style={[styles.summaryCard, styles.summaryCardRight]}>
                  <Text style={styles.summaryLabel}>Steps</Text>
                  <Text style={styles.summaryValue}>{todayOverview.stepsValue}</Text>
                  <Text style={styles.summaryDetail}>{todayOverview.stepsDetail}</Text>
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.listEmptyWrap}>
              <PaperRow>
                <Text style={styles.emptyText}>No entries yet.</Text>
              </PaperRow>
            </View>
          }
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

        <View style={styles.bottomDock}>
          <View style={styles.bottomDockRule} />
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

function buildTodayOverview({
  entries,
  hasLoadedOnce,
  permission,
  source,
  todaySteps,
}: {
  entries: EntryListItem[];
  hasLoadedOnce: boolean;
  permission: StepPermissionStatus;
  source: StepSource;
  todaySteps: number | null;
}): TodayOverview {
  const sourceLabel = source === "fitbit" ? "Fitbit" : "Apple Health";
  const todayJournalCount = countTodayJournalEntries(entries);
  const latestTodayEntry = findLatestTodayJournalEntry(entries);
  const stepsGranted = permission === "granted";
  const stepValue = todaySteps === null ? "--" : todaySteps.toLocaleString();

  if (!hasLoadedOnce && todaySteps === null) {
    return {
      journalValue: "--",
      journalDetail: "Loading",
      stepsValue: "--",
      stepsDetail: "Loading",
    };
  }

  const journalValue = todayJournalCount > 0 ? "Done" : "Open";
  const journalDetail =
    todayJournalCount === 0
      ? "No entry today"
      : todayJournalCount === 1
        ? "1 entry today"
        : `${todayJournalCount} entries today`;

  const stepsValue = stepsGranted
    ? stepValue
    : permission === "unavailable"
      ? "N/A"
      : "Off";

  const stepsDetail = stepsGranted
    ? sourceLabel
    : permission === "unavailable"
      ? `${sourceLabel} unavailable`
      : `${sourceLabel} off`;

  return {
    journalValue,
    journalDetail,
    latestEntryRoute: latestTodayEntry ? (`/entry/${latestTodayEntry.id}` as Href) : undefined,
    stepsValue,
    stepsDetail,
  };
}

function countTodayJournalEntries(entries: EntryListItem[]) {
  const today = new Date();
  let count = 0;

  for (const entry of entries) {
    if (!isSameCalendarDay(entry.createdAt, today)) {
      continue;
    }

    if (isJournalEntryComplete(entry)) {
      count += 1;
    }
  }

  return count;
}

function findLatestTodayJournalEntry(entries: EntryListItem[]) {
  const today = new Date();

  for (const entry of entries) {
    if (!isSameCalendarDay(entry.createdAt, today)) {
      continue;
    }

    if (isJournalEntryComplete(entry)) {
      return entry;
    }
  }

  return null;
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isJournalEntryComplete(entry: EntryListItem) {
  if (entry.source === "walk") {
    return true;
  }

  return entry.body.trim().length > 0;
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
  dateText: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "300",
    letterSpacing: -0.6,
  },
  menuButton: {
    minWidth: 42,
    height: 42,
    marginTop: 14,
    marginRight: 18,
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
    marginTop: -6,
    letterSpacing: 1.2,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingTop: 2,
    paddingBottom: 8,
  },
  listHeader: {
    paddingHorizontal: 18,
    paddingBottom: 6,
    gap: 8,
  },
  summaryRow: {
    flexDirection: "row",
    minHeight: 122,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  summaryCard: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 6,
  },
  summaryCardLeft: {
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
  },
  summaryCardRight: {
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
  },
  summaryCardPressed: {
    backgroundColor: colors.accentSoft,
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.rule,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1.2,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "300",
    letterSpacing: -0.6,
  },
  summaryDetail: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  listEmptyWrap: {
    paddingHorizontal: 18,
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
    height: 10,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
  },
  bottomDock: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 2,
    paddingBottom: 16,
    backgroundColor: colors.background,
    gap: 8,
  },
  bottomDockRule: {
    alignSelf: "stretch",
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 18,
    backgroundColor: colors.rule,
  },
});
