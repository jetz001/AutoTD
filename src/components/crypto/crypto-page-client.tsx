"use client"

import * as React from "react"
import { Settings, Shield, Zap, RefreshCw, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BitgetSettingsModal } from "./BitgetSettingsModal"
import { QuantExecutiveBriefing } from "./QuantExecutiveBriefing"
import { SpotScreenerCard } from "./SpotScreenerCard"
import { SpotHoldingsAvgCostCard } from "./SpotHoldingsAvgCostCard"
import { RealTradingChart } from "./RealTradingChart"
import {
  loadBitgetConfig,
  saveBitgetConfig,
  loadSpotHoldings,
  saveSpotHoldings,
  fetchTopBitgetSpotTickers,
  executeSpotBuyTranche,
  executeSpotSell,
  updateHoldingsWithLivePrices,
  getPaperBalance,
  findWeakestHolding,
  executeRebalanceRotation,
  type BitgetConfig,
  type SpotHolding,
  type SpotTickerItem,
} from "@/services/bitgetSpot"
import {
  evaluateScreener,
  runQuantPortfolioCheck,
  saveQuantLogs,
  loadQuantLogs,
  type QuantExecutiveState,
} from "@/services/quantEngine"

export function CryptoPageClient() {
  const [config, setConfig] = React.useState<BitgetConfig>(loadBitgetConfig)
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)
  const [selectedSymbol, setSelectedSymbol] = React.useState("BTCUSDT")
  const [tickers, setTickers] = React.useState<SpotTickerItem[]>([])
  const [holdings, setHoldings] = React.useState<SpotHolding[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("bitget_spot_holdings_v1")
      if (saved && saved.includes("176.4")) {
        localStorage.removeItem("bitget_spot_holdings_v1")
      }
    }
    return loadSpotHoldings()
  })
  const [isScanning, setIsScanning] = React.useState(false)
  const [actionAlert, setActionAlert] = React.useState<string | null>(null)

  // Quant Executive State
  const [quantState, setQuantState] = React.useState<QuantExecutiveState>({
    status: "SCANNING",
    statusMessage: "กำลังสแกนตลาด Top Spot Bitget เพื่อหาจังหวะ Dip in Uptrend",
    roundGoalPercent: config.takeProfitPercent,
    currentRoundProgressPercent: 0,
    activeCoinsCount: 0,
    maxCoinsLimit: config.maxCoins,
    totalDeployedUsdt: 0,
    cashReserveUsdt: getPaperBalance(),
    recentLogs: loadQuantLogs(),
  })

  // Price map of symbols
  const priceMap = React.useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of tickers) {
      map[t.symbol] = t.lastPr
    }
    return map
  }, [tickers])

  // Fetch Tickers & Run Quant Engine
  const runScanCycle = React.useCallback(async () => {
    setIsScanning(true)
    try {
      const topTickers = await fetchTopBitgetSpotTickers()
      if (topTickers.length > 0) {
        // 1. Evaluate Screener Scores
        const currentHoldings = loadSpotHoldings()
        const evaluated = evaluateScreener(topTickers, currentHoldings)
        setTickers(evaluated)

        // 2. Update Holdings with Live Prices
        const pMap: Record<string, number> = {}
        for (const t of topTickers) {
          pMap[t.symbol] = t.lastPr
        }
        const updatedHoldings = updateHoldingsWithLivePrices(currentHoldings, pMap)
        setHoldings(updatedHoldings)
        saveSpotHoldings(updatedHoldings)

        // 3. Master Quant Check (Take Profit & Cut Loss rules)
        const { decision, overallState } = runQuantPortfolioCheck(updatedHoldings, config)
        setQuantState(overallState)

        // 4. Auto-execute if decision triggered
        if (decision) {
          if (decision.action === "CUT_LOSS") {
            const res = executeSpotSell(decision.symbol, decision.price, true)
            setHoldings(res.updatedHoldings)
            setActionAlert(res.message)
            const newLog = {
              id: Date.now().toString(),
              time: new Date().toLocaleTimeString(),
              action: "🚨 CUT LOSS",
              symbol: decision.symbol,
              note: decision.reason,
              color: "#ef4444",
            }
            const logs = [newLog, ...loadQuantLogs()]
            saveQuantLogs(logs)
          } else if (decision.action === "TAKE_PROFIT") {
            const res = executeSpotSell(decision.symbol, decision.price, false)
            setHoldings(res.updatedHoldings)
            setActionAlert(res.message)
            const newLog = {
              id: Date.now().toString(),
              time: new Date().toLocaleTimeString(),
              action: "🎯 TAKE PROFIT",
              symbol: decision.symbol,
              note: decision.reason,
              color: "#10b981",
            }
            const logs = [newLog, ...loadQuantLogs()]
            saveQuantLogs(logs)
          }
        }
      }
    } catch (e) {
      console.warn("Scan cycle error:", e)
    } finally {
      setIsScanning(false)
    }
  }, [config])

  // Periodic polling every 5 seconds
  React.useEffect(() => {
    runScanCycle()
    const interval = setInterval(runScanCycle, 5000)
    return () => clearInterval(interval)
  }, [runScanCycle])

  // Buy Tranche Handler
  const handleBuyTranche = (symbol: string, price: number) => {
    const trancheBudget = 500 // $500 per tranche
    const res = executeSpotBuyTranche(symbol, price, trancheBudget, config)
    setHoldings(res.updatedHoldings)
    setActionAlert(res.message)
    setTimeout(() => setActionAlert(null), 4000)

    const newLog = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString(),
      action: "BUY TRANCHE",
      symbol,
      note: res.message,
      color: "#0ea5e9",
    }
    const logs = [newLog, ...loadQuantLogs()]
    saveQuantLogs(logs)
    runScanCycle()
  }

  // Sell Holding Handler (Manual TP or Cut Loss)
  const handleSellHolding = (symbol: string, currentPrice: number, isCutLoss: boolean) => {
    const actionLabel = isCutLoss ? "คัทลอส" : "ขายทำกำไร"
    if (!confirm(`ยืนยันการ${actionLabel} ${symbol} ทันที 100% ด้วยราคาตลาด?`)) return

    const res = executeSpotSell(symbol, currentPrice, isCutLoss)
    setHoldings(res.updatedHoldings)
    setActionAlert(res.message)
    setTimeout(() => setActionAlert(null), 4000)

    const newLog = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString(),
      action: isCutLoss ? "🚨 CUT LOSS" : "🎯 TAKE PROFIT",
      symbol,
      note: res.message,
      color: isCutLoss ? "#ef4444" : "#10b981",
    }
    const logs = [newLog, ...loadQuantLogs()]
    saveQuantLogs(logs)
    runScanCycle()
  }

  // Rebalance Swap Handler (Sell weakest stagnant holding, buy Grade A+ opportunity)
  const handleRebalanceSwap = (newSymbol: string, price: number) => {
    const weakest = findWeakestHolding(holdings)
    if (!weakest) {
      alert("ไม่พบเหรียญที่สามารถสลับออกได้")
      return
    }

    if (
      !confirm(
        `ไม้เต็มมือแล้ว: ยืนยันให้ Quant สลับตัวอัตโนมัติ?\n\n• ปิดเหรียญนิ่ง: ${weakest.symbol} (PnL ${weakest.pnlPercent.toFixed(1)}%)\n• ซื้อโอกาสทอง A+: ${newSymbol} @ $${price}`
      )
    ) {
      return
    }

    const res = executeRebalanceRotation(weakest.symbol, newSymbol, price, config)
    setHoldings(res.updatedHoldings)
    setActionAlert(res.message)
    setTimeout(() => setActionAlert(null), 5000)

    const newLog = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString(),
      action: "🔄 REBALANCE",
      symbol: `${weakest.symbol} ➜ ${newSymbol}`,
      note: res.message,
      color: "#a855f7",
    }
    const logs = [newLog, ...loadQuantLogs()]
    saveQuantLogs(logs)
    runScanCycle()
  }

  const selectedHolding = holdings.find((h) => h.symbol === selectedSymbol)
  const selectedPrice = priceMap[selectedSymbol] ?? (selectedHolding?.currentPrice || 0)
  const totalBalance = getPaperBalance() + holdings.reduce((sum, h) => sum + (h.totalAmount * h.currentPrice), 0)

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      {/* Top Bar: Title & Global Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/60 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black text-xs">
            BG
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2">
              <span>Bitget Spot Quant Terminal</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                SPOT EXCLUSIVE
              </span>
            </h1>
            <p className="text-[11px] text-muted-foreground">
              ระบบสกรีนเหรียญน่าซื้อ + คำนวณต้นทุนเฉลี่ยหลายไม้ (DCA) + คัทเป็นไม่ติดดอย
            </p>
          </div>
        </div>

        {/* Global Metrics & Actions */}
        <div className="flex items-center gap-2.5">
          {/* Equity Badge */}
          <div className="rounded-lg border bg-muted/40 px-3 py-1 text-right">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">พอร์ต Spot รวม</div>
            <div className="font-mono text-xs font-bold text-emerald-500">
              ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Cloudflare 24/7 Edge Status Pill */}
          <a
            href="https://bitget-ai-trader.jimwar02.workers.dev/api/status"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-bold text-sky-400 hover:bg-sky-500/20 transition-colors"
            title="Cloudflare Worker รันบนเซิร์ฟเวอร์ Edge 24/7 พร้อม OpenRouter AI วิเคราะห์ทุก 5 นาที"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
            </span>
            <span>⚡ EDGE BOT: 24/7 AUTO (5m)</span>
          </a>

          {/* Mode Pill */}
          <span className={`rounded-lg px-2.5 py-1 text-xs font-bold border ${
            config.isPaperTrading
              ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
          }`}>
            {config.isPaperTrading ? "🛡️ PAPER TRADING" : "🔥 REAL LIVE"}
          </span>

          {/* Settings Trigger */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="h-8 gap-1.5 text-xs font-semibold"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>กรอบความเสี่ยง & กติกา Quant</span>
          </Button>
        </div>
      </div>

      {/* Floating Action Alert Toast */}
      {actionAlert && (
        <div className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary shadow-lg flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <span>{actionAlert}</span>
          <button onClick={() => setActionAlert(null)} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
      )}

      {/* 1. Quant Commander Executive Briefing */}
      <QuantExecutiveBriefing
        state={quantState}
        config={config}
        onTriggerScan={runScanCycle}
        isScanning={isScanning}
      />

      {/* 2. Middle Grid: Spot Screener (Left) & Holdings & Avg Cost (Right) */}
      <div className="grid grid-cols-12 gap-4">
        {/* Spot AI Screener */}
        <SpotScreenerCard
          tickers={tickers}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={setSelectedSymbol}
          onBuyTranche={handleBuyTranche}
          isPortfolioFull={holdings.length >= config.maxCoins}
          onRebalanceSwap={handleRebalanceSwap}
        />

        {/* Spot Holdings & Average Cost Tracker */}
        <SpotHoldingsAvgCostCard
          holdings={holdings}
          config={config}
          onSellHolding={handleSellHolding}
          onSelectSymbol={setSelectedSymbol}
        />
      </div>

      {/* 3. Bottom: Real Candlestick Chart with Avg Cost & Cut Loss lines */}
      <RealTradingChart
        symbol={selectedSymbol}
        currentPrice={selectedPrice}
        holding={selectedHolding}
      />

      {/* Settings Modal */}
      <BitgetSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(newCfg) => {
          setConfig(newCfg)
          runScanCycle()
        }}
      />
    </div>
  )
}
