/**
 * AnalysisScreen.js
 *
 * Shown immediately after the user takes or selects a photo.
 * Responsibilities:
 *   1. Send the image to Gemini for nutritional analysis (on mount)
 *   2. Display the results: calories, macros, glucose impact, ingredients
 *   3. Allow the user to edit the food name and ingredients inline
 *   4. Trigger a text-based re-analysis after edits ("Re-analyze ↺")
 *   5. Save the final result (with the persisted image) to storage
 *
 * Route params:
 *   imageUri  — local file URI for displaying the photo preview
 *   base64    — base64-encoded JPEG data sent to the API
 *   dateKey   — YYYY-MM-DD date to save the meal under (optional, defaults to today)
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Animated,
  TextInput,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { analyzeFoodImage, reanalyzeFoodFromText, getActiveModelInfo, modelDisplayName } from '../services/geminiApi';
import { saveMeal, getSettings, getModelUsageToday, AVAILABLE_MODELS } from '../services/storage';
import { colors, spacing, fontSize, radius } from '../theme';

// ─── Image Persistence ────────────────────────────────────────────────────────

/**
 * Copies the temporary image URI (from the camera/picker cache) to a permanent
 * location inside the app's document directory. This is necessary because
 * the temporary URI may become invalid after the OS clears its cache.
 *
 * Saved to: <documentDirectory>/meals/meal_<timestamp>.jpg
 */
