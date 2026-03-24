import { startTransition, useCallback, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import { PaperRecordButton } from "../../components/notebook";
import { formatLongDay } from "../../lib/date";
import {
  backfillMissingTitles,
  backfillPeople,
  generateDailyHomeCards,
  generatePersonSummary,
  hasInsightsConfig,
  peekCachedDailyHomeCards,
  type DailyHomeCards,
} from "../insights/openai";
import {
  getEntriesForPerson,
  getEntriesNeedingPeopleExtraction,
  getExistingPeopleContext,
  linkPeopleToEntry,
  listEntries,
  listPeople,
  updateEntry,
  updatePerson,
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

type HomeScreenMemoryState = {
  entries: EntryListItem[];
  todaySteps: number | null;
  stepPermission: StepPermissionStatus;
  stepSource: StepSource;
  hasLoadedOnce: boolean;
  dailyHomeCards: DailyHomeCards | null;
};

type TodayOverview = {
  journalValue: string;
  journalDetail: string;
  latestEntryRoute?: Href;
  stepsValue: string;
  stepsDetail: string;
};

type HomeCard =
  | {
      kind: "attention";
      body: string;
    }
  | {
      kind: "daily";
      thinkingAbout: string;
      whatSeemsTrue: string;
      closeTheDay?: string | null;
    };

const initialMemoryState: HomeScreenMemoryState = {
  entries: [],
  todaySteps: null,
  stepPermission: "undetermined",
  stepSource: "apple-health",
  hasLoadedOnce: false,
  dailyHomeCards: null,
};

let homeScreenMemoryState: HomeScreenMemoryState = initialMemoryState;

export default function HomeScreen({
  onNavigateEntries: _onNavigateEntries,
  onNavigateInsights: _onNavigateInsights,
}: {
  onNavigateEntries: () => void;
  onNavigateInsights: () => void;
}) {
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
  const [dailyHomeCards, setDailyHomeCards] = useState<DailyHomeCards | null>(
    homeScreenMemoryState.dailyHomeCards,
  );
  const todayLabel = formatLongDay(new Date());
  const aiReady = hasInsightsConfig();

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

      const todayEntries = nextEntries.filter(
        (entry) => isSameCalendarDay(entry.createdAt, new Date()) && isJournalEntryComplete(entry),
      );
      const cachedDailyCards =
        aiReady && todayEntries.length > 0 ? peekCachedDailyHomeCards(todayEntries) : null;

      startTransition(() => {
        setDailyHomeCards(cachedDailyCards ?? null);
      });

      homeScreenMemoryState = {
        entries: nextEntries,
        todaySteps: stepSnapshot.totalSteps,
        stepPermission: stepSnapshot.permission,
        stepSource: stepSnapshot.source,
        hasLoadedOnce: true,
        dailyHomeCards: cachedDailyCards ?? null,
      };

      if (stepSnapshot.permission === "granted") {
        void upsertDailySteps(db, makeDailyStepsRecord(stepSnapshot.totalSteps));
      }

      if (aiReady && todayEntries.length > 0) {
        void loadDailyHomeCards(todayEntries);
      }

      backfillMissingTitles(nextEntries, (entryId, title, emoji) => {
        void updateEntry(db, entryId, {
          title,
          titleEmoji: emoji,
          body: nextEntries.find((e) => e.id === entryId)?.body ?? "",
        });
      });

      if (aiReady) {
        void runPeopleBackfill();
      }
    } catch (error) {
      console.error("Failed to load Home", error);
      startTransition(() => {
        setHasLoadedOnce(true);
      });
    }
  }, [aiReady, db]);

  const loadDailyHomeCards = useCallback(async (todayEntries: EntryListItem[]) => {
    try {
      const nextDailyHomeCards = await generateDailyHomeCards(todayEntries);

      startTransition(() => {
        setDailyHomeCards(nextDailyHomeCards);
      });

      homeScreenMemoryState = {
        ...homeScreenMemoryState,
        dailyHomeCards: nextDailyHomeCards,
      };
    } catch (error) {
      console.error("Failed to load daily home cards", error);
    }
  }, []);

  const runPeopleBackfill = useCallback(async () => {
    try {
      const needsExtraction = await getEntriesNeedingPeopleExtraction(db);
      if (needsExtraction.length === 0) return;

      backfillPeople(
        needsExtraction,
        () => getExistingPeopleContext(db),
        async (entryId, extracted) => {
          if (extracted.length > 0) {
            await linkPeopleToEntry(db, entryId, extracted);
          }
        },
        async () => {
          try {
            const allPeople = await listPeople(db);
            for (const person of allPeople) {
              if (!person.summary) {
                const entries = await getEntriesForPerson(db, person.id);
                const result = await generatePersonSummary(person.name, person.aliases, entries);
                if (result) {
                  await updatePerson(db, person.id, {
                    summary: result.summary,
                    emoji: result.emoji,
                  });
                }
              }
            }
          } catch (error) {
            console.error("People summary generation failed", error);
          }
        },
      );
    } catch (error) {
      console.error("People backfill failed", error);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadHome();
    }, [loadHome]),
  );

  const todayOverview = useMemo(
    () =>
      buildTodayOverview({
        entries,
        hasLoadedOnce,
        permission: stepPermission,
        source: stepSource,
        todaySteps,
      }),
    [entries, hasLoadedOnce, stepPermission, stepSource, todaySteps],
  );
  const homeCards = useMemo(
    () => buildHomeCards(entries, stepPermission, dailyHomeCards, aiReady),
    [aiReady, dailyHomeCards, entries, stepPermission],
  );

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

        <ScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            disabled={!todayOverview.latestEntryRoute}
            onPress={handleOpenLatestEntry}
            style={({ pressed }) => [
              styles.statusLine,
              pressed && todayOverview.latestEntryRoute && styles.statusLinePressed,
            ]}
          >
            <Text style={styles.statusText}>
              {todayOverview.journalDetail}
              {todayOverview.stepsValue !== "--" && todayOverview.stepsValue !== "Off" && todayOverview.stepsValue !== "N/A"
                ? `  ·  ${todayOverview.stepsValue} steps`
                : ""}
            </Text>
          </Pressable>

          <View style={styles.cardsStack}>
            {homeCards.map((card) => (
              card.kind === "attention" ? (
                <Pressable
                  key={card.body}
                  onPress={() => router.push("/settings")}
                  style={({ pressed }) => [styles.homeCard, styles.homeCardAlert, pressed && styles.homeCardAlertPressed]}
                >
                  <Text style={styles.homeCardBody}>{card.body}</Text>
                  <Text style={styles.homeCardAction}>Settings →</Text>
                </Pressable>
              ) : (
                <View key={card.thinkingAbout} style={styles.homeCard}>
                  <Text style={styles.homeCardLabel}>Top Of Mind</Text>
                  <Text style={styles.homeCardBody}>{card.thinkingAbout}</Text>
                  {card.whatSeemsTrue && card.whatSeemsTrue !== card.thinkingAbout ? (
                    <Text style={styles.homeCardBody}>{card.whatSeemsTrue}</Text>
                  ) : null}
                  {card.closeTheDay ? (
                    <Text style={styles.homeCardBodyMuted}>{card.closeTheDay}</Text>
                  ) : null}
                </View>
              )
            ))}
          </View>
        </ScrollView>

        <View style={styles.bottomDock}>
          <View style={styles.bottomDockRule} />
          <PaperRecordButton label="Start Walk" onPress={() => router.push("/walk")} />
        </View>
      </View>
    </SafeAreaView>
  );
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

