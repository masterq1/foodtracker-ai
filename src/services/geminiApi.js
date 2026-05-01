/**
 * geminiApi.js
 *
 * Handles all communication with the Google Gemini generative AI API.
 * Responsibilities:
 *   - Building the request body (prompt + image or text)
 *   - Applying model-specific config tweaks (e.g. disabling thinking for 2.5+)
 *   - Executing API calls with automatic retry on transient errors
 *   - Cascading through the user's priority list when a model fails
 *   - Parsing and normalising the JSON nutrition result
 *   - Tracking which model was actually used so it can be stored with the meal
 *
 * Model selection is fully dynamic — there are no hardcoded model constants here.
 * The priority order is read from AsyncStorage at call time via storage.js.
 */

import { getModelPriority, getModelUsageToday, incrementModelUsage, AVAILABLE_MODELS } from './storage';

// Base URL for the Gemini REST API (v1beta supports all current flash models)
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ─── Model Helpers ────────────────────────────────────────────────────────────

/**
 * Returns the human-readable display name for a model ID.
 * Falls back to the raw ID string if the model isn't in our catalog
 * (e.g. if a model was added to storage before being added to AVAILABLE_MODELS).
 */
export function modelDisplayName(modelId) {
  const model = AVAILABLE_MODELS.find(m => m.id === modelId);
  return model ? model.name : modelId;
}

/**
 * Returns info about the #1 priority model so the UI can show the user
 * which model will be tried first and how many requests have been used today.
 *
 * Returns: { modelId, displayName, count, dailyLimit }
 */
export async function getActiveModelInfo() {
  const priority = await getModelPriority();
  const modelId  = priority[0]; // first in the priority list
  const model    = AVAILABLE_MODELS.find(m => m.id === modelId);
  const count    = await getModelUsageToday(modelId);
  return {
    modelId,
    displayName: modelDisplayName(modelId),
    count,
    dailyLimit: model?.dailyLimit ?? 1500, // safe fallback if not in catalog
  };
}

// ─── Network Helpers ──────────────────────────────────────────────────────────

/**
 * Simple promise-based delay used between retry attempts.
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calls a single Gemini model with automatic retry on transient server errors.
 *
 * Retryable conditions (up to `retries` extra attempts, 2s apart):
 *   - "high demand" in the error message  → server overloaded
 *   - HTTP 503                            → service unavailable
 *   - "overloaded" in the error message   → same as above
 *
 * Non-retryable errors (quota exceeded, bad API key, etc.) are rethrown immediately.
 */
async function callWithRetry(model, body, apiKey, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await callGemini(model, body, apiKey);
    } catch (err) {
      const isRetryable =
        err.message.includes('high demand') ||
        err.message.includes('503') ||
        err.message.includes('overloaded');

      if (i < retries && isRetryable) {
        await delay(2000); // wait 2 seconds before the next attempt
      } else {
        throw err; // either not retryable, or we've exhausted our retries
      }
    }
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

/**
 * The system prompt sent alongside every image analysis request.
 * Instructs the model to return ONLY a JSON object (no markdown fences,
 * no prose) so the response can be reliably parsed.
 *
 * Key fields requested:
 *   foodName         — descriptive name of the dish
 *   ingredients      — list of { name, amount } objects
 *   totalCalories    — kcal (integer)
 *   totalWeightGrams — grams (integer)
 *   proteinGrams     — grams (integer)
 *   carbsGrams       — grams (integer)
 *   fatGrams         — grams (integer)
 *   glucoseRiseMgDl  — estimated post-meal blood glucose rise (20–100 mg/dL typical)
 *   confidence       — "high" | "medium" | "low"
 *   notes            — brief caveat about estimation accuracy
 */
const PROMPT = `You are a professional nutritionist. Analyze this food image carefully and respond ONLY with a valid JSON object — no markdown, no explanation, no other text:

{
  "foodName": "descriptive name of the dish",
  "ingredients": [
    { "name": "ingredient name", "amount": "estimated portion e.g. 150g, 2 slices" }
  ],
  "totalCalories": <integer>,
  "totalWeightGrams": <integer>,
  "proteinGrams": <integer>,
  "carbsGrams": <integer>,
  "fatGrams": <integer>,
  "glucoseRiseMgDl": <integer>,
  "confidence": "high" | "medium" | "low",
  "notes": "brief note about estimation accuracy"
}

Guidelines:
- Be realistic and accurate with all estimates
- If multiple items are visible, include all and sum the totals
- Ensure protein + carbs + fat macros are consistent with the calorie total (roughly: protein*4 + carbs*4 + fat*9 ≈ calories)
- glucoseRiseMgDl: estimate the expected blood glucose rise in mg/dL for an average healthy adult after consuming this meal (consider glycemic index, carb content, fiber, fat, and protein); typical range is 20–100 mg/dL
- Set confidence to "low" if the image is unclear`;

