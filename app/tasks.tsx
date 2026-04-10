import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";
import { success as hapticSuccess, warning as hapticWarning } from "../src/lib/haptics";

import {
  completeTask,
  listAllTasks,
  listOpenTasks,
  skipTask,
  type TaskRow,
} from "../src/modules/journal/repository";
import { useTheme, useThemeColors } from "../src/theme";

type Tab = "open" | "done";

export default function TasksScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [activeTab, setActiveTab] = useState<Tab>("open");
  const [openTasks, setOpenTasks] = useState<TaskRow[]>([]);
  const [completedTasks, setCompletedTasks] = useState<TaskRow[]>([]);

  const loadTasks = useCallback(async () => {
    const [open, all] = await Promise.all([
      listOpenTasks(db),
      listAllTasks(db),
    ]);
    setOpenTasks(open);
    setCompletedTasks(all.filter((t) => t.status !== "open"));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadTasks();
    }, [loadTasks]),
  );

  const visibleTasks = activeTab === "open" ? openTasks : completedTasks;

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.tabs}>
          <Pressable
            onPress={() => setActiveTab("open")}
            style={[styles.tab, activeTab === "open" && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === "open" && styles.tabTextActive]}>
              Open ({openTasks.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("done")}
            style={[styles.tab, activeTab === "done" && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === "done" && styles.tabTextActive]}>
              Done ({completedTasks.length})
            </Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {visibleTasks.map((task) => (
            <View key={task.id} style={styles.taskCard}>
              <View style={styles.taskContent}>
                <Text
                  style={[
                    styles.taskTitle,
                    task.status !== "open" && styles.taskTitleDone,
                  ]}
                >
                  {task.title}
                </Text>
                {task.timeframe ? (
                  <Text style={styles.taskTimeframe}>{task.timeframe}</Text>
                ) : null}
              </View>
              {task.status === "open" ? (
                <View style={styles.taskActions}>
                  <Pressable
                    onPress={async () => {
                      hapticSuccess();
                      await completeTask(db, task.id);
                      void loadTasks();
                    }}
                    style={({ pressed }) => [
                      styles.taskButton,
                      styles.taskButtonDone,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text style={styles.taskButtonDoneText}>{"\u2713"}</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      hapticWarning();
                      await skipTask(db, task.id);
                      void loadTasks();
                    }}
                    style={({ pressed }) => [
                      styles.taskButton,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text style={styles.taskButtonSkipText}>{"\u2717"}</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.taskStatus}>
                  {task.status === "done" ? "\u2713" : "\u2717"}
                </Text>
              )}
            </View>
          ))}

          {visibleTasks.length === 0 ? (
            <Text style={styles.emptyText}>
              {activeTab === "open"
                ? "No open tasks. Journal about what you want to do."
                : "No completed tasks yet."}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

type ColorTokens = ReturnType<typeof useTheme>["colors"];

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
    },
    tabs: {
      flexDirection: "row",
      paddingHorizontal: 18,
      paddingBottom: 12,
      gap: 12,
    },
    tab: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    tabActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    tabText: {
      color: colors.muted,
      fontSize: 14,
      fontWeight: "500",
    },
    tabTextActive: {
      color: "#FFF8F2",
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 18,
      paddingBottom: 24,
      gap: 8,
    },
    taskCard: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 16,
      paddingRight: 8,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 12,
    },
    taskContent: {
      flex: 1,
      gap: 2,
    },
    taskTitle: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
    },
    taskTitleDone: {
      color: colors.muted,
      textDecorationLine: "line-through",
    },
    taskTimeframe: {
      color: colors.muted,
      fontSize: 13,
    },
    taskActions: {
      flexDirection: "row",
      gap: 6,
    },
    taskButton: {
      width: 36,
      height: 36,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    taskButtonDone: {
      backgroundColor: colors.accentSoft,
    },
    taskButtonDoneText: {
      color: colors.success,
      fontSize: 16,
      fontWeight: "600",
    },
    taskButtonSkipText: {
      color: colors.muted,
      fontSize: 14,
    },
    taskStatus: {
      color: colors.muted,
      fontSize: 16,
      paddingRight: 12,
    },
    emptyText: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 22,
      paddingTop: 24,
      textAlign: "center",
    },
  });
}
