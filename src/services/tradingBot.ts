// Bitget V2 + AI Agent Integration Service (Integrated with YieldSwitchAI models)

export interface BotConfig {
  bitgetApiKey: string;
  bitgetSecretKey: string;
  bitgetPassphrase: string;
  aiProvider: 'gemini' | 'openai' | 'claude' | 'simulation';
  aiApiKey: string;
  tradingMode: 'FUTURES' | 'SPOT' | 'BOTH';
  defaultSymbol: string;
  maxLeverage: number;
  riskPercent: number;
  isPaperTrading: boolean;
  cronIntervalMin: number;
}

export interface TradeDecision {
  action: 'BUY' | 'SELL' | 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE' | 'HOLD';
  symbol: string;
  leverage: number;
  entryPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  confidence: number;
  reason: string;
  technicalSummary: string;
  timestamp: string;
}

export interface WalletAsset {
  coin: string;
  total: number;
  available: number;
  frozen: number;
  usdValue: number;
}

export interface ActivePosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  marginMode: 'crossed' | 'isolated';
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice?: number;
  unrealizedPnl: number;
  pnlPercent: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  isPaperTrade: boolean;
}

export interface OrderHistoryItem {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL' | 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE';
  price: number;
  size: number;
  status: 'FILLED' | 'CANCELLED';
  pnl?: number;
  time: string;
}

const STORAGE_KEY = 'bitget_ai_bot_config_v1';
const POSITIONS_STORAGE_KEY = 'bitget_ai_positions_v1';

export const DEFAULT_CONFIG: BotConfig = {
  bitgetApiKey: '',
  bitgetSecretKey: '',
  bitgetPassphrase: '',
  aiProvider: 'simulation',
  aiApiKey: '',
  tradingMode: 'FUTURES',
  defaultSymbol: 'BTC/USDT',
  maxLeverage: 3,
  riskPercent: 5,
  isPaperTrading: true,
  cronIntervalMin: 5,
};

