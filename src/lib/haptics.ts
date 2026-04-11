let Haptics: typeof import("expo-haptics") | null = null;
try {
  Haptics = require("expo-haptics");
} catch {
  // Native module not available
}

export function tapLight() {
  void Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function tapMedium() {
  void Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function tapHeavy() {
  void Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

export function success() {
  void Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function warning() {
  void Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}
