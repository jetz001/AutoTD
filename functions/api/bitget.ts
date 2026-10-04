interface Env {
  AUTOTD_KV?: KVNamespace;
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

async function getCredentials(request: Request, env: any, bodyJson?: any) {
  let apiKey =
    request.headers.get("x-bitget-key") ||
    bodyJson?.apiKey ||
    env?.BITGET_API_KEY ||
    env?.BITGET_KEY ||
    env?.BG_API_KEY ||
    env?.BG_KEY ||
    "";
  let secretKey =
    request.headers.get("x-bitget-secret") ||
    bodyJson?.secretKey ||
    env?.BITGET_SECRET_KEY ||
    env?.BITGET_SECRET ||
    env?.BG_SECRET_KEY ||
    env?.BG_SECRET ||
    "";
  let passphrase =
    request.headers.get("x-bitget-passphrase") ||
    bodyJson?.passphrase ||
    env?.BITGET_PASSPHRASE ||
    env?.BITGET_PASS ||
    env?.BITGET_PASSWORD ||
    env?.BG_PASSPHRASE ||
    env?.BG_PASS ||
    "";

  if (env?.AUTOTD_KV && (!apiKey || !secretKey || !passphrase)) {
    try {
      const raw = await env.AUTOTD_KV.get("user_config");
      if (raw) {
        const u = JSON.parse(raw);
        if (u.apiKey && !apiKey) apiKey = u.apiKey;
        if (u.secretKey && !secretKey) secretKey = u.secretKey;
        if (u.passphrase && !passphrase) passphrase = u.passphrase;
      }
    } catch {}
  }

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
    if (action === "sync-config") {
      const creds = await getCredentials(request, env);
      return Response.json(
        {
          code: "00000",
          data: {
            apiKey: creds.apiKey || "",
            secretKey: creds.secretKey || "",
            passphrase: creds.passphrase || "",
            hasCredentials: Boolean(creds.apiKey && creds.secretKey && creds.passphrase),
          },
        },
        { headers: corsHeaders }
      );
    }

    if (action === "candles") {
      try {
        const symbol = url.searchParams.get("symbol") || "";
        const granularity = url.searchParams.get("granularity") || "15min";
        const limit = url.searchParams.get("limit") || "100";
        const targetUrl = `${BITGET_HOST}/api/v2/spot/market/candles?symbol=${symbol}&granularity=${granularity}&limit=${limit}`;
        const res = await fetch(targetUrl);
        const data = await res.json();
        return Response.json(data, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ code: "50000", msg: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    const { apiKey, secretKey, passphrase } = await getCredentials(request, env);
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
        const limit = url.searchParams.get("limit") || "50";
        requestPath = "/api/v2/spot/trade/history-orders";
        const qParts: string[] = [];
        if (symbol) qParts.push(`symbol=${symbol}`);
        if (limit) qParts.push(`limit=${limit}`);
        queryString = qParts.join("&");
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
          "Accept": "application/json",
          "User-Agent": "Bitget-Client/1.0",
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

    const { apiKey, secretKey, passphrase } = await getCredentials(request, env, bodyJson);
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
          "Accept": "application/json",
          "User-Agent": "Bitget-Client/1.0",
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
