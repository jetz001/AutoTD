import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const BITGET_HOST = "https://api.bitget.com";

function signBitgetRequest(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
  secretKey: string
) {
  const prehash = timestamp + method.toUpperCase() + requestPath + body;
  return crypto.createHmac("sha256", secretKey).update(prehash).digest("base64");
}

function getCredentials(req: NextRequest) {
  const apiKey = req.headers.get("x-bitget-key") || process.env.BITGET_API_KEY || process.env.NEXT_PUBLIC_BITGET_API_KEY || "";
  const secretKey = req.headers.get("x-bitget-secret") || process.env.BITGET_SECRET_KEY || "";
  const passphrase = req.headers.get("x-bitget-passphrase") || process.env.BITGET_PASSPHRASE || "";
  return { apiKey, secretKey, passphrase };
}

// GET: Query Assets / Account info
export async function GET(req: NextRequest) {
  const { apiKey, secretKey, passphrase } = getCredentials(req);
  if (!apiKey || !secretKey || !passphrase) {
    return NextResponse.json({ code: "40001", msg: "Missing Bitget API credentials" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "assets";

  try {
    let requestPath = "/api/v2/spot/account/assets";
    if (action === "orders") {
      const symbol = searchParams.get("symbol") || "";
      requestPath = `/api/v2/spot/trade/unfilled-orders${symbol ? `?symbol=${symbol}` : ""}`;
    } else if (action === "history") {
      const symbol = searchParams.get("symbol") || "";
      requestPath = `/api/v2/spot/trade/history-orders${symbol ? `?symbol=${symbol}` : ""}`;
    }

    const timestamp = Date.now().toString();
    const sign = signBitgetRequest(timestamp, "GET", requestPath, "", secretKey);

    const res = await fetch(`${BITGET_HOST}${requestPath}`, {
      headers: {
        "ACCESS-KEY": apiKey,
        "ACCESS-SIGN": sign,
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-PASSPHRASE": passphrase,
        "Content-Type": "application/json",
        locale: "en-US",
      },
      cache: "no-store",
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ code: "50000", msg: error.message }, { status: 500 });
  }
}

// POST: Place Spot Order
export async function POST(req: NextRequest) {
  const { apiKey, secretKey, passphrase } = getCredentials(req);
  if (!apiKey || !secretKey || !passphrase) {
    return NextResponse.json({ code: "40001", msg: "Missing Bitget API credentials" }, { status: 400 });
  }

  try {
    const payload = await req.json();
    const requestPath = "/api/v2/spot/trade/place-order";
    const bodyStr = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const sign = signBitgetRequest(timestamp, "POST", requestPath, bodyStr, secretKey);

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
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ code: "50000", msg: error.message }, { status: 500 });
  }
}
