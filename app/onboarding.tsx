import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";

import { ensureRecordingPermissions } from "../src/modules/settings/permissions";
import { requestHealthPermission } from "../src/modules/steps/health";
import { requestNotificationPermission } from "../src/modules/notifications/scheduler";
import { useTheme, useThemeColors } from "../src/theme";

export const ONBOARDING_KEY = "walklogue-onboarding-complete";

type Step = "welcome" | "mic" | "health" | "notifications" | "done";

export default function OnboardingScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [step, setStep] = useState<Step>("welcome");
  const [busy, setBusy] = useState(false);

  const finish = useCallback(async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, "true");
    router.replace("/");
  }, []);

  const handleMic = useCallback(async () => {
    setBusy(true);
    try {
      await ensureRecordingPermissions();
    } finally {
      setBusy(false);
      setStep("health");
    }
  }, []);

  const handleHealth = useCallback(async () => {
    setBusy(true);
    try {
      await requestHealthPermission();
    } finally {
      setBusy(false);
      setStep("notifications");
    }
  }, []);

  const handleNotifications = useCallback(async () => {
    setBusy(true);
    try {
      await requestNotificationPermission();
    } finally {
      setBusy(false);
      setStep("done");
    }
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {step === "welcome" ? (
          <View style={styles.content}>
            <Text style={styles.eyebrow}>WALKLOGUE</Text>
            <Text style={styles.title}>Walk. Talk. Remember.</Text>
            <Text style={styles.body}>
              Hit record before your walk, lock your phone, and start moving. When
              you're done, your voice becomes a journal entry with your steps
              attached.
            </Text>
            <Text style={styles.bodySecondary}>
              Built for people who think better on their feet.
            </Text>
          </View>
        ) : null}

        {step === "mic" ? (
          <View style={styles.content}>
            <Text style={styles.eyebrow}>STEP 1 OF 2</Text>
            <Text style={styles.title}>Microphone</Text>
            <Text style={styles.body}>
              WalkLogue listens while you walk so you can talk freely without
              touching your phone.
            </Text>
            <Text style={styles.bodySecondary}>
              Audio is sent to OpenAI for transcription, then discarded. Nothing
              is stored on a server.
            </Text>
          </View>
        ) : null}

        {step === "health" ? (
          <View style={styles.content}>
            <Text style={styles.eyebrow}>STEP 2 OF 3</Text>
            <Text style={styles.title}>Apple Health</Text>
            <Text style={styles.body}>
              Connect Apple Health so each walk entry shows the steps you took
              while recording it.
            </Text>
            <Text style={styles.bodySecondary}>
              WalkLogue only reads your step count. It never writes to Health.
              You can skip this and connect Fitbit later in Settings.
            </Text>
          </View>
        ) : null}

        {step === "notifications" ? (
          <View style={styles.content}>
            <Text style={styles.eyebrow}>STEP 3 OF 3</Text>
            <Text style={styles.title}>Gentle reminders</Text>
            <Text style={styles.body}>
              A nudge once a day to take your walk and journal. Plus the
              occasional throwback: "a year ago today you wrote..."
            </Text>
            <Text style={styles.bodySecondary}>
              No spam. Quiet between 10pm and 8am. Always optional, change in
              Settings.
            </Text>
          </View>
        ) : null}

        {step === "done" ? (
          <View style={styles.content}>
            <Text style={styles.eyebrow}>YOU'RE READY</Text>
            <Text style={styles.title}>Take your first walk.</Text>
            <Text style={styles.body}>
              Tap the red button on the home screen, lock your phone, and start
              walking. We'll handle the rest.
            </Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          {step === "welcome" ? (
            <Pressable
              onPress={() => setStep("mic")}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>Get started</Text>
            </Pressable>
          ) : null}

          {step === "mic" ? (
            <>
              <Pressable
                onPress={handleMic}
                disabled={busy}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>Allow microphone</Text>
              </Pressable>
              <Pressable onPress={() => setStep("health")} style={styles.skip}>
                <Text style={styles.skipText}>Not now</Text>
              </Pressable>
            </>
          ) : null}

          {step === "health" ? (
            <>
              <Pressable
                onPress={handleHealth}
                disabled={busy}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>Connect Apple Health</Text>
              </Pressable>
              <Pressable onPress={() => setStep("notifications")} style={styles.skip}>
                <Text style={styles.skipText}>Skip for now</Text>
              </Pressable>
            </>
          ) : null}

          {step === "notifications" ? (
            <>
              <Pressable
                onPress={handleNotifications}
                disabled={busy}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>Turn on reminders</Text>
              </Pressable>
              <Pressable onPress={() => setStep("done")} style={styles.skip}>
                <Text style={styles.skipText}>Not now</Text>
              </Pressable>
            </>
          ) : null}

          {step === "done" ? (
            <Pressable
              onPress={finish}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>Start walking</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

type ColorTokens = ReturnType<typeof useTheme>["colors"];

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      paddingHorizontal: 28,
      paddingTop: 80,
      paddingBottom: 32,
      justifyContent: "space-between",
    },
    content: {
      gap: 16,
    },
    eyebrow: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: "600",
      letterSpacing: 1.2,
      marginBottom: 8,
    },
    title: {
      color: colors.text,
      fontSize: 34,
      fontWeight: "300",
      letterSpacing: -1,
      lineHeight: 40,
    },
    body: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 26,
      marginTop: 12,
    },
    bodySecondary: {
      color: colors.muted,
      fontSize: 15,
      lineHeight: 22,
    },
    footer: {
      gap: 12,
    },
    primary: {
      backgroundColor: colors.accent,
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: "center",
    },
    pressed: {
      opacity: 0.7,
    },
    primaryText: {
      color: "#FFF8F2",
      fontSize: 17,
      fontWeight: "600",
    },
    skip: {
      paddingVertical: 12,
      alignItems: "center",
    },
    skipText: {
      color: colors.muted,
      fontSize: 15,
    },
  });
}
