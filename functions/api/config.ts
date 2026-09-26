// Cloudflare Pages Function: Cloud Sync Config across Mobile and Desktop
// Synchronizes Trading Mode (Paper/Live), Quant Parameters, and API Credentials

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

// Global in-memory cache fallback across warm worker instances
let memoryConfigCache: any = null;

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
    isPaperTrading: true, // Safe default everywhere
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
  };

  let savedConfig: any = null;
  if (env.AUTOTD_KV) {
    try {
      const raw = await env.AUTOTD_KV.get("user_config");
      if (raw) savedConfig = JSON.parse(raw);
    } catch (err) {
      console.warn("Failed to read from AUTOTD_KV:", err);
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
    isPaperTrading: true,
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
  };

  try {
    const body = (await request.json()) as any;

    let currentSaved: any = {};
    if (env.AUTOTD_KV) {
      try {
        const raw = await env.AUTOTD_KV.get("user_config");
        if (raw) currentSaved = JSON.parse(raw);
      } catch {}
    }
    if (Object.keys(currentSaved).length === 0 && memoryConfigCache) {
      currentSaved = memoryConfigCache;
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

    if (env.AUTOTD_KV) {
      try {
        const newStr = JSON.stringify(merged);
        const oldStr = JSON.stringify(currentSaved);
        if (newStr !== oldStr) {
          await env.AUTOTD_KV.put("user_config", newStr);
        }
      } catch (kvErr) {
        console.warn("Failed to write to AUTOTD_KV (will rely on in-memory cache until reset):", kvErr);
      }
    }

    return Response.json(
      {
        code: "00000",
        msg: "Config synced to Cloudflare successfully",
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
