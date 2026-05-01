/**
 * storage.js
 *
 * All local persistence for the Food Tracker app.
 * Uses AsyncStorage (key-value store) to save:
 *   - App settings (API key, calorie goal)
 *   - Meal entries, grouped by date
 *   - AI model priority order chosen by the user
 *   - Per-model request counts for the current day
 *
 * AsyncStorage key layout:
 *   @food_tracker_settings        → { apiKey, dailyCalorieGoal }
 *   @meals_YYYY-MM-DD             → array of meal objects for that date
 *   @model_priority               → [modelId, modelId, modelId]  (3-slot priority list)
 *   @model_usage_<modelId>        → { date: 'YYYY-MM-DD', count: N }
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Storage Key Constants ────────────────────────────────────────────────────

const SETTINGS_KEY = '@food_tracker_settings'; // single object holding all app settings
const MEALS_PREFIX  = '@meals_';               // followed by YYYY-MM-DD date string

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns a zero-padded YYYY-MM-DD string for the given date (defaults to today).
 * Used as both a human-readable label and the AsyncStorage key suffix for meals.
 */
export function getDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0'); // months are 0-indexed
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * Persists the full settings object.
 * Expected shape: { apiKey, dailyCalorieGoal, averageDays, weightUnit }
 */
export async function saveSettings(settings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Loads app settings. Returns safe defaults if nothing has been saved yet
 * or if the stored value is corrupt/unreadable.
 */
export async function getSettings() {
  try {
    const data = await AsyncStorage.getItem(SETTINGS_KEY);
    const base = { apiKey: '', dailyCalorieGoal: 2000, averageDays: 5, weightUnit: 'lbs', autoSaveToGallery: false, bodyWeightEnabled: false };
    return data ? { ...base, ...JSON.parse(data) } : base;
  } catch {
    return { apiKey: '', dailyCalorieGoal: 2000, averageDays: 5, weightUnit: 'lbs', autoSaveToGallery: false, bodyWeightEnabled: false };
  }
}

// ─── Meal CRUD ────────────────────────────────────────────────────────────────

/**
 * Saves a new meal entry to the given date (or today if no dateKey provided).
 * Assigns a unique numeric ID (milliseconds since epoch) and a timestamp.
 * Returns the updated full array of meals for that day.
 *
 * The meal object should include fields from the Gemini analysis:
 *   foodName, totalCalories, totalWeightGrams, proteinGrams, carbsGrams,
 *   fatGrams, glucoseRiseMgDl, ingredients, confidence, notes,
 *   imageUri (local file path), analyzedByModel (model ID string)
 */
export async function saveMeal(meal, dateKey = null) {
  const dk  = dateKey || getDateKey(); // fall back to today if no date provided
  const key = `${MEALS_PREFIX}${dk}`;

  // Load whatever is already stored for this day so we can append
  const existing = await getMealsForDate(dk);

  const newMeal = {
    ...meal,
    id:        Date.now(),              // unique ID for later lookup/deletion
    timestamp: new Date().toISOString(), // ISO string for display formatting
  };

  const updated = [...existing, newMeal];
  await AsyncStorage.setItem(key, JSON.stringify(updated));
  return updated;
}

/**
 * Saves a meal exactly as given — does NOT overwrite id or timestamp.
 * Used when the user specifies a custom date/time, or when moving a meal
 * from one day to another while preserving its identity.
 */
export async function addMealDirect(meal, dateKey) {
  const key      = `${MEALS_PREFIX}${dateKey}`;
  const existing = await getMealsForDate(dateKey);
  const updated  = [...existing, meal];
  await AsyncStorage.setItem(key, JSON.stringify(updated));
  return updated;
}

/**
 * Replaces a single meal in a day's list, matched by meal.id.
 * Used by EditMealScreen when the user modifies an existing entry.
 * Returns the updated array.
 */
export async function updateMeal(dateKey, updatedMeal) {
  const meals   = await getMealsForDate(dateKey);
  const updated = meals.map((m) => (m.id === updatedMeal.id ? updatedMeal : m));
  const key     = `${MEALS_PREFIX}${dateKey}`;
  await AsyncStorage.setItem(key, JSON.stringify(updated));
  return updated;
}

/**
 * Returns all meals stored for the given YYYY-MM-DD date string.
 * Returns an empty array if nothing has been logged that day or on any error.
 */
export async function getMealsForDate(dateKey) {
  try {
    const key  = `${MEALS_PREFIX}${dateKey}`;
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Removes a single meal from a day's list by its numeric id.
 * Returns the updated array after deletion.
 */
export async function deleteMeal(dateKey, mealId) {
  const meals   = await getMealsForDate(dateKey);
  const updated = meals.filter((m) => m.id !== mealId);
  const key     = `${MEALS_PREFIX}${dateKey}`;
  await AsyncStorage.setItem(key, JSON.stringify(updated));
  return updated;
}

/**
 * Returns a list of all date strings (YYYY-MM-DD) that have saved meals,
 * sorted newest-first. Used by HistoryScreen to build the list of past days.
 */
export async function getHistoryDates() {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    return allKeys
      .filter((k) => k.startsWith(MEALS_PREFIX))     // only meal keys
      .map((k) => k.replace(MEALS_PREFIX, ''))         // strip the prefix to get bare date
      .sort((a, b) => b.localeCompare(a));             // newest date string first
  } catch {
    return [];
  }
}

/**
 * Deletes all meal data (but NOT settings or model preferences).
 * Called from the Danger Zone section of SettingsScreen.
 */
export async function clearAllData() {
  const allKeys  = await AsyncStorage.getAllKeys();
  const mealKeys = allKeys.filter((k) => k.startsWith(MEALS_PREFIX));
  await AsyncStorage.multiRemove(mealKeys);
}

// ─── Daily Weight ─────────────────────────────────────────────────────────────

const WEIGHT_PREFIX = '@weight_'; // followed by YYYY-MM-DD

/** Saves a body weight reading for the given date (in whichever unit the user chose). */
export async function saveDailyWeight(dateKey, weight) {
  await AsyncStorage.setItem(`${WEIGHT_PREFIX}${dateKey}`, String(weight));
}

/** Returns the stored weight for the given date, or null if none has been recorded. */
export async function getDailyWeight(dateKey) {
  try {
    const val = await AsyncStorage.getItem(`${WEIGHT_PREFIX}${dateKey}`);
    return val !== null ? parseFloat(val) : null;
  } catch {
    return null;
  }
}

// ─── Model Priority & Usage ───────────────────────────────────────────────────

const MODEL_PRIORITY_KEY = '@model_priority';  // stores the 3-element priority array
const MODEL_USAGE_PREFIX = '@model_usage_';    // followed by modelId

/**
 * Master catalog of all Gemini models the app knows about.
 * Each entry describes:
 *   id             — the exact string used in the Gemini API URL
 *   name           — human-readable display name
 *   dailyLimit     — known free-tier requests-per-day quota
 *   badge          — emoji shown next to the model name in the UI
 *   recommendedSlot — suggested priority position (1/2/3) or null if no recommendation
 */
export const AVAILABLE_MODELS = [
  { id: 'gemini-2.0-flash',       name: 'Gemini 2.0 Flash',       dailyLimit: 1500, badge: '⚡', recommendedSlot: 1 },
  { id: 'gemini-2.5-flash',       name: 'Gemini 2.5 Flash',       dailyLimit: 25,   badge: '🧠', recommendedSlot: 2 },
  { id: 'gemini-2.5-flash-lite',  name: 'Gemini 2.5 Flash Lite',  dailyLimit: 30,   badge: '💨', recommendedSlot: 3 },
  { id: 'gemini-flash-latest',    name: 'Gemini Flash Latest',     dailyLimit: 1500, badge: '🔥', recommendedSlot: null },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview',  dailyLimit: 25,   badge: '🚀', recommendedSlot: null },
];

/**
 * The built-in default priority order used when the user hasn't customised anything.
 * Ordered to maximise free-tier usage:
 *   1. gemini-2.0-flash  — 1500 RPD, fast, good quality → use first
 *   2. gemini-2.5-flash  — 25 RPD, smarter → fallback when 2.0 fails
 *   3. gemini-2.5-flash-lite — 30 RPD, lighter → final fallback
 */
export const DEFAULT_MODEL_PRIORITY = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

/**
 * Returns the user's saved 3-slot model priority array.
 * Falls back to DEFAULT_MODEL_PRIORITY if nothing is stored or the data is invalid.
 */
export async function getModelPriority() {
  try {
    const data = await AsyncStorage.getItem(MODEL_PRIORITY_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      // Validate: must be an array of exactly 3 elements
      if (Array.isArray(parsed) && parsed.length === 3) return parsed;
    }
  } catch {}
  // Return a fresh copy of the default so callers can't accidentally mutate the constant
  return [...DEFAULT_MODEL_PRIORITY];
}

/**
 * Persists the 3-slot priority array chosen by the user in SettingsScreen.
 * Called immediately whenever the user reorders or swaps a model.
 */
export async function saveModelPriority(priority) {
  await AsyncStorage.setItem(MODEL_PRIORITY_KEY, JSON.stringify(priority));
}

/**
 * Returns how many times the given model has been used today.
 * Counters reset automatically each calendar day — if the stored date
 * doesn't match today, 0 is returned (treating it as a fresh day).
 */
export async function getModelUsageToday(modelId) {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const data  = await AsyncStorage.getItem(`${MODEL_USAGE_PREFIX}${modelId}`);
    if (!data) return 0;
    const parsed = JSON.parse(data);
    // If the stored date is a previous day, the counter has naturally reset
    return parsed.date === today ? parsed.count : 0;
  } catch {
    return 0;
  }
}

/**
 * Increments today's usage counter for the given model by 1.
 * Called only after a successful API response (never on failure) to
 * avoid inflating the count with requests that didn't consume quota.
 */
export async function incrementModelUsage(modelId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const count = await getModelUsageToday(modelId);
    await AsyncStorage.setItem(
      `${MODEL_USAGE_PREFIX}${modelId}`,
      JSON.stringify({ date: today, count: count + 1 })
    );
  } catch {}
}
