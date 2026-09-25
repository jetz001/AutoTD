// Bitget V2 REST API Client for Cloudflare Workers (Web Crypto HMAC-SHA256)

export interface BitgetConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  isSimulated?: boolean;
}

export class BitgetClient {
  private baseUrl: string;
  private apiKey: string;
  private secretKey: string;
  private passphrase: string;

  constructor(config: BitgetConfig) {
    this.baseUrl = "https://api.bitget.com";
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.passphrase = config.passphrase;
  }

  private async generateSignature(
    timestamp: string,
    method: string,
    requestPath: string,
    queryString: string,
    body: string
  ): Promise<string> {
    const message = timestamp + method.toUpperCase() + requestPath + (queryString ? `?${queryString}` : "") + (body || "");
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.secretKey),
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

  private async request(method: string, path: string, params: Record<string, any> = {}, bodyData?: any) {
    const timestamp = Date.now().toString();
    const queryString = method === "GET" && Object.keys(params).length > 0
      ? new URLSearchParams(params).toString()
      : "";
    const bodyStr = bodyData ? JSON.stringify(bodyData) : "";

    const signature = await this.generateSignature(timestamp, method, path, queryString, bodyStr);

    const headers: Record<string, string> = {
      "ACCESS-KEY": this.apiKey,
      "ACCESS-SIGN": signature,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": this.passphrase,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "locale": "en-US",
    };

    const url = `${this.baseUrl}${path}${queryString ? `?${queryString}` : ""}`;
    const response = await fetch(url, {
      method,
      headers,
      body: method !== "GET" ? bodyStr : undefined,
    });

    const data = await response.json();
    return data;
  }

  // --- ข้อมูลตลาด (Market Data - Public) ---
  async getTicker(symbol: string) {
    const res = await fetch(`${this.baseUrl}/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`);
    return await res.json();
  }

  async getCandles(symbol: string, granularity = "15m", limit = "30") {
    const res = await fetch(`${this.baseUrl}/api/v2/mix/market/candles?symbol=${symbol}&granularity=${granularity}&limit=${limit}&productType=USDT-FUTURES`);
    return await res.json();
  }

  // --- พอร์ตและสถานะบัญชี (Private) ---
  async getFuturesAccount(productType = "USDT-FUTURES") {
    return await this.request("GET", "/api/v2/mix/account/accounts", { productType });
  }

  async getSpotAccount() {
    return await this.request("GET", "/api/v2/spot/account/assets");
  }

  async getPositions(symbol?: string, productType = "USDT-FUTURES") {
    const params: Record<string, any> = { productType };
    if (symbol) params.symbol = symbol;
    return await this.request("GET", "/api/v2/mix/position/all-position", params);
  }

  // --- ส่งคำสั่งซื้อขาย (Order Execution) ---
  async placeFuturesOrder(order: {
    symbol: string;
    side: "buy" | "sell";
    orderType: "limit" | "market";
    size: string;
    tradeSide?: "open" | "close";
    marginMode?: "crossed" | "isolated";
    price?: string;
    presetStopLossPrice?: string;
    presetTakeProfitPrice?: string;
  }) {
    return await this.request("POST", "/api/v2/mix/order/place-order", {}, {
      productType: "USDT-FUTURES",
      symbol: order.symbol,
      marginMode: order.marginMode || "crossed",
      marginCoin: "USDT",
      size: order.size,
      side: order.side,
      tradeSide: order.tradeSide || "open",
      orderType: order.orderType,
      price: order.price,
      presetStopLossPrice: order.presetStopLossPrice,
      presetTakeProfitPrice: order.presetTakeProfitPrice,
    });
  }

  async placeSpotOrder(order: {
    symbol: string;
    side: "buy" | "sell";
    orderType: "limit" | "market";
    size: string;
    price?: string;
  }) {
    return await this.request("POST", "/api/v2/spot/trade/place-order", {}, {
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      size: order.size,
      price: order.price,
    });
  }

  async closeAllPositions(productType = "USDT-FUTURES") {
    return await this.request("POST", "/api/v2/mix/order/close-positions", {}, {
      productType,
    });
  }
}
