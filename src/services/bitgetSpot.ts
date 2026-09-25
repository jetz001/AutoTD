// Bitget V2 Spot Quantitative Engine & Paper Trading Service
// Built with native Web Crypto API (crypto.subtle) for 100% Edge & Browser compatibility
import { calculateRSI } from './quantEngine';

export const EDGE_BOT_URL = '';

export interface BitgetConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  openrouterApiKey?: string;
  isPaperTrading: boolean;
  autoPilotEnabled: boolean;  // Master Auto-Pilot switch (ON/OFF)
  tranchePercent: number;     // e.g. 20 = 20% of available USDT per tranche
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
    openrouterApiKey: '',
    isPaperTrading: false, // Default to Live if configured, or user toggleable
    autoPilotEnabled: true, // FULL BOT AUTO-PILOT ON BY DEFAULT
    tranchePercent: 20,     // 20% of available cash per tranche
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

// Real 15m RSI Calculation & Cache
const rsiCache: Record<string, { rsi: number; timestamp: number }> = {};

export async function fetchRealRsi15m(symbol: string): Promise<number> {
  const cached = rsiCache[symbol];
  if (cached && Date.now() - cached.timestamp < 60000) {
    return cached.rsi;
  }
  try {
    const candles = await fetchBitgetSpotCandles(symbol, '15min', 30);
    if (candles && candles.length >= 15) {
      const closes = candles.map(c => c.close);
      const rsi = calculateRSI(closes, 14);
      rsiCache[symbol] = { rsi, timestamp: Date.now() };
      return rsi;
    }
  } catch (e) {
    console.warn(`Failed to fetch 15m candles for RSI of ${symbol}:`, e);
  }
  return 50;
}

export async function fetchBatchRealRsi(symbols: string[]): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  // Batch in chunks of 5 to avoid browser network congestion
  const chunkSize = 5;
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    await Promise.allSettled(
      chunk.map(async (sym) => {
        const val = await fetchRealRsi15m(sym);
        map[sym] = val;
      })
    );
  }
  return map;
}

// OpenRouter AI Agent Integration via Cloudflare Pages Function
export interface AIAgentDecision {
  action: 'BUY_SPOT' | 'HOLD';
  confidence: number;
  reason: string;
  modelUsed: string;
  symbol: string;
  price: number;
}

export async function consultOpenRouterAgent(
  candidate: {
    symbol: string;
    currentPrice: number;
    change24h: number;
    rsi15m: number;
    aiScore: number;
    recentCandles?: any[];
  },
  config?: BitgetConfig
): Promise<AIAgentDecision | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config?.openrouterApiKey) {
      headers['x-openrouter-key'] = config.openrouterApiKey;
    }
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers,
      body: JSON.stringify(candidate),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code === '00000' && json.data) {
      return json.data;
    }
    return null;
  } catch (err) {
    console.warn('consultOpenRouterAgent failed:', err);
    return null;
  }
}

// Calculate Tranche Budget based on available cash (Default 20% of cash, min $10 USDT)
export function calculateTrancheBudget(availableUsdt: number, tranchePercent = 20): number {
  if (availableUsdt <= 0) return 10;
  const calculated = (availableUsdt * (tranchePercent || 20)) / 100;
  return Math.max(10, parseFloat(calculated.toFixed(2)));
}

