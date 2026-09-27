const http = require('http');
const crypto = require('crypto');

const PORT = 8787;
const BITGET_HOST = 'https://api.bitget.com';

function sign(timestamp, method, path, queryString, bodyStr, secretKey) {
  const message = timestamp + method.toUpperCase() + path + (queryString ? '?' + queryString : '') + (bodyStr || '');
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
}

const server = http.createServer(async (req, res) => {
  // CORS Headers supporting Private Network Access from https://autotd.pages.dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', bridge: 'AutoTD Local Bridge' }));
    return;
  }

  if (url.pathname === '/api/order' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { apiKey, secretKey, passphrase, order } = data;
        if (!apiKey || !secretKey || !passphrase || !order) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: '40001', msg: 'Missing credentials or order params' }));
          return;
        }

        const timestamp = Date.now().toString();
        const requestPath = '/api/v2/spot/trade/place-order';
        const payload = {
          symbol: order.symbol,
          side: order.side,
          orderType: order.orderType || 'market',
          size: String(order.size),
          clientOid: order.clientOid || `td_${Date.now()}`
        };
        if (order.price) {
          payload.price = String(order.price);
          payload.force = 'gtc';
        }

        const bodyStr = JSON.stringify(payload);
        const signature = sign(timestamp, 'POST', requestPath, '', bodyStr, secretKey);

        const response = await fetch(`${BITGET_HOST}${requestPath}`, {
          method: 'POST',
          headers: {
            'ACCESS-KEY': apiKey,
            'ACCESS-SIGN': signature,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-PASSPHRASE': passphrase,
            'Content-Type': 'application/json',
            'locale': 'en-US'
          },
          body: bodyStr
        });

        const resData = await response.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resData));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: '50000', msg: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: '40400', msg: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[AutoTD Local Bridge] Running on http://127.0.0.1:${PORT}`);
});
