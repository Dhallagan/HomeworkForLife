import * as SecureStore from "expo-secure-store";

let Notifications: typeof import("expo-notifications") | null = null;
try {
  Notifications = require("expo-notifications");
} catch (e) {
  if (__DEV__) console.log("expo-notifications not available:", e);
}

import type { EntryListItem } from "../journal/repository";

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isJournalEntryComplete(entry: EntryListItem) {
  return entry.body.trim().length > 0;
}

const NOTIF_TIME_KEY = "walklogue-notif-time"; // "HH:MM"
const NOTIF_ENABLED_KEY = "walklogue-notif-enabled";

const DAILY_TAG = "walklogue-daily";
const STREAK_TAG = "walklogue-streak";
const MEMORY_TAG = "walklogue-memory";

const QUIET_START = 22;
const QUIET_END = 8;

const DAILY_NUDGES = [
  "Out for a walk today?",
  "Take a walk, talk it out.",
  "Got 10 minutes? Walk and talk.",
  "Hey, how was your day?",
  "Your journal misses you.",
];

const STREAK_NUDGES = [
  "{n} days in a row. Don't stop now.",
  "Your streak's safe until midnight.",
  "{n} straight days. Keep it going?",
];

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export type NotificationPermissionStatus = "granted" | "denied" | "undetermined";

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (!Notifications) return "undetermined";
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return "granted";
  if (settings.canAskAgain) return "undetermined";
  return "denied";
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  const result = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: false },
  });
  return result.granted;
}

export async function getNotificationTime(): Promise<{ hour: number; minute: number }> {
  const stored = await SecureStore.getItemAsync(NOTIF_TIME_KEY);
  if (stored) {
    const [h, m] = stored.split(":").map((n) => parseInt(n, 10));
    if (Number.isFinite(h) && Number.isFinite(m)) return { hour: h, minute: m };
  }
  return { hour: 18, minute: 0 };
}

export async function setNotificationTime(hour: number, minute: number) {
  await SecureStore.setItemAsync(
    NOTIF_TIME_KEY,
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  );
}

export async function getNotificationsEnabled(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(NOTIF_ENABLED_KEY);
  return stored !== "false";
}

export async function setNotificationsEnabled(enabled: boolean) {
  await SecureStore.setItemAsync(NOTIF_ENABLED_KEY, enabled ? "true" : "false");
}

export async function syncScheduledNotifications(entries: EntryListItem[]) {
  const enabled = await getNotificationsEnabled();
  const status = await getNotificationPermissionStatus();

  if (!Notifications) return;
  await cancelByTag([DAILY_TAG, STREAK_TAG, MEMORY_TAG]);

  if (!enabled || status !== "granted") return;

  const completedEntries = entries.filter(isJournalEntryComplete);
  const journaledToday = completedEntries.some((e) =>
    isSameCalendarDay(e.createdAt, new Date()),
  );
  const streak = computeStreak(completedEntries);
  const { hour, minute } = await getNotificationTime();

  // Always schedule the repeating daily nudge. It fires every day at the
  // chosen time. When the user opens the app and has already journaled,
  // we cancel and reschedule (so today's is skipped but tomorrow's fires).
  await scheduleDaily(hour, minute);

  if (streak >= 3 && !journaledToday) {
    await scheduleStreakSave(streak);
  }

  await scheduleOnThisDay(completedEntries);
}

async function scheduleDaily(hour: number, minute: number) {
  if (!Notifications) return;
  const body = pick(DAILY_NUDGES);
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_TAG,
    content: { title: "WalkLogue", body, data: { tag: DAILY_TAG } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour,
      minute,
      repeats: true,
    },
  });
}

async function scheduleStreakSave(streak: number) {
  if (!Notifications) return;
  const template = pick(STREAK_NUDGES);
  const body = template.replace("{n}", String(streak));
  const fireAt = nextOccurrenceToday(20, 0);
  if (!fireAt) return;
  await Notifications.scheduleNotificationAsync({
    identifier: STREAK_TAG,
    content: { title: "WalkLogue", body, data: { tag: STREAK_TAG } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
}

async function scheduleOnThisDay(entries: EntryListItem[]) {
  if (!Notifications) return;
  const memory = findMemoryEntry(entries);
  if (!memory) return;
  const fireAt = nextOccurrenceToday(9, 0) ?? nextOccurrenceTomorrow(9, 0);
  if (!fireAt) return;

  const snippet = memory.body.trim().split(/\s+/).slice(0, 8).join(" ");
  const body = `A year ago today: "${snippet}..."`;

  await Notifications.scheduleNotificationAsync({
    identifier: MEMORY_TAG,
    content: { title: "Remember this?", body, data: { tag: MEMORY_TAG, entryId: memory.id } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
}

function findMemoryEntry(entries: EntryListItem[]): EntryListItem | null {
  const today = new Date();
  const targets = [
    monthsAgo(today, 12),
    monthsAgo(today, 6),
    monthsAgo(today, 1),
  ];
  for (const target of targets) {
    const match = entries.find((e) => isSameCalendarDay(e.createdAt, target));
    if (match && match.body.trim().length > 0) return match;
  }
  return null;
}

function computeStreak(entries: EntryListItem[]): number {
  if (entries.length === 0) return 0;
  const days = new Set(
    entries.map((e) => {
      const d = new Date(e.createdAt);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }),
  );
  let streak = 0;
  const cursor = new Date();
  while (true) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    if (days.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (streak === 0) {
      cursor.setDate(cursor.getDate() - 1);
      const yesterdayKey = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
      if (days.has(yesterdayKey)) {
        streak = 1;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return streak;
}

function inQuietHours(hour: number): boolean {
  return hour >= QUIET_START || hour < QUIET_END;
}

function nextOccurrenceToday(hour: number, minute: number): Date | null {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target <= now) return null;
  return target;
}

function nextOccurrenceTomorrow(hour: number, minute: number): Date {
  const target = new Date();
  target.setDate(target.getDate() + 1);
  target.setHours(hour, minute, 0, 0);
  return target;
}

function monthsAgo(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function cancelByTag(tags: string[]) {
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of scheduled) {
    if (tags.includes(item.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  }
}
