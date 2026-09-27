const { execSync } = require('child_process');

async function migrate() {
  console.log('Fetching active configuration from https://autotd.pages.dev/api/config...');
  const res = await fetch('https://autotd.pages.dev/api/config');
  const json = await res.json();
  const configObj = json.data;
  const configStr = JSON.stringify(configObj).replace(/'/g, "''");

  console.log(`Writing config (${configStr.length} chars) to D1 autotd-db...`);
  const sql = `INSERT INTO config (key, value) VALUES ('user_config', '${configStr}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`;
  
  const fs = require('fs');
  fs.writeFileSync('temp_migrate.sql', sql);

  try {
    execSync('npx wrangler d1 execute autotd-db --remote --file=temp_migrate.sql', { stdio: 'inherit' });
    console.log('✅ Successfully migrated config to Cloudflare D1!');
  } finally {
    try { fs.unlinkSync('temp_migrate.sql'); } catch {}
  }
}

migrate().catch(console.error);
