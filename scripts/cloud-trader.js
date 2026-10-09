// AutoTD 24/7 Autonomous Cloud Trader Engine
// Runs on GitHub Actions (Microsoft Azure / AWS runners) 24/7
// Zero local PC dependency, zero Cloudflare WAF block

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const indicators = require('./indicators.js');

// Auto-load .env or fallback keys from local skill .env
function loadLocalEnv() {
  const candidates = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env'),
    path.join(process.env.USERPROFILE || '', '.gemini', 'config', 'skills', 'jev', '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const text = fs.readFileSync(p, 'utf8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            const key = k.trim();
            const val = v.join('=').trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}
loadLocalEnv();

const BITGET_HOST = 'https://api.bitget.com';
const CLOUD_CONFIG_URL = 'https://autotd.pages.dev/api/config';

const ACTION_INPUT = process.env.INPUT_ACTION || 'cycle';
const SYMBOL_INPUT = process.env.INPUT_SYMBOL || '';
const AMOUNT_INPUT = process.env.INPUT_AMOUNT || '';

function signBitgetRequest(timestamp, method, requestPath, queryString, bodyStr, secretKey) {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? '?' + queryString : '') + (bodyStr || '');
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
}

function getThaiTimeString(date = new Date()) {
  return date.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
}

async function fetchBitgetCandles(symbol, granularity = '15min', limit = '30') {
  try {
    const res = await fetch(`${BITGET_HOST}/api/v2/spot/market/candles?symbol=${symbol}&granularity=${granularity}&limit=${limit}`);
    const json = await res.json();
    if (json.code === '00000' && Array.isArray(json.data)) {
      return json.data.map(c => ({
        time: parseInt(c[0]),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[6] || c[5] || '0')
      })).reverse();
    }
  } catch (e) {
    console.warn(`Candle fetch error for ${symbol} (${granularity}):`, e.message);
  }
  return [];
}

const BITGET_QTY_PRECISION_MAP = {
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
  QNTUSDT: 4,
  KIIUSDT: 2,
};

function getCoinPrecision(symbol) {
  if (BITGET_QTY_PRECISION_MAP[symbol]) return BITGET_QTY_PRECISION_MAP[symbol];
  if (symbol.includes('BTC')) return 6;
  if (symbol.includes('ETH') || symbol.includes('SOL')) return 4;
  if (symbol.includes('TAO') || symbol.includes('ZEC') || symbol.includes('BNB')) return 3;
  if (symbol.includes('BGB') || symbol.includes('XRP') || symbol.includes('DOGE')) return 4;
  return 2;
}

