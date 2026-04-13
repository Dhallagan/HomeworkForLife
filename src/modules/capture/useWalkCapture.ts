import { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";

import { transcribeAudioFile } from "../transcription/openai";

type SessionSnapshot = {
  transcript: string;
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
  audioUri?: string;
  transcriptionError?: string;
};

export function useWalkCapture() {
  const [transcript, setTranscript] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [meterLevel, setMeterLevel] = useState(0);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const startedAtRef = useRef<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const isSimulatorRecordingFallback = detectSimulatorRecordingFallback();

  useEffect(() => {
    return () => {
      void reset();
    };
  }, []);

  async function start() {
    if (isRecording || isTranscribing) {
      return;
    }

    setErrorMessage(null);
    setTranscript("");
    setMeterLevel(0);

    const sessionStart = new Date();
    startedAtRef.current = sessionStart;
    setStartedAt(sessionStart);
    setElapsedSeconds(0);

    startElapsedTimer();
    setIsRecording(true);

    if (isSimulatorRecordingFallback) {
      return;
    }

    if (!process.env.EXPO_PUBLIC_API_SECRET) {
      clearElapsedTimer();
      setIsRecording(false);
      startedAtRef.current = null;
      setStartedAt(null);
      throw new Error("Missing EXPO_PUBLIC_API_SECRET for transcription.");
    }

    const permission = await Audio.requestPermissionsAsync();

    if (!permission.granted) {
      clearElapsedTimer();
      setIsRecording(false);
      startedAtRef.current = null;
      setStartedAt(null);
      throw new Error("Microphone permission is required to record a walk.");
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });

    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
      handleRecordingStatusUpdate,
      250,
    );

    recordingRef.current = recording;
  }

  async function finish(): Promise<SessionSnapshot> {
    const sessionStart = startedAtRef.current ?? new Date();
    const endedAt = new Date();

    setIsRecording(false);
    setIsTranscribing(true);
    clearElapsedTimer();
    setMeterLevel(0);

    try {
      if (isSimulatorRecordingFallback) {
        const transcriptText =
          "Simulator mode: use a physical iPhone to test background audio capture and Whisper transcription.";

        setTranscript(transcriptText);
        return {
          transcript: transcriptText,
          startedAt: sessionStart,
          endedAt,
          durationSec: calculateDurationSec(sessionStart, endedAt),
        };
      }

      const recording = recordingRef.current;

      if (!recording) {
        throw new Error("Recording session was not available.");
      }

      await recording.stopAndUnloadAsync();
      const audioUri = recording.getURI();
      recordingRef.current = null;

      if (!audioUri) {
        throw new Error("Recorded audio file was not available.");
      }

      // Save audio to permanent storage BEFORE attempting transcription.
      // This is the "never lose a walk" guarantee. Even if transcription
      // fails, the recording survives.
      let permanentPath: string | undefined;
      try {
        const ext = audioUri.slice(audioUri.lastIndexOf(".")) || ".m4a";
        const permanentDir = `${FileSystem.documentDirectory}recordings/`;
        permanentPath = `${permanentDir}${Date.now()}${ext}`;
        const dirInfo = await FileSystem.getInfoAsync(permanentDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(permanentDir, { intermediates: true });
        }
        await FileSystem.copyAsync({ from: audioUri, to: permanentPath });
      } catch {
        // If permanent save fails, fall back to temp URI.
        // Transcription can still work, audio just won't survive app restart.
        permanentPath = audioUri;
      }

      const abortController = new AbortController();
      transcriptionAbortRef.current = abortController;

      try {
        const transcriptText = await transcribeWithRetry(permanentPath, abortController.signal, 3);
        const normalizedTranscript =
          transcriptText.trim() || "No speech was detected during this walk.";

        setTranscript(normalizedTranscript);

        return {
          transcript: normalizedTranscript,
          startedAt: sessionStart,
          endedAt,
          durationSec: calculateDurationSec(sessionStart, endedAt),
          audioUri: permanentPath,
        };
      } catch (transcriptionError) {
        const reason = classifyTranscriptionError(transcriptionError);
        return {
          transcript: "",
          startedAt: sessionStart,
          endedAt,
          durationSec: calculateDurationSec(sessionStart, endedAt),
          audioUri: permanentPath,
          transcriptionError: reason,
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not finish recording.";
      setErrorMessage(message);
      throw error;
    } finally {
      transcriptionAbortRef.current = null;
      await setPlaybackAudioMode();
      setIsTranscribing(false);
    }
  }

  async function reset() {
    clearElapsedTimer();
    setMeterLevel(0);
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;

    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
      }
    } catch {
      // Ignore cleanup failures during screen transitions.
    } finally {
      recordingRef.current = null;
      startedAtRef.current = null;
      await setPlaybackAudioMode();
    }

    setTranscript("");
    setElapsedSeconds(0);
    setIsRecording(false);
    setIsTranscribing(false);
    setStartedAt(null);
    setErrorMessage(null);
  }

  function handleRecordingStatusUpdate(status: Audio.RecordingStatus) {
    const sessionStart = startedAtRef.current;

    if (sessionStart) {
      setElapsedSeconds(calculateDurationSec(sessionStart, new Date()));
    }

    if (typeof status.metering === "number") {
      setMeterLevel(normalizeMeterLevel(status.metering));
      return;
    }

    setMeterLevel(0);
  }

  function startElapsedTimer() {
    clearElapsedTimer();

    intervalRef.current = setInterval(() => {
      const sessionStart = startedAtRef.current;

      if (!sessionStart) {
        return;
      }

      setElapsedSeconds(calculateDurationSec(sessionStart, new Date()));

      if (isSimulatorRecordingFallback) {
        setMeterLevel(simulateMeterLevel(Date.now()));
      }
    }, 500);
  }

  function clearElapsedTimer() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function cancelTranscription() {
    transcriptionAbortRef.current?.abort();
  }

  return {
    transcript,
    elapsedSeconds,
    isRecording,
    isTranscribing,
    errorMessage,
    meterLevel,
    startedAt,
    isSimulatorRecordingFallback,
    start,
    finish,
    cancelTranscription,
    reset,
  };
}

