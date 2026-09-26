import { BitgetClient } from "./bitget";
import { askTradingAgent, MarketContext, AIDecision, fetchLatest6FreeModels, DEFAULT_FREE_MODELS } from "./ai";

export interface Env {
  // Bindings
  ASSETS?: Fetcher;
  
  // Bitget Secrets (wrangler secret put BITGET_API_KEY ...)
  BITGET_API_KEY?: string;
  BITGET_SECRET_KEY?: string;
  BITGET_PASSPHRASE?: string;

  // AI Secrets
  AI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  // Config vars
  TRADING_MODE?: "SPOT" | "FUTURES" | "BOTH";
  DEFAULT_SYMBOL?: string;
  MAX_LEVERAGE?: string;
  MAX_RISK_PERCENT?: string;
  PAPER_TRADING?: string;
  AI_PROVIDER?: "openai" | "claude" | "gemini" | "openrouter" | "mock";
}

// In-memory trade journal for live UI display
const liveLogs: any[] = [];
let cachedFreeModels: string[] = [...DEFAULT_FREE_MODELS];
let lastModelDiscoveryTime = 0;

async function refreshFreeModelsDaily(apiKey?: string): Promise<string[]> {
  if (!apiKey) return cachedFreeModels;
  try {
    const models = await fetchLatest6FreeModels(apiKey);
    cachedFreeModels = models;
    lastModelDiscoveryTime = Date.now();
    addLog("AI_DISCOVERY", `🔄 DAILY DISCOVERY: อัปเดต OpenRouter Free 6 ตัวล่าสุด: ${models.join(", ")}`);
    return models;
  } catch (e: any) {
    console.error("Daily model discovery failed:", e.message);
    return cachedFreeModels;
  }
}

