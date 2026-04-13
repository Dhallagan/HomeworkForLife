import { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";

export type ThemeMode = "light" | "dark" | "system";

type ColorTokens = {
  background: string;
  surface: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  record: string;
  success: string;
  danger: string;
  shadow: string;
  rule: string;
  hole: string;
};

type StatusColorSet = {
  background: string;
  border: string;
};

const lightColors: ColorTokens = {
  background: "#FDFCF9",
  surface: "#FFFDFC",
  card: "#FFFEFC",
  border: "#DDD8CF",
  text: "#595550",
  muted: "#8E8982",
  accent: "#4F4A44",
  accentSoft: "#F6F2EA",
  record: "#D22630",
  success: "#6A7467",
  danger: "#8E6760",
  shadow: "rgba(70, 64, 58, 0.05)",
  rule: "#D4CFC6",
  hole: "#D1CDC5",
};

const darkColors: ColorTokens = {
  background: "#1C1A18",
  surface: "#252320",
  card: "#2A2826",
  border: "#3D3A36",
  text: "#E8E4DF",
  muted: "#9B9590",
  accent: "#D4CFC6",
  accentSoft: "#2E2B28",
  record: "#D22630",
  success: "#8FA98B",
  danger: "#C4908A",
  shadow: "rgba(0, 0, 0, 0.3)",
  rule: "#3D3A36",
  hole: "#353230",
};

const lightStatusColors: Record<string, StatusColorSet> = {
  default: {
    background: "#F6F2EA",
    border: "#D9D1C1",
  },
  success: {
    background: "#E9F4EA",
    border: "#B8D0BE",
  },
  danger: {
    background: "#FCEBE6",
    border: "#E3B8AB",
  },
};

const darkStatusColors: Record<string, StatusColorSet> = {
  default: {
    background: "#2E2B28",
    border: "#3D3A36",
  },
  success: {
    background: "#1F2E20",
    border: "#3A5A3D",
  },
  danger: {
    background: "#2E1F1C",
    border: "#5A3A34",
  },
};

export type Theme = {
  colors: ColorTokens;
  statusColors: Record<string, StatusColorSet>;
  isDark: boolean;
};

export const lightTheme: Theme = {
  colors: lightColors,
  statusColors: lightStatusColors,
  isDark: false,
};

export const darkTheme: Theme = {
  colors: darkColors,
  statusColors: darkStatusColors,
  isDark: true,
};

// Static exports for files that haven't migrated to the context yet.
// These always return the light palette.
export const colors = lightColors;

export const spacing = {
  xxs: 6,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 22,
  xl: 30,
  xxl: 40,
};

export const radii = {
  sm: 14,
  md: 18,
  lg: 22,
  xl: 28,
  pill: 999,
};

export const layout = {
  screenPadding: 18,
  screenTop: 12,
  sectionGap: 18,
  panelGap: 12,
  panelPadding: 18,
};

// Mutable color reference — updated by _layout.tsx when theme changes.
// Components using StyleSheet.create() with `colors` will pick up the
// new values on their next render without any code changes.
// Mutable active theme — screens read this directly via useThemeColors()
let activeColors = colors;
let activeStatusColors = statusColors;
let themeVersion = 0;
const listeners = new Set<() => void>();

export function setActiveTheme(theme: Theme) {
  activeColors = theme.colors;
  activeStatusColors = theme.statusColors;
  themeVersion++;
  for (const listener of listeners) listener();
}

export function getActiveColors() { return activeColors; }
export function getActiveStatusColors() { return activeStatusColors; }
export function getThemeVersion() { return themeVersion; }
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Theme context
type ThemeContextValue = Theme & {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

export const ThemeContext = createContext<ThemeContextValue>({
  ...lightTheme,
  mode: "system",
  setMode: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/** Subscribe to theme changes independent of React context. Works across Stack screens. */
export function useThemeColors() {
  const [, setVersion] = useState(getThemeVersion);
  useEffect(() => subscribeTheme(() => setVersion(getThemeVersion())), []);
  return { colors: getActiveColors(), statusColors: getActiveStatusColors() };
}

export function useResolvedTheme(mode: ThemeMode): Theme {
  const systemScheme = useSystemColorScheme();
  if (mode === "system") {
    return systemScheme === "dark" ? darkTheme : lightTheme;
  }
  return mode === "dark" ? darkTheme : lightTheme;
}
