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

export interface SyncedCloudData extends Partial<BitgetConfig> {
  paperBalance?: number;
  holdings?: SpotHolding[];
  liveHoldings?: SpotHolding[];
  quantLogs?: Array<{ id: string; time: string; action: string; symbol: string; note: string; color: string }>;
  liveLogs?: Array<{ id: string; time: string; action: string; symbol: string; note: string; color: string }>;
  liveQuantLogs?: Array<{ id: string; time: string; action: string; symbol: string; note: string; color: string }>;
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

  // 2. Second priority: Direct Browser WebCrypto request (Bypasses Cloudflare Worker WAF blocks)
  if (activeConfig?.apiKey && activeConfig?.secretKey && activeConfig?.passphrase) {
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

  // 2. Second priority: Direct Browser WebCrypto request
  if (activeConfig?.apiKey && activeConfig?.secretKey && activeConfig?.passphrase) {
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
      console.warn('Direct assets fetch failed, falling back to proxy:', err);
    }
  }

  // 3. Fallback: Cloudflare Pages Proxy Endpoint
  try {
    const headers: Record<string, string> = {};
    if (activeConfig?.apiKey) headers['x-bitget-key'] = activeConfig.apiKey;
    if (activeConfig?.secretKey) headers['x-bitget-secret'] = activeConfig.secretKey;
    if (activeConfig?.passphrase) headers['x-bitget-passphrase'] = activeConfig.passphrase;

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
  const costMap: Record<string, { avgCostPrice: number; tranchesCount: number; history: any[] }> = {};
  for (const h of localLive) {
    if (h.symbol && h.avgCostPrice > 0) {
      costMap[h.symbol] = {
        avgCostPrice: h.avgCostPrice,
        tranchesCount: h.tranchesCount || 1,
        history: h.history || [],
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

  // 1. Direct Browser WebCrypto request
  if (activeConfig?.apiKey && activeConfig?.secretKey && activeConfig?.passphrase) {
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
      console.warn('Direct order history fetch failed, falling back to proxy:', err);
    }
  }

  // 2. Fallback: Cloudflare Pages / Next.js Proxy Endpoint
  try {
    const headers: Record<string, string> = {};
    if (activeConfig?.apiKey) headers['x-bitget-key'] = activeConfig.apiKey;
    if (activeConfig?.secretKey) headers['x-bitget-secret'] = activeConfig.secretKey;
    if (activeConfig?.passphrase) headers['x-bitget-passphrase'] = activeConfig.passphrase;

    const proxyUrl = `/api/bitget?action=history${symbol ? `&symbol=${symbol}` : ''}`;
    const res = await fetch(proxyUrl, { headers });
    if (!res.ok) return [];
    const json = await res.json();
    if (json.code === '00000' && Array.isArray(json.data)) {
      return json.data;
    }
    return [];
  } catch {
    return [];
  }
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
          return parsed.filter(
            (h: any) =>
              h &&
              h.isPaper !== true &&
              !['ZECUSDT', 'XLMUSDT', 'ONDOUSDT'].includes(h.symbol)
          );
        }
        return parsed;
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
  config: BitgetConfig
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

export function getCoinPrecision(symbol: string): number {
  if (symbol.includes('BTC')) return 6;
  if (symbol.includes('ETH') || symbol.includes('SOL') || symbol.includes('TAO')) return 4;
  if (symbol.includes('BGB')) return 4;
  if (symbol.includes('MOODENG') || symbol.includes('NS')) return 2;
  return 2;
}

export function formatCoinAmount(amount: number, symbol: string): string {
  const precision = getCoinPrecision(symbol);
  const factor = Math.pow(10, precision);
  // Truncate (floor) to prevent exceeding actual available balance on Bitget
  const truncated = Math.floor(amount * factor) / factor;
  return truncated.toFixed(precision);
}

// Core Execution: SELL OR CUT LOSS 100% (Real & Paper)
export async function executeSpotSell(
  symbol: string,
  currentPrice: number,
  isCutLoss = false,
  config?: BitgetConfig
): Promise<{ success: boolean; message: string; realizedPnl: number; updatedHoldings: SpotHolding[] }> {
  const isPaper = config ? (config.isPaperTrading ?? true) : true;
  const holdings = loadSpotHoldings(isPaper);
  const idx = holdings.findIndex(h => h.symbol === symbol);
  if (idx === -1) {
    return { success: false, message: `ไม่พบเหรียญ ${symbol} ในพอร์ต`, realizedPnl: 0, updatedHoldings: holdings };
  }

  const h = holdings[idx];

  // If in Real Live Trading mode, submit to Bitget
  if (config && !config.isPaperTrading) {
    // Format precision dynamically with truncation
    const sellSize = formatCoinAmount(h.totalAmount, symbol);
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
  saveSpotHoldings(holdings, isPaper);

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

