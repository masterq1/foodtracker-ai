/**
 * HistoryScreen.js
 *
 * Shows a chronological list (newest first) of every day that has logged meals.
 * Each day is a collapsible card showing:
 *   - Date label ("Today", "Yesterday", or a formatted date string)
 *   - Total calories with a mini progress bar
 *   - Macro chips (P/C/F)
 *   - Meal count and total food weight
 *   - A "+" button to add a new manual entry directly to that day
 *
 * Expanding a day card reveals individual meal rows, each tappable to open
 * EditMealScreen for that specific meal.
 *
 * All data is loaded fresh each time the tab gains focus so edits made on
 * other screens are immediately reflected here.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getHistoryDates, getMealsForDate, getSettings, getDailyWeight, saveDailyWeight } from '../services/storage';
import { colors, spacing, fontSize, radius } from '../theme';

// ─── MacroRow Component ───────────────────────────────────────────────────────

/**
 * Row of three coloured chips showing protein, carbs, and fat in grams.
 * Reused on both the day summary and individual meal rows.
 */
function MacroRow({ protein = 0, carbs = 0, fat = 0 }) {
  return (
    <View style={macroStyles.row}>
      <View style={[macroStyles.chip, macroStyles.proteinChip]}>
        <Text style={[macroStyles.label, { color: '#1D4ED8' }]}>P</Text>
        <Text style={[macroStyles.value, { color: '#1D4ED8' }]}>{protein}g</Text>
      </View>
      <View style={[macroStyles.chip, macroStyles.carbChip]}>
        <Text style={[macroStyles.label, { color: '#C2410C' }]}>C</Text>
        <Text style={[macroStyles.value, { color: '#C2410C' }]}>{carbs}g</Text>
      </View>
      <View style={[macroStyles.chip, macroStyles.fatChip]}>
        <Text style={[macroStyles.label, { color: '#7E22CE' }]}>F</Text>
        <Text style={[macroStyles.value, { color: '#7E22CE' }]}>{fat}g</Text>
      </View>
    </View>
  );
}

const macroStyles = StyleSheet.create({
  row:         { flexDirection: 'row', gap: spacing.xs, marginTop: 4 },
  chip:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full },
  label:       { fontSize: fontSize.xs, fontWeight: '800', marginRight: 2 },
  value:       { fontSize: fontSize.xs, fontWeight: '600' },
  proteinChip: { backgroundColor: '#EFF6FF' },
  carbChip:    { backgroundColor: '#FFF7ED' },
  fatChip:     { backgroundColor: '#FDF4FF' },
});

// ─── CalorieBar Component ─────────────────────────────────────────────────────

/**
 * Thin horizontal progress bar showing how close a day's calories are to the goal.
 * Turns red when the goal is exceeded.
 */
function CalorieBar({ calories, goal = 2000 }) {
  const ratio = Math.min(calories / goal, 1); // cap at 100% visually
  const isOver = calories > goal;
  return (
    <View style={{ marginTop: 5 }}>
      <View style={barStyles.bg}>
        <View
          style={[
            barStyles.fill,
            {
              width:           `${ratio * 100}%`,
              backgroundColor: isOver ? colors.error : colors.primary,
            },
          ]}
        />
      </View>
    </View>
  );
}

