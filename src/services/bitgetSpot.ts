// Bitget V2 Spot Quantitative Engine & Paper Trading Service
// Built with native Web Crypto API (crypto.subtle) for 100% Edge & Browser compatibility
import { calculateRSI } from './quantEngine';

export const EDGE_BOT_URL = '';

export interface BitgetConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  openrouterApiKey?: string;
  groqApiKey?: string;
  isPaperTrading: boolean;
  autoPilotEnabled: boolean;  // Master Auto-Pilot switch (ON/OFF)
  tranchePercent: number;     // e.g. 20 = 20% of available USDT per tranche
  takeProfitPercent: number; // e.g. 3.0 = +3%
  cutLossPercent: number;     // e.g. 5.0 = -5%
  maxTranches: number;       // e.g. 4
  maxCoins: number;          // e.g. 5
  cashReservePercent: number;// e.g. 30 = 30%
  autoRebalanceEnabled: boolean; // Rebalance weakest holding on Grade A+ opportunities
  liveHoldings?: SpotHolding[];
  screenerMatrix?: any[];
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
  // New Quantitative Multi-Timeframe Strategy Metadata
  targetTimeframe?: "5m" | "15m" | "1h";
  primaryIndicator?: string;
  entryTimestamp?: number;
  maxHoldMinutes?: number;
  trailingSlPrice?: number;
  breakevenLocked?: boolean;
  manualLock?: boolean;
}

export function sanitizeHolding(h: any, livePrice?: number): SpotHolding {
  const symbol = String(h?.symbol || '').toUpperCase();
  const baseCoin = String(h?.baseCoin || symbol.replace('USDT', '') || 'COIN');
  const totalAmount = typeof h?.totalAmount === 'number' && !isNaN(h.totalAmount) ? h.totalAmount : (parseFloat(h?.totalAmount) || 0);
  const avgCostPrice = typeof h?.avgCostPrice === 'number' && !isNaN(h.avgCostPrice) && h.avgCostPrice > 0
    ? h.avgCostPrice
    : (typeof h?.currentPrice === 'number' && !isNaN(h.currentPrice) ? h.currentPrice : (livePrice || 0));
  const currentPrice = typeof livePrice === 'number' && livePrice > 0
    ? livePrice
    : (typeof h?.currentPrice === 'number' && !isNaN(h.currentPrice) && h.currentPrice > 0 ? h.currentPrice : avgCostPrice);
  
  const totalInvestedUsdt = typeof h?.totalInvestedUsdt === 'number' && !isNaN(h.totalInvestedUsdt)
    ? h.totalInvestedUsdt
    : (avgCostPrice * totalAmount);
  
  const unPnl = (currentPrice - avgCostPrice) * totalAmount;
  const unrealizedPnlUsdt = typeof h?.unrealizedPnlUsdt === 'number' && !isNaN(h.unrealizedPnlUsdt)
    ? h.unrealizedPnlUsdt
    : unPnl;

  const pnlPct = avgCostPrice > 0 ? ((currentPrice - avgCostPrice) / avgCostPrice) * 100 : 0;
  const pnlPercent = typeof h?.pnlPercent === 'number' && !isNaN(h.pnlPercent)
    ? h.pnlPercent
    : pnlPct;

  const tpTarget = typeof h?.takeProfitPrice === 'number' && !isNaN(h.takeProfitPrice) && h.takeProfitPrice > 0
    ? h.takeProfitPrice
    : (avgCostPrice * 1.035);

  const slTarget = typeof h?.cutLossPrice === 'number' && !isNaN(h.cutLossPrice) && h.cutLossPrice > 0
    ? h.cutLossPrice
    : (avgCostPrice * 0.95);

  return {
    symbol,
    baseCoin,
    totalAmount,
    tranchesCount: typeof h?.tranchesCount === 'number' && h.tranchesCount > 0 ? h.tranchesCount : 1,
    avgCostPrice: parseFloat(avgCostPrice.toFixed(6)),
    totalInvestedUsdt: parseFloat(totalInvestedUsdt.toFixed(2)),
    currentPrice: parseFloat(currentPrice.toFixed(6)),
    unrealizedPnlUsdt: parseFloat(unrealizedPnlUsdt.toFixed(2)),
    pnlPercent: parseFloat(pnlPercent.toFixed(2)),
    takeProfitPrice: parseFloat(tpTarget.toFixed(6)),
    cutLossPrice: parseFloat(slTarget.toFixed(6)),
    isPaper: Boolean(h?.isPaper),
    history: Array.isArray(h?.history) && h.history.length > 0 ? h.history : [{ price: avgCostPrice, amount: totalAmount, time: 'Entry' }],
    entryTimestamp: typeof h?.entryTimestamp === 'number' && h.entryTimestamp > 0 ? h.entryTimestamp : Date.now(),
    maxHoldMinutes: typeof h?.maxHoldMinutes === 'number' && h.maxHoldMinutes > 0 ? h.maxHoldMinutes : 180,
    targetTimeframe: h?.targetTimeframe || '15m',
    primaryIndicator: h?.primaryIndicator || 'CONFLUENCE_SCORE',
    trailingSlPrice: typeof h?.trailingSlPrice === 'number' ? parseFloat(h.trailingSlPrice.toFixed(6)) : parseFloat(slTarget.toFixed(6)),
    breakevenLocked: Boolean(h?.breakevenLocked),
    manualLock: Boolean(h?.manualLock),
  };
}

export function sanitizeHoldings(holdings: any[], priceMap?: Record<string, number>): SpotHolding[] {
  if (!Array.isArray(holdings)) return [];
  return holdings
    .filter(h => h && (h.symbol || h.baseCoin))
    .map(h => sanitizeHolding(h, priceMap?.[h.symbol]));
}

export const DUST_VALUATION_THRESHOLD = 3.0; // Balances < 3.00 USD are treated as dust to avoid locking active quota

