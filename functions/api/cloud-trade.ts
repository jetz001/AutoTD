interface Env {
  GITHUB_TOKEN?: string;
  AUTOTD_KV?: KVNamespace;
}

const GITHUB_REPO = "jetz001/AutoTD";
const WORKFLOW_ID = "autotd-cron.yml";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {}

    const action = body.action || "cycle";
    const symbol = body.symbol || "";
    const amount = body.amount || "";

    const token = env.GITHUB_TOKEN || body.githubToken || "";
    if (!token) {
      return Response.json({
        success: false,
        message: "Missing GITHUB_TOKEN in Cloudflare environment",
      }, { status: 400, headers: corsHeaders });
    }

    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "AutoTD-Cloud-Pages",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { action, symbol, amount },
      }),
    });

    if (ghRes.status === 204) {
      return Response.json({
        success: true,
        message: `✓ [CLOUD 24/7] ส่งคำสั่ง ${action.toUpperCase()} ${symbol} ขึ้น Cloud เรียบร้อยแล้ว ระบบกำลังส่งเข้า Bitget ทันที`,
      }, { headers: corsHeaders });
    }

    const errText = await ghRes.text();
    return Response.json({
      success: false,
      message: `Cloud dispatch status ${ghRes.status}: ${errText}`,
    }, { status: 500, headers: corsHeaders });
  } catch (err: any) {
    return Response.json({
      success: false,
      message: `Cloud execution error: ${err.message}`,
    }, { status: 500, headers: corsHeaders });
  }
};
