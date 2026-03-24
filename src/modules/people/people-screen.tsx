import { startTransition, useCallback, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  deletePerson,
  listPeople,
  mergePeople,
  updatePerson,
} from "../journal/repository";
import type { PersonListItem } from "../journal/types";
import { colors } from "../../theme";

export default function PeopleScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [people, setPeople] = useState<PersonListItem[]>([]);

  const loadPeople = useCallback(async () => {
    try {
      const loaded = await listPeople(db);
      startTransition(() => setPeople(loaded));
    } catch (error) {
      console.error("Failed to load people", error);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadPeople();
    }, [loadPeople]),
  );

  function handleLongPress(person: PersonListItem) {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Cancel", "Rename", "Merge with\u2026", "Delete"],
        destructiveButtonIndex: 3,
        cancelButtonIndex: 0,
        title: person.name,
      },
      (index) => {
        if (index === 1) handleRename(person);
        if (index === 2) handleMerge(person);
        if (index === 3) handleDelete(person);
      },
    );
  }

  function handleRename(person: PersonListItem) {
    Alert.prompt("Rename", `New name for "${person.name}":`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: async (newName?: string) => {
          if (newName?.trim()) {
            await updatePerson(db, person.id, { name: newName.trim() });
            void loadPeople();
          }
        },
      },
    ], "plain-text", person.name);
  }

  function handleMerge(source: PersonListItem) {
    const targets = people.filter((p) => p.id !== source.id);
    if (targets.length === 0) {
      Alert.alert("No other people to merge with.");
      return;
    }

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Cancel", ...targets.map((t) => `${t.emoji ?? ""} ${t.name}`.trim())],
        cancelButtonIndex: 0,
        title: `Merge "${source.name}" into\u2026`,
      },
      async (index) => {
        if (index === 0) return;
        const target = targets[index - 1];
        if (!target) return;

        Alert.alert(
          "Merge People",
          `"${source.name}" will be merged into "${target.name}". All entries will be combined.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Merge",
              style: "destructive",
              onPress: async () => {
                await mergePeople(db, source.id, target.id);
                void loadPeople();
              },
            },
          ],
        );
      },
    );
  }

  function handleDelete(person: PersonListItem) {
    Alert.alert(
      "Delete Person",
      `"${person.name}" will be removed. Journal entries are not affected.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deletePerson(db, person.id);
            void loadPeople();
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>People</Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {people.map((person) => (
            <Pressable
              key={person.id}
              style={({ pressed }) => [styles.personRow, pressed && styles.rowPressed]}
              onPress={() => router.push(`/person/${person.id}`)}
              onLongPress={() => handleLongPress(person)}
            >
              <Text style={styles.personEmoji}>
                {person.emoji?.trim() || "\u00b7"}
              </Text>
              <View style={styles.personContent}>
                <Text numberOfLines={1} style={styles.personName}>
                  {person.name}
                </Text>
                {person.summary ? (
                  <Text numberOfLines={1} style={styles.personSummary}>
                    {person.summary}
                  </Text>
                ) : null}
              </View>
              <View style={styles.personMeta}>
                <Text style={styles.personCount}>
                  {person.entryCount}
                </Text>
              </View>
            </Pressable>
          ))}

          {people.length === 0 ? (
            <Text style={styles.emptyText}>
              Your people will appear here as you journal.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
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
    paddingLeft: 18,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 6,
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
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    gap: 12,
  },
  rowPressed: {
    opacity: 0.82,
  },
  personEmoji: {
    fontSize: 20,
    width: 28,
    textAlign: "center",
  },
  personContent: {
    flex: 1,
    gap: 2,
  },
  personName: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "400",
    letterSpacing: -0.3,
  },
  personSummary: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 17,
  },
  personMeta: {
    alignItems: "flex-end",
  },
  personCount: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    paddingTop: 8,
  },
});