// ─── Request Building ─────────────────────────────────────────────────────────

/**
 * Gemini 2.5+ models have an extended "thinking" phase enabled by default,
 * which adds latency and token cost without improving nutrition analysis.
 * This function injects thinkingConfig: { thinkingBudget: 0 } to disable it
 * for any model whose ID starts with "gemini-2.5" or "gemini-3".
 * Models that don't need this (e.g. gemini-2.0-flash) receive the body unchanged.
 */
function buildBody(base, model) {
  const needsThinkingDisabled = model.startsWith('gemini-2.5') || model.startsWith('gemini-3');
  if (!needsThinkingDisabled) return base;
  return {
    ...base,
    generationConfig: {
      ...base.generationConfig,
      thinkingConfig: { thinkingBudget: 0 }, // disable extended reasoning
    },
  };
}

// ─── Raw API Call ─────────────────────────────────────────────────────────────

/**
 * Makes a single HTTP POST to the Gemini generateContent endpoint.
 * Applies model-specific body tweaks via buildBody() before sending.
 * Throws a descriptive Error on any non-2xx response, extracting the
 * server's error message from the JSON response body when available.
 */
async function callGemini(model, body, apiKey) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey.trim()}`;

  // Apply any model-specific config adjustments before sending
  body = buildBody(body, model);

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!response.ok) {
    // Try to extract the server's own error message for a more helpful throw
    let msg = `API error (${response.status})`;
    try {
      const err = await response.json();
      msg = err.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  return response.json();
}

// ─── Result Parsing ───────────────────────────────────────────────────────────

/**
 * Extracts and normalises the nutrition JSON from a raw Gemini API response.
 *
 * The model is instructed to return plain JSON, but may occasionally wrap it
 * in markdown code fences or add surrounding prose. The regex /\{[\s\S]*\}/
 * is used as a safety net to pull out just the JSON object regardless.
 *
 * All numeric fields are coerced with Number() and rounded to integers
 * to guard against the model returning strings, floats, or nulls.
 *
 * @param {object} data      - Raw JSON response from the Gemini API
 * @param {string} errorMsg  - Message to throw if no JSON object is found
 * @returns {object} Normalised nutrition result object
 */
function parseNutritionResult(data, errorMsg) {
  // Check whether the whole prompt was blocked before any candidate was generated
  // (e.g. the image triggered a safety filter at the input stage)
  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Request blocked by Gemini safety filters (${blockReason}). Try a clearer photo.`);
  }

  const candidate = data.candidates?.[0];

  // Check the finish reason — anything other than STOP means the model
  // didn't complete its response normally
  const finishReason = candidate?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    // SAFETY means the output itself was blocked; MAX_TOKENS means it was cut short
    if (finishReason === 'SAFETY') {
      throw new Error('Gemini declined to analyze this image due to safety filters. Try a different photo.');
    }
    if (finishReason === 'MAX_TOKENS') {
      throw new Error('Gemini response was cut short. Try reducing image complexity.');
    }
    throw new Error(`Gemini stopped unexpectedly (reason: ${finishReason}).`);
  }

  // Drill into the nested response structure to reach the text content
  const text = candidate?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty response from Gemini API. Please try again.');

  // Extract the first {...} block from the response.
  // The model is told to return plain JSON, but may occasionally wrap it in
  // markdown fences or add a short prose prefix — the regex handles all of that.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Include what the model actually returned (first 200 chars) so the error
    // message is useful for diagnosing unexpected responses
    const preview = text.length > 200 ? text.slice(0, 200) + '…' : text;
    throw new Error(`${errorMsg}\n\nModel said: "${preview}"`);
  }

  try {
    const result = JSON.parse(jsonMatch[0]);

    // Coerce all numeric fields to safe integers — the model sometimes returns
    // strings like "320" or floats like 319.7, and we always want whole numbers
    result.totalCalories    = Math.round(Number(result.totalCalories)    || 0);
    result.totalWeightGrams = Math.round(Number(result.totalWeightGrams) || 0);
    result.proteinGrams     = Math.round(Number(result.proteinGrams)     || 0);
    result.carbsGrams       = Math.round(Number(result.carbsGrams)       || 0);
    result.fatGrams         = Math.round(Number(result.fatGrams)         || 0);
    result.glucoseRiseMgDl  = Math.round(Number(result.glucoseRiseMgDl)  || 0);

    return result;
  } catch {
    throw new Error('Invalid JSON in Gemini response. Please try again.');
  }
}

// ─── Public Analysis Functions ────────────────────────────────────────────────

