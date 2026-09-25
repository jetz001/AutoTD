// Autonomous Quant Commander Decision Engine
import type { SpotTickerItem, SpotHolding, BitgetConfig } from './bitgetSpot';
import { isUnderCooldown } from './bitgetSpot';

export interface QuantDecision {
  action: 'BUY_TRANCHE' | 'TAKE_PROFIT' | 'CUT_LOSS' | 'HOLD_SCANNING';
  symbol: string;
  price: number;
  reason: string;
  confidence: number;
  timestamp: string;
}

export interface QuantExecutiveState {
  status: 'SCANNING' | 'ACCUMULATING' | 'TAKING_PROFIT' | 'CUTTING_LOSS' | 'COOLDOWN_PROTECT';
  statusMessage: string;
  roundGoalPercent: number; // e.g. 5.0%
  currentRoundProgressPercent: number; // e.g. 3.2%
  activeCoinsCount: number;
  maxCoinsLimit: number;
  totalDeployedUsdt: number;
  cashReserveUsdt: number;
  recentLogs: Array<{ id: string; time: string; action: string; symbol: string; note: string; color: string }>;
}

const STORAGE_KEY_QUANT_LOGS = 'bitget_quant_logs_v1';

// Standard 14-period RSI calculation from candle closes
export function calculateRSI(closes: number[], period = 14): number {
  if (!closes || closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

export function loadQuantLogs(): Array<{ id: string; time: string; action: string; symbol: string; note: string; color: string }> {
  if (typeof window === 'undefined') return [];
  const s = localStorage.getItem(STORAGE_KEY_QUANT_LOGS);
  if (s) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        // Filter out legacy mock logs
        const cleaned = parsed.filter((log: any) => 
          !log.note?.includes('15m RSI 38.4') && 
          !log.note?.includes('176.40') &&
          !log.note?.includes('3.8% เหนือราคาเฉลี่ย')
        );
        if (cleaned.length > 0) return cleaned;
      }
    } catch {}
  }
  return [
    {
      id: 'init-1',
      time: new Date().toLocaleTimeString(),
      action: 'SYSTEM READY',
      symbol: 'QUANT ENGINE',
      note: 'ระบบพร้อมทำงาน - รอสัญญาณ Dip in Uptrend จากตลาดสด Bitget Spot',
      color: '#10b981',
    },
  ];
}

export function saveQuantLogs(logs: Array<{ id: string; time: string; action: string; symbol: string; note: string; color: string }>) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_QUANT_LOGS, JSON.stringify(logs.slice(0, 20)));
  }
}

