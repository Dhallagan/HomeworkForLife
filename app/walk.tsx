import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  PaperActionButton,
  PaperRecordButton,
  PaperSheet,
} from "../src/components/notebook";
import { formatCompactDate, formatElapsed } from "../src/lib/date";
import { useWalkCapture } from "../src/modules/capture/useWalkCapture";
import { createWalkEntry } from "../src/modules/journal/repository";
import {
  getStepPollingIntervalMs,
  getTodayStepSnapshot,
  getWindowStepSnapshot,
  type StepPermissionStatus,
  type StepSource,
} from "../src/modules/steps/service";
import { colors } from "../src/theme";

export default function WalkScreen() {
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
    if (isTranscribing) {
      return "Transcribing with Whisper...";
    }

    if (isSimulatorRecordingFallback) {
      return "Simulator mode. Use a physical iPhone to test background recording and Whisper transcription.";
    }

    if (stepPermission === "granted") {
      if (stepSource === "fitbit") {
        return "Recording in the background. Fitbit sync can lag, so steps may update a little later.";
      }

      return "Recording in the background. Lock your screen and keep talking.";
    }

    if (stepPermission === "unavailable") {
      return stepSource === "fitbit"
        ? "Recording in the background. Fitbit is unavailable in this build."
        : "Recording in the background. Health data is unavailable on this device.";
    }

    return stepSource === "fitbit"
      ? "Recording in the background. Connect Fitbit in Settings to save walk steps."
      : "Recording in the background. Allow Health access to save walk steps.";
  }, [isSimulatorRecordingFallback, isTranscribing, stepPermission, stepSource]);

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

      const entry = await createWalkEntry(db, {
        body: session.transcript,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSec: session.durationSec,
        stepCount,
      });

      if (entry) {
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
      const message =
        error instanceof Error ? error.message : "Try again from the home screen.";

      Alert.alert("Could not save walk", message);
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
          <Text style={styles.title}>Today</Text>
          <Text style={styles.dateText}>{formatCompactDate(new Date())}</Text>
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
          <Text style={styles.sheetStatus}>{recorderStatusText}</Text>

          <Text style={[styles.transcriptText, !transcript && styles.transcriptPlaceholder]}>
            {transcript ||
              errorMessage ||
              "Your words will appear here after you end the walk."}
          </Text>
        </PaperSheet>

        <View style={styles.bottomAction}>
          {isTranscribing ? (
            <PaperActionButton
              style={styles.cancelButton}
              textStyle={styles.cancelButtonText}
              onPress={handleCancelTranscription}
            >
              Cancel Transcription
            </PaperActionButton>
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

          {isRecording && !isTranscribing ? (
            <PaperActionButton
              style={styles.cancelWalkButton}
              textStyle={styles.cancelWalkButtonText}
              onPress={handleCancelWalk}
            >
              Cancel Walk
            </PaperActionButton>
          ) : null}
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 2,
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
  cancelButton: {
    minWidth: 220,
    backgroundColor: colors.surface,
  },
  cancelButtonText: {
    fontFamily: "Courier",
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  cancelWalkButton: {
    marginTop: 12,
    minWidth: 180,
    backgroundColor: colors.background,
  },
  cancelWalkButtonText: {
    color: colors.muted,
    fontFamily: "Courier",
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