// Edge Bot Integration
export async function fetchEdgeBotStatus() {
  if (!EDGE_BOT_URL) return null;
  try {
    const res = await fetch(`${EDGE_BOT_URL}/api/status`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function triggerEdgeBotWake(reason = 'MANUAL_TRIGGER_FROM_DASHBOARD') {
  if (!EDGE_BOT_URL) return { success: true };
  try {
    const res = await fetch(`${EDGE_BOT_URL}/api/wake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// Cloudflare Pages Secret Sync
export async function syncBitgetConfigFromCloudflare(): Promise<Partial<BitgetConfig> | null> {
  try {
    const res = await fetch('/api/bitget?action=sync-config');
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code === '00000' && json.data?.hasCredentials) {
      return {
        apiKey: json.data.apiKey,
        secretKey: json.data.secretKey,
        passphrase: json.data.passphrase,
      };
    }
  } catch {}
  return null;
}

// Native Browser & Edge Web Crypto HMAC-SHA256 Signer for Bitget API
export async function signBitgetRequest(
  timestamp: string,
  method: string,
  requestPath: string,
  queryString: string,
  body: string,
  secretKey: string
): Promise<string> {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? `?${queryString}` : '') + (body || '');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Real Bitget API Communication (Direct Browser WebCrypto with Pages Proxy Fallback)
export async function executeRealBitgetOrder(
  order: {
    symbol: string;
    side: 'buy' | 'sell';
    orderType: 'market' | 'limit';
    size: string;
    price?: string;
  },
  config?: BitgetConfig
): Promise<{ success: boolean; data?: any; message: string }> {
  // 1. First priority: Direct Browser WebCrypto request (Bypasses Cloudflare Worker WAF blocks)
  if (config?.apiKey && config?.secretKey && config?.passphrase) {
    try {
      const timestamp = Date.now().toString();
      const requestPath = '/api/v2/spot/trade/place-order';
      const payload: any = {
        symbol: order.symbol,
        side: order.side,
        orderType: order.orderType || 'market',
        size: String(order.size),
        clientOid: `td_${Date.now()}`,
      };
      if (order.price) payload.price = String(order.price);
      const bodyStr = JSON.stringify(payload);
      const sign = await signBitgetRequest(timestamp, 'POST', requestPath, '', bodyStr, config.secretKey);

      const directRes = await fetch(`https://api.bitget.com${requestPath}`, {
        method: 'POST',
        headers: {
          'ACCESS-KEY': config.apiKey,
          'ACCESS-SIGN': sign,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-PASSPHRASE': config.passphrase,
          'Content-Type': 'application/json',
          locale: 'en-US',
        },
        body: bodyStr,
      });

      const directJson = await directRes.json();
      if (directJson.code === '00000') {
        return {
          success: true,
          data: directJson.data,
          message: `✓ [Bitget Spot] ส่งคำสั่งสำเร็จ: orderId=${directJson.data?.orderId || 'ok'}`,
        };
      } else if (directJson.code) {
        return {
          success: false,
          message: `Bitget API (${directJson.code}): ${directJson.msg || 'Order failed'}`,
        };
      }
    } catch (directErr) {
      console.warn('Direct Bitget call failed, falling back to Pages proxy:', directErr);
    }
  }

  // 2. Fallback: Cloudflare Pages Proxy Endpoint
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config?.apiKey) headers['x-bitget-key'] = config.apiKey;
    if (config?.secretKey) headers['x-bitget-secret'] = config.secretKey;
    if (config?.passphrase) headers['x-bitget-passphrase'] = config.passphrase;

    const res = await fetch('/api/bitget', {
      method: 'POST',
      headers,
      body: JSON.stringify(order),
    });
    const json = await res.json();
    if (!res.ok || json.code !== '00000') {
      return {
        success: false,
        message: `Bitget API Error (${json.code || res.status}): ${json.msg || 'Order failed'}`,
      };
    }
    return {
      success: true,
      data: json.data,
      message: `Bitget Order Success: orderId=${json.data?.orderId || 'ok'}`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Network error placing Bitget order: ${err.message}`,
    };
  }
}

export async function fetchRealBitgetAssets(config?: BitgetConfig): Promise<{
  usdtAvailable: number;
  assets: Array<{ coin: string; available: number; frozen: number }>;
} | null> {
  // 1. First priority: Direct Browser WebCrypto request
  if (config?.apiKey && config?.secretKey && config?.passphrase) {
    try {
      const timestamp = Date.now().toString();
      const requestPath = '/api/v2/spot/account/assets';
      const sign = await signBitgetRequest(timestamp, 'GET', requestPath, '', '', config.secretKey);

      const directRes = await fetch(`https://api.bitget.com${requestPath}`, {
        headers: {
          'ACCESS-KEY': config.apiKey,
          'ACCESS-SIGN': sign,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-PASSPHRASE': config.passphrase,
          'Content-Type': 'application/json',
          locale: 'en-US',
        },
      });

      const directJson = await directRes.json();
      if (directJson.code === '00000' && Array.isArray(directJson.data)) {
        let usdtAvailable = 0;
        const assets: Array<{ coin: string; available: number; frozen: number }> = [];

        for (const item of directJson.data) {
          const coin = item.coin || '';
          const avail = parseFloat(item.available || '0');
          const frozen = parseFloat(item.frozen || '0');
          if (coin === 'USDT') usdtAvailable = avail;
          if (avail > 0 || frozen > 0) assets.push({ coin, available: avail, frozen });
        }
        return { usdtAvailable, assets };
      }
    } catch (err) {
      console.warn('Direct assets fetch failed, falling back to proxy:', err);
    }
  }

  // 2. Fallback: Cloudflare Pages Proxy Endpoint
  try {
    const headers: Record<string, string> = {};
    if (config?.apiKey) headers['x-bitget-key'] = config.apiKey;
    if (config?.secretKey) headers['x-bitget-secret'] = config.secretKey;
    if (config?.passphrase) headers['x-bitget-passphrase'] = config.passphrase;

    const res = await fetch('/api/bitget?action=assets', { headers });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code !== '00000' || !Array.isArray(json.data)) return null;

    let usdtAvailable = 0;
    const assets: Array<{ coin: string; available: number; frozen: number }> = [];

    for (const item of json.data) {
      const coin = item.coin || '';
      const avail = parseFloat(item.available || '0');
      const frozen = parseFloat(item.frozen || '0');
      if (coin === 'USDT') {
        usdtAvailable = avail;
      }
      if (avail > 0 || frozen > 0) {
        assets.push({ coin, available: avail, frozen });
      }
    }
    return { usdtAvailable, assets };
  } catch {
    return null;
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

// Core Execution: BUY TRANCHE (DCA Average Cost Engine - Real & Paper)
export async function executeSpotBuyTranche(
  symbol: string,
  price: number,
  usdtAmount: number,
  config: BitgetConfig
): Promise<{ success: boolean; message: string; updatedHoldings: SpotHolding[] }> {
  const holdings = loadSpotHoldings();
  const existingIdx = holdings.findIndex(h => h.symbol === symbol);
  const coinsBought = usdtAmount / price;
  const nowStr = new Date().toLocaleTimeString();

  // If in Real Live Trading mode, submit to Bitget
  if (!config.isPaperTrading) {
    const orderRes = await executeRealBitgetOrder(
      {
        symbol,
        side: 'buy',
        orderType: 'market',
        size: String(usdtAmount),
      },
      config
    );

    if (!orderRes.success) {
      return {
        success: false,
        message: `🚨 ส่งออเดอร์ Bitget ไม่สำเร็จ: ${orderRes.message}`,
        updatedHoldings: holdings,
      };
    }
  }

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

    if (config.isPaperTrading) {
      const curBal = getPaperBalance();
      setPaperBalance(Math.max(0, curBal - usdtAmount));
    }

    const modeTag = config.isPaperTrading ? '[PAPER]' : '🔥[REAL BITGET]';
    return {
      success: true,
      message: `✓ ${modeTag} เข้าซื้อ ${symbol} ไม้ที่ ${newTranches}/${config.maxTranches} @ $${price} (ต้นทุนเฉลี่ยใหม่: $${updated.avgCostPrice})`,
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

    const modeTag = config.isPaperTrading ? '[PAPER]' : '🔥[REAL BITGET]';
    return {
      success: true,
      message: `✓ ${modeTag} เปิดไม้แรก ${symbol} [1/${config.maxTranches}] @ $${price} สำเร็จ`,
      updatedHoldings: holdings,
    };
  }
}

// Core Execution: SELL OR CUT LOSS 100% (Real & Paper)
export async function executeSpotSell(
  symbol: string,
  currentPrice: number,
  isCutLoss = false,
  config?: BitgetConfig
): Promise<{ success: boolean; message: string; realizedPnl: number; updatedHoldings: SpotHolding[] }> {
  const holdings = loadSpotHoldings();
  const idx = holdings.findIndex(h => h.symbol === symbol);
  if (idx === -1) {
    return { success: false, message: `ไม่พบเหรียญ ${symbol} ในพอร์ต`, realizedPnl: 0, updatedHoldings: holdings };
  }

  const h = holdings[idx];

  // If in Real Live Trading mode, submit to Bitget
  if (config && !config.isPaperTrading) {
    // Format precision appropriately (e.g. 4 decimals)
    const sellSize = Number(h.totalAmount).toFixed(4);
    const orderRes = await executeRealBitgetOrder(
      {
        symbol,
        side: 'sell',
        orderType: 'market',
        size: sellSize,
      },
      config
    );

    if (!orderRes.success) {
      return {
        success: false,
        message: `🚨 ขายจริงบน Bitget ไม่สำเร็จ: ${orderRes.message}`,
        realizedPnl: 0,
        updatedHoldings: holdings,
      };
    }
  }

  const totalReturnUsdt = h.totalAmount * currentPrice;
  const realizedPnl = totalReturnUsdt - h.totalInvestedUsdt;
  const pnlPct = ((currentPrice - h.avgCostPrice) / h.avgCostPrice) * 100;

  // Remove from holdings
  holdings.splice(idx, 1);
  saveSpotHoldings(holdings);

  // Return funds to paper balance if paper trading
  if (!config || config.isPaperTrading) {
    const curBal = getPaperBalance();
    setPaperBalance(curBal + totalReturnUsdt);
  }

  // If it's a cut loss, set 3-hour cooldown
  if (isCutLoss) {
    setCooldown(symbol, 3);
  }

  const modeTag = config && !config.isPaperTrading ? '🔥[REAL LIVE] ' : '';
  const pnlSign = realizedPnl >= 0 ? '+' : '';
  const actionText = isCutLoss ? '🚨 CUT LOSS' : '🎯 TAKE PROFIT';
  const msg = `${modeTag}${actionText} ${symbol} @ $${currentPrice}: กำไรสุทธิ ${pnlSign}$${realizedPnl.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%) คืน USDT เรียบร้อยแล้ว`;

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
export async function executeRebalanceRotation(
  exitSymbol: string,
  entrySymbol: string,
  entryPrice: number,
  config: BitgetConfig
): Promise<{ success: boolean; message: string; updatedHoldings: SpotHolding[] }> {
  const sellRes = await executeSpotSell(exitSymbol, 0, false, config);
  const buyRes = await executeSpotBuyTranche(entrySymbol, entryPrice, 500, config);

  const msg = `🔄 REBALANCE ROTATION: ปิดเหรียญนิ่ง ${exitSymbol} เสมอตัว -> ย้ายทุนเข้าโอกาสทอง ${entrySymbol} [1/${config.maxTranches}] @ $${entryPrice} ทันที`;

  return {
    success: buyRes.success,
    message: msg,
    updatedHoldings: buyRes.updatedHoldings,
  };
}

