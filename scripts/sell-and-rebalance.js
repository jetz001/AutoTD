const crypto = require('crypto');

const BITGET_HOST = 'https://api.bitget.com';
const CLOUD_CONFIG_URL = 'https://autotd.pages.dev/api/config';

function signBitgetRequest(timestamp, method, requestPath, queryString, bodyStr, secretKey) {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? '?' + queryString : '') + (bodyStr || '');
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
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

function formatCoinAmount(amount, symbol) {
  const precision = BITGET_QTY_PRECISION_MAP[symbol] || 2;
  const factor = Math.pow(10, precision);
  const truncated = Math.floor(amount * factor) / factor;
  return truncated.toFixed(precision);
}

async function placeBitgetOrder(order, config) {
  const timestamp = Date.now().toString();
  const requestPath = '/api/v2/spot/trade/place-order';
  const payload = {
    symbol: order.symbol,
    side: order.side,
    orderType: order.orderType || 'market',
    size: String(order.size),
    clientOid: `sell_${Date.now()}`
  };

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

  return await res.json();
}

async function fetchRealBitgetAssets(config) {
  const timestamp = Date.now().toString();
  const requestPath = '/api/v2/spot/account/assets';
  const sign = signBitgetRequest(timestamp, 'GET', requestPath, '', '', config.secretKey);
  const res = await fetch(`${BITGET_HOST}${requestPath}`, {
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
  }
  return null;
}

async function main() {
  console.log('[Sell & Rebalance] Fetching cloud config...');
  const cfgRes = await fetch(CLOUD_CONFIG_URL);
  const cfgJson = await cfgRes.json();
  const config = cfgJson.data;

  if (!config || !config.apiKey) {
    console.error('Cannot load Bitget API credentials');
    return;
  }

  // 1. Fetch current assets
  const assetData = await fetchRealBitgetAssets(config);
  if (!assetData) {
    console.error('Cannot fetch assets from Bitget');
    return;
  }

  console.log(`Current USDT Available: $${assetData.usdtAvailable.toFixed(4)}`);
  const coinsToSell = ['QNT', 'KII', 'ZEC'];
  const sellLogs = [];

  for (const coin of coinsToSell) {
    const asset = assetData.assets.find(a => a.coin === coin);
    const sym = `${coin}USDT`;
    if (!asset || asset.available <= 0) {
      console.log(`Coin ${coin}: No available balance (${asset?.available || 0})`);
      continue;
    }

    const sellSize = formatCoinAmount(asset.available, sym);
    console.log(`Executing Market Sell for ${sym} (Amount: ${sellSize})...`);
    const sellRes = await placeBitgetOrder({
      symbol: sym,
      side: 'sell',
      orderType: 'market',
      size: sellSize
    }, config);

    console.log(`Result for ${sym}:`, sellRes.code, sellRes.msg || 'OK');
    if (sellRes.code === '00000') {
      sellLogs.push({
        id: Date.now().toString(),
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }),
        action: '🎯 [MANUAL SELL ALL] ขายปิดไม้สำเร็จ',
        symbol: sym,
        note: `ขายปิด ${coin} ทั้งหมด (${sellSize} ${coin}) คืนทุนเป็น USDT สำเร็จ orderId=${sellRes.data?.orderId}`,
        color: '#10b981'
      });
    } else {
      sellLogs.push({
        id: Date.now().toString(),
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }),
        action: '🚨 [MANUAL SELL ALL] ขายไม่สำเร็จ',
        symbol: sym,
        note: `Bitget API (${sellRes.code}): ${sellRes.msg || 'Error'}`,
        color: '#ef4444'
      });
    }
  }

  // Wait 2 seconds for settlement
  await new Promise(r => setTimeout(r, 2000));

  // 2. Fetch updated assets
  const updatedAssetData = await fetchRealBitgetAssets(config);
  console.log(`Updated USDT Available: $${updatedAssetData?.usdtAvailable?.toFixed(4) || 'N/A'}`);

  // 3. Clear sold coins from Cloudflare D1 liveHoldings
  const existingHoldings = Array.isArray(config.liveHoldings) ? config.liveHoldings : [];
  const remainingHoldings = existingHoldings.filter(h => !coinsToSell.includes(h.baseCoin) && !coinsToSell.some(c => h.symbol.startsWith(c)));
  const existingLogs = Array.isArray(config.liveLogs) ? config.liveLogs : [];
  const updatedLogs = [...sellLogs, ...existingLogs].slice(0, 30);

  console.log(`Updating Cloudflare D1 (Remaining live holdings: ${remainingHoldings.length})...`);
  await fetch(CLOUD_CONFIG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      liveHoldings: remainingHoldings,
      liveLogs: updatedLogs
    })
  });

  console.log('[Sell & Rebalance] Completed sell step. Now triggering cloud scan cycle...');
}

main().catch(console.error);
