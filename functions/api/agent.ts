// Cloudflare Pages Function: OpenRouter AI Autonomous Trading Agent
// Supports 6-Tier Auto-Fallback Free Models Loop with Zero-Token-Cost Guarantee

interface Env {
  OPENROUTER_API_KEY?: string;
  AI_API_KEY?: string;
}

const DEFAULT_FREE_MODELS = [
  "inclusionai/ling-3.0-flash-fin:free",
  "qwen/qwen3.8-27b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "liquid/lfm-2.5-2.6b:free",
  "thinkingmachines/inkling-small:free",
  "inclusionai/ling-3.0-flash-sante:free",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-openrouter-key, Authorization",
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method === "GET") {
    const aiKey =
      request.headers.get("x-openrouter-key") ||
      (env as any).OPENROUTER_API_KEY ||
      (env as any).AI_API_KEY ||
      (env as any).OPENROUTER_KEY ||
      (env as any).OPENROUTER ||
      (env as any).OR_API_KEY ||
      (env as any).AGENT_KEY;

    return Response.json(
      {
        status: "READY",
        hasKey: Boolean(aiKey),
        provider: "openrouter",
        availableFreeModels: DEFAULT_FREE_MODELS,
      },
      { headers: corsHeaders }
    );
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { code: "40000", msg: "Invalid JSON body" },
      { status: 400, headers: corsHeaders }
    );
  }

  const aiKey =
    request.headers.get("x-openrouter-key") ||
    body.apiKey ||
    (env as any).OPENROUTER_API_KEY ||
    (env as any).AI_API_KEY ||
    (env as any).OPENROUTER_KEY ||
    (env as any).OPENROUTER ||
    (env as any).OR_API_KEY ||
    (env as any).AGENT_KEY;

  if (!aiKey) {
    return Response.json(
      {
        code: "40001",
        msg: "Missing OpenRouter API Key (Configure OPENROUTER_API_KEY in Cloudflare Pages Secrets or pass x-openrouter-key)",
      },
      { status: 400, headers: corsHeaders }
    );
  }

  const {
    symbol = "BTCUSDT",
    currentPrice = 0,
    change24h = 0,
    rsi15m = 50,
    aiScore = 80,
    recentCandles = [],
  } = body;

  const prompt = `
You are the Chief Quantitative AI Trading Agent for Bitget Spot Exchange.
Evaluate this Dip-in-Uptrend candidate:
- Symbol: ${symbol}
- Current Price: $${currentPrice}
- 24h Change: ${change24h}%
- 15m RSI: ${rsi15m}
- Quant Multi-Factor Score: ${aiScore}/100
- Recent 15m Candles (OHLCV):
${JSON.stringify(recentCandles.slice(-5) || [])}

Trading Mandate:
1. If the pullback is orderly and price action shows support holding, approve "BUY_SPOT" with confidence 70-95%.
2. If the dip is too sharp (knife falling) or overbought, recommend "HOLD" with reason.
3. Keep the reason concise, analytical, and professional (Thai or English, max 2 sentences).

Respond ONLY with valid JSON in this exact structure:
{
  "action": "BUY_SPOT" | "HOLD",
  "confidence": number,
  "reason": "1-2 sentence rationalization",
  "stopLossPrice": number,
  "takeProfitPrice": number
}
`;

  let lastError: any = null;

  for (let i = 0; i < DEFAULT_FREE_MODELS.length; i++) {
    const model = DEFAULT_FREE_MODELS[i];
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://autotd.pages.dev",
          "X-Title": "AutoTD Quant Bot",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });

      if (!res.ok) {
        lastError = new Error(`Model ${model} returned HTTP ${res.status}`);
        continue;
      }

      const data = (await res.json()) as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        lastError = new Error(`Empty response from ${model}`);
        continue;
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);

      return Response.json(
        {
          code: "00000",
          msg: "success",
          data: {
            action: parsed.action || "HOLD",
            confidence: Number(parsed.confidence) || 75,
            reason: parsed.reason || "AI evaluated market conditions",
            modelUsed: model,
            symbol,
            price: currentPrice,
          },
        },
        { headers: corsHeaders }
      );
    } catch (err: any) {
      lastError = err;
    }
  }

  // If all free models fail or rate limit, return graceful fallback decision based on Quant score
  return Response.json(
    {
      code: "00000",
      msg: "fallback_heuristic",
      data: {
        action: aiScore >= 80 ? "BUY_SPOT" : "HOLD",
        confidence: aiScore >= 80 ? 82 : 50,
        reason: `[Quant Rule Engine Fallback] Score ${aiScore}/100, RSI 15m ${rsi15m}: ${
          aiScore >= 80
            ? "Dip in Uptrend เข้าเงื่อนไขสะสมไม้แรก"
            : "สภาวะตลาดยังไม่พร้อมเข้าซื้อ"
        } (${lastError?.message || "OpenRouter fallback"})`,
        modelUsed: "heuristic_quant",
        symbol,
        price: currentPrice,
      },
    },
    { headers: corsHeaders }
  );
};