// Evaluate Market Screener for Dip in Uptrend
export function evaluateScreener(
  tickers: SpotTickerItem[],
  holdings: SpotHolding[],
  realRsiMap?: Record<string, number>
): SpotTickerItem[] {
  const heldSymbols = new Set(holdings.map(h => h.symbol));

  return tickers.map(t => {
    const underCooldown = isUnderCooldown(t.symbol);
    if (underCooldown) {
      return {
        ...t,
        rsi15m: realRsiMap?.[t.symbol] ?? 32,
        aiScore: 10,
        signal: 'COOLDOWN',
      };
    }

    // Real RSI from 15m candles if available, else heuristic from 24h range
    let rsi15m: number;
    const range = t.high24h - t.low24h;
    const pos = range > 0 ? (t.lastPr - t.low24h) / range : 0.5;

    if (realRsiMap && typeof realRsiMap[t.symbol] === 'number') {
      rsi15m = realRsiMap[t.symbol];
    } else {
      rsi15m = Math.round(30 + pos * 50);
    }

    // Dynamic Multi-Factor Quant Formula (0-100 pts)
    // 1. Trend Momentum (0-35 pts) - Sweet spot is steady +1% to +6%
    let trendScore = 15;
    if (t.change24h >= 1 && t.change24h <= 6) {
      trendScore = 32 + Math.min(3, Math.round((t.change24h - 1) * 0.6));
    } else if (t.change24h > 6 && t.change24h <= 12) {
      trendScore = 26;
    } else if (t.change24h > 12) {
      trendScore = 18;
    } else if (t.change24h < 0 && t.change24h >= -3) {
      trendScore = 22;
    } else if (t.change24h < -3 && t.change24h >= -7) {
      trendScore = 15;
    } else {
      trendScore = 8;
    }

    // 2. Pullback Zone Factor (0-35 pts) - RSI 35 to 45 is the prime Dip-in-Uptrend zone
    let pullbackScore = 20;
    if (rsi15m >= 35 && rsi15m <= 46) {
      pullbackScore = 35;
    } else if (rsi15m >= 30 && rsi15m < 35) {
      pullbackScore = 30;
    } else if (rsi15m > 46 && rsi15m <= 55) {
      pullbackScore = 25;
    } else if (rsi15m < 30) {
      pullbackScore = 20;
    } else {
      pullbackScore = 12; // Overbought > 55
    }

    // 3. Liquidity Quality Factor (0-30 pts) based on 24h volume
    let volScore = 10;
    if (t.usdtVolume > 50_000_000) volScore = 30;
    else if (t.usdtVolume > 20_000_000) volScore = 26;
    else if (t.usdtVolume > 5_000_000) volScore = 22;
    else if (t.usdtVolume > 1_000_000) volScore = 16;
    else volScore = 10;

    const score = Math.min(99, Math.max(15, trendScore + pullbackScore + volScore));

    let signal: 'BUY_DIP' | 'WATCH' | 'SELL_TP' | 'COOLDOWN' = 'WATCH';
    if (score >= 80) {
      signal = 'BUY_DIP';
    }

    return {
      ...t,
      rsi15m: rsi15m,
      aiScore: score,
      signal,
    };
  });
}

