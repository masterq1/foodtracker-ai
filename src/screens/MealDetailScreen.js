/**
 * MealDetailScreen.js
 *
 * Read-only view of a saved meal, styled to match the AnalysisScreen results.
 * Reached by tapping any meal card in HomeScreen or HistoryScreen.
 *
 * Route params:
 *   meal    — full meal object from storage
 *   dateKey — YYYY-MM-DD string of the day this meal belongs to
 *
 * Action bar: ← Back | Edit Meal (navigates to EditMealScreen)
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AVAILABLE_MODELS } from '../services/storage';
import { colors, spacing, fontSize, radius } from '../theme';

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Coloured pill badge for AI confidence level. */
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

/** Stat tile with emoji, number, unit, and label. */
function StatCard({ value, unit, label, emoji, accentColor }) {
  return (
    <View style={[styles.statCard, accentColor && { borderTopColor: accentColor }]}>
      <Text style={styles.statEmoji}>{emoji}</Text>
      <Text style={[styles.statNumber, accentColor && { color: accentColor }]}>
        {(value || 0).toLocaleString()}
      </Text>
      <Text style={styles.statUnit}>{unit}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MealDetailScreen({ route, navigation }) {
  const { meal, dateKey } = route.params;
  const insets = useSafeAreaInsets();

  const model = meal.analyzedByModel
    ? AVAILABLE_MODELS.find(m => m.id === meal.analyzedByModel)
    : null;

  /** Formats the meal's stored ISO timestamp as a readable date + time string. */
  function formatTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' })
      + '  ·  '
      + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Meal photo — only shown if one was saved */}
        {!!meal.imageUri && (
          <Image source={{ uri: meal.imageUri }} style={styles.image} resizeMode="cover" />
        )}

        {/* ── Name & Meta Card ── */}
        <View style={styles.nameCard}>
          <Text style={styles.foodName}>{meal.foodName}</Text>
          <Text style={styles.timestamp}>{formatTimestamp(meal.timestamp)}</Text>

          <View style={styles.nameCardFooter}>
            {/* Only show confidence badge for AI-analyzed meals */}
            {meal.confidence ? (
              <ConfidenceBadge confidence={meal.confidence} />
            ) : (
              <View style={styles.manualBadge}>
                <Text style={styles.manualBadgeText}>Manual entry</Text>
              </View>
            )}
            {/* Model attribution for AI-analyzed meals */}
            {!!model && (
              <Text style={styles.modelText}>{model.badge} {model.name}</Text>
            )}
          </View>
        </View>

        {/* ── Calories + Weight ── */}
        <View style={styles.statsRow}>
          <StatCard value={meal.totalCalories}    unit="kcal" label="Calories" emoji="🔥" accentColor={colors.secondary} />
          <StatCard value={meal.totalWeightGrams} unit="g"    label="Weight"   emoji="⚖️" accentColor={colors.primary} />
        </View>

        {/* ── Macronutrients ── */}
        <View style={styles.macroRow}>
          <StatCard value={meal.proteinGrams} unit="g" label="Protein" emoji="💪" accentColor="#1D4ED8" />
          <StatCard value={meal.carbsGrams}   unit="g" label="Carbs"   emoji="🌾" accentColor="#C2410C" />
          <StatCard value={meal.fatGrams}     unit="g" label="Fat"     emoji="🥑" accentColor="#7E22CE" />
        </View>

        {/* ── Glucose Impact ── */}
        {meal.glucoseRiseMgDl > 0 && (
          <View style={styles.glucoseCard}>
            <View style={styles.glucoseLeft}>
              <Text style={styles.glucoseEmoji}>📈</Text>
              <View>
                <Text style={styles.glucoseTitle}>Glucose Impact</Text>
                <Text style={styles.glucoseSubtitle}>estimated rise after meal</Text>
              </View>
            </View>
            <View style={styles.glucoseRight}>
              <Text style={styles.glucoseValue}>{meal.glucoseRiseMgDl}</Text>
              <Text style={styles.glucoseUnit}> mg/dL</Text>
            </View>
          </View>
        )}

        {/* ── Ingredients ── */}
        {meal.ingredients?.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ingredients</Text>
            {meal.ingredients.map((item, i) => (
              <View key={i} style={styles.ingredientRow}>
                <View style={styles.ingredientBullet} />
                <Text style={styles.ingredientName}>{item.name}</Text>
                <Text style={styles.ingredientAmount}>{item.amount}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Notes ── */}
        {!!meal.notes && (
          <View style={styles.notesCard}>
            <Text style={styles.notesIcon}>💡</Text>
            <Text style={styles.notesText}>{meal.notes}</Text>
          </View>
        )}

        <View style={{ height: 100 + (insets.bottom || 0) }} />
      </ScrollView>

      {/* ── Action Bar ── */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom || spacing.md }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => navigation.navigate('EditMeal', { meal, dateKey })}
        >
          <Text style={styles.editText}>Edit Meal</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll:    { paddingBottom: spacing.xl },

  image: { width: '100%', height: 280 },

  // Name & meta card
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
  foodName:  { fontSize: fontSize.xxl, fontWeight: '800', color: colors.text },
  timestamp: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.sm },
  nameCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },

  // Confidence badge
  confidenceBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full },
  confidenceDot:   { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  confidenceText:  { fontSize: fontSize.sm, fontWeight: '600' },

  // Manual entry badge (no AI confidence)
  manualBadge:     { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: '#F3F4F6' },
  manualBadgeText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },

  // Model attribution
  modelText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '500' },

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

  // Glucose card
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

  // Ingredients card
  card:      { marginHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  cardTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  ingredientRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.background },
  ingredientBullet: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, marginRight: spacing.sm },
  ingredientName:   { flex: 1, fontSize: fontSize.md, color: colors.text },
  ingredientAmount: { fontSize: fontSize.md, color: colors.textSecondary },

  // Notes card
  notesCard: { flexDirection: 'row', marginHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md, alignItems: 'flex-start' },
  notesIcon: { fontSize: 18, marginRight: spacing.sm, marginTop: 1 },
  notesText: { flex: 1, fontSize: fontSize.md, color: colors.primaryDark, lineHeight: 20 },

  // Action bar
  actionBar: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    flexDirection:   'row',
    padding:         spacing.md,
    gap:             spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth:  1,
    borderTopColor:  colors.border,
  },
  backButton: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.background, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  backText:   { fontSize: fontSize.lg, color: colors.text, fontWeight: '600' },
  editButton: { flex: 2, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  editText:   { fontSize: fontSize.lg, color: colors.white, fontWeight: '700' },
});
