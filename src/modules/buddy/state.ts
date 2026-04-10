import * as SecureStore from "expo-secure-store";

export type BuddyKind = "explorer" | "oak" | "plant";

export type BuddyStage = 0 | 1 | 2 | 3 | 4;

export type BuddyMood = "happy" | "content" | "hungry" | "lonely" | "sick" | "dead";

export type BuddyState = {
  kind: BuddyKind;
  enabled: boolean;
  streak: number;
  stage: BuddyStage;
  health: number; // 0-100
  stepsBar: number; // 0-100
  journalBar: number; // 0-100
  tasksBar: number; // 0-100
  mood: BuddyMood;
  lastFedDate: string | null; // YYYY-MM-DD
  missedDays: number;
  speech: string;
};

const BUDDY_KEY = "walklogue-buddy";
const STEP_GOAL = 5000;

export function getDefaultState(): BuddyState {
  return {
    kind: "explorer",
    enabled: false,
    streak: 0,
    stage: 0,
    health: 50,
    stepsBar: 0,
    journalBar: 0,
    tasksBar: 0,
    mood: "content",
    lastFedDate: null,
    missedDays: 0,
    speech: "",
  };
}

export async function loadBuddyState(): Promise<BuddyState> {
  const raw = await SecureStore.getItemAsync(BUDDY_KEY);
  if (!raw) return getDefaultState();
  try {
    return { ...getDefaultState(), ...JSON.parse(raw) };
  } catch {
    return getDefaultState();
  }
}

export async function saveBuddyState(state: BuddyState) {
  await SecureStore.setItemAsync(BUDDY_KEY, JSON.stringify(state));
}

export function computeBuddyState(
  prev: BuddyState,
  todaySteps: number,
  journaledToday: boolean,
  tasksCompletedToday: number,
): BuddyState {
  const today = todayKey();
  const isNewDay = prev.lastFedDate !== today;

  let { streak, missedDays, health } = prev;

  if (isNewDay && prev.lastFedDate) {
    const daysBetween = daysDiff(prev.lastFedDate, today);
    if (daysBetween === 1 && prev.health >= 50) {
      streak += 1;
      missedDays = 0;
    } else if (daysBetween === 1) {
      missedDays += 1;
      streak = Math.max(0, streak - 1);
    } else if (daysBetween > 1) {
      missedDays += daysBetween - 1;
      streak = 0;
    }

    // Decay health for missed days
    if (prev.health < 50) {
      health = Math.max(0, health - 20 * (daysBetween > 1 ? daysBetween - 1 : 0));
    }
  }

  const stepsBar = Math.min(100, Math.round((todaySteps / STEP_GOAL) * 100));
  const journalBar = journaledToday ? 100 : 0;
  const tasksBar = tasksCompletedToday > 0 ? 100 : 0;

  health = Math.round((stepsBar + journalBar + tasksBar) / 3);

  const stage = computeStage(streak);
  const mood = computeMood(health, stepsBar, journalBar, missedDays);
  const speech = pickSpeech(prev.kind, mood, stage, streak);

  return {
    ...prev,
    streak,
    stage,
    health,
    stepsBar,
    journalBar,
    tasksBar,
    mood,
    missedDays: health === 0 ? missedDays : 0,
    lastFedDate: today,
    speech,
  };
}

function computeStage(streak: number): BuddyStage {
  if (streak >= 30) return 4;
  if (streak >= 14) return 3;
  if (streak >= 7) return 2;
  if (streak >= 3) return 1;
  return 0;
}

function computeMood(
  health: number,
  stepsBar: number,
  journalBar: number,
  missedDays: number,
): BuddyMood {
  if (missedDays >= 3) return "dead";
  if (missedDays >= 1 || health < 20) return "sick";
  if (health >= 75) return "happy";
  if (health >= 50) return "content";
  if (stepsBar < 25) return "hungry";
  if (journalBar === 0) return "lonely";
  return "content";
}

// --- Speech lines by kind ---

const SPEECH: Record<BuddyKind, Record<BuddyMood, string[]>> = {
  explorer: {
    happy: ["Great walk today.", "I like it out here.", "Let's keep going!"],
    content: ["Not bad.", "Steady day.", "We're doing alright."],
    hungry: ["My legs are stiff...", "Can we go outside?", "I need to move."],
    lonely: ["What are you thinking about?", "...", "Talk to me."],
    sick: ["I missed you.", "Where'd you go?", "I'm not feeling great."],
    dead: ["...", "Tap to start over.", ""],
  },
  oak: {
    happy: ["Soaking up the sun.", "Growing strong.", "Good roots today."],
    content: ["Still here.", "Steady growth.", "Another ring."],
    hungry: ["My soil is dry...", "Need some water.", "Wilting a bit."],
    lonely: ["The wind is quiet.", "...", "Tell me something."],
    sick: ["Leaves falling...", "Running dry.", "Help."],
    dead: ["...", "Plant a new seed.", ""],
  },
  plant: {
    happy: ["Blooming!", "Look at these petals.", "Feeling lush."],
    content: ["Growing nicely.", "Good light today.", "Steady."],
    hungry: ["So thirsty...", "Water me?", "Drooping..."],
    lonely: ["It's quiet in here.", "...", "Sing to me?"],
    sick: ["Losing leaves...", "Too dry.", "Please come back."],
    dead: ["...", "Start a new pot.", ""],
  },
};

function pickSpeech(kind: BuddyKind, mood: BuddyMood, stage: BuddyStage, streak: number): string {
  const lines = SPEECH[kind][mood];
  // Use streak + stage as a pseudo-random seed for variety
  const idx = (streak + stage) % lines.length;
  return lines[idx];
}

// --- Visual data by kind + stage ---

export const STAGE_LABELS: Record<BuddyKind, string[]> = {
  explorer: ["Egg", "Sprout", "Explorer", "Ranger", "Legend"],
  oak: ["Acorn", "Sprout", "Sapling", "Tree", "Mighty Oak"],
  plant: ["Seed", "Sprout", "Bud", "Bloom", "Full Bloom"],
};

export const STAGE_ART: Record<BuddyKind, string[]> = {
  explorer: [
    "  (o)  ",         // egg
    " \\(o.o)/\n  | \n / \\ ",   // sprout - little figure
    " 🎒\n (o.o)\n  /|\\\n  / \\ ",  // explorer
    " 🎩\n (o.o)\n  /|\\\n  / \\ ",  // ranger
    " ⛳\n (O.O)\n  /|\\\n  / \\ ",  // legend
  ],
  oak: [
    "  🌰  ",         // acorn
    "  🌱  ",         // sprout
    "  🌿\n  |\n  |  ",  // sapling
    "  🌳  ",         // tree
    " 🌳🌳\n 🌳🌳🌳",   // mighty oak
  ],
  plant: [
    "  · \n [___] ",      // seed in pot
    "  🌱 \n [___] ",     // sprout
    " 🌿🌿\n [___] ",    // bud
    " 🌸🌿\n [___] ",    // bloom
    "🌺🌸🌿\n [___] ",   // full bloom
  ],
};

export const KIND_LABELS: Record<BuddyKind, string> = {
  explorer: "Explorer",
  oak: "Oak Tree",
  plant: "Potted Plant",
};

// --- Utilities ---

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysDiff(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}