export function filterActiveAndDustHoldings(holdings: SpotHolding[]): { active: SpotHolding[]; dust: SpotHolding[] } {
  if (!Array.isArray(holdings)) return { active: [], dust: [] };
  const active: SpotHolding[] = [];
  const dust: SpotHolding[] = [];
  for (const raw of holdings) {
    if (!raw) continue;
    const h = sanitizeHolding(raw);
    const valuation = (h.totalAmount || 0) * (h.currentPrice || h.avgCostPrice || 0);
    if (valuation >= DUST_VALUATION_THRESHOLD) {
      active.push(h);
    } else {
      dust.push(h);
    }
  }
  return { active, dust };
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
const STORAGE_KEY_PAPER_HOLDINGS = 'bitget_spot_paper_holdings_v2';
const STORAGE_KEY_LIVE_HOLDINGS = 'bitget_spot_live_holdings_v2';
const STORAGE_KEY_COOLDOWN = 'bitget_spot_cooldown_v1';
const STORAGE_KEY_PAPER_BALANCE = 'bitget_spot_paper_balance_v1';

export function loadBitgetConfig(): BitgetConfig {
  const defaults: BitgetConfig = {
    apiKey: '',
    secretKey: '',
    passphrase: '',
    openrouterApiKey: '',
    groqApiKey: '',
    isPaperTrading: true, // Default to PAPER TRADING for safety across all devices
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
    // Asynchronously sync to Cloudflare Pages so mobile and other devices get it immediately
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    }).catch(() => {});
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
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperBalance: amt }),
    }).catch(() => {});
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
    const REAL_R_CRYPTO = ['RENDERUSDT', 'ROSEUSDT', 'RUNEUSDT', 'RAYUSDT', 'REQUSDT'];

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

// Fetch Bitget Spot Candles with In-Memory Cache and Rate-Limit Protection
const candleCache: Record<string, { candles: any[]; timestamp: number }> = {};
const pendingCandleRequests: Record<string, Promise<any[]>> = {};

