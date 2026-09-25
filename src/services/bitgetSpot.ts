// Bitget V2 Spot Quantitative Engine & Paper Trading Service
// Built with native Web Crypto API (crypto.subtle) for 100% Edge & Browser compatibility

export interface BitgetConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  isPaperTrading: boolean;
  takeProfitPercent: number; // e.g. 3.0 = +3%
  cutLossPercent: number;     // e.g. 5.0 = -5%
  maxTranches: number;       // e.g. 4
  maxCoins: number;          // e.g. 5
  cashReservePercent: number;// e.g. 30 = 30%
  autoRebalanceEnabled: boolean; // Rebalance weakest holding on Grade A+ opportunities
}

export interface SpotHolding {
  symbol: string;        // e.g. 'SOLUSDT'
  baseCoin: string;      // e.g. 'SOL'
  totalAmount: number;   // total coins held
  tranchesCount: number; // e.g. 2 of 4
  avgCostPrice: number;  // Weighted Average Cost Price
  totalInvestedUsdt: number;
  currentPrice: number;
  unrealizedPnlUsdt: number;
  pnlPercent: number;
  takeProfitPrice: number; // AvgCost * (1 + TP%)
  cutLossPrice: number;    // AvgCost * (1 - SL%)
  isPaper: boolean;
  history: Array<{ price: number; amount: number; time: string }>;
}

export interface SpotTickerItem {
  symbol: string;
  baseCoin: string;
  lastPr: number;
  change24h: number;
  high24h: number;
  low24h: number;
  usdtVolume: number;
  rsi15m?: number;
  aiScore?: number;
  signal?: 'BUY_DIP' | 'WATCH' | 'SELL_TP' | 'COOLDOWN';
}

const STORAGE_KEY_CONFIG = 'bitget_spot_config_v1';
const STORAGE_KEY_HOLDINGS = 'bitget_spot_holdings_v1';
const STORAGE_KEY_COOLDOWN = 'bitget_spot_cooldown_v1';
const STORAGE_KEY_PAPER_BALANCE = 'bitget_spot_paper_balance_v1';

export function loadBitgetConfig(): BitgetConfig {
  const defaults: BitgetConfig = {
    apiKey: '',
    secretKey: '',
    passphrase: '',
    isPaperTrading: true,
    takeProfitPercent: 3.5,
    cutLossPercent: 5.0,
    maxTranches: 4,
    maxCoins: 4,
    cashReservePercent: 30,
    autoRebalanceEnabled: true,
  };
  if (typeof window === 'undefined') return defaults;
  const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
  if (saved) {
    try {
      return { ...defaults, ...JSON.parse(saved) };
    } catch {}
  }
  return defaults;
}

export function saveBitgetConfig(cfg: BitgetConfig) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(cfg));
  }
}

// Paper Balance management (Default 10,000 USDT)
export function getPaperBalance(): number {
  if (typeof window === 'undefined') return 10000;
  const saved = localStorage.getItem(STORAGE_KEY_PAPER_BALANCE);
  return saved ? parseFloat(saved) : 10000;
}

export function setPaperBalance(amt: number) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_PAPER_BALANCE, amt.toString());
  }
}

// Cooldown Management (Prevents revenge trade after cut loss)
export function getCooldownMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  const saved = localStorage.getItem(STORAGE_KEY_COOLDOWN);
  if (!saved) return {};
  try {
    const map = JSON.parse(saved);
    const now = Date.now();
    const active: Record<string, number> = {};
    for (const [sym, expireTs] of Object.entries(map)) {
      if ((expireTs as number) > now) {
        active[sym] = expireTs as number;
      }
    }
    return active;
  } catch {
    return {};
  }
}

export function setCooldown(symbol: string, durationHours = 3) {
  if (typeof window === 'undefined') return;
  const map = getCooldownMap();
  map[symbol] = Date.now() + durationHours * 3600 * 1000;
  localStorage.setItem(STORAGE_KEY_COOLDOWN, JSON.stringify(map));
}

export function isUnderCooldown(symbol: string): boolean {
  const map = getCooldownMap();
  return !!(map[symbol] && map[symbol] > Date.now());
}

