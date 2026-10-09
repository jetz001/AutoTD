// Cloudflare Pages Function: Groq & OpenRouter AI Autonomous Trading Agent
// Tier 1: Groq High-Speed LPU Models (Primary)
// Tier 2: OpenRouter Free Models Auto-Fallback Loop (Secondary)

interface Env {
  TYPESAFE_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  AI_API_KEY?: string;
}

export const GROQ_MODELS = [
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b",
  "allam-2-7b",
];

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

// In-memory cache for dynamic free models (refreshed every hour)
let cachedFreeModels: string[] = [...DEFAULT_FREE_MODELS];
let lastModelsFetchTime = 0;
const CACHE_TTL_MS = 3600 * 1000; // 1 hour

// AI Agent Rate Limit & Cooldown Protection Tracker
let aiRateLimitState = {
  isLimited: false,
  limitedAt: "",
  resumeAt: "",
  resumeTimestamp: 0,
  provider: "",
};

export async function getLiveFreeModels(apiKey?: string): Promise<string[]> {
  const now = Date.now();
  if (cachedFreeModels.length >= 3 && now - lastModelsFetchTime < CACHE_TTL_MS) {
    return cachedFreeModels;
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": "AutoTD-QuantBot/1.0",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch("https://openrouter.ai/api/v1/models", { headers });
    if (!res.ok) return cachedFreeModels;

    const json = (await res.json()) as any;
    if (!Array.isArray(json?.data)) return cachedFreeModels;

    const freeModels = json.data
      .filter((m: any) => {
        if (!m?.id || !m.id.endsWith(":free")) return false;
        const idLower = m.id.toLowerCase();
        if (idLower.includes("safety") || idLower.includes("moderation") || idLower.includes("embed")) {
          return false;
        }
        return true;
      })
      .sort((a: any, b: any) => (b.created || 0) - (a.created || 0))
      .map((m: any) => m.id);

    if (freeModels.length >= 3) {
      cachedFreeModels = freeModels.slice(0, 8);
      lastModelsFetchTime = now;
      console.log(`[AutoTD] Dynamically discovered ${cachedFreeModels.length} active OpenRouter free models:`, cachedFreeModels);
    }
  } catch (err) {
    console.warn("[AutoTD] Dynamic models fetch warning, using fallback cache:", err);
  }

  return cachedFreeModels;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-typesafe-key, x-groq-key, x-openrouter-key, Authorization",
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const typesafeKey =
    request.headers.get("x-typesafe-key") ||
    (env as any).TYPESAFE_API_KEY ||
    (env as any).TYPESAFE_KEY;

  const groqKey =
    request.headers.get("x-groq-key") ||
    (env as any).GROQ_API_KEY ||
    (env as any).GROQ_KEY ||
    (env as any).AI_GROQ_KEY;

  const openrouterKey =
    request.headers.get("x-openrouter-key") ||
    (env as any).OPENROUTER_API_KEY ||
    (env as any).AI_API_KEY ||
    (env as any).OPENROUTER_KEY ||
    (env as any).OPENROUTER ||
    (env as any).OR_API_KEY ||
    (env as any).AGENT_KEY;

  if (request.method === "GET") {
    const liveModels = await getLiveFreeModels(openrouterKey);
    return Response.json(
      {
        status: "READY",
        primaryProvider: typesafeKey ? "typesafe" : "groq",
        hasTypesafeKey: Boolean(typesafeKey),
        hasGroqKey: Boolean(groqKey),
        hasOpenRouterKey: Boolean(openrouterKey),
        groqModels: GROQ_MODELS,
        fallbackFreeModels: liveModels,
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

  const effectiveTypesafeKey = body.typesafeApiKey || typesafeKey;
  const effectiveGroqKey = body.groqApiKey || groqKey;
  const effectiveOpenrouterKey = body.openrouterApiKey || body.apiKey || openrouterKey;

  if (!effectiveTypesafeKey && !effectiveGroqKey && !effectiveOpenrouterKey) {
    return Response.json(
      {
        code: "40001",
        msg: "Missing AI Key: configure TYPESAFE_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY",
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

  const now = Date.now();
  // 0. RATE LIMIT COOLDOWN GUARD: If currently in cooldown, do NOT burn any API calls!
  if (now < aiRateLimitState.resumeTimestamp) {
    const remainingSec = Math.ceil((aiRateLimitState.resumeTimestamp - now) / 1000);
    return Response.json(
      {
        code: "00000",
        msg: "rate_limited_cooldown",
        data: {
          action: aiScore >= 80 ? "BUY_SPOT" : "HOLD",
          confidence: aiScore >= 80 ? 80 : 50,
          reason: `[AI Cooldown] ติด Rate Limit (${aiRateLimitState.provider}) เมื่อ ${aiRateLimitState.limitedAt} | จะเริ่มเรียก AI ใหม่อัตโนมัติเวลา ${aiRateLimitState.resumeAt} (โหมดประหยัดโควต้า: Quant เฝ้าระวังเงียบๆ โดยไม่ยิง API ซ้ำ)`,
          modelUsed: "quant_passive_sentinel",
          symbol,
          price: currentPrice,
          isCoolingDown: true,
          limitedAt: aiRateLimitState.limitedAt,
          resumeAt: aiRateLimitState.resumeAt,
          remainingSec,
        },
      },
      { headers: corsHeaders }
    );
  } else if (aiRateLimitState.isLimited) {
    aiRateLimitState.isLimited = false;
  }

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

  // ==========================================
  // TIER 1: TYPESAFE JEV SYSTEM ONE MODEL (PRIMARY FAST GATER & CALIBRATED PROBABILITIES)
  // ==========================================
  if (effectiveTypesafeKey) {
    try {
      const isPositionCheck = Boolean(body.isPosition || body.mode === "position");
      const promptState = isPositionCheck
        ? `Holding ${symbol}: AvgCost $${body.avgCost || currentPrice}, Current $${currentPrice} (PnL: ${body.pnlPct || 0}%). 15m RSI: ${rsi15m}. SuperTrend: ${body.supertrend || 'Bullish'}.`
        : `Quant Score: ${aiScore}/100 for ${symbol} @ $${currentPrice}. 15m RSI: ${rsi15m}, 24h Change: ${change24h}%.`;

      const questions = isPositionCheck
        ? {
            position_verdict: {
              type: "choice",
              instructions: "Should the quantitative trading bot continue to HOLD this position or SELL to exit?",
              criteria: {
                "HOLD": "Healthy uptrend, trend intact, let profit run or normal minor consolidation",
                "SELL": "Momentum exhausted, severe overbought reversal, or breakdown"
              }
            }
          }
        : {
            trade_decision: {
              type: "choice",
              instructions: "Should the quantitative trading bot execute a BUY_SPOT order for this candidate dip or HOLD/WAIT?",
              criteria: {
                "BUY_SPOT": "Valid dip entry in uptrend, strong confluence, high win probability",
                "HOLD": "High risk, overbought, uncertain momentum, or unsafe chart structure"
              }
            },
            risk_acceptable: {
              type: "noul",
              instructions: "Is the downside risk acceptable for spot accumulation?"
            }
          };

      const jRes = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveTypesafeKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state: promptState,
          model: "jev-latest",
          questions,
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (jRes.ok) {
        const jData = (await jRes.json()) as any;
        const answers = jData.answers || {};
        const choice = isPositionCheck
          ? answers.position_verdict?.choice || "HOLD"
          : answers.trade_decision?.choice || "HOLD";
        const prob = isPositionCheck
          ? answers.position_verdict?.probabilities?.[choice] ?? answers.position_verdict?.confidence ?? 0.8
          : answers.trade_decision?.probabilities?.[choice] ?? answers.trade_decision?.confidence ?? 0.8;
        const riskNoul = answers.risk_acceptable?.noul ?? 0.5;

        const action = isPositionCheck ? choice : (choice === "BUY_SPOT" ? "BUY_SPOT" : "HOLD");
        const reason = isPositionCheck
          ? `[TypeSafe Jev] Decision: ${choice} (Confidence: ${(prob * 100).toFixed(0)}%)`
          : `[TypeSafe Jev] Decision: ${choice} (Prob: ${(prob * 100).toFixed(0)}%, Risk Pass: ${(riskNoul * 100).toFixed(0)}%)`;

        return Response.json(
          {
            code: "00000",
            msg: "success",
            provider: "typesafe",
            data: {
              action,
              confidence: Math.round(prob * 100),
              reason,
              modelUsed: `typesafe/${jData.model || "jev-1.13"}`,
              symbol,
              price: currentPrice,
              probabilities: isPositionCheck ? answers.position_verdict?.probabilities : answers.trade_decision?.probabilities,
              riskScore: riskNoul,
            },
          },
          { headers: corsHeaders }
        );
      }
    } catch (e: any) {
      console.warn("[AutoTD Agent] TypeSafe Jev fallback triggered:", e.message);
      lastError = e;
    }
  }

  // ==========================================
  // TIER 2: GROQ HIGH-SPEED ULTRA-LOW-LATENCY INFERENCE (SECONDARY FALLBACK)
  // ==========================================
  if (effectiveGroqKey) {
    for (const model of GROQ_MODELS) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${effectiveGroqKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.2,
          }),
        });

        if (!res.ok) {
          if (res.status === 429) {
            const retryHeader = res.headers.get("retry-after") || res.headers.get("x-ratelimit-reset");
            const waitSeconds = retryHeader ? Math.min(300, Math.max(30, parseInt(retryHeader, 10) || 60)) : 60;
            const resumeTime = new Date(Date.now() + waitSeconds * 1000);
            aiRateLimitState = {
              isLimited: true,
              limitedAt: new Date().toLocaleTimeString("th-TH"),
              resumeAt: resumeTime.toLocaleTimeString("th-TH"),
              resumeTimestamp: Date.now() + waitSeconds * 1000,
              provider: `Groq/${model}`,
            };
            console.warn(`[AutoTD Agent] Groq 429 hit, cooling down until ${aiRateLimitState.resumeAt}`);
            lastError = new Error(`Groq rate limit hit, cooldown until ${aiRateLimitState.resumeAt}`);
            break; // Break out of Groq loop to avoid burning more rate limits
          }
          lastError = new Error(`Groq ${model} returned HTTP ${res.status}`);
          continue;
        }

        const data = (await res.json()) as any;
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          lastError = new Error(`Empty response from Groq ${model}`);
          continue;
        }

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);

        return Response.json(
          {
            code: "00000",
            msg: "success",
            provider: "groq",
            data: {
              action: parsed.action || "HOLD",
              confidence: Number(parsed.confidence) || 85,
              reason: parsed.reason || "Groq AI evaluated dip quality and risk",
              modelUsed: `groq/${model}`,
              symbol,
              price: currentPrice,
              stopLossPrice: parsed.stopLossPrice,
              takeProfitPrice: parsed.takeProfitPrice,
            },
          },
          { headers: corsHeaders }
        );
      } catch (err: any) {
        lastError = err;
        console.warn(`[AutoTD] Groq ${model} warning, trying next:`, err.message);
      }
    }
  }

  // ==========================================
  // TIER 2: OPENROUTER MULTI-MODEL FALLBACK LOOP (SECONDARY)
  // ==========================================
  if (effectiveOpenrouterKey) {
    const modelsToTry = await getLiveFreeModels(effectiveOpenrouterKey);

    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${effectiveOpenrouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://autotd.pages.dev",
            "X-Title": "AutoTD Quant Bot",
          },
          body: JSON.stringify({
            model,
            models: modelsToTry.slice(i, i + 3),
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.2,
          }),
        });

        if (!res.ok) {
          if (res.status === 429) {
            const waitSeconds = 120;
            const resumeTime = new Date(Date.now() + waitSeconds * 1000);
            aiRateLimitState = {
              isLimited: true,
              limitedAt: new Date().toLocaleTimeString("th-TH"),
              resumeAt: resumeTime.toLocaleTimeString("th-TH"),
              resumeTimestamp: Date.now() + waitSeconds * 1000,
              provider: `OpenRouter/${model}`,
            };
            lastError = new Error(`OpenRouter rate limit hit, cooldown until ${aiRateLimitState.resumeAt}`);
            break;
          }
          lastError = new Error(`OpenRouter ${model} returned HTTP ${res.status}`);
          continue;
        }

        const data = (await res.json()) as any;
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          lastError = new Error(`Empty response from OpenRouter ${model}`);
          continue;
        }

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);

        return Response.json(
          {
            code: "00000",
            msg: "success",
            provider: "openrouter",
            data: {
              action: parsed.action || "HOLD",
              confidence: Number(parsed.confidence) || 75,
              reason: parsed.reason || "OpenRouter AI evaluated market conditions",
              modelUsed: `openrouter/${model}`,
              symbol,
              price: currentPrice,
              stopLossPrice: parsed.stopLossPrice,
              takeProfitPrice: parsed.takeProfitPrice,
            },
          },
          { headers: corsHeaders }
        );
      } catch (err: any) {
        lastError = err;
      }
    }
  }

  // ==========================================
  // TIER 3: HEURISTIC QUANT RULE ENGINE SAFEGUARD
  // ==========================================
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
        } (${lastError?.message || "AI fallback"})`,
        modelUsed: "heuristic_quant",
        symbol,
        price: currentPrice,
      },
    },
    { headers: corsHeaders }
  );
};
