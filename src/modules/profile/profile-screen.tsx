import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";

import { Panel, Screen, SectionLabel } from "../../components/ui";
import { listEntries } from "../journal/repository";
import type { EntryListItem } from "../journal/types";
import {
  buildInsightSnapshot,
  INSIGHT_TIMEFRAMES,
  type InsightSnapshot,
  type InsightTimeframe,
} from "../insights/analysis";
import {
  generateReflection,
  hasInsightsConfig,
  peekCachedReflection,
} from "../insights/openai";
import { colors, spacing } from "../../theme";

export default function ProfileScreen() {
  const db = useSQLiteContext();
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [timeframe, setTimeframe] = useState<InsightTimeframe>("30d");
  const [snapshot, setSnapshot] = useState<InsightSnapshot | null>(null);
  const [reflection, setReflection] = useState("");
  const [reflectionError, setReflectionError] = useState<string | null>(null);
  const [isRefreshingReflection, setIsRefreshingReflection] = useState(false);
  const aiReady = hasInsightsConfig();

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      void listEntries(db).then((loadedEntries) => {
        if (!isActive) {
          return;
        }

        setEntries(loadedEntries);
        setSnapshot(buildInsightSnapshot(loadedEntries, timeframe));

        if (aiReady && loadedEntries.length > 0) {
          const cachedReflection = peekCachedReflection(loadedEntries, timeframe);

          if (cachedReflection) {
            setReflectionError(null);
            setReflection(cachedReflection);
            setIsRefreshingReflection(false);
            return;
          }

          void loadReflection(loadedEntries, timeframe, () => isActive);
          return;
        }

        if (loadedEntries.length === 0) {
          setReflection("");
          setReflectionError(null);
        }
      });

      return () => {
        isActive = false;
      };
    }, [aiReady, db, timeframe]),
  );

  async function loadReflection(
    loadedEntries: EntryListItem[],
    nextTimeframe: InsightTimeframe,
    isActive = () => true,
  ) {
    const cachedReflection = peekCachedReflection(loadedEntries, nextTimeframe);

    if (cachedReflection) {
      setReflectionError(null);
      setReflection(cachedReflection);
      setIsRefreshingReflection(false);
      return;
    }

    setIsRefreshingReflection(true);
    setReflectionError(null);

    try {
      const nextReflection = await generateReflection(loadedEntries, nextTimeframe);

      if (!isActive()) {
        return;
      }

      setReflection(nextReflection);
    } catch (error) {
      if (!isActive()) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Could not load reflection.";
      setReflectionError(message);
      setReflection("");
    } finally {
      if (isActive()) {
        setIsRefreshingReflection(false);
      }
    }
  }

  return (
    <Screen scroll>
      <Panel style={styles.timeframePanel}>
        <Text style={styles.timeframeLabel}>Time Window</Text>
        <View style={styles.timeframeRow}>
          {INSIGHT_TIMEFRAMES.map((option) => (
            <Pressable
              key={option.id}
              style={[
                styles.timeframeChip,
                timeframe === option.id && styles.timeframeChipActive,
              ]}
              onPress={() => setTimeframe(option.id)}
            >
              <Text
                style={[
                  styles.timeframeChipText,
                  timeframe === option.id && styles.timeframeChipTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Panel>

      <Panel tone="soft">
        <Text style={styles.heroEyebrow}>Top Of Mind</Text>
        <Text style={styles.heroTitle}>
          {snapshot?.lead ?? "Reading your journal profile..."}
        </Text>
        {entries.length === 0 ? (
          <Text style={styles.heroBody}>
            Once you have entries, this profile can start showing what keeps coming up.
          </Text>
        ) : !aiReady ? (
          <Text style={styles.heroBody}>
            Add `EXPO_PUBLIC_OPENAI_API_KEY` to enable the reflection blurb here.
          </Text>
        ) : isRefreshingReflection ? (
          <Text style={styles.heroBody}>Reading this time window...</Text>
        ) : reflectionError ? (
          <Text style={styles.heroBody}>{reflectionError}</Text>
        ) : (
          <Text style={styles.heroBody}>{reflection}</Text>
        )}
      </Panel>

      <SectionLabel>Volume</SectionLabel>
      <View style={styles.metricGrid}>
        <MetricCard
          label="Entries"
          value={snapshot ? `${snapshot.activeEntryCount}` : "--"}
          note="In this window"
        />
        <MetricCard
          label="Walks"
          value={snapshot ? `${snapshot.walkCount}` : "--"}
          note="Voice captures"
        />
        <MetricCard
          label="Words"
          value={snapshot ? `${snapshot.totalWords}` : "--"}
          note="Journal volume"
        />
        <MetricCard
          label="Steps"
          value={snapshot ? `${snapshot.totalSteps}` : "--"}
          note="Tracked walks"
        />
      </View>

      <SectionLabel>Patterns</SectionLabel>
      <Panel style={styles.panel}>
        <PatternRow
          label="Average entry size"
          value={snapshot ? `${snapshot.averageWords} words` : "--"}
        />
        <PatternRow
          label="Most active day"
          value={snapshot?.strongestDay ?? "No data yet"}
        />
<PatternRow
          label="Strongest lenses"
          value={snapshot?.focusAreas.join(", ") || "No clear lens yet"}
        />
      </Panel>
    </Screen>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Panel style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricNote}>{note}</Text>
    </Panel>
  );
}

function PatternRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.patternRow}>
      <Text style={styles.patternLabel}>{label}</Text>
      <Text style={styles.patternValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  timeframePanel: {
    gap: spacing.sm,
  },
  timeframeLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  timeframeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  timeframeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  timeframeChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  timeframeChipText: {
    color: colors.text,
    fontSize: 13,
    fontFamily: "Courier",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  timeframeChipTextActive: {
    color: "#FFF8F2",
  },
  heroEyebrow: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  heroTitle: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "300",
    letterSpacing: -0.8,
  },
  heroBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricCard: {
    width: "48%",
    minWidth: 150,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  metricValue: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "300",
  },
  metricNote: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  panel: {
    gap: spacing.md,
  },
  patternRow: {
    gap: 4,
  },
  patternLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  patternValue: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 24,
  },
});
