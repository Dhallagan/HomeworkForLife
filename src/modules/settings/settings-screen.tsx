import { useCallback, useMemo, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useSQLiteContext } from "expo-sqlite";

import { Screen } from "../../components/ui";
import { checkApiHealth, hasApiConfig } from "../../lib/api";
import {
  loadBuddyState,
  saveBuddyState,
  getDefaultState,
  KIND_LABELS,
  type BuddyKind,
  type BuddyState,
} from "../buddy/state";
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  type NotificationPermissionStatus,
} from "../notifications/scheduler";
import { useTheme, useThemeColors, type ThemeMode } from "../../theme";

type ColorTokens = ReturnType<typeof useTheme>["colors"];
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
import { formatEntryTitle } from "../../lib/date";
import { generateEntryTitle } from "../insights/openai";
import {
  buildJournalExport,
  listEntries,
  updateEntryTitle,
} from "../journal/repository";
import type { EntryListItem } from "../journal/types";
import { layout, spacing } from "../../theme";

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

const THEME_KEY = "walklog-theme-mode";
const THEME_LABELS: Record<ThemeMode, string> = {
  system: "Light",
  light: "Light",
  dark: "Dark",
};
const THEME_CYCLE: ThemeMode[] = ["light", "dark"];

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { mode: currentThemeMode, setMode: setThemeMode } = useTheme();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
  const [isExportingJournal, setIsExportingJournal] = useState(false);
  const [isGeneratingTitles, setIsGeneratingTitles] = useState(false);
  const [apiHealth, setApiHealth] = useState<"checking" | "ok" | "down">("checking");
  const [notifStatus, setNotifStatus] = useState<NotificationPermissionStatus>("undetermined");
  const [buddyState, setBuddyState] = useState<BuddyState | null>(null);
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
      setApiHealth("checking");
      void checkApiHealth().then((ok) => setApiHealth(ok ? "ok" : "down"));
      void getNotificationPermissionStatus().then(setNotifStatus);
      void loadBuddyState().then(setBuddyState);
    }, [loadPermissionState]),
  );

  function handleCycleTheme() {
    const currentIndex = THEME_CYCLE.indexOf(currentThemeMode);
    const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
    const next = THEME_CYCLE[nextIndex] ?? "light";
    setThemeMode(next);
  }

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

  async function handleExportJournal() {
    if (isExportingJournal) {
      return;
    }

    setIsExportingJournal(true);

    try {
      const sharingAvailable = await Sharing.isAvailableAsync();

      if (!sharingAvailable) {
        Alert.alert(
          "Export Unavailable",
          "Sharing is not available in this environment, so WalkLogue could not open the export sheet.",
        );
        return;
      }

      const exportData = await buildJournalExport(db);
      const timestamp = exportData.exportedAt.replace(/[:.]/g, "-");
      const exportFile = new File(Paths.cache, `walklog-journal-${timestamp}.json`);

      exportFile.create({ intermediates: true, overwrite: true });
      exportFile.write(JSON.stringify(exportData, null, 2));

      await Sharing.shareAsync(exportFile.uri, {
        UTI: "public.json",
        mimeType: "application/json",
        dialogTitle: "Export journal data",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not export your journal.";

      Alert.alert("Export Failed", message);
    } finally {
      setIsExportingJournal(false);
    }
  }

  async function handleGenerateTitles() {
    if (isGeneratingTitles) {
      return;
    }

    if (!hasApiConfig()) {
      Alert.alert(
        "OpenAI Key Missing",
        "API not configured. Check your settings.",
      );
      return;
    }

    setIsGeneratingTitles(true);

    try {
      const entries = await listEntries(db);
      const candidates = entries.filter(shouldGenerateTitle);

      if (candidates.length === 0) {
        Alert.alert(
          "Titles Up To Date",
          "No entries are using the default date title right now.",
        );
        return;
      }

      let updatedCount = 0;
      let emojiCount = 0;

      for (const entry of candidates) {
        const nextTitlePackage = await generateEntryTitle(entry);

        if (!nextTitlePackage.title) {
          continue;
        }

        const shouldReplaceTitle = isDefaultEntryTitle(entry);
        const nextEmoji = entry.titleEmoji?.trim()
          ? entry.titleEmoji
          : nextTitlePackage.emoji;

        await updateEntryTitle(db, entry.id, {
          title: shouldReplaceTitle ? nextTitlePackage.title : entry.title,
          titleEmoji: nextEmoji,
        });
        updatedCount += 1;

        if (!entry.titleEmoji?.trim() && nextEmoji) {
          emojiCount += 1;
        }
      }

      Alert.alert(
        updatedCount > 0 ? "Titles Updated" : "No Titles Generated",
        updatedCount > 0
          ? `Updated ${updatedCount} ${updatedCount === 1 ? "entry" : "entries"} and added ${emojiCount} ${emojiCount === 1 ? "emoji" : "emojis"}.`
          : "WalkLogue could not generate any new titles this time.",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not generate journal titles.";

      Alert.alert("Title Generation Failed", message);
    } finally {
      setIsGeneratingTitles(false);
    }
  }

  const micAction = microphoneStatus === "undetermined"
    ? () => void handleAllowMicrophone()
    : microphoneStatus === "denied"
      ? () => void openAppSettings()
      : undefined;

  const healthAction = healthStatus === "undetermined"
    ? () => void handleAllowHealth()
    : healthStatus === "granted" && selectedStepSource !== "apple-health"
      ? () => void handleUseStepSource("apple-health")
      : undefined;

  const fitbitAction = !fitbitConfigured || fitbitStatus === "unavailable"
    ? () => handleExplainFitbitSetup()
    : fitbitStatus === "undetermined"
      ? () => void handleConnectFitbit()
      : fitbitStatus === "granted" && selectedStepSource !== "fitbit"
        ? () => void handleUseStepSource("fitbit")
        : undefined;

  return (
    <Screen scroll>
      <View style={styles.group}>
        <Text style={styles.groupHeader}>Permissions</Text>
        <View style={styles.groupCard}>
          <SettingRow
            label="Microphone"
            value={formatStatus(microphoneStatus)}
            onPress={micAction}
          />
          <View style={styles.separator} />
          <SettingRow
            label="Apple Health"
            detail={healthStatus === "granted" && healthPreviewSteps !== null
              ? `${healthPreviewSteps.toLocaleString()} steps`
              : undefined}
            value={healthStatus === "granted"
              ? selectedStepSource === "apple-health" ? "\u2713 Active" : "Use"
              : formatStatus(healthStatus)}
            onPress={healthAction}
          />
          <View style={styles.separator} />
          <SettingRow
            label="Fitbit"
            detail={fitbitStatus === "granted" && fitbitPreviewSteps !== null
              ? `${fitbitPreviewSteps.toLocaleString()} steps`
              : undefined}
            value={fitbitStatus === "granted"
              ? selectedStepSource === "fitbit" ? "\u2713 Active" : "Use"
              : formatFitbitStatus(fitbitStatus, fitbitConfigured, fitbitSyncStatus)}
            onPress={fitbitAction}
          />
          <View style={styles.separator} />
          <SettingRow
            label="Transcription"
            value={apiHealth === "ok" ? "Ready" : apiHealth === "checking" ? "Checking..." : "Unavailable"}
          />
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.groupHeader}>Notifications</Text>
        <View style={styles.groupCard}>
          <SettingRow
            label="Daily reminders"
            value={
              notifStatus === "granted"
                ? "On"
                : notifStatus === "denied"
                ? "Denied"
                : "Off"
            }
            onPress={
              notifStatus === "undetermined"
                ? async () => {
                    await requestNotificationPermission();
                    setNotifStatus(await getNotificationPermissionStatus());
                  }
                : notifStatus === "denied"
                ? () => void openAppSettings()
                : undefined
            }
            chevron={notifStatus !== "granted"}
          />
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.groupHeader}>WalkBuddy</Text>
        <View style={styles.groupCard}>
          <SettingRow
            label="Enable"
            value={buddyState?.enabled ? "On" : "Off"}
            onPress={async () => {
              const prev = buddyState ?? getDefaultState();
              const next = { ...prev, enabled: !prev.enabled };
              await saveBuddyState(next);
              setBuddyState(next);
            }}
          />
          {buddyState?.enabled ? (
            <>
              <View style={styles.separator} />
              <SettingRow
                label="Companion"
                value={KIND_LABELS[buddyState.kind]}
                onPress={async () => {
                  const kinds: BuddyKind[] = ["explorer", "oak", "plant"];
                  const idx = kinds.indexOf(buddyState.kind);
                  const next = { ...buddyState, kind: kinds[(idx + 1) % kinds.length] };
                  await saveBuddyState(next);
                  setBuddyState(next);
                }}
              />
              <View style={styles.separator} />
              <SettingRow
                label="Reset"
                value={`Day ${buddyState.streak}`}
                onPress={async () => {
                  const next = { ...getDefaultState(), enabled: true, kind: buddyState.kind };
                  await saveBuddyState(next);
                  setBuddyState(next);
                }}
                chevron
              />
            </>
          ) : null}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.groupHeader}>Appearance</Text>
        <View style={styles.groupCard}>
          <SettingRow
            label="Theme"
            value={THEME_LABELS[currentThemeMode]}
            onPress={handleCycleTheme}
          />
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.groupHeader}>Data</Text>
        <View style={styles.groupCard}>
          <SettingRow
            label="Export Journal"
            value={isExportingJournal ? "Preparing..." : undefined}
            onPress={isExportingJournal ? undefined : () => void handleExportJournal()}
            chevron
          />
        </View>
      </View>

      <View style={styles.group}>
        <View style={styles.groupCard}>
          <SettingRow
            label="Service status"
            value={
              apiHealth === "checking"
                ? "Checking..."
                : apiHealth === "ok"
                ? "All systems go"
                : "Unreachable"
            }
          />
          <View style={styles.separator} />
          <SettingRow
            label="Privacy Policy"
            onPress={() => void Linking.openURL("https://walklog-site.vercel.app/privacy")}
            chevron
          />
          <View style={styles.separator} />
          <SettingRow
            label="iPhone Settings"
            onPress={() => void openAppSettings()}
            chevron
          />
        </View>
      </View>

      <Text style={styles.versionText}>
        WalkLogue {Constants.expoConfig?.version ?? "1.0.0"}
      </Text>
    </Screen>
  );
}

