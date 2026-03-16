import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";

import { initializeDatabase } from "../src/modules/journal/repository";
import { colors } from "../src/theme";

export default function RootLayout() {
  return (
    <SQLiteProvider
      databaseName="walklog.db"
      onInit={initializeDatabase}
      onError={(error) => {
        console.error("SQLite bootstrap failed", error);
      }}
    >
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerTitleStyle: {
            fontSize: 17,
            fontWeight: "600",
          },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen
          name="walk"
          options={{ headerShown: false, presentation: "card" }}
        />
        <Stack.Screen name="entry/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: "Profile" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </SQLiteProvider>
  );
}
