import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import {
  Panel,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionLabel,
} from "../../components/ui";
import {
  ensureRecordingPermissions,
  getRecordingPermissionStatus,
  openAppSettings,
} from "./permissions";
import {
  disconnectFitbitSource,
  getResolvedStepSource,
  getStepSourceSnapshot,
  getStepSourceLabel,
  getStepSourceStatus,
  isFitbitStepSourceConfigured,
  requestStepSourceAccess,
  useStepSource,
  type StepPermissionStatus,
  type StepSnapshot,
  type StepSource,
} from "../steps/service";
import { colors, layout, spacing } from "../../theme";

type RecordingPermissionStatus =
  | "granted"
  | "denied"
  | "undetermined"
  | "unavailable";

type SettingAction = {
  label: string;
  kind: "primary" | "secondary";
  onPress: () => void;
};

export default function SettingsScreen() {
  const [microphoneStatus, setMicrophoneStatus] =
    useState<RecordingPermissionStatus>("undetermined");
  const [healthStatus, setHealthStatus] =
    useState<StepPermissionStatus>("undetermined");
  const [fitbitStatus, setFitbitStatus] =
    useState<StepPermissionStatus>("undetermined");
  const [selectedStepSource, setSelectedStepSource] =
    useState<StepSource>("apple-health");
  const [healthPreviewSteps, setHealthPreviewSteps] = useState<number | null>(null);
  const [fitbitPreviewSteps, setFitbitPreviewSteps] = useState<number | null>(null);
  const [fitbitSyncStatus, setFitbitSyncStatus] =
    useState<StepSnapshot["syncStatus"]>("idle");
  const [fitbitSyncMessage, setFitbitSyncMessage] = useState<string | null>(null);
  const hasOpenAIKey = Boolean(process.env.EXPO_PUBLIC_OPENAI_API_KEY);
  const fitbitConfigured = isFitbitStepSourceConfigured();

  const loadPermissionState = useCallback(async () => {
    const [
      nextMicrophoneStatus,
      nextHealthStatus,
      nextFitbitStatus,
      nextSelectedStepSource,
    ] = await Promise.all([
      getRecordingPermissionStatus(),
      getStepSourceStatus("apple-health"),
      getStepSourceStatus("fitbit"),
      getResolvedStepSource(),
    ]);

    setMicrophoneStatus(nextMicrophoneStatus);
    setHealthStatus(nextHealthStatus);
    setFitbitStatus(nextFitbitStatus);
    setSelectedStepSource(nextSelectedStepSource);

    const [healthSnapshot, fitbitSnapshot] = await Promise.all([
      getStepSourceSnapshot("apple-health"),
      getStepSourceSnapshot("fitbit"),
    ]);

    setHealthPreviewSteps(
      healthSnapshot.permission === "granted" ? healthSnapshot.totalSteps : null,
    );
    setFitbitPreviewSteps(
      fitbitSnapshot.permission === "granted" ? fitbitSnapshot.totalSteps : null,
    );
    setFitbitSyncStatus(fitbitSnapshot.syncStatus);
    setFitbitSyncMessage(fitbitSnapshot.syncMessage ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPermissionState();
    }, [loadPermissionState]),
  );

  async function handleAllowMicrophone() {
    await ensureRecordingPermissions();
    await loadPermissionState();
  }

  async function handleAllowHealth() {
    await requestStepSourceAccess("apple-health");
    await loadPermissionState();
  }

  async function handleConnectFitbit() {
    await requestStepSourceAccess("fitbit");
    await loadPermissionState();
  }

  async function handleUseStepSource(source: StepSource) {
    await useStepSource(source);
    await loadPermissionState();
  }

  async function handleDisconnectFitbit() {
    await disconnectFitbitSource();
    await loadPermissionState();
  }

  function handleExplainFitbitSetup() {
    Alert.alert(
      "Fitbit Setup",
      "Restart the dev app if Fitbit still shows Setup. This build now includes your client ID and redirect URI.",
    );
  }

  return (
    <Screen scroll>
      <SectionLabel>Walk Access</SectionLabel>
      <Panel style={styles.groupPanel}>
        <SettingBlock
          eyebrow="Required"
          title="Microphone"
          tone={getPillTone(microphoneStatus)}
          status={formatPermissionLabel(microphoneStatus)}
          description="Required to record a walk. If access is denied, WalkLog returns you home instead of trying to start capture."
          note="Grant this once and the rest of your walk flow stays simple."
          actions={
            microphoneStatus === "undetermined"
              ? [
                  {
                    label: "Allow Microphone",
                    kind: "primary",
                    onPress: () => void handleAllowMicrophone(),
                  },
                ]
              : microphoneStatus === "denied"
                ? [
                    {
                      label: "Open iPhone Settings",
                      kind: "secondary",
                      onPress: () => void openAppSettings(),
                    },
                  ]
                : undefined
          }
        />
      </Panel>

      <SectionLabel>Step Data</SectionLabel>
      <Panel style={styles.groupPanel}>
        <SettingBlock
          eyebrow={selectedStepSource === "apple-health" ? "Selected" : "Available"}
          title="Apple Health"
          tone={getPillTone(healthStatus)}
          status={formatPermissionLabel(healthStatus)}
          description="Adds today&apos;s step count to Home and stores step totals with each saved walk."
          note={getAppleHealthNote(
            healthStatus,
            selectedStepSource,
            healthPreviewSteps,
          )}
          actions={
            healthStatus === "undetermined"
              ? [
                  {
                    label: "Allow Health Access",
                    kind: "primary",
                    onPress: () => void handleAllowHealth(),
                  },
                ]
              : healthStatus === "granted" &&
                  selectedStepSource === "apple-health"
                ? [
                    {
                      label: "Refresh Steps",
                      kind: "secondary",
                      onPress: () => void loadPermissionState(),
                    },
                    {
                      label: "Open iPhone Settings",
                      kind: "secondary",
                      onPress: () => void openAppSettings(),
                    },
                  ]
                : healthStatus === "granted" &&
                    selectedStepSource !== "apple-health"
                  ? [
                      {
                        label: `Use ${getStepSourceLabel("apple-health")}`,
                        kind: "secondary",
                        onPress: () => void handleUseStepSource("apple-health"),
                      },
                      {
                        label: "Refresh Steps",
                        kind: "secondary",
                        onPress: () => void loadPermissionState(),
                      },
                    ]
                  : [
                      {
                        label: "Open iPhone Settings",
                        kind: "secondary",
                        onPress: () => void openAppSettings(),
                      },
                    ]
          }
        />

        <View style={styles.divider} />

        <SettingBlock
          eyebrow={selectedStepSource === "fitbit" ? "Selected" : "Available"}
          title="Fitbit"
          tone={getFitbitTone(fitbitStatus, fitbitSyncStatus)}
          status={formatFitbitLabel(
            fitbitStatus,
            fitbitConfigured,
            fitbitSyncStatus,
          )}
          description="Uses your Fitbit account as the source for today&apos;s steps and saved walk totals."
          note={getFitbitNote(
            fitbitStatus,
            selectedStepSource,
            fitbitConfigured,
            fitbitPreviewSteps,
            fitbitSyncStatus,
            fitbitSyncMessage,
          )}
          actions={getFitbitActions({
            fitbitConfigured,
            fitbitStatus,
            selectedStepSource,
            onExplainSetup: () => handleExplainFitbitSetup(),
            onConnect: () => void handleConnectFitbit(),
            onDisconnect: () => void handleDisconnectFitbit(),
            onUseFitbit: () => void handleUseStepSource("fitbit"),
            onRefresh: () => void loadPermissionState(),
          })}
        />
      </Panel>

      <SectionLabel>Transcription</SectionLabel>
      <Panel style={styles.groupPanel}>
        <SettingBlock
          eyebrow="Prototype"
          title="OpenAI Whisper"
          tone={hasOpenAIKey ? "success" : "danger"}
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

function SettingBlock({
  eyebrow,
  title,
  tone,
  status,
  description,
  note,
  actions,
}: {
  eyebrow: string;
  title: string;
  tone: "default" | "success" | "danger";
  status: string;
  description: string;
  note?: string;
  actions?: SettingAction[];
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
      {actions?.length ? (
        <View style={styles.actionRow}>
          {actions.map((action) =>
            action.kind === "primary" ? (
              <PrimaryButton
                key={action.label}
                onPress={action.onPress}
                style={styles.actionButton}
              >
                {action.label}
              </PrimaryButton>
            ) : (
              <SecondaryButton
                key={action.label}
                onPress={action.onPress}
                style={styles.actionButton}
              >
                {action.label}
              </SecondaryButton>
            ),
          )}
        </View>
      ) : null}
    </View>
  );
}

function getPillTone(status: RecordingPermissionStatus | StepPermissionStatus) {
  if (status === "granted") {
    return "success" as const;
  }

  if (status === "denied" || status === "unavailable") {
    return "danger" as const;
  }

  return "default" as const;
}

function formatPermissionLabel(
  status: RecordingPermissionStatus | StepPermissionStatus,
) {
  if (status === "granted") {
    return "Ready";
  }

  if (status === "undetermined") {
    return "Ask";
  }

  if (status === "unavailable") {
    return "Unavailable";
  }

  return "Unknown";
}

function formatFitbitLabel(
  status: StepPermissionStatus,
  fitbitConfigured: boolean,
  syncStatus: StepSnapshot["syncStatus"],
) {
  if (!fitbitConfigured) {
    return "Setup";
  }

  if (status === "granted" && syncStatus === "error") {
    return "Sync Issue";
  }

  return formatPermissionLabel(status);
}

function getFitbitTone(
  status: StepPermissionStatus,
  syncStatus: StepSnapshot["syncStatus"],
) {
  if (status === "granted" && syncStatus === "error") {
    return "danger" as const;
  }

  return getPillTone(status);
}

function getAppleHealthNote(
  status: StepPermissionStatus,
  selectedStepSource: StepSource,
  previewSteps: number | null,
) {
  if (status === "unavailable") {
    return "Apple Health only works on supported Apple devices.";
  }

  if (selectedStepSource === "apple-health" && status === "granted") {
    if (previewSteps !== null) {
      return `Connected and selected. Apple Health reports ${previewSteps.toLocaleString()} steps today.`;
    }

    return "Currently used for Home and Walk steps. This is the fastest on-device option.";
  }

  if (status === "granted") {
    if (previewSteps !== null) {
      return `Connected. Apple Health reports ${previewSteps.toLocaleString()} steps today and is ready to use.`;
    }

    return "Ready to use if you want on-device, near real-time step updates.";
  }

  return "After you allow access once, manage step access in the Health app if totals stay at 0.";
}

function getFitbitNote(
  status: StepPermissionStatus,
  selectedStepSource: StepSource,
  fitbitConfigured: boolean,
  previewSteps: number | null,
  syncStatus: StepSnapshot["syncStatus"],
  syncMessage: string | null,
) {
  if (!fitbitConfigured) {
    return "Fitbit setup is bundled into this build. If Connect is still missing, refresh or restart the dev app once.";
  }

  if (status === "granted" && syncStatus === "error") {
    if (selectedStepSource === "fitbit") {
      return syncMessage
        ? `${syncMessage} Fitbit is still selected, but WalkLog will not show fresh steps until sync works again.`
        : "Fitbit is connected, but we couldn't sync steps just now. Open Fitbit to sync the device, then refresh here.";
    }

    return syncMessage
      ? `${syncMessage} Fitbit is connected, but step reads are failing right now.`
      : "Fitbit is connected, but we couldn't sync steps just now. Open Fitbit to sync the device, then refresh here.";
  }

  if (selectedStepSource === "fitbit" && status === "granted") {
    if (previewSteps !== null) {
      return `Connected and selected. Fitbit reports ${previewSteps.toLocaleString()} steps today. Sync can lag behind live walking.`;
    }

    return "Currently used for Home and Walk steps. Fitbit sync can lag behind live walking by a few minutes.";
  }

  if (status === "granted") {
    if (previewSteps !== null) {
      return `Connected. Fitbit reports ${previewSteps.toLocaleString()} steps today and is ready to use.`;
    }

    return "Connected and ready. Fitbit sync can lag behind live walking by a few minutes.";
  }

  if (status === "unavailable") {
    return "Fitbit login is unavailable in this environment.";
  }

  return "Connect your Fitbit account to pull steps from the Fitbit Web API.";
}

function getFitbitActions({
  fitbitConfigured,
  fitbitStatus,
  selectedStepSource,
  onExplainSetup,
  onConnect,
  onDisconnect,
  onUseFitbit,
  onRefresh,
}: {
  fitbitConfigured: boolean;
  fitbitStatus: StepPermissionStatus;
  selectedStepSource: StepSource;
  onExplainSetup: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onUseFitbit: () => void;
  onRefresh: () => void;
}) {
  if (!fitbitConfigured || fitbitStatus === "unavailable") {
    return [
      {
        label: "Refresh Setup",
        kind: "secondary" as const,
        onPress: onExplainSetup,
      },
    ];
  }

  if (fitbitStatus === "undetermined") {
    return [
      {
        label: "Connect Fitbit",
        kind: "primary" as const,
        onPress: onConnect,
      },
    ];
  }

  if (selectedStepSource === "fitbit") {
    return [
      {
        label: "Refresh Fitbit",
        kind: "secondary" as const,
        onPress: onRefresh,
      },
      {
        label: "Disconnect Fitbit",
        kind: "secondary" as const,
        onPress: onDisconnect,
      },
    ];
  }

  return [
    {
      label: "Use Fitbit",
      kind: "secondary" as const,
      onPress: onUseFitbit,
    },
    {
      label: "Refresh Fitbit",
      kind: "secondary" as const,
      onPress: onRefresh,
    },
  ];
}

const styles = StyleSheet.create({
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
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: 148,
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
