"use client"

import * as React from "react"
import { Settings, Shield, Zap, RefreshCw, AlertCircle, Search, Layers, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BitgetSettingsModal } from "./BitgetSettingsModal"
import { QuantExecutiveBriefing } from "./QuantExecutiveBriefing"
import { SpotScreenerCard } from "./SpotScreenerCard"
import { SpotHoldingsAvgCostCard } from "./SpotHoldingsAvgCostCard"
import { RealTradingChart } from "./RealTradingChart"
import { OrderHistoryCard } from "./OrderHistoryCard"
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
  setPaperBalance,
  findWeakestHolding,
  executeRebalanceRotation,
  fetchBatchRealRsi,
  fetchRealBitgetAssets,
  fetchEdgeBotStatus,
  triggerEdgeBotWake,
  consultOpenRouterAgent,
  calculateTrancheBudget,
  syncBitgetConfigFromCloudflare,
  EDGE_BOT_URL,
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

export type CryptoPrices = Record<string, number>

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

  // Auto-sync Bitget config & credentials & Paper Portfolio from Cloudflare Pages across PC and Mobile
  React.useEffect(() => {
    syncBitgetConfigFromCloudflare().then((synced) => {
      if (synced) {
        setConfig((prev) => {
          const merged: BitgetConfig = {
            ...prev,
            ...synced,
            apiKey: synced.apiKey || prev.apiKey,
            secretKey: synced.secretKey || prev.secretKey,
            passphrase: synced.passphrase || prev.passphrase,
            openrouterApiKey: synced.openrouterApiKey || prev.openrouterApiKey,
            isPaperTrading: typeof synced.isPaperTrading === "boolean" ? synced.isPaperTrading : prev.isPaperTrading,
            autoPilotEnabled: typeof synced.autoPilotEnabled === "boolean" ? synced.autoPilotEnabled : prev.autoPilotEnabled,
            tranchePercent: synced.tranchePercent ?? prev.tranchePercent,
            takeProfitPercent: synced.takeProfitPercent ?? prev.takeProfitPercent,
            cutLossPercent: synced.cutLossPercent ?? prev.cutLossPercent,
            maxTranches: synced.maxTranches ?? prev.maxTranches,
            maxCoins: synced.maxCoins ?? prev.maxCoins,
            cashReservePercent: synced.cashReservePercent ?? prev.cashReservePercent,
            autoRebalanceEnabled: typeof synced.autoRebalanceEnabled === "boolean" ? synced.autoRebalanceEnabled : prev.autoRebalanceEnabled,
          }
          saveBitgetConfig(merged)
          return merged
        })

        // Cross-device Paper Portfolio & Balance Sync
        const localHoldings = loadSpotHoldings()
        if (Array.isArray(synced.holdings) && synced.holdings.length > 0) {
          saveSpotHoldings(synced.holdings)
          setHoldings(synced.holdings)
        } else if (localHoldings.length > 0) {
          saveSpotHoldings(localHoldings)
        }

        if (typeof synced.paperBalance === "number" && synced.paperBalance > 0) {
          if (localHoldings.length === 0 && Array.isArray(synced.holdings) && synced.holdings.length > 0) {
            setPaperBalance(synced.paperBalance)
            setQuantState((prev) => ({ ...prev, cashReserveUsdt: synced.paperBalance! }))
          } else if (getPaperBalance() === 10000 && synced.paperBalance !== 10000) {
            setPaperBalance(synced.paperBalance)
            setQuantState((prev) => ({ ...prev, cashReserveUsdt: synced.paperBalance! }))
          }
        } else if (getPaperBalance() !== 10000) {
          setPaperBalance(getPaperBalance())
        }

        if (Array.isArray(synced.quantLogs)) {
          if (synced.quantLogs.length === 0) {
            localStorage.removeItem("bitget_quant_logs_v1")
            setQuantState((prev) => ({ ...prev, recentLogs: [] }))
          } else {
            const localLogs = loadQuantLogs()
            if (localLogs.length <= 1) {
              saveQuantLogs(synced.quantLogs)
              setQuantState((prev) => ({ ...prev, recentLogs: synced.quantLogs }))
            }
          }
        }
      }
    })
  }, [])

  // Price map of symbols
  const priceMap = React.useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of tickers) {
      map[t.symbol] = t.lastPr
    }
    return map
  }, [tickers])

  // Execution concurrency guard lock
  const isExecutingTradeRef = React.useRef(false)

  // Fetch Tickers & Run Quant Engine (Real Market Data + Real RSI + Real Portfolio Check)
  const runScanCycle = React.useCallback(async () => {
    setIsScanning(true)
    try {
      const topTickers = await fetchTopBitgetSpotTickers()
      if (topTickers.length > 0) {
        // 1. Calculate Real 15m RSI for Top 20 coins
        const symbols = topTickers.map((t) => t.symbol)
        const realRsiMap = await fetchBatchRealRsi(symbols)

        // 2. Evaluate Screener with Real Technical Indicators
        const currentHoldings = loadSpotHoldings()
        const evaluated = evaluateScreener(topTickers, currentHoldings, realRsiMap)
        setTickers(evaluated)

        // 3. Update Holdings with Live Prices
        const pMap: Record<string, number> = {}
        for (const t of topTickers) {
          pMap[t.symbol] = t.lastPr
        }
        const updatedHoldings = updateHoldingsWithLivePrices(currentHoldings, pMap)
        setHoldings(updatedHoldings)
        saveSpotHoldings(updatedHoldings)

        // 4. Master Quant Check (Take Profit & Cut Loss & Candidate Auto-Buy)
        const { decision, overallState } = runQuantPortfolioCheck(updatedHoldings, config, evaluated)

        // If in Real Live Mode, sync actual USDT balance from Bitget
        if (!config.isPaperTrading) {
          const realAcc = await fetchRealBitgetAssets(config)
          if (realAcc) {
            overallState.cashReserveUsdt = realAcc.usdtAvailable
          } else {
            overallState.cashReserveUsdt = 0
          }
        }

        // Sync real logs from Cloudflare Edge Bot if available
        try {
          const edgeStatus = await fetchEdgeBotStatus()
          if (edgeStatus?.logs && Array.isArray(edgeStatus.logs) && edgeStatus.logs.length > 0) {
            const edgeLogs = edgeStatus.logs.map((el: any) => ({
              id: el.id || String(el.timestamp || Date.now()),
              time: el.timestamp ? new Date(el.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
              action: el.action || "AI SCAN",
              symbol: el.symbol || "EDGE BOT",
              note: el.reason || el.note || el.message || "วิเคราะห์ตลาดอัตโนมัติ",
              color: el.action?.includes("BUY") ? "#10b981" : el.action?.includes("CUT") ? "#ef4444" : "#38bdf8",
            }))
            const localLogs = loadQuantLogs()
            overallState.recentLogs = [...edgeLogs, ...localLogs].slice(0, 15)
          }
        } catch {}

        setQuantState(overallState)

        // 5. FULL BOT EXECUTION: Autonomous Auto-Sell and Auto-Buy
        if (config.autoPilotEnabled && decision && !isExecutingTradeRef.current) {
          isExecutingTradeRef.current = true
          try {
            // 5.1 AUTO-SELL: CUT LOSS (100% Market Sell + 3h Cooldown)
            if (decision.action === "CUT_LOSS") {
              const res = await executeSpotSell(decision.symbol, decision.price, true, config)
              setHoldings(res.updatedHoldings)
              setActionAlert(`🚨 [AUTO CUT-LOSS] ${res.message}`)
              setTimeout(() => setActionAlert(null), 5000)

              const newLog = {
                id: Date.now().toString(),
                time: new Date().toLocaleTimeString(),
                action: config.isPaperTrading ? "🚨 [AUTO] CUT LOSS" : "🔥🚨 [LIVE] CUT LOSS",
                symbol: decision.symbol,
                note: `${decision.reason} | ดึงเงินสดกลับกระเป๋าทันที`,
                color: "#ef4444",
              }
              const logs = [newLog, ...loadQuantLogs()]
              saveQuantLogs(logs)
            }
            // 5.2 AUTO-SELL: TAKE PROFIT (100% Market Sell on target)
            else if (decision.action === "TAKE_PROFIT") {
              const res = await executeSpotSell(decision.symbol, decision.price, false, config)
              setHoldings(res.updatedHoldings)
              setActionAlert(`🎯 [AUTO TAKE-PROFIT] ${res.message}`)
              setTimeout(() => setActionAlert(null), 5000)

              const newLog = {
                id: Date.now().toString(),
                time: new Date().toLocaleTimeString(),
                action: config.isPaperTrading ? "🎯 [AUTO] TAKE PROFIT" : "🔥🎯 [LIVE] TAKE PROFIT",
                symbol: decision.symbol,
                note: `${decision.reason} | ล็อคกำไรสำเร็จ`,
                color: "#10b981",
              }
              const logs = [newLog, ...loadQuantLogs()]
              saveQuantLogs(logs)
            }
            // 5.3 AUTO-BUY: DCA TRANCHE or NEW TRANCHE 1 (Hybrid Quant + OpenRouter AI)
            else if (decision.action === "BUY_TRANCHE") {
              let availableCash = overallState.cashReserveUsdt

              // Strict Live Guard: In Live mode, verify real Bitget USDT balance
              if (!config.isPaperTrading) {
                const freshAcc = await fetchRealBitgetAssets(config)
                availableCash = freshAcc ? freshAcc.usdtAvailable : 0
                overallState.cashReserveUsdt = availableCash

                if (availableCash < 5) {
                  const newLog = {
                    id: Date.now().toString(),
                    time: new Date().toLocaleTimeString(),
                    action: "⚠️ [INSUFFICIENT USDT]",
                    symbol: decision.symbol,
                    note: availableCash === 0
                      ? `ไม่สามารถตรวจสอบยอดเงินสดจริงจาก Bitget ได้ หรือกระเป๋า Spot มียอด $0.00 ระบบยกเลิกการเปิดไม้ Live เพื่อความปลอดภัย`
                      : `ยอด USDT ในกระเป๋า Spot มี $${availableCash.toFixed(2)} (ต้องการขั้นต่ำ $10 เพื่อเปิดไม้) กรุณาโอน USDT เข้ากระเป๋า Spot ของ Bitget`,
                    color: "#f59e0b",
                  }
                  saveQuantLogs([newLog, ...loadQuantLogs()])
                  setActionAlert(`⚠️ [LIVE GUARD] ยอด USDT ใน Bitget Spot มี $${availableCash.toFixed(2)} (ไม่พอซื้อขั้นต่ำ $10) ยกเลิกการเปิดไม้`)
                  setTimeout(() => setActionAlert(null), 6000)
                  return
                }
              }

              const isExisting = updatedHoldings.some((h) => h.symbol === decision.symbol)
              
              let shouldExecuteBuy = true
              let aiReason = decision.reason

              // For a new coin entry (Tranche 1), consult OpenRouter AI Agent on Cloudflare Pages
              if (!isExisting) {
                const targetTicker = evaluated.find((t) => t.symbol === decision.symbol)
                const agentDecision = await consultOpenRouterAgent(
                  {
                    symbol: decision.symbol,
                    currentPrice: decision.price,
                    change24h: targetTicker?.change24h || 0,
                    rsi15m: targetTicker?.rsi15m || 50,
                    aiScore: targetTicker?.aiScore || 80,
                  },
                  config
                )

                if (agentDecision) {
                  aiReason = `[AI: ${agentDecision.modelUsed}] ${agentDecision.reason}`
                  if (agentDecision.action === "HOLD" && agentDecision.confidence < 70) {
                    shouldExecuteBuy = false
                  }
                }
              }

              if (shouldExecuteBuy) {
                const trancheBudget = calculateTrancheBudget(availableCash, config.tranchePercent)
                const res = await executeSpotBuyTranche(decision.symbol, decision.price, trancheBudget, config)
                setHoldings(res.updatedHoldings)
                setActionAlert(`⚡ [AUTO BUY] ${res.message}`)
                setTimeout(() => setActionAlert(null), 5000)

                const newLog = {
                  id: Date.now().toString(),
                  time: new Date().toLocaleTimeString(),
                  action: config.isPaperTrading ? "⚡ [AUTO] BUY TRANCHE" : "🔥⚡ [LIVE AUTO] BUY",
                  symbol: decision.symbol,
                  note: `${res.message} | ${aiReason}`,
                  color: "#0ea5e9",
                }
                const logs = [newLog, ...loadQuantLogs()]
                saveQuantLogs(logs)
              } else {
                // AI recommended to hold/wait
                const newLog = {
                  id: Date.now().toString(),
                  time: new Date().toLocaleTimeString(),
                  action: "⏸️ [AI HOLD]",
                  symbol: decision.symbol,
                  note: `AI แนะนำชะลอการเข้าซื้อ: ${aiReason}`,
                  color: "#f59e0b",
                }
                const logs = [newLog, ...loadQuantLogs()]
                saveQuantLogs(logs)
              }
            }
          } catch (execErr: any) {
            console.error("Auto execution error:", execErr)
          } finally {
            isExecutingTradeRef.current = false
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

  // Buy Tranche Handler (Real or Paper)
  const handleBuyTranche = async (symbol: string, price: number) => {
    const trancheBudget = 500 // $500 per tranche
    const res = await executeSpotBuyTranche(symbol, price, trancheBudget, config)
    setHoldings(res.updatedHoldings)
    setActionAlert(res.message)
    setTimeout(() => setActionAlert(null), 4000)

    const newLog = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString(),
      action: config.isPaperTrading ? "BUY TRANCHE [PAPER]" : "BUY TRANCHE [LIVE]",
      symbol,
      note: res.message,
      color: "#0ea5e9",
    }
    const logs = [newLog, ...loadQuantLogs()]
    saveQuantLogs(logs)
    runScanCycle()
  }

  // Sell Holding Handler (Manual TP or Cut Loss)
  const handleSellHolding = async (symbol: string, currentPrice: number, isCutLoss: boolean) => {
    const actionLabel = isCutLoss ? "คัทลอส" : "ขายทำกำไร"
    if (!confirm(`ยืนยันการ${actionLabel} ${symbol} ทันที 100% ด้วยราคาตลาด?`)) return

    const res = await executeSpotSell(symbol, currentPrice, isCutLoss, config)
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
  const handleRebalanceSwap = async (newSymbol: string, price: number) => {
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

    const res = await executeRebalanceRotation(weakest.symbol, newSymbol, price, config)
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

  // Action 1: Take Profit All
  const handleTakeProfitAll = async () => {
    if (holdings.length === 0) {
      alert("ไม่มีเหรียญในพอร์ตที่สามารถขายทำกำไรได้")
      return
    }
    if (!confirm(`ยืนยันการขายทำกำไรทุกเหรียญ (${holdings.length} เหรียญ) ด้วยราคาตลาดทันที?`)) return

    let totalRealized = 0
    let currentH = [...holdings]
    for (const h of holdings) {
      const res = await executeSpotSell(h.symbol, h.currentPrice, false, config)
      totalRealized += res.realizedPnl
      currentH = res.updatedHoldings
    }
    setHoldings(currentH)
    setActionAlert(`🎯 TAKE PROFIT สำเร็จ: ขายปิดทำกำไรรวมทุกเหรียญ สรุปกำไรสุทธิ ${totalRealized >= 0 ? '+' : ''}$${totalRealized.toFixed(2)}`)
    setTimeout(() => setActionAlert(null), 5000)
    runScanCycle()
  }

  // Action 2: Emergency Panic Cut Loss & Cooldown
  const handleEmergencyPanicCutLoss = async () => {
    if (holdings.length === 0) {
      alert("ไม่มีเหรียญในพอร์ตที่ต้องคัทลอส")
      return
    }
    if (!confirm(`🚨 คำเตือนความเสี่ยง: ยืนยันการคัทลอสฉุกเฉินปิดพอร์ต 100% ทุกเหรียญ (${holdings.length} เหรียญ) และล็อค Cooldown 3 ชม. ห้ามเข้าไม้ซ้ำ?`)) return

    let currentH = [...holdings]
    for (const h of holdings) {
      const res = await executeSpotSell(h.symbol, h.currentPrice, true, config)
      currentH = res.updatedHoldings
    }
    setHoldings(currentH)
    setActionAlert(`🚨 EMERGENCY PANIC STOP: คัทลอสทุกเหรียญและล็อค Cooldown 3 ชม. เรียบร้อยแล้ว`)
    setTimeout(() => setActionAlert(null), 5000)
    runScanCycle()
  }

  // Action 3: Recalculate & Sync Avg Cost & Trigger Edge Bot Scan
  const handleManualScan = async () => {
    triggerEdgeBotWake("MANUAL_SCAN_TRIGGER_FROM_UI").catch(() => {})
    await runScanCycle()
    setActionAlert(`💼 สแกนตลาดสด & คำนวณ RSI 15m และต้นทุนเฉลี่ยถ่วงน้ำหนักเรียบร้อย`)
    setTimeout(() => setActionAlert(null), 3000)
  }

  const selectedHolding = holdings.find((h) => h.symbol === selectedSymbol)
  const selectedPrice = priceMap[selectedSymbol] ?? (selectedHolding?.currentPrice || 0)
  const totalBalance =
    (config.isPaperTrading ? getPaperBalance() : quantState.cashReserveUsdt) +
    holdings.reduce((sum, h) => sum + h.totalAmount * h.currentPrice, 0)

  return (
    <div className="flex flex-col gap-3 sm:gap-4 px-2 sm:px-4 pb-8 w-full max-w-full overflow-x-hidden">
      {/* Top Bar: Title & Global Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border bg-card/60 p-2.5 sm:px-4 sm:py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black text-xs">
            BG
          </div>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-bold tracking-tight text-foreground flex flex-wrap items-center gap-1.5">
              <span>Bitget Spot Quant Terminal</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold text-primary">
                SPOT
              </span>
            </h1>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground truncate">
              ระบบสกรีนเหรียญน่าซื้อ + คำนวณต้นทุนเฉลี่ยหลายไม้ (DCA) + คัทเป็นไม่ติดดอย
            </p>
          </div>
        </div>

        {/* Global Metrics & Actions */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto justify-between sm:justify-end">
          {/* Equity Badge */}
          <div className="rounded-lg border bg-muted/40 px-2 sm:px-3 py-1 text-right">
            <div className="text-[8px] sm:text-[9px] uppercase tracking-wider text-muted-foreground">
              {config.isPaperTrading ? "พอร์ต Paper" : "พอร์ตจริง Spot"}
            </div>
            <div className="font-mono text-xs font-bold text-emerald-500">
              ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* AutoTD Quant Status Pill */}
          <div
            className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-400"
            title="AutoTD AI Quant Engine พร้อมทำงานบน Cloudflare Pages"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
            </span>
            <span>⚡ QUANT</span>
          </div>

          {/* Mode Pill (Clickable toggle) */}
          <button
            type="button"
            onClick={() => {
              const newMode = !config.isPaperTrading
              const newCfg = { ...config, isPaperTrading: newMode }
              setConfig(newCfg)
              saveBitgetConfig(newCfg)
              setActionAlert(
                newMode
                  ? "🛡️ สลับเป็นโหมดจำลอง (Paper Trading) แล้ว ไม่เสียเงินจริง"
                  : "🔥 สลับเป็นโหมดเทรดจริง (Live Bitget Spot) แล้ว"
              )
              setTimeout(() => setActionAlert(null), 3500)
            }}
            title="กดเพื่อสลับโหมด Paper / Live ได้ทันที"
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold border transition-all cursor-pointer active:scale-95 ${
              config.isPaperTrading
                ? "bg-amber-500/15 border-amber-500/40 text-amber-400 hover:bg-amber-500/25"
                : "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.25)]"
            }`}
          >
            {config.isPaperTrading ? "🛡️ PAPER" : "🔥 LIVE"}
          </button>

          {/* Settings Trigger */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="h-7 sm:h-8 gap-1 text-[11px] sm:text-xs font-semibold px-2.5"
          >
            <Settings className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span>ตั้งค่า API</span>
          </Button>
        </div>
      </div>

      {/* Floating Action Alert Toast */}
      {actionAlert && (
        <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary shadow-lg flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <span className="truncate mr-2">{actionAlert}</span>
          <button onClick={() => setActionAlert(null)} className="text-muted-foreground hover:text-foreground shrink-0">
            ✕
          </button>
        </div>
      )}

      {/* 🚀 QUICK ACTION COMMAND BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-border/80 bg-card/70 p-2 sm:p-2.5 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-1.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 font-bold text-xs">
            ⚡
          </div>
          <span className="text-[11px] sm:text-xs font-bold text-foreground">ปุ่มสั่งการ QUANT AI:</span>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
          {/* Master Full Bot Auto-Pilot Toggle */}
          <Button
            size="sm"
            onClick={() => {
              const newCfg = { ...config, autoPilotEnabled: !config.autoPilotEnabled }
              setConfig(newCfg)
              saveBitgetConfig(newCfg)
              setActionAlert(
                newCfg.autoPilotEnabled
                  ? "⚡ เปิดระบบ FULL BOT AUTO-PILOT แล้ว (เข้าซื้อ & ขายอัตโนมัติเต็มรูปแบบ)"
                  : "⏸️ พักระบบ AUTO-PILOT (สลับเป็นโหมดควบคุมด้วยตนเอง)"
              )
              setTimeout(() => setActionAlert(null), 4000)
            }}
            className={`h-7 sm:h-8 gap-1.5 text-[11px] sm:text-xs font-bold justify-center transition-all ${
              config.autoPilotEnabled
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 hover:bg-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)]"
                : "bg-muted/40 text-muted-foreground border border-border hover:bg-muted"
            }`}
          >
            <Zap className={`h-3 w-3 sm:h-3.5 sm:w-3.5 ${config.autoPilotEnabled ? "text-cyan-400 fill-cyan-400 animate-pulse" : ""}`} />
            <span>{config.autoPilotEnabled ? "⚡ FULL BOT [ON]" : "⏸️ BOT [OFF]"}</span>
          </Button>

          {/* Quick 1-Click Paper / Live Mode Toggle */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const newMode = !config.isPaperTrading
              const newCfg = { ...config, isPaperTrading: newMode }
              setConfig(newCfg)
              saveBitgetConfig(newCfg)
              setActionAlert(
                newMode
                  ? "🛡️ สลับเป็นโหมดจำลอง (Paper Trading) แล้ว ปลอดภัย ไม่เสียเงินจริง"
                  : "🔥 สลับเป็นโหมดเทรดจริง (Live Bitget Spot) แล้ว"
              )
              setTimeout(() => setActionAlert(null), 3500)
            }}
            className={`h-7 sm:h-8 gap-1 text-[11px] sm:text-xs font-bold justify-center transition-all ${
              config.isPaperTrading
                ? "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
            }`}
          >
            <Shield className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span>{config.isPaperTrading ? "โหมด PAPER" : "โหมด LIVE"}</span>
          </Button>

          {/* Action 1: Spot AI Screener */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleManualScan}
            disabled={isScanning}
            className="h-7 sm:h-8 gap-1 text-[11px] sm:text-xs font-bold text-sky-400 border-sky-500/30 hover:bg-sky-500/10 justify-center"
          >
            <Search className={`h-3 w-3 sm:h-3.5 sm:w-3.5 ${isScanning ? "animate-spin" : ""}`} />
            <span>สแกนตลาด</span>
          </Button>

          {/* Action 2: ต้นทุนเฉลี่ย (Avg Cost) */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleManualScan}
            className="h-7 sm:h-8 gap-1 text-[11px] sm:text-xs font-bold text-purple-400 border-purple-500/30 hover:bg-purple-500/10 justify-center"
          >
            <Layers className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span>คำนวณต้นทุนเฉลี่ย</span>
          </Button>

          {/* Action 3: Take Profit Engine */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleTakeProfitAll}
            disabled={holdings.length === 0}
            className="h-7 sm:h-8 gap-1 text-[11px] sm:text-xs font-bold text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 justify-center"
          >
            <Zap className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span>ล็อคกำไร (TP)</span>
          </Button>

          {/* Action 4: Cut-Loss & Cooldown */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleEmergencyPanicCutLoss}
            disabled={holdings.length === 0}
            className="h-7 sm:h-8 gap-1 text-[11px] sm:text-xs font-bold text-rose-400 border-rose-500/40 hover:bg-rose-500/10 justify-center"
          >
            <ShieldAlert className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span>คัทลอสฉุกเฉิน</span>
          </Button>
        </div>
      </div>

      {/* 1. Quant Commander Executive Briefing */}
      <QuantExecutiveBriefing
        state={quantState}
        config={config}
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

      {/* 4. Transaction & Order History: Live Bitget Orders & Quant AI Decision Logs */}
      <OrderHistoryCard
        config={config}
        quantLogs={quantState.recentLogs}
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