async function persistImage(uri) {
  const mealsDir = FileSystem.documentDirectory + 'meals/';

  // Create the meals directory if it doesn't exist yet
  const dirInfo = await FileSystem.getInfoAsync(mealsDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(mealsDir, { intermediates: true });
  }

  const dest = mealsDir + `meal_${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest; // return the permanent path to store with the meal
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Coloured pill badge showing the AI's confidence in its analysis.
 * Green = high, yellow = medium, red = low.
 */
function ConfidenceBadge({ confidence }) {
  const map = {
    high:   { bg: '#DCFCE7', text: '#166534', dot: '#16A34A' },
    medium: { bg: '#FEF3C7', text: '#92400E', dot: '#D97706' },
    low:    { bg: '#FEE2E2', text: '#991B1B', dot: '#DC2626' },
  };
  const c = map[confidence] || map.low;
  return (
    <View style={[styles.confidenceBadge, { backgroundColor: c.bg }]}>
      <View style={[styles.confidenceDot, { backgroundColor: c.dot }]} />
      <Text style={[styles.confidenceText, { color: c.text }]}>
        {confidence ? `${confidence} confidence` : 'unknown confidence'}
      </Text>
    </View>
  );
}

/**
 * A single metric tile used in the stats grid (calories, weight, macros).
 * Has a coloured top border and shows emoji + number + unit + label.
 */
function StatCard({ value, unit, label, emoji, accentColor }) {
  return (
    <View style={[styles.statCard, accentColor && { borderTopColor: accentColor }]}>
      <Text style={styles.statEmoji}>{emoji}</Text>
      <Text style={[styles.statNumber, accentColor && { color: accentColor }]}>{value.toLocaleString()}</Text>
      <Text style={styles.statUnit}>{unit}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AnalysisScreen({ route, navigation }) {
  // Unpack navigation params — dateKey is optional (defaults to today in saveMeal)
  const { imageUri, base64, dateKey } = route.params;

  // Safe-area insets to push the action bar above the Android nav bar
  const insets = useSafeAreaInsets();

  // ── State ──
  const [analysis, setAnalysis]       = useState(null);   // parsed nutrition result from Gemini
  const [loading, setLoading]         = useState(true);   // true while the initial API call is in flight
  const [saving, setSaving]           = useState(false);  // true while saving the meal to storage
  const [error, setError]             = useState(null);   // error message string if analysis failed

  // Edit mode: the user can tap "Edit" to modify the food name and ingredients before saving
  const [editing, setEditing]         = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);  // true while re-analysis API call is in flight
  const [editedName, setEditedName]   = useState('');
  const [editedIngredients, setEditedIngredients] = useState([]);

  // Model info shown in the loading card so the user can see which model is being used
  const [activeModel, setActiveModel] = useState('');
  const [usageCount, setUsageCount]   = useState(0);
  const [dailyLimit, setDailyLimit]   = useState(1500);

  // Fade-in animation applied to the results section when analysis completes
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // ── Effects ──

  // Kick off the AI analysis as soon as the screen mounts
  useEffect(() => {
    runAnalysis();
  }, []);

  // When a new analysis result arrives, initialise the edit state and fade in
  useEffect(() => {
    if (analysis) {
      setEditedName(analysis.foodName || '');
      setEditedIngredients(analysis.ingredients ? [...analysis.ingredients] : []);
      // Animate the results into view over 400ms
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, [analysis]);

  // ── Analysis ──

  /**
   * Calls the Gemini API to analyse the food image.
   * First fetches model info (for the loading display), then calls analyzeFoodImage.
   * On success, updates the analysis state. On failure, stores the error message.
   */
  async function runAnalysis() {
    try {
      setLoading(true);
      setError(null);

      const settings = await getSettings();

      // Fetch info about the #1 priority model so we can display it during the loading state
      const modelInfo = await getActiveModelInfo();
      setActiveModel(modelInfo.displayName);
      setUsageCount(modelInfo.count);
      setDailyLimit(modelInfo.dailyLimit);

      const result = await analyzeFoodImage(base64, settings.apiKey);
      setAnalysis(result);

      // Refresh counter using the model that actually ran (may differ from priority[0] if cascaded)
      const usedId   = result.analyzedByModel;
      const usedMeta = AVAILABLE_MODELS.find(m => m.id === usedId);
      const freshCount = await getModelUsageToday(usedId);
      setActiveModel(modelDisplayName(usedId));
      setUsageCount(freshCount);
      setDailyLimit(usedMeta?.dailyLimit ?? 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Sends the user's edited food name and ingredient list to Gemini as text
   * to get fresh calorie/macro estimates. Replaces the current analysis result.
   * Only called when the user taps "Re-analyze ↺" while in edit mode.
   */
  async function handleReanalyze() {
    setReanalyzing(true);
    try {
      // Refresh model info so the counter reflects current usage before the call
      const [settings, modelInfo] = await Promise.all([getSettings(), getActiveModelInfo()]);
      setActiveModel(modelInfo.displayName);
      setUsageCount(modelInfo.count);
      setDailyLimit(modelInfo.dailyLimit);
      const result = await reanalyzeFoodFromText(editedName, editedIngredients, settings.apiKey);
      setAnalysis(result);
      setEditing(false); // exit edit mode now that we have fresh results
    } catch (err) {
      Alert.alert('Re-analysis Failed', err.message);
    } finally {
      setReanalyzing(false);
    }
  }

  // ── Ingredient Edit Helpers ──

  /**
   * Updates a single field ('name' or 'amount') on one ingredient row.
   * Works on a copy of the array to avoid mutating state directly.
   */
  function updateIngredient(index, field, value) {
    const updated = [...editedIngredients];
    updated[index] = { ...updated[index], [field]: value };
    setEditedIngredients(updated);
  }

  /** Removes the ingredient at the given index from the edit list. */
  function removeIngredient(index) {
    setEditedIngredients(editedIngredients.filter((_, i) => i !== index));
  }

  /** Appends a blank ingredient row to the edit list. */
  function addIngredient() {
    setEditedIngredients([...editedIngredients, { name: '', amount: '' }]);
  }

  // ── Save ──

  /**
   * Saves the analysed meal to persistent storage.
   * First copies the temporary image to a permanent location, then saves
   * the full meal object (analysis result + permanent image path).
   * Navigates back to the Home screen on success.
   */
  async function handleSave() {
    if (!analysis) return;
    setSaving(true);
    try {
      const settings = await getSettings();

      // Auto-save to gallery using the original temp URI, before it's copied to
      // the app's private document directory. The document-directory path is
      // sandboxed and not readable by the media library service on Android.
      if (settings.autoSaveToGallery) {
        try {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status === 'granted') await MediaLibrary.saveToLibraryAsync(imageUri);
        } catch {}  // silently ignore gallery save failures
      }

      const permanentUri = await persistImage(imageUri);

      // Always apply the edited name/ingredients — they mirror analysis values when not in edit mode
      await saveMeal({
        ...analysis,
        foodName:    editedName,
        ingredients: editedIngredients,
        imageUri:    permanentUri,
      }, dateKey || null);
      navigation.navigate('Home');
    } catch (err) {
      Alert.alert('Save Failed', 'Could not save meal: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Full-width photo preview at the top */}
        <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />

        {/* ── Loading State ── */}
        {loading && (
          <View style={styles.statusCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingTitle}>Analyzing your meal...</Text>
            <Text style={styles.loadingSubtext}>
              Identifying ingredients and estimating nutrition
            </Text>
            {/* Show which model is being used and how many requests have been used today */}
            {!!activeModel && (
              <Text style={styles.loadingModel}>
                via {activeModel} · {usageCount}/{dailyLimit} requests today
              </Text>
            )}
          </View>
        )}

        {/* ── Error State ── */}
        {error && !loading && (
          <View style={styles.errorCard}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Analysis Failed</Text>
            <Text style={styles.errorText}>{error}</Text>
            {/* Allow the user to retry without going back to the camera */}
            <TouchableOpacity style={styles.retryBtn} onPress={runAnalysis}>
              <Text style={styles.retryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Results ── */}
        {analysis && !loading && (
          // Fade in the entire results section once the analysis arrives
          <Animated.View style={{ opacity: fadeAnim }}>

            {/* ── Name & Confidence Card ── */}
            <View style={styles.nameCard}>
              {/* In edit mode the name becomes an inline text input */}
              {editing ? (
                <TextInput
                  style={styles.nameInput}
                  value={editedName}
                  onChangeText={setEditedName}
                  placeholder="Food name"
                  placeholderTextColor={colors.textSecondary}
                />
              ) : (
                <Text style={styles.foodName}>{analysis.foodName}</Text>
              )}

              {/* Footer row: confidence badge on the left, Edit/Cancel toggle on the right */}
              <View style={styles.nameCardFooter}>
                <ConfidenceBadge confidence={analysis.confidence} />
                {/* Hide the toggle while re-analysis is in progress */}
                {!reanalyzing && (
                  <TouchableOpacity
                    style={styles.editToggleBtn}
                    onPress={() => setEditing(!editing)}
                  >
                    <Text style={styles.editToggleText}>{editing ? 'Cancel' : 'Edit'}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Model attribution — shows which model ran and the updated post-request count */}
              {!!activeModel && (
                <Text style={styles.modelAttribution}>
                  {activeModel}  ·  {usageCount}/{dailyLimit} requests used today
                </Text>
              )}
            </View>

            {/* ── Calories + Weight ── */}
            <View style={styles.statsRow}>
              <StatCard value={analysis.totalCalories}    unit="kcal" label="Calories" emoji="🔥" accentColor={colors.secondary} />
              <StatCard value={analysis.totalWeightGrams} unit="g"    label="Weight"   emoji="⚖️" accentColor={colors.primary} />
            </View>

            {/* ── Macronutrients ── */}
            <View style={styles.macroRow}>
              <StatCard value={analysis.proteinGrams} unit="g" label="Protein" emoji="💪" accentColor="#1D4ED8" />
              <StatCard value={analysis.carbsGrams}   unit="g" label="Carbs"   emoji="🌾" accentColor="#C2410C" />
              <StatCard value={analysis.fatGrams}     unit="g" label="Fat"     emoji="🥑" accentColor="#7E22CE" />
            </View>

            {/* ── Glucose Impact Card ── */}
            {/* Only shown when the model returned a non-zero estimate */}
            {analysis.glucoseRiseMgDl > 0 && (
              <View style={styles.glucoseCard}>
                <View style={styles.glucoseLeft}>
                  <Text style={styles.glucoseEmoji}>📈</Text>
                  <View>
                    <Text style={styles.glucoseTitle}>Glucose Impact</Text>
                    <Text style={styles.glucoseSubtitle}>estimated rise after meal</Text>
                  </View>
                </View>
                <View style={styles.glucoseRight}>
                  <Text style={styles.glucoseValue}>{analysis.glucoseRiseMgDl}</Text>
                  <Text style={styles.glucoseUnit}> mg/dL</Text>
                </View>
              </View>
            )}

            {/* ── Ingredients Card ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ingredients Identified</Text>

              {/* Edit mode: each ingredient becomes two text inputs + a remove button */}
              {editing ? (
                <>
                  {editedIngredients.map((item, i) => (
                    <View key={i} style={styles.ingredientEditRow}>
                      <TextInput
                        style={[styles.ingredientInput, { flex: 2 }]}
                        value={item.name}
                        onChangeText={val => updateIngredient(i, 'name', val)}
                        placeholder="Ingredient"
                        placeholderTextColor={colors.textSecondary}
                      />
                      <TextInput
                        style={[styles.ingredientInput, { flex: 1 }]}
                        value={item.amount}
                        onChangeText={val => updateIngredient(i, 'amount', val)}
                        placeholder="Amount"
                        placeholderTextColor={colors.textSecondary}
                      />
                      <TouchableOpacity onPress={() => removeIngredient(i)} style={styles.removeBtn}>
                        <Text style={styles.removeBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={styles.addIngredientBtn} onPress={addIngredient}>
                    <Text style={styles.addIngredientText}>+ Add Ingredient</Text>
                  </TouchableOpacity>
                </>
              ) : (
                // View mode: simple bullet list
                analysis.ingredients?.map((item, i) => (
                  <View key={i} style={styles.ingredientRow}>
                    <View style={styles.ingredientBullet} />
                    <Text style={styles.ingredientName}>{item.name}</Text>
                    <Text style={styles.ingredientAmount}>{item.amount}</Text>
                  </View>
                ))
              )}
            </View>

            {/* ── Notes Card ── */}
            {/* Shows the model's caveat about estimation accuracy, if any */}
            {!!analysis.notes && (
              <View style={styles.notesCard}>
                <Text style={styles.notesIcon}>💡</Text>
                <Text style={styles.notesText}>{analysis.notes}</Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* Bottom spacer to ensure content isn't hidden behind the action bar */}
        <View style={{ height: 100 + (insets.bottom || 0) }} />
      </ScrollView>

      {/* ── Action Bar ── */}
      {/* Pinned to the bottom; adjusts padding so it clears the Android nav bar */}
      {!loading && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom || spacing.md }]}>

          {editing ? (
            // Edit mode: Cancel | Save ✓ | Re-analyze ↺
            <>
              {/* Counter shown while re-analysis is in flight */}
              {reanalyzing && !!activeModel && (
                <Text style={styles.reanalyzingModel}>
                  via {activeModel} · {usageCount}/{dailyLimit} requests today
                </Text>
              )}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.retakeButton}
                  onPress={() => setEditing(false)}
                  disabled={reanalyzing || saving}
                >
                  <Text style={styles.retakeText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveButton, { flex: 1 }, (saving || reanalyzing) && styles.buttonDisabled]}
                  onPress={handleSave}
                  disabled={saving || reanalyzing}
                >
                  {saving
                    ? <ActivityIndicator color={colors.white} />
                    : <Text style={styles.saveText}>Save ✓</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.reanalyzeButton, { flex: 1.5 }, (reanalyzing || saving) && styles.buttonDisabled]}
                  onPress={handleReanalyze}
                  disabled={reanalyzing || saving}
                >
                  {reanalyzing
                    ? <ActivityIndicator color={colors.white} />
                    : <Text style={styles.saveText}>Re-analyze ↺</Text>
                  }
                </TouchableOpacity>
              </View>
            </>
          ) : (
            // Normal mode: ← Retake | Save Meal ✓
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.retakeButton} onPress={() => navigation.goBack()}>
                <Text style={styles.retakeText}>← Retake</Text>
              </TouchableOpacity>
              {analysis && (
                <TouchableOpacity
                  style={[styles.saveButton, saving && styles.buttonDisabled]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color={colors.white} />
                    : <Text style={styles.saveText}>Save Meal  ✓</Text>
                  }
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll:    { paddingBottom: spacing.xl },

  // Food photo
  image: { width: '100%', height: 280 },

  // Loading card
  statusCard: {
    margin:           spacing.md,
    backgroundColor:  colors.white,
    borderRadius:     radius.lg,
    padding:          spacing.xxl,
    alignItems:       'center',
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.08,
    shadowRadius:     12,
    elevation:        4,
  },
  loadingTitle:   { fontSize: fontSize.xl, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  loadingSubtext: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },
  loadingModel:   { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600', marginTop: spacing.sm },

  // Error card
  errorCard:  { margin: spacing.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' },
  errorIcon:  { fontSize: 40, marginBottom: spacing.sm },
  errorTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.error },
  errorText:  { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20 },
  retryBtn:   { marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryBtnText: { color: colors.white, fontWeight: '700', fontSize: fontSize.md },

  // Name & confidence card
  nameCard: {
    margin:          spacing.md,
    marginBottom:    spacing.sm,
    backgroundColor: colors.white,
    borderRadius:    radius.lg,
    padding:         spacing.lg,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.08,
    shadowRadius:    12,
    elevation:       4,
  },
  foodName:     { fontSize: fontSize.xxl, fontWeight: '800', color: colors.text },
  nameInput:    { fontSize: fontSize.xxl, fontWeight: '700', color: colors.text, borderBottomWidth: 2, borderBottomColor: colors.primary, paddingVertical: spacing.xs, marginBottom: spacing.xs },
  nameCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  editToggleBtn:  { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  editToggleText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },

  // Model attribution line shown below the confidence badge in the name card
  modelAttribution: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },

  // Confidence badge
  confidenceBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full },
  confidenceDot:   { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  confidenceText:  { fontSize: fontSize.sm, fontWeight: '600' },

  // Stat card grids
  statsRow: { flexDirection: 'row', marginHorizontal: spacing.md, marginBottom: spacing.sm, gap: spacing.sm },
  macroRow: { flexDirection: 'row', marginHorizontal: spacing.md, marginBottom: spacing.sm, gap: spacing.sm },
  statCard: {
    flex:            1,
    backgroundColor: colors.white,
    borderRadius:    radius.lg,
    padding:         spacing.md,
    alignItems:      'center',
    borderTopWidth:  3,
    borderTopColor:  colors.border,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.07,
    shadowRadius:    8,
    elevation:       3,
  },
  statEmoji:  { fontSize: 20, marginBottom: spacing.xs },
  statNumber: { fontSize: 28, fontWeight: '800', color: colors.text },
  statUnit:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  statLabel:  { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },

  // Glucose impact card — amber accent
  glucoseCard: {
    marginHorizontal: spacing.md,
    marginBottom:     spacing.sm,
    backgroundColor:  colors.white,
    borderRadius:     radius.lg,
    padding:          spacing.lg,
    borderTopWidth:   3,
    borderTopColor:   '#D97706',
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.07,
    shadowRadius:     8,
    elevation:        3,
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
  },
  glucoseLeft:     { flexDirection: 'row', alignItems: 'center', flex: 1 },
  glucoseEmoji:    { fontSize: 24, marginRight: spacing.sm },
  glucoseTitle:    { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  glucoseSubtitle: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  glucoseRight:    { flexDirection: 'row', alignItems: 'baseline' },
  glucoseValue:    { fontSize: 28, fontWeight: '800', color: '#D97706' },
  glucoseUnit:     { fontSize: fontSize.sm, color: colors.textSecondary },

  // General content card (used for ingredients)
  card:      { marginHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  cardTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.md },

  // Ingredient view-mode rows
  ingredientRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.background },
  ingredientBullet: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, marginRight: spacing.sm },
  ingredientName:   { flex: 1, fontSize: fontSize.md, color: colors.text },
  ingredientAmount: { fontSize: fontSize.md, color: colors.textSecondary },

  // Ingredient edit-mode rows
  ingredientEditRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs },
  ingredientInput:   { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, fontSize: fontSize.md, color: colors.text, backgroundColor: colors.background },
  removeBtn:         { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  removeBtnText:     { color: '#DC2626', fontSize: 12, fontWeight: '700' },
  addIngredientBtn:  { marginTop: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed' },
  addIngredientText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },

  // Notes card
  notesCard: { flexDirection: 'row', marginHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md, alignItems: 'flex-start' },
  notesIcon: { fontSize: 18, marginRight: spacing.sm, marginTop: 1 },
  notesText: { flex: 1, fontSize: fontSize.md, color: colors.primaryDark, lineHeight: 20 },

  // Bottom action bar — column so the counter text sits above the buttons
  actionBar: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    flexDirection:   'column',
    padding:         spacing.md,
    backgroundColor: colors.white,
    borderTopWidth:  1,
    borderTopColor:  colors.border,
    gap:             spacing.xs,
  },
  // Counter shown while re-analysis is in flight
  reanalyzingModel: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600', textAlign: 'center' },
  // Row containing the action buttons
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  retakeButton:    { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.background, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  retakeText:      { fontSize: fontSize.lg, color: colors.text, fontWeight: '600' },
  saveButton:      { flex: 2, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  reanalyzeButton: { flex: 2, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: '#D97706', alignItems: 'center' },
  buttonDisabled:  { opacity: 0.6 },
  saveText:        { fontSize: fontSize.lg, color: colors.white, fontWeight: '700' },
});
