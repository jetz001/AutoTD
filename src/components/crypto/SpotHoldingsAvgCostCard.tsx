"use client"

import * as React from "react"
import { Layers, Target, ShieldAlert, CheckCircle, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { SpotHolding, BitgetConfig } from "@/services/bitgetSpot"

interface Props {
  holdings: SpotHolding[]
  config: BitgetConfig
  onSellHolding: (symbol: string, currentPrice: number, isCutLoss: boolean) => void
  onSelectSymbol: (symbol: string) => void
}

export function SpotHoldingsAvgCostCard({
  holdings,
  config,
  onSellHolding,
  onSelectSymbol,
}: Props) {
  const totalUnrealizedPnl = holdings.reduce((sum, h) => sum + h.unrealizedPnlUsdt, 0)
  const totalInvested = holdings.reduce((sum, h) => sum + h.totalInvestedUsdt, 0)

  return (
    <Card className="col-span-12 lg:col-span-6 flex flex-col h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <span>💼 เหรียญที่ถือ & ต้นทุนเฉลี่ย (DCA Avg Cost)</span>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              {holdings.length}/{config.maxCoins} เหรียญ
            </span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            แก้ปัญหางงหลายไม้: รวมคำนวณราคาเฉลี่ยจริง + เป้าขาย TP / จุดคัท SL
          </p>
        </div>

        {/* Portfolio Summary Badge */}
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground">Unrealized PnL รวม</div>
          <div
            className={`font-mono text-sm font-bold ${
              totalUnrealizedPnl >= 0 ? "text-emerald-500" : "text-rose-500"
            }`}
          >
            {totalUnrealizedPnl >= 0 ? "+" : ""}${totalUnrealizedPnl.toFixed(2)}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-0">
        {holdings.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center p-4 text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-xs font-semibold">ยังไม่มีเหรียญในพอร์ต Spot</p>
            <p className="text-[11px] mt-0.5">Quant กำลังสแกนหาจังหวะ Dip หรือกด "ซื้อไม้นี้" จากตาราง Screener ได้เลย</p>
          </div>
        ) : (
          <div className="max-h-[380px] overflow-y-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-card border-b z-10 text-muted-foreground text-[11px]">
                <tr>
                  <th className="py-2.5 pl-4 pr-2 font-medium">เหรียญ / ไม้</th>
                  <th className="py-2.5 px-2 font-medium">ราคาซื้อเฉลี่ย</th>
                  <th className="py-2.5 px-2 font-medium">ราคาตลาด</th>
                  <th className="py-2.5 px-2 font-medium">กำไร/ขาดทุน PnL</th>
                  <th className="py-2.5 px-2 font-medium">เป้าขาย / จุดคัท</th>
                  <th className="py-2.5 pr-4 pl-2 font-medium text-right">คำสั่งด่วน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {holdings.map((h) => {
                  const isProfit = h.unrealizedPnlUsdt >= 0
                  const isCloseToTp = h.currentPrice >= h.takeProfitPrice
                  const isCloseToSl = h.currentPrice <= h.cutLossPrice

                  return (
                    <tr
                      key={h.symbol}
                      onClick={() => onSelectSymbol(h.symbol)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      {/* Coin & Tranches */}
                      <td className="py-2.5 pl-4 pr-2">
                        <div className="font-bold text-foreground flex items-center gap-1.5">
                          <span>{h.symbol}</span>
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                            {h.tranchesCount}/{config.maxTranches} ไม้
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          ถือ {h.totalAmount.toFixed(2)} {h.baseCoin} (${h.totalInvestedUsdt.toFixed(0)})
                        </div>
                      </td>

                      {/* Weighted Average Cost */}
                      <td className="py-2.5 px-2">
                        <div className="font-mono font-bold text-sky-400">
                          ${h.avgCostPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          ต้นทุนเฉลี่ย
                        </div>
                      </td>

                      {/* Live Market Price */}
                      <td className="py-2.5 px-2">
                        <div className="font-mono font-semibold text-foreground">
                          ${h.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </div>
                      </td>

                      {/* PnL % and $ */}
                      <td className="py-2.5 px-2">
                        <div className={`font-mono font-bold ${isProfit ? "text-emerald-500" : "text-rose-500"}`}>
                          {isProfit ? "+" : ""}{h.pnlPercent.toFixed(2)}%
                        </div>
                        <div className={`text-[10px] font-mono ${isProfit ? "text-emerald-500/80" : "text-rose-500/80"}`}>
                          {isProfit ? "+" : ""}${h.unrealizedPnlUsdt.toFixed(2)}
                        </div>
                      </td>

                      {/* Targets */}
                      <td className="py-2.5 px-2 font-mono text-[10px]">
                        <div className="flex items-center gap-1 text-emerald-500">
                          <span>TP:</span>
                          <span className="font-bold">${h.takeProfitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          {isCloseToTp && <span className="rounded bg-emerald-500 px-1 text-[8px] text-white">ถึงเป้า</span>}
                        </div>
                        <div className="flex items-center gap-1 text-rose-500 mt-0.5">
                          <span>SL:</span>
                          <span className="font-bold">${h.cutLossPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          {isCloseToSl && <span className="rounded bg-rose-500 px-1 text-[8px] text-white">แตะคัท</span>}
                        </div>
                      </td>

                      {/* Fast Action Buttons */}
                      <td className="py-2.5 pr-4 pl-2 text-right">
                        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => onSellHolding(h.symbol, h.currentPrice, false)}
                            className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-500 font-bold"
                            title="ขายทำกำไรปิดรอบทันที"
                          >
                            ขายทำกำไร
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onSellHolding(h.symbol, h.currentPrice, true)}
                            className="h-6 px-2 text-[10px] font-bold"
                            title="คัทลอส 100% ดึงเงินสด USDT คืนทันที"
                          >
                            คัทลอส
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
