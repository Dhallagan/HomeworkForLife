import { PropsWithChildren, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  colors,
  layout,
  radii,
  spacing,
  statusColors,
} from "../theme";

export function Screen({
  children,
  scroll = false,
  includeTopInset = false,
  style,
}: PropsWithChildren<{
  scroll?: boolean;
  includeTopInset?: boolean;
  style?: ViewStyle;
}>) {
  if (scroll) {
    return (
      <SafeAreaView
        style={styles.safeArea}
        edges={includeTopInset ? ["top", "left", "right", "bottom"] : ["left", "right", "bottom"]}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, style]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={includeTopInset ? ["top", "left", "right", "bottom"] : ["left", "right", "bottom"]}
    >
      <View style={[styles.content, style]}>{children}</View>
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  return <Panel style={style}>{children}</Panel>;
}

export function Panel({
  children,
  style,
  tone = "default",
}: PropsWithChildren<{
  style?: ViewStyle;
  tone?: "default" | "soft";
}>) {
  return (
    <View
      style={[
        styles.panel,
        tone === "soft" && styles.panelSoft,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  description,
  trailing,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.screenHeaderRow}>
      <View style={styles.screenHeader}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.screenTitle}>{title}</Text>
        {description ? <Text style={styles.screenDescription}>{description}</Text> : null}
      </View>
      {trailing ? <View style={styles.screenHeaderAside}>{trailing}</View> : null}
    </View>
  );
}

export function SectionLabel({ children }: PropsWithChildren) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function SectionTitle({ children }: PropsWithChildren) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function PrimaryButton({
  children,
  style,
  ...props
}: PropsWithChildren<PressableProps & { style?: ViewStyle }>) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      <Text style={styles.primaryButtonText}>{children}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  children,
  style,
  ...props
}: PropsWithChildren<PressableProps & { style?: ViewStyle }>) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.secondaryButton,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      <Text style={styles.secondaryButtonText}>{children}</Text>
    </Pressable>
  );
}

export function Pill({
  children,
  tone = "default",
}: PropsWithChildren<{ tone?: "default" | "success" | "danger" }>) {
  return (
    <View
      style={[
        styles.pill,
        tone === "success" && styles.pillSuccess,
        tone === "danger" && styles.pillDanger,
      ]}
    >
      <Text style={styles.pillText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: layout.screenTop,
    gap: layout.sectionGap,
  },
  scrollContent: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: layout.screenTop,
    paddingBottom: spacing.xxl,
    gap: layout.sectionGap,
  },
  panel: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: layout.panelPadding,
    gap: layout.panelGap,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  panelSoft: {
    backgroundColor: colors.accentSoft,
    borderColor: "#D3CDC1",
  },
  screenHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  screenHeader: {
    flex: 1,
    gap: spacing.xs,
  },
  screenHeaderAside: {
    paddingTop: spacing.xs,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  screenTitle: {
    fontSize: 30,
    lineHeight: 36,
    color: colors.text,
    fontWeight: "300",
    letterSpacing: -1.1,
  },
  screenDescription: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 540,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
    marginBottom: -4,
  },
  sectionTitle: {
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
    fontWeight: "300",
    letterSpacing: -0.7,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: "#FFF8F2",
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: 0.1,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: "600",
    fontSize: 14,
    letterSpacing: -0.2,
  },
  buttonPressed: {
    opacity: 0.84,
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    backgroundColor: statusColors.default.background,
    borderColor: statusColors.default.border,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillSuccess: {
    backgroundColor: statusColors.success.background,
    borderColor: statusColors.success.border,
  },
  pillDanger: {
    backgroundColor: statusColors.danger.background,
    borderColor: statusColors.danger.border,
  },
  pillText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
});