export async function fetchBitgetSpotCandles(
  symbol: string,
  granularity = '15min',
  limit = 100
): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>> {
  const cacheKey = `${symbol}_${granularity}_${limit}`;
  const now = Date.now();

  // 1. Return fresh cache if available (TTL: 30s)
  const cached = candleCache[cacheKey];
  if (cached && now - cached.timestamp < 30000) {
    return cached.candles;
  }

  // 2. Coalesce concurrent requests for identical candle parameters
  if (pendingCandleRequests[cacheKey]) {
    return pendingCandleRequests[cacheKey];
  }

  const fetchPromise = (async () => {
    try {
      const directUrl = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${symbol}&granularity=${granularity}&limit=${limit}`;
      let res = await fetch(directUrl);

      // If rate-limited (HTTP 429), try falling back to Pages proxy
      if (res.status === 429) {
        if (cached?.candles?.length) {
          return cached.candles; // Use stale cache on 429
        }
        try {
          const proxyUrl = `/api/bitget?action=candles&symbol=${symbol}&granularity=${granularity}&limit=${limit}`;
          const proxyRes = await fetch(proxyUrl);
          if (proxyRes.ok) {
            res = proxyRes;
          }
        } catch {}
      }

      if (!res.ok) {
        if (cached?.candles?.length) return cached.candles;
        return [];
      }

      const json = await res.json();
      if (json.code !== '00000' || !Array.isArray(json.data)) {
        if (cached?.candles?.length) return cached.candles;
        return [];
      }

      // [ts, open, high, low, close, baseVol, quoteVol, usdtVol]
      const candles = [...json.data]
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(item => ({
          time: Math.floor(parseInt(item[0]) / 1000),
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
          volume: parseFloat(item[7] || item[5]),
        }));

      candleCache[cacheKey] = { candles, timestamp: Date.now() };
      return candles;
    } catch (e) {
      if (cached?.candles?.length) return cached.candles;
      return [];
    } finally {
      delete pendingCandleRequests[cacheKey];
    }
  })();

  pendingCandleRequests[cacheKey] = fetchPromise;
  return fetchPromise;
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
  } catch {}
  return cached?.rsi ?? 50;
}

export async function fetchBatchRealRsi(symbols: string[]): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  // Batch in smaller chunks of 3 with slight throttle to prevent HTTP 429
  const chunkSize = 3;
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    if (i > 0) {
      await new Promise(r => setTimeout(r, 120));
    }
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
  isCoolingDown?: boolean;
  limitedAt?: string;
  resumeAt?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
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
    if (config?.groqApiKey) {
      headers['x-groq-key'] = config.groqApiKey;
    }
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

// Calculate Tranche Budget based on available cash (Dynamic with Bitget Spot min $5 USDT)
export function calculateTrancheBudget(availableUsdt: number, tranchePercent = 20): number {
  if (availableUsdt < 5) return 0;
  const safeUsdt = Math.max(0, Math.floor((availableUsdt - 0.05) * 100) / 100);
  const calculated = (safeUsdt * (tranchePercent || 20)) / 100;
  const target = Math.max(5, parseFloat(calculated.toFixed(2)));
  return Math.min(target, safeUsdt);
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

export interface SyncedCloudData extends Partial<BitgetConfig> {
  paperBalance?: number;
  holdings?: SpotHolding[];
  liveHoldings?: SpotHolding[];
  quantLogs?: Array<{ id: string; time: string; timestamp?: number; action: string; symbol: string; note: string; color: string }>;
  liveLogs?: Array<{ id: string; time: string; timestamp?: number; action: string; symbol: string; note: string; color: string }>;
  liveQuantLogs?: Array<{ id: string; time: string; timestamp?: number; action: string; symbol: string; note: string; color: string }>;
  screenerMatrix?: any[];
}

// Cloudflare Pages Config & Secret Sync across Mobile & Desktop
export async function syncBitgetConfigFromCloudflare(): Promise<SyncedCloudData | null> {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const json = await res.json();
      if (json.code === '00000' && json.data) {
        return json.data as SyncedCloudData;
      }
    }
  } catch {}

  // Fallback to legacy action if /api/config unavailable
  try {
    const res = await fetch('/api/bitget?action=sync-config');
    if (res.ok) {
      const json = await res.json();
      if (json.code === '00000' && json.data?.hasCredentials) {
        return json.data;
      }
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
  // Ensure credentials are synced
  let activeConfig = config;
  if (!activeConfig?.apiKey || !activeConfig?.secretKey) {
    const synced = await syncBitgetConfigFromCloudflare();
    if (synced && synced.apiKey) {
      activeConfig = { ...(config || loadBitgetConfig()), ...synced };
      saveBitgetConfig(activeConfig as BitgetConfig);
    }
  }

  // 1. First priority: 24/7 Cloud Trade Dispatcher (Runs on Microsoft Azure Cloud runner, zero local PC required)
  try {
    const cloudRes = await fetch('/api/cloud-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: order.side,
        symbol: order.symbol,
        amount: order.size,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (cloudRes.ok) {
      const cJson = await cloudRes.json();
      if (cJson.success) {
        return {
          success: true,
          data: { orderId: `cloud_${Date.now()}` },
          message: cJson.message,
        };
      }
    }
  } catch (cloudErr) {
    console.warn('Cloud trade dispatcher failed, checking alternatives:', cloudErr);
  }

  // 2. Second priority: AutoTD Local Bridge (If user runs local bridge on host machine)
  try {
    const bridgeRes = await fetch('http://127.0.0.1:8787/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: activeConfig?.apiKey,
        secretKey: activeConfig?.secretKey,
        passphrase: activeConfig?.passphrase,
        order,
      }),
      signal: AbortSignal.timeout(1500),
    });
    if (bridgeRes.ok) {
      const bJson = await bridgeRes.json();
      if (bJson.code === '00000') {
        return {
          success: true,
          data: bJson.data,
          message: `✓ [Bitget Spot Bridge] ส่งคำสั่งสำเร็จ: orderId=${bJson.data?.orderId || 'ok'}`,
        };
      } else if (bJson.code === '43012') {
        return {
          success: false,
          message: `🚨 ยอดเหรียญ/เงินในกระเป๋า Spot ไม่เพียงพอ (Bitget 43012: Insufficient balance)`,
        };
      } else if (bJson.code) {
        return {
          success: false,
          message: `Bitget API (${bJson.code}): ${bJson.msg || 'Order failed'}`,
        };
      }
    }
  } catch {}

  // 3. Priority in Browser: Cloudflare Pages Proxy Endpoint (Avoids CORS preflight failures on custom headers)
  const isBrowserEnv = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  if (isBrowserEnv) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (activeConfig?.apiKey) headers['x-bitget-key'] = activeConfig.apiKey;
      if (activeConfig?.secretKey) headers['x-bitget-secret'] = activeConfig.secretKey;
      if (activeConfig?.passphrase) headers['x-bitget-passphrase'] = activeConfig.passphrase;

      const res = await fetch('/api/bitget', {
        method: 'POST',
        headers,
        body: JSON.stringify(order),
      });
      const json = await res.json();
      if (res.ok && json.code === '00000') {
        return {
          success: true,
          data: json.data,
          message: `✓ [Bitget Spot Proxy] ส่งคำสั่งสำเร็จ: orderId=${json.data?.orderId || 'ok'}`,
        };
      } else if (json.code === '43012') {
        return {
          success: false,
          message: `🚨 ยอดเงิน USDT ในกระเป๋า Spot ไม่เพียงพอ (Bitget Error 43012: Insufficient balance)`,
        };
      } else if (json.code) {
        return {
          success: false,
          message: `Bitget API (${json.code}): ${json.msg || 'Order failed'}`,
        };
      }
    } catch {}
  }

  // 4. Fallback: Direct WebCrypto request (for desktop/Node/Electron where cross-origin CORS is not enforced)
  if (!isBrowserEnv && activeConfig?.apiKey && activeConfig?.secretKey && activeConfig?.passphrase) {
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
      if (order.price) {
        payload.price = String(order.price);
        payload.force = 'gtc';
      }
      const bodyStr = JSON.stringify(payload);
      const sign = await signBitgetRequest(timestamp, 'POST', requestPath, '', bodyStr, activeConfig.secretKey);

      const directRes = await fetch(`https://api.bitget.com${requestPath}`, {
        method: 'POST',
        headers: {
          'ACCESS-KEY': activeConfig.apiKey,
          'ACCESS-SIGN': sign,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-PASSPHRASE': activeConfig.passphrase,
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
      } else if (directJson.code === '43012') {
        return {
          success: false,
          message: `🚨 ยอดเงิน USDT ในกระเป๋า Spot ไม่เพียงพอ (Bitget Error 43012: Insufficient balance)`,
        };
      } else if (directJson.code) {
        return {
          success: false,
          message: `Bitget API (${directJson.code}): ${directJson.msg || 'Order failed'}`,
        };
      }
    } catch (directErr) {
      console.warn('Direct Bitget call failed:', directErr);
    }
  }

  return {
    success: false,
    message: 'ไม่สามารถส่งคำสั่งได้: กรุณาตรวจสอบการตั้งค่า Bitget API หรือเครือข่าย',
  };
}

// Browser WebSocket Asset Fetcher (Bypasses Cloudflare WAF & CORS via AWS CloudFront endpoint)
export async function fetchRealBitgetAssetsViaWebSocket(config: BitgetConfig): Promise<{
  usdtAvailable: number;
  assets: Array<{ coin: string; available: number; frozen: number }>;
} | null> {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return null;
  if (!config.apiKey || !config.secretKey || !config.passphrase) return null;

  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket | null = null;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws?.close(); } catch {}
        resolve(null);
      }
    }, 5000);

    try {
      ws = new WebSocket('wss://ws.bitget.com/v2/ws/private');

      ws.onopen = async () => {
        try {
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const sign = await signBitgetRequest(timestamp, 'GET', '/user/verify', '', '', config.secretKey);
          ws?.send(
            JSON.stringify({
              op: 'login',
              args: [
                {
                  apiKey: config.apiKey,
                  passphrase: config.passphrase,
                  timestamp,
                  sign,
                },
              ],
            })
          );
        } catch {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            try { ws?.close(); } catch {}
            resolve(null);
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'login' && msg.code === 0) {
            ws?.send(
              JSON.stringify({
                op: 'subscribe',
                args: [{ instType: 'SPOT', channel: 'account', coin: 'default' }],
              })
            );
          } else if (msg.action === 'snapshot' && Array.isArray(msg.data)) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try { ws?.close(); } catch {}

              let usdtAvailable = 0;
              const assets: Array<{ coin: string; available: number; frozen: number }> = [];

              for (const item of msg.data) {
                const coin = item.coin || '';
                const avail = parseFloat(item.available || '0');
                const frozen = parseFloat(item.frozen || '0');
                if (coin === 'USDT') usdtAvailable = avail;
                if (avail > 0 || frozen > 0) {
                  assets.push({ coin, available: avail, frozen });
                }
              }

              resolve({ usdtAvailable, assets });
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          try { ws?.close(); } catch {}
          resolve(null);
        }
      };
    } catch {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(null);
      }
    }
  });
}