const barStyles = StyleSheet.create({
  bg:   { height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HistoryScreen({ navigation }) {
  // Each element: { date, meals[], totalCalories, totalWeight, totalProtein, totalCarbs, totalFat }
  const [historyDays, setHistoryDays] = useState([]);

  // Tracks which day card is currently expanded (null = all collapsed)
  const [expandedDay, setExpandedDay] = useState(null);

  // Body weight tracking
  const [bodyWeightEnabled, setBodyWeightEnabled] = useState(false);
  const [weightUnit, setWeightUnit]               = useState('lbs');
  // Stored weights per day: { [dateKey]: number | null }
  const [weights, setWeights]                     = useState({});
  // Text input values per day: { [dateKey]: string }
  const [weightInputs, setWeightInputs]           = useState({});
  // Which dateKey is currently mid-save (shows spinner)
  const [savingWeightFor, setSavingWeightFor]     = useState(null);

  // ── Data Loading ──

  /**
   * Re-load history every time this tab gains focus.
   * This ensures that meals added/edited on the Home or EditMeal screens
   * are reflected here without needing a manual refresh.
   */
  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [])
  );

  /**
   * Fetches all dates that have saved meals, computes per-day totals,
   * and loads body weight readings if that feature is enabled.
   */
  async function loadHistory() {
    const [dates, settings] = await Promise.all([getHistoryDates(), getSettings()]);

    const enabled = !!settings.bodyWeightEnabled;
    setBodyWeightEnabled(enabled);
    setWeightUnit(settings.weightUnit || 'lbs');

    const days = await Promise.all(
      dates.map(async (date) => {
        const meals = await getMealsForDate(date);
        const totalCalories = meals.reduce((s, m) => s + (m.totalCalories    || 0), 0);
        const totalWeight   = meals.reduce((s, m) => s + (m.totalWeightGrams || 0), 0);
        const totalProtein  = meals.reduce((s, m) => s + (m.proteinGrams     || 0), 0);
        const totalCarbs    = meals.reduce((s, m) => s + (m.carbsGrams       || 0), 0);
        const totalFat      = meals.reduce((s, m) => s + (m.fatGrams         || 0), 0);
        return { date, meals, totalCalories, totalWeight, totalProtein, totalCarbs, totalFat };
      })
    );
    setHistoryDays(days);

    // Load weight readings for all history dates (only when feature is on)
    if (enabled) {
      const weightMap = {};
      const inputMap  = {};
      await Promise.all(dates.map(async (date) => {
        const w = await getDailyWeight(date);
        weightMap[date] = w;
        inputMap[date]  = w !== null ? String(w) : '';
      }));
      setWeights(weightMap);
      setWeightInputs(inputMap);
    }
  }

  /** Saves a body weight reading for the given date key. */
  async function handleSaveWeight(dateKey) {
    const val = parseFloat(weightInputs[dateKey]);
    if (isNaN(val) || val <= 0) {
      Alert.alert('Invalid Weight', 'Enter a positive number.');
      return;
    }
    setSavingWeightFor(dateKey);
    try {
      await saveDailyWeight(dateKey, val);
      setWeights(prev => ({ ...prev, [dateKey]: val }));
    } finally {
      setSavingWeightFor(null);
    }
  }

  // ── Formatting Helpers ──

  /**
   * Returns a human-friendly label for a YYYY-MM-DD date string:
   *   today     → "Today"
   *   yesterday → "Yesterday"
   *   other     → abbreviated weekday + month + day (e.g. "Sat, April 19")
   *
   * The +T12:00:00 trick keeps the Date constructor in local noon so
   * timezone offsets don't accidentally roll the date forward or backward.
   */
  function formatDateLabel(dateStr) {
    const todayStr = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (dateStr === todayStr)     return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';

    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'long', day: 'numeric',
    });
  }

  /**
   * Formats an ISO timestamp as a short 12-hour clock time (e.g. "02:45 PM").
   */
  function formatMealTime(isoString) {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ── Navigation Handlers ──

  /**
   * Opens the detail view for a tapped meal.
   * The user can choose to edit from the detail screen.
   */
  function handleMealPress(meal, dateKey) {
    navigation.navigate('MealDetail', { meal, dateKey });
  }

  /**
   * Opens EditMealScreen to add a brand-new manual entry to the given date.
   * Uses isNew=true so the screen calls saveMeal() instead of updateMeal().
   */
  function handleAddMeal(dateKey) {
    navigation.navigate('EditMeal', {
      meal: {
        foodName:         '',
        totalCalories:    0,
        totalWeightGrams: 0,
        proteinGrams:     0,
        carbsGrams:       0,
        fatGrams:         0,
        ingredients:      [],
      },
      dateKey,
      isNew: true,
    });
  }

  // ── Empty State ──

  if (historyDays.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>History</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyTitle}>No history yet</Text>
          <Text style={styles.emptySubtext}>Start logging meals to see your history here</Text>
        </View>
      </View>
    );
  }

  // ── Render ──

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>{historyDays.length} days tracked</Text>
      </View>

      <FlatList
        data={historyDays}
        keyExtractor={(item) => item.date}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const isExpanded = expandedDay === item.date;

          return (
            <View style={styles.dayCard}>

              {/* ── Day Header Row ── */}
              {/* Tapping expands/collapses the meal list below */}
              <TouchableOpacity
                style={styles.dayHeader}
                onPress={() => setExpandedDay(isExpanded ? null : item.date)}
                activeOpacity={0.7}
              >
                {/* Left side: date label, raw date, calorie bar, macros, optional body weight */}
                <View style={styles.dayLeft}>
                  <Text style={styles.dayLabel}>{formatDateLabel(item.date)}</Text>
                  <Text style={styles.dayDateStr}>{item.date}</Text>
                  <CalorieBar calories={item.totalCalories} />
                  <MacroRow protein={item.totalProtein} carbs={item.totalCarbs} fat={item.totalFat} />
                  {bodyWeightEnabled && weights[item.date] != null && (
                    <View style={styles.dayBodyWeightBadge}>
                      <Text style={styles.dayBodyWeightText}>⚖️ {weights[item.date]} {weightUnit}</Text>
                    </View>
                  )}
                </View>

                {/* Right side: total calories + meal count + food weight */}
                <View style={styles.dayRight}>
                  <Text style={styles.dayCalories}>{item.totalCalories.toLocaleString()}</Text>
                  <Text style={styles.dayCalLabel}>cal</Text>
                  <Text style={styles.dayMealCount}>{item.meals.length} meals</Text>
                  <Text style={styles.dayWeight}>{item.totalWeight}g</Text>
                </View>

                {/* Chevron only in the header — add button moved to bottom of expanded list */}
                <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {/* ── Expanded Meal List ── */}
              {isExpanded && (
                <View style={styles.mealsList}>
                  {item.meals.map((meal, idx) => (
                    <TouchableOpacity
                      key={meal.id}
                      style={[
                        styles.mealRow,
                        idx === item.meals.length - 1 && styles.mealRowLast,
                      ]}
                      onPress={() => handleMealPress(meal, item.date)}
                      activeOpacity={0.75}
                    >
                      {/* Meal thumbnail or fallback emoji */}
                      {meal.imageUri ? (
                        <Image source={{ uri: meal.imageUri }} style={styles.mealThumb} />
                      ) : (
                        <View style={[styles.mealThumb, styles.mealThumbFallback]}>
                          <Text style={{ fontSize: 22 }}>🍽️</Text>
                        </View>
                      )}

                      {/* Meal name, logged time, and macro chips */}
                      <View style={styles.mealInfo}>
                        <Text style={styles.mealName} numberOfLines={1}>{meal.foodName}</Text>
                        <Text style={styles.mealTime}>{formatMealTime(meal.timestamp)}</Text>
                        <MacroRow protein={meal.proteinGrams} carbs={meal.carbsGrams} fat={meal.fatGrams} />
                      </View>

                      {/* Calorie + weight stats and "edit" hint */}
                      <View style={styles.mealStats}>
                        <Text style={styles.mealCal}>{meal.totalCalories}</Text>
                        <Text style={styles.mealCalLabel}>cal</Text>
                        <Text style={styles.mealWeight}>{meal.totalWeightGrams}g</Text>
                        <Text style={styles.editHint}>edit</Text>
                      </View>
                    </TouchableOpacity>
                  ))}

                  {/* Day total summary bar */}
                  {item.meals.length > 0 && (
                    <View style={styles.daySummaryRow}>
                      <Text style={styles.daySummaryText}>
                        Total: {item.totalCalories.toLocaleString()} cal · P {item.totalProtein}g · C {item.totalCarbs}g · F {item.totalFat}g · {item.totalWeight.toLocaleString()}g
                      </Text>
                    </View>
                  )}

                  {/* Body weight entry row — only when feature is enabled */}
                  {bodyWeightEnabled && (
                    <View style={styles.weightEntryRow}>
                      <Text style={styles.weightEntryLabel}>⚖️ Body weight</Text>
                      <TextInput
                        style={styles.weightEntryInput}
                        value={weightInputs[item.date] || ''}
                        onChangeText={(v) =>
                          setWeightInputs(prev => ({ ...prev, [item.date]: v }))
                        }
                        keyboardType="decimal-pad"
                        placeholder="0.0"
                        placeholderTextColor={colors.border}
                        selectTextOnFocus
                      />
                      <Text style={styles.weightEntryUnit}>{weightUnit}</Text>
                      <TouchableOpacity
                        style={[
                          styles.weightEntrySaveBtn,
                          savingWeightFor !== null && styles.weightEntrySaveBtnDisabled,
                        ]}
                        onPress={() => handleSaveWeight(item.date)}
                        disabled={savingWeightFor !== null}
                        activeOpacity={0.8}
                      >
                        {savingWeightFor === item.date
                          ? <ActivityIndicator size="small" color={colors.white} />
                          : <Text style={styles.weightEntrySaveBtnText}>Save</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Full-width add button — easy to tap, clear label */}
                  <TouchableOpacity
                    style={styles.addMealRowBtn}
                    onPress={() => handleAddMeal(item.date)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.addMealRowText}>+ Add Meal</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header:    { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  title:     { fontSize: fontSize.xxxl, fontWeight: '800', color: colors.text },
  subtitle:  { fontSize: fontSize.md, color: colors.textSecondary, marginTop: 2 },

  listContent: { padding: spacing.md, paddingBottom: spacing.xxl },

  // Empty state
  emptyState:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  emptyIcon:    { fontSize: 64, marginBottom: spacing.md },
  emptyTitle:   { fontSize: fontSize.xl, fontWeight: '700', color: colors.textSecondary },
  emptySubtext: { fontSize: fontSize.md, color: colors.border, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },

  // Day card
  dayCard: {
    backgroundColor: colors.white,
    borderRadius:    radius.lg,
    marginBottom:    spacing.md,
    overflow:        'hidden',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.07,
    shadowRadius:    10,
    elevation:       3,
  },

  // Day header row layout
  dayHeader:    { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  dayLeft:      { flex: 1 },
  dayLabel:     { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  dayDateStr:   { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  dayRight:     { alignItems: 'flex-end', marginRight: spacing.xs },
  dayCalories:  { fontSize: fontSize.xxl, fontWeight: '800', color: colors.primary },
  dayCalLabel:  { fontSize: fontSize.xs, color: colors.textSecondary },
  dayMealCount: { fontSize: fontSize.sm, color: colors.textSecondary },
  dayWeight:    { fontSize: fontSize.sm, color: colors.textSecondary },

  chevron: { fontSize: fontSize.sm, color: colors.textSecondary, width: 18, textAlign: 'center', marginLeft: spacing.xs },

  // Full-width add meal button at the bottom of the expanded meal list
  addMealRowBtn:  { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.md, alignItems: 'center' },
  addMealRowText: { fontSize: fontSize.md, color: colors.primary, fontWeight: '700' },

  // Expanded meal list
  mealsList:  { borderTopWidth: 1, borderTopColor: colors.border },
  mealRow:    { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.background },
  mealRowLast:{ borderBottomWidth: 0 },
  mealThumb:  { width: 56, height: 56, borderRadius: radius.sm, marginRight: spacing.sm },
  mealThumbFallback: { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  mealInfo:   { flex: 1, marginRight: spacing.sm },
  mealName:   { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  mealTime:   { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  mealStats:  { alignItems: 'flex-end' },
  mealCal:    { fontSize: fontSize.xl, fontWeight: '800', color: colors.primary },
  mealCalLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  mealWeight: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  editHint:   { fontSize: fontSize.xs, color: colors.border, marginTop: 3 },

  // Day total summary strip at the bottom of expanded meals
  daySummaryRow:  { backgroundColor: colors.primaryLight, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  daySummaryText: { fontSize: fontSize.sm, color: colors.primaryDark, fontWeight: '600' },

  // Body weight badge shown in day header left column when a reading exists
  dayBodyWeightBadge: { alignSelf: 'flex-start', marginTop: 5, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.full, backgroundColor: '#EFF6FF' },
  dayBodyWeightText:  { fontSize: fontSize.xs, fontWeight: '600', color: '#1D4ED8' },

  // Body weight entry row inside expanded section
  weightEntryRow:          { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  weightEntryLabel:        { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1 },
  weightEntryInput:        { width: 72, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: spacing.xs, fontSize: fontSize.md, fontWeight: '700', color: colors.text, textAlign: 'center', backgroundColor: colors.background },
  weightEntryUnit:         { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  weightEntrySaveBtn:      { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, backgroundColor: colors.primary, borderRadius: radius.sm, minWidth: 52, alignItems: 'center' },
  weightEntrySaveBtnDisabled: { opacity: 0.5 },
  weightEntrySaveBtnText:  { fontSize: fontSize.sm, color: colors.white, fontWeight: '700' },
});
