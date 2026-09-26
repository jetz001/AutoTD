// AI Decision Engine for Cloudflare Workers (OpenAI / Claude / Gemini)

export interface AIDecision {
  action: "HOLD" | "BUY_SPOT" | "SELL_SPOT" | "OPEN_LONG" | "OPEN_SHORT" | "CLOSE_POSITION";
  symbol: string;
  leverage: number;
  riskPercent: number; // 1-100% of allowed max risk
  stopLossPrice?: number;
  takeProfitPrice?: number;
  confidence: number; // 0-100
  reason: string;
  marketAnalysis: string;
}

export interface MarketContext {
  symbol: string;
  currentPrice: number;
  recentCandles: any[];
  activePositions: any[];
  accountBalance: any;
  triggerSource: string; // "CRON_INTERVAL" or "WEBHOOK_EVENT"
  tradingMode: "SPOT" | "FUTURES" | "BOTH";
  maxLeverage: number;
  maxRiskPercent: number;
  customModelList?: string[];
}

export async function askTradingAgent(
  context: MarketContext,
  provider: "openai" | "claude" | "gemini" | "openrouter" | "mock",
  apiKey?: string
): Promise<AIDecision> {
  const prompt = `
You are an autonomous quant crypto trader AI operating on Bitget exchange.
Your objective: Capital preservation first, steady profit second. Avoid high-risk leverage.

[MARKET DATA & CONTEXT]
Symbol: ${context.symbol}
Current Price: $${context.currentPrice}
Trigger Reason: ${context.triggerSource}
Allowed Trading Mode: ${context.tradingMode}
Configured Max Leverage: ${context.maxLeverage}x
Configured Max Risk Per Trade: ${context.maxRiskPercent}%
Recent Candle History (OHLCV):
${JSON.stringify(context.recentCandles?.slice(-5) || [])}
Current Active Positions:
${JSON.stringify(context.activePositions || [])}
Account Balance:
${JSON.stringify(context.accountBalance || {})}

[INSTRUCTIONS]
1. Analyze market trend, support/resistance, momentum, and risk.
2. If market is uncertain or choppy, prioritize "HOLD".
3. If entering Futures ("OPEN_LONG" or "OPEN_SHORT"), always set a tight stopLossPrice and takeProfitPrice.
4. Keep leverage <= ${context.maxLeverage}x.

Respond ONLY with a valid JSON object matching this schema:
{
  "action": "HOLD" | "BUY_SPOT" | "SELL_SPOT" | "OPEN_LONG" | "OPEN_SHORT" | "CLOSE_POSITION",
  "symbol": "${context.symbol}",
  "leverage": number,
  "riskPercent": number,
  "stopLossPrice": number or null,
  "takeProfitPrice": number or null,
  "confidence": number (0-100),
  "reason": "Clear 1-2 sentence rationalization of the trade",
  "marketAnalysis": "Key technical factors observed"
}
`;

  // 1. Fallback Mock Simulator (when no AI API key is configured yet)
  if (!apiKey || provider === "mock") {
    const isUptrend = Math.random() > 0.45;
    const price = context.currentPrice || 65000;
    return {
      action: isUptrend ? "OPEN_LONG" : "HOLD",
      symbol: context.symbol,
      leverage: Math.min(context.maxLeverage, 2),
      riskPercent: Math.min(context.maxRiskPercent, 2),
      stopLossPrice: isUptrend ? Math.round(price * 0.985) : undefined,
      takeProfitPrice: isUptrend ? Math.round(price * 1.03) : undefined,
      confidence: 78,
      reason: "Simulated Agent: Price holding above key exponential moving average with healthy volume.",
      marketAnalysis: "Bullish divergence detected on short-term oscillator with low liquidation cascade risk."
    };
  }

  // 2. OpenAI Provider (gpt-4o-mini default for speed & cost)
  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2
      })
    });
    const data = await res.json() as any;
    return JSON.parse(data.choices[0].message.content);
  }

  // 3. Google Gemini Provider (gemini-1.5-flash)
  if (provider === "gemini") {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    const data = await res.json() as any;
    return JSON.parse(data.candidates[0].content.parts[0].text);
  }

  // 4. Anthropic Claude Provider
  if (provider === "claude") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json() as any;
    const text = data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : text);
  }

  // 5. OpenRouter Provider with 6-Tier Fallback Loop (ป้องกัน Rate limit / Model ยกเลิก)
  if (provider === "openrouter") {
    const modelsToTry = context.customModelList && context.customModelList.length > 0
      ? context.customModelList
      : await fetchLatest6FreeModels(apiKey);

    let lastError: any = null;

    for (let i = 0; i < modelsToTry.length; i++) {
      const currentModel = modelsToTry[i];
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/jetz001/AutoTD",
            "X-Title": "AutoTD Quant Bot"
          },
          body: JSON.stringify({
            model: currentModel,
            models: modelsToTry.slice(i, i + 3), // OpenRouter automatic multi-model fallback array
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.2
          })
        });

        if (!res.ok) {
          console.warn(`[OpenRouter Fallback] Model ${currentModel} returned HTTP ${res.status}, trying next in 6 candidates...`);
          lastError = new Error(`HTTP ${res.status} from ${currentModel}`);
          continue;
        }

        const data = await res.json() as any;
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          lastError = new Error(`Empty response from ${currentModel}`);
          continue;
        }
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        return {
          ...parsed,
          reason: `[AI: ${currentModel}] ${parsed.reason || ""}`
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[OpenRouter Fallback] Error with ${currentModel}: ${err.message}, fallback to next model...`);
      }
    }

    throw new Error(`All 6 OpenRouter free models failed fallback: ${lastError?.message}`);
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}

export const DEFAULT_FREE_MODELS = [
  "inclusionai/ling-3.0-flash-fin:free",
  "inclusionai/ling-3.0-flash-sante:free",
  "qwen/qwen3.8-27b:free",
  "dots-studio/dots-3-note-preview:free",
  "liquid/lfm-2.5-2.6b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "thinkingmachines/inkling-small:free",
  "poolside/laguna-s-2.1:free",
];

export async function fetchLatest6FreeModels(apiKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "AutoTD-QuantBot/1.0",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch("https://openrouter.ai/api/v1/models", { headers });
    if (!res.ok) return DEFAULT_FREE_MODELS;
    const json = (await res.json()) as any;
    const free = (json.data || [])
      .filter((m: any) => {
        if (!m?.id || !m.id.endsWith(":free")) return false;
        const idLower = m.id.toLowerCase();
        if (idLower.includes("safety") || idLower.includes("moderation") || idLower.includes("embed")) {
          return false;
        }
        return true;
      })
      .sort((a: any, b: any) => (b.created || 0) - (a.created || 0));
    const ids = free.slice(0, 6).map((m: any) => m.id);
    return ids.length >= 3 ? ids : DEFAULT_FREE_MODELS;
  } catch (err) {
    console.warn("Failed to fetch dynamic free models:", err);
    return DEFAULT_FREE_MODELS;
  }
}

