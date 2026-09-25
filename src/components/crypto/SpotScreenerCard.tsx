"use client"

import * as React from "react"
import { Search, TrendingUp, TrendingDown, ShoppingBag, ShieldAlert } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { SpotTickerItem } from "@/services/bitgetSpot"

interface Props {
  tickers: SpotTickerItem[]
  selectedSymbol: string
  onSelectSymbol: (symbol: string) => void
  onBuyTranche: (symbol: string, price: number) => void
  isPortfolioFull?: boolean
  onRebalanceSwap?: (symbol: string, price: number) => void
}

export function SpotScreenerCard({
  tickers,
  selectedSymbol,
  onSelectSymbol,
  onBuyTranche,
  isPortfolioFull = false,
  onRebalanceSwap,
}: Props) {
  const [filterText, setFilterText] = React.useState("")

  const filtered = tickers.filter((t) =>
    t.symbol.toLowerCase().includes(filterText.toLowerCase())
  )

  return (
    <Card className="col-span-12 lg:col-span-6 flex flex-col h-full overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm sm:text-base font-bold flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span>🔍 Bitget Spot AI Screener</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-[9px] sm:text-[10px] font-semibold text-muted-foreground">
              Top 20 วอลลุ่ม
            </span>
          </CardTitle>
          <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
            สแกนหาจังหวะย่อในขาขึ้น (Dip in Uptrend) จัดลำดับคะแนนน่าซื้อ
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
          <table className="w-full min-w-[500px] border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-card border-b z-10 text-muted-foreground text-[11px]">
              <tr>
                <th className="py-2.5 pl-4 pr-2 font-medium">เหรียญ / 24h Vol</th>
                <th className="py-2.5 px-2 font-medium">ราคาตลาด</th>
                <th className="py-2.5 px-2 font-medium">24h Change</th>
                <th className="py-2.5 px-2 font-medium">RSI 15m</th>
                <th className="py-2.5 px-2 font-medium">คะแนน AI</th>
                <th className="py-2.5 pr-4 pl-2 font-medium text-right">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.map((t) => {
                const isSelected = selectedSymbol === t.symbol
                const isUp = t.change24h >= 0
                const isCooldown = t.signal === 'COOLDOWN'
                const isBuyDip = t.signal === 'BUY_DIP'

                return (
                  <tr
                    key={t.symbol}
                    onClick={() => onSelectSymbol(t.symbol)}
                    className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                      isSelected ? "bg-primary/10" : ""
                    }`}
                  >
                    {/* Coin Symbol & Volume */}
                    <td className="py-2.5 pl-4 pr-2">
                      <div className="font-bold text-foreground flex items-center gap-1.5">
                        <span>{t.symbol}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Vol ${(t.usdtVolume / 1e6).toFixed(1)}M
                      </div>
                    </td>

                    {/* Price */}
                    <td className="py-2.5 px-2 font-mono font-semibold text-foreground">
                      ${t.lastPr > 10 ? t.lastPr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t.lastPr.toFixed(4)}
                    </td>

                    {/* 24h Change */}
                    <td className="py-2.5 px-2">
                      <span
                        className={`inline-flex items-center gap-0.5 font-semibold text-[11px] ${
                          isUp ? "text-emerald-500" : "text-rose-500"
                        }`}
                      >
                        {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {isUp ? "+" : ""}{t.change24h.toFixed(2)}%
                      </span>
                    </td>

                    {/* RSI */}
                    <td className="py-2.5 px-2">
                      <span
                        className={`font-mono text-[11px] font-bold ${
                          (t.rsi15m ?? 50) < 45 ? "text-emerald-500" : (t.rsi15m ?? 50) > 65 ? "text-rose-500" : "text-amber-500"
                        }`}
                      >
                        {t.rsi15m ?? 50}
                      </span>
                    </td>

                    {/* AI Score Badge */}
                    <td className="py-2.5 px-2">
                      {isCooldown ? (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-500">
                          <ShieldAlert className="h-2.5 w-2.5" /> COOLDOWN
                        </span>
                      ) : isPortfolioFull && (t.aiScore ?? 0) >= 85 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold text-purple-400">
                          🔄 โอกาส A+ ({t.aiScore})
                        </span>
                      ) : isBuyDip ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                          🟢 น่าซื้อ ({t.aiScore})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          🟡 รอดู ({t.aiScore})
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-2.5 pr-4 pl-2 text-right">
                      {isPortfolioFull && (t.aiScore ?? 0) >= 85 && onRebalanceSwap ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isCooldown}
                          onClick={(e) => {
                            e.stopPropagation()
                            onRebalanceSwap(t.symbol, t.lastPr)
                          }}
                          className="h-7 px-2 text-[10px] font-bold bg-purple-600 hover:bg-purple-500 text-white"
                          title="ไม้เต็มมือแล้ว: ปิดตัวที่นิ่งที่สุดเพื่อสลับเข้าโอกาสทองนี้แทน"
                        >
                          🔄 สลับตัวแทน
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={isBuyDip ? "default" : "outline"}
                          disabled={isCooldown}
                          onClick={(e) => {
                            e.stopPropagation()
                            onBuyTranche(t.symbol, t.lastPr)
                          }}
                          className="h-7 px-2 text-[10px] font-bold"
                        >
                          <ShoppingBag className="mr-1 h-3 w-3" />
                          ซื้อไม้นี้
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