export async function fetchRealBitgetAssets(config?: BitgetConfig): Promise<{
  usdtAvailable: number;
  assets: Array<{ coin: string; available: number; frozen: number }>;
} | null> {
  // Ensure credentials are synced
  let activeConfig = config;
  if (!activeConfig?.apiKey || !activeConfig?.secretKey) {
    const synced = await syncBitgetConfigFromCloudflare();
    if (synced && synced.apiKey) {
      activeConfig = { ...(config || loadBitgetConfig()), ...synced };
      saveBitgetConfig(activeConfig as BitgetConfig);
    }
  }

  // 1. First priority: High-speed WebSocket connection (AWS CloudFront, No CORS, No Cloudflare WAF block)
  if (activeConfig?.apiKey && activeConfig?.secretKey && activeConfig?.passphrase) {
    try {
      const wsResult = await fetchRealBitgetAssetsViaWebSocket(activeConfig);
      if (wsResult && Array.isArray(wsResult.assets)) {
        return wsResult;
      }
    } catch (wsErr) {
      console.warn('WebSocket assets fetch failed, falling back to direct REST:', wsErr);
    }
  }

  // 2. Second priority in Browser: Cloudflare Pages Proxy Endpoint (Safe from browser CORS preflight blocks)
  const isBrowserEnv = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  if (isBrowserEnv) {
    try {
      const headers: Record<string, string> = {};
      if (activeConfig?.apiKey) headers['x-bitget-key'] = activeConfig.apiKey;
      if (activeConfig?.secretKey) headers['x-bitget-secret'] = activeConfig.secretKey;
      if (activeConfig?.passphrase) headers['x-bitget-passphrase'] = activeConfig.passphrase;

      const res = await fetch('/api/bitget?action=assets', { headers });
      if (res.ok) {
        const json = await res.json();
        if (json.code === '00000' && Array.isArray(json.data)) {
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
        }
      }
    } catch {}
  }

  // 3. Fallback: Direct WebCrypto request (for desktop/Node/Electron)
  if (!isBrowserEnv && activeConfig?.apiKey && activeConfig?.secretKey && activeConfig?.passphrase) {
    try {
      const timestamp = Date.now().toString();
      const requestPath = '/api/v2/spot/account/assets';
      const sign = await signBitgetRequest(timestamp, 'GET', requestPath, '', '', activeConfig.secretKey);

      const directRes = await fetch(`https://api.bitget.com${requestPath}`, {
        headers: {
          'ACCESS-KEY': activeConfig.apiKey,
          'ACCESS-SIGN': sign,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-PASSPHRASE': activeConfig.passphrase,
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
      console.warn('Direct assets fetch failed:', err);
    }
  }

  return null;
}

// Fetch and map genuine Bitget Spot wallet assets to SpotHolding objects with live valuation
export async function fetchRealBitgetHoldings(
  config?: BitgetConfig,
  priceMap?: Record<string, number>
): Promise<{
  usdtAvailable: number;
  totalUsdValue: number;
  holdings: SpotHolding[];
}> {
  const assetsRes = await fetchRealBitgetAssets(config);
  if (!assetsRes) {
    return { usdtAvailable: 0, totalUsdValue: 0, holdings: [] };
  }

  const { usdtAvailable, assets } = assetsRes;
  let totalUsd = usdtAvailable;
  const realHoldings: SpotHolding[] = [];

  // Fetch full market tickers to get prices for all user coins (e.g. MOODENG, NS, BGB)
  let fullPriceMap: Record<string, number> = { ...(priceMap || {}) };
  try {
    const tRes = await fetch('https://api.bitget.com/api/v2/spot/market/tickers');
    if (tRes.ok) {
      const tJson = await tRes.json();
      if (tJson.code === '00000' && Array.isArray(tJson.data)) {
        for (const t of tJson.data) {
          if (t.symbol && t.lastPr) {
            fullPriceMap[t.symbol] = parseFloat(t.lastPr);
          }
        }
      }
    }
  } catch {}

  const localLive = loadSpotHoldings(false);
  const costMap: Record<string, { 
    avgCostPrice: number; 
    tranchesCount: number; 
    history: any[];
    entryTimestamp?: number;
    maxHoldMinutes?: number;
    targetTimeframe?: "5m" | "15m" | "1h";
    primaryIndicator?: string;
    trailingSlPrice?: number;
    breakevenLocked?: boolean;
    manualLock?: boolean;
  }> = {};

  // 1. Merge metadata from config.liveHoldings (from Cloudflare D1) first
  if (Array.isArray(config?.liveHoldings)) {
    for (const h of config.liveHoldings) {
      if (h.symbol) {
        costMap[h.symbol] = {
          avgCostPrice: h.avgCostPrice,
          tranchesCount: h.tranchesCount || 1,
          history: h.history || [],
          entryTimestamp: h.entryTimestamp,
          maxHoldMinutes: h.maxHoldMinutes,
          targetTimeframe: h.targetTimeframe,
          primaryIndicator: h.primaryIndicator,
          trailingSlPrice: h.trailingSlPrice,
          breakevenLocked: h.breakevenLocked,
          manualLock: h.manualLock,
        };
      }
    }
  }

  // 2. Next merge from localLive
  for (const h of localLive) {
    if (h.symbol && h.avgCostPrice > 0) {
      costMap[h.symbol] = {
        ...costMap[h.symbol],
        avgCostPrice: h.avgCostPrice,
        tranchesCount: h.tranchesCount || costMap[h.symbol]?.tranchesCount || 1,
        history: h.history?.length ? h.history : costMap[h.symbol]?.history || [],
        entryTimestamp: h.entryTimestamp || costMap[h.symbol]?.entryTimestamp,
        maxHoldMinutes: h.maxHoldMinutes || costMap[h.symbol]?.maxHoldMinutes,
        targetTimeframe: h.targetTimeframe || costMap[h.symbol]?.targetTimeframe,
        primaryIndicator: h.primaryIndicator || costMap[h.symbol]?.primaryIndicator,
        trailingSlPrice: h.trailingSlPrice || costMap[h.symbol]?.trailingSlPrice,
        breakevenLocked: h.breakevenLocked ?? costMap[h.symbol]?.breakevenLocked,
        manualLock: h.manualLock ?? costMap[h.symbol]?.manualLock,
      };
    }
  }

  for (const a of assets) {
    if (a.coin === 'USDT') continue;
    const sym = `${a.coin}USDT`;
    const price = fullPriceMap[sym] || 0;
    const val = a.available * price;
    totalUsd += val;

    // Include real assets with value >= $0.10 USD
    if (val >= 0.10) {
      let avgCost = costMap[sym]?.avgCostPrice || 0;
      let tranchesCount = costMap[sym]?.tranchesCount || 1;
      let history = costMap[sym]?.history || [];
      const meta = costMap[sym];

      // If avgCost is missing or matches market price exactly, fetch real filled buy order from Bitget!
      if ((avgCost <= 0 || avgCost === price) && config?.apiKey) {
        try {
          const orders = await fetchRealBitgetOrderHistory(config, sym);
          const buyOrders = orders.filter(o => o.side.toLowerCase() === 'buy' && (o.status === 'filled' || o.status === 'partially_filled'));
          if (buyOrders.length > 0) {
            const lastBuy = buyOrders[0];
            const p = parseFloat(lastBuy.priceAvg || lastBuy.price || '0');
            if (p > 0) {
              avgCost = p;
              history = [{ price: p, amount: a.available, time: lastBuy.cTime ? new Date(Number(lastBuy.cTime)).toLocaleTimeString('th-TH') : 'Bitget Spot' }];
            }
          }
        } catch {}
      }

      if (avgCost <= 0) {
        avgCost = price;
      }

      const totalInvested = a.available * avgCost;
      const unPnl = (price - avgCost) * a.available;
      const pnlPct = avgCost > 0 ? ((price - avgCost) / avgCost) * 100 : 0;
      const tpTarget = config?.takeProfitPercent || 3.5;
      const slTarget = config?.cutLossPercent || 5.0;

      // Match with live Quant Screener Matrix to discover the real distinct technical indicator & timeframe
      const matrixItem = Array.isArray(config?.screenerMatrix)
        ? config.screenerMatrix.find((m: any) => m.symbol === sym)
        : null;

      const targetTimeframe: "5m" | "15m" | "1h" = meta?.targetTimeframe || 
        (matrixItem?.bestTf as "5m" | "15m" | "1h") || 
        (sym.includes('BTC') ? '1h' : sym.includes('SOL') ? '15m' : '5m');

      const primaryIndicator = (meta?.primaryIndicator && meta.primaryIndicator !== 'CONFLUENCE_SCORE' && meta.primaryIndicator !== 'Multi-Indicator')
        ? meta.primaryIndicator
        : (matrixItem?.primaryIndicator && matrixItem.primaryIndicator !== 'NEUTRAL'
            ? matrixItem.primaryIndicator
            : (sym.includes('BTC') ? 'TREND_ALIGNMENT' : sym.includes('SOL') ? 'BOLL_RSI_DIP' : sym.includes('ZEC') ? 'BOLLINGER_LOWER_BOUNCE' : 'RSI_OVERSOLD'));

      const defaultHoldMinutes = targetTimeframe === '5m' ? 90 : targetTimeframe === '1h' ? 360 : 180;
      const maxHoldMinutes = meta?.maxHoldMinutes || defaultHoldMinutes;

      const entryTimestamp = meta?.entryTimestamp && meta.entryTimestamp > 0
        ? meta.entryTimestamp
        : Date.now();

      realHoldings.push({
        symbol: sym,
        baseCoin: a.coin,
        totalAmount: a.available,
        tranchesCount,
        avgCostPrice: parseFloat(avgCost.toFixed(4)),
        totalInvestedUsdt: parseFloat(totalInvested.toFixed(2)),
        currentPrice: price,
        unrealizedPnlUsdt: parseFloat(unPnl.toFixed(2)),
        pnlPercent: parseFloat(pnlPct.toFixed(2)),
        takeProfitPrice: parseFloat((avgCost * (1 + tpTarget / 100)).toFixed(4)),
        cutLossPrice: parseFloat((avgCost * (1 - slTarget / 100)).toFixed(4)),
        isPaper: false,
        history: history.length > 0 ? history : [{ price: avgCost, amount: a.available, time: 'Bitget Spot' }],
        entryTimestamp,
        maxHoldMinutes,
        targetTimeframe,
        primaryIndicator,
        trailingSlPrice: meta?.trailingSlPrice,
        breakevenLocked: meta?.breakevenLocked,
        manualLock: meta?.manualLock,
      });
    }
  }

  // Persist liveHoldings with true average costs to local storage & Cloudflare D1
  if (typeof window !== 'undefined' && realHoldings.length > 0) {
    saveSpotHoldings(realHoldings, false);
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liveHoldings: realHoldings }),
    }).catch(() => {});
  }

  return {
    usdtAvailable,
    totalUsdValue: totalUsd,
    holdings: realHoldings,
  };
}

