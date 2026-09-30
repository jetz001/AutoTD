"use client"

import * as React from "react"
import { 
  Search, 
  TrendingUp, 
  TrendingDown, 
  ShoppingBag, 
  ShieldAlert, 
  ChevronDown, 
  ChevronUp, 
  Sparkles,
  Zap,
  Activity
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { SpotTickerItem } from "@/services/bitgetSpot"

interface Props {
  tickers: SpotTickerItem[]
  screenerMatrix?: any[]
  selectedSymbol: string
  onSelectSymbol: (symbol: string) => void
  onBuyTranche: (symbol: string, price: number) => void
  isPortfolioFull?: boolean
  onRebalanceSwap?: (symbol: string, price: number) => void
}

export function SpotScreenerCard({
  tickers,
  screenerMatrix = [],
  selectedSymbol,
  onSelectSymbol,
  onBuyTranche,
  isPortfolioFull = false,
  onRebalanceSwap,
}: Props) {
  const [filterText, setFilterText] = React.useState("")
  const [expandedSymbol, setExpandedSymbol] = React.useState<string | null>(null)

  // Merge tickers and screenerMatrix data
  const mergedItems = React.useMemo(() => {
    if (screenerMatrix && screenerMatrix.length > 0) {
      return screenerMatrix.map((item) => {
        const matchedTicker = tickers.find((t) => t.symbol === item.symbol)
        return {
          symbol: item.symbol,
          baseCoin: item.baseCoin || item.symbol.replace("USDT", ""),
          price: item.price || matchedTicker?.lastPr || 0,
          change24h: item.change24h ?? matchedTicker?.change24h ?? 0,
          volume: item.vol ?? matchedTicker?.usdtVolume ?? 0,
          score: item.totalScore ?? 50,
          grade: item.grade || (item.totalScore >= 75 ? "A" : item.totalScore >= 60 ? "B" : "C"),
          bestTf: item.bestTf || "15m",
          primaryIndicator: item.primaryIndicator || "MULTIPLE_CONF",
          isSupertrendBullish: item.isSupertrendBullish ?? true,
          timeframes: item.timeframes || null,
        }
      })
    }

    // Fallback if matrix is not yet loaded
    return tickers.map((t) => ({
      symbol: t.symbol,
      baseCoin: t.symbol.replace("USDT", ""),
      price: t.lastPr,
      change24h: t.change24h,
      volume: t.usdtVolume,
      score: t.aiScore ?? 50,
      grade: (t.aiScore ?? 50) >= 75 ? "A" : (t.aiScore ?? 50) >= 60 ? "B" : "C",
      bestTf: "15m",
      primaryIndicator: t.signal || "RSI_DIP",
      isSupertrendBullish: t.signal === "BUY_DIP",
      timeframes: null,
    }))
  }, [tickers, screenerMatrix])

  const filtered = mergedItems.filter((t) =>
    t.symbol.toLowerCase().includes(filterText.toLowerCase())
  )

  const toggleExpand = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedSymbol(expandedSymbol === sym ? null : sym)
  }

  return (
    <Card className="col-span-12 lg:col-span-6 flex flex-col h-full overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm sm:text-base font-bold flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span>🔍 Multi-Timeframe Quant Screener</span>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-primary">
              Top 20 Confluence
            </span>
          </CardTitle>
          <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
            สแกน 3 Timeframes (5m, 15m, 1h) ด้วย SuperTrend, RSI, Stoch, Bollinger, CHOP & ATR
          </p>
        </div>

        {/* Quick Search */}
        <div className="relative w-full sm:w-36">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="ค้นหาเหรียญ..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full rounded-md border border-input bg-background/50 pl-8 pr-2.5 py-1 text-xs outline-none focus:border-primary"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 overflow-hidden">
        <div className="max-h-[380px] overflow-x-auto overflow-y-auto w-full">
          <table className="w-full min-w-[620px] border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-card/95 backdrop-blur-xs border-b z-10 text-muted-foreground text-[11px]">
              <tr>
                <th className="py-2.5 pl-4 pr-2 font-medium">เหรียญ / วอลุ่ม 24h</th>
                <th className="py-2.5 px-2 font-medium">ราคาตลาด</th>
                <th className="py-2.5 px-2 font-medium text-center">Confluence Score</th>
                <th className="py-2.5 px-2 font-medium">สัญญาณเทคนิคหลัก</th>
                <th className="py-2.5 px-2 font-medium">กรอบเวลา</th>
                <th className="py-2.5 px-2 font-medium">เป้าหมาย (TP/SL)</th>
                <th className="py-2.5 pr-4 pl-2 font-medium text-right">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.map((t) => {
                const isSelected = selectedSymbol === t.symbol
                const isExpanded = expandedSymbol === t.symbol
                const isUp = t.change24h >= 0

                // Estimated targets based on typical ATR
                const estTp = t.price * 1.035
                const estSl = t.price * 0.95

                return (
                  <React.Fragment key={t.symbol}>
                    <tr
                      onClick={() => onSelectSymbol(t.symbol)}
                      className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                        isSelected ? "bg-primary/10" : ""
                      }`}
                    >
                      {/* Coin Symbol & 24h Volume */}
                      <td className="py-2.5 pl-4 pr-2">
                        <div className="font-bold text-foreground flex items-center gap-1.5">
                          <span>{t.symbol}</span>
                          <button
                            onClick={(e) => toggleExpand(t.symbol, e)}
                            className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                            title="ดูอินดิเคเตอร์ย่อย 3 Timeframes"
                          >
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          Vol ${(t.volume / 1e6).toFixed(1)}M
                        </div>
                      </td>

                      {/* Live Market Price */}
                      <td className="py-2.5 px-2 font-mono">
                        <div className="font-semibold text-foreground">
                          ${t.price > 10 ? t.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t.price.toFixed(4)}
                        </div>
                        <div className={`text-[10px] flex items-center gap-0.5 ${isUp ? "text-emerald-500" : "text-rose-500"}`}>
                          {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                          <span>{isUp ? "+" : ""}{t.change24h.toFixed(2)}%</span>
                        </div>
                      </td>

                      {/* Confluence Score & Grade */}
                      <td className="py-2.5 px-2 text-center">
                        <div className="inline-flex items-center gap-1 font-mono font-bold text-sm">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                              t.score >= 75
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : t.score >= 60
                                ? "bg-sky-500/20 text-sky-400 border border-sky-500/40"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {t.score}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-bold font-sans">
                            [{t.grade}]
                          </span>
                        </div>
                      </td>

                      {/* Dominant Technical Signal */}
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-1">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold font-mono ${
                              t.primaryIndicator.includes("SUPERTREND")
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : t.primaryIndicator.includes("BOLLINGER")
                                ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                                : t.primaryIndicator.includes("RSI")
                                ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {t.primaryIndicator.replace(/_/g, " ")}
                          </span>
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">
                          {t.isSupertrendBullish ? "🟢 SuperTrend ขาขึ้น" : "🔴 SuperTrend ขาลง"}
                        </div>
                      </td>

                      {/* Best Timeframe */}
                      <td className="py-2.5 px-2">
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-400 border border-sky-500/30">
                          {t.bestTf}
                        </span>
                      </td>

                      {/* Estimated Targets TP / SL */}
                      <td className="py-2.5 px-2 font-mono text-[10px]">
                        <div className="text-emerald-500 flex items-center gap-1">
                          <span>TP:</span>
                          <span className="font-semibold">${estTp > 10 ? estTp.toFixed(2) : estTp.toFixed(4)}</span>
                        </div>
                        <div className="text-rose-500 flex items-center gap-1 mt-0.5">
                          <span>SL:</span>
                          <span className="font-semibold">${estSl > 10 ? estSl.toFixed(2) : estSl.toFixed(4)}</span>
                        </div>
                      </td>

                      {/* Action Button */}
                      <td className="py-2.5 pr-4 pl-2 text-right">
                        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {isPortfolioFull ? (
                            onRebalanceSwap ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onRebalanceSwap(t.symbol, t.price)}
                                className="h-6 px-2 text-[10px] font-bold border-amber-500/40 text-amber-400 hover:bg-amber-500/20"
                                title="พอร์ตเต็มแล้ว - สลับกับเหรียญที่อ่อนแอกว่าเพื่อ Rebalance"
                              >
                                หมุนรอบ
                              </Button>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">พอร์ตเต็ม</span>
                            )
                          ) : (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => onBuyTranche(t.symbol, t.price)}
                              className="h-6 px-2.5 text-[10px] bg-primary hover:bg-primary/90 font-bold gap-1"
                              title="เปิดไม้ซื้อทันทีด้วย Confluence Score"
                            >
                              <ShoppingBag className="h-2.5 w-2.5" />
                              <span>ซื้อไม้นี้</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expandable Deep-Dive Indicators Row (5m, 15m, 1h) */}
                    {isExpanded && t.timeframes && (
                      <tr className="bg-muted/30">
                        <td colSpan={7} className="py-2 px-4">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-mono">
                            {(["5m", "15m", "1h"] as const).map((tf) => {
                              const data = t.timeframes?.[tf]
                              if (!data) return null
                              return (
                                <div key={tf} className="rounded-md border border-border/50 bg-card/60 p-2 space-y-1">
                                  <div className="flex justify-between items-center font-bold border-b pb-1">
                                    <span className="text-primary">{tf.toUpperCase()} Timeframe</span>
                                    <span className={data.score >= 65 ? "text-emerald-400 font-bold" : "text-muted-foreground"}>
                                      คะแนน {data.score}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1 text-[9px] pt-0.5">
                                    <div>RSI: <span className="font-bold text-foreground">{data.rsiVal}</span></div>
                                    <div>Stoch K: <span className="font-bold text-foreground">{data.stochK}</span></div>
                                    <div>Boll %B: <span className="font-bold text-foreground">{data.bollPctB}%</span></div>
                                    <div>CHOP: <span className="font-bold text-foreground">{data.chopIndex}</span></div>
                                    <div className="col-span-2">
                                      SuperTrend:{" "}
                                      <span className={data.supertrendDir === 1 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                        {data.supertrendDir === 1 ? "BULLISH ↑" : "BEARISH ↓"}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
