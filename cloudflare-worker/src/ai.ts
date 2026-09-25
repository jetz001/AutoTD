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
}

export async function askTradingAgent(
  context: MarketContext,
  provider: "openai" | "claude" | "gemini" | "mock",
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

  throw new Error(`Unsupported AI provider: ${provider}`);
}