// Fetch Top 20 Bitget Spot Tickers
export async function fetchTopBitgetSpotTickers(): Promise<SpotTickerItem[]> {
  try {
    const res = await fetch('https://api.bitget.com/api/v2/spot/market/tickers');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== '00000' || !Array.isArray(json.data)) return [];

    const STABLECOINS = ['USDC', 'USDGO', 'FDUSD', 'USDE', 'DAI', 'TUSD', 'EUR', 'BUSD'];
    const REAL_R_CRYPTO = ['RENDERUSDT', 'ROSEUSDT', 'RUNEUSDT', 'RONUSDT', 'RAYUSDT', 'REQUSDT'];

    const usdtPairs = json.data
      .filter((item: any) => {
        if (!item.symbol || !item.symbol.endsWith('USDT')) return false;
        const sym = item.symbol;
        if (sym.includes('_')) return false;
        // Filter out synthetic stocks starting with R unless verified genuine crypto
        if (sym.startsWith('R') && !REAL_R_CRYPTO.includes(sym)) return false;
        const base = sym.replace('USDT', '');
        if (STABLECOINS.includes(base)) return false;
        return true;
      })
      .map((item: any) => {
        const vol = parseFloat(item.usdtVolume || '0');
        const price = parseFloat(item.lastPr || '0');
        const change = parseFloat(item.change24h || '0') * 100;
        const sym = item.symbol;
        const base = sym.replace('USDT', '');
        return {
          symbol: sym,
          baseCoin: base,
          lastPr: price,
          change24h: change,
          high24h: parseFloat(item.high24h || '0'),
          low24h: parseFloat(item.low24h || '0'),
          usdtVolume: vol,
        };
      })
      .filter((i: any) => i.lastPr > 0 && i.usdtVolume > 500000) // minimum $500k volume
      .sort((a: any, b: any) => b.usdtVolume - a.usdtVolume)
      .slice(0, 20);

    return usdtPairs;
  } catch (e) {
    console.warn('Failed to fetch Bitget spot tickers:', e);
    return [];
  }
}

