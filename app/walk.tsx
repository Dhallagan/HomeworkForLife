import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  PaperActionButton,
  PaperRecordButton,
  PaperSheet,
} from "../src/components/notebook";
import { formatCompactDate, formatElapsed } from "../src/lib/date";
import { useWalkCapture } from "../src/modules/capture/useWalkCapture";
import { createTask, createWalkEntry, markTasksExtracted, updateEntryTitle } from "../src/modules/journal/repository";
import {
  extractTasksFromEntry,
  generateEntryTitle,
  hasInsightsConfig,
} from "../src/modules/insights/openai";
import {
  getStepPollingIntervalMs,
  getTodayStepSnapshot,
  getWindowStepSnapshot,
  type StepPermissionStatus,
  type StepSource,
} from "../src/modules/steps/service";
import { useTheme, useThemeColors } from "../src/theme";

export default function WalkScreen() {
  const { forDate } = useLocalSearchParams<{ forDate?: string }>();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const db = useSQLiteContext();
  const router = useRouter();
  const hasStartedRef = useRef(false);
  const baselineTodayStepsRef = useRef(0);
  const stepsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepPermissionRef = useRef<StepPermissionStatus>("undetermined");
  const stepSourceRef = useRef<StepSource>("apple-health");
  const {
    transcript,
    elapsedSeconds,
    isRecording,
    isTranscribing,
    errorMessage,
    meterLevel,
    isSimulatorRecordingFallback,
    start,
    finish,
    cancelTranscription,
    reset,
  } = useWalkCapture();
  const [displayStepCount, setDisplayStepCount] = useState(0);
  const [stepPermission, setStepPermission] =
    useState<StepPermissionStatus>("undetermined");
  const [stepSource, setStepSource] = useState<StepSource>("apple-health");

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;

    void start().catch((error) => {
      const message =
        error instanceof Error ? error.message : "Could not start recording.";

      Alert.alert("Could not start walk", message, [
        {
          text: "OK",
          onPress: () => {
            router.replace("/");
          },
        },
      ]);
    });
    void initializeStepTracking();

    return () => {
      clearStepPolling();
      void reset();
    };
  }, []);

  const bars = useMemo(
    () =>
      [0.5, 0.85, 1.2, 1.45, 1.2, 0.9, 0.6].map((factor, index) => ({
        id: `${index}`,
        height: 16 + meterLevel * 42 * factor,
      })),
    [meterLevel],
  );
  const leadingBars = bars.slice(0, 3);
  const trailingBars = bars.slice(3);

  const recorderStatusText = useMemo(() => {
    if (isSimulatorRecordingFallback) {
      return "Simulator mode. Use a physical device to record.";
    }
    return "Recording. Lock your screen and keep talking.";
  }, [isSimulatorRecordingFallback, stepPermission, stepSource]);

  async function handleFinish() {
    if (isTranscribing) {
      return;
    }

    try {
      const session = await finish();
      let stepCount = 0;

      if (stepSourceRef.current === "fitbit") {
        const stepSnapshot = await getTodayStepSnapshot();

        if (
          stepSnapshot.permission === "granted" &&
          stepSnapshot.source === "fitbit" &&
          stepSnapshot.syncStatus === "ok"
        ) {
          // Fitbit now returns the day total; derive the walk delta from the
          // baseline captured when the walk started.
          stepCount = Math.max(
            0,
            stepSnapshot.totalSteps - baselineTodayStepsRef.current,
          );
        }
      } else {
        const stepSnapshot = await getWindowStepSnapshot(
          session.startedAt,
          session.endedAt,
        );
        stepCount =
          stepSnapshot.permission === "granted" ? stepSnapshot.totalSteps : 0;
      }

      let startedAt = session.startedAt;
      let endedAt = session.endedAt;

      if (forDate) {
        const target = new Date(`${forDate}T12:00:00`);
        if (!isNaN(target.getTime())) {
          startedAt = target;
          endedAt = new Date(target.getTime() + session.durationSec * 1000);
        }
      }

      const transcriptionFailed = !session.transcript.trim() && !!session.audioUri;

      const entry = await createWalkEntry(db, {
        body: session.transcript,
        startedAt,
        endedAt,
        durationSec: session.durationSec,
        stepCount: forDate ? 0 : stepCount,
        audioUri: session.audioUri,
        transcriptionStatus: transcriptionFailed ? "pending" : "completed",
        transcriptionError: session.transcriptionError,
      });

      if (entry) {
        if (hasInsightsConfig() && session.transcript.trim()) {
          void generateEntryTitle(entry).then((titlePackage) => {
            void updateEntryTitle(db, entry.id, {
              title: titlePackage.title || entry.title,
              titleEmoji: titlePackage.emoji || "",
            });
          }).catch((error) => {
            console.error("Auto-generate walk title failed", error);
          });

          void extractTasksFromEntry(entry).then(async (tasks) => {
            for (const task of tasks) {
              await createTask(db, entry.id, task.title, task.timeframe);
            }
            if (tasks.length > 0) {
              await markTasksExtracted(db, entry.id);
            }
          }).catch((error) => {
            console.error("Auto-extract tasks failed", error);
          });
        }

        router.replace(`/entry/${entry.id}`);
        return;
      }

      router.replace("/");
    } catch (error) {
      if (isAbortError(error)) {
        router.replace("/");
        return;
      }

      console.error("Could not save walk entry", error);

      // Last resort: try to create entry with whatever we have
      try {
        const entry = await createWalkEntry(db, {
          body: "",
          startedAt: new Date(),
          endedAt: new Date(),
          durationSec: elapsedSeconds || 1,
          stepCount: 0,
          transcriptionStatus: "failed",
        });
        if (entry) {
          router.replace(`/entry/${entry.id}`);
          return;
        }
      } catch {
        // Even the fallback failed
      }

      Alert.alert(
        "Walk saved with errors",
        "Something went wrong, but your recording may still be available. Check your latest entry.",
      );
      router.replace("/");
    }
  }

  function handleCancelWalk() {
    Alert.alert("Cancel this walk?", "This will discard the current recording.", [
      {
        text: "Keep walking",
        style: "cancel",
      },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          void reset().finally(() => {
            router.replace("/");
          });
        },
      },
    ]);
  }

  function handleCancelTranscription() {
    Alert.alert(
      "Discard this walk?",
      "Cancelling transcription will discard this unsaved walk.",
      [
        {
          text: "Keep",
          style: "cancel",
        },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            cancelTranscription();
          },
        },
      ],
    );
  }

  async function initializeStepTracking() {
    try {
      const snapshot = await getTodayStepSnapshot();

      stepPermissionRef.current = snapshot.permission;
      stepSourceRef.current = snapshot.source;
      setStepPermission(snapshot.permission);
      setStepSource(snapshot.source);

      if (snapshot.permission !== "granted") {
        setDisplayStepCount(0);
        return;
      }

      baselineTodayStepsRef.current = snapshot.totalSteps;
      setDisplayStepCount(0);
      startStepPolling(snapshot.source);
    } catch {
      stepPermissionRef.current = "unavailable";
      stepSourceRef.current = "apple-health";
      setStepPermission("unavailable");
      setStepSource("apple-health");
      setDisplayStepCount(0);
    }
  }

  function startStepPolling(source: StepSource) {
    clearStepPolling();

    stepsPollRef.current = setInterval(() => {
      void refreshWalkSteps();
    }, getStepPollingIntervalMs(source));
  }

  function clearStepPolling() {
    if (stepsPollRef.current) {
      clearInterval(stepsPollRef.current);
      stepsPollRef.current = null;
    }
  }

  async function refreshWalkSteps() {
    try {
      const snapshot = await getTodayStepSnapshot();

      stepPermissionRef.current = snapshot.permission;
      stepSourceRef.current = snapshot.source;
      setStepPermission(snapshot.permission);
      setStepSource(snapshot.source);

      if (snapshot.permission !== "granted") {
        setDisplayStepCount(0);
        return;
      }

      setDisplayStepCount(
        Math.max(0, snapshot.totalSteps - baselineTodayStepsRef.current),
      );
    } catch {
      stepPermissionRef.current = "unavailable";
      stepSourceRef.current = "apple-health";
      setStepPermission("unavailable");
      setStepSource("apple-health");
      setDisplayStepCount(0);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.title}>{forDate ? "Recall" : "Today"}</Text>
            <Text style={styles.dateText}>
              {formatCompactDate(forDate ? new Date(`${forDate}T12:00:00`) : new Date())}
            </Text>
          </View>
          {isRecording && !isTranscribing ? (
            <Pressable
              hitSlop={12}
              style={({ pressed }) => [
                styles.headerCancelAction,
                pressed && styles.headerCancelActionPressed,
              ]}
              onPress={handleCancelWalk}
            >
              <Text style={styles.headerCancelText}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.metricsRow}>
          <Text style={styles.timerText}>{formatElapsed(elapsedSeconds)}</Text>
          <View style={styles.metricDivider} />
          <View style={styles.stepsBlock}>
            <Text style={styles.metricLabel}>Steps</Text>
            <Text style={styles.stepsText}>{displayStepCount.toLocaleString()}</Text>
          </View>
        </View>

        <PaperSheet style={styles.sheet} contentStyle={styles.sheetContent} lineCount={11}>
          {isTranscribing ? (
            <TypewriterText />
          ) : (
            <>
              <Text style={styles.sheetStatus}>{recorderStatusText}</Text>
              <Text style={[styles.transcriptText, !transcript && styles.transcriptPlaceholder]}>
                {transcript ||
                  errorMessage ||
                  "Your words will appear here after you end the walk."}
              </Text>
            </>
          )}
        </PaperSheet>

        <View style={styles.bottomAction}>
          {isTranscribing ? (
            <Pressable onPress={handleCancelTranscription}>
              <Text style={styles.cancelLink}>Cancel</Text>
            </Pressable>
          ) : (
            <PaperRecordButton
              label="End Walk"
              mode="stop"
              disabled={!isRecording}
              leadingAccessory={
                <View style={styles.controlWaveCluster}>
                  {leadingBars.map((bar) => (
                    <View
                      key={bar.id}
                      style={[styles.controlWaveBar, { height: bar.height }]}
                    />
                  ))}
                </View>
              }
              trailingAccessory={
                <View style={styles.controlWaveCluster}>
                  {trailingBars.map((bar) => (
                    <View
                      key={bar.id}
                      style={[styles.controlWaveBar, { height: bar.height }]}
                    />
                  ))}
                </View>
              }
              onPress={() => void handleFinish()}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("abort"))
  );
}

type ColorTokens = ReturnType<typeof useTheme>["colors"];

const TYPEWRITER_MESSAGES = [
  "Saving your recording",
  "Transcribing your walk",
  "Reading between the lines",
  "Turning voice into words",
  "Almost there",
];

function TypewriterText() {
  const { colors } = useThemeColors();
  const [msgIndex, setMsgIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);

  const msg = TYPEWRITER_MESSAGES[msgIndex % TYPEWRITER_MESSAGES.length];

  useEffect(() => {
    const blink = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    if (deleting) {
      if (charIndex === 0) {
        setDeleting(false);
        setMsgIndex((i) => (i + 1) % TYPEWRITER_MESSAGES.length);
        return;
      }
      const timer = setTimeout(() => setCharIndex((i) => i - 1), 30);
      return () => clearTimeout(timer);
    }

    if (charIndex < msg.length) {
      const timer = setTimeout(() => setCharIndex((i) => i + 1), 60);
      return () => clearTimeout(timer);
    }

    // Pause at full message, then start deleting
    const timer = setTimeout(() => setDeleting(true), 2000);
    return () => clearTimeout(timer);
  }, [charIndex, deleting, msg]);

  return (
    <Text
      style={{
        fontFamily: "Courier",
        fontSize: 14,
        color: colors.muted,
        letterSpacing: 0.5,
        lineHeight: 22,
        paddingTop: 4,
      }}
    >
      {msg.slice(0, charIndex)}
      <Text style={{ opacity: cursorVisible ? 1 : 0 }}>▊</Text>
    </Text>
  );
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 2,
  },
  headerTextBlock: {
    gap: 2,
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "300",
    letterSpacing: -1.2,
  },
  dateText: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "300",
    letterSpacing: -0.6,
  },
  headerCancelAction: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 4,
    marginTop: 4,
  },
  headerCancelActionPressed: {
    opacity: 0.55,
  },
  headerCancelText: {
    color: colors.muted,
    fontFamily: "Courier",
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  timerText: {
    color: colors.text,
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "300",
    letterSpacing: -1.8,
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: colors.rule,
    marginBottom: 4,
  },
  stepsBlock: {
    paddingBottom: 3,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1.1,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  stepsText: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "300",
    letterSpacing: -0.5,
  },
  sheet: {
    flex: 1,
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 10,
  },
  sheetContent: {
    paddingTop: 18,
    paddingBottom: 18,
  },
  sheetStatus: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1,
    fontFamily: "Courier",
    textTransform: "uppercase",
    paddingBottom: 22,
  },
  transcriptText: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 30,
    flex: 1,
  },
  transcriptPlaceholder: {
    color: colors.muted,
  },
  bottomAction: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 114,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: colors.background,
  },
  controlWaveCluster: {
    height: 54,
    width: 50,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 5,
  },
  controlWaveBar: {
    width: 6,
    borderRadius: 999,
    backgroundColor: colors.accent,
    opacity: 0.82,
  },
  cancelLink: {
    color: colors.muted,
    fontSize: 14,
    paddingVertical: 20,
  },
});
}