export default {
  // 1. Cron Trigger: รองรับ 2 ลูป - ลูปเทรดทุก 5 นาที และ ลูปอัปเดตโมเดลฟรีวันละ 1 ครั้ง
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const isDailyDiscovery = event.cron === "0 0 * * *" || event.cron?.includes("0 0");
    if (isDailyDiscovery) {
      const aiKey = env.OPENROUTER_API_KEY || env.AI_API_KEY;
      ctx.waitUntil(refreshFreeModelsDaily(aiKey));
    } else {
      ctx.waitUntil(executeTradingCycle("CRON_INTERVAL", env));
    }
  },

  // 2. Fetch Handler: รับ Webhook เหตุการณ์ หรือ คำสั่งจาก UI
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS Headers for API
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API: ปลุกด้วย Webhook หรือเหตุการณ์ภายนอก (เช่น TradingView Alert)
    if (url.pathname === "/api/webhook" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      const reason = `EVENT_ALERT: ${JSON.stringify(payload)}`;
      const result = await executeTradingCycle(reason, env);
      return Response.json({ success: true, trigger: "webhook", result }, { headers: corsHeaders });
    }

    // API: ปลุก AI ให้เทรดทันทีด้วยมือ (Manual Wake from UI)
    if (url.pathname === "/api/wake" && request.method === "POST") {
      const body = await request.json().catch(() => ({})) as any;
      const customReason = body.reason || "MANUAL_TRIGGER_FROM_DASHBOARD";
      const result = await executeTradingCycle(customReason, env, body.configOverride);
      return Response.json({ success: true, trigger: "manual", result }, { headers: corsHeaders });
    }

    // API: ดูสถานะปัจจุบัน & ประวัติการตัดสินใจของ AI
    if (url.pathname === "/api/status") {
      const bitgetConfigured = Boolean(env.BITGET_API_KEY && env.BITGET_SECRET_KEY);
      const aiConfigured = Boolean(env.OPENROUTER_API_KEY || env.AI_API_KEY);
      return Response.json({
        status: "RUNNING",
        mode: env.TRADING_MODE || "SPOT",
        paperTrading: env.PAPER_TRADING !== "false",
        aiProvider: env.AI_PROVIDER || (aiConfigured ? "openrouter" : "mock"),
        bitgetConfigured,
        aiConfigured,
        freeModels: cachedFreeModels,
        logs: liveLogs.slice(-20).reverse(),
      }, { headers: corsHeaders });
    }

    // API: อ่านพอร์ต Spot จริงจาก Bitget
    if (url.pathname === "/api/assets") {
      if (!env.BITGET_API_KEY || !env.BITGET_SECRET_KEY || !env.BITGET_PASSPHRASE) {
        return Response.json({ code: "40001", msg: "Bitget credentials not configured" }, { headers: corsHeaders });
      }
      try {
        const client = new BitgetClient({
          apiKey: env.BITGET_API_KEY,
          secretKey: env.BITGET_SECRET_KEY,
          passphrase: env.BITGET_PASSPHRASE,
        });
        const res = await client.getSpotAccount();
        return Response.json(res, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ code: "50000", msg: err.message }, { headers: corsHeaders });
      }
    }

    // API: Panic Button - ปิด Position ทั้งหมดทันที
    if (url.pathname === "/api/panic" && request.method === "POST") {
      if (env.BITGET_API_KEY && env.BITGET_SECRET_KEY && env.BITGET_PASSPHRASE) {
        const client = new BitgetClient({
          apiKey: env.BITGET_API_KEY,
          secretKey: env.BITGET_SECRET_KEY,
          passphrase: env.BITGET_PASSPHRASE,
        });
        await client.closeAllPositions();
      }
      addLog("PANIC_STOP", "Emergency Panic Triggered: All positions closed and bot halted.");
      return Response.json({ success: true, message: "Emergency close dispatched" }, { headers: corsHeaders });
    }

    // API: Quant Spot Screener with Dynamic Multi-Factor Scoring (API + ฟังชัน)
    if (url.pathname === "/api/quant/screener") {
      try {
        const client = new BitgetClient({ apiKey: "", secretKey: "", passphrase: "" });
        const res = await client.getAllSpotTickers();
        if (res.code !== "00000" || !Array.isArray(res.data)) {
          return Response.json({ code: "50001", msg: "Failed to fetch spot tickers" }, { headers: corsHeaders });
        }

        const STABLECOINS = ["USDC", "USDGO", "FDUSD", "USDE", "DAI", "TUSD", "EUR", "BUSD"];
        const REAL_R_CRYPTO = ["RENDERUSDT", "ROSEUSDT", "RUNEUSDT", "RONUSDT", "RAYUSDT", "REQUSDT"];

        const filtered = res.data
          .filter((item: any) => {
            if (!item.symbol || !item.symbol.endsWith("USDT")) return false;
            const sym = item.symbol;
            if (sym.includes("_")) return false;
            if (sym.startsWith("R") && !REAL_R_CRYPTO.includes(sym)) return false;
            const base = sym.replace("USDT", "");
            if (STABLECOINS.includes(base)) return false;
            return true;
          })
          .map((item: any) => {
            const vol = parseFloat(item.usdtVolume || "0");
            const price = parseFloat(item.lastPr || "0");
            const change = parseFloat(item.change24h || "0") * 100;
            const high = parseFloat(item.high24h || "0");
            const low = parseFloat(item.low24h || "0");
            const sym = item.symbol;
            const base = sym.replace("USDT", "");

            // Heuristic RSI
            const range = high - low;
            const pos = range > 0 ? (price - low) / range : 0.5;
            const estRsi = Math.round(30 + pos * 50);

            // Dynamic Multi-Factor Score (0-100)
            // 1. Trend Factor (0-35 pts)
            let trendScore = 15;
            if (change >= 1 && change <= 6) {
              trendScore = 32 + Math.min(3, Math.round((change - 1) * 0.6));
            } else if (change > 6 && change <= 12) {
              trendScore = 26;
            } else if (change > 12) {
              trendScore = 18;
            } else if (change < 0 && change >= -3) {
              trendScore = 22;
            } else if (change < -3 && change >= -7) {
              trendScore = 15;
            } else {
              trendScore = 8;
            }

            // 2. Pullback Zone Factor (0-35 pts)
            let pullbackScore = 20;
            if (pos >= 0.35 && pos <= 0.55) {
              pullbackScore = 35;
            } else if (pos >= 0.25 && pos < 0.35) {
              pullbackScore = 30;
            } else if (pos > 0.55 && pos <= 0.70) {
              pullbackScore = 24;
            } else if (pos < 0.25) {
              pullbackScore = 18;
            } else {
              pullbackScore = 12;
            }

            // 3. Liquidity Quality Factor (0-30 pts)
            let volScore = 10;
            if (vol > 50_000_000) volScore = 30;
            else if (vol > 20_000_000) volScore = 26;
            else if (vol > 5_000_000) volScore = 22;
            else if (vol > 1_000_000) volScore = 16;
            else volScore = 10;

            const totalScore = Math.min(99, Math.max(15, trendScore + pullbackScore + volScore));

            let signal: "BUY_DIP" | "WATCH" | "SELL_TP" | "COOLDOWN" = "WATCH";
            if (totalScore >= 80) signal = "BUY_DIP";

            return {
              symbol: sym,
              baseCoin: base,
              lastPr: price,
              change24h: change,
              high24h: high,
              low24h: low,
              usdtVolume: vol,
              rsi15m: estRsi,
              aiScore: totalScore,
              signal,
            };
          })
          .sort((a: any, b: any) => b.usdtVolume - a.usdtVolume)
          .slice(0, 20);

        return Response.json({
          code: "00000",
          msg: "success",
          count: filtered.length,
          data: filtered,
          timestamp: Date.now(),
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ code: "50000", msg: err.message }, { headers: corsHeaders });
      }
    }

    // API: Debug Market Data fetch from Cloudflare Worker
    if (url.pathname === "/api/debug/bitget") {
      const results: any = {};
      
      // Test Bitget Public
      try {
        const r0 = await fetch("https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT", {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        results.bitget_public = { status: r0.status, headers: Object.fromEntries(r0.headers.entries()), body: (await r0.text()).slice(0, 300) };
      } catch (e: any) { results.bitget_public = { error: e.message }; }

      // Test Bitget Private (if keys exist)
      if (env.BITGET_API_KEY && env.BITGET_SECRET_KEY && env.BITGET_PASSPHRASE) {
        try {
          const client = new BitgetClient({
            apiKey: env.BITGET_API_KEY,
            secretKey: env.BITGET_SECRET_KEY,
            passphrase: env.BITGET_PASSPHRASE,
          });
          results.bitget_private = await client.getSpotAccount();
        } catch (e: any) { results.bitget_private = { error: e.message }; }
      }

      return Response.json(results, { headers: corsHeaders });
    }

    // Serve Static UI via Assets binding if available
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Bitget AI Trader Worker is running. Visit /api/status or configure UI.", {
      headers: { "Content-Type": "text/plain" }
    });
  }
};

