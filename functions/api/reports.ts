// Cloudflare Pages Function: Daily AI Trading & Intelligence Report Engine
// Generates professional daily reports analyzing trades, AI decisions (JEV/Groq/Quant),
// Bitget fees (0.1% per trade / 0.2% round-trip), and market highlights. Stored in D1.

interface Env {
  DB: D1Database;
  AUTOTD_KV?: KVNamespace;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ==========================================
  // GET: Retrieve Daily Reports
  // ==========================================
  if (request.method === "GET") {
    try {
      const url = new URL(request.url);
      const reportId = url.searchParams.get("id");
      const reportDate = url.searchParams.get("date");

      if (!env.DB) {
        return Response.json({ success: false, msg: "Database not configured" }, { status: 500, headers: corsHeaders });
      }

      if (reportId || reportDate) {
        const query = reportId
          ? "SELECT * FROM daily_reports WHERE id = ?"
          : "SELECT * FROM daily_reports WHERE date = ?";
        const param = reportId || reportDate;
        const report = await env.DB.prepare(query).bind(param).first();
        if (!report) {
          return Response.json({ success: false, msg: "Report not found" }, { status: 404, headers: corsHeaders });
        }
        return Response.json({ success: true, report }, { headers: corsHeaders });
      }

      // List all reports (ordered by newest first)
      const { results } = await env.DB.prepare(
        "SELECT id, date, title, summary, total_trades, win_rate, gross_pnl, net_pnl, total_fees, ai_provider, created_at FROM daily_reports ORDER BY created_at DESC LIMIT 30"
      ).all();

      return Response.json({ success: true, reports: results || [] }, { headers: corsHeaders });
    } catch (err: any) {
      return Response.json({ success: false, msg: err.message }, { status: 500, headers: corsHeaders });
    }
  }

