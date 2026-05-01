/**
 * SettingsScreen.js
 *
 * User-configurable settings for the app. Divided into four logical sections:
 *
 *   1. Google AI API Key
 *      - Masked input with show/hide eye toggle
 *      - "Save Key" button scoped to this card only
 *      - Inline status indicator (key too short / key entered)
 *      - Step-by-step instructions for obtaining a free key
 *
 *   2. Daily Calorie Goal
 *      - Free-text numeric input + quick-select preset chips
 *      - Validated on save (must be 500–10,000 kcal)
 *
 *   3. AI Model Priority
 *      - Three ranked slots showing which Gemini models to try in order
 *      - Per-model progress bar showing today's usage vs daily limit
 *      - "↺ Refresh" button to re-read usage counts from storage
 *      - ▲/▼ arrows to reorder without opening the picker
 *      - Tap any row to open a bottom-sheet modal picker
 *      - Modal shows all known models with quotas, suggestions, and swap warnings
 *      - All changes persist immediately (no separate save needed for this section)
 *
 *   4. How it works — static informational card
 *
 *   5. Save Settings — saves both API key and calorie goal together
 *
 *   6. Danger Zone — irreversible "Clear All Meal History" action
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  Modal,
  ActivityIndicator,
  Linking,
} from 'react-native';

const API_KEY_URL = 'https://aistudio.google.com/apikey';
import { useFocusEffect } from '@react-navigation/native';
import {
  getSettings, saveSettings, clearAllData,
  getModelPriority, saveModelPriority, getModelUsageToday, AVAILABLE_MODELS,
} from '../services/storage';
import { colors, spacing, fontSize, radius } from '../theme';

export default function SettingsScreen() {

  // ── State ──

  // API key — loaded from storage on focus; kept as plain string here
  const [apiKey,  setApiKey]  = useState('');
  // Daily calorie goal — stored as string so the TextInput works without conversion
  const [dailyGoal, setDailyGoal] = useState('2000');
  // Average days window for rolling calorie average (default 5)
  const [averageDays, setAverageDays] = useState('5');
  // Body weight unit preference
  const [weightUnit, setWeightUnit] = useState('lbs');
  // Feature toggles
  const [autoSaveToGallery, setAutoSaveToGallery] = useState(false);
  const [bodyWeightEnabled, setBodyWeightEnabled] = useState(false);
  // Toggle to show/hide the API key characters (secureTextEntry)
  const [showKey, setShowKey] = useState(false);

  // Two separate "saved" flash indicators:
  //   savedKeyIndicator — flashes after "Save Key" inside the API card
  //   savedIndicator    — flashes after "Save Settings" at the bottom
  const [savedIndicator,    setSavedIndicator]    = useState(false);
  const [savedKeyIndicator, setSavedKeyIndicator] = useState(false);

  // Model priority — array of 3 model ID strings in priority order
  const [modelPriority, setModelPriority] = useState([
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ]);
  // Map of modelId → today's usage count, shown in the progress bars
  const [modelUsage, setModelUsage] = useState({});
  // Controls the model picker bottom-sheet modal
  const [showModelPicker, setShowModelPicker] = useState(false);
  // Which priority slot (0/1/2) the picker is currently editing
  const [editingSlot, setEditingSlot] = useState(null);
  // True while refreshUsageCounts() is running (shows spinner instead of button text)
  const [refreshingCounts, setRefreshingCounts] = useState(false);

  // ── Data Loading ──

  /**
   * Reload settings and usage data every time the tab gains focus.
   * Uses Promise.all so the settings and model priority reads happen in parallel.
   */
  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [])
  );

  /**
   * Fetches app settings, model priority, and today's usage for every known model.
   * All model usage reads run in parallel via Promise.all for speed.
   */
  async function loadSettings() {
    const [settings, priority] = await Promise.all([getSettings(), getModelPriority()]);
    setApiKey(settings.apiKey || '');
    setDailyGoal(String(settings.dailyCalorieGoal || 2000));
    setAverageDays(String(settings.averageDays || 5));
    setWeightUnit(settings.weightUnit || 'lbs');
    setAutoSaveToGallery(!!settings.autoSaveToGallery);
    setBodyWeightEnabled(!!settings.bodyWeightEnabled);
    setModelPriority(priority);

    // Load usage counts for all known models, not just the ones in the priority list
    const usage = {};
    await Promise.all(AVAILABLE_MODELS.map(async m => {
      usage[m.id] = await getModelUsageToday(m.id);
    }));
    setModelUsage(usage);
  }

  // ── Save Handlers ──

  /**
   * Immediately persists the full settings object with one field overridden.
   * Used by feature toggles so they take effect without pressing Save Settings.
   */
  async function saveFeature(updates) {
    await saveSettings({
      apiKey:           apiKey.trim(),
      dailyCalorieGoal: parseInt(dailyGoal, 10) || 2000,
      averageDays:      parseInt(averageDays, 10) || 5,
      weightUnit,
      autoSaveToGallery,
      bodyWeightEnabled,
      ...updates,
    });
  }

  /**
   * Saves just the API key (along with the current calorie goal so we don't
   * accidentally clear it). Shows a brief "✓ Saved!" flash inside the API key card.
   * This is separate from handleSave() so the user can save the key independently.
   */
  async function handleSaveKey() {
    await saveSettings({
      apiKey:           apiKey.trim(),
      dailyCalorieGoal: parseInt(dailyGoal, 10) || 2000,
      averageDays:      parseInt(averageDays, 10) || 5,
      weightUnit,
      autoSaveToGallery,
      bodyWeightEnabled,
    });
    setSavedKeyIndicator(true);
    setTimeout(() => setSavedKeyIndicator(false), 2500);
  }

  /**
   * Validates and saves both the API key and the daily calorie goal.
   * The calorie goal must be between 500 and 10,000 to catch obviously wrong values.
   * Shows a brief "✓ Saved!" flash on the bottom button.
   */
  async function handleSave() {
    const goal = parseInt(dailyGoal, 10);
    if (isNaN(goal) || goal < 500 || goal > 10000) {
      Alert.alert('Invalid Goal', 'Daily calorie goal must be between 500 and 10,000.');
      return;
    }
    await saveSettings({ apiKey: apiKey.trim(), dailyCalorieGoal: goal, averageDays: parseInt(averageDays, 10) || 5, weightUnit, autoSaveToGallery, bodyWeightEnabled });
    setSavedIndicator(true);
    setTimeout(() => setSavedIndicator(false), 2500);
  }

  // ── Model Priority Handlers ──

  /**
   * Re-reads today's usage count for every known model from AsyncStorage
   * and updates the progress bars in the card.
   * Shows an ActivityIndicator while the reads are in flight.
   */
  async function refreshUsageCounts() {
    setRefreshingCounts(true);
    try {
      const usage = {};
      await Promise.all(AVAILABLE_MODELS.map(async m => {
        usage[m.id] = await getModelUsageToday(m.id);
      }));
      setModelUsage(usage);
    } finally {
      setRefreshingCounts(false);
    }
  }

  /**
   * Moves a model up (-1) or down (+1) in the priority list by swapping it
   * with its neighbour. Saves immediately so there's no pending "apply" button.
   * Guards against out-of-bounds moves (shouldn't happen given disabled arrows).
   */
  async function moveModel(index, direction) {
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex > 2) return;

    const updated = [...modelPriority];
    // Destructured swap — no temporary variable needed
    [updated[index], updated[swapIndex]] = [updated[swapIndex], updated[index]];

    setModelPriority(updated);
    await saveModelPriority(updated);
  }

  /**
   * Assigns a model to the slot currently being edited (editingSlot).
   * If the chosen model already occupies a different slot, that slot receives
   * the model that was previously in editingSlot (i.e. the two are swapped).
   * Saves immediately and closes the modal.
   */
  async function selectModelForSlot(modelId) {
    const updated     = [...modelPriority];
    const existingSlot = updated.findIndex(id => id === modelId);

    if (existingSlot !== -1 && existingSlot !== editingSlot) {
      // Swap: put the old model into the slot we're taking the new one from
      updated[existingSlot] = updated[editingSlot];
    }

    updated[editingSlot] = modelId;
    setModelPriority(updated);
    await saveModelPriority(updated);
    setShowModelPicker(false);
  }

  // ── Danger Zone ──

  /**
   * Asks for confirmation before wiping all meal data.
   * Settings and model priority are NOT deleted — only the meal entries.
   */
  async function handleClearData() {
    Alert.alert(
      'Clear All Data',
      'This will permanently delete all your logged meals. This cannot be undone.',
      [
        {
          text:  'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            await clearAllData();
            Alert.alert('Done', 'All meal history has been cleared.');
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  // A key is considered valid if it's more than 10 characters
  // (Google AI keys are typically 39 characters starting with "AIza")
  const keyIsValid = apiKey.trim().length > 10;

  // ── Render ──

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* ══ Section 1: Google AI API Key ══ */}
      <View style={styles.card}>
        {/* Card title with the Google "G" brand mark */}
        <View style={styles.cardTitleRow}>
          <Text style={styles.googleG}>G</Text>
          <Text style={styles.cardTitle}>Google AI API Key</Text>
        </View>
        <Text style={styles.cardDesc}>
          Required for food analysis via Gemini. Get your free key at{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(API_KEY_URL)} suppressHighlighting>
            aistudio.google.com/apikey
          </Text>
        </Text>

        {/* API key input + show/hide toggle */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="AIza..."
            placeholderTextColor={colors.border}
            secureTextEntry={!showKey} // mask by default, reveal when eye is tapped
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
          {/* Eye toggle: 👁️ to reveal, 🙈 to re-mask */}
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowKey(v => !v)}>
            <Text style={styles.eyeIcon}>{showKey ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>

        {/* Save Key button — scoped to this card; has its own flash indicator */}
        <TouchableOpacity
          style={[styles.saveKeyBtn, savedKeyIndicator && styles.saveBtnSuccess]}
          onPress={handleSaveKey}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>{savedKeyIndicator ? '✓  Saved!' : 'Save Key'}</Text>
        </TouchableOpacity>

        {/* Key validation indicator — only shown once the user has typed something */}
        {apiKey.trim().length > 0 && (
          <View style={styles.keyStatus}>
            <View style={[styles.statusDot, { backgroundColor: keyIsValid ? colors.success : colors.warning }]} />
            <Text style={[styles.statusText, { color: keyIsValid ? colors.success : colors.warning }]}>
              {keyIsValid ? 'Key entered' : 'Key looks too short'}
            </Text>
          </View>
        )}

        {/* Step-by-step instructions for getting a free API key */}
        <View style={styles.stepsBox}>
          <Text style={styles.stepsTitle}>How to get your key:</Text>
          <Text style={styles.stepsText}>
            1. Tap{' '}
            <Text style={styles.link} onPress={() => Linking.openURL(API_KEY_URL)} suppressHighlighting>
              aistudio.google.com/apikey
            </Text>
            {'\n'}2. Sign in with your Google account{'\n'}
            3. Click <Text style={styles.bold}>Create API key</Text>{'\n'}
            4. Copy and paste it here
          </Text>
        </View>
      </View>

      {/* ══ Section 2: Daily Calorie Goal ══ */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Daily Calorie Goal</Text>
        <Text style={styles.cardDesc}>Your target calorie intake per day</Text>

        {/* Free-text number input */}
        <TextInput
          style={[styles.textInput, { marginTop: spacing.sm }]}
          value={dailyGoal}
          onChangeText={setDailyGoal}
          keyboardType="number-pad"
          placeholder="2000"
          placeholderTextColor={colors.border}
        />

        {/* Quick-select preset chips — tapping one fills the input directly */}
        <View style={styles.presetRow}>
          {[1500, 1800, 2000, 2200, 2500].map((preset) => (
            <TouchableOpacity
              key={preset}
              style={[styles.presetChip, dailyGoal === String(preset) && styles.presetChipActive]}
              onPress={() => setDailyGoal(String(preset))}
            >
              <Text style={[styles.presetText, dailyGoal === String(preset) && styles.presetTextActive]}>
                {preset}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ══ Section 2b: Calorie Average Window ══ */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Calorie Average Window</Text>
        <Text style={styles.cardDesc}>Number of days used for the rolling calorie average on the Today screen</Text>
        <View style={styles.avgInputRow}>
          <TextInput
            style={[styles.textInput, styles.avgInput]}
            value={averageDays}
            onChangeText={setAverageDays}
            keyboardType="number-pad"
            placeholder="5"
            placeholderTextColor={colors.border}
            maxLength={3}
          />
          <Text style={styles.avgInputLabel}>days</Text>
        </View>
      </View>

      {/* ══ Section 2c: Feature Toggles ══ */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Features</Text>

        {/* Auto-save to gallery toggle */}
        <View style={styles.featureRow}>
          <View style={styles.featureLeft}>
            <Text style={styles.featureLabel}>Auto-save photos to gallery</Text>
            <Text style={styles.featureDesc}>Save meal photos to your device library when logging</Text>
          </View>
          <TouchableOpacity
            style={[styles.featureToggle, autoSaveToGallery && styles.featureToggleOn]}
            onPress={() => {
              const next = !autoSaveToGallery;
              setAutoSaveToGallery(next);
              saveFeature({ autoSaveToGallery: next });
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.featureThumb, autoSaveToGallery && styles.featureThumbOn]} />
          </TouchableOpacity>
        </View>

        <View style={styles.featureDivider} />

        {/* Body weight tracking toggle */}
        <View style={styles.featureRow}>
          <View style={styles.featureLeft}>
            <Text style={styles.featureLabel}>Body weight tracking</Text>
            <Text style={styles.featureDesc}>Record daily weight and view history on the Today screen (beta testing)</Text>
          </View>
          <TouchableOpacity
            style={[styles.featureToggle, bodyWeightEnabled && styles.featureToggleOn]}
            onPress={() => {
              const next = !bodyWeightEnabled;
              setBodyWeightEnabled(next);
              saveFeature({ bodyWeightEnabled: next });
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.featureThumb, bodyWeightEnabled && styles.featureThumbOn]} />
          </TouchableOpacity>
        </View>

        {/* Weight unit selector — only shown when body weight tracking is on */}
        {bodyWeightEnabled && (
          <View style={[styles.toggleRow, { marginTop: spacing.sm }]}>
            {['lbs', 'kg'].map((unit) => (
              <TouchableOpacity
                key={unit}
                style={[styles.toggleChip, weightUnit === unit && styles.toggleChipActive]}
                onPress={() => { setWeightUnit(unit); saveFeature({ weightUnit: unit }); }}
              >
                <Text style={[styles.toggleText, weightUnit === unit && styles.toggleTextActive]}>
                  {unit}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* ══ Section 3: AI Model Priority ══ */}
      <View style={styles.card}>
        {/* Header row: title/description on the left, Refresh button on the right */}
        <View style={styles.modelCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>AI Model Priority</Text>
            <Text style={styles.cardDesc}>
              Models are tried in order. If the first fails or is over quota, the next is used automatically.
            </Text>
          </View>

          {/* Refresh button — re-reads today's usage counts from AsyncStorage */}
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={refreshUsageCounts}
            disabled={refreshingCounts}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {refreshingCounts
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={styles.refreshBtnText}>↺ Refresh</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Render one row per priority slot */}
        {modelPriority.map((modelId, index) => {
          // Look up the model metadata; fall back gracefully for unknown model IDs
          const model  = AVAILABLE_MODELS.find(m => m.id === modelId) || { id: modelId, name: modelId, dailyLimit: 1500, badge: '?' };
          const used   = modelUsage[modelId] || 0;
          const ratio  = Math.min(used / model.dailyLimit, 1); // 0–1 fill ratio
          // Progress bar colour: green → yellow at 50% → red at 85%
          const barColor = ratio > 0.85 ? colors.error : ratio > 0.5 ? '#D97706' : '#16A34A';

          return (
            // Tapping the whole row opens the model picker for this slot
            <TouchableOpacity
              key={modelId}
              style={styles.modelRow}
              onPress={() => { setEditingSlot(index); setShowModelPicker(true); }}
              activeOpacity={0.75}
            >
              {/* Rank badge: #1, #2, #3 */}
              <View style={styles.modelRankBadge}>
                <Text style={styles.modelRankText}>#{index + 1}</Text>
              </View>

              {/* Model info: name + usage progress bar */}
              <View style={styles.modelInfo}>
                <View style={styles.modelNameRow}>
                  <Text style={styles.modelBadge}>{model.badge}</Text>
                  <Text style={styles.modelName} numberOfLines={1}>{model.name}</Text>
                </View>
                <View style={styles.modelUsageRow}>
                  {/* Thin progress bar showing fraction of daily limit used */}
                  <View style={styles.modelProgressBg}>
                    <View style={[styles.modelProgressFill, { width: `${ratio * 100}%`, backgroundColor: barColor }]} />
                  </View>
                  <Text style={styles.modelUsageText}>{used}/{model.dailyLimit.toLocaleString()} today</Text>
                </View>
              </View>

              {/* Up/Down arrows for reordering without opening the picker */}
              <View style={styles.modelArrows}>
                {/* Up arrow — disabled on the first slot (already at top) */}
                <TouchableOpacity
                  onPress={() => moveModel(index, -1)}
                  disabled={index === 0}
                  style={[styles.arrowBtn, index === 0 && styles.arrowDisabled]}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.arrowText}>▲</Text>
                </TouchableOpacity>
                {/* Down arrow — disabled on the last slot (already at bottom) */}
                <TouchableOpacity
                  onPress={() => moveModel(index, 1)}
                  disabled={index === 2}
                  style={[styles.arrowBtn, index === 2 && styles.arrowDisabled]}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.arrowText}>▼</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}

        <Text style={styles.modelHint}>Tap a row to change the model · arrows to reorder</Text>
      </View>

      {/* ══ Model Picker Modal ══ */}
      {/*
        Bottom-sheet style modal that slides up when the user taps a model row.
        Shows all known models with their quotas, today's usage, recommendation
        badges, and a note if the chosen model is already in another slot.
      */}
      <Modal
        visible={showModelPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModelPicker(false)} // Android back button
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>

            {/* Modal header: title + close button */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Select Model for Slot #{editingSlot !== null ? editingSlot + 1 : ''}
              </Text>
              <TouchableOpacity onPress={() => setShowModelPicker(false)} style={styles.modalCloseBtn}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Suggested order based on free-tier quotas and quality</Text>

            {/* One row per available model */}
            {AVAILABLE_MODELS.map(model => {
              const isSelected      = modelPriority[editingSlot] === model.id;
              // Check if this model is already assigned to a different slot
              const isUsedElsewhere = modelPriority.some((id, i) => id === model.id && i !== editingSlot);
              const used    = modelUsage[model.id] || 0;
              const ratio   = Math.min(used / model.dailyLimit, 1);
              const barColor = ratio > 0.85 ? colors.error : ratio > 0.5 ? '#D97706' : '#16A34A';

              return (
                <TouchableOpacity
                  key={model.id}
                  style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
                  onPress={() => selectModelForSlot(model.id)}
                  activeOpacity={0.75}
                >
                  <View style={styles.pickerRowLeft}>
                    {/* Large emoji badge */}
                    <Text style={styles.pickerBadge}>{model.badge}</Text>

                    <View style={styles.pickerModelInfo}>
                      {/* Name row: model name + "Suggested #N" chip if applicable */}
                      <View style={styles.pickerNameRow}>
                        <Text style={[styles.pickerModelName, isSelected && { color: colors.primary }]}>
                          {model.name}
                        </Text>
                        {model.recommendedSlot && (
                          <View style={styles.recommendedBadge}>
                            <Text style={styles.recommendedText}>Suggested #{model.recommendedSlot}</Text>
                          </View>
                        )}
                      </View>

                      {/* Usage row: thin bar + "X/Y today · Z RPD limit" text */}
                      <View style={styles.pickerUsageRow}>
                        <View style={styles.pickerProgressBg}>
                          <View style={[styles.pickerProgressFill, { width: `${ratio * 100}%`, backgroundColor: barColor }]} />
                        </View>
                        <Text style={styles.pickerUsageText}>
                          {used}/{model.dailyLimit.toLocaleString()} today · {model.dailyLimit.toLocaleString()} RPD limit
                        </Text>
                      </View>

                      {/* Swap warning — shown if this model occupies another slot already */}
                      {isUsedElsewhere && (
                        <Text style={styles.usedElsewhere}>
                          Currently in slot #{modelPriority.indexOf(model.id) + 1} — will swap
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Checkmark on the currently selected model for this slot */}
                  {isSelected && <Text style={styles.pickerCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* ══ Section 4: How It Works ══ */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>How Food Tracker works</Text>
        <View style={styles.infoSteps}>
          {[
            ['📸', 'Take a photo of your meal'],
            ['🤖', 'Gemini AI identifies ingredients'],
            ['🔢', 'Get calories, macros & weight'],
            ['✏️', 'Edit or delete any meal entry'],
            ['📅', 'Review your history any time'],
          ].map(([icon, text], i) => (
            <View key={i} style={styles.infoStep}>
              <Text style={styles.infoStepIcon}>{icon}</Text>
              <Text style={styles.infoStepText}>{text}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ══ Section 5: Save Settings ══ */}
      {/* Saves both API key and calorie goal together */}
      <TouchableOpacity
        style={[styles.saveBtn, styles.saveBtnBottom, savedIndicator && styles.saveBtnSuccess]}
        onPress={handleSave}
        activeOpacity={0.85}
      >
        <Text style={styles.saveBtnText}>{savedIndicator ? '✓  Saved!' : 'Save Settings'}</Text>
      </TouchableOpacity>

      {/* ══ Section 6: Danger Zone ══ */}
      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>Danger Zone</Text>
        <TouchableOpacity style={styles.clearBtn} onPress={handleClearData}>
          <Text style={styles.clearBtnText}>Clear All Meal History</Text>
        </TouchableOpacity>
      </View>

      {/* App version footer */}
      <View style={styles.footer}>
        <Text style={styles.footerVersion}>Food Tracker AI</Text>
        <Text style={styles.footerVersion}>Version 1.0</Text>
        <Text style={styles.footerText}>Powered by Google Gemini</Text>
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { paddingBottom: spacing.xxl },

  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  title:  { fontSize: fontSize.xxxl, fontWeight: '800', color: colors.text },

  // Generic white card used for each settings section
  card: {
    marginHorizontal: spacing.md,
    marginBottom:     spacing.md,
    backgroundColor:  colors.white,
    borderRadius:     radius.lg,
    padding:          spacing.lg,
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.07,
    shadowRadius:     10,
    elevation:        3,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  // Italic blue "G" to evoke the Google brand without using an actual logo
  googleG:  { fontSize: fontSize.xl, fontWeight: '900', color: '#4285F4', marginRight: spacing.xs, fontStyle: 'italic' },
  cardTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  cardDesc:  { fontSize: fontSize.md, color: colors.textSecondary, marginTop: 4, lineHeight: 20, marginBottom: spacing.sm },
  link:      { color: '#4285F4', fontWeight: '600' },
  bold:      { fontWeight: '700', color: colors.text },

  // API key input row
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  eyeBtn:   { padding: spacing.sm, marginLeft: spacing.xs },
  eyeIcon:  { fontSize: 20 },

  // Shared text input style (API key field and calorie goal field)
  textInput: {
    flex:             1,
    borderWidth:      1.5,
    borderColor:      colors.border,
    borderRadius:     radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical:  spacing.sm + 2,
    fontSize:         fontSize.md,
    color:            colors.text,
    backgroundColor:  colors.background,
  },

  // Key status indicator (green dot / yellow dot)
  keyStatus:  { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  statusDot:  { width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs },
  statusText: { fontSize: fontSize.sm, fontWeight: '500' },

  // Blue-tinted instruction box inside the API key card
  stepsBox:  { marginTop: spacing.md, backgroundColor: '#EFF6FF', borderRadius: radius.md, padding: spacing.md },
  stepsTitle: { fontSize: fontSize.sm, fontWeight: '700', color: '#1D4ED8', marginBottom: spacing.xs },
  stepsText:  { fontSize: fontSize.sm, color: '#1E3A8A', lineHeight: 22 },

  // Calorie goal preset chips
  presetRow:      { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, gap: spacing.xs },
  presetChip:     { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  presetChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  presetText:      { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  presetTextActive: { color: colors.primaryDark },

  // Average days input row
  avgInputRow:   { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, gap: spacing.sm },
  avgInput:      { flex: 0, width: 80 },
  avgInputLabel: { fontSize: fontSize.md, color: colors.textSecondary, fontWeight: '600' },

  // lbs/kg toggle chips
  toggleRow:       { flexDirection: 'row', gap: spacing.sm },
  toggleChip:      { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' },
  toggleChipActive:{ borderColor: colors.primary, backgroundColor: colors.primaryLight },
  toggleText:      { fontSize: fontSize.md, color: colors.textSecondary, fontWeight: '700' },
  toggleTextActive:{ color: colors.primaryDark },

  // Feature on/off toggle row
  featureRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  featureLeft:     { flex: 1, marginRight: spacing.md },
  featureLabel:    { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  featureDesc:     { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  featureDivider:  { height: 1, backgroundColor: colors.background, marginVertical: spacing.xs },
  featureToggle:   { width: 48, height: 28, borderRadius: 14, backgroundColor: colors.border, justifyContent: 'center', paddingHorizontal: 2 },
  featureToggleOn: { backgroundColor: colors.primary },
  featureThumb:    { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 },
  featureThumbOn:  { alignSelf: 'flex-end' },

  // How it works info card (tinted background instead of plain white)
  infoCard:     { marginHorizontal: spacing.md, marginBottom: spacing.md, backgroundColor: colors.primaryLight, borderRadius: radius.lg, padding: spacing.lg },
  infoTitle:    { fontSize: fontSize.lg, fontWeight: '700', color: colors.primaryDark, marginBottom: spacing.md },
  infoSteps:    { gap: spacing.sm },
  infoStep:     { flexDirection: 'row', alignItems: 'center' },
  infoStepIcon: { fontSize: 20, width: 30 },
  infoStepText: { fontSize: fontSize.md, color: colors.primaryDark, flex: 1 },

  // Save Key button — full-width inside the API key card
  saveKeyBtn: {
    marginTop:        spacing.md,
    marginBottom:     spacing.xs,
    backgroundColor:  colors.primary,
    borderRadius:     radius.lg,
    paddingVertical:  spacing.md,
    alignItems:       'center',
  },
  // Base for the bottom Save Settings button (no visual styles — saveBtnBottom adds them)
  saveBtn: {
    marginTop:    spacing.md,
    marginBottom: spacing.xs,
  },
  // Additional styles applied to the bottom Save Settings button only
  saveBtnBottom: {
    marginHorizontal: spacing.md,
    marginBottom:     spacing.sm,
    backgroundColor:  colors.primary,
    borderRadius:     radius.lg,
    paddingVertical:  spacing.md + 2,
    alignItems:       'center',
    shadowColor:      colors.primaryDark,
    shadowOffset:     { width: 0, height: 4 },
    shadowOpacity:    0.3,
    shadowRadius:     8,
    elevation:        6,
  },
  // Applied on top of saveKeyBtn or saveBtnBottom when the flash indicator is active
  saveBtnSuccess: { backgroundColor: '#16A34A' },
  saveBtnText:    { fontSize: fontSize.lg, color: colors.white, fontWeight: '700' },

  // ── Model Priority Card Styles ──

  // Header row: title/desc flex-left, refresh button flex-right
  modelCardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.xs },

  // Refresh button — outlined style so it doesn't compete with the save buttons
  refreshBtn:     { marginTop: 2, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, minWidth: 80, alignItems: 'center' },
  refreshBtnText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700' },

  // Individual model priority row
  modelRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.background, gap: spacing.sm },
  modelRankBadge: { width: 28, height: 28, borderRadius: radius.sm, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  modelRankText:  { fontSize: fontSize.sm, fontWeight: '800', color: colors.primaryDark },
  modelInfo:      { flex: 1 },
  modelNameRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  modelBadge:     { fontSize: 14 },
  modelName:      { fontSize: fontSize.md, fontWeight: '600', color: colors.text, flex: 1 },
  modelUsageRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 },
  modelProgressBg:   { flex: 1, height: 5, backgroundColor: colors.background, borderRadius: radius.full, overflow: 'hidden' },
  modelProgressFill: { height: '100%', borderRadius: radius.full },
  modelUsageText: { fontSize: fontSize.xs, color: colors.textSecondary, minWidth: 90, textAlign: 'right' },
  modelArrows:    { gap: 2 },
  arrowBtn:       { paddingHorizontal: 6, paddingVertical: 3, alignItems: 'center' },
  arrowDisabled:  { opacity: 0.2 },
  arrowText:      { fontSize: 12, color: colors.primary, fontWeight: '700' },
  modelHint:      { fontSize: fontSize.xs, color: colors.border, marginTop: spacing.sm, textAlign: 'center' },

  // ── Model Picker Modal Styles ──

  // Semi-transparent overlay behind the sheet
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  // Bottom sheet panel
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.md, maxHeight: '80%' },
  modalHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  modalTitle:     { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  modalCloseBtn:  { padding: spacing.sm },
  modalCloseText: { fontSize: fontSize.lg, color: colors.textSecondary, fontWeight: '600' },
  modalSubtitle:  { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.md },

  // Individual picker row
  pickerRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md, marginBottom: spacing.xs, backgroundColor: colors.background },
  pickerRowSelected: { backgroundColor: colors.primaryLight }, // highlight the current selection
  pickerRowLeft:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickerBadge:       { fontSize: 22 },
  pickerModelInfo:   { flex: 1 },
  pickerNameRow:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  pickerModelName:   { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  // Yellow "Suggested #N" chip
  recommendedBadge:  { backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full },
  recommendedText:   { fontSize: fontSize.xs, color: '#92400E', fontWeight: '700' },
  pickerUsageRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 },
  pickerProgressBg:  { width: 60, height: 4, backgroundColor: colors.border, borderRadius: radius.full, overflow: 'hidden' },
  pickerProgressFill:{ height: '100%', borderRadius: radius.full },
  pickerUsageText:   { fontSize: fontSize.xs, color: colors.textSecondary, flex: 1 },
  // Italic note shown when the selected model is already in another slot
  usedElsewhere:     { fontSize: fontSize.xs, color: colors.primary, marginTop: 2, fontStyle: 'italic' },
  pickerCheck:       { fontSize: 18, color: colors.primary, fontWeight: '700', paddingLeft: spacing.sm },

  // ── Danger Zone Card ──
  dangerCard:    { marginHorizontal: spacing.md, marginBottom: spacing.md, marginTop: spacing.sm, backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: '#FEE2E2' },
  dangerTitle:   { fontSize: fontSize.md, fontWeight: '700', color: colors.error, marginBottom: spacing.sm },
  clearBtn:      { borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' },
  clearBtnText:  { color: colors.error, fontWeight: '600', fontSize: fontSize.md },

  footer:        { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.lg },
  footerVersion: { fontSize: fontSize.md, fontWeight: '700', color: colors.textSecondary, marginBottom: 2 },
  footerText:    { fontSize: fontSize.sm, color: colors.border, marginTop: 4 },
});