function buildHomeCards(
  entries: EntryListItem[],
  stepPermission: StepPermissionStatus,
  dailyHomeCards: DailyHomeCards | null,
  aiReady: boolean,
): HomeCard[] {
  const todayEntries = entries.filter((entry) => isSameCalendarDay(entry.createdAt, new Date()));
  const todayCompleteEntries = todayEntries.filter((entry) => isJournalEntryComplete(entry));
  const unfinishedEntry = entries.find(
    (entry) => isSameCalendarDay(entry.createdAt, new Date()) && !isJournalEntryComplete(entry),
  );
  const cards: HomeCard[] = [];

  if (unfinishedEntry) {
    cards.push({
      kind: "attention",
      body: "You left one entry unfinished today.",
    });
  } else if (stepPermission !== "granted") {
    cards.push({
      kind: "attention",
      body: "Turn tracking on if you want your walks counted.",
    });
  }

  cards.push(buildDailyCard(todayCompleteEntries, dailyHomeCards, aiReady));

  return cards;
}

function buildDailyCard(
  entries: EntryListItem[],
  dailyHomeCards: DailyHomeCards | null,
  aiReady: boolean,
): HomeCard {
  return {
    kind: "daily",
    thinkingAbout: buildThinkingAbout(entries, dailyHomeCards, aiReady),
    whatSeemsTrue: buildWhatSeemsTrue(entries, dailyHomeCards, aiReady),
    closeTheDay: buildCloseTheDay(dailyHomeCards, aiReady),
  };
}

