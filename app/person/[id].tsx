import { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatCompactDate } from "../../src/lib/date";
import {
  getEntriesForPerson,
  getPersonById,
} from "../../src/modules/journal/repository";
import type { EntryListItem, PersonListItem } from "../../src/modules/journal/types";
import { colors } from "../../src/theme";

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const [person, setPerson] = useState<PersonListItem | null>(null);
  const [entries, setEntries] = useState<EntryListItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;

      void (async () => {
        const [loadedPerson, loadedEntries] = await Promise.all([
          getPersonById(db, id),
          getEntriesForPerson(db, id),
        ]);
        setPerson(loadedPerson);
        setEntries(loadedEntries);
      })();
    }, [db, id]),
  );

  if (!person) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backButton}>{"\u2190"}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>
            {person.emoji ? `${person.emoji} ` : ""}
            {person.name}
          </Text>
          <View style={styles.backButton} />
        </View>

        {person.summary ? (
          <Text style={styles.summary}>{person.summary}</Text>
        ) : null}

        <Text style={styles.stats}>
          {formatShortDate(person.firstSeenAt)} {"\u2013"}{" "}
          {formatShortDate(person.lastSeenAt)} {"\u00b7"}{" "}
          {person.entryCount} {person.entryCount === 1 ? "entry" : "entries"}
        </Text>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {entries.map((entry) => (
            <Pressable
              key={entry.id}
              style={({ pressed }) => [
                styles.entryRow,
                pressed && styles.rowPressed,
              ]}
              onPress={() => router.push(`/entry/${entry.id}`)}
            >
              <Text style={styles.entryDate}>
                {formatCompactDate(entry.createdAt)}
              </Text>
              <View style={styles.entryContent}>
                <Text numberOfLines={1} style={styles.entryTitle}>
                  {entry.titleEmoji ? `${entry.titleEmoji} ` : ""}
                  {entry.title}
                </Text>
                {entry.body.trim() ? (
                  <Text numberOfLines={2} style={styles.entryPreview}>
                    {entry.body.trim()}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}

          {entries.length === 0 ? (
            <Text style={styles.emptyText}>
              No entries found for {person.name}.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function formatShortDate(isoDate: string) {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 4,
  },
  backButton: {
    fontSize: 22,
    color: colors.text,
    width: 28,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "300",
    letterSpacing: -0.6,
    textAlign: "center",
    flex: 1,
  },
  summary: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingBottom: 4,
  },
  stats: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingBottom: 12,
    letterSpacing: 0.2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    gap: 12,
  },
  rowPressed: {
    opacity: 0.82,
  },
  entryDate: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
    width: 70,
    paddingTop: 3,
  },
  entryContent: {
    flex: 1,
    gap: 3,
  },
  entryTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "300",
    letterSpacing: -0.3,
  },
  entryPreview: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 17,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    paddingTop: 12,
  },
});