  // ==========================================
  // POST: Generate / Store Daily Report
  // ==========================================
  if (request.method === "POST") {
    try {
      let body: any = {};
      try {
        body = await request.json();
      } catch {}

      if (!env.DB) {
        return Response.json({ success: false, msg: "Database not configured" }, { status: 500, headers: corsHeaders });
      }

      // 1. Resolve API Keys from D1 config or env
      let groqKey = env.GROQ_API_KEY;
      let orKey = env.OPENROUTER_API_KEY;
      let typesafeKey = env.TYPESAFE_API_KEY;

      try {
        const cfgRow = await env.DB.prepare("SELECT value FROM config WHERE key = 'user_config'").first<{ value: string }>();
        if (cfgRow && cfgRow.value) {
          const parsed = JSON.parse(cfgRow.value);
          if (parsed.groqApiKey) groqKey = parsed.groqApiKey;
          if (parsed.openrouterApiKey) orKey = parsed.openrouterApiKey;
          if (parsed.typesafeApiKey) typesafeKey = parsed.typesafeApiKey;
        }
      } catch {}

      // 2. Fetch trade logs & holdings from D1
      const thaiDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()); // YYYY-MM-DD
      const reportDate = body.date || thaiDate;

      // Query past 24h logs
      const { results: rawLogs } = await env.DB.prepare(
        "SELECT * FROM quant_logs ORDER BY created_at DESC LIMIT 50"
      ).all();

      // Query active holdings
      const { results: rawHoldings } = await env.DB.prepare(
        "SELECT * FROM holdings WHERE is_paper = 0"
      ).all();

      // Query market tickers (BTC, ETH, SOL) from Bitget
      let marketSnapshot: any = {};
      try {
        const mRes = await fetch("https://api.bitget.com/api/v2/spot/market/tickers", { signal: AbortSignal.timeout(4000) });
        if (mRes.ok) {
          const mData: any = await mRes.json();
          if (mData.code === "00000" && Array.isArray(mData.data)) {
            const focusCoins = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT", "DGAIUSDT", "BTWUSDT"];
            mData.data.filter((t: any) => focusCoins.includes(t.symbol)).forEach((t: any) => {
              marketSnapshot[t.symbol] = {
                price: t.lastPr,
                change24h: (parseFloat(t.change24h || 0) * 100).toFixed(2) + "%",
                high24h: t.high24h,
                low24h: t.low24h,
                volUsdt: (parseFloat(t.usdtVolume || 0) / 1000000).toFixed(1) + "M",
              };
            });
          }
        }
      } catch {}

      // 3. Trade Statistics & Fee Calculation (Bitget Spot: 0.1% Taker fee / 0.2% round-trip)
      const logs = rawLogs || [];
      const tradeLogs = logs.filter((l: any) =>
        l.action && (l.action.includes("BUY") || l.action.includes("PROFIT") || l.action.includes("LOSS") || l.action.includes("SELL"))
      );

      const buys = logs.filter((l: any) => l.action && l.action.includes("BUY"));
      const sells = logs.filter((l: any) => l.action && (l.action.includes("PROFIT") || l.action.includes("LOSS") || l.action.includes("SELL")));
      const winTrades = logs.filter((l: any) => l.action && (l.action.includes("PROFIT") || (l.note && l.note.includes("+"))));

      const totalTrades = tradeLogs.length;
      const winRate = sells.length > 0 ? parseFloat(((winTrades.length / sells.length) * 100).toFixed(1)) : 100.0;

      // Bitget Fee estimation: 0.1% per trade order (assuming standard $10 order size = $0.01 fee per trade)
      const totalEstimatedFeeUsdt = parseFloat((totalTrades * 0.01).toFixed(4));
      const grossPnlUsdt = parseFloat(
        (rawHoldings || []).reduce((acc: number, h: any) => acc + (parseFloat(h.unrealized_pnl || 0)), 0).toFixed(2)
      );
      const netPnlUsdt = parseFloat((grossPnlUsdt - totalEstimatedFeeUsdt).toFixed(2));

      // 4. Generate AI Report via Groq (Primary) or OpenRouter (Fallback)
      const promptContext = {
        date: reportDate,
        totalTrades,
        buysCount: buys.length,
        sellsCount: sells.length,
        winRate: `${winRate}%`,
        grossPnlUsdt: `$${grossPnlUsdt} USDT`,
        netPnlUsdt: `$${netPnlUsdt} USDT`,
        totalEstimatedFeeUsdt: `$${totalEstimatedFeeUsdt} USDT (หักค่าธรรมเนียม Bitget Taker 0.1% ต่อคำสั่ง)`,
        activeHoldings: (rawHoldings || []).map((h: any) => ({
          symbol: h.symbol,
          avgCost: h.avg_cost_price,
          amount: h.total_amount,
          invested: `$${h.total_invested_usdt}`,
        })),
        recentDecisions: logs.slice(0, 15).map((l: any) => `[${l.time}] ${l.action} ${l.symbol || ""}: ${l.note}`),
        marketSnapshot,
      };

      const systemPrompt = `คุณคือ "AutoTD Quantitative Lead & Senior Market Analyst" รับผิดชอบการวิเคราะห์และสรุปผลการทำงานของระบบเทรดคริปโตอัตโนมัติ 24/7 (Multi-Timeframe Quant + TypeSafe JEV System One + Groq AI บน Bitget Spot)
เขียนบทความรายงานประจำวันในรูปแบบ Markdown ภาษาไทยที่อ่านง่าย มืออาชีพ น่าเชื่อถือ และให้สาระเชิงลึกสำหรับนักเทรด`;

      const userPrompt = `กรุณาเขียน "รายงานสรุปการซื้อขายและบทวิเคราะห์ตลาดประจำวัน (Daily Trading & Market Intelligence Report)" สำหรับวันที่ ${reportDate} จากข้อมูลจริงของระบบดังนี้:

ข้อมูลการเทรดและสถิติ:
${JSON.stringify(promptContext, null, 2)}

โครงสร้างบทความที่ต้องมี (จัดรูปแบบด้วย Markdown สวยงาม):
# 📈 AutoTD Daily Intelligence Report: ${reportDate}

### 1. 📌 ภาพรวมผลการดำเนินงานประจำวัน (Executive Trading Recap)
- สรุปภาพรวมจำนวนการเทรด, Win Rate, PnL รวม และสถานะพอร์ตเหรียญปัจจุบัน

### 2. 🧠 เจาะลึกการตัดสินใจของ AI & Quant (JEV & Multi-TF Sentinel Breakdown)
- วิเคราะห์ว่าในวันนั้น Quant Screener และ TypeSafe JEV (Tier 1 System One) ตัดสินใจอะไรไปบ้าง (การเข้าซื้อ BUY, การถือ HOLD, การขยายเวลาถือ หรือการดักขายล็อกกำไร)
- เหตุผลความเสี่ยง (Risk Score / Calibrated Probabilities) และสัญญาณทางเทคนิค (RSI, Supertrend, EMA)

### 3. 💸 การคำนวณภาษีและค่าธรรมเนียม Bitget Spot (Trading Fee Analysis & Churn Guard)
- วิเคราะห์ค่าธรรมเนียมซื้อขาย Bitget (Taker Fee 0.1% ต่อคำสั่ง = 0.2% ไป-กลับ)
- สรุปผลกระทบของการตั้งรอบตัดสินใจทุก 15 นาที และประสิทธิภาพของระบบ Breakeven Guard (+0.35%) ในการคุ้มกันไม่ให้ค่าธรรมเนียมกินกำไร
- เปรียบเทียบ Gross PnL vs Net PnL หลังหักค่าธรรมเนียมจริง

### 4. 🌐 ไฮไลท์ตลาดและข่าวคริปโตประจำวัน (Crypto Market Trends & Highlights)
- สรุปทิศทางตลาดภาพรวมของ Bitcoin, Ethereum, Solana และเหรียญที่ถืออยู่
- ปัจจัยเศรษฐกิจมหภาค ข่าวคริปโต หรือ Sentiment ที่น่าสนใจของวันนี้

### 5. 🧭 กลยุทธ์และคำแนะนำสำหรับวันพรุ่งนี้ (Tomorrow's Strategic Outlook)
- จุดเฝ้าระวัง แนวรับแนวต้าน และแผนการรับมือ

หมายเหตุ: เขียนด้วยภาษาไทยที่กระชับ สละสลวย ชัดเจน และใช้ตารางสรุปหรือ Bullet points ประกอบให้สวยงาม`;

      let aiContent = "";
      let aiProviderUsed = "groq/qwen-27b";

      // Try Groq First
      if (groqKey) {
        try {
          const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${groqKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "qwen/qwen3.8-27b",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              temperature: 0.5,
              max_tokens: 3000,
            }),
            signal: AbortSignal.timeout(20000),
          });

