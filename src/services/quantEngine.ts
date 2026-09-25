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

export function loadQuantLogs(): Array<{ id: string; time: string; action: string; symbol: string; note: string; color: string }> {
  if (typeof window === 'undefined') return [];
  const s = localStorage.getItem(STORAGE_KEY_QUANT_LOGS);
  if (s) {
    try {
      return JSON.parse(s);
    } catch {}
  }
  return [
    {
      id: '1',
      time: new Date(Date.now() - 3600000).toLocaleTimeString(),
      action: 'BUY TRANCHE [1/4]',
      symbol: 'SOL/USDT',
      note: 'พบจังหวะ Dip in Uptrend (15m RSI 38.4 ย่อแตะแนวรับ $178)',
      color: '#10b981',
    },
    {
      id: '2',
      time: new Date(Date.now() - 1800000).toLocaleTimeString(),
      action: 'DCA TRANCHE [2/4]',
      symbol: 'SOL/USDT',
      note: 'ย่อตัวลงมา -2.2% เข้าไม้ถัวเฉลี่ย คำนวณต้นทุนเฉลี่ยใหม่ $176.40',
      color: '#0ea5e9',
    },
    {
      id: '3',
      time: new Date(Date.now() - 600000).toLocaleTimeString(),
      action: 'TAKE PROFIT',
      symbol: 'BTC/USDT',
      note: 'กำไรถึงเป้า +3.8% เหนือราคาเฉลี่ย ขายทำกำไรคืนเงินสด USDT',
      color: '#a855f7',
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
  holdings: SpotHolding[]
): SpotTickerItem[] {
  const heldSymbols = new Set(holdings.map(h => h.symbol));

  return tickers.map(t => {
    const underCooldown = isUnderCooldown(t.symbol);
    if (underCooldown) {
      return {
        ...t,
        rsi15m: 32,
        aiScore: 10,
        signal: 'COOLDOWN',
      };
    }

    // Heuristic RSI based on price change & 24h position
    const range = t.high24h - t.low24h;
    const pos = range > 0 ? (t.lastPr - t.low24h) / range : 0.5;
    const estRsi = Math.round(30 + pos * 50);

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

    // 2. Pullback / Mean-Reversion Zone (0-35 pts) - 35% to 55% pullback
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
      rsi15m: estRsi,
      aiScore: score,
      signal,
    };
  });
}

// Master Quant Evaluator Loop (Checks Holdings for Take-Profit and Cut-Loss)
export function runQuantPortfolioCheck(
  holdings: SpotHolding[],
  config: BitgetConfig
): {
  decision: QuantDecision | null;
  overallState: QuantExecutiveState;
} {
  const logs = loadQuantLogs();
  let decision: QuantDecision | null = null;
  let status: QuantExecutiveState['status'] = 'SCANNING';
  let statusMessage = 'กำลังสแกนตลาด Top 20 Spot Bitget เพื่อหาจังหวะ Dip in Uptrend';

  // Check each holding for Cut Loss or Take Profit
  for (const h of holdings) {
    // 1. Cut-Loss Check (-5% from Weighted Avg Cost)
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

    // 2. Take-Profit Check (+3% to +5% from Weighted Avg Cost)
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