export interface BitgetHistoryOrder {
  orderId: string;
  clientOid?: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: string;
  priceAvg?: string;
  price?: string;
  size: string;
  baseVolume?: string;
  quoteVolume?: string;
  status: 'init' | 'new' | 'partially_filled' | 'filled' | 'cancelled';
  cTime: string | number;
  uTime?: string | number;
}

export async function fetchRealBitgetOrderHistory(
  config?: BitgetConfig,
  symbol?: string
): Promise<BitgetHistoryOrder[]> {
  let activeConfig = config;
  if (!activeConfig?.apiKey || !activeConfig?.secretKey) {
    const synced = await syncBitgetConfigFromCloudflare();
    if (synced && synced.apiKey) {
      activeConfig = { ...(config || loadBitgetConfig()), ...synced };
      saveBitgetConfig(activeConfig as BitgetConfig);
    }
  }

  const queryParams = symbol ? `symbol=${symbol}&limit=50` : 'limit=50';
  const isBrowserEnv = typeof window !== 'undefined' && typeof window.document !== 'undefined';

  // 1. Primary in Browser: Cloudflare Pages Proxy (Zero CORS preflight error)
  if (isBrowserEnv) {
    try {
      const headers: Record<string, string> = {};
      if (activeConfig?.apiKey) headers['x-bitget-key'] = activeConfig.apiKey;
      if (activeConfig?.secretKey) headers['x-bitget-secret'] = activeConfig.secretKey;
      if (activeConfig?.passphrase) headers['x-bitget-passphrase'] = activeConfig.passphrase;

      const proxyUrl = `/api/bitget?action=history${symbol ? `&symbol=${symbol}` : ''}&limit=50`;
      const res = await fetch(proxyUrl, { headers });
      if (res.ok) {
        const json = await res.json();
        if (json.code === '00000' && Array.isArray(json.data)) {
          return json.data;
        }
      }
    } catch {}
  }

  // 2. Fallback: Direct WebCrypto request (for desktop/Node/Electron where cross-origin CORS is not enforced)
  if (!isBrowserEnv && activeConfig?.apiKey && activeConfig?.secretKey && activeConfig?.passphrase) {
    try {
      const timestamp = Date.now().toString();
      const requestPath = '/api/v2/spot/trade/history-orders';
      const sign = await signBitgetRequest(
        timestamp,
        'GET',
        requestPath,
        queryParams,
        '',
        activeConfig.secretKey
      );

      const directRes = await fetch(`https://api.bitget.com${requestPath}?${queryParams}`, {
        headers: {
          'ACCESS-KEY': activeConfig.apiKey,
          'ACCESS-SIGN': sign,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-PASSPHRASE': activeConfig.passphrase,
          'Content-Type': 'application/json',
          locale: 'en-US',
        },
      });

      const directJson = await directRes.json();
      if (directJson.code === '00000' && Array.isArray(directJson.data)) {
        return directJson.data;
      }
    } catch (err) {
      console.warn('Direct order history fetch failed:', err);
    }
  }

  return [];
}

