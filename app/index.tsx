import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  EntrySwipeRow,
  type EntrySwipeRowHandle,
} from "../src/components/entry-swipe-row";
import {
  PaperRecordButton,
  PaperRow,
} from "../src/components/notebook";
import {
  formatLongDay,
} from "../src/lib/date";
import {
  deleteEntry,
  listEntries,
} from "../src/modules/journal/repository";
import type { EntryListItem } from "../src/modules/journal/types";
import { colors } from "../src/theme";

const MOCK_TODAY_STEPS = 8426;

type EntrySection = {
  title: string;
  data: EntryListItem[];
};

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const openSwipeableRef = useRef<EntrySwipeRowHandle | null>(null);

  const loadEntries = useCallback(async () => {
    const nextEntries = await listEntries(db);
    setEntries(nextEntries);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadEntries();

      return () => {
        openSwipeableRef.current?.close();
        openSwipeableRef.current = null;
      };
    }, [loadEntries]),
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

      setEntries((currentEntries) =>
        currentEntries.filter((entry) => entry.id !== entryId),
      );

      try {
        await deleteEntry(db, entryId);
      } catch (error) {
        console.error("Failed to delete entry", error);
        Alert.alert("Couldn't delete entry", "Please try again.");
        await loadEntries();
      }
    },
    [db, loadEntries],
  );

  const sections = useMemo(() => groupEntriesByDay(entries), [entries]);
  const todayLabel = formatLongDay(new Date());

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Today</Text>
          <Text style={styles.dateText}>{todayLabel}</Text>
          <Text style={styles.stepsLabel}>{MOCK_TODAY_STEPS.toLocaleString()} steps</Text>
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