// Execution Cycle Function
async function executeTradingCycle(triggerSource: string, env: Env, configOverride?: any) {
  const symbol = configOverride?.symbol || env.DEFAULT_SYMBOL || "BTCUSDT";
  const tradingMode = configOverride?.tradingMode || env.TRADING_MODE || "SPOT";
  const maxLeverage = Number(configOverride?.maxLeverage || env.MAX_LEVERAGE || "1");
  const maxRisk = Number(configOverride?.maxRiskPercent || env.MAX_RISK_PERCENT || "5");
  const isPaper = configOverride?.paperTrading ?? (env.PAPER_TRADING !== "false");
  const provider = (configOverride?.aiProvider || env.AI_PROVIDER || (env.AI_API_KEY ? "openrouter" : "mock")) as any;

  let currentPrice = 0;
  let candles: any[] = [];
  let positions: any[] = [];
  let balance: any = { USDT: 5000 };

  const hasBitgetKeys = Boolean(env.BITGET_API_KEY && env.BITGET_SECRET_KEY && env.BITGET_PASSPHRASE);
  let bitgetClient: BitgetClient | null = null;

  if (hasBitgetKeys) {
    bitgetClient = new BitgetClient({
      apiKey: env.BITGET_API_KEY!,
      secretKey: env.BITGET_SECRET_KEY!,
      passphrase: env.BITGET_PASSPHRASE!,
    });
  }

  // Public market client for fetching live ticker & candles
  const marketClient = bitgetClient || new BitgetClient({ apiKey: "", secretKey: "", passphrase: "" });

  try {
    if (tradingMode === "SPOT") {
      const tickerRes = await marketClient.getSpotTicker(symbol);
      if (tickerRes?.data?.[0]?.lastPr) {
        currentPrice = parseFloat(tickerRes.data[0].lastPr);
      }
      const candleRes = await marketClient.getSpotCandles(symbol, "15min", "20");
      if (candleRes?.data && Array.isArray(candleRes.data)) {
        candles = candleRes.data.map((c: any) => ({
          time: c[0],
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[6] || c[5]),
        }));
      }

      if (hasBitgetKeys && bitgetClient) {
        const accRes = await bitgetClient.getSpotAccount();
        if (accRes?.data) balance = accRes.data;
      }
    } else {
      const tickerRes = await marketClient.getTicker(symbol);
      if (tickerRes?.data?.[0]?.lastPr) {
        currentPrice = parseFloat(tickerRes.data[0].lastPr);
      }
      const candleRes = await marketClient.getCandles(symbol, "15m", "20");
      if (candleRes?.data) candles = candleRes.data;

      if (hasBitgetKeys && bitgetClient) {
        const posRes = await bitgetClient.getPositions(symbol);
        if (posRes?.data) positions = posRes.data;
        const accRes = await bitgetClient.getFuturesAccount();
        if (accRes?.data) balance = accRes.data;
      }
    }
  } catch (e: any) {
    console.error("Failed to fetch live data from Bitget:", e.message);
  }

  // Caller override or resilient live feed fallback if Bitget WAF intercepted
  if (configOverride?.currentPrice) {
    currentPrice = Number(configOverride.currentPrice);
  }
  if (configOverride?.candles && Array.isArray(configOverride.candles)) {
    candles = configOverride.candles;
  }

  if (currentPrice === 0 || candles.length === 0) {
    try {
      const baseCoin = symbol.replace("USDT", "");
      const cbPriceRes = await fetch(`https://api.coinbase.com/v2/prices/${baseCoin}-USD/spot`);
      if (cbPriceRes.ok) {
        const cbJson = await cbPriceRes.json() as any;
        if (cbJson?.data?.amount) {
          currentPrice = parseFloat(cbJson.data.amount);
        }
      }
      const cbCandleRes = await fetch(
        `https://api.exchange.coinbase.com/products/${baseCoin}-USD/candles?granularity=900`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (cbCandleRes.ok) {
        const cbCandles = await cbCandleRes.json() as any;
        if (Array.isArray(cbCandles) && cbCandles.length > 0) {
          candles = cbCandles.slice(0, 20).map((c: any) => ({
            time: c[0] * 1000,
            low: c[1],
            high: c[2],
            open: c[3],
            close: c[4],
            volume: c[5],
          }));
        }
      }
    } catch (cbErr: any) {
      console.warn("Coinbase fallback feed error:", cbErr.message);
    }
  }

  const context: MarketContext = {
    symbol,
    currentPrice,
    recentCandles: candles,
    activePositions: positions,
    accountBalance: balance,
    triggerSource,
    tradingMode,
    maxLeverage,
    maxRiskPercent: maxRisk,
    customModelList: cachedFreeModels,
  };

  // 1. ให้ AI วิเคราะห์ & ตัดสินใจ (พร้อมระบบ Fallback 6 โมเดล)
  const aiKey = env.OPENROUTER_API_KEY || env.AI_API_KEY;
  if (lastModelDiscoveryTime === 0 && aiKey) {
    refreshFreeModelsDaily(aiKey).catch(() => {});
  }
  const decision: AIDecision = await askTradingAgent(context, provider, aiKey);

  // 2. ส่ง Order ไป Bitget (ถ้าไม่ใช่ Paper trading และไม่ใช่ HOLD)
  let orderResult = null;
  if (!isPaper && hasBitgetKeys && bitgetClient && decision.action !== "HOLD") {
    try {
      if (decision.action === "BUY_SPOT" || decision.action === "OPEN_LONG") {
        if (tradingMode === "SPOT") {
          orderResult = await bitgetClient.placeSpotOrder({
            symbol: decision.symbol,
            side: "buy",
            orderType: "market",
            size: "10",
          });
        } else {
          orderResult = await bitgetClient.placeFuturesOrder({
            symbol: decision.symbol,
            side: "buy",
            orderType: "market",
            size: "0.01",
            presetStopLossPrice: decision.stopLossPrice?.toString(),
            presetTakeProfitPrice: decision.takeProfitPrice?.toString(),
          });
        }
      } else if (decision.action === "SELL_SPOT" || decision.action === "CLOSE_POSITION" || decision.action === "OPEN_SHORT") {
        if (tradingMode === "SPOT") {
          orderResult = await bitgetClient.placeSpotOrder({
            symbol: decision.symbol,
            side: "sell",
            orderType: "market",
            size: "10",
          });
        } else {
          orderResult = await bitgetClient.placeFuturesOrder({
            symbol: decision.symbol,
            side: "sell",
            orderType: "market",
            size: "0.01",
            presetStopLossPrice: decision.stopLossPrice?.toString(),
            presetTakeProfitPrice: decision.takeProfitPrice?.toString(),
          });
        }
      }
    } catch (err: any) {
      console.error("Order execution failed:", err.message);
      orderResult = { error: err.message };
    }
  }

  // 3. บันทึกผลลัพธ์ลง Log Journal
  const logEntry = {
    timestamp: new Date().toISOString(),
    trigger: triggerSource,
    symbol,
    price: currentPrice,
    decision,
    isPaper,
    executed: !isPaper && decision.action !== "HOLD",
    orderResult
  };
  addLog(decision.action, `${decision.reason} [Confidence: ${decision.confidence}%]`, logEntry);

  return logEntry;
}

function addLog(action: string, summary: string, meta?: any) {
  liveLogs.push({
    id: Date.now().toString(),
    time: new Date().toLocaleTimeString("th-TH"),
    action,
    summary,
    meta
  });
  if (liveLogs.length > 50) liveLogs.shift();
}