// Load Spot Holdings (Separated by Paper vs Live mode)
export function loadSpotHoldings(isPaper = true): SpotHolding[] {
  if (typeof window === 'undefined') return [];
  const key = isPaper ? STORAGE_KEY_PAPER_HOLDINGS : STORAGE_KEY_LIVE_HOLDINGS;
  let saved = localStorage.getItem(key);
  if (!saved && isPaper) {
    saved = localStorage.getItem(STORAGE_KEY_HOLDINGS);
  }
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        if (!isPaper) {
          // Strictly filter out paper-simulated mock holdings from Live mode
          const realOnly = parsed.filter(
            (h: any) =>
              h &&
              h.isPaper !== true &&
              !['ZECUSDT', 'XLMUSDT', 'ONDOUSDT'].includes(h.symbol)
          );
          return sanitizeHoldings(realOnly);
        }
        return sanitizeHoldings(parsed);
      }
    } catch {}
  }
  return [];
}

export function saveSpotHoldings(holdings: SpotHolding[], isPaper = true) {
  if (typeof window !== 'undefined') {
    const key = isPaper ? STORAGE_KEY_PAPER_HOLDINGS : STORAGE_KEY_LIVE_HOLDINGS;
    localStorage.setItem(key, JSON.stringify(holdings));
    if (isPaper) {
      localStorage.setItem(STORAGE_KEY_HOLDINGS, JSON.stringify(holdings));
    }
  }
}

