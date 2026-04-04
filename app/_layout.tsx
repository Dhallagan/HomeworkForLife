import { useCallback, useEffect, useState } from "react";
import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";

import { initializeDatabase } from "../src/modules/journal/repository";
import {
  ThemeContext,
  setActiveTheme,
  useResolvedTheme,
  type ThemeMode,
} from "../src/theme";

const THEME_KEY = "walklog-theme-mode";

export default function RootLayout() {
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const theme = useResolvedTheme(themeMode);

  useEffect(() => {
    setActiveTheme(theme);
  }, [theme]);

  useEffect(() => {
    void SecureStore.getItemAsync(THEME_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        setThemeMode(stored);
      }
    });
  }, []);

  const handleSetMode = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    void SecureStore.setItemAsync(THEME_KEY, mode);
  }, []);

  return (
    <ThemeContext.Provider value={{ ...theme, mode: themeMode, setMode: handleSetMode }}>
      <SQLiteProvider
        databaseName="walklog.db"
        onInit={initializeDatabase}
        onError={(error) => {
          console.error("SQLite bootstrap failed", error);
        }}
      >
        <StatusBar style={theme.isDark ? "light" : "dark"} />
        <Stack
          screenOptions={() => ({
            headerStyle: { backgroundColor: theme.colors.background },
            headerTintColor: theme.colors.text,
            headerBackButtonDisplayMode: "minimal",
            headerShadowVisible: false,
            headerTitleStyle: {
              fontSize: 17,
              fontWeight: "600",
            },
            contentStyle: { backgroundColor: theme.colors.background },
          })}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen
            name="walk"
            options={{ headerShown: false, presentation: "card" }}
          />
          <Stack.Screen name="day/[date]" options={{ title: "Day" }} />
          <Stack.Screen name="entry/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="person/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="profile" options={{ title: "Profile" }} />
          <Stack.Screen name="tasks" options={{ title: "Tasks" }} />
          <Stack.Screen name="settings" options={{ title: "Settings" }} />
        </Stack>
      </SQLiteProvider>
    </ThemeContext.Provider>
  );
}
