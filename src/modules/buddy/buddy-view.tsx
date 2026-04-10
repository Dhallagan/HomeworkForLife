import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme, useThemeColors } from "../../theme";
import {
  STAGE_ART,
  STAGE_LABELS,
  type BuddyState,
} from "./state";

export function BuddyView({ buddy }: { buddy: BuddyState }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const art = STAGE_ART[buddy.kind][buddy.stage];
  const stageLabel = STAGE_LABELS[buddy.kind][buddy.stage];
  const isDead = buddy.mood === "dead";

  return (
    <View style={styles.container}>
      <View style={[styles.artContainer, isDead && styles.artDead]}>
        <Text style={styles.art}>{art}</Text>
      </View>

      {buddy.speech ? (
        <View style={styles.speechBubble}>
          <Text style={styles.speechText}>{buddy.speech}</Text>
        </View>
      ) : null}

      <View style={styles.barsContainer}>
        <BarRow label="Steps" value={buddy.stepsBar} color="#7BAE6E" colors={colors} />
        <BarRow label="Journal" value={buddy.journalBar} color="#6B9BD2" colors={colors} />
        <BarRow label="Tasks" value={buddy.tasksBar} color="#D4A057" colors={colors} />
      </View>

      <Text style={styles.meta}>
        {isDead
          ? "Your buddy faded away. Tap Reset in Settings to start over."
          : `Day ${buddy.streak} · ${stageLabel}`}
      </Text>
    </View>
  );
}

function BarRow({
  label,
  value,
  color,
  colors,
}: {
  label: string;
  value: number;
  color: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View style={barStyles.row}>
      <Text style={[barStyles.label, { color: colors.muted }]}>{label}</Text>
      <View style={[barStyles.track, { backgroundColor: colors.surface }]}>
        <View
          style={[
            barStyles.fill,
            {
              backgroundColor: color,
              width: `${Math.min(100, Math.max(0, value))}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

type ColorTokens = ReturnType<typeof useTheme>["colors"];

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    container: {
      marginHorizontal: 18,
      padding: 20,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      gap: 16,
    },
    artContainer: {
      paddingVertical: 12,
    },
    artDead: {
      opacity: 0.25,
    },
    art: {
      fontSize: 32,
      textAlign: "center",
      lineHeight: 40,
    },
    speechBubble: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      maxWidth: "80%",
    },
    speechText: {
      color: colors.text,
      fontSize: 14,
      fontStyle: "italic",
      textAlign: "center",
    },
    barsContainer: {
      alignSelf: "stretch",
      gap: 8,
    },
    meta: {
      color: colors.muted,
      fontSize: 12,
      letterSpacing: 0.3,
    },
  });
}

const barStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    width: 52,
    fontSize: 12,
    fontWeight: "500",
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 3,
  },
});
