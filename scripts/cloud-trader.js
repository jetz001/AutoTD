// AutoTD 24/7 Autonomous Cloud Trader Engine
// Runs on GitHub Actions (Microsoft Azure / AWS runners) 24/7
// Zero local PC dependency, zero Cloudflare WAF block

const crypto = require('crypto');

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

function getCoinPrecision(symbol) {
  if (symbol.includes('BTC')) return 6;
  if (symbol.includes('ETH') || symbol.includes('SOL') || symbol.includes('TAO')) return 4;
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
        currentPrice: price
      });
    }
  }

  console.log(`Current Spot Holdings (${holdings.length}/${config.maxCoins || 4}):`, holdings.map(h => `${h.baseCoin} ($${h.valUsd.toFixed(2)})`).join(', '));

  const newLogs = [];

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
          time: new Date().toLocaleTimeString('th-TH'),
          action: '🎯 [CLOUD SELL] คำสั่งสำเร็จ',
          symbol: targetSym,
          note: `ขายสำเร็จบน Bitget Spot orderId=${orderId}`,
          color: '#10b981'
        });
      } else {
        console.error('On-demand sell failed:', sellRes.code, sellRes.msg);
        newLogs.push({
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString('th-TH'),
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
        time: new Date().toLocaleTimeString('th-TH'),
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
          time: new Date().toLocaleTimeString('th-TH'),
          action: '🚀 [CLOUD BUY] คำสั่งสำเร็จ',
          symbol: targetSym,
          note: `เข้าซื้อสำเร็จบน Bitget Spot orderId=${orderId} มูลค่า $${buySize.toFixed(2)} USDT`,
          color: '#10b981'
        });
      } else {
        console.error('On-demand buy failed:', buyRes.code, buyRes.msg);
        newLogs.push({
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString('th-TH'),
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
  const tpTarget = config.takeProfitPercent || 3.5;
  const slTarget = config.cutLossPercent || 5.0;
  const liveHoldingsConfig = Array.isArray(config.liveHoldings) ? config.liveHoldings : [];

  for (const h of holdings) {
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
      console.log(`Holding ${h.symbol}: Price $${h.currentPrice}, AvgCost $${avgCost}, PnL: ${pnlPct.toFixed(2)}% (TP: +${tpTarget}%, SL: -${slTarget}%)`);

      // 5.1 Take Profit
      if (pnlPct >= tpTarget) {
        console.log(`🚀 [CLOUD TAKE-PROFIT TRIGGERED] ${h.symbol} hit +${pnlPct.toFixed(2)}% >= +${tpTarget}%! Executing market sell...`);
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
            time: new Date().toLocaleTimeString('th-TH'),
            action: '🎯 [CLOUD AUTO-TAKE PROFIT]',
            symbol: h.symbol,
            note: `ล็อคกำไรสำเร็จ @ $${h.currentPrice} (+${pnlPct.toFixed(2)}%) ดึง USDT กลับกระเป๋า Spot`,
            color: '#10b981'
          });
        }
      }
      // 5.2 Cut Loss
      else if (pnlPct <= -slTarget) {
        console.log(`🚨 [CLOUD CUT-LOSS TRIGGERED] ${h.symbol} hit ${pnlPct.toFixed(2)}% <= -${slTarget}%! Executing market sell...`);
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
            time: new Date().toLocaleTimeString('th-TH'),
            action: '🚨 [CLOUD AUTO-CUT LOSS]',
            symbol: h.symbol,
            note: `คัทลอสรักษาทุน @ $${h.currentPrice} (${pnlPct.toFixed(2)}%)`,
            color: '#ef4444'
          });
        }
      }
    }
  }

  // ==========================================
  // 6. CANDIDATE SCREENING & AUTO-BUY (DIP IN UPTREND)
  // ==========================================
  if (ACTION_INPUT === 'cycle' && usdtAvailable >= 10 && holdings.length < (config.maxCoins || 4)) {
    console.log(`Cash available ($${usdtAvailable.toFixed(2)}) & slots open (${holdings.length}/${config.maxCoins || 4}). Scanning candidates...`);
    const STABLECOINS = ['USDC', 'USDGO', 'FDUSD', 'USDE', 'DAI', 'TUSD', 'EUR', 'BUSD'];
    const REAL_R_CRYPTO = ['RENDERUSDT', 'ROSEUSDT', 'RUNEUSDT', 'RAYUSDT', 'REQUSDT'];
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

      // Consult Groq (Primary) & OpenRouter (Fallback) AI Sentinel
      let aiDecision = { action: 'BUY_SPOT', confidence: 85, reason: 'Quant Heuristics Score >= 80' };
      const groqKey = config.groqApiKey || process.env.GROQ_API_KEY;
      const orKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY;

      const prompt = `Evaluate Dip-in-Uptrend buy for ${best.symbol} @ $${best.price} (24h Change: ${best.change.toFixed(2)}%, Quant Score: ${best.totalScore}/100, Volume: $${best.vol.toLocaleString()}). Respond ONLY in valid JSON: {"action":"BUY_SPOT"|"HOLD","confidence":number,"reason":"short explanation"}`;

      let aiApproved = true;
      let aiModelUsed = 'quant_score';

      if (groqKey) {
        try {
          const gRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'qwen/qwen3.8-27b',
              max_tokens: 300,
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            })
          });
          if (gRes.ok) {
            const gData = await gRes.json();
            const text = gData.choices?.[0]?.message?.content;
            if (text) {
              const parsed = JSON.parse(text);
              aiDecision = parsed;
              aiModelUsed = 'groq/qwen3.8-27b';
              if (parsed.action === 'HOLD' && parsed.confidence >= 70) aiApproved = false;
            }
          }
        } catch (e) {
          console.warn('Groq cloud sentinel warning:', e.message);
        }
      }

      if (aiModelUsed === 'quant_score' && orKey) {
        try {
          const oRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'qwen/qwen3.8-27b:free',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            })
          });
          if (oRes.ok) {
            const oData = await oRes.json();
            const text = oData.choices?.[0]?.message?.content;
            if (text) {
              const parsed = JSON.parse(text);
              aiDecision = parsed;
              aiModelUsed = 'openrouter/qwen3.8-27b:free';
              if (parsed.action === 'HOLD' && parsed.confidence >= 70) aiApproved = false;
            }
          }
        } catch (e) {
          console.warn('OpenRouter cloud sentinel warning:', e.message);
        }
      }

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
          const buyLog = {
            id: Date.now().toString(),
            time: new Date().toLocaleTimeString('th-TH'),
            action: '🚀 [CLOUD AUTO-BUY]',
            symbol: best.symbol,
            note: `ช้อนซื้อ Dip in Uptrend สำเร็จ (${aiModelUsed} Score ${best.totalScore}/100) มูลค่า $${buySize.toFixed(2)} USDT @ $${best.price} | เหตุผล: ${aiDecision.reason || 'AI ผ่านเกณฑ์'}`,
            color: '#10b981'
          };
          newLogs.push(buyLog);
        } else {
          newLogs.push({
            id: Date.now().toString(),
            time: new Date().toLocaleTimeString('th-TH'),
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

  // 7. Push cycle health log update to Cloudflare
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
