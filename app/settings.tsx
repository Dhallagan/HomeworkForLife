import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import {
  Panel,
  Pill,
  PrimaryButton,
  Screen,
  ScreenHeader,
  SecondaryButton,
  SectionLabel,
} from "../src/components/ui";
import {
  ensureRecordingPermissions,
  getRecordingPermissionStatus,
  openAppSettings,
} from "../src/modules/settings/permissions";
import {
  getHealthPermissionStatus,
  requestHealthPermission,
  type HealthPermissionStatus,
} from "../src/modules/steps/health";
import { colors, layout, spacing } from "../src/theme";

type RecordingPermissionStatus =
  | "granted"
  | "denied"
  | "undetermined"
  | "unavailable";

export default function SettingsScreen() {
  const [microphoneStatus, setMicrophoneStatus] =
    useState<RecordingPermissionStatus>("undetermined");
  const [healthStatus, setHealthStatus] =
    useState<HealthPermissionStatus>("undetermined");
  const hasOpenAIKey = Boolean(process.env.EXPO_PUBLIC_OPENAI_API_KEY);

  const loadPermissionState = useCallback(async () => {
    const [nextMicrophoneStatus, nextHealthStatus] = await Promise.all([
      getRecordingPermissionStatus(),
      getHealthPermissionStatus(),
    ]);

    setMicrophoneStatus(nextMicrophoneStatus);
    setHealthStatus(nextHealthStatus);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPermissionState();
    }, [loadPermissionState]),
  );

  const microphoneTone = getPillTone(microphoneStatus);
  const healthTone = getPillTone(healthStatus);
  const whisperTone = hasOpenAIKey ? "success" : "danger";

  async function handleAllowMicrophone() {
    await ensureRecordingPermissions();
    await loadPermissionState();
  }

  async function handleAllowHealth() {
    await requestHealthPermission();
    await loadPermissionState();
  }

  return (
    <Screen scroll>
      <ScreenHeader
        eyebrow="Control Room"
        title="Settings"
        description="Treat this screen like a quick preflight. Microphone powers recording, Health adds steps, and Whisper turns audio into text."
      />

      <Panel tone="soft" style={styles.heroPanel}>
        <Text style={styles.heroEyebrow}>Current Readiness</Text>
        <Text style={styles.heroTitle}>
          {getSetupHeadline(microphoneStatus, healthStatus, hasOpenAIKey)}
        </Text>
        <Text style={styles.heroBody}>
          Keep the setup compact: one required permission, one optional data source,
          one transcription service.
        </Text>

        <View style={styles.summaryGrid}>
          <SummaryChip
            label="Mic"
            tone={microphoneTone}
            value={formatPermissionLabel(microphoneStatus)}
          />
          <SummaryChip
            label="Health"
            tone={healthTone}
            value={formatPermissionLabel(healthStatus)}
          />
          <SummaryChip
            label="Whisper"
            tone={whisperTone}
            value={hasOpenAIKey ? "Ready" : "Missing"}
          />
        </View>
      </Panel>

      <SectionLabel>Permissions</SectionLabel>
      <Panel style={styles.groupPanel}>
        <SettingBlock
          eyebrow="Required"
          title="Microphone"
          tone={microphoneTone}
          status={formatPermissionLabel(microphoneStatus)}
          description="Required to record a walk. If access is denied, WalkLog returns you home instead of trying to start capture."
          note="Grant this once and the rest of the recording flow stays simple."
          action={
            microphoneStatus === "undetermined"
              ? {
                  label: "Allow Microphone",
                  kind: "primary",
                  onPress: () => void handleAllowMicrophone(),
                }
              : microphoneStatus === "denied"
                ? {
                    label: "Open Settings",
                    kind: "secondary",
                    onPress: () => void openAppSettings(),
                  }
                : undefined
          }
        />

        <View style={styles.divider} />

        <SettingBlock
          eyebrow="Optional"
          title="Apple Health"
          tone={healthTone}
          status={formatPermissionLabel(healthStatus)}
          description="Adds today&apos;s step count to Home and stores step totals with each saved walk."
          note="Useful on-device, but the app should still feel complete without it."
          action={
            healthStatus === "undetermined"
              ? {
                  label: "Allow Health Access",
                  kind: "primary",
                  onPress: () => void handleAllowHealth(),
                }
              : healthStatus === "denied"
                ? {
                    label: "Open Settings",
                    kind: "secondary",
                    onPress: () => void openAppSettings(),
                  }
                : undefined
          }
        />
      </Panel>

      <SectionLabel>Services</SectionLabel>
      <Panel style={styles.groupPanel}>
        <SettingBlock
          eyebrow="Prototype"
          title="OpenAI Whisper"
          tone={whisperTone}
          status={hasOpenAIKey ? "Ready" : "Missing"}
          description="Audio uploads when you end a walk so Whisper can return a transcript for the saved entry."
          note={
            hasOpenAIKey
              ? "This build includes EXPO_PUBLIC_OPENAI_API_KEY."
              : "Set EXPO_PUBLIC_OPENAI_API_KEY before running the app on a device."
          }
        />
      </Panel>
    </Screen>
  );
}

