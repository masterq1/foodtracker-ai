const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-6';

const FOOD_ANALYSIS_PROMPT = `You are a professional nutritionist and food scientist. Carefully analyze this food image and respond ONLY with a valid JSON object using exactly this structure:

{
  "foodName": "Descriptive name of the dish or food item",
  "ingredients": [
    { "name": "Ingredient name", "amount": "Estimated portion (e.g. 150g, 2 slices, 1 cup)" }
  ],
  "totalCalories": <integer — total estimated calories>,
  "totalWeightGrams": <integer — total estimated weight in grams>,
  "confidence": "high" | "medium" | "low",
  "notes": "Brief note about estimation accuracy or notable nutritional aspects"
}

Guidelines:
- Be realistic and accurate with calorie estimates
- If multiple food items are visible, include them all and sum totals
- Use standard portion sizes as reference points
- Set confidence "low" if the image is unclear or ambiguous
- Respond ONLY with the JSON object — no markdown, no explanation, no other text`;

export async function analyzeFoodImage(base64Image, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      'API key not configured. Please add your Anthropic API key in Settings.'
    );
  }

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: FOOD_ANALYSIS_PROMPT,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    let errorMessage = `API request failed (${response.status})`;
    try {
      const errorData = await response.json();
      if (errorData.error?.message) {
        errorMessage = errorData.error.message;
      }
    } catch {
      // ignore parse error
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const rawText = data.content?.[0]?.text?.trim();

  if (!rawText) {
    throw new Error('Empty response from API');
  }

  // Extract JSON even if model wraps it in backticks
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse nutritional analysis from response');
  }

  try {
    const result = JSON.parse(jsonMatch[0]);
    // Ensure numeric fields are numbers
    result.totalCalories = Math.round(Number(result.totalCalories) || 0);
    result.totalWeightGrams = Math.round(Number(result.totalWeightGrams) || 0);
    return result;
  } catch {
    throw new Error('Invalid JSON in API response');
  }
}
