// Cloudflare Pages Function: Cloud Sync Config across Mobile and Desktop
// Synchronizes Trading Mode (Paper/Live), Quant Parameters, and API Credentials
// Optimized with Aggressive Caching & Zero-Spam KV Protection to keep within Free Tier limits

interface Env {
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

// Global in-memory cache with timestamp to minimize KV read/write quota
let memoryConfigCache: any = null;
let lastKvReadTime = 0;
const KV_READ_CACHE_TTL_MS = 60000; // Cache KV reads for 60 seconds

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

  // 1. Check in-memory cache first to avoid hitting KV 100k read quota
  if (memoryConfigCache && now - lastKvReadTime < KV_READ_CACHE_TTL_MS) {
    savedConfig = memoryConfigCache;
  } else if (env.AUTOTD_KV) {
    try {
      const raw = await env.AUTOTD_KV.get("user_config");
      if (raw) {
        savedConfig = JSON.parse(raw);
        memoryConfigCache = savedConfig;
        lastKvReadTime = now;
      }
    } catch (err) {
      console.warn("AUTOTD_KV read limit reached or error (falling back to memory cache):", err);
      savedConfig = memoryConfigCache;
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

    // Check if we need to read from KV (only if cache is empty)
    if (Object.keys(currentSaved).length === 0 && env.AUTOTD_KV) {
      try {
        const raw = await env.AUTOTD_KV.get("user_config");
        if (raw) currentSaved = JSON.parse(raw);
      } catch {}
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
    lastKvReadTime = Date.now();

    // STRICT KV WRITE PROTECTION:
    // Only write to KV if actual CORE settings (API keys, TP %, SL %, etc.) changed.
    // Volatile state (logs, active holdings, tick timestamps) will NEVER consume KV writes!
    let coreChanged = false;
    const newCoreSettings: Record<string, any> = {};

    for (const key of CORE_SETTINGS_KEYS) {
      if (body[key] !== undefined && body[key] !== currentSaved[key]) {
        coreChanged = true;
      }
      newCoreSettings[key] = merged[key];
    }

    if (env.AUTOTD_KV && coreChanged) {
      try {
        await env.AUTOTD_KV.put("user_config", JSON.stringify(newCoreSettings));
      } catch (kvErr) {
        console.warn("AUTOTD_KV write limit reached or failed (using in-memory cache):", kvErr);
      }
    }

    return Response.json(
      {
        code: "00000",
        msg: "Config synced successfully",
        data: merged,
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