function formatCoinAmount(amount, symbol) {
  let precision = getCoinPrecision(symbol);
  let factor = Math.pow(10, precision);
  let truncated = Math.floor(amount * factor) / factor;

  // Safety guard: If amount > 0 but precision truncated it to 0, dynamically increase precision up to 6
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

// 1. Primary: Bitget REST API Asset Fetcher (Direct HTTP, 100% reliable on Cloud runners)
async function fetchRealBitgetAssetsViaRest(config) {
  try {
    const { apiKey, secretKey, passphrase } = config;
    const timestamp = Date.now().toString();
    const requestPath = '/api/v2/spot/account/assets';
    const sign = signBitgetRequest(timestamp, 'GET', requestPath, '', '', secretKey);
    const res = await fetch(`${BITGET_HOST}${requestPath}`, {
      headers: {
        'ACCESS-KEY': apiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': passphrase,
        'Content-Type': 'application/json',
        'locale': 'en-US'
      }
    });
    const json = await res.json();
    if (json.code === '00000' && Array.isArray(json.data)) {
      let usdtAvailable = 0;
      const assets = [];
      for (const item of json.data) {
        const coin = item.coin || '';
        const avail = parseFloat(item.available || '0');
        const frozen = parseFloat(item.frozen || '0');
        if (coin === 'USDT') usdtAvailable = avail;
        if (avail > 0 || frozen > 0) {
          assets.push({ coin, available: avail, frozen });
        }
      }
      return { usdtAvailable, assets };
    } else {
      console.warn('Bitget REST asset response:', json.code, json.msg);
    }
  } catch (err) {
    console.warn('REST asset fetch error:', err.message);
  }
  return null;
}

// 2. Secondary: WebSocket Fallback
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
    }, 5000);

    try {
      if (typeof WebSocket === 'undefined') {
        clearTimeout(timeout);
        return resolve(null);
      }
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
  console.log(`[AutoTD Cloud Trader] Starting cycle at ${new Date().toISOString()} | Action: ${ACTION_INPUT}`);

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

  // 3. Fetch Real Assets: REST first, then WebSocket
  let assetData = await fetchRealBitgetAssetsViaRest(config);
  if (!assetData) {
    console.log('Falling back to WebSocket asset fetch...');
    assetData = await fetchRealBitgetAssetsViaWebSocket(config);
  }

  if (!assetData) {
    console.error('Failed to fetch real Bitget assets via REST and WebSocket.');
    return;
  }

  let { usdtAvailable, assets } = assetData;
  console.log(`Available USDT: $${usdtAvailable.toFixed(4)}`);

  // Separate Active Holdings (val >= $3.00 USD) from Dust (< $3.00 USD)
  const allHoldings = [];
  for (const a of assets) {
    if (a.coin === 'USDT') continue;
    const sym = `${a.coin}USDT`;
    const price = priceMap[sym] || 0;
    const val = a.available * price;
    if (a.available > 0 && price > 0) {
      allHoldings.push({
        symbol: sym,
        baseCoin: a.coin,
        amount: a.available,
        valUsd: val,
        currentPrice: price
      });
    }
  }

  const holdings = allHoldings.filter(h => h.valUsd >= 3.00);
  const dustHoldings = allHoldings.filter(h => h.valUsd < 3.00);

  console.log(`Active Spot Holdings (${holdings.length}/${config.maxCoins || 4}):`, holdings.map(h => `${h.baseCoin} ($${h.valUsd.toFixed(2)})`).join(', ') || 'None');
  if (dustHoldings.length > 0) {
    console.log(`Dust coins (< $3.00):`, dustHoldings.map(d => `${d.baseCoin} ($${d.valUsd.toFixed(4)})`).join(', '));
  }

  const newLogs = [];

  // ==========================================
  // 3.5 AUTONOMOUS DUST RECYCLING (Dust -> BGB -> USDT)
  // ==========================================
  async function recycleDustToBgbAndUsdt() {
    try {
      const timestamp = Date.now().toString();
      const requestPath = '/api/v2/convert/bgb-convert-coin-list';
      const sign = signBitgetRequest(timestamp, 'GET', requestPath, '', '', config.secretKey);
      const listRes = await fetch(`${BITGET_HOST}${requestPath}`, {
        headers: {
          'ACCESS-KEY': config.apiKey,
          'ACCESS-SIGN': sign,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-PASSPHRASE': config.passphrase,
          'Content-Type': 'application/json',
          'locale': 'en-US'
        }
      });
      const listJson = await listRes.json();
      if (listJson.code === '00000' && Array.isArray(listJson.data?.coinList)) {
        const activeCoins = new Set(
          (holdings || []).map(h => h.baseCoin || h.symbol?.replace('USDT', ''))
        );
        (config.liveHoldings || []).forEach(h => {
          if (((h.totalAmount || 0) * (h.currentPrice || priceMap[h.symbol] || 0)) >= 3.00) {
            activeCoins.add(h.baseCoin || h.symbol?.replace('USDT', ''));
          }
        });
        activeCoins.add('USDT');
        activeCoins.add('BGB');

        const dustCoinsToConvert = listJson.data.coinList
          .map(c => c.coin)
          .filter(c => !activeCoins.has(c));

        if (dustCoinsToConvert.length > 0) {
          console.log(`[Dust Recycler] Attempting BGB conversion for: ${dustCoinsToConvert.join(', ')}`);
          const convertPath = '/api/v2/convert/bgb-convert';
          const postPayload = { coinList: dustCoinsToConvert };
          const postBody = JSON.stringify(postPayload);
          const postTime = Date.now().toString();
          const postSign = signBitgetRequest(postTime, 'POST', convertPath, '', postBody, config.secretKey);
          const convertRes = await fetch(`${BITGET_HOST}${convertPath}`, {
            method: 'POST',
            headers: {
              'ACCESS-KEY': config.apiKey,
              'ACCESS-SIGN': postSign,
              'ACCESS-TIMESTAMP': postTime,
              'ACCESS-PASSPHRASE': config.passphrase,
              'Content-Type': 'application/json',
              'locale': 'en-US'
            },
            body: postBody
          });
          const convertJson = await convertRes.json();
          if (convertJson.code === '00000') {
            console.log(`[Dust Recycler] Converted ${dustCoinsToConvert.length} dust coins to BGB successfully!`);
            newLogs.push({
              id: Date.now().toString(),
              timestamp: Date.now(),
              time: getThaiTimeString(),
              action: '🧹✨ [AUTO DUST CONVERT]',
              symbol: 'BGB',
              note: `แปลงเศษเหรียญ (${dustCoinsToConvert.join(', ')}) เป็น BGB สำเร็จ`,
              color: '#8b5cf6'
            });
          } else if (convertJson.code === '13011') {
            console.log(`[Dust Recycler] Cooldown active (1 convert every 6h): ${convertJson.msg}`);
          } else {
            console.warn(`[Dust Recycler] Convert response: ${convertJson.code} ${convertJson.msg}`);
          }
        }
      }

      // Check BGB asset and recycle to USDT if accumulated >= $5.50
      const bgbAsset = assets.find(a => a.coin === 'BGB');
      const bgbPrice = priceMap['BGBUSDT'] || 0;
      const bgbAvailable = bgbAsset ? bgbAsset.available : 0;
      const bgbValUsd = bgbAvailable * bgbPrice;
      const isBgbActiveTrade = (config.liveHoldings || []).some(
        h => (h.symbol === 'BGBUSDT' || h.baseCoin === 'BGB') && (((h.totalAmount || 0) * (h.avgCostPrice || bgbPrice)) >= 3.00)
      );

      if (!isBgbActiveTrade && bgbValUsd >= 5.50 && bgbPrice > 0) {
        const sellSize = formatCoinAmount(bgbAvailable, 'BGBUSDT');
        if (parseFloat(sellSize) > 0) {
          console.log(`[Dust Recycler] BGB accumulated to $${bgbValUsd.toFixed(2)} USD (>= $5.50). Auto-selling to pure USDT...`);
          const sellRes = await placeBitgetOrder({
            symbol: 'BGBUSDT',
            side: 'sell',
            orderType: 'market',
            size: sellSize
          }, config);
          if (sellRes.code === '00000') {
            console.log(`[Dust Recycler] Successfully recycled BGB into USDT!`);
            newLogs.push({
              id: Date.now().toString(),
              timestamp: Date.now(),
              time: getThaiTimeString(),
              action: '💰💵 [BGB TO USDT RECYCLE]',
              symbol: 'BGBUSDT',
              note: `ขาย BGB สะสม (${sellSize} BGB ≈ $${bgbValUsd.toFixed(2)}) คืนเป็นเงินสด USDT สำเร็จ`,
              color: '#10b981'
            });
          } else {
            console.warn(`[Dust Recycler] Failed to sell BGB to USDT:`, sellRes.code, sellRes.msg);
          }
        }
      }
    } catch (err) {
      console.warn(`[Dust Recycler] Error during dust recycling:`, err.message);
    }
  }

  await recycleDustToBgbAndUsdt();

  // ==========================================
  // 4. ON-DEMAND DIRECT ACTIONS (Manual Sell / Buy via Webhook / Dispatch)
  // ==========================================
  if (ACTION_INPUT === 'sell' && SYMBOL_INPUT) {
    const targetSym = SYMBOL_INPUT.endsWith('USDT') ? SYMBOL_INPUT : `${SYMBOL_INPUT}USDT`;
    const targetBase = targetSym.replace('USDT', '');
    const foundAsset = assets.find(a => a.coin === targetBase);
    if (foundAsset && foundAsset.available > 0) {
      const sellSize = formatCoinAmount(foundAsset.available, targetSym);
      console.log(`Executing on-demand sell for ${targetSym} (Size: ${sellSize})...`);
      const sellRes = await placeBitgetOrder({
        symbol: targetSym,
        side: 'sell',
        orderType: 'market',
        size: sellSize
      }, config);

      if (sellRes.code === '00000') {
        const orderId = sellRes.data?.orderId || 'ok';
        console.log(`On-demand sell succeeded: orderId=${orderId}`);
        newLogs.push({
          id: Date.now().toString(),
          timestamp: Date.now(),
          time: getThaiTimeString(),
          action: '🎯 [CLOUD SELL] คำสั่งสำเร็จ',
          symbol: targetSym,
          note: `ขายสำเร็จบน Bitget Spot orderId=${orderId}`,
          color: '#10b981'
        });
      } else {
        console.error('On-demand sell failed:', sellRes.code, sellRes.msg);
        newLogs.push({
          id: Date.now().toString(),
          timestamp: Date.now(),
          time: getThaiTimeString(),
          action: '🚨 [CLOUD SELL] ไม่สำเร็จ',
          symbol: targetSym,
          note: `Bitget API (${sellRes.code}): ${sellRes.msg || 'Order failed'}`,
          color: '#ef4444'
        });
      }
    } else {
      console.log(`No available balance found to sell for ${targetSym}`);
    }
  }

  if (ACTION_INPUT === 'buy' && SYMBOL_INPUT) {
    const targetSym = SYMBOL_INPUT.endsWith('USDT') ? SYMBOL_INPUT : `${SYMBOL_INPUT}USDT`;
    const requestedSize = parseFloat(AMOUNT_INPUT || '10');
    // Safety buffer (0.05 USDT) to prevent 43012 Insufficient balance when balance is e.g. 9.99 USDT
    const maxAvailable = Math.max(0, Math.floor((usdtAvailable - 0.05) * 100) / 100);
    const buySize = Math.min(requestedSize, maxAvailable);

    if (buySize < 5) {
      console.error(`Insufficient USDT balance: $${usdtAvailable.toFixed(2)} (Need at least $5 USDT for Bitget Spot)`);
      newLogs.push({
        id: Date.now().toString(),
        timestamp: Date.now(),
        time: getThaiTimeString(),
        action: '🚨 [CLOUD BUY] ไม่สำเร็จ',
        symbol: targetSym,
        note: `ยอด USDT ใน Bitget Spot มีเพียง $${usdtAvailable.toFixed(2)} ไม่พอสำหรับขั้นต่ำ $5.00 USDT (ต้องเติม USDT ในกระเป๋า Spot)`,
        color: '#ef4444'
      });
    } else {
      console.log(`Executing on-demand buy for ${targetSym} (Budget: $${buySize.toFixed(2)} USDT / Available: $${usdtAvailable.toFixed(2)})...`);
      const buyRes = await placeBitgetOrder({
        symbol: targetSym,
        side: 'buy',
        orderType: 'market',
        size: String(buySize.toFixed(2))
      }, config);

      if (buyRes.code === '00000') {
        const orderId = buyRes.data?.orderId || 'ok';
        console.log(`On-demand buy succeeded: orderId=${orderId}`);
        newLogs.push({
          id: Date.now().toString(),
          timestamp: Date.now(),
          time: getThaiTimeString(),
          action: '🚀 [CLOUD BUY] คำสั่งสำเร็จ',
          symbol: targetSym,
          note: `เข้าซื้อสำเร็จบน Bitget Spot orderId=${orderId} มูลค่า $${buySize.toFixed(2)} USDT`,
          color: '#10b981'
        });
      } else {
        console.error('On-demand buy failed:', buyRes.code, buyRes.msg);
        newLogs.push({
          id: Date.now().toString(),
          timestamp: Date.now(),
          time: getThaiTimeString(),
          action: '🚨 [CLOUD BUY] ไม่สำเร็จ',
          symbol: targetSym,
          note: `Bitget API (${buyRes.code}): ${buyRes.msg || 'Order failed'}`,
          color: '#ef4444'
        });
      }
    }
  }

  // ==========================================
  // 5. TAKE PROFIT & CUT LOSS EVALUATION (AUTONOMOUS)
  // ==========================================
  // Bitget Spot Fee Schedule (Taker: 0.10% buy + 0.10% sell = 0.20% round-trip)
  const BITGET_SPOT_FEE_RATE = 0.001; // 0.10% per trade (taker)
  const BITGET_ROUNDTRIP_FEE_PCT = 0.20; // 0.20% round-trip
  const BITGET_BREAKEVEN_BUFFER_PCT = 0.35; // 0.35% minimum profit to cover round-trip fee + slippage

  const tpTarget = config.takeProfitPercent || 3.5;
  const slTarget = config.cutLossPercent || 5.0;
  const jevKey = config.typesafeApiKey || process.env.TYPESAFE_API_KEY;
  const groqKey = config.groqApiKey || process.env.GROQ_API_KEY;
  const orKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  let liveHoldingsConfig = Array.isArray(config.liveHoldings)
    ? config.liveHoldings.filter(lh => holdings.some(h => h.symbol === lh.symbol))
    : [];

  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    const match = liveHoldingsConfig.find(lh => lh.symbol === h.symbol);
    let avgCost = match && match.avgCostPrice > 0 ? match.avgCostPrice : 0;

    if (avgCost <= 0) {
      try {
        const timestamp = Date.now().toString();
        const requestPath = '/api/v2/spot/trade/history-orders';
        const queryParams = `symbol=${h.symbol}&limit=10`;
        const sign = signBitgetRequest(timestamp, 'GET', requestPath, queryParams, '', config.secretKey);
        const res = await fetch(`${BITGET_HOST}${requestPath}?${queryParams}`, {
          headers: {
            'ACCESS-KEY': config.apiKey,
            'ACCESS-SIGN': sign,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-PASSPHRASE': config.passphrase,
            'Content-Type': 'application/json',
            'locale': 'en-US'
          }
        });
        const json = await res.json();
        if (json.code === '00000' && Array.isArray(json.data)) {
          const buyOrder = json.data.find(o => o.side === 'buy' && (o.status === 'filled' || o.status === 'partially_filled'));
          if (buyOrder && parseFloat(buyOrder.priceAvg || buyOrder.price || '0') > 0) {
            avgCost = parseFloat(buyOrder.priceAvg || buyOrder.price);
          }
        }
      } catch (err) {}
    }

    if (avgCost > 0) {
      const pnlPct = ((h.currentPrice - avgCost) / avgCost) * 100;
      const netPnlPct = pnlPct - BITGET_ROUNDTRIP_FEE_PCT;
      const investedUsdt = match?.totalInvestedUsdt || (avgCost * h.amount);
      const currentValUsdt = h.currentPrice * h.amount;
      const estRoundtripFeeUsdt = (investedUsdt * BITGET_SPOT_FEE_RATE) + (currentValUsdt * BITGET_SPOT_FEE_RATE);
      const netPnlUsdt = (currentValUsdt - investedUsdt) - estRoundtripFeeUsdt;

      h.pnlPct = pnlPct;
      h.netPnlPct = netPnlPct;
      h.avgCost = avgCost;
      h.estFeeUsdt = estRoundtripFeeUsdt;

      const effectiveTp = match?.takeProfitPrice || (avgCost * (1 + tpTarget / 100));
      const effectiveSl = match?.trailingSlPrice || match?.cutLossPrice || (avgCost * (1 - slTarget / 100));

      console.log(`Holding ${h.symbol}: Price $${h.currentPrice}, AvgCost $${avgCost}, Gross PnL: ${pnlPct.toFixed(2)}% | Net (หักฟี Bitget 0.2%): ${netPnlPct.toFixed(2)}% ($${netPnlUsdt.toFixed(2)}) | TP: $${effectiveTp.toFixed(4)}, SL: $${effectiveSl.toFixed(4)}`);

      // 5.1 Take Profit (Hard Exit)
      if (h.currentPrice >= effectiveTp) {
        console.log(`🚀 [CLOUD TAKE-PROFIT TRIGGERED] ${h.symbol} hit $${h.currentPrice} >= TP $${effectiveTp}! Executing market sell...`);
        const sellSize = formatCoinAmount(h.amount, h.symbol);
        const sellRes = await placeBitgetOrder({
          symbol: h.symbol,
          side: 'sell',
          orderType: 'market',
          size: sellSize
        }, config);

        if (sellRes.code === '00000') {
          newLogs.push({
            id: Date.now().toString(),
            timestamp: Date.now(),
            time: getThaiTimeString(),
            action: '🎯 [CLOUD AUTO-TAKE PROFIT]',
            symbol: h.symbol,
            note: `ล็อคกำไรสำเร็จ @ $${h.currentPrice} (+${pnlPct.toFixed(2)}% | Net สุทธิหลังหักฟี 0.2%: +${netPnlPct.toFixed(2)}%) คืน USDT กลับกระเป๋า Spot`,
            color: '#10b981'
          });
          liveHoldingsConfig = liveHoldingsConfig.filter(lh => lh.symbol !== h.symbol);
          usdtAvailable += (h.amount * h.currentPrice);
          holdings.splice(i, 1);
          i--;
          continue;
        }
      }
      // 5.2 Cut Loss / Trailing Stop (Hard Exit)
      else if (h.currentPrice <= effectiveSl) {
        console.log(`🚨 [CLOUD STOP-LOSS TRIGGERED] ${h.symbol} hit $${h.currentPrice} <= SL $${effectiveSl}! Executing market sell...`);
        const sellSize = formatCoinAmount(h.amount, h.symbol);
        const sellRes = await placeBitgetOrder({
          symbol: h.symbol,
          side: 'sell',
          orderType: 'market',
          size: sellSize
        }, config);

        if (sellRes.code === '00000') {
          newLogs.push({
            id: Date.now().toString(),
            timestamp: Date.now(),
            time: getThaiTimeString(),
            action: '🚨 [CLOUD AUTO-CUT LOSS]',
            symbol: h.symbol,
            note: `คัทลอสรักษาทุน @ $${h.currentPrice} (${pnlPct.toFixed(2)}%)`,
            color: '#ef4444'
          });
          liveHoldingsConfig = liveHoldingsConfig.filter(lh => lh.symbol !== h.symbol);
          usdtAvailable += (h.amount * h.currentPrice);
          holdings.splice(i, 1);
          i--;
          continue;
        }
      }
      // 5.3 AI & Quant Dynamic Revise TP / SL (เป้าหมายเฉพาะตัวของแต่ละเหรียญ: ปรับเป้า หรือ คงเดิม)
      else if (match && !match.manualLock) {
        let revisedTp = match.takeProfitPrice || effectiveTp;
        let revisedSl = match.trailingSlPrice || effectiveSl;
        let isRevised = false;
        let reviseReason = '';

        try {
          const recentCandles15 = await fetchBitgetCandles(h.symbol, '15min', '30');
          if (recentCandles15.length >= 14) {
            const a15 = indicators.analyzeTimeframeIndicators(recentCandles15);
            const atr15 = a15?.atrVal || (h.currentPrice * 0.02);

            // A) REVISE SL: Breakeven Protection (+1.2% profit) -> Cover 0.20% Bitget roundtrip fees + buffer
            if (pnlPct >= 1.2 && !match.breakevenLocked) {
              const bePrice = parseFloat((avgCost * (1 + BITGET_BREAKEVEN_BUFFER_PCT / 100)).toFixed(4));
              if (bePrice > revisedSl) {
                match.breakevenLocked = true;
                revisedSl = bePrice;
                isRevised = true;
                reviseReason = `กำไรแตะ +${pnlPct.toFixed(2)}% (>= +1.2%) ➡️ เลื่อน SL มาบังทุนที่ $${revisedSl} (คุ้มครองค่าฟี Bitget 0.2% + กำไรส่วนเกิน)`;
              }
            }

            // B) REVISE SL: Trailing SL up along with rising SuperTrend
            if (a15 && a15.supertrendDir === 1 && a15.supertrendPrice > revisedSl && a15.supertrendPrice < h.currentPrice) {
              const newSl = parseFloat(a15.supertrendPrice.toFixed(4));
              if (newSl > revisedSl) {
                revisedSl = newSl;
                isRevised = true;
                reviseReason = `SuperTrend 15m ขาขึ้นต่อเนื่อง ➡️ ขยับ Trailing SL ขึ้นล็อกกำไรที่ $${revisedSl}`;
              }
            }

            // C) REVISE TP: Strong Momentum Expansion (ขยายเป้าทำกำไรตามโมเมนตัม)
            if (a15 && a15.supertrendDir === 1 && a15.score >= 70 && pnlPct >= 1.8) {
              const proposedTp = parseFloat((h.currentPrice + 2.0 * atr15).toFixed(4));
              if (proposedTp > revisedTp * 1.005) {
                const prevTp = revisedTp;
                revisedTp = proposedTp;
                isRevised = true;
                reviseReason = `โมเมนตัม 15m แข็งแกร่ง (Score ${a15.score}/100) ➡️ ขยายเป้า TP จาก $${prevTp} เป็น $${revisedTp}`;
              }
            }
            // D) REVISE TP: Overbought Exhaustion Guard (ร่นเป้าปิดกำไรก่อนย่อ)
            else if (a15 && a15.rsi > 75 && pnlPct >= 2.0) {
              const tightenTp = parseFloat((h.currentPrice * 1.003).toFixed(4));
              if (tightenTp < revisedTp) {
                const prevTp = revisedTp;
                revisedTp = tightenTp;
                isRevised = true;
                reviseReason = `RSI 15m แตะ ${a15.rsi.toFixed(1)} (Overbought สูง) ➡️ ร่นเป้า TP จาก $${prevTp} มาที่ $${revisedTp} เพื่อล็อกกำไรก่อนย่อตัว`;
              }
            }
            // D) AI Jev Take-Profit Guard: Check if should SELL now to lock gains on high RSI (Requires Net PnL >= +0.8% to cover 0.2% Bitget fee)
            if (a15 && a15.rsi > 75 && netPnlPct >= 0.8 && jevKey) {
              try {
                const jRes = await fetch('https://api.typesafe.ai/v1/systemone', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${jevKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    state: `Holding ${h.symbol}: AvgCost $${avgCost}, Current $${h.currentPrice} (Gross: +${pnlPct.toFixed(2)}%, Net after 0.2% fee: +${netPnlPct.toFixed(2)}%). 15m RSI reached ${a15.rsi.toFixed(1)} (Overbought).`,
                    model: 'jev-latest',
                    questions: {
                      take_profit_now: {
                        type: 'choice',
                        instructions: 'Should the trading bot SELL now to lock profit before a pullback, or HOLD?',
                        criteria: {
                          'SELL': 'Overbought exhaustion, take profit immediately to secure gains after fees',
                          'HOLD': 'Strong continuation momentum, continue holding'
                        }
                      }
                    }
                  }),
                  signal: AbortSignal.timeout(6000)
                });
                if (jRes.ok) {
                  const jData = await jRes.json();
                  const choice = jData.answers?.take_profit_now?.choice;
                  const prob = jData.answers?.take_profit_now?.probabilities?.[choice] ?? 0.8;
                  if (choice === 'SELL' && prob >= 0.85) {
                    console.log(`🎯 [AI JEV TAKE PROFIT] ${h.symbol} Jev chose SELL to lock Gross +${pnlPct.toFixed(2)}% | Net +${netPnlPct.toFixed(2)}% (Prob: ${(prob * 100).toFixed(0)}%)`);
                    const sellSize = formatCoinAmount(h.amount, h.symbol);
                    const sellRes = await placeBitgetOrder({ symbol: h.symbol, side: 'sell', orderType: 'market', size: sellSize }, config);
                    if (sellRes.code === '00000') {
                      newLogs.push({
                        id: Date.now().toString(),
                        timestamp: Date.now(),
                        time: getThaiTimeString(),
                        action: '🎯 [AI JEV TAKE PROFIT]',
                        symbol: h.symbol,
                        note: `Jev สั่งขายล็อกกำไรดักหน้าย่อ @ $${h.currentPrice} (+${pnlPct.toFixed(2)}% | Net หลังหักฟี 0.2%: +${netPnlPct.toFixed(2)}%) [Prob: ${(prob * 100).toFixed(0)}%]`,
                        color: '#10b981'
                      });
                      liveHoldingsConfig = liveHoldingsConfig.filter(lh => lh.symbol !== h.symbol);
                      usdtAvailable += (h.amount * h.currentPrice);
                      holdings.splice(i, 1);
                      i--;
                      continue;
                    }
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {
          console.warn(`Revise TP/SL error for ${h.symbol}:`, e.message);
        }

        if (isRevised) {
          match.takeProfitPrice = revisedTp;
          match.trailingSlPrice = revisedSl;
          console.log(`[REVISE TP/SL] ${h.symbol}: ปรับเป้า TP: $${revisedTp} | SL: $${revisedSl} (${reviseReason})`);
          newLogs.push({
            id: Date.now().toString(),
            timestamp: Date.now(),
            time: getThaiTimeString(),
            action: '🎯🔄 [REVISE TP/SL]',
            symbol: h.symbol,
            note: `${reviseReason}`,
            color: '#38bdf8'
          });
        } else {
          console.log(`[REVISE TP/SL] ${h.symbol}: คงเดิม (TP: $${revisedTp.toFixed(4)}, SL: $${revisedSl.toFixed(4)}) - กราฟยังเป็นไปตามแผน`);
        }
      }

      // 5.4 Adaptive Time-Stop & Dynamic Extension Evaluator
      if (match && match.entryTimestamp && match.maxHoldMinutes && !match.manualLock) {
        const elapsedMin = (Date.now() - match.entryTimestamp) / 60000;
        if (elapsedMin >= match.maxHoldMinutes) {
          console.log(`[TIME EVALUATOR] ${h.symbol} reached ${Math.round(elapsedMin)}m limit. Evaluating if should extend or close...`);
          
          let shouldExtend = false;
          let newTf = match.targetTimeframe || '15m';
          let newIndicator = match.primaryIndicator || 'CONFLUENCE_SCORE';
          let evalNote = '';

          try {
            const [c15, c1h] = await Promise.all([
              fetchBitgetCandles(h.symbol, '15min', '30'),
              fetchBitgetCandles(h.symbol, '1h', '30')
            ]);

            const a15 = c15.length >= 14 ? indicators.analyzeTimeframeIndicators(c15) : null;
            const a1h = c1h.length >= 14 ? indicators.analyzeTimeframeIndicators(c1h) : null;

            const score15 = a15 ? a15.score : 50;
            const score1h = a1h ? a1h.score : 50;
            const isBull15 = a15 && a15.supertrendDir === 1;
            const isBull1h = a1h && a1h.supertrendDir === 1;

            // Decision: If 1h or 15m is bullish or score >= 60, and not crashing (pnlPct >= -3.5%)
            if ((isBull1h || isBull15 || score1h >= 60 || score15 >= 60) && pnlPct >= -3.5) {
              shouldExtend = true;
              if (score1h >= score15 && isBull1h) {
                newTf = '1h';
                newIndicator = a1h.dominantSignal !== 'NEUTRAL' ? a1h.dominantSignal : 'TREND_ALIGNMENT';
              } else if (a15) {
                newTf = '15m';
                newIndicator = a15.dominantSignal !== 'NEUTRAL' ? a15.dominantSignal : (isBull15 ? 'SUPERTREND_STOCH_CROSS' : 'BOLL_RSI_DIP');
              }
              evalNote = `กราฟ ${newTf} ยังเป็นทรงบวก (Score ${Math.max(score15, score1h)}/100 | ${isBull1h ? '1h Bull' : '15m Bull'})`;
            } else {
              evalNote = `กราฟเสียทรงทั้ง 15m/1h (Score ${Math.max(score15, score1h)}/100) หลุดแนวโน้ม`;
            }

            // Consult TypeSafe Jev if available for definitive HOLD vs SELL verdict
            if (jevKey) {
              try {
                const jState = `Position ${h.symbol}: AvgCost $${avgCost}, Current $${h.currentPrice} (PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%). Elapsed Time: ${Math.round(elapsedMin)}m/${match.maxHoldMinutes}m. 15m Score: ${score15}, 1h Score: ${score1h}. 15m Trend: ${isBull15 ? 'Bull' : 'Bear'}, 1h Trend: ${isBull1h ? 'Bull' : 'Bear'}.`;
                const jRes = await fetch('https://api.typesafe.ai/v1/systemone', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${jevKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    state: jState,
                    model: 'jev-latest',
                    questions: {
                      verdict: {
                        type: 'choice',
                        instructions: 'Should the quantitative trading bot continue to HOLD this position or SELL to exit now?',
                        criteria: {
                          'HOLD': 'Trend is intact, healthy momentum, let profit run or normal minor consolidation',
                          'SELL': 'Momentum exhausted, severe overbought reversal, or breakdown'
                        }
                      }
                    }
                  }),
                  signal: AbortSignal.timeout(6000)
                });
                if (jRes.ok) {
                  const jData = await jRes.json();
                  const choice = jData.answers?.verdict?.choice;
                  const prob = jData.answers?.verdict?.probabilities?.[choice] ?? 0.8;
                  console.log(`[AI Sentinel Jev Position Check] ${h.symbol}: Verdict=${choice} (Prob: ${(prob * 100).toFixed(0)}%)`);
                  if (choice === 'SELL' && prob >= 0.70) {
                    shouldExtend = false;
                    evalNote = `AI Jev วินิจฉัยสั่ง SELL (Prob ${(prob * 100).toFixed(0)}%) โมเมนตัมชะลอตัว`;
                  } else if (choice === 'HOLD' && prob >= 0.65) {
                    shouldExtend = true;
                    evalNote = `AI Jev วินิจฉัยสั่ง HOLD (Prob ${(prob * 100).toFixed(0)}%) แนวโน้มยังแข็งแกร่งถือต่อ`;
                  }
                }
              } catch (je) {
                console.warn(`Jev position evaluator warning:`, je.message);
              }
            }
          } catch (e) {
            console.warn(`Time evaluator error for ${h.symbol}:`, e.message);
          }

          if (shouldExtend) {
            // EXTEND TIME & CHANGE TO NEW STRATEGY LABEL
            const addMinutes = newTf === '1h' ? 360 : 180;
            match.entryTimestamp = Date.now();
            match.maxHoldMinutes = addMinutes;
            match.targetTimeframe = newTf;
            match.primaryIndicator = newIndicator;
            console.log(`[TIME EXTENDED] ${h.symbol} extended +${addMinutes}m with new label: ${newIndicator} (${newTf})`);

            newLogs.push({
              id: Date.now().toString(),
              timestamp: Date.now(),
              time: getThaiTimeString(),
              action: '⏱️🔄 [TIME-EXTEND] ขยายเวลาถือต่อ',
              symbol: h.symbol,
              note: `ครบกำหนดแต่ ${evalNote} บอทขยายเวลาถือต่อ +${addMinutes}น. | อัปเดตกรอบเวลาเป็น [${newTf}] และเปลี่ยนสัญญาณกลยุทธ์เป็น [${newIndicator}]`,
              color: '#38bdf8'
            });
          } else {
            // CLOSE & SELL OUT
            console.log(`[TIME CLOSE] ${h.symbol} closing position: ${evalNote}`);
            const sellSize = formatCoinAmount(h.amount, h.symbol);
            const sellRes = await placeBitgetOrder({ symbol: h.symbol, side: 'sell', orderType: 'market', size: sellSize }, config);
            if (sellRes.code === '00000') {
              liveHoldingsConfig = liveHoldingsConfig.filter(lh => lh.symbol !== h.symbol);
              usdtAvailable += (h.amount * h.currentPrice);
              newLogs.push({
                id: Date.now().toString(),
                timestamp: Date.now(),
                time: getThaiTimeString(),
                action: '⏱️🛑 [TIME-CLOSE] ขายปิดพอร์ต',
                symbol: h.symbol,
                note: `หมดเวลาถือครอง (${Math.round(elapsedMin)}น.) และ ${evalNote} บอทสั่งขายตลาดที่ $${h.currentPrice} คืนเงินสด USDT สำเร็จ`,
                color: '#f59e0b'
              });
              holdings.splice(i, 1);
              i--;
              continue;
            } else {
              console.error(`Time-stop sell failed for ${h.symbol}:`, sellRes.code, sellRes.msg);
            }
          }
        }
      }
    }
  }

  // ==========================================
  // 5.5 DCA ACCUMULATION ENGINE (AUTONOMOUS TRANCHES 2, 3, 4)
  // ==========================================
  const maxTranches = config.maxTranches || 4;
  const tranchePercent = config.tranchePercent || 20;

  for (const h of holdings) {
    const match = liveHoldingsConfig.find(lh => lh.symbol === h.symbol);
    const avgCost = h.avgCost || (match && match.avgCostPrice > 0 ? match.avgCostPrice : 0);
    const currentTranches = match?.tranchesCount || 1;

    if (avgCost > 0 && currentTranches < maxTranches) {
      const dropPct = ((h.currentPrice - avgCost) / avgCost) * 100;
      // Trigger DCA when price is down by 3.0% or more from average cost
      if (dropPct <= -3.0) {
        console.log(`[CLOUD DCA] ${h.symbol} dipped ${dropPct.toFixed(2)}% (Tranche ${currentTranches}/${maxTranches}). Checking budget...`);
        const maxSpendable = Math.max(0, Math.floor((usdtAvailable - 0.05) * 100) / 100);
        let dcaBudget = Math.max(5, Math.floor((usdtAvailable * (tranchePercent / 100)) * 100) / 100);
        dcaBudget = Math.min(dcaBudget, maxSpendable);

        if (dcaBudget >= 5) {
          console.log(`[CLOUD DCA] Executing DCA buy for ${h.symbol} with budget $${dcaBudget.toFixed(2)} USDT...`);
          const buyRes = await placeBitgetOrder({
            symbol: h.symbol,
            side: 'buy',
            orderType: 'market',
            size: String(dcaBudget.toFixed(2))
          }, config);

          if (buyRes.code === '00000') {
            const coinsBought = dcaBudget / h.currentPrice;
            const oldAmount = h.amount;
            const oldInvested = match?.totalInvestedUsdt || (oldAmount * avgCost);
            const newAmount = oldAmount + coinsBought;
            const newInvested = oldInvested + dcaBudget;
            const newAvgCost = newInvested / newAmount;
            const nextTranche = currentTranches + 1;

            if (match) {
              match.avgCostPrice = parseFloat(newAvgCost.toFixed(4));
              match.totalAmount = newAmount;
              match.totalInvestedUsdt = newInvested;
              match.tranchesCount = nextTranche;
            } else {
              liveHoldingsConfig.push({
                symbol: h.symbol,
                baseCoin: h.baseCoin,
                totalAmount: newAmount,
                tranchesCount: nextTranche,
                avgCostPrice: parseFloat(newAvgCost.toFixed(4)),
                totalInvestedUsdt: newInvested,
                isPaper: false
              });
            }

            usdtAvailable = Math.max(0, usdtAvailable - dcaBudget);
            newLogs.push({
              id: Date.now().toString(),
              timestamp: Date.now(),
              time: getThaiTimeString(),
              action: '🔥⚡ [CLOUD AUTO DCA] BUY',
              symbol: h.symbol,
              note: `✓ [REAL BITGET] ช้อนซื้อ ${h.symbol} ไม้ที่ ${nextTranche}/${maxTranches} @ $${h.currentPrice} (ทุนเฉลี่ยใหม่: $${newAvgCost.toFixed(4)}) | ย่อลงมา ${dropPct.toFixed(1)}% ดึงต้นทุนเฉลี่ยลงสำเร็จ`,
              color: '#0ea5e9'
            });
          }
        }
      }
    }
  }

  // ==========================================
  // 5.6 AUTO REBALANCE ROTATION (WHEN CASH < $5)
  // ==========================================
  if (usdtAvailable < 5 && config.autoRebalanceEnabled && holdings.length > 0) {
    // Find stagnant holding (|pnl| < 2.5%)
    const stagnant = holdings.find(h => typeof h.pnlPct === 'number' && Math.abs(h.pnlPct) < 2.5);
    // Find if another holding needs DCA urgently
    const urgentDip = holdings.find(h => h.symbol !== stagnant?.symbol && typeof h.pnlPct === 'number' && h.pnlPct <= -3.5);

    if (stagnant && urgentDip) {
      console.log(`[CLOUD REBALANCE] Rotating stagnant ${stagnant.symbol} to fund dip in ${urgentDip.symbol}...`);
      const sellSize = formatCoinAmount(stagnant.amount, stagnant.symbol);
      const sellRes = await placeBitgetOrder({
        symbol: stagnant.symbol,
        side: 'sell',
        orderType: 'market',
        size: sellSize
      }, config);

      if (sellRes.code === '00000') {
        liveHoldingsConfig = liveHoldingsConfig.filter(lh => lh.symbol !== stagnant.symbol);
        const freedUsdt = stagnant.amount * stagnant.currentPrice;
        usdtAvailable += freedUsdt;

        await new Promise(r => setTimeout(r, 1500));

        // Re-buy urgent dip
        const maxSpend = Math.max(0, Math.floor((usdtAvailable - 0.05) * 100) / 100);
        if (maxSpend >= 5) {
          const buyRes = await placeBitgetOrder({
            symbol: urgentDip.symbol,
            side: 'buy',
            orderType: 'market',
            size: String(maxSpend.toFixed(2))
          }, config);

          if (buyRes.code === '00000') {
            newLogs.push({
              id: Date.now().toString(),
              timestamp: Date.now(),
              time: getThaiTimeString(),
              action: '🔄 [CLOUD AUTO REBALANCE]',
              symbol: `${stagnant.symbol} ➜ ${urgentDip.symbol}`,
              note: `สลับเงินทุนอัตโนมัติ: ปิดเหรียญนิ่ง ${stagnant.symbol} ดึงเงินสด $${maxSpend.toFixed(2)} เข้าสะสม ${urgentDip.symbol} ที่กำลังย่อตัวสำเร็จ`,
              color: '#a855f7'
            });
          }
        }
      }
    }
  }

  // ==========================================
  // 6. MULTI-TIMEFRAME CANDIDATE SCREENING & AUTO-BUY
  // ==========================================
  const screenerMatrix = [];
  const STABLECOINS = ['USDC', 'USDGO', 'FDUSD', 'USDE', 'DAI', 'TUSD', 'EUR', 'BUSD'];
  const REAL_R_CRYPTO = ['RENDERUSDT', 'ROSEUSDT', 'RUNEUSDT', 'RAYUSDT', 'REQUSDT'];
  const heldSymbols = new Set(holdings.map(h => h.symbol));

  const liquidPairs = (tickersJson.data || [])
    .filter(item => {
      if (!item.symbol || !item.symbol.endsWith('USDT')) return false;
      const sym = item.symbol;
      if (sym.includes('_')) return false;
      if (sym.startsWith('R') && !REAL_R_CRYPTO.includes(sym)) return false;
      const base = sym.replace('USDT', '');
      if (STABLECOINS.includes(base)) return false;
      const vol = parseFloat(item.usdtVolume || '0');
      const price = parseFloat(item.lastPr || '0');
      return price > 0 && vol > 1000000;
    })
    .sort((a, b) => parseFloat(b.usdtVolume || '0') - parseFloat(a.usdtVolume || '0'))
    .slice(0, 20);

  console.log(`Analyzing Multi-Timeframe indicators for Top ${liquidPairs.length} liquid coins...`);

  for (const pair of liquidPairs) {
    const sym = pair.symbol;
    const price = parseFloat(pair.lastPr || '0');
    const change24h = parseFloat(pair.change24h || '0') * 100;
    const vol = parseFloat(pair.usdtVolume || '0');

    // Parallel fetch 5m, 15m, 1h candles
    const [c5m, c15m, c1h] = await Promise.all([
      fetchBitgetCandles(sym, '5min', '30'),
      fetchBitgetCandles(sym, '15min', '30'),
      fetchBitgetCandles(sym, '1h', '30')
    ]);

    const confluence = indicators.calculateMultiTimeframeConfluence(c5m, c15m, c1h);
    screenerMatrix.push({
      symbol: sym,
      baseCoin: sym.replace('USDT', ''),
      price,
      change24h,
      vol,
      totalScore: confluence.totalScore,
      grade: confluence.grade,
      bestTf: confluence.bestTf,
      primaryIndicator: confluence.primaryIndicator,
      isSupertrendBullish: confluence.isSupertrendBullish,
      timeframes: confluence.timeframes,
      updatedAt: Date.now()
    });
  }

  // Sort matrix by totalScore descending
  screenerMatrix.sort((a, b) => b.totalScore - a.totalScore);

  if (ACTION_INPUT === 'cycle' && usdtAvailable >= 5 && holdings.length < (config.maxCoins || 4)) {
    console.log(`Cash available ($${usdtAvailable.toFixed(2)}) & slots open (${holdings.length}/${config.maxCoins || 4}). Finding Grade A/A+ candidates...`);

    const minEntryScore = holdings.length === 0 ? 60 : 65;
    const buyCandidates = screenerMatrix
      .filter(c => !heldSymbols.has(c.symbol) && c.totalScore >= minEntryScore && c.primaryIndicator !== 'NEUTRAL');

    if (buyCandidates.length > 0) {
      const best = buyCandidates[0];
      const tfData = best.timeframes[best.bestTf] || best.timeframes['15m'];
      const atrVal = tfData.atrVal || (best.price * 0.02);

      // Volatility-Adaptive TP (2x ATR or Fibo) and SL (SuperTrend or 1.5x ATR)
      const tpTargetPrice = parseFloat((best.price + 2.0 * atrVal).toFixed(4));
      const slTargetPrice = parseFloat(Math.min(
        best.price * 0.96,
        tfData.supertrendPrice > 0 ? tfData.supertrendPrice : (best.price - 1.5 * atrVal)
      ).toFixed(4));

      // Adaptive Time-Stop Duration (minutes)
      let maxHoldMinutes = 180; // 3 hours (15m default)
      if (best.bestTf === '5m') maxHoldMinutes = 90; // 1.5 hours
      else if (best.bestTf === '1h') maxHoldMinutes = 360; // 6 hours

      console.log(`Top Candidate: ${best.symbol} (Score ${best.totalScore}/100 Grade ${best.grade}) @ $${best.price} | Trigger: ${best.primaryIndicator} (${best.bestTf}) | TP: $${tpTargetPrice}, SL: $${slTargetPrice}, TimeStop: ${maxHoldMinutes}m`);

      // Consult Multi-Tier AI Sentinel:
      // Tier 1: TypeSafe Jev (System One Fast Decision Engine & Calibrated Probability)
      // Tier 2: Groq (LPU Ultra-fast Generative LLM - Qwen/Llama)
      // Tier 3: OpenRouter (Free Tier Generative LLM Fallback)
      // Tier 4: Pure Quant Multi-Timeframe Confluence Heuristic
      let aiDecision = { action: 'BUY_SPOT', confidence: 85, reason: `Multi-Timeframe Confluence Grade ${best.grade}` };
      let aiApproved = true;
      let aiModelUsed = 'quant_multi_tf';

      // ==========================================
      // TIER 1: TypeSafe Jev (System One Model)
      // ==========================================
      if (jevKey) {
        try {
          console.log(`[AI Sentinel Tier 1] Evaluating ${best.symbol} with TypeSafe Jev...`);
          const jevState = `Quant Score: ${best.totalScore}/100 (${best.grade}) for ${best.symbol} @ $${best.price}. Indicator: ${best.primaryIndicator} (${best.bestTf}). Proposed TP: $${tpTargetPrice}, SL: $${slTargetPrice}, Hold: ${maxHoldMinutes}m. RSI: ${best.rsi15m || 'N/A'}. 24h Change: ${best.change24h || 0}%.`;
          const jRes = await fetch('https://api.typesafe.ai/v1/systemone', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${jevKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              state: jevState,
              model: 'jev-latest',
              questions: {
                trade_decision: {
                  type: 'choice',
                  instructions: 'Should the quantitative trading bot execute a BUY_SPOT order for this candidate dip or HOLD/WAIT?',
                  criteria: {
                    'BUY_SPOT': 'Valid dip entry in uptrend, strong confluence score, favorable risk-reward ratio',
                    'HOLD': 'High risk, overbought, uncertain momentum, or unsafe chart structure'
                  }
                },
                risk_acceptable: {
                  type: 'noul',
                  instructions: 'Is the downside risk acceptable for spot accumulation?'
                }
              }
            }),
            signal: AbortSignal.timeout(6000)
          });

          if (jRes.ok) {
            const jData = await jRes.json();
            const choice = jData.answers?.trade_decision?.choice;
            const prob = jData.answers?.trade_decision?.probabilities?.BUY_SPOT ?? jData.answers?.trade_decision?.confidence ?? 0.8;
            const riskProb = jData.answers?.risk_acceptable?.noul ?? 0.5;

            aiModelUsed = `typesafe/${jData.model || 'jev-1.13'}`;
            aiDecision = {
              action: choice === 'BUY_SPOT' ? 'BUY_SPOT' : 'HOLD',
              confidence: Math.round(prob * 100),
              reason: `Jev Verdict: ${choice} (Prob: ${(prob * 100).toFixed(0)}%, Risk Pass: ${(riskProb * 100).toFixed(0)}%)`
            };
            if (choice === 'HOLD' || prob < 0.60) {
              aiApproved = false;
            }
            console.log(`[AI Sentinel Tier 1: Jev] Verdict: ${choice} | Prob: ${(prob * 100).toFixed(1)}% | Approved: ${aiApproved}`);
          } else {
            console.warn(`[AI Sentinel Tier 1] Jev returned HTTP ${jRes.status}, falling back to Tier 2 (Groq)...`);
          }
        } catch (e) {
          console.warn(`[AI Sentinel Tier 1] Jev call failed: ${e.message}, falling back to Tier 2 (Groq)...`);
        }
      }

      // ==========================================
      // TIER 2: Groq LPU (Generative Fallback)
      // ==========================================
      if (aiModelUsed === 'quant_multi_tf' && groqKey) {
        try {
          console.log(`[AI Sentinel Tier 2] Evaluating ${best.symbol} with Groq...`);
          const prompt = `Quant Score: ${best.totalScore}/100 (${best.grade}) for ${best.symbol} @ $${best.price}.
Trigger: ${best.primaryIndicator} (${best.bestTf}). Proposed TP: $${tpTargetPrice}, SL: $${slTargetPrice}, Hold: ${maxHoldMinutes}m.
Respond ONLY in JSON: {"action":"BUY_SPOT"|"HOLD","confidence":number,"reason":"short explanation"}`;

          const gRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'qwen/qwen3.8-27b',
              max_tokens: 300,
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            }),
            signal: AbortSignal.timeout(6000)
          });
          if (gRes.ok) {
            const gData = await gRes.json();
            const text = gData.choices?.[0]?.message?.content;
            if (text) {
              const parsed = JSON.parse(text);
              aiDecision = parsed;
              aiModelUsed = 'groq/qwen3.8-27b';
              if (parsed.action === 'HOLD') aiApproved = false;
              console.log(`[AI Sentinel Tier 2: Groq] Verdict: ${parsed.action} | Reason: ${parsed.reason}`);
            }
          }
        } catch (e) {
          console.warn('[AI Sentinel Tier 2] Groq failed, falling back to Tier 3 (OpenRouter):', e.message);
        }
      }

      // ==========================================
      // TIER 3: OpenRouter Free Models (Fallback)
      // ==========================================
      if (aiModelUsed === 'quant_multi_tf' && orKey) {
        try {
          console.log(`[AI Sentinel Tier 3] Evaluating ${best.symbol} with OpenRouter...`);
          const prompt = `Quant Score: ${best.totalScore}/100 (${best.grade}) for ${best.symbol} @ $${best.price}.
Trigger: ${best.primaryIndicator} (${best.bestTf}). Proposed TP: $${tpTargetPrice}, SL: $${slTargetPrice}, Hold: ${maxHoldMinutes}m.
Respond ONLY in JSON: {"action":"BUY_SPOT"|"HOLD","confidence":number,"reason":"short explanation"}`;

          const oRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'qwen/qwen3.8-27b:free',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            }),
            signal: AbortSignal.timeout(6000)
          });
          if (oRes.ok) {
            const oData = await oRes.json();
            const text = oData.choices?.[0]?.message?.content;
            if (text) {
              const parsed = JSON.parse(text);
              aiDecision = parsed;
              aiModelUsed = 'openrouter/qwen3.8-27b:free';
              if (parsed.action === 'HOLD') aiApproved = false;
              console.log(`[AI Sentinel Tier 3: OpenRouter] Verdict: ${parsed.action} | Reason: ${parsed.reason}`);
            }
          }
        } catch (e) {
          console.warn('[AI Sentinel Tier 3] OpenRouter failed, using Tier 4 Heuristic:', e.message);
        }
      }

      console.log(`[AI Sentinel Final] Model: ${aiModelUsed} | Action: ${aiDecision.action} | Approved: ${aiApproved}`);

      const maxAvailable = Math.max(0, Math.floor((usdtAvailable - 0.05) * 100) / 100);
      const buySize = Math.min(10, maxAvailable);

      if (buySize >= 5 && aiApproved) {
        const buyRes = await placeBitgetOrder({
          symbol: best.symbol,
          side: 'buy',
          orderType: 'market',
          size: String(buySize.toFixed(2))
        }, config);

        if (buyRes.code === '00000') {
          const coinsBought = buySize / best.price;
          liveHoldingsConfig.push({
            symbol: best.symbol,
            baseCoin: best.symbol.replace('USDT', ''),
            totalAmount: coinsBought,
            tranchesCount: 1,
            avgCostPrice: best.price,
            totalInvestedUsdt: buySize,
            currentPrice: best.price,
            takeProfitPrice: tpTargetPrice,
            cutLossPrice: slTargetPrice,
            targetTimeframe: best.bestTf,
            primaryIndicator: best.primaryIndicator,
            entryTimestamp: Date.now(),
            maxHoldMinutes: maxHoldMinutes,
            trailingSlPrice: slTargetPrice,
            breakevenLocked: false,
            manualLock: false,
            isPaper: false
          });

          const buyLog = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            time: getThaiTimeString(),
            action: '🚀 [CLOUD AUTO-BUY]',
            symbol: best.symbol,
            note: `เข้าซื้อสำเร็จ (${best.grade} Score ${best.totalScore}/100) ไม้ 1 มูลค่า $${buySize.toFixed(2)} USDT @ $${best.price} | สัญญาณ: ${best.primaryIndicator} (${best.bestTf}) | เป้า TP: $${tpTargetPrice}, SL: $${slTargetPrice} (Time-Stop ${maxHoldMinutes}m)`,
            color: '#10b981'
          };
          newLogs.push(buyLog);
        } else {
          newLogs.push({
            id: Date.now().toString(),
            timestamp: Date.now(),
            time: getThaiTimeString(),
            action: '🚨 [CLOUD AUTO-BUY] ไม่สำเร็จ',
            symbol: best.symbol,
            note: `Bitget API (${buyRes.code}): ${buyRes.msg || 'Order failed'}`,
            color: '#ef4444'
          });
        }
      } else if (buySize < 5 && aiApproved) {
        console.log(`Auto-buy skipped: USDT available ($${usdtAvailable.toFixed(2)}) is less than minimum $5`);
      } else {
        console.log(`AI Sentinel vetoed buy for ${best.symbol}: ${aiDecision.reason}`);
      }
    }
  }

  // 7. Push cycle health log, updated holdings, and screenerMatrix to Cloudflare D1
  const statusLog = {
    id: Date.now().toString(),
    timestamp: Date.now(),
    time: getThaiTimeString(),
    action: '🤖 [CLOUD 24/7] ตรวจสอบพอร์ต',
    symbol: 'AUTOTD',
    note: `สแกนพอร์ตเรียบร้อย ถือ ${liveHoldingsConfig.length}/${config.maxCoins || 4} เหรียญ | USDT ว่าง $${usdtAvailable.toFixed(2)} | อัปเดตตารางวิเคราะห์ 20 เหรียญลง D1 สำเร็จ`,
    color: '#38bdf8'
  };

  try {
    const existingLogs = Array.isArray(config.liveLogs) ? config.liveLogs : [];
    const updatedLogs = [statusLog, ...newLogs, ...existingLogs]
      .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
      .sort((a, b) => Number(b.timestamp || b.id || 0) - Number(a.timestamp || a.id || 0))
      .slice(0, 30);
    const normalizedLiveHoldings = (liveHoldingsConfig || []).map(lh => {
      const match = (holdings || []).find(h => h.symbol === lh.symbol);
      const curPrice = match?.currentPrice || lh.currentPrice || lh.avgCostPrice || 0;
      const avgCost = lh.avgCostPrice > 0 ? lh.avgCostPrice : curPrice;
      const amount = lh.totalAmount || match?.amount || 0;
      const invested = lh.totalInvestedUsdt || (avgCost * amount);
      const unPnl = (curPrice - avgCost) * amount;
      const pnlPct = avgCost > 0 ? ((curPrice - avgCost) / avgCost) * 100 : 0;
      const netPnlPct = pnlPct - BITGET_ROUNDTRIP_FEE_PCT;
      const estFee = (invested * BITGET_SPOT_FEE_RATE) + ((curPrice * amount) * BITGET_SPOT_FEE_RATE);
      return {
        ...lh,
        currentPrice: parseFloat(curPrice.toFixed(6)),
        avgCostPrice: parseFloat(avgCost.toFixed(6)),
        totalAmount: amount,
        totalInvestedUsdt: parseFloat(invested.toFixed(2)),
        unrealizedPnlUsdt: parseFloat(unPnl.toFixed(2)),
        pnlPercent: parseFloat(pnlPct.toFixed(2)),
        netPnlPercent: parseFloat(netPnlPct.toFixed(2)),
        estFeeUsdt: parseFloat(estFee.toFixed(4)),
        takeProfitPrice: lh.takeProfitPrice || parseFloat((avgCost * (1 + tpTarget / 100)).toFixed(6)),
        cutLossPrice: lh.cutLossPrice || parseFloat((avgCost * (1 - slTarget / 100)).toFixed(6)),
      };
    });

    await fetch(CLOUD_CONFIG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        liveHoldings: normalizedLiveHoldings,
        screenerMatrix: screenerMatrix,
        liveLogs: updatedLogs
      })
    });
    console.log('Pushed cloud health log, holdings & screenerMatrix to D1 successfully.');
  } catch (syncErr) {
    console.warn('Sync log error:', syncErr.message);
  }

  console.log('[AutoTD Cloud Trader] Cycle completed successfully.');
}

runAutopilotCycle().catch(console.error);
