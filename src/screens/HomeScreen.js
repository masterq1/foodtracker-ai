/**
 * HomeScreen.js
 *
 * The main daily view of the app. Shows a summary card for the currently
 * viewed date and a list of all meals logged that day.
 *
 * Key features:
 *   - Date navigation (← / →) to browse and add meals on any date, not just today
 *   - "Jump to Today" chip when viewing a past or future date
 *   - Daily calorie progress bar and macro totals
 *   - Floating "Add Food Photo" button that opens an action sheet with three paths:
 *       1. Add Manually → EditMealScreen (no AI, all fields typed by hand)
 *       2. Choose from Gallery → image picker → AnalysisScreen
 *       3. Take Photo → camera → AnalysisScreen
 *   - Tapping any meal card navigates to EditMealScreen for editing/deletion
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMealsForDate, getDateKey, getSettings, getHistoryDates, saveDailyWeight, getDailyWeight } from '../services/storage';
import { colors, spacing, fontSize, radius } from '../theme';

// ─── MacroRow Component ───────────────────────────────────────────────────────

/**
 * Small row of coloured chips showing P / C / F values.
 * Used both in the per-meal cards and could be reused elsewhere.
 */
function MacroRow({ protein = 0, carbs = 0, fat = 0, style }) {
  return (
    <View style={[macroStyles.row, style]}>
      {/* Protein chip — blue */}
      <View style={[macroStyles.chip, macroStyles.proteinChip]}>
        <Text style={[macroStyles.chipLabel, { color: '#1D4ED8' }]}>P</Text>
        <Text style={[macroStyles.chipValue, { color: '#1D4ED8' }]}>{protein}g</Text>
      </View>
      {/* Carbs chip — orange */}
      <View style={[macroStyles.chip, macroStyles.carbChip]}>
        <Text style={[macroStyles.chipLabel, { color: '#C2410C' }]}>C</Text>
        <Text style={[macroStyles.chipValue, { color: '#C2410C' }]}>{carbs}g</Text>
      </View>
      {/* Fat chip — purple */}
      <View style={[macroStyles.chip, macroStyles.fatChip]}>
        <Text style={[macroStyles.chipLabel, { color: '#7E22CE' }]}>F</Text>
        <Text style={[macroStyles.chipValue, { color: '#7E22CE' }]}>{fat}g</Text>
      </View>
    </View>
  );
}