/**
 * Analyses a food image using the Gemini API and returns a nutrition object.
 *
 * The image is sent as a base64-encoded JPEG alongside the nutrition prompt.
 * Models are tried in the user's configured priority order. If a model fails
 * (quota exceeded, overloaded, etc.) the next model in the list is attempted.
 * The usage counter is incremented only when a call actually succeeds.
 *
 * The returned object extends the parsed nutrition JSON with:
 *   analyzedByModel — the model ID that produced the successful response
 *
 * @param {string} base64Image - Base64-encoded JPEG image data
 * @param {string} apiKey      - Google AI API key from settings
 */
export async function analyzeFoodImage(base64Image, apiKey) {
  if (!apiKey?.trim()) {
    throw new Error('Google AI API key not configured. Please add your key in Settings.');
  }

  // Read the user's current priority list from storage (dynamically, at call time)
  const priority = await getModelPriority();

  // Build the multimodal request body: image + text prompt
  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } }, // the photo
          { text: PROMPT }, // the nutritionist instruction
        ],
      },
    ],
    generationConfig: {
      temperature:    0.2,  // low temperature = more consistent, less creative output
      maxOutputTokens: 4096, // nutrition JSON is small; cap to avoid runaway responses
    },
  };

  let data;
  let lastErr;
  let usedModel; // track which model in the cascade actually succeeded

  // Try each model in priority order; stop as soon as one succeeds
  for (const modelId of priority) {
    try {
      data      = await callWithRetry(modelId, body, apiKey);
      await incrementModelUsage(modelId); // only count successful requests
      usedModel = modelId;
      break; // success — no need to try further models
    } catch (err) {
      lastErr = err; // save error in case all models fail
    }
  }

  // If every model in the priority list failed, surface the last error
  if (!data) throw lastErr;

  const result = parseNutritionResult(data, 'Could not parse food analysis from Gemini response');

  // Stamp the result with the model that produced it so it's saved with the meal
  result.analyzedByModel = usedModel;
  return result;
}

/**
 * Re-analyses a meal using only text (no image) after the user has edited
 * the food name and/or ingredients on the AnalysisScreen.
 *
 * Builds a text-only prompt from the edited meal description and sends it
 * through the same model cascade as analyzeFoodImage.
 *
 * The returned object also includes analyzedByModel.
 *
 * @param {string}   foodName    - The meal name (possibly edited by the user)
 * @param {object[]} ingredients - Array of { name, amount } objects
 * @param {string}   apiKey      - Google AI API key from settings
 */
export async function reanalyzeFoodFromText(foodName, ingredients, apiKey) {
  if (!apiKey?.trim()) {
    throw new Error('Google AI API key not configured. Please add your key in Settings.');
  }

  // Build a readable ingredient list, filtering out any blank rows the user left
  const ingredientList = ingredients
    .filter(i => i.name?.trim())
    .map(i => `- ${i.name}${i.amount ? `: ${i.amount}` : ''}`)
    .join('\n');

  // Text-only prompt — same JSON schema as the image prompt,
  // but instructs the model to treat the provided description as truth
  const textPrompt = `You are a professional nutritionist. Based on the following meal description, provide a nutritional analysis. Respond ONLY with a valid JSON object — no markdown, no explanation, no other text:

Meal: ${foodName}
Ingredients:
${ingredientList}

{
  "foodName": "descriptive name of the dish",
  "ingredients": [
    { "name": "ingredient name", "amount": "estimated portion e.g. 150g, 2 slices" }
  ],
  "totalCalories": <integer>,
  "totalWeightGrams": <integer>,
  "proteinGrams": <integer>,
  "carbsGrams": <integer>,
  "fatGrams": <integer>,
  "glucoseRiseMgDl": <integer>,
  "confidence": "high" | "medium" | "low",
  "notes": "brief note about estimation accuracy"
}

Guidelines:
- Use the provided meal name and ingredients as the source of truth
- Sum nutritional totals across all ingredients
- Ensure protein*4 + carbs*4 + fat*9 ≈ calories
- glucoseRiseMgDl: estimated blood glucose rise in mg/dL for an average healthy adult (typical range: 20–100)
- Set confidence to "medium" since this is a text-based estimate`;

  const priority = await getModelPriority();

  // Text-only request — no inlineData part
  const body = {
    contents: [{ parts: [{ text: textPrompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  };

  let data;
  let lastErr;
  let usedModel;

  // Same cascade pattern as analyzeFoodImage
  for (const modelId of priority) {
    try {
      data      = await callWithRetry(modelId, body, apiKey);
      await incrementModelUsage(modelId);
      usedModel = modelId;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!data) throw lastErr;

  const result = parseNutritionResult(data, 'Could not parse nutrition analysis from response');
  result.analyzedByModel = usedModel;
  return result;
}