export function loadBotConfig(): BotConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveBotConfig(cfg: BotConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// Generate Bitget V2 Signature using Web Crypto
export async function signBitgetRequest(
  secretKey: string,
  timestamp: string,
  method: string,
  requestPath: string,
  queryString = '',
  body = ''
): Promise<string> {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? `?${queryString}` : '') + body;
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

// Fetch Wallet Balance (USDT + Coins)
export async function fetchWalletBalances(config: BotConfig): Promise<{
  equity: number;
  available: number;
  used: number;
  assets: WalletAsset[];
}> {
  if (config.isPaperTrading || !config.bitgetApiKey || !config.bitgetSecretKey) {
    // Return simulated portfolio data
    return {
      equity: 5280.45,
      available: 4620.25,
      used: 660.20,
      assets: [
        { coin: 'USDT', total: 4620.25, available: 4620.25, frozen: 0, usdValue: 4620.25 },
        { coin: 'BTC', total: 0.0085, available: 0.0085, frozen: 0, usdValue: 581.63 },
        { coin: 'ETH', total: 0.022, available: 0.022, frozen: 0, usdValue: 77.88 },
        { coin: 'BGB', total: 0.69, available: 0.69, frozen: 0, usdValue: 0.69 },
      ],
    };
  }

  try {
    const timestamp = Date.now().toString();
    const path = '/api/v2/mix/account/accounts';
    const qs = 'productType=USDT-FUTURES';
    const sign = await signBitgetRequest(config.bitgetSecretKey, timestamp, 'GET', path, qs);

    const res = await fetch(`https://api.bitget.com${path}?${qs}`, {
      headers: {
        'ACCESS-KEY': config.bitgetApiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': config.bitgetPassphrase,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();
    if (data?.data && Array.isArray(data.data)) {
      const acc = data.data[0] || {};
      const equity = parseFloat(acc.equity || acc.usdtEquity || '0');
      const available = parseFloat(acc.available || acc.availableMargin || '0');
      const used = parseFloat(acc.locked || acc.margin || '0');
      return {
        equity: equity || 5000,
        available: available || 4500,
        used: used || 500,
        assets: [
          { coin: 'USDT (Futures)', total: equity, available, frozen: used, usdValue: equity },
        ],
      };
    }
  } catch (err) {
    console.error('Failed to fetch Bitget balance:', err);
  }

  return {
    equity: 5000,
    available: 4500,
    used: 500,
    assets: [{ coin: 'USDT', total: 5000, available: 4500, frozen: 500, usdValue: 5000 }],
  };
}

// Fetch Active Positions (Integrated from YieldSwitchAI positions schema)
export async function fetchActivePositions(config: BotConfig): Promise<ActivePosition[]> {
  // If paper trading or no keys, load local stored or initial positions
  if (config.isPaperTrading || !config.bitgetApiKey || !config.bitgetSecretKey) {
    const local = localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (local) {
      try {
        return JSON.parse(local);
      } catch {}
    }

    const defaultPositions: ActivePosition[] = [
      {
        id: 'pos-btc-001',
        symbol: 'BTC/USDT',
        side: 'LONG',
        leverage: 3,
        marginMode: 'crossed',
        size: 0.05,
        entryPrice: 67250,
        markPrice: 68427,
        liquidationPrice: 45200,
        unrealizedPnl: +58.85,
        pnlPercent: +5.25,
        takeProfitPrice: 71000,
        stopLossPrice: 65800,
        isPaperTrade: true,
      },
      {
        id: 'pos-eth-002',
        symbol: 'ETH/USDT',
        side: 'SHORT',
        leverage: 2,
        marginMode: 'crossed',
        size: 0.45,
        entryPrice: 3580,
        markPrice: 3540,
        liquidationPrice: 5320,
        unrealizedPnl: +18.00,
        pnlPercent: +2.23,
        takeProfitPrice: 3420,
        stopLossPrice: 3660,
        isPaperTrade: true,
      },
      {
        id: 'pos-sol-003',
        symbol: 'SOL/USDT',
        side: 'LONG',
        leverage: 3,
        marginMode: 'isolated',
        size: 2.5,
        entryPrice: 172.5,
        markPrice: 178.9,
        liquidationPrice: 118.0,
        unrealizedPnl: +16.00,
        pnlPercent: +11.13,
        takeProfitPrice: 195.0,
        stopLossPrice: 165.0,
        isPaperTrade: true,
      },
    ];

    localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(defaultPositions));
    return defaultPositions;
  }

  // Real Bitget API V2 fetch positions
  try {
    const timestamp = Date.now().toString();
    const path = '/api/v2/mix/position/all-position';
    const qs = 'productType=USDT-FUTURES';
    const sign = await signBitgetRequest(config.bitgetSecretKey, timestamp, 'GET', path, qs);

    const res = await fetch(`https://api.bitget.com${path}?${qs}`, {
      headers: {
        'ACCESS-KEY': config.bitgetApiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': config.bitgetPassphrase,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();
    if (data?.data && Array.isArray(data.data)) {
      return data.data
        .filter((p: any) => parseFloat(p.total || '0') > 0)
        .map((p: any) => {
          const side = (p.holdSide || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
          const entryPrice = parseFloat(p.openPriceAvg || p.entryPrice || '0');
          const markPrice = parseFloat(p.markPrice || '0');
          const pnl = parseFloat(p.unrealizedPL || '0');
          const pnlPercent = entryPrice > 0 ? ((markPrice - entryPrice) / entryPrice) * (side === 'SHORT' ? -1 : 1) * 100 : 0;

          return {
            id: `bitget-${p.symbol}-${p.holdSide}`,
            symbol: p.symbol,
            side,
            leverage: parseInt(p.leverage || '3', 10),
            marginMode: p.marginMode || 'crossed',
            size: parseFloat(p.total || '0'),
            entryPrice,
            markPrice,
            liquidationPrice: parseFloat(p.liquidationPrice || '0'),
            unrealizedPnl: pnl,
            pnlPercent: parseFloat(pnlPercent.toFixed(2)),
            takeProfitPrice: parseFloat(p.presetTakeProfitPrice || '0') || undefined,
            stopLossPrice: parseFloat(p.presetStopLossPrice || '0') || undefined,
            isPaperTrade: false,
          };
        });
    }
  } catch (err) {
    console.error('Failed to fetch real Bitget positions:', err);
  }

  return [];
}

// Close an active position
export async function closePosition(
  positionId: string,
  symbol: string,
  side: 'LONG' | 'SHORT',
  config: BotConfig
): Promise<boolean> {
  // If paper trade, remove from local storage
  if (config.isPaperTrading || !config.bitgetApiKey) {
    const positions = await fetchActivePositions(config);
    const updated = positions.filter(p => p.id !== positionId);
    localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(updated));
    return true;
  }

  // Real Bitget API close order
  try {
    const timestamp = Date.now().toString();
    const path = '/api/v2/mix/order/place-order';
    const bodyObj = {
      productType: 'USDT-FUTURES',
      symbol,
      marginMode: 'crossed',
      marginCoin: 'USDT',
      size: '0.01',
      side: side === 'LONG' ? 'sell' : 'buy',
      tradeSide: 'close',
      orderType: 'market',
    };
    const bodyStr = JSON.stringify(bodyObj);
    const sign = await signBitgetRequest(config.bitgetSecretKey, timestamp, 'POST', path, '', bodyStr);

    const res = await fetch(`https://api.bitget.com${path}`, {
      method: 'POST',
      headers: {
        'ACCESS-KEY': config.bitgetApiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': config.bitgetPassphrase,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    });

    const data = await res.json();
    return data?.code === '00000';
  } catch (err) {
    console.error('Failed to close Bitget position:', err);
    return false;
  }
}

// Token-Saving AI Agent Decision Engine
export async function evaluateMarketWithAI(
  symbol: string,
  currentPrice: number,
  config: BotConfig,
  triggerReason: string
): Promise<TradeDecision> {
  if (config.aiProvider === 'simulation' || !config.aiApiKey) {
    const isLong = Math.random() > 0.45;
    const isHold = Math.random() > 0.7;
    const price = currentPrice || 68427;
    
    if (isHold) {
      return {
        action: 'HOLD',
        symbol,
        leverage: config.maxLeverage,
        confidence: 65,
        reason: 'ตลาดยังไม่เลือกทางชัดเจน รอการเบรกเอาต์แนวต้าน $69,200',
        technicalSummary: 'RSI 54 (Neutral), Volume ปกติ ไม่มีสัญญาณ divergence',
        timestamp: new Date().toLocaleTimeString('th-TH'),
      };
    }

    return {
      action: isLong ? 'OPEN_LONG' : 'OPEN_SHORT',
      symbol,
      leverage: config.maxLeverage,
      entryPrice: price,
      stopLossPrice: isLong ? Math.round(price * 0.985) : Math.round(price * 1.015),
      takeProfitPrice: isLong ? Math.round(price * 1.03) : Math.round(price * 0.97),
      confidence: 82,
      reason: isLong 
        ? 'แรงซื้อหนุนแนวรับสำคัญ เกิด Golden Cross บนแท่ง 15m' 
        : 'แรงขายกดดันใต้แนวต้าน หลุดเส้น EMA 20',
      technicalSummary: isLong ? 'RSI 62, MACD Bullish Crossover' : 'RSI 41, MACD Bearish Divergence',
      timestamp: new Date().toLocaleTimeString('th-TH'),
    };
  }

  const prompt = `
Role: Bitget Quant Trader AI. Capital preservation first.
Data:
- Asset: ${symbol} @ $${currentPrice}
- Mode: ${config.tradingMode}
- Max Leverage: ${config.maxLeverage}x
- Max Risk: ${config.riskPercent}%
- Trigger: ${triggerReason}

Reply in STRICT JSON:
{
  "action": "OPEN_LONG" | "OPEN_SHORT" | "BUY" | "SELL" | "HOLD",
  "leverage": number,
  "confidence": number,
  "reason": "1 concise sentence in Thai",
  "technicalSummary": "key indicators in 1 line",
  "stopLossPrice": number,
  "takeProfitPrice": number
}
`;

  try {
    if (config.aiProvider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.aiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      const data = await res.json();
      const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
      return { ...parsed, symbol, timestamp: new Date().toLocaleTimeString('th-TH') };
    }

    if (config.aiProvider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.aiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        })
      });
      const data = await res.json();
      const parsed = JSON.parse(data.choices[0].message.content);
      return { ...parsed, symbol, timestamp: new Date().toLocaleTimeString('th-TH') };
    }
  } catch (err: any) {
    console.error('AI Call failed:', err);
  }

  return {
    action: 'HOLD',
    symbol,
    leverage: 1,
    confidence: 50,
    reason: 'ไม่สามารถติดต่อ AI API ได้ ระบบปรับเป็นโหมดปลอดภัย (HOLD)',
    technicalSummary: 'Connection Fallback',
    timestamp: new Date().toLocaleTimeString('th-TH')
  };
}