const macroStyles = StyleSheet.create({
  row:         { flexDirection: 'row', gap: spacing.xs },
  chip:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.full },
  chipLabel:   { fontSize: fontSize.xs, fontWeight: '800', marginRight: 2 },
  chipValue:   { fontSize: fontSize.xs, fontWeight: '600' },
  proteinChip: { backgroundColor: '#EFF6FF' },
  carbChip:    { backgroundColor: '#FFF7ED' },
  fatChip:     { backgroundColor: '#FDF4FF' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }) {
  // Safe-area insets so the FAB doesn't overlap the Android navigation bar
  const insets = useSafeAreaInsets();

  // ── State ──
  const [meals, setMeals]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [calorieGoal, setCalorieGoal] = useState(2000);
  const [avgCalories, setAvgCalories]       = useState(null);
  const [averageDays, setAverageDays]       = useState(5);
  const [weightUnit, setWeightUnit]         = useState('lbs');
  const [bodyWeightEnabled, setBodyWeightEnabled] = useState(false);
  const [todayWeight, setTodayWeight]       = useState(null);
  const [weightInput, setWeightInput]       = useState('');
  const [savingWeight, setSavingWeight]     = useState(false);
  const [avgWeight, setAvgWeight]           = useState(null);
  const [avgWeightDays, setAvgWeightDays]   = useState(0);

  // The date currently being viewed/edited — starts as today, navigable via arrows
  const [viewDate, setViewDate] = useState(getDateKey());

  // Today's date key, used to disable the forward arrow and show "Jump to Today"
  const todayKey = getDateKey();

  // ── Data Loading ──

  /**
   * Reload meals and settings whenever the screen comes into focus OR when
   * viewDate changes. Including viewDate in the deps array causes useFocusEffect
   * to re-subscribe (and therefore re-fire) whenever the date changes.
   */
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [viewDate])
  );

  /**
   * Fetches meals, settings, average calories, and today's weight in parallel.
   */
  async function loadData() {
    const [dayMeals, settings, storedWeight] = await Promise.all([
      getMealsForDate(viewDate),
      getSettings(),
      getDailyWeight(viewDate),
    ]);
    setMeals(dayMeals);
    setCalorieGoal(settings.dailyCalorieGoal || 2000);
    setAverageDays(settings.averageDays || 5);
    setWeightUnit(settings.weightUnit || 'lbs');
    setBodyWeightEnabled(!!settings.bodyWeightEnabled);
    setTodayWeight(storedWeight);
    setWeightInput(storedWeight !== null ? String(storedWeight) : '');

    // Compute rolling average over the last N history days
    const nDays = settings.averageDays || 5;
    const dates = await getHistoryDates();
    const recentDates = dates.slice(0, nDays);
    if (recentDates.length > 0) {
      const calTotals = await Promise.all(
        recentDates.map(async (d) => {
          const ms = await getMealsForDate(d);
          return ms.reduce((s, m) => s + (m.totalCalories || 0), 0);
        })
      );
      const avg = Math.round(calTotals.reduce((s, v) => s + v, 0) / calTotals.length);
      setAvgCalories(avg);
    } else {
      setAvgCalories(null);
    }

    // Compute average body weight over the last N calendar days that have a reading
    if (settings.bodyWeightEnabled) {
      const readings = [];
      const now = new Date();
      for (let i = 0; i < nDays; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const w = await getDailyWeight(getDateKey(d));
        if (w !== null) readings.push(w);
      }
      if (readings.length > 0) {
        const avg = readings.reduce((s, v) => s + v, 0) / readings.length;
        setAvgWeight(Math.round(avg * 10) / 10); // one decimal place
        setAvgWeightDays(readings.length);
      } else {
        setAvgWeight(null);
        setAvgWeightDays(0);
      }
    } else {
      setAvgWeight(null);
    }
  }

  async function handleSaveWeight() {
    const val = parseFloat(weightInput);
    if (isNaN(val) || val <= 0) {
      Alert.alert('Invalid Weight', 'Enter a positive number.');
      return;
    }
    setSavingWeight(true);
    try {
      await saveDailyWeight(viewDate, val);
      await loadData();
    } finally {
      setSavingWeight(false);
    }
  }

  // ── Date Navigation ──

  /**
   * Moves the viewed date forward (+1) or backward (-1) by one calendar day.
   * Constructs the new date at noon to avoid any timezone/DST edge cases
   * that could cause the date to roll over unexpectedly.
   */
  function changeDate(delta) {
    const d = new Date(viewDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setViewDate(getDateKey(d));
  }

  /**
   * Returns a human-friendly label for the given date key:
   *   today     → full weekday + month + day (e.g. "Monday, April 21")
   *   yesterday → "Yesterday"
   *   other     → short weekday + month + day (e.g. "Sat, April 19")
   */
  function formatDateNav(dateKey) {
    if (dateKey === todayKey) {
      return new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      });
    }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateKey === getDateKey(yesterday)) return 'Yesterday';
    return new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }

  // ── Add Food Flow ──

  /**
   * Entry point for adding a new meal. First checks that an API key is
   * configured (required for AI analysis). Then presents an action sheet
   * with three options: manual entry, gallery, or camera.
   */
  async function handleAddFood() {
    const settings = await getSettings();

    // Gate: if no API key, offer to go to Settings rather than letting the user
    // go through the image flow only to hit an error at analysis time
    if (!settings.apiKey) {
      Alert.alert(
        'API Key Required',
        'Please add your Google AI API key in Settings to enable food analysis.',
        [
          { text: 'Go to Settings', onPress: () => navigation.getParent()?.navigate('SettingsTab') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    Alert.alert('Add Meal', 'How would you like to add your food?', [
      // Manual entry — opens EditMealScreen with all-zero defaults and isNew=true
      {
        text: 'Add Manually',
        onPress: () => navigation.navigate('EditMeal', {
          meal: { foodName: '', totalCalories: 0, totalWeightGrams: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0, ingredients: [] },
          dateKey: viewDate, // save to the currently viewed date, not necessarily today
          isNew: true,
        }),
      },
      { text: 'Choose from Gallery', onPress: () => pickImage('gallery') },
      { text: 'Take Photo',          onPress: () => pickImage('camera') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  /**
   * Opens either the camera or the photo gallery to select an image for analysis.
   * Requests the appropriate permission first.
   *
   * Important: allowsEditing and aspect are intentionally NOT set here.
   * On Android, those options show a crop UI with no confirm button, leaving
   * the user stuck. Sending the full uncropped image works fine for AI analysis.
   *
   * On success, navigates to AnalysisScreen with:
   *   imageUri  — local URI for displaying the preview
   *   base64    — base64-encoded image data to send to the Gemini API
   *   dateKey   — the date this meal should be saved to
   */
  async function pickImage(source) {
    try {
      let result;

      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Needed', 'Please allow camera access to photograph your meals.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality:    0.7, // reduce file size while keeping enough detail for AI analysis
          base64:     true, // request base64 so we can send it directly to the API
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Needed', 'Please allow photo library access.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality:    0.7,
          base64:     true,
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        const { uri, base64 } = result.assets[0];
        if (!base64) {
          Alert.alert('Error', 'Could not read image data. Please try again.');
          return;
        }
        // Pass the date along so AnalysisScreen can save the meal to the right day
        navigation.navigate('Analysis', { imageUri: uri, base64, dateKey: viewDate });
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to open image picker: ' + err.message);
    }
  }

  /**
   * Opens the detail view for a tapped meal.
   * The user can then choose to edit from the detail screen.
   */
  function handleEditMeal(meal) {
    navigation.navigate('MealDetail', { meal, dateKey: viewDate });
  }

  // ── Derived Totals ──

  // Sum up all nutritional values across every meal logged today
  const totalCalories = meals.reduce((sum, m) => sum + (m.totalCalories    || 0), 0);
  const totalWeight   = meals.reduce((sum, m) => sum + (m.totalWeightGrams || 0), 0);
  const totalProtein  = meals.reduce((sum, m) => sum + (m.proteinGrams     || 0), 0);
  const totalCarbs    = meals.reduce((sum, m) => sum + (m.carbsGrams       || 0), 0);
  const totalFat      = meals.reduce((sum, m) => sum + (m.fatGrams         || 0), 0);

  // Progress bar fill ratio — capped at 1.0 (100%) so the bar doesn't overflow
  const progressRatio = Math.min(totalCalories / calorieGoal, 1);
  const remaining     = calorieGoal - totalCalories;
  const isOver        = remaining < 0; // true when user has exceeded their goal

  /**
   * Formats a meal's ISO timestamp as a 12-hour clock time (e.g. "02:45 PM").
   */
  function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ── Render ──

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Header with date navigation ── */}
        <View style={styles.header}>
          <Text style={styles.title}>Food Tracker</Text>

          {/* Date navigation bar: back arrow | date label | forward arrow */}
          <View style={styles.dateNav}>

            {/* Back arrow — always enabled; goes to the previous day */}
            <TouchableOpacity
              style={styles.navArrow}
              onPress={() => changeDate(-1)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.navArrowText}>‹</Text>
            </TouchableOpacity>

            {/* Centre section: date label + "Jump to Today" chip when not on today */}
            <View style={styles.dateCenter}>
              <Text style={styles.dateText}>{formatDateNav(viewDate)}</Text>
              {viewDate !== todayKey && (
                <TouchableOpacity
                  style={styles.todayChip}
                  onPress={() => setViewDate(todayKey)}
                >
                  <Text style={styles.todayChipText}>Jump to Today</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Forward arrow — disabled once we reach today; can't log future days */}
            <TouchableOpacity
              style={[styles.navArrow, viewDate >= todayKey && styles.navArrowDisabled]}
              onPress={() => changeDate(1)}
              disabled={viewDate >= todayKey}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.navArrowText, viewDate >= todayKey && { opacity: 0.2 }]}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Daily Summary Card ── */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Today's Summary</Text>

          {/* Calorie progress row: consumed | bar | remaining */}
          <View style={styles.calorieRow}>
            <View style={styles.calorieStat}>
              <Text style={styles.calorieNumber}>{totalCalories.toLocaleString()}</Text>
              <Text style={styles.calorieLabel}>consumed</Text>
            </View>

            <View style={styles.progressSection}>
              {/* Progress bar — turns red if the user is over their goal */}
              <View style={styles.progressBg}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width:           `${progressRatio * 100}%`,
                      backgroundColor: isOver ? colors.error : colors.primary,
                    },
                  ]}
                />
              </View>
              <Text style={styles.goalLabel}>Goal: {calorieGoal.toLocaleString()} cal</Text>
            </View>

            {/* Remaining / over — colour changes to red when over goal */}
            <View style={styles.calorieStat}>
              <Text style={[styles.calorieNumber, { color: isOver ? colors.error : colors.primary }]}>
                {Math.abs(remaining).toLocaleString()}
              </Text>
              <Text style={styles.calorieLabel}>{isOver ? 'over goal' : 'remaining'}</Text>
            </View>
          </View>

          {/* Rolling average calorie strip */}
          {avgCalories !== null && (
            <View style={styles.avgRow}>
              <Text style={styles.avgText}>
                {averageDays}-day avg: <Text style={styles.avgValue}>{avgCalories.toLocaleString()} cal/day</Text>
              </Text>
            </View>
          )}

          {/* Macro totals row at the bottom of the summary card */}
          <View style={styles.macroSummaryRow}>
            <View style={styles.macroSumItem}>
              <Text style={[styles.macroSumValue, { color: '#1D4ED8' }]}>{totalProtein}g</Text>
              <Text style={styles.macroSumLabel}>Protein</Text>
            </View>
            <View style={styles.macroSumDivider} />
            <View style={styles.macroSumItem}>
              <Text style={[styles.macroSumValue, { color: '#C2410C' }]}>{totalCarbs}g</Text>
              <Text style={styles.macroSumLabel}>Carbs</Text>
            </View>
            <View style={styles.macroSumDivider} />
            <View style={styles.macroSumItem}>
              <Text style={[styles.macroSumValue, { color: '#7E22CE' }]}>{totalFat}g</Text>
              <Text style={styles.macroSumLabel}>Fat</Text>
            </View>
            <View style={styles.macroSumDivider} />
            <View style={styles.macroSumItem}>
              <Text style={styles.macroSumValue}>{totalWeight.toLocaleString()}g</Text>
              <Text style={styles.macroSumLabel}>Weight</Text>
            </View>
          </View>
        </View>

        {/* ── Daily Weight Card — only shown when body weight tracking is enabled ── */}
        {bodyWeightEnabled && (
          <>
            <View style={styles.weightCard}>
              <View style={styles.weightLeft}>
                <Text style={styles.weightTitle}>Body Weight</Text>
                {todayWeight !== null ? (
                  <Text style={styles.weightSaved}>{todayWeight} {weightUnit} logged today</Text>
                ) : (
                  <Text style={styles.weightEmpty}>Not recorded yet</Text>
                )}
                {avgWeight !== null && (
                  <Text style={styles.weightAvg}>{averageDays}-day avg: {avgWeight} {weightUnit}</Text>
                )}
              </View>
              <TextInput
                style={styles.weightInput}
                value={weightInput}
                onChangeText={setWeightInput}
                keyboardType="decimal-pad"
                placeholder="0.0"
                placeholderTextColor={colors.border}
                selectTextOnFocus
              />
              <Text style={styles.weightUnitLabel}>{weightUnit}</Text>
              <TouchableOpacity
                style={[styles.weightSaveBtn, savingWeight && { opacity: 0.6 }]}
                onPress={handleSaveWeight}
                disabled={savingWeight}
                activeOpacity={0.8}
              >
                {savingWeight
                  ? <ActivityIndicator size="small" color={colors.white} />
                  : <Text style={styles.weightSaveBtnText}>Save</Text>
                }
              </TouchableOpacity>
            </View>

          </>
        )}

        {/* ── Meal List ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's Meals</Text>

          {/* Empty state — shown when no meals have been logged for the viewed date */}
          {meals.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🍽️</Text>
              <Text style={styles.emptyText}>No meals logged yet</Text>
              <Text style={styles.emptyHint}>Tap the button below to photograph your food</Text>
            </View>
          ) : (
            meals.map((meal) => (
              <TouchableOpacity
                key={meal.id}
                style={styles.mealCard}
                onPress={() => handleEditMeal(meal)}
                activeOpacity={0.75}
              >
                {/* Coloured left border to add visual weight to each card */}
                <View style={styles.mealColorBar} />

                {/* Meal thumbnail or food emoji placeholder */}
                {meal.imageUri ? (
                  <Image source={{ uri: meal.imageUri }} style={styles.mealThumb} />
                ) : (
                  <View style={[styles.mealThumb, styles.mealThumbFallback]}>
                    <Text style={{ fontSize: 22 }}>🍽️</Text>
                  </View>
                )}

                <View style={styles.mealContent}>
                  {/* Top row: meal name (truncated) + logged time */}
                  <View style={styles.mealTop}>
                    <Text style={styles.mealName} numberOfLines={1}>{meal.foodName}</Text>
                    <Text style={styles.mealTime}>{formatTime(meal.timestamp)}</Text>
                  </View>

                  {/* Macro chips for this individual meal */}
                  <MacroRow
                    protein={meal.proteinGrams}
                    carbs={meal.carbsGrams}
                    fat={meal.fatGrams}
                    style={{ marginTop: 5 }}
                  />

                  {/* Ingredient preview line — truncated to one line */}
                  {meal.ingredients?.length > 0 && (
                    <Text style={styles.mealIngredients} numberOfLines={1}>
                      {meal.ingredients.map((i) => i.name).join(' · ')}
                    </Text>
                  )}
                </View>

                {/* Right column: calorie count + weight + edit hint */}
                <View style={styles.mealRight}>
                  <Text style={styles.mealCalories}>{meal.totalCalories}</Text>
                  <Text style={styles.mealCalLabel}>cal</Text>
                  <Text style={styles.mealWeight}>{meal.totalWeightGrams}g</Text>
                  <Text style={styles.editHint}>tap to edit</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      {/* ── Floating Action Button ── */}
      {/* Positioned above the Android navigation bar using safe-area insets */}
      <View style={[styles.fabArea, { bottom: spacing.lg + insets.bottom }]}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <TouchableOpacity style={styles.fab} onPress={handleAddFood} activeOpacity={0.85}>
            <Text style={styles.fabPlus}>+</Text>
            <Text style={styles.fabLabel}>Add Food Photo</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Extra bottom padding so content isn't hidden behind the FAB
  scroll: { paddingBottom: 110 },

  // Header
  header:       { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  title:        { fontSize: fontSize.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },

  // Date navigation bar
  dateNav:           { flexDirection: 'row', alignItems: 'center' },
  navArrow:          { paddingHorizontal: spacing.sm },
  navArrowText:      { fontSize: 30, color: colors.primary, fontWeight: '300', lineHeight: 34 },
  navArrowDisabled:  { opacity: 0.3 },
  dateCenter:        { flex: 1, alignItems: 'center' },
  dateText:          { fontSize: fontSize.md, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  todayChip:         { marginTop: 4, paddingHorizontal: spacing.sm, paddingVertical: 2, backgroundColor: colors.primaryLight, borderRadius: radius.full },
  todayChipText:     { fontSize: fontSize.xs, color: colors.primaryDark, fontWeight: '700' },

  // Summary card
  summaryCard: {
    marginHorizontal: spacing.md,
    marginBottom:     spacing.md,
    backgroundColor:  colors.white,
    borderRadius:     radius.lg,
    padding:          spacing.lg,
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.08,
    shadowRadius:     12,
    elevation:        4,
  },
  summaryTitle:    { fontSize: fontSize.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  calorieRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  calorieStat:     { alignItems: 'center', minWidth: 75 },
  calorieNumber:   { fontSize: fontSize.xxl, fontWeight: '800', color: colors.text },
  calorieLabel:    { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  progressSection: { flex: 1, paddingHorizontal: spacing.sm },
  progressBg:      { height: 10, backgroundColor: colors.border, borderRadius: radius.full, overflow: 'hidden' },
  progressFill:    { height: '100%', borderRadius: radius.full },
  goalLabel:       { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },

  // Macro summary row inside the summary card
  macroSummaryRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  macroSumItem:    { flex: 1, alignItems: 'center' },
  macroSumValue:   { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  macroSumLabel:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  macroSumDivider: { width: 1, backgroundColor: colors.border, marginVertical: 2 },

  // Meal list section
  section:      { paddingHorizontal: spacing.md },
  sectionTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },

  // Empty state placeholder
  emptyState: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.xxl, alignItems: 'center' },
  emptyIcon:  { fontSize: 48, marginBottom: spacing.sm },
  emptyText:  { fontSize: fontSize.lg, fontWeight: '600', color: colors.textSecondary },
  emptyHint:  { fontSize: fontSize.md, color: colors.border, textAlign: 'center', marginTop: spacing.xs },

  // Individual meal cards
  mealCard: {
    flexDirection:  'row',
    backgroundColor: colors.white,
    borderRadius:   radius.md,
    marginBottom:   spacing.sm,
    overflow:       'hidden',
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: 1 },
    shadowOpacity:  0.06,
    shadowRadius:   6,
    elevation:      2,
  },
  mealColorBar:        { width: 4, backgroundColor: colors.primary },
  mealThumb:           { width: 60, height: 60, margin: spacing.sm },
  mealThumbFallback:   { borderRadius: radius.sm, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  mealContent:    { flex: 1, padding: spacing.md, paddingLeft: 0 },
  mealTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  mealName:       { flex: 1, fontSize: fontSize.lg, fontWeight: '600', color: colors.text, marginRight: spacing.sm },
  mealTime:       { fontSize: fontSize.sm, color: colors.textSecondary },
  mealIngredients:{ fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 5 },
  mealRight:      { alignItems: 'flex-end', justifyContent: 'center', paddingRight: spacing.md, minWidth: 64 },
  mealCalories:   { fontSize: fontSize.xxl, fontWeight: '800', color: colors.primary },
  mealCalLabel:   { fontSize: fontSize.xs, color: colors.textSecondary },
  mealWeight:     { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  editHint:       { fontSize: fontSize.xs, color: colors.border, marginTop: 4 },

  // Average calorie strip inside summary card
  avgRow:   { marginBottom: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.primaryLight, alignItems: 'center' },
  avgText:  { fontSize: fontSize.sm, color: colors.primaryDark },
  avgValue: { fontWeight: '700' },

  // Daily weight card
  weightCard: {
    flexDirection:    'row',
    alignItems:       'center',
    marginHorizontal: spacing.md,
    marginBottom:     spacing.md,
    backgroundColor:  colors.white,
    borderRadius:     radius.lg,
    padding:          spacing.md,
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.07,
    shadowRadius:     8,
    elevation:        3,
    gap:              spacing.sm,
  },
  weightLeft:       { flex: 1 },
  weightTitle:      { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  weightSaved:      { fontSize: fontSize.xs, color: colors.primary, marginTop: 2, fontWeight: '600' },
  weightEmpty:      { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  weightAvg:        { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  weightInput:      { width: 72, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.xs, fontSize: fontSize.lg, fontWeight: '700', color: colors.text, textAlign: 'center', backgroundColor: colors.background },
  weightUnitLabel:  { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  weightSaveBtn:    { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, backgroundColor: colors.primary, borderRadius: radius.md },
  weightSaveBtnText:{ fontSize: fontSize.sm, color: colors.white, fontWeight: '700' },


  // Floating action button
  fabArea: { position: 'absolute', bottom: spacing.lg, left: spacing.lg, right: spacing.lg },
  fab: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: colors.primary,
    borderRadius:    radius.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    shadowColor:     colors.primaryDark,
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.4,
    shadowRadius:    12,
    elevation:       10,
  },
  fabPlus:  { fontSize: 28, color: colors.white, fontWeight: '300', marginRight: spacing.sm, lineHeight: 32 },
  fabLabel: { fontSize: fontSize.lg, color: colors.white, fontWeight: '700' },
});