type SettingAction = {
  label: string;
  kind: "primary" | "secondary";
  onPress: () => void;
};

function SummaryChip({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "default" | "success" | "danger";
  value: string;
}) {
  return (
    <View style={styles.summaryChip}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Pill tone={tone}>{value}</Pill>
    </View>
  );
}

function SettingBlock({
  eyebrow,
  title,
  tone,
  status,
  description,
  note,
  action,
}: {
  eyebrow: string;
  title: string;
  tone: "default" | "success" | "danger";
  status: string;
  description: string;
  note?: string;
  action?: SettingAction;
}) {
  return (
    <View style={styles.settingBlock}>
      <Text style={styles.blockEyebrow}>{eyebrow}</Text>
      <View style={styles.permissionHeader}>
        <Text style={styles.permissionTitle}>{title}</Text>
        <Pill tone={tone}>{status}</Pill>
      </View>
      <Text style={styles.permissionBody}>{description}</Text>
      {note ? <Text style={styles.permissionNote}>{note}</Text> : null}
      {action?.kind === "primary" ? (
        <PrimaryButton onPress={action.onPress}>{action.label}</PrimaryButton>
      ) : null}
      {action?.kind === "secondary" ? (
        <SecondaryButton onPress={action.onPress}>{action.label}</SecondaryButton>
      ) : null}
    </View>
  );
}

function getPillTone(status: RecordingPermissionStatus | HealthPermissionStatus) {
  if (status === "granted") {
    return "success" as const;
  }

  if (status === "denied" || status === "unavailable") {
    return "danger" as const;
  }

  return "default" as const;
}

function formatPermissionLabel(
  status: RecordingPermissionStatus | HealthPermissionStatus,
) {
  if (status === "granted") {
    return "Ready";
  }

  if (status === "undetermined") {
    return "Ask";
  }

  if (status === "denied") {
    return "Blocked";
  }

  if (status === "unavailable") {
    return "Unavailable";
  }

  return "Unknown";
}

function getSetupHeadline(
  microphoneStatus: RecordingPermissionStatus,
  healthStatus: HealthPermissionStatus,
  hasOpenAIKey: boolean,
) {
  if (
    microphoneStatus === "granted" &&
    healthStatus === "granted" &&
    hasOpenAIKey
  ) {
    return "Everything is lined up for a complete walk log.";
  }

  if (microphoneStatus === "granted" && hasOpenAIKey) {
    return "Recording is ready. Health is the only optional missing piece.";
  }

  if (microphoneStatus === "denied") {
    return "Microphone still needs attention before the next walk.";
  }

  if (!hasOpenAIKey) {
    return "Recording can work, but transcription still needs a key.";
  }

  return "Finish setup once, then leave this screen alone.";
}

const styles = StyleSheet.create({
  heroPanel: {
    gap: spacing.md,
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
    letterSpacing: -0.6,
  },
  heroBody: {
    color: colors.muted,
    lineHeight: 22,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryChip: {
    minWidth: 104,
    gap: spacing.xxs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 0.9,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  groupPanel: {
    gap: 0,
    paddingVertical: layout.panelPadding,
    paddingHorizontal: 0,
  },
  settingBlock: {
    gap: spacing.sm,
    paddingHorizontal: layout.panelPadding,
  },
  permissionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  permissionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "300",
    letterSpacing: -0.45,
    flex: 1,
  },
  permissionBody: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  permissionNote: {
    color: colors.muted,
    lineHeight: 21,
  },
  blockEyebrow: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.rule,
    marginVertical: spacing.md,
    marginHorizontal: layout.panelPadding,
  },
});
