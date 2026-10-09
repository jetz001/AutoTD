const crypto = require('crypto');

async function convertDustCoins() {
  const cfgRes = await fetch('https://autotd.pages.dev/api/config');
  const cfg = (await cfgRes.json()).data;
  if (!cfg || !cfg.apiKey) {
    console.error('No credentials found');
    return;
  }

  // 1. Fetch convertible coins
  const timestamp = Date.now().toString();
  const requestPath = '/api/v2/convert/bgb-convert-coin-list';
  const sign = crypto.createHmac('sha256', cfg.secretKey).update(timestamp + 'GET' + requestPath).digest('base64');
  
  const listRes = await fetch('https://api.bitget.com' + requestPath, {
    headers: {
      'ACCESS-KEY': cfg.apiKey,
      'ACCESS-SIGN': sign,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': cfg.passphrase,
      'Content-Type': 'application/json'
    }
  });

  const listJson = await listRes.json();
  if (listJson.code !== '00000' || !Array.isArray(listJson.data?.coinList)) {
    console.error('Failed to get coin list:', listJson);
    return;
  }

  // Active positions we must NEVER convert: BTC, UPC, USDT (or any coin >= $4)
  const excludeCoins = new Set(['BTC', 'UPC', 'USDT', 'BGB']);

  const dustCoinsToConvert = listJson.data.coinList
    .map(c => c.coin)
    .filter(coin => !excludeCoins.has(coin));

  console.log('Dust coins identified for conversion to BGB:', dustCoinsToConvert);

  if (dustCoinsToConvert.length === 0) {
    console.log('No dust coins to convert.');
    return;
  }

  // 2. Execute BGB Convert
  const postPath = '/api/v2/convert/bgb-convert';
  const postPayload = { coinList: dustCoinsToConvert };
  const postBody = JSON.stringify(postPayload);
  const postTime = Date.now().toString();
  const postSign = crypto.createHmac('sha256', cfg.secretKey).update(postTime + 'POST' + postPath + postBody).digest('base64');

  const convertRes = await fetch('https://api.bitget.com' + postPath, {
    method: 'POST',
    headers: {
      'ACCESS-KEY': cfg.apiKey,
      'ACCESS-SIGN': postSign,
      'ACCESS-TIMESTAMP': postTime,
      'ACCESS-PASSPHRASE': cfg.passphrase,
      'Content-Type': 'application/json'
    },
    body: postBody
  });

  const convertJson = await convertRes.json();
  console.log('Conversion Result:', JSON.stringify(convertJson, null, 2));

  // 3. Check current BGB balance
  const assetPath = '/api/v2/spot/account/assets';
  const aTime = Date.now().toString();
  const aSign = crypto.createHmac('sha256', cfg.secretKey).update(aTime + 'GET' + assetPath).digest('base64');
  const assetRes = await fetch('https://api.bitget.com' + assetPath, {
    headers: {
      'ACCESS-KEY': cfg.apiKey,
      'ACCESS-SIGN': aSign,
      'ACCESS-TIMESTAMP': aTime,
      'ACCESS-PASSPHRASE': cfg.passphrase,
      'Content-Type': 'application/json'
    }
  });
  const assetJson = await assetRes.json();
  const bgbAsset = assetJson.data?.find(a => a.coin === 'BGB');
  console.log('Current BGB balance:', bgbAsset);
}

convertDustCoins();
