import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Audio, type AVPlaybackStatus } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";

import { useTheme, useThemeColors } from "../theme";
import { tapMedium } from "../lib/haptics";

type Props = {
  uri: string;
};

export function AudioPlayer({ uri }: Props) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const progress = duration > 0 ? position / duration : 0;

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPosition(status.positionMillis);
    setDuration(status.durationMillis ?? 0);
    setIsPlaying(status.isPlaying);
    setIsLoaded(true);
    if (status.didJustFinish) {
      setIsPlaying(false);
      setPosition(0);
      void soundRef.current?.setPositionAsync(0);
    }
  }, []);

  const [fileExists, setFileExists] = useState(true);

  const loadSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      // Check if file exists before loading
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) {
        setFileExists(false);
        return;
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        onStatus,
        250,
      );
      soundRef.current = sound;
    } catch {
      setFileExists(false);
    }
  }, [uri, onStatus]);

  useEffect(() => {
    void loadSound();
    return () => {
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, [loadSound]);

  const togglePlay = useCallback(async () => {
    tapMedium();
    const sound = soundRef.current;
    if (!sound) {
      await loadSound();
      return;
    }
    if (isPlaying) {
      await sound.pauseAsync();
    } else {
      await sound.playAsync();
    }
  }, [isPlaying, loadSound]);

  const seek = useCallback(async (ratio: number) => {
    const sound = soundRef.current;
    if (!sound || duration === 0) return;
    const target = Math.round(ratio * duration);
    await sound.setPositionAsync(target);
  }, [duration]);

  if (!fileExists) return null;

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => void togglePlay()}
        style={({ pressed }) => [styles.playButton, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.playIcon}>{isPlaying ? "❚❚" : "▶"}</Text>
      </Pressable>

      <View style={styles.middle}>
        <View style={styles.trackContainer}>
          <View style={styles.track} />
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
          <Pressable
            style={[styles.scrubber, { left: `${progress * 100}%` }]}
            onPress={() => {}}
          />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatTime(position)}</Text>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
      </View>
    </View>
  );
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type ColorTokens = ReturnType<typeof useTheme>["colors"];

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 6,
    },
    playButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    playIcon: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "700",
    },
    middle: {
      flex: 1,
      gap: 4,
    },
    trackContainer: {
      height: 6,
      justifyContent: "center",
      position: "relative",
    },
    track: {
      position: "absolute",
      left: 0,
      right: 0,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
    },
    trackFill: {
      position: "absolute",
      left: 0,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.muted,
    },
    scrubber: {
      position: "absolute",
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.muted,
      marginLeft: -4,
      top: -2,
    },
    timeRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    time: {
      color: colors.muted,
      fontSize: 11,
      fontVariant: ["tabular-nums"],
    },
  });
}