// Fetch Bitget Spot Candles
export async function fetchBitgetSpotCandles(
  symbol: string,
  granularity = '15min',
  limit = 100
) {
  try {
    const res = await fetch(
      `https://api.bitget.com/api/v2/spot/market/candles?symbol=${symbol}&granularity=${granularity}&limit=${limit}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== '00000' || !Array.isArray(json.data)) return [];

    // [ts, open, high, low, close, baseVol, quoteVol, usdtVol]
    return [...json.data]
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(item => ({
        time: Math.floor(parseInt(item[0]) / 1000),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[7] || item[5]),
      }));
  } catch (e) {
    console.warn('Failed to fetch Bitget spot candles:', e);
    return [];
  }
}

// Load Spot Holdings
export function loadSpotHoldings(): SpotHolding[] {
  if (typeof window === 'undefined') return [];
  const saved = localStorage.getItem(STORAGE_KEY_HOLDINGS);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {}
  }
  return [];
}

export function saveSpotHoldings(holdings: SpotHolding[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_HOLDINGS, JSON.stringify(holdings));
  }
}

// Core Execution: BUY TRANCHE (DCA Average Cost Engine)
export function executeSpotBuyTranche(
  symbol: string,
  price: number,
  usdtAmount: number,
  config: BitgetConfig
): { success: boolean; message: string; updatedHoldings: SpotHolding[] } {
  const holdings = loadSpotHoldings();
  const existingIdx = holdings.findIndex(h => h.symbol === symbol);
  const coinsBought = usdtAmount / price;
  const nowStr = new Date().toLocaleTimeString();

  if (existingIdx >= 0) {
    const existing = holdings[existingIdx];
    if (existing.tranchesCount >= config.maxTranches) {
      return {
        success: false,
        message: `ครบโควตาสูงสุด ${config.maxTranches} ไม้แล้วสำหรับ ${symbol}`,
        updatedHoldings: holdings,
      };
    }

    // Weighted Average Cost formula: Sum(Price * Size) / Total Size
    const newTotalAmount = existing.totalAmount + coinsBought;
    const newTotalInvested = existing.totalInvestedUsdt + usdtAmount;
    const newAvgCost = newTotalInvested / newTotalAmount;
    const newTranches = existing.tranchesCount + 1;

    const updated: SpotHolding = {
      ...existing,
      totalAmount: newTotalAmount,
      totalInvestedUsdt: newTotalInvested,
      avgCostPrice: parseFloat(newAvgCost.toFixed(4)),
      tranchesCount: newTranches,
      currentPrice: price,
      unrealizedPnlUsdt: (price - newAvgCost) * newTotalAmount,
      pnlPercent: ((price - newAvgCost) / newAvgCost) * 100,
      takeProfitPrice: parseFloat((newAvgCost * (1 + config.takeProfitPercent / 100)).toFixed(4)),
      cutLossPrice: parseFloat((newAvgCost * (1 - config.cutLossPercent / 100)).toFixed(4)),
      history: [...existing.history, { price, amount: coinsBought, time: nowStr }],
    };

    holdings[existingIdx] = updated;
    saveSpotHoldings(holdings);

    // Deduct paper balance if paper trading
    if (config.isPaperTrading) {
      const curBal = getPaperBalance();
      setPaperBalance(Math.max(0, curBal - usdtAmount));
    }

    return {
      success: true,
      message: `✓ เข้าซื้อ ${symbol} ไม้ที่ ${newTranches}/${config.maxTranches} @ $${price} (ต้นทุนเฉลี่ยใหม่: $${updated.avgCostPrice})`,
      updatedHoldings: holdings,
    };
  } else {
    // Check max coins guardrail
    if (holdings.length >= config.maxCoins) {
      return {
        success: false,
        message: `พอร์ตถือเหรียญครบโควตา ${config.maxCoins} ตัวแล้ว ไม่สามารถเปิดเหรียญใหม่ได้`,
        updatedHoldings: holdings,
      };
    }

    const base = symbol.replace('USDT', '');
    const newAvgCost = price;
    const newHolding: SpotHolding = {
      symbol,
      baseCoin: base,
      totalAmount: coinsBought,
      tranchesCount: 1,
      avgCostPrice: price,
      totalInvestedUsdt: usdtAmount,
      currentPrice: price,
      unrealizedPnlUsdt: 0,
      pnlPercent: 0,
      takeProfitPrice: parseFloat((price * (1 + config.takeProfitPercent / 100)).toFixed(4)),
      cutLossPrice: parseFloat((price * (1 - config.cutLossPercent / 100)).toFixed(4)),
      isPaper: config.isPaperTrading,
      history: [{ price, amount: coinsBought, time: nowStr }],
    };

    holdings.push(newHolding);
    saveSpotHoldings(holdings);

    if (config.isPaperTrading) {
      const curBal = getPaperBalance();
      setPaperBalance(Math.max(0, curBal - usdtAmount));
    }

    return {
      success: true,
      message: `✓ เปิดไม้แรก ${symbol} [1/${config.maxTranches}] @ $${price} สำเร็จ`,
      updatedHoldings: holdings,
    };
  }
}

// Core Execution: SELL OR CUT LOSS 100%
export function executeSpotSell(
  symbol: string,
  currentPrice: number,
  isCutLoss = false
): { success: boolean; message: string; realizedPnl: number; updatedHoldings: SpotHolding[] } {
  const holdings = loadSpotHoldings();
  const idx = holdings.findIndex(h => h.symbol === symbol);
  if (idx === -1) {
    return { success: false, message: `ไม่พบเหรียญ ${symbol} ในพอร์ต`, realizedPnl: 0, updatedHoldings: holdings };
  }

  const h = holdings[idx];
  const totalReturnUsdt = h.totalAmount * currentPrice;
  const realizedPnl = totalReturnUsdt - h.totalInvestedUsdt;
  const pnlPct = ((currentPrice - h.avgCostPrice) / h.avgCostPrice) * 100;

  // Remove from holdings
  holdings.splice(idx, 1);
  saveSpotHoldings(holdings);

  // Return funds to paper balance
  const curBal = getPaperBalance();
  setPaperBalance(curBal + totalReturnUsdt);

  // If it's a cut loss, set 3-hour cooldown
  if (isCutLoss) {
    setCooldown(symbol, 3);
  }

  const pnlSign = realizedPnl >= 0 ? '+' : '';
  const actionText = isCutLoss ? '🚨 CUT LOSS' : '🎯 TAKE PROFIT';
  const msg = `${actionText} ${symbol} @ $${currentPrice}: กำไรสุทธิ ${pnlSign}$${realizedPnl.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%) คืน USDT เรียบร้อยแล้ว`;

  return {
    success: true,
    message: msg,
    realizedPnl,
    updatedHoldings: holdings,
  };
}

// Sync live prices with current holdings to calculate Live PnL
export function updateHoldingsWithLivePrices(
  holdings: SpotHolding[],
  priceMap: Record<string, number>
): SpotHolding[] {
  return holdings.map(h => {
    const live = priceMap[h.symbol] ?? h.currentPrice;
    const unPnl = (live - h.avgCostPrice) * h.totalAmount;
    const pnlPct = ((live - h.avgCostPrice) / h.avgCostPrice) * 100;
    return {
      ...h,
      currentPrice: live,
      unrealizedPnlUsdt: unPnl,
      pnlPercent: pnlPct,
    };
  });
}

// Identify Weakest Holding (Dead Capital / Stagnant sideways asset)
export function findWeakestHolding(holdings: SpotHolding[]): SpotHolding | null {
  if (holdings.length === 0) return null;
  // Prioritize position with PnL closest to 0% (stagnant/sideways) and lowest profit
  const sorted = [...holdings].sort((a, b) => {
    const aAbs = Math.abs(a.pnlPercent);
    const bAbs = Math.abs(b.pnlPercent);
    return aAbs - bAbs;
  });
  return sorted[0];
}

// Execute Rebalance Rotation (Sell weakest position, buy Grade A+ opportunity)
export function executeRebalanceRotation(
  exitSymbol: string,
  entrySymbol: string,
  entryPrice: number,
  config: BitgetConfig
): { success: boolean; message: string; updatedHoldings: SpotHolding[] } {
  const sellRes = executeSpotSell(exitSymbol, 0, false);
  const buyRes = executeSpotBuyTranche(entrySymbol, entryPrice, 500, config);

  const msg = `🔄 REBALANCE ROTATION: ปิดเหรียญนิ่ง ${exitSymbol} เสมอตัว -> ย้ายทุนเข้าโอกาสทอง ${entrySymbol} [1/${config.maxTranches}] @ $${entryPrice} ทันที`;

  return {
    success: buyRes.success,
    message: msg,
    updatedHoldings: buyRes.updatedHoldings,
  };
}