function buildThinkingAbout(
  entries: EntryListItem[],
  dailyHomeCards: DailyHomeCards | null,
  aiReady: boolean,
) {
  if (entries.length === 0) {
    return "Nothing logged today yet.";
  }

  if (aiReady && dailyHomeCards?.thinkingAbout) {
    return dailyHomeCards.thinkingAbout;
  }

  const wordCount = entries.reduce((sum, entry) => sum + countWords(entry.body), 0);
  const walkCount = entries.filter((entry) => entry.source === "walk").length;
  const parts = [entries.length === 1 ? "1 entry" : `${entries.length} entries`];

  if (wordCount > 0) {
    parts.push(`${wordCount} words`);
  }

  if (walkCount > 0) {
    parts.push(walkCount === 1 ? "1 walk" : `${walkCount} walks`);
  }

  return parts.join(", ") + ".";
}

function buildWhatSeemsTrue(
  entries: EntryListItem[],
  dailyHomeCards: DailyHomeCards | null,
  aiReady: boolean,
) {
  if (entries.length === 0) {
    return "The day has not taken shape on the page yet.";
  }

  if (aiReady && dailyHomeCards?.whatSeemsTrue) {
    return dailyHomeCards.whatSeemsTrue;
  }

  return "A fuller pattern should emerge once there is more written today.";
}

function buildCloseTheDay(
  dailyHomeCards: DailyHomeCards | null,
  aiReady: boolean,
): string | undefined {
  if (!aiReady) {
    return undefined;
  }

  return dailyHomeCards?.closeTheDay ?? undefined;
}

function countWords(body: string) {
  return tokenize(body).length;
}

function tokenize(body: string) {
  return body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3);
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
  bodyScroll: {
    flex: 1,
  },
  bodyContent: {
    paddingTop: 2,
    paddingBottom: 12,
    gap: 16,
  },
  statusLine: {
    paddingHorizontal: 18,
    paddingVertical: 4,
  },
  statusLinePressed: {
    opacity: 0.6,
  },
  statusText: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1.2,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  cardsStack: {
    paddingHorizontal: 18,
    gap: 10,
  },
  homeCard: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  homeCardAlert: {
    backgroundColor: colors.surface,
  },
  homeCardAlertPressed: {
    opacity: 0.7,
  },
  homeCardAction: {
    alignSelf: "flex-end",
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
    marginTop: 2,
  },
  homeCardLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  homeCardBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  homeCardBodyMuted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: "italic",
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
