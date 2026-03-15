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
  const stepsLabel = formatStepsLabel(stepPermission, todaySteps, stepSource);

  const handleOpenMenu = useCallback(() => {
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
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.header}>
            <Text style={styles.title}>Today</Text>
            <Text style={styles.dateText}>{todayLabel}</Text>
            <Text style={styles.stepsLabel}>{stepsLabel}</Text>
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

        {!hasLoadedOnce ? (
          <View style={styles.listWrap}>
            <PaperRow>
              <Text style={styles.emptyText}>Loading your notebook...</Text>
            </PaperRow>
          </View>
        ) : sections.length === 0 ? (
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
  permission: StepPermissionStatus,
  todaySteps: number | null,
  source: StepSource,
) {
  if (todaySteps === null) {
    return "Loading steps...";
  }

  if (permission === "granted") {
    return `${todaySteps.toLocaleString()} steps via ${source === "fitbit" ? "Fitbit" : "Health"}`;
  }

  if (permission === "unavailable") {
    return source === "fitbit" ? "Fitbit unavailable" : "Health unavailable";
  }

  return source === "fitbit" ? "Connect Fitbit for steps" : "Allow Health for steps";
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
