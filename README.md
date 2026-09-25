# AutoTD - Bitget Spot Quant Trading Terminal

Autonomous Quantitative Trading Terminal & DCA Multi-Tranche Engine exclusively engineered for **Bitget Spot**, powered by Next.js 16 (Turbopack), Tailwind CSS, Shadcn UI, and TradingView Lightweight Charts.

---

## 🎯 Key Strategy & System Architecture

1. **Spot Exclusive (Pure Spot - Zero Liquidation Risk):**
   - Focuses strictly on Bitget Spot (Top 20 USDT pairs by 24h volume).
   - Designed for capital preservation and high-win-rate swing DCA.

2. **Dip-in-Uptrend AI Screener:**
   - Real-time screening across 1H / 4H trend direction and 15m RSI oversold/pullback levels (35–45 zone).
   - AI Score (0–100) categorization:
     - 🟢 **น่าซื้อ (Dip in Uptrend):** Strong bullish trend on pullback.
     - 🟡 **รอดู (Watch):** Neutral / waiting for entry trigger.
     - ⛔ **Cooldown:** Locked for 3 hours after a cut-loss to prevent revenge trading.
     - 🔄 **โอกาส A+:** High momentum breakthrough candidates.

3. **Weighted Average Cost Engine (แก้ปัญหางงหลายไม้):**
   - Automatically computes exact weighted average cost: $\sum(\text{Price} \times \text{Size}) / \sum(\text{Size})$.
   - Enforces a minimum $-2.0\%$ to $-3.0\%$ pullback between tranches before allowing subsequent entries.
   - Max 3–4 tranches per coin.

4. **Cut-Loss & 3-Hour Cooldown ("คัทเป็น ไม่ติดดอย"):**
   - Automated Hard Stop at $-5.0\%$ to $-7.0\%$ from average cost.
   - 1-Click Panic / Market Cut Loss.
   - Immediate 3-hour lockout for stopped-out coins.

5. **Opportunity Rebalancing (ถ้าไม้เต็มมือแต่โอกาส A+ มา):**
   - Automatically detects when portfolio slots are full.
   - Allows Quant to rotate capital out of the weakest/stagnant position (PnL $\approx 0\%$) directly into high-momentum Grade A+ assets.

6. **Dual Mode Trading:**
   - 🛡️ **Paper Trading:** Pre-funded \$10,000 USDT simulation.
   - 🔥 **Real Trading:** Direct integration with Bitget V2 API via secure HMAC-SHA256 authenticated endpoints.

7. **TradingView Lightweight Charts v5:**
   - Real-time Bitget Spot candlestick chart.
   - Dynamic overlay lines:
     - 🔵 **Blue Dashed:** Weighted Average Cost Line
     - 🟢 **Green Dotted:** Take Profit Target (+3.5%)
     - 🔴 **Red Dotted:** Cut Loss Stop (-5.0%)

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install --legacy-peer-deps
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Fill in your Bitget API credentials:
```env
NEXT_PUBLIC_BITGET_API_KEY=your_bitget_api_key
BITGET_SECRET_KEY=your_bitget_secret_key
BITGET_PASSPHRASE=your_passphrase
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) (automatically redirects to `/crypto`).

---

## 📁 Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/bitget/route.ts      # Bitget V2 HMAC-SHA256 proxy route
│   │   ├── crypto/page.tsx          # Main Terminal Page
│   │   └── page.tsx                 # Root redirect to /crypto
│   ├── components/crypto/
│   │   ├── crypto-page-client.tsx   # Quant state sync & orchestrator
│   │   ├── QuantExecutiveBriefing.tsx # Goal progress & Quant logs
│   │   ├── SpotScreenerCard.tsx     # Dip-in-Uptrend AI scanner table
│   │   ├── SpotHoldingsAvgCostCard.tsx # Weighted Avg Cost & Tranche tracker
│   │   ├── RealTradingChart.tsx     # Lightweight Charts with 3 dynamic lines
│   │   └── BitgetSettingsModal.tsx  # API key & risk parameters dialog
│   └── services/
│       ├── bitgetSpot.ts            # Bitget Spot V2 API & Paper DCA engine
│       └── quantEngine.ts           # Screener & Strategy decision algorithms
└── cloudflare-worker/               # Optional Edge cron bot for 24/7 scanning
```

---

## 🛡️ Security Note
- **Never commit `.env.local` or secret keys to GitHub.**
- Bitget API permissions only require **Read** and **Spot Trade**. **NEVER enable Withdrawal**.