function shouldGenerateTitle(entry: EntryListItem) {
  if (!entry.body.trim()) {
    return false;
  }

  return isDefaultEntryTitle(entry) || !entry.titleEmoji?.trim();
}

function isDefaultEntryTitle(entry: EntryListItem) {
  return entry.title.trim() === formatEntryTitle(entry.createdAt);
}

function SettingRow({
  label,
  detail,
  value,
  onPress,
  chevron,
}: {
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const content = (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowLabel}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {(onPress || chevron) ? <Text style={styles.rowChevron}>{"\u203A"}</Text> : null}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => pressed ? styles.rowPressed : undefined}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

function formatStatus(status: RecordingPermissionStatus | StepPermissionStatus) {
  if (status === "granted") return "On";
  if (status === "denied") return "Denied";
  if (status === "unavailable") return "N/A";
  return "Off";
}

function formatFitbitStatus(
  status: StepPermissionStatus,
  configured: boolean,
  syncStatus: StepSnapshot["syncStatus"],
) {
  if (!configured) return "Setup";
  if (status === "granted" && syncStatus === "error") return "Sync Issue";
  return formatStatus(status);
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
  group: {
    gap: 6,
  },
  groupHeader: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.2,
    paddingLeft: 4,
  },
  groupCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.rule,
    marginLeft: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  rowPressed: {
    backgroundColor: colors.accentSoft,
  },
  rowLeft: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  rowDetail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rowValue: {
    color: colors.muted,
    fontSize: 15,
  },
  rowChevron: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "300",
  },
  versionText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 8,
  },
});
}
