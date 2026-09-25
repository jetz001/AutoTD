interface Env {
  BITGET_API_KEY?: string;
  BITGET_SECRET_KEY?: string;
  BITGET_PASSPHRASE?: string;
}

const BITGET_HOST = "https://api.bitget.com";

async function generateSignature(
  timestamp: string,
  method: string,
  requestPath: string,
  queryString: string,
  body: string,
  secretKey: string
): Promise<string> {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? `?${queryString}` : "") + (body || "");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function getCredentials(request: Request, env: Env, bodyJson?: any) {
  const apiKey =
    request.headers.get("x-bitget-key") ||
    bodyJson?.apiKey ||
    env.BITGET_API_KEY ||
    "";
  const secretKey =
    request.headers.get("x-bitget-secret") ||
    bodyJson?.secretKey ||
    env.BITGET_SECRET_KEY ||
    "";
  const passphrase =
    request.headers.get("x-bitget-passphrase") ||
    bodyJson?.passphrase ||
    env.BITGET_PASSPHRASE ||
    "";
  return { apiKey, secretKey, passphrase };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-bitget-key, x-bitget-secret, x-bitget-passphrase",
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "assets";

  if (request.method === "GET") {
    const { apiKey, secretKey, passphrase } = getCredentials(request, env);
    if (!apiKey || !secretKey || !passphrase) {
      return Response.json(
        { code: "40001", msg: "Missing Bitget API credentials (API Key, Secret Key, or Passphrase)" },
        { status: 400, headers: corsHeaders }
      );
    }

    try {
      let requestPath = "/api/v2/spot/account/assets";
      let queryString = "";

      if (action === "orders") {
        const symbol = url.searchParams.get("symbol") || "";
        requestPath = "/api/v2/spot/trade/unfilled-orders";
        if (symbol) queryString = `symbol=${symbol}`;
      } else if (action === "history") {
        const symbol = url.searchParams.get("symbol") || "";
        requestPath = "/api/v2/spot/trade/history-orders";
        if (symbol) queryString = `symbol=${symbol}`;
      } else if (action === "check") {
        requestPath = "/api/v2/spot/account/assets";
      }

      const timestamp = Date.now().toString();
      const sign = await generateSignature(timestamp, "GET", requestPath, queryString, "", secretKey);

      const targetUrl = `${BITGET_HOST}${requestPath}${queryString ? `?${queryString}` : ""}`;
      const res = await fetch(targetUrl, {
        headers: {
          "ACCESS-KEY": apiKey,
          "ACCESS-SIGN": sign,
          "ACCESS-TIMESTAMP": timestamp,
          "ACCESS-PASSPHRASE": passphrase,
          "Content-Type": "application/json",
          locale: "en-US",
        },
      });

      const data = await res.json();
      return Response.json(data, { headers: corsHeaders });
    } catch (err: any) {
      return Response.json({ code: "50000", msg: err.message }, { status: 500, headers: corsHeaders });
    }
  }

  if (request.method === "POST") {
    let bodyJson: any = {};
    try {
      bodyJson = await request.json();
    } catch {
      bodyJson = {};
    }

    const { apiKey, secretKey, passphrase } = getCredentials(request, env, bodyJson);
    if (!apiKey || !secretKey || !passphrase) {
      return Response.json(
        { code: "40001", msg: "Missing Bitget API credentials (API Key, Secret Key, or Passphrase)" },
        { status: 400, headers: corsHeaders }
      );
    }

    try {
      let requestPath = "/api/v2/spot/trade/place-order";
      let payload: any = {
        symbol: bodyJson.symbol,
        side: bodyJson.side,
        orderType: bodyJson.orderType || "market",
        size: String(bodyJson.size),
        clientOid: bodyJson.clientOid || `td_${Date.now()}`,
      };

      if (bodyJson.price) {
        payload.price = String(bodyJson.price);
      }

      if (action === "cancel" || bodyJson.action === "cancel") {
        requestPath = "/api/v2/spot/trade/cancel-order";
        payload = {
          symbol: bodyJson.symbol,
          orderId: bodyJson.orderId,
        };
      }

      const bodyStr = JSON.stringify(payload);
      const timestamp = Date.now().toString();
      const sign = await generateSignature(timestamp, "POST", requestPath, "", bodyStr, secretKey);

      const res = await fetch(`${BITGET_HOST}${requestPath}`, {
        method: "POST",
        headers: {
          "ACCESS-KEY": apiKey,
          "ACCESS-SIGN": sign,
          "ACCESS-TIMESTAMP": timestamp,
          "ACCESS-PASSPHRASE": passphrase,
          "Content-Type": "application/json",
          locale: "en-US",
        },
        body: bodyStr,
      });

      const data = await res.json();
      return Response.json(data, { headers: corsHeaders });
    } catch (err: any) {
      return Response.json({ code: "50000", msg: err.message }, { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
};
