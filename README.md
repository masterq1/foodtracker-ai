# Food Tracker

A React Native mobile app for logging meals by photo. Snap a picture of your food and get instant AI-powered nutritional analysis — calories, macros, weight, and estimated blood glucose impact — stored locally on your device.

## Features

- **Photo analysis** — Take a photo or pick from gallery; Gemini AI identifies the food and estimates nutrition
- **Manual entry** — Add or edit meals by hand when no photo is available
- **Date navigation** — Browse and log meals for any past date
- **History** — Collapsible day-by-day history with daily totals and macro breakdown
- **Model cascade** — Configurable 3-slot AI model priority with per-model daily usage tracking
- **Offline-first** — All data stored locally via AsyncStorage; no account or backend required

## Tech Stack

| Layer | Library |
|---|---|
| Framework | React Native 0.81 + Expo ~54 |
| Navigation | React Navigation 7 (bottom tabs + stack) |
| Storage | AsyncStorage 2.2 |
| File system | expo-file-system ~19 |
| Camera / gallery | expo-image-picker ~17 |
| AI analysis | Google Gemini API (v1beta) |
| Safe area | react-native-safe-area-context ~5.6 |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (`npm install -g expo-cli`)
- [Expo Go](https://expo.dev/client) app on your Android or iOS device
- A [Google AI Studio](https://aistudio.google.com/) API key (free tier works)

### Install

```bash
git clone https://github.com/yourname/food-tracker.git
cd food-tracker
npm install
```

### Run

```bash
npx expo start
```

Scan the QR code with Expo Go on your device.

### Configure

1. Open the app and tap **Settings** (gear icon)
2. Paste your Google Gemini API key and tap **Save Key**
3. Optionally set your daily calorie goal and adjust AI model priority

## Project Structure

```
food-tracker/
├── App.js                      # App root, SafeAreaProvider
├── app.json                    # Expo config (permissions, icons)
├── src/
│   ├── navigation/
│   │   └── AppNavigator.js     # Bottom tab + stack routing
│   ├── screens/
│   │   ├── HomeScreen.js       # Today's meals, date nav, FAB
│   │   ├── AnalysisScreen.js   # AI analysis result + save
│   │   ├── EditMealScreen.js   # Manual entry / meal editor
│   │   ├── HistoryScreen.js    # Past days, collapsible rows
│   │   └── SettingsScreen.js   # API key, goal, model priority
│   ├── services/
│   │   ├── geminiApi.js        # Gemini API calls + model cascade
│   │   ├── storage.js          # AsyncStorage read/write helpers
│   │   └── claudeApi.js        # Claude API integration
│   └── theme/
│       └── index.js            # Colors, spacing, typography
└── assets/                     # App icons and splash screen
```

## AI Models

The app uses Google Gemini (free tier). You can configure which models to try in priority order via Settings.

| Model | Daily Limit | Badge | Suggested Slot |
|---|---|---|---|
| Gemini 2.0 Flash | 1500 req/day | ⚡ | #1 |
| Gemini 2.5 Flash | 25 req/day | 🧠 | #2 |
| Gemini 2.5 Flash Lite | 30 req/day | 💨 | #3 |
| Gemini Flash Latest | 1500 req/day | 🔥 | — |
| Gemini 3 Flash Preview | 25 req/day | 🚀 | — |

The app cascades through your priority list automatically when a model hits its daily limit.

## Meal Data

Each logged meal stores:

```js
{
  id, timestamp, foodName,
  totalCalories, totalWeightGrams,
  proteinGrams, carbsGrams, fatGrams,
  glucoseRiseMgDl,       // estimated blood glucose rise
  ingredients,           // [{ name, amount }]
  confidence,            // 'high' | 'medium' | 'low'
  notes, imageUri,
  analyzedByModel        // e.g. 'gemini-2.0-flash'
}
```

All data is stored locally under AsyncStorage keys:
- `@food_tracker_settings` — API key and calorie goal
- `@meals_YYYY-MM-DD` — meal array per day
- `@model_priority` — 3-slot model order
- `@model_usage_<modelId>` — daily usage counters

## License

Private / personal use.
