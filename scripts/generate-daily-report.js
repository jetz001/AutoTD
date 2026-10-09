// AutoTD Daily AI Trading & Intelligence Report Generator
// Fetches trades & holdings from D1/Bitget, analyzes decisions made by JEV & Quant,
// calculates Bitget 0.1% fees (0.2% round-trip), fetches market stats,
// and prompts Groq to write a professional daily Thai crypto trading intelligence article.

import fs from 'fs';
import path from 'path';

const CLOUD_CONFIG_URL = 'https://autotd.pages.dev/api/config';
const REPORTS_API_URL = 'https://autotd.pages.dev/api/reports';

async function generateReport() {
  console.log('[AutoTD Daily Report] Triggering report generation on Cloudflare Pages API...');
  
  try {
    const res = await fetch(REPORTS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate' }),
    });

    const data = await res.json();
    if (data.success && data.report) {
      console.log(`✓ [SUCCESS] Daily report generated successfully! ID: ${data.report.id}`);
      console.log(`Title: ${data.report.title}`);
      console.log(`Summary: ${data.report.summary}`);
      console.log(`Provider: ${data.report.ai_provider}`);
      console.log('\n--- PREVIEW OF CONTENT ---\n');
      console.log(data.report.content.slice(0, 500) + '...\n');
    } else {
      console.error('Report generation response:', data);
    }
  } catch (err) {
    console.error('Error generating report:', err.message);
  }
}

generateReport().catch(console.error);
