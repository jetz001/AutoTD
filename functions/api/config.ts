// Cloudflare Pages Function: Cloud Sync Config across Mobile and Desktop
// Powered by Cloudflare D1 Database (100,000 writes/day free) + KV Fallback
// Provides permanent cloud persistence with zero quota stress

interface Env {
  DB?: D1Database;
  AUTOTD_KV?: KVNamespace;
  BITGET_API_KEY?: string;
  BITGET_SECRET_KEY?: string;
  BITGET_PASSPHRASE?: string;
  OPENROUTER_API_KEY?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Global in-memory cache with timestamp to minimize unnecessary database roundtrips
let memoryConfigCache: any = null;
let lastCacheReadTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds memory cache

const CORE_SETTINGS_KEYS = [
  "apiKey",
  "secretKey",
  "passphrase",
  "openrouterApiKey",
  "isPaperTrading",
  "autoPilotEnabled",
  "tranchePercent",
  "takeProfitPercent",
  "cutLossPercent",
  "maxTranches",
  "maxCoins",
  "cashReservePercent",
  "autoRebalanceEnabled"
];

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { headers: corsHeaders });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const baseDefaults = {
    apiKey: env.BITGET_API_KEY || "",
    secretKey: env.BITGET_SECRET_KEY || "",
    passphrase: env.BITGET_PASSPHRASE || "",
    openrouterApiKey: env.OPENROUTER_API_KEY || "",
    isPaperTrading: false, // Live trading mode default
    autoPilotEnabled: true,
    tranchePercent: 20,
    takeProfitPercent: 3.5,
    cutLossPercent: 5.0,
    maxTranches: 4,
    maxCoins: 4,
    cashReservePercent: 30,
    autoRebalanceEnabled: true,
    paperBalance: 10000,
    holdings: [],
    quantLogs: [],
    liveHoldings: [],
    liveLogs: [],
    liveQuantLogs: [],
  };

  const now = Date.now();
  let savedConfig: any = null;

  // 1. Check in-memory cache first (super fast < 1ms)
  if (memoryConfigCache && now - lastCacheReadTime < CACHE_TTL_MS) {
    savedConfig = memoryConfigCache;
  }
  
  // 2. Read from Cloudflare D1 Database (Primary - 5 Million reads/day)
  if (!savedConfig && env.DB) {
    try {
      const row = await env.DB.prepare("SELECT value FROM config WHERE key = ?")
        .bind("user_config")
        .first<{ value: string }>();
      if (row?.value) {
        savedConfig = JSON.parse(row.value);
        memoryConfigCache = savedConfig;
        lastCacheReadTime = now;
      }
    } catch (d1Err) {
      console.warn("D1 read notice (falling back):", d1Err);
    }
  }

  // 3. Fallback to KV if D1 has not synced yet
  if (!savedConfig && env.AUTOTD_KV) {
    try {
      const raw = await env.AUTOTD_KV.get("user_config");
      if (raw) {
        savedConfig = JSON.parse(raw);
        memoryConfigCache = savedConfig;
        lastCacheReadTime = now;
      }
    } catch (kvErr) {
      console.warn("KV fallback notice:", kvErr);
    }
  }

  if (!savedConfig && memoryConfigCache) {
    savedConfig = memoryConfigCache;
  }

  const merged = {
    ...baseDefaults,
    ...(savedConfig || {}),
    apiKey: savedConfig?.apiKey || baseDefaults.apiKey,
    secretKey: savedConfig?.secretKey || baseDefaults.secretKey,
    passphrase: savedConfig?.passphrase || baseDefaults.passphrase,
    openrouterApiKey: savedConfig?.openrouterApiKey || baseDefaults.openrouterApiKey,
  };

  return Response.json(
    {
      code: "00000",
      msg: "success",
      data: merged,
      storage: env.DB ? "Cloudflare D1 (100k writes/day)" : "Memory/KV",
    },
    { headers: corsHeaders }
  );
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const baseDefaults = {
    apiKey: env.BITGET_API_KEY || "",
    secretKey: env.BITGET_SECRET_KEY || "",
    passphrase: env.BITGET_PASSPHRASE || "",
    openrouterApiKey: env.OPENROUTER_API_KEY || "",
    isPaperTrading: false,
    autoPilotEnabled: true,
    tranchePercent: 20,
    takeProfitPercent: 3.5,
    cutLossPercent: 5.0,
    maxTranches: 4,
    maxCoins: 4,
    cashReservePercent: 30,
    autoRebalanceEnabled: true,
    paperBalance: 10000,
    holdings: [],
    quantLogs: [],
    liveHoldings: [],
    liveLogs: [],
    liveQuantLogs: [],
  };

  try {
    const body = (await request.json()) as any;
    let currentSaved: any = memoryConfigCache || {};

    // If cache is empty, read current from D1 or KV
    if (Object.keys(currentSaved).length === 0) {
      if (env.DB) {
        try {
          const row = await env.DB.prepare("SELECT value FROM config WHERE key = ?")
            .bind("user_config")
            .first<{ value: string }>();
          if (row?.value) currentSaved = JSON.parse(row.value);
        } catch {}
      } else if (env.AUTOTD_KV) {
        try {
          const raw = await env.AUTOTD_KV.get("user_config");
          if (raw) currentSaved = JSON.parse(raw);
        } catch {}
      }
    }

    const merged = {
      ...baseDefaults,
      ...currentSaved,
      ...body,
      apiKey: body.apiKey || currentSaved.apiKey || baseDefaults.apiKey,
      secretKey: body.secretKey || currentSaved.secretKey || baseDefaults.secretKey,
      passphrase: body.passphrase || currentSaved.passphrase || baseDefaults.passphrase,
      openrouterApiKey: body.openrouterApiKey || currentSaved.openrouterApiKey || baseDefaults.openrouterApiKey,
    };

    memoryConfigCache = merged;
    lastCacheReadTime = Date.now();

    // 1. PRIMARY PERSISTENCE: Write to Cloudflare D1 Database (100,000 writes/day free limit!)
    if (env.DB) {
      try {
        await env.DB.prepare(
          "INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
        ).bind("user_config", JSON.stringify(merged)).run();

        // If logs were sent, also archive into quant_logs table
        const logsToInsert = Array.isArray(body.liveLogs) ? body.liveLogs : Array.isArray(body.quantLogs) ? body.quantLogs : [];
        if (logsToInsert.length > 0) {
          const latest = logsToInsert[0];
          if (latest && latest.id) {
            await env.DB.prepare(
              "INSERT OR IGNORE INTO quant_logs (id, time, action, symbol, note, color, is_paper) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).bind(
              latest.id,
              latest.time || "",
              latest.action || "",
              latest.symbol || "",
              latest.note || "",
              latest.color || "",
              merged.isPaperTrading ? 1 : 0
            ).run();
          }
        }
      } catch (d1Err) {
        console.warn("D1 write warning:", d1Err);
      }
    }

    // 2. SECONDARY KV WRITE: Strictly for Core Settings only (preserves KV 1,000 free quota)
    let coreChanged = false;
    const newCoreSettings: Record<string, any> = {};

    for (const key of CORE_SETTINGS_KEYS) {
      if (body[key] !== undefined && body[key] !== currentSaved[key]) {
        coreChanged = true;
      }
      newCoreSettings[key] = merged[key];
    }

    if (env.AUTOTD_KV && coreChanged && !env.DB) {
      try {
        await env.AUTOTD_KV.put("user_config", JSON.stringify(newCoreSettings));
      } catch (kvErr) {
        console.warn("KV write warning:", kvErr);
      }
    }

    return Response.json(
      {
        code: "00000",
        msg: "Config synced to Cloudflare D1 successfully",
        data: merged,
        storage: env.DB ? "Cloudflare D1" : "Memory/KV",
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return Response.json(
      { code: "40000", msg: err.message },
      { status: 400, headers: corsHeaders }
    );
  }
};
