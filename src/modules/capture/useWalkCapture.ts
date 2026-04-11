import { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";

import { transcribeAudioFile } from "../transcription/openai";

type SessionSnapshot = {
  transcript: string;
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
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

    // Low bitrate voice-optimized recording.
    // Whisper transcribes speech fine at 32kbps.
    // Keeps files under 4MB for ~15 min walks (Vercel body limit).
    const voicePreset: Audio.RecordingOptions = {
      ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
      ios: {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
        bitRate: 32000,
        numberOfChannels: 1,
        sampleRate: 16000,
      },
      android: {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
        bitRate: 32000,
        numberOfChannels: 1,
        sampleRate: 16000,
      },
    };

    const { recording } = await Audio.Recording.createAsync(
      voicePreset,
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

      const abortController = new AbortController();
      transcriptionAbortRef.current = abortController;
      const transcriptText = await transcribeAudioFile(audioUri, abortController.signal);
      const normalizedTranscript =
        transcriptText.trim() || "No speech was detected during this walk.";

      setTranscript(normalizedTranscript);

      return {
        transcript: normalizedTranscript,
        startedAt: sessionStart,
        endedAt,
        durationSec: calculateDurationSec(sessionStart, endedAt),
      };
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
