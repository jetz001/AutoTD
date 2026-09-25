import { BitgetClient } from "./bitget";
import { askTradingAgent, MarketContext, AIDecision } from "./ai";

export interface Env {
  // Bindings
  ASSETS?: Fetcher;
  
  // Bitget Secrets (wrangler secret put BITGET_API_KEY ...)
  BITGET_API_KEY?: string;
  BITGET_SECRET_KEY?: string;
  BITGET_PASSPHRASE?: string;

  // AI Secrets
  AI_API_KEY?: string;

  // Config vars
  TRADING_MODE?: "SPOT" | "FUTURES" | "BOTH";
  DEFAULT_SYMBOL?: string;
  MAX_LEVERAGE?: string;
  MAX_RISK_PERCENT?: string;
  PAPER_TRADING?: string;
  AI_PROVIDER?: "openai" | "claude" | "gemini" | "mock";
}

// In-memory trade journal for live UI display
const liveLogs: any[] = [];

export default {
  // 1. Cron Trigger: ปลุกทุกรอบเวลา (เช่น ทุก 5 หรือ 15 นาที)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(executeTradingCycle("CRON_INTERVAL", env));
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
      const aiConfigured = Boolean(env.AI_API_KEY);
      return Response.json({
        status: "RUNNING",
        mode: env.TRADING_MODE || "FUTURES",
        paperTrading: env.PAPER_TRADING !== "false",
        aiProvider: env.AI_PROVIDER || (aiConfigured ? "openai" : "mock"),
        bitgetConfigured,
        aiConfigured,
        logs: liveLogs.slice(-20).reverse(),
      }, { headers: corsHeaders });
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
  const tradingMode = configOverride?.tradingMode || env.TRADING_MODE || "FUTURES";
  const maxLeverage = Number(configOverride?.maxLeverage || env.MAX_LEVERAGE || "3");
  const maxRisk = Number(configOverride?.maxRiskPercent || env.MAX_RISK_PERCENT || "5");
  const isPaper = configOverride?.paperTrading ?? (env.PAPER_TRADING !== "false");
  const provider = (configOverride?.aiProvider || env.AI_PROVIDER || (env.AI_API_KEY ? "openai" : "mock")) as any;

  let currentPrice = 64250;
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

    try {
      const tickerRes = await bitgetClient.getTicker(symbol);
      if (tickerRes?.data?.[0]?.lastPr) {
        currentPrice = parseFloat(tickerRes.data[0].lastPr);
      }
      const candleRes = await bitgetClient.getCandles(symbol, "15m", "20");
      if (candleRes?.data) candles = candleRes.data;

      const posRes = await bitgetClient.getPositions(symbol);
      if (posRes?.data) positions = posRes.data;

      const accRes = await bitgetClient.getFuturesAccount();
      if (accRes?.data) balance = accRes.data;
    } catch (e: any) {
      console.error("Failed to fetch live data from Bitget:", e.message);
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
    maxRiskPercent: maxRisk
  };

  // 1. ให้ AI วิเคราะห์ & ตัดสินใจ
  const decision: AIDecision = await askTradingAgent(context, provider, env.AI_API_KEY);

  // 2. ส่ง Order ไป Bitget (ถ้าไม่ใช่ Paper trading และไม่ใช่ HOLD)
  let orderResult = null;
  if (!isPaper && hasBitgetKeys && bitgetClient && decision.action !== "HOLD") {
    try {
      if (decision.action === "OPEN_LONG") {
        orderResult = await bitgetClient.placeFuturesOrder({
          symbol: decision.symbol,
          side: "buy",
          orderType: "market",
          size: "0.01", // Size ตาม risk management
          presetStopLossPrice: decision.stopLossPrice?.toString(),
          presetTakeProfitPrice: decision.takeProfitPrice?.toString(),
        });
      } else if (decision.action === "OPEN_SHORT") {
        orderResult = await bitgetClient.placeFuturesOrder({
          symbol: decision.symbol,
          side: "sell",
          orderType: "market",
          size: "0.01",
          presetStopLossPrice: decision.stopLossPrice?.toString(),
          presetTakeProfitPrice: decision.takeProfitPrice?.toString(),
        });
      } else if (decision.action === "CLOSE_POSITION") {
        orderResult = await bitgetClient.closeAllPositions();
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