// Core Execution: BUY TRANCHE (DCA Average Cost Engine - Real & Paper)
export async function executeSpotBuyTranche(
  symbol: string,
  price: number,
  usdtAmount: number,
  config: BitgetConfig,
  strategyParams?: { targetTimeframe?: "5m" | "15m" | "1h"; primaryIndicator?: string; maxHoldMinutes?: number }
): Promise<{ success: boolean; message: string; updatedHoldings: SpotHolding[] }> {
  const isPaper = config.isPaperTrading ?? true;
  const holdings = loadSpotHoldings(isPaper);
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
    saveSpotHoldings(holdings, isPaper);

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
    const tf = strategyParams?.targetTimeframe || '15m';
    const indicator = strategyParams?.primaryIndicator || 'CONFLUENCE_SCORE';
    const holdMins = strategyParams?.maxHoldMinutes || (tf === '5m' ? 90 : tf === '1h' ? 360 : 180);

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
      targetTimeframe: tf,
      primaryIndicator: indicator,
      entryTimestamp: Date.now(),
      maxHoldMinutes: holdMins,
      breakevenLocked: false,
      manualLock: false,
    };

    holdings.push(newHolding);
    saveSpotHoldings(holdings, isPaper);

    if (config.isPaperTrading) {
      const curBal = getPaperBalance();
      setPaperBalance(Math.max(0, curBal - usdtAmount));
    }

    // Set 12-minute cooldown to prevent rapid loop buying
    setCooldown(symbol, 0.2);

    const modeTag = config.isPaperTrading ? '[PAPER]' : '🔥[REAL BITGET]';
    return {
      success: true,
      message: `✓ ${modeTag} เปิดไม้แรก ${symbol} [1/${config.maxTranches}] @ $${price} สำเร็จ`,
      updatedHoldings: holdings,
    };
  }
}

const BITGET_QTY_PRECISION_MAP: Record<string, number> = {
  BTCUSDT: 6,
  ETHUSDT: 4,
  SOLUSDT: 4,
  TAOUSDT: 3,
  ZECUSDT: 3,
  XRPUSDT: 4,
  DOGEUSDT: 4,
  ADAUSDT: 3,
  NEARUSDT: 2,
  SUIUSDT: 2,
  BGBUSDT: 4,
  AVAXUSDT: 3,
  LINKUSDT: 3,
  DOTUSDT: 2,
  BNBUSDT: 3,
};

export function getCoinPrecision(symbol: string): number {
  if (BITGET_QTY_PRECISION_MAP[symbol]) return BITGET_QTY_PRECISION_MAP[symbol];
  if (symbol.includes('BTC')) return 6;
  if (symbol.includes('ETH') || symbol.includes('SOL')) return 4;
  if (symbol.includes('TAO') || symbol.includes('ZEC') || symbol.includes('BNB')) return 3;
  if (symbol.includes('BGB') || symbol.includes('XRP') || symbol.includes('DOGE')) return 4;
  return 2;
}

export function formatCoinAmount(amount: number, symbol: string): string {
  let precision = getCoinPrecision(symbol);
  let factor = Math.pow(10, precision);
  let truncated = Math.floor(amount * factor) / factor;

  // Safety guard: If amount > 0 but precision truncated it to 0 (e.g. holding 0.0059 of a high-value coin),
  // dynamically increase precision up to 6 so sell order is never 0.00
  if (amount > 0 && truncated === 0) {
    for (let p = precision + 1; p <= 6; p++) {
      const f = Math.pow(10, p);
      const t = Math.floor(amount * f) / f;
      if (t > 0) {
        precision = p;
        factor = f;
        truncated = t;
        break;
      }
    }
  }

  return truncated.toFixed(precision);
}

// Core Execution: SELL OR CUT LOSS 100% (Real & Paper)
export async function executeSpotSell(
  symbol: string,
  currentPrice: number,
  isCutLoss = false,
  config?: BitgetConfig,
  currentHoldings?: SpotHolding[]
): Promise<{ success: boolean; message: string; realizedPnl: number; updatedHoldings: SpotHolding[] }> {
  const isPaper = config ? (config.isPaperTrading ?? true) : true;
  let holdings = loadSpotHoldings(isPaper);
  let idx = holdings.findIndex(h => h.symbol === symbol);

  // Fallback to active holdings in memory if localStorage hasn't synced yet
  if (idx === -1 && Array.isArray(currentHoldings) && currentHoldings.length > 0) {
    holdings = [...currentHoldings];
    idx = holdings.findIndex(h => h.symbol === symbol);
  }

  // Fallback to opposite trading mode list if needed
  if (idx === -1) {
    const altHoldings = loadSpotHoldings(!isPaper);
    const altIdx = altHoldings.findIndex(h => h.symbol === symbol);
    if (altIdx >= 0) {
      holdings = altHoldings;
      idx = altIdx;
    }
  }

  if (idx === -1) {
    return { success: false, message: `ไม่พบเหรียญ ${symbol} ในพอร์ต`, realizedPnl: 0, updatedHoldings: holdings };
  }

  const h = holdings[idx];

  // If in Real Live Trading mode, submit to Bitget
  if (config && !config.isPaperTrading) {
    // Format precision dynamically with truncation and safety guard
    const sellSize = formatCoinAmount(h.totalAmount, symbol);
    if (parseFloat(sellSize) <= 0) {
      return {
        success: false,
        message: `🚨 จำนวนเหรียญ ${symbol} น้อยเกินไป (${h.totalAmount}) ไม่สามารถส่งคำสั่งขายได้`,
        realizedPnl: 0,
        updatedHoldings: holdings,
      };
    }

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

  // Use live price if passed, otherwise fall back to holding currentPrice or avgCostPrice
  const effectivePrice = currentPrice > 0 ? currentPrice : (h.currentPrice > 0 ? h.currentPrice : h.avgCostPrice);
  const totalReturnUsdt = h.totalAmount * effectivePrice;
  const realizedPnl = totalReturnUsdt - h.totalInvestedUsdt;
  const pnlPct = h.avgCostPrice > 0 ? ((effectivePrice - h.avgCostPrice) / h.avgCostPrice) * 100 : 0;

  // Remove from holdings
  holdings.splice(idx, 1);
  saveSpotHoldings(holdings, isPaper);

  // Sync removal to Cloudflare D1 immediately
  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      [isPaper ? 'holdings' : 'liveHoldings']: holdings,
    }),
  }).catch(() => {});

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
  const msg = `${modeTag}${actionText} ${symbol} @ $${effectivePrice}: กำไรสุทธิ ${pnlSign}$${realizedPnl.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%) คืน USDT เรียบร้อยแล้ว`;

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
  if (!Array.isArray(holdings)) return [];
  return holdings.map(raw => {
    const h = sanitizeHolding(raw);
    const live = priceMap?.[h.symbol] ?? (h.currentPrice > 0 ? h.currentPrice : h.avgCostPrice);
    const avg = h.avgCostPrice > 0 ? h.avgCostPrice : live;
    const amount = h.totalAmount || 0;
    const unPnl = (live - avg) * amount;
    const pnlPct = avg > 0 ? ((live - avg) / avg) * 100 : 0;
    return {
      ...h,
      currentPrice: parseFloat(live.toFixed(6)),
      totalInvestedUsdt: parseFloat((h.totalInvestedUsdt || (avg * amount)).toFixed(2)),
      unrealizedPnlUsdt: parseFloat(unPnl.toFixed(2)),
      pnlPercent: parseFloat(pnlPct.toFixed(2)),
    };
  });
}