          if (groqRes.ok) {
            const gData: any = await groqRes.json();
            aiContent = gData.choices?.[0]?.message?.content || "";
            aiProviderUsed = "groq/qwen3.8-27b";
          }
        } catch (e: any) {
          console.warn("Groq report generation fallback:", e.message);
        }
      }

      // Fallback to OpenRouter if Groq failed
      if (!aiContent && orKey) {
        try {
          const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${orKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "liquid/lfm-2.5-2.6b:free",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              temperature: 0.5,
              max_tokens: 2500,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (orRes.ok) {
            const orData: any = await orRes.json();
            aiContent = orData.choices?.[0]?.message?.content || "";
            aiProviderUsed = "openrouter/free";
          }
        } catch (e: any) {
          console.warn("OpenRouter report generation fallback:", e.message);
        }
      }

      // Local fallback if no LLM responded
      if (!aiContent) {
        aiContent = `# 📈 AutoTD Daily Intelligence Report: ${reportDate}

### 1. 📌 ภาพรวมผลการดำเนินงานประจำวัน (Executive Trading Recap)
- **จำนวนการเทรดทั้งหมด:** ${totalTrades} ไม้
- **Win Rate:** ${winRate}%
- **Gross PnL:** $${grossPnlUsdt} USDT | **Net PnL:** $${netPnlUsdt} USDT
- **เหรียญที่ถือครอง:** ${(rawHoldings || []).map((h: any) => h.symbol).join(", ") || "ไม่มี"}

### 2. 🧠 เจาะลึกการตัดสินใจของ AI & Quant
ระบบ Multi-Timeframe Quant ร่วมกับ TypeSafe JEV System One ตรวจสอบสัญญาณทุก 15 นาที โดยกรองเหรียญที่มีโมเมนตัมแข็งแกร่งและคุมความเสี่ยงตามเป้าหมาย

### 3. 💸 การคำนวณภาษีและค่าธรรมเนียม Bitget Spot
- **Bitget Taker Fee:** 0.1% ต่อคำสั่ง (ไป-กลับ ~0.20%)
- **ค่าธรรมเนียมประมาณการ:** $${totalEstimatedFeeUsdt} USDT
- **ระบบป้องกัน Churning:** ตั้ง Breakeven Guard ที่ +0.35% เพื่อรับประกันว่าการปิดไม้จะไม่ถูกค่าธรรมเนียมกินทุน

### 4. 🌐 ไฮไลท์ตลาดคริปโต
Bitcoin และ Altcoins มีความผันผวนตามรอบของตลาด ระบบยังคงโฟกัสที่เหรียญสภาพคล่องสูงเพื่อความปลอดภัย

### 5. 🧭 กลยุทธ์วันพรุ่งนี้
คงระเบียบวินัยตามโมเดล รักษาวงเงินกระจาย 4 เหรียญ และเฝ้าระวังจุด Take Profit อัตโนมัติ`;
        aiProviderUsed = "quant-system-template";
      }

      const reportId = `report_${reportDate.replace(/-/g, "")}_${Date.now()}`;
      const title = `AutoTD Daily Intelligence Report: ${reportDate}`;
      const summary = `สรุปผลการเทรด ${reportDate}: เทรด ${totalTrades} ไม้, Win Rate ${winRate}%, Net PnL $${netPnlUsdt} USDT (หักค่าฟี Bitget $${totalEstimatedFeeUsdt} USDT)`;

      // 5. Store Report into D1
      await env.DB.prepare(
        `INSERT INTO daily_reports (id, date, title, summary, content, total_trades, win_rate, gross_pnl, net_pnl, total_fees, ai_provider, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(date) DO UPDATE SET
           id = excluded.id,
           title = excluded.title,
           summary = excluded.summary,
           content = excluded.content,
           total_trades = excluded.total_trades,
           win_rate = excluded.win_rate,
           gross_pnl = excluded.gross_pnl,
           net_pnl = excluded.net_pnl,
           total_fees = excluded.total_fees,
           ai_provider = excluded.ai_provider,
           created_at = CURRENT_TIMESTAMP`
      ).bind(
        reportId,
        reportDate,
        title,
        summary,
        aiContent,
        totalTrades,
        winRate,
        grossPnlUsdt,
        netPnlUsdt,
        totalEstimatedFeeUsdt,
        aiProviderUsed
      ).run();

      return Response.json({
        success: true,
        report: {
          id: reportId,
          date: reportDate,
          title,
          summary,
          content: aiContent,
          total_trades: totalTrades,
          win_rate: winRate,
          gross_pnl: grossPnlUsdt,
          net_pnl: netPnlUsdt,
          total_fees: totalEstimatedFeeUsdt,
          ai_provider: aiProviderUsed,
        },
      }, { headers: corsHeaders });
    } catch (err: any) {
      console.error("Generate report error:", err);
      return Response.json({ success: false, msg: err.message }, { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
};
