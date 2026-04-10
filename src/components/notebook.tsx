import { PropsWithChildren, useMemo, type ReactNode } from "react";
import { tapHeavy } from "../lib/haptics";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useTheme, useThemeColors } from "../theme";

type ColorTokens = ReturnType<typeof useTheme>["colors"];

function useNotebookStyles() {
  const { colors } = useThemeColors();
  return useMemo(() => createStyles(colors), [colors]);
}

type PaperSheetProps = PropsWithChildren<{
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  lineCount?: number;
  lineGap?: number;
  lineOffset?: number;
}>;

export function PaperSheet({
  children,
  style,
  contentStyle,
  lineCount = 13,
  lineGap = 32,
  lineOffset = 36,
}: PaperSheetProps) {
  const styles = useNotebookStyles();
  return (
    <View style={[styles.sheet, style]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: lineCount }, (_, index) => {
          const top = lineOffset + index * lineGap;

          return (
            <View key={top} style={[styles.sheetRule, { top }]} />
          );
        })}
      </View>
      <View style={[styles.sheetContent, contentStyle]}>{children}</View>
    </View>
  );
}

export function PaperRow({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  const styles = useNotebookStyles();
  return (
    <View style={[styles.row, style]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.rowRule} />
      </View>
      <View style={styles.rowContent}>{children}</View>
    </View>
  );
}

export function PaperTabBar({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  const styles = useNotebookStyles();
  return <View style={[styles.tabBar, style]}>{children}</View>;
}

export function PaperActionBar({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  const styles = useNotebookStyles();
  return <View style={[styles.actionBar, style]}>{children}</View>;
}

export function PaperActionButton({
  children,
  style,
  textStyle,
  ...props
}: PropsWithChildren<
  PressableProps & {
    style?: ViewStyle;
    textStyle?: TextStyle;
  }
>) {
  const styles = useNotebookStyles();
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.actionButton,
        pressed && styles.tabPressed,
        style,
      ]}
    >
      <Text style={[styles.actionButtonText, textStyle]}>{children}</Text>
    </Pressable>
  );
}

export function PaperRecordButton({
  label,
  mode = "record",
  style,
  leadingAccessory,
  trailingAccessory,
  disabled,
  ...props
}: PressableProps & {
  label: string;
  mode?: "record" | "stop";
  style?: ViewStyle;
  leadingAccessory?: ReactNode;
  trailingAccessory?: ReactNode;
}) {
  const styles = useNotebookStyles();
  return (
    <Pressable
      {...props}
      disabled={disabled}
      onPressIn={() => { if (!disabled) tapHeavy(); }}
      style={({ pressed }) => [
        styles.recordButton,
        pressed && !disabled && styles.tabPressed,
        disabled && styles.recordButtonDisabled,
        style,
      ]}
    >
      <View style={styles.recordTopRow}>
        <View style={styles.recordAccessorySlot}>{leadingAccessory}</View>
        <View style={[styles.recordOuter, mode === "stop" && styles.recordOuterStop]}>
          <View
            style={[
              styles.recordInner,
              mode === "stop" ? styles.recordInnerStop : styles.recordInnerRecord,
            ]}
          />
        </View>
        <View style={styles.recordAccessorySlot}>{trailingAccessory}</View>
      </View>
      <Text style={styles.recordLabel}>{label}</Text>
    </Pressable>
  );
}

export function PaperTab({
  children,
  active = false,
  tone = "default",
  style,
  textStyle,
  ...props
}: PropsWithChildren<
  PressableProps & {
    active?: boolean;
    tone?: "default" | "primary";
    style?: ViewStyle;
    textStyle?: TextStyle;
  }
>) {
  const styles = useNotebookStyles();
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.tab,
        active && styles.tabActive,
        tone === "primary" && styles.tabPrimary,
        pressed && styles.tabPressed,
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={[
          styles.tabText,
          active && styles.tabTextActive,
          tone === "primary" && styles.tabTextPrimary,
          textStyle,
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
  sheet: {
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  sheetContent: {
    paddingLeft: 22,
    paddingRight: 18,
    paddingTop: 16,
    paddingBottom: 18,
  },
  sheetRule: {
    position: "absolute",
    left: 18,
    right: 18,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.rule,
  },
  row: {
    minHeight: 74,
    justifyContent: "center",
  },
  rowContent: {
    paddingLeft: 18,
    paddingRight: 18,
    paddingTop: 8,
    paddingBottom: 14,
  },
  rowRule: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.rule,
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingLeft: 14,
    paddingRight: 14,
    paddingTop: 10,
    paddingBottom: 14,
  },
  actionBar: {
    paddingLeft: 18,
    paddingRight: 18,
    paddingTop: 10,
    paddingBottom: 14,
  },
  tab: {
    minHeight: 52,
    minWidth: 0,
    flexShrink: 1,
    paddingHorizontal: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: -1 },
  },
  tabActive: {
    backgroundColor: colors.card,
  },
  tabPrimary: {
    backgroundColor: colors.accentSoft,
    borderColor: "#D3CDC1",
  },
  tabPressed: {
    opacity: 0.82,
  },
  tabText: {
    color: colors.muted,
    fontSize: 14,
    letterSpacing: 0.6,
    fontFamily: "Courier",
  },
  tabTextActive: {
    color: colors.text,
  },
  tabTextPrimary: {
    color: colors.text,
    fontWeight: "600",
    letterSpacing: 0.2,
    fontFamily: undefined,
  },
  actionButton: {
    minHeight: 56,
    borderRadius: 24,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D8D1C4",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  actionButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  recordButton: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  recordTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  recordAccessorySlot: {
    width: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  recordButtonDisabled: {
    opacity: 0.55,
  },
  recordOuter: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  recordOuterStop: {
    borderColor: colors.danger,
  },
  recordInner: {
    backgroundColor: colors.accent,
  },
  recordInnerRecord: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.record,
  },
  recordInnerStop: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.danger,
  },
  recordLabel: {
    color: colors.text,
    fontSize: 12,
    letterSpacing: 1,
    fontFamily: "Courier",
  },
});
}