// Identify Weakest Holding (Dead Capital / Stagnant sideways asset)
export function findWeakestHolding(holdings: SpotHolding[]): SpotHolding | null {
  if (!Array.isArray(holdings) || holdings.length === 0) return null;
  // Prioritize position with PnL closest to 0% (stagnant/sideways) and lowest profit
  const sorted = [...holdings].sort((a, b) => {
    const aAbs = Math.abs(a?.pnlPercent ?? 0);
    const bAbs = Math.abs(b?.pnlPercent ?? 0);
    return aAbs - bAbs;
  });
  return sorted[0] || null;
}

// Execute Rebalance Rotation (Sell weakest position, buy Grade A+ opportunity)
export async function executeRebalanceRotation(
  exitSymbol: string,
  entrySymbol: string,
  entryPrice: number,
  config: BitgetConfig
): Promise<{ success: boolean; message: string; updatedHoldings: SpotHolding[] }> {
  const isPaper = config ? (config.isPaperTrading ?? true) : true;
  const holdings = loadSpotHoldings(isPaper);
  const exitHolding = holdings.find(h => h.symbol === exitSymbol);
  const exitPrice = exitHolding?.currentPrice && exitHolding.currentPrice > 0 ? exitHolding.currentPrice : (exitHolding?.avgCostPrice || 0);

  // 1. Sell the exit symbol first
  const sellRes = await executeSpotSell(exitSymbol, exitPrice, false, config);
  if (!sellRes.success) {
    return {
      success: false,
      message: `🚨 Rebalance ไม่สำเร็จ (ขาย ${exitSymbol} ไม่ได้): ${sellRes.message}`,
      updatedHoldings: holdings,
    };
  }

  // 2. In Live mode, wait 1.2s for Bitget wallet balance settlement
  if (!isPaper) {
    await new Promise(r => setTimeout(r, 1200));
  }

  // 3. Buy the new opportunity
  const buyRes = await executeSpotBuyTranche(entrySymbol, entryPrice, 500, config);

  const msg = `🔄 REBALANCE ROTATION: ปิดเหรียญ ${exitSymbol} เรียบร้อย -> ย้ายเงินทุนเข้าซื้อ ${entrySymbol} [1/${config.maxTranches}] @ $${entryPrice} สำเร็จ`;

  return {
    success: buyRes.success,
    message: buyRes.success ? msg : `ปิดเหรียญ ${exitSymbol} แล้ว แต่ซื้อ ${entrySymbol} ไม่สำเร็จ: ${buyRes.message}`,
    updatedHoldings: buyRes.updatedHoldings,
  };
}

// ==========================================
// BGB DUST CONVERT HELPERS
// ==========================================
export async function fetchBgbConvertibleCoins(config?: BitgetConfig): Promise<{ coin: string; available: string; bgbEstAmount: string }[]> {
  const activeConfig = config || loadBitgetConfig();
  const headers: Record<string, string> = {
    'x-bitget-key': activeConfig.apiKey || '',
    'x-bitget-secret': activeConfig.secretKey || '',
    'x-bitget-passphrase': activeConfig.passphrase || '',
  };

  try {
    const res = await fetch('/api/bitget?action=bgb-convert-list', { headers });
    if (res.ok) {
      const data = await res.json();
      if (data.code === '00000' && Array.isArray(data.data?.coinList)) {
        return data.data.coinList;
      }
    }
  } catch (err) {
    console.warn('fetchBgbConvertibleCoins error:', err);
  }
  return [];
}

export async function executeBgbConvert(
  coins: string[],
  config?: BitgetConfig
): Promise<{ success: boolean; message: string }> {
  const activeConfig = config || loadBitgetConfig();
  if (!activeConfig.apiKey || !activeConfig.secretKey) {
    return { success: false, message: 'ไม่มี API Key ของ Bitget' };
  }

  try {
    const res = await fetch('/api/bitget?action=bgb-convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bitget-key': activeConfig.apiKey,
        'x-bitget-secret': activeConfig.secretKey,
        'x-bitget-passphrase': activeConfig.passphrase,
      },
      body: JSON.stringify({
        action: 'bgb-convert',
        coinList: coins,
      }),
    });

    const data = await res.json();
    if (data.code === '00000') {
      return { success: true, message: `✓ แปลงเหรียญ ${coins.join(', ')} เป็น BGB สำเร็จเรียบร้อย!` };
    } else if (data.code === '13011') {
      return { success: false, message: `⏳ Bitget จำกัดการแปลงเศษเหรียญ 1 ครั้งทุกๆ 6 ชั่วโมง (โปรดรอรอบถัดไป)` };
    } else {
      return { success: false, message: `🚨 Bitget (${data.code}): ${data.msg || 'แปลง BGB ไม่สำเร็จ'}` };
    }
  } catch (err: any) {
    return { success: false, message: `เกิดข้อผิดพลาดในการเชื่อมต่อ: ${err.message}` };
  }
}

