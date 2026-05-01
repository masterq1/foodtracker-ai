/**
 * EditMealScreen.js
 *
 * Serves double duty:
 *   1. Manual entry  — when isNew=true, lets the user type in a meal from scratch
 *      without using the camera or AI analysis at all.
 *   2. Edit existing — when isNew=false, pre-fills all fields from an existing
 *      meal object so the user can correct values after an AI analysis.
 *
 * Route params:
 *   meal     — meal object (all-zero defaults for new entries)
 *   dateKey  — YYYY-MM-DD string indicating which day to save/update on
 *   isNew    — boolean; true = addMealDirect(), false = updateMeal() (or deleteMeal+addMealDirect if date changed)
 *
 * On save, navigates back (goBack) so the calling screen refreshes.
 * On delete, also navigates back after removing the meal from storage.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { addMealDirect, updateMeal, deleteMeal, getSettings } from '../services/storage';
import { analyzeFoodImage, reanalyzeFoodFromText } from '../services/geminiApi';
import { colors, spacing, fontSize, radius } from '../theme';

// ─── Date / Time Helpers ─────────────────────────────────────────────────────

/** Extracts HH:MM (local time, 24-hour) from an ISO timestamp string. Defaults to now. */
function initTime(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Combines a YYYY-MM-DD date string and HH:MM time string into an ISO timestamp. */
function buildTimestamp(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(n => parseInt(n, 10) || 0);
  const d = new Date(dateStr + 'T12:00:00'); // start at noon to avoid DST rollover
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// ─── NumericField Component ───────────────────────────────────────────────────

/**
 * A labelled numeric input used for calories, weight, and each macro.
 * Shows a label above, a large centred number input, and a unit label below.
 * Supports optional accent colour for the label and border to visually
 * distinguish the three macronutrient fields (protein=blue, carbs=orange, fat=purple).
 */
function NumericField({ label, value, onChange, unit, accentColor, borderColor }) {
  return (
    <View style={styles.numericField}>
      {/* Label — coloured for macro fields */}
      <Text style={[styles.fieldLabel, accentColor && { color: accentColor }]}>{label}</Text>

      {/* Number input — large, centred, number-pad keyboard */}
      <TextInput
        style={[styles.numericInput, borderColor && { borderColor }]}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={colors.border}
        selectTextOnFocus // select all on tap so the user doesn't have to delete first
      />

      {/* Unit label below the input (e.g. "kcal", "g") */}
      <Text style={styles.unit}>{unit}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function EditMealScreen({ route, navigation }) {
  // Unpack route params
  const { meal, dateKey, isNew } = route.params;

  // ── State — pre-filled from the meal object ──
  // All numeric values are stored as strings because TextInput works with strings
  const [foodName,    setFoodName]    = useState(meal.foodName        || '');
  const [calories,    setCalories]    = useState(String(meal.totalCalories    ?? 0));
  const [weight,      setWeight]      = useState(String(meal.totalWeightGrams ?? 0));
  const [protein,     setProtein]     = useState(String(meal.proteinGrams     ?? 0));
  const [carbs,       setCarbs]       = useState(String(meal.carbsGrams       ?? 0));
  const [fat,         setFat]         = useState(String(meal.fatGrams         ?? 0));
  const [ingredients, setIngredients] = useState(
    meal.ingredients?.length ? meal.ingredients : []
  );
  const [notes,       setNotes]       = useState(meal.notes || '');
  const [saving, setSaving] = useState(false); // true while the async save is in flight
  const [mealDate, setMealDate] = useState(dateKey);
  const [mealTime, setMealTime] = useState(initTime(meal.timestamp));

  // Re-analysis state
  const [reanalyzing, setReanalyzing]         = useState(false);
  const [originalSnapshot, setOriginalSnapshot] = useState(null); // saved before reanalysis for revert
  const [pendingExtras, setPendingExtras]       = useState(null); // non-UI fields from AI result

  // ── Save Handler ──

  /**
   * Validates the food name, assembles the updated meal object, then either
   * creates a new entry (isNew) or updates the existing one in storage.
   */
  async function handleSave() {
    if (!foodName.trim()) {
      Alert.alert('Required', 'Please enter a food name.');
      return;
    }

    // Validate date — must be YYYY-MM-DD and a real calendar date
    const dateTest = new Date(mealDate + 'T12:00:00');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mealDate) || isNaN(dateTest.getTime())) {
      Alert.alert('Invalid Date', 'Enter the date as YYYY-MM-DD (e.g. 2025-04-30).');
      return;
    }

    // Validate time — must be HH:MM in 24-hour format
    const [hStr, mStr] = mealTime.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (!/^\d{2}:\d{2}$/.test(mealTime) || h > 23 || m > 59) {
      Alert.alert('Invalid Time', 'Enter time as HH:MM in 24-hour format (e.g. 14:30).');
      return;
    }

    setSaving(true);
    try {
      const timestamp = buildTimestamp(mealDate, mealTime);
      const updatedMeal = {
        ...meal,
        ...(pendingExtras || {}), // apply glucoseRiseMgDl, confidence, analyzedByModel if re-analyzed
        foodName:         foodName.trim(),
        totalCalories:    parseInt(calories, 10) || 0,
        totalWeightGrams: parseInt(weight,   10) || 0,
        proteinGrams:     parseInt(protein,  10) || 0,
        carbsGrams:       parseInt(carbs,    10) || 0,
        fatGrams:         parseInt(fat,      10) || 0,
        ingredients:      ingredients.filter((i) => i.name.trim()),
        notes:            notes.trim(),
        timestamp,
      };

      if (isNew) {
        // New meal: assign a fresh id and save to the chosen date
        await addMealDirect({ ...updatedMeal, id: Date.now() }, mealDate);
      } else if (mealDate !== dateKey) {
        // Meal moved to a different day: remove from old date, add to new
        await deleteMeal(dateKey, meal.id);
        await addMealDirect(updatedMeal, mealDate);
      } else {
        // Same day edit: replace in place
        await updateMeal(mealDate, updatedMeal);
      }

      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', 'Failed to save changes: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Delete Handler ──

  /**
   * Shows a confirmation alert before permanently deleting the meal.
   * Not shown for new (unsaved) entries — the user can just go back.
   */
  function handleDelete() {
    Alert.alert(
      'Delete Meal',
      `Permanently delete "${meal.foodName}"?`,
      [
        {
          text:  'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteMeal(dateKey, meal.id);
            navigation.goBack();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  // ── Ingredient Helpers ──

  /**
   * Updates one field ('name' or 'amount') on a single ingredient row
   * without mutating the array directly.
   */
  function updateIngredient(index, field, value) {
    const updated = [...ingredients];
    updated[index] = { ...updated[index], [field]: value };
    setIngredients(updated);
  }

  /** Removes the ingredient at the given index. */
  function removeIngredient(index) {
    setIngredients(ingredients.filter((_, i) => i !== index));
  }

  /** Appends a blank ingredient row ready for the user to fill in. */
  function addIngredient() {
    setIngredients([...ingredients, { name: '', amount: '' }]);
  }

  // ── Re-analysis ──

  /**
   * Reads the meal's stored image as base64 and sends it back to the Gemini API.
   * Snapshots all current field values first so the user can revert if needed.
   * On success, overwrites the form fields with the new analysis results.
   */
  async function handleReanalyze() {
    setReanalyzing(true);
    try {
      // Save current values before overwriting so Revert can restore them
      setOriginalSnapshot({ foodName, calories, weight, protein, carbs, fat, ingredients, notes });

      const base64 = await FileSystem.readAsStringAsync(meal.imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const settings = await getSettings();
      const result   = await analyzeFoodImage(base64, settings.apiKey);

      // Apply editable fields to the form
      setFoodName(result.foodName   || '');
      setCalories(String(result.totalCalories    || 0));
      setWeight  (String(result.totalWeightGrams || 0));
      setProtein (String(result.proteinGrams     || 0));
      setCarbs   (String(result.carbsGrams       || 0));
      setFat     (String(result.fatGrams         || 0));
      setIngredients(result.ingredients || []);
      setNotes   (result.notes || '');

      // Non-UI fields (glucose, confidence, model) applied on save
      setPendingExtras({
        glucoseRiseMgDl: result.glucoseRiseMgDl,
        confidence:      result.confidence,
        analyzedByModel: result.analyzedByModel,
      });
    } catch (err) {
      setOriginalSnapshot(null); // analysis failed — nothing to revert
      Alert.alert('Re-analysis Failed', err.message);
    } finally {
      setReanalyzing(false);
    }
  }

  /**
   * Restores all field values to what they were before the last re-analysis.
   * Clears pendingExtras so the original non-UI fields are preserved on save too.
   */
  function handleRevert() {
    if (!originalSnapshot) return;
    setFoodName   (originalSnapshot.foodName);
    setCalories   (originalSnapshot.calories);
    setWeight     (originalSnapshot.weight);
    setProtein    (originalSnapshot.protein);
    setCarbs      (originalSnapshot.carbs);
    setFat        (originalSnapshot.fat);
    setIngredients(originalSnapshot.ingredients);
    setNotes      (originalSnapshot.notes);
    setOriginalSnapshot(null);
    setPendingExtras(null);
  }

  // ── AI Analysis from Description (manual entry) ──

  /**
   * For new meals without a photo: sends the food name and ingredients as a
   * text prompt to Gemini and fills all fields with the returned estimate.
   */
  async function handleAnalyzeDescription() {
    if (!foodName.trim()) {
      Alert.alert('Food Name Required', 'Enter a food name before analyzing.');
      return;
    }
    setReanalyzing(true);
    try {
      setOriginalSnapshot({ foodName, calories, weight, protein, carbs, fat, ingredients, notes });
      const settings = await getSettings();
      const result   = await reanalyzeFoodFromText(foodName.trim(), ingredients, settings.apiKey);

      setFoodName(result.foodName   || foodName);
      setCalories(String(result.totalCalories    || 0));
      setWeight  (String(result.totalWeightGrams || 0));
      setProtein (String(result.proteinGrams     || 0));
      setCarbs   (String(result.carbsGrams       || 0));
      setFat     (String(result.fatGrams         || 0));
      setIngredients(result.ingredients || ingredients);
      setNotes   (result.notes || '');

      setPendingExtras({
        glucoseRiseMgDl: result.glucoseRiseMgDl,
        confidence:      result.confidence,
        analyzedByModel: result.analyzedByModel,
      });
    } catch (err) {
      setOriginalSnapshot(null);
      Alert.alert('Analysis Failed', err.message);
    } finally {
      setReanalyzing(false);
    }
  }

  // ── Render ──

  return (
    // KeyboardAvoidingView shifts the layout up on iOS when the keyboard appears
    // so the active input is never hidden behind the keyboard.
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled" // taps outside the keyboard dismiss it
      >

        {/* Meal thumbnail — shown only if the meal has an associated photo */}
        {!!meal.imageUri && (
          <Image source={{ uri: meal.imageUri }} style={styles.image} resizeMode="cover" />
        )}

        {/* Re-analyze button — only for meals that have a saved photo */}
        {!!meal.imageUri && !isNew && (
          <TouchableOpacity
            style={[styles.reanalyzeBtn, reanalyzing && styles.reanalyzeBtnDisabled]}
            onPress={handleReanalyze}
            disabled={reanalyzing || saving}
            activeOpacity={0.75}
          >
            {reanalyzing ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.reanalyzeBtnText}>↺  Re-analyze Image</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Revert banner — shown after a successful re-analysis */}
        {!!originalSnapshot && (
          <View style={styles.revertBanner}>
            <Text style={styles.revertBannerMsg}>✓  Values updated from re-analysis</Text>
            <TouchableOpacity onPress={handleRevert} style={styles.revertBannerBtn}>
              <Text style={styles.revertBannerBtnText}>Revert</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Food Name Card ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Food Name</Text>
          <TextInput
            style={styles.nameInput}
            value={foodName}
            onChangeText={setFoodName}
            placeholder="e.g. Grilled Chicken Salad"
            placeholderTextColor={colors.border}
            returnKeyType="done"
          />
          {/* AI Analyze button — only for new manual entries (no photo) */}
          {isNew && (
            <TouchableOpacity
              style={[styles.analyzeDescBtn, reanalyzing && styles.reanalyzeBtnDisabled]}
              onPress={handleAnalyzeDescription}
              disabled={reanalyzing || saving}
              activeOpacity={0.75}
            >
              {reanalyzing ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.analyzeDescBtnText}>✨  Analyze with AI</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* ── Date & Time Card ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Date & Time</Text>
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Date</Text>
              <TextInput
                style={styles.dateTimeInput}
                value={mealDate}
                onChangeText={setMealDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.border}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={10}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Time</Text>
              <TextInput
                style={styles.dateTimeInput}
                value={mealTime}
                onChangeText={setMealTime}
                placeholder="HH:MM"
                placeholderTextColor={colors.border}
                keyboardType="numeric"
                maxLength={5}
              />
            </View>
          </View>
          <Text style={styles.dateTimeHint}>24-hour format  ·  e.g. 14:30</Text>
        </View>

        {/* ── Calories & Weight Card ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Serving</Text>
          <View style={styles.twoCol}>
            <NumericField label="Calories" value={calories} onChange={setCalories} unit="kcal" />
            <NumericField label="Weight"   value={weight}   onChange={setWeight}   unit="g" />
          </View>
        </View>

        {/* ── Macronutrients Card ── */}
        {/* Each macro field has its own accent colour matching the rest of the app */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Macronutrients</Text>
          <View style={styles.threeCol}>
            <NumericField label="Protein" value={protein} onChange={setProtein} unit="g" accentColor="#1D4ED8" borderColor="#BFDBFE" />
            <NumericField label="Carbs"   value={carbs}   onChange={setCarbs}   unit="g" accentColor="#C2410C" borderColor="#FED7AA" />
            <NumericField label="Fat"     value={fat}     onChange={setFat}     unit="g" accentColor="#7E22CE" borderColor="#E9D5FF" />
          </View>
        </View>

        {/* ── Ingredients Card ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ingredients</Text>

          {/* Placeholder when no ingredients have been added */}
          {ingredients.length === 0 && (
            <Text style={styles.emptyIngredients}>No ingredients listed</Text>
          )}

          {/* One row per ingredient: name input | amount input | remove button */}
          {ingredients.map((ing, i) => (
            <View key={i} style={styles.ingredientRow}>
              <TextInput
                style={[styles.ingredientInput, { flex: 2 }]}
                value={ing.name}
                onChangeText={(v) => updateIngredient(i, 'name', v)}
                placeholder="Ingredient"
                placeholderTextColor={colors.border}
                returnKeyType="next"
              />
              <TextInput
                style={[styles.ingredientInput, { flex: 1 }]}
                value={ing.amount}
                onChangeText={(v) => updateIngredient(i, 'amount', v)}
                placeholder="Amount"
                placeholderTextColor={colors.border}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={styles.removeIngredientBtn}
                onPress={() => removeIngredient(i)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.removeIngredientIcon}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}

          {/* Dashed button to append a new blank ingredient row */}
          <TouchableOpacity style={styles.addIngredientBtn} onPress={addIngredient}>
            <Text style={styles.addIngredientText}>+ Add Ingredient</Text>
          </TouchableOpacity>
        </View>

        {/* ── Notes ── */}
        <View style={styles.notesSection}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any notes about this meal…"
            placeholderTextColor={colors.border}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* ── Save Button ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color={colors.white} />
            : <Text style={styles.saveBtnText}>Save Changes</Text>
          }
        </TouchableOpacity>

        {/* ── Delete Button ── */}
        {/* Only shown for existing meals, not for brand-new entries */}
        {!isNew && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
            <Text style={styles.deleteBtnText}>Delete Meal</Text>
          </TouchableOpacity>
        )}

        {/* Bottom spacer */}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll:    { paddingBottom: spacing.xl },

  // Meal photo thumbnail
  image: { width: '100%', height: 200 },

  // Re-analyze button (below the photo)
  reanalyzeBtn:         { marginHorizontal: spacing.md, marginTop: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed', alignItems: 'center', minHeight: 40, justifyContent: 'center' },
  reanalyzeBtnDisabled: { opacity: 0.5 },
  reanalyzeBtnText:     { fontSize: fontSize.md, color: colors.primary, fontWeight: '700' },

  // Revert banner (shown after successful re-analysis)
  revertBanner:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: '#DCFCE7', borderRadius: radius.md },
  revertBannerMsg:     { fontSize: fontSize.sm, color: '#166534', fontWeight: '600', flex: 1 },
  revertBannerBtn:     { marginLeft: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, backgroundColor: '#166534' },
  revertBannerBtnText: { fontSize: fontSize.sm, color: colors.white, fontWeight: '700' },

  // Section card wrapper
  card: {
    marginHorizontal: spacing.md,
    marginTop:        spacing.md,
    backgroundColor:  colors.white,
    borderRadius:     radius.lg,
    padding:          spacing.lg,
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.07,
    shadowRadius:     8,
    elevation:        3,
  },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },

  // Food name input
  nameInput: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, fontSize: fontSize.lg, color: colors.text, backgroundColor: colors.background },

  // Layout helpers for the numeric field grids
  twoCol:   { flexDirection: 'row', gap: spacing.md },
  threeCol: { flexDirection: 'row', gap: spacing.sm },

  // NumericField sub-styles
  numericField: { flex: 1, alignItems: 'center' },
  fieldLabel:   { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.xs },
  numericInput: { width: '100%', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, fontSize: fontSize.xl, fontWeight: '700', color: colors.text, textAlign: 'center', backgroundColor: colors.background },
  unit:         { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs },

  // Ingredient list
  emptyIngredients:   { fontSize: fontSize.md, color: colors.border, marginBottom: spacing.sm },
  ingredientRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  ingredientInput:    { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2, fontSize: fontSize.md, color: colors.text, backgroundColor: colors.background },
  removeIngredientBtn:  { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  removeIngredientIcon: { fontSize: fontSize.xs, color: colors.error, fontWeight: '700' },
  addIngredientBtn:   { marginTop: spacing.xs, paddingVertical: spacing.sm, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, borderStyle: 'dashed', alignItems: 'center' },
  addIngredientText:  { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },

  // Date & time inputs
  dateTimeInput: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, fontSize: fontSize.xl, fontWeight: '700', color: colors.text, textAlign: 'center', backgroundColor: colors.background, marginTop: spacing.xs },
  dateTimeHint:  { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },

  // Save button
  saveBtn: { marginHorizontal: spacing.md, marginTop: spacing.lg, backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.md + 2, alignItems: 'center', shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText:     { fontSize: fontSize.lg, color: colors.white, fontWeight: '700' },

  // Delete button — outline style in error/red colour
  deleteBtn:     { marginHorizontal: spacing.md, marginTop: spacing.sm, borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' },
  deleteBtnText: { fontSize: fontSize.lg, color: colors.error, fontWeight: '600' },

  // Notes section (no card background — sits inline between other cards)
  notesSection: { marginHorizontal: spacing.md, marginTop: spacing.md },
  notesInput:   { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.md, color: colors.text, backgroundColor: colors.white, minHeight: 80 },

  // AI Analyze button inside the Food Name card (for new manual entries)
  analyzeDescBtn:     { marginTop: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed', alignItems: 'center', minHeight: 40, justifyContent: 'center' },
  analyzeDescBtnText: { fontSize: fontSize.md, color: colors.primary, fontWeight: '700' },
});