// Master Quant Evaluator Loop (Checks Holdings for Take-Profit and Cut-Loss)
export function runQuantPortfolioCheck(
  holdings: SpotHolding[],
  config: BitgetConfig,
  screenedCandidates?: SpotTickerItem[]
): {
  decision: QuantDecision | null;
  overallState: QuantExecutiveState;
} {
  const logs = loadQuantLogs();
  let decision: QuantDecision | null = null;
  let status: QuantExecutiveState['status'] = 'SCANNING';
  let statusMessage = 'กำลังสแกนตลาด Top 20 Spot Bitget เพื่อหาจังหวะ Dip in Uptrend';

  // 1. Check each holding for Cut Loss or Take Profit or DCA Tranche
  for (const h of holdings) {
    // 1.1 Cut-Loss Check (-5% from Weighted Avg Cost)
    if (h.currentPrice <= h.cutLossPrice) {
      decision = {
        action: 'CUT_LOSS',
        symbol: h.symbol,
        price: h.currentPrice,
        reason: `ราคาลงแตะจุดตัดขาดทุน Hard Stop -${config.cutLossPercent}% (ทุนเฉลี่ย $${h.avgCostPrice} -> ปัจจุบัน $${h.currentPrice}) คัททิ้ง 100% รักษาเงินสด`,
        confidence: 96,
        timestamp: new Date().toLocaleTimeString(),
      };
      status = 'CUTTING_LOSS';
      statusMessage = `🚨 สั่งคัทลอส ${h.symbol} ที่ $${h.currentPrice} ทันทีเพื่อดึงเงินสดกลับกระเป๋า`;
      break;
    }

    // 1.2 Take-Profit Check (+3% to +5% from Weighted Avg Cost)
    if (h.currentPrice >= h.takeProfitPrice) {
      decision = {
        action: 'TAKE_PROFIT',
        symbol: h.symbol,
        price: h.currentPrice,
        reason: `ราคาพุ่งแตะเป้าทำกำไร +${config.takeProfitPercent}% เหนือต้นทุนเฉลี่ย $${h.avgCostPrice} (ปัจจุบัน $${h.currentPrice}) ขายทำกำไรปิดรอบ`,
        confidence: 92,
        timestamp: new Date().toLocaleTimeString(),
      };
      status = 'TAKING_PROFIT';
      statusMessage = `🎯 ถึงเป้ากำไร ${h.symbol} (+${h.pnlPercent.toFixed(1)}%) สั่งขายปิดทำกำไร`;
      break;
    }

    // 1.3 DCA Tranche Check (If price dropped >= 3% from avgCost and not reached max tranches)
    if (h.tranchesCount < config.maxTranches && h.currentPrice <= h.avgCostPrice * 0.97) {
      decision = {
        action: 'BUY_TRANCHE',
        symbol: h.symbol,
        price: h.currentPrice,
        reason: `ราคาลงมาลึก ${h.pnlPercent.toFixed(1)}% จากทุนเดิม $${h.avgCostPrice} เข้าเกณฑ์ DCA สะสมไม้ที่ ${h.tranchesCount + 1}/${config.maxTranches} เพื่อดึงต้นทุนเฉลี่ยลง`,
        confidence: 88,
        timestamp: new Date().toLocaleTimeString(),
      };
      status = 'ACCUMULATING';
      statusMessage = `📉 สัญญาณเข้าซื้อ DCA ${h.symbol} ไม้ที่ ${h.tranchesCount + 1} ที่ $${h.currentPrice}`;
      break;
    }
  }

  // 2. If no holding action and portfolio has capacity (< maxCoins), check screened candidates
  if (!decision && holdings.length < config.maxCoins && screenedCandidates && screenedCandidates.length > 0) {
    const heldSymbols = new Set(holdings.map(h => h.symbol));
    const buyableCandidates = screenedCandidates
      .filter(c => !heldSymbols.has(c.symbol) && !isUnderCooldown(c.symbol) && ((c.aiScore || 0) >= 80 || c.signal === 'BUY_DIP'))
      .sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));

    if (buyableCandidates.length > 0) {
      const topPick = buyableCandidates[0];
      decision = {
        action: 'BUY_TRANCHE',
        symbol: topPick.symbol,
        price: topPick.lastPr,
        reason: `Quant คัดเลือก Dip in Uptrend เกรด A+ (คะแนน ${topPick.aiScore}/100, RSI 15m ${topPick.rsi15m}) เตรียมส่ง AI คอนเฟิร์มเข้าสะสมไม้ 1`,
        confidence: topPick.aiScore || 85,
        timestamp: new Date().toLocaleTimeString(),
      };
      status = 'ACCUMULATING';
      statusMessage = `⚡ พบจังหวะซื้อ Dip in Uptrend: ${topPick.symbol} (Score ${topPick.aiScore}/100)`;
    }
  }

  // Calculate total deployed vs cash
  const totalDeployed = holdings.reduce((sum, h) => sum + h.totalInvestedUsdt, 0);
  const totalUnrealizedPnl = holdings.reduce((sum, h) => sum + h.unrealizedPnlUsdt, 0);
  const avgPnlPct = holdings.length > 0
    ? holdings.reduce((sum, h) => sum + h.pnlPercent, 0) / holdings.length
    : 0;

  if (holdings.length > 0 && status === 'SCANNING') {
    status = 'ACCUMULATING';
    statusMessage = `ถือครอง ${holdings.length}/${config.maxCoins} เหรียญ กำไรเฉลี่ย ${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(2)}% (เป้าหมาย +${config.takeProfitPercent}%)`;
  }

  const overallState: QuantExecutiveState = {
    status,
    statusMessage,
    roundGoalPercent: config.takeProfitPercent,
    currentRoundProgressPercent: Math.max(0, avgPnlPct),
    activeCoinsCount: holdings.length,
    maxCoinsLimit: config.maxCoins,
    totalDeployedUsdt: totalDeployed,
    cashReserveUsdt: Math.max(0, 10000 - totalDeployed + totalUnrealizedPnl),
    recentLogs: logs,
  };

  return { decision, overallState };
}
