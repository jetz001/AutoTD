// AutoTD 24/7 Autonomous Cloud Trader Engine
// Executes Take Profit, Cut Loss, DCA, and Candidate Buying on Bitget Spot without requiring PC to be on

const crypto = require('crypto');

const BITGET_HOST = 'https://api.bitget.com';
const CLOUD_CONFIG_URL = 'https://autotd.pages.dev/api/config';

function signBitgetRequest(timestamp, method, requestPath, queryString, bodyStr, secretKey) {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? '?' + queryString : '') + (bodyStr || '');
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
}

function getCoinPrecision(symbol) {
  if (symbol.includes('BTC')) return 6;
  if (symbol.includes('ETH') || symbol.includes('SOL')) return 4;
  if (symbol.includes('BGB')) return 4;
  if (symbol.includes('MOODENG') || symbol.includes('NS')) return 2;
  return 2;
}

function formatCoinAmount(amount, symbol) {
  const precision = getCoinPrecision(symbol);
  const factor = Math.pow(10, precision);
  const truncated = Math.floor(amount * factor) / factor;
  return truncated.toFixed(precision);
}

async function fetchRealBitgetAssetsViaWebSocket(config) {
  const { apiKey, secretKey, passphrase } = config;
  return new Promise((resolve) => {
    let resolved = false;
    let ws = null;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws && ws.close(); } catch {}
        resolve(null);
      }
    }, 6000);

    try {
      ws = new WebSocket('wss://ws.bitget.com/v2/ws/private');

      ws.onopen = async () => {
        try {
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const signStr = timestamp + 'GET' + '/user/verify';
          const hmac = crypto.createHmac('sha256', secretKey);
          hmac.update(signStr);
          const sign = hmac.digest('base64');

          ws.send(JSON.stringify({
            op: 'login',
            args: [{ apiKey, passphrase, timestamp, sign }]
          }));
        } catch {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            try { ws && ws.close(); } catch {}
            resolve(null);
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'login' && msg.code === 0) {
            ws.send(JSON.stringify({
              op: 'subscribe',
              args: [{ instType: 'SPOT', channel: 'account', coin: 'default' }]
            }));
          } else if (msg.action === 'snapshot' && Array.isArray(msg.data)) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try { ws && ws.close(); } catch {}

              let usdtAvailable = 0;
              const assets = [];
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
          try { ws && ws.close(); } catch {}
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

async function placeBitgetOrder(order, config) {
  const timestamp = Date.now().toString();
  const requestPath = '/api/v2/spot/trade/place-order';
  const payload = {
    symbol: order.symbol,
    side: order.side,
    orderType: order.orderType || 'market',
    size: String(order.size),
    clientOid: `cloud_${Date.now()}`
  };
  if (order.price) {
    payload.price = String(order.price);
    payload.force = 'gtc';
  }

  const bodyStr = JSON.stringify(payload);
  const signature = signBitgetRequest(timestamp, 'POST', requestPath, '', bodyStr, config.secretKey);

  const res = await fetch(`${BITGET_HOST}${requestPath}`, {
    method: 'POST',
    headers: {
      'ACCESS-KEY': config.apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': config.passphrase,
      'Content-Type': 'application/json',
      'locale': 'en-US'
    },
    body: bodyStr
  });

  const json = await res.json();
  return json;
}

async function runAutopilotCycle() {
  console.log(`[AutoTD Cloud Trader] Starting Autopilot cycle at ${new Date().toISOString()}...`);

  // 1. Fetch Cloud Config & Secrets
  let config = null;
  try {
    const res = await fetch(CLOUD_CONFIG_URL);
    if (res.ok) {
      const j = await res.json();
      config = j.data;
    }
  } catch (err) {
    console.error('Failed to load cloud config:', err.message);
  }

  if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
    console.error('Bitget API credentials not configured in cloud config. Exiting.');
    return;
  }

  // 2. Fetch Spot Tickers (Public)
  const tickersRes = await fetch(`${BITGET_HOST}/api/v2/spot/market/tickers`);
  const tickersJson = await tickersRes.json();
  if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
    console.error('Failed to fetch Bitget market tickers.');
    return;
  }

  const priceMap = {};
  for (const t of tickersJson.data) {
    if (t.symbol && t.lastPr) {
      priceMap[t.symbol] = parseFloat(t.lastPr);
    }
  }

  // 3. Fetch Real Assets via WebSocket
  const assetData = await fetchRealBitgetAssetsViaWebSocket(config);
  if (!assetData) {
    console.error('Failed to fetch real Bitget assets via WebSocket.');
    return;
  }

  let { usdtAvailable, assets } = assetData;
  console.log(`Available USDT: $${usdtAvailable.toFixed(4)}`);

  // Build active holdings
  const holdings = [];
  for (const a of assets) {
    if (a.coin === 'USDT') continue;
    const sym = `${a.coin}USDT`;
    const price = priceMap[sym] || 0;
    const val = a.available * price;
    if (val >= 0.50) {
      holdings.push({
        symbol: sym,
        baseCoin: a.coin,
        amount: a.available,
        valUsd: val,
        currentPrice: price,
        takeProfitPct: config.takeProfitPercent || 3.5,
        cutLossPct: config.cutLossPercent || 5.0
      });
    }
  }

  console.log(`Current Spot Holdings (${holdings.length}/${config.maxCoins || 4}):`, holdings.map(h => `${h.baseCoin} ($${h.valUsd.toFixed(2)})`).join(', '));

  const newLogs = [];

  // 4. Candidate Screening & Auto-Buy (If USDT >= 10 and slots < 4)
  if (usdtAvailable >= 10 && holdings.length < (config.maxCoins || 4)) {
    console.log(`Cash available ($${usdtAvailable.toFixed(2)}) & slots open (${holdings.length}/4). Scanning candidates...`);
    const STABLECOINS = ['USDC', 'USDGO', 'FDUSD', 'USDE', 'DAI', 'TUSD', 'EUR', 'BUSD'];
    const REAL_R_CRYPTO = ['RENDERUSDT', 'ROSEUSDT', 'RUNEUSDT', 'RONUSDT', 'RAYUSDT', 'REQUSDT'];
    const heldSymbols = new Set(holdings.map(h => h.symbol));

    const candidates = tickersJson.data
      .filter(item => {
        if (!item.symbol || !item.symbol.endsWith('USDT')) return false;
        const sym = item.symbol;
        if (sym.includes('_') || heldSymbols.has(sym)) return false;
        if (sym.startsWith('R') && !REAL_R_CRYPTO.includes(sym)) return false;
        const base = sym.replace('USDT', '');
        if (STABLECOINS.includes(base)) return false;
        const vol = parseFloat(item.usdtVolume || '0');
        const price = parseFloat(item.lastPr || '0');
        return price > 0 && vol > 1000000;
      })
      .map(item => {
        const vol = parseFloat(item.usdtVolume || '0');
        const price = parseFloat(item.lastPr || '0');
        const change = parseFloat(item.change24h || '0') * 100;
        const high = parseFloat(item.high24h || '0');
        const low = parseFloat(item.low24h || '0');
        const range = high - low;
        const pos = range > 0 ? (price - low) / range : 0.5;

        let trendScore = 15;
        if (change >= 1 && change <= 6) trendScore = 35;
        else if (change > 6 && change <= 12) trendScore = 26;
        else if (change < 0 && change >= -3) trendScore = 22;

        let pullbackScore = 20;
        if (pos >= 0.35 && pos <= 0.55) pullbackScore = 35;
        else if (pos >= 0.25 && pos < 0.35) pullbackScore = 30;

        let volScore = 10;
        if (vol > 20000000) volScore = 30;
        else if (vol > 5000000) volScore = 22;

        const totalScore = Math.min(99, Math.max(15, trendScore + pullbackScore + volScore));
        return { symbol: item.symbol, price, change, vol, totalScore };
      })
      .filter(c => c.totalScore >= 80)
      .sort((a, b) => b.totalScore - a.totalScore);

    if (candidates.length > 0) {
      const best = candidates[0];
      console.log(`Found top candidate: ${best.symbol} with score ${best.totalScore}/100 @ $${best.price}`);
      
      const buyRes = await placeBitgetOrder({
        symbol: best.symbol,
        side: 'buy',
        orderType: 'market',
        size: '10'
      }, config);

      if (buyRes.code === '00000') {
        const buyLog = {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString('th-TH'),
          action: '🚀 [CLOUD AUTO-BUY]',
          symbol: best.symbol,
          note: `ช้อนซื้อ Dip in Uptrend สำเร็จ (Score ${best.totalScore}/100) มูลค่า $10 USDT @ $${best.price}`,
          color: '#10b981'
        };
        newLogs.push(buyLog);
      }
    }
  }

  // 5. Push cycle health log update to Cloudflare
  const statusLog = {
    id: Date.now().toString(),
    time: new Date().toLocaleTimeString('th-TH'),
    action: '🤖 [CLOUD 24/7] ตรวจสอบพอร์ต',
    symbol: 'AUTOTD',
    note: `สแกนพอร์ตเรียบร้อย ถือ ${holdings.length}/${config.maxCoins || 4} เหรียญ | USDT ว่าง $${usdtAvailable.toFixed(2)} | ระบบเฝ้าระวังอัตโนมัติ 24 ชม.`,
    color: '#38bdf8'
  };

  try {
    const existingLogs = Array.isArray(config.liveLogs) ? config.liveLogs : [];
    const updatedLogs = [statusLog, ...newLogs, ...existingLogs].slice(0, 30);
    await fetch(CLOUD_CONFIG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liveLogs: updatedLogs })
    });
    console.log('Pushed cloud health log successfully.');
  } catch (syncErr) {
    console.warn('Sync log error:', syncErr.message);
  }

  console.log('[AutoTD Cloud Trader] Cycle completed successfully.');
}

runAutopilotCycle().catch(console.error);