async function setPlaybackAudioMode() {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {
    // Ignore mode reset failures during cleanup.
  }
}

function classifyTranscriptionError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/413|too large|entity/i.test(msg)) return "Recording was too large to upload. Try a shorter walk.";
  if (/401|unauthorized/i.test(msg)) return "Authentication failed. Try updating the app.";
  if (/network|fetch|timeout|abort/i.test(msg)) return "Network connection failed. Check your WiFi or signal.";
  if (/5\d{2}/i.test(msg)) return "Server is temporarily down. It will retry automatically.";
  return "Transcription failed unexpectedly. Tap retry to try again.";
}

async function transcribeWithRetry(
  audioUri: string,
  signal: AbortSignal,
  maxAttempts: number,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await transcribeAudioFile(audioUri, signal);
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw error;
      // Don't retry 4xx errors (bad request, auth), only network/5xx
      if (error instanceof Error && /\b4\d{2}\b/.test(error.message)) throw error;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

function calculateDurationSec(startedAt: Date, endedAt: Date) {
  return Math.max(1, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
}

function normalizeMeterLevel(value: number) {
  const clamped = Math.max(-60, Math.min(0, value));
  return (clamped + 60) / 60;
}

function simulateMeterLevel(timestamp: number) {
  const wave = Math.sin(timestamp / 240) * 0.25 + Math.sin(timestamp / 110) * 0.15;
  return Math.max(0.2, Math.min(0.85, 0.45 + wave));
}

function detectSimulatorRecordingFallback() {
  const deviceName = Constants.deviceName?.trim().toLowerCase();
  const iosModel = Constants.platform?.ios?.model?.trim().toLowerCase();

  if (!__DEV__ || !deviceName || !iosModel) {
    return false;
  }

  return deviceName === iosModel;
}
