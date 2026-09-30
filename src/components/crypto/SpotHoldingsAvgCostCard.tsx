"use client"

import * as React from "react"
import { 
  Layers, 
  Target, 
  ShieldAlert, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  Sliders, 
  Lock, 
  ShieldCheck, 
  ChevronDown, 
  ChevronUp, 
  X,
  Zap
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { filterActiveAndDustHoldings, type SpotHolding, type BitgetConfig } from "@/services/bitgetSpot"

interface Props {
  holdings: SpotHolding[]
  config: BitgetConfig
  onSellHolding: (symbol: string, currentPrice: number, isCutLoss: boolean) => void
  onSelectSymbol: (symbol: string) => void
  onUpdateHolding?: (symbol: string, updates: Partial<SpotHolding>) => void
}

export function SpotHoldingsAvgCostCard({
  holdings,
  config,
  onSellHolding,
  onSelectSymbol,
  onUpdateHolding,
}: Props) {
  // Separate active investments (>= $1.00) from dust residues (< $1.00)
  const { active: activeHoldings, dust: dustHoldings } = React.useMemo(() => {
    return filterActiveAndDustHoldings(holdings)
  }, [holdings])

  const [isDustDrawerOpen, setIsDustDrawerOpen] = React.useState(false)
  const [editingHolding, setEditingHolding] = React.useState<SpotHolding | null>(null)
  const [editTpPrice, setEditTpPrice] = React.useState<string>("")
  const [editSlPrice, setEditSlPrice] = React.useState<string>("")
  const [editMaxHoldMinutes, setEditMaxHoldMinutes] = React.useState<number>(180)
  const [editManualLock, setEditManualLock] = React.useState<boolean>(false)

  // Real-time ticking clock for active countdown
  const [currentTimestamp, setCurrentTimestamp] = React.useState<number>(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimestamp(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const totalUnrealizedPnl = holdings.reduce((sum, h) => sum + h.unrealizedPnlUsdt, 0)
  const totalActiveInvested = activeHoldings.reduce((sum, h) => sum + h.totalInvestedUsdt, 0)

  // Open Edit Modal
  const handleOpenEdit = (h: SpotHolding, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingHolding(h)
    setEditTpPrice(h.takeProfitPrice.toString())
    setEditSlPrice(h.cutLossPrice.toString())
    setEditMaxHoldMinutes(h.maxHoldMinutes || 180)
    setEditManualLock(Boolean(h.manualLock))
  }

  // Save Edit Modal Changes
  const handleSaveEdit = () => {
    if (!editingHolding || !onUpdateHolding) return
    const tp = parseFloat(editTpPrice)
    const sl = parseFloat(editSlPrice)

    onUpdateHolding(editingHolding.symbol, {
      takeProfitPrice: !isNaN(tp) && tp > 0 ? tp : editingHolding.takeProfitPrice,
      cutLossPrice: !isNaN(sl) && sl > 0 ? sl : editingHolding.cutLossPrice,
      maxHoldMinutes: editMaxHoldMinutes,
      manualLock: editManualLock,
    })

    setEditingHolding(null)
  }

  return (
    <Card className="col-span-12 lg:col-span-6 flex flex-col h-full overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm sm:text-base font-bold flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span>💼 เหรียญที่ถือ & ต้นทุนเฉลี่ย (DCA Avg Cost)</span>
            {/* Real Active Quota Slot Counter (Excludes Dust) */}
            <span className={`rounded-md px-2 py-0.5 text-[9px] sm:text-[10px] font-bold ${
              activeHoldings.length >= config.maxCoins 
                ? "bg-rose-500/15 text-rose-400 border border-rose-500/30" 
                : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
            }`}>
              {activeHoldings.length}/{config.maxCoins} โควตา
            </span>
            {dustHoldings.length > 0 && (
              <span className="text-[10px] text-muted-foreground font-normal">
                (มีเศษเหรียญ {dustHoldings.length})
              </span>
            )}
          </CardTitle>
          <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
            คำนวณต้นทุนเฉลี่ยจริง + เป้าขาย Dynamic TP / Trailing SL / กลยุทธ์ตามกรอบเวลา
          </p>
        </div>

        {/* Portfolio Summary Badge */}
        <div className="text-left sm:text-right">
          <div className="text-[10px] text-muted-foreground">
            พอร์ตที่ลงทุน ${totalActiveInvested.toFixed(1)} | PnL รวม
          </div>
          <div
            className={`font-mono text-xs sm:text-sm font-bold ${
              totalUnrealizedPnl >= 0 ? "text-emerald-500" : "text-rose-500"
            }`}
          >
            {totalUnrealizedPnl >= 0 ? "+" : ""}${totalUnrealizedPnl.toFixed(2)}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 overflow-hidden flex flex-col justify-between">
        {activeHoldings.length === 0 ? (
          <div className="flex h-52 flex-col items-center justify-center text-center p-4 text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-30 text-emerald-400" />
            <p className="text-xs font-semibold text-foreground">ไม่มีเหรียญที่ถือครองหลักในพอร์ต</p>
            <p className="text-[11px] mt-1 max-w-sm text-muted-foreground">
              มีโควตาว่างพร้อมช้อนซื้อ {config.maxCoins} เหรียญ! Quant Engine กำลังสแกนหาจังหวะ Confluence Score สูงสุด หรือคลิกเลือกซื้อจากตารางได้ทันที
            </p>
          </div>
        ) : (
          <div className="max-h-[380px] overflow-x-auto overflow-y-auto w-full">
            <table className="w-full min-w-[620px] border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur-xs border-b z-10 text-muted-foreground text-[11px]">
                <tr>
                  <th className="py-2.5 pl-4 pr-2 font-medium">เหรียญ / ไม้</th>
                  <th className="py-2.5 px-2 font-medium">กลยุทธ์ & กรอบเวลา</th>
                  <th className="py-2.5 px-2 font-medium">ต้นทุนเฉลี่ย</th>
                  <th className="py-2.5 px-2 font-medium">ราคาตลาด</th>
                  <th className="py-2.5 px-2 font-medium">กำไร/ขาดทุน PnL</th>
                  <th className="py-2.5 px-2 font-medium">เป้าขาย TP / จุดคัท SL</th>
                  <th className="py-2.5 pr-4 pl-2 font-medium text-right">คำสั่งด่วน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {activeHoldings.map((h) => {
                  const isProfit = h.unrealizedPnlUsdt >= 0
                  const isCloseToTp = h.currentPrice >= h.takeProfitPrice
                  const isCloseToSl = h.currentPrice <= h.cutLossPrice

                  // Format Start Time and End Time clearly as requested
                  const entryTime = h.entryTimestamp && h.entryTimestamp > 0
                    ? h.entryTimestamp
                    : (h.history?.[0]?.time && !isNaN(new Date(h.history[0].time).getTime())
                      ? new Date(h.history[0].time).getTime()
                      : Date.now())

                  const maxMinutes = h.maxHoldMinutes || 180
                  const expiryTimestamp = entryTime + (maxMinutes * 60 * 1000)
                  const isTimeExpired = Date.now() >= expiryTimestamp

                  const startTimeStr = new Date(entryTime).toLocaleTimeString("th-TH", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })
                  const endTimeStr = new Date(expiryTimestamp).toLocaleTimeString("th-TH", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })

                  return (
                    <tr
                      key={h.symbol}
                      onClick={() => onSelectSymbol(h.symbol)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      {/* 1. Coin Symbol & Amount */}
                      <td className="py-2.5 pl-4 pr-2">
                        <div className="font-bold text-foreground flex items-center gap-1.5">
                          <span>{h.symbol}</span>
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                            {h.tranchesCount}/{config.maxTranches} ไม้
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          ถือ {h.totalAmount < 1 ? h.totalAmount.toFixed(4) : h.totalAmount.toFixed(2)} (${h.totalInvestedUsdt.toFixed(1)})
                        </div>
                      </td>

                      {/* 2. Strategy, Timeframe & Start / End Time Display */}
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {h.targetTimeframe && (
                            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold text-sky-400 border border-sky-500/30 font-mono">
                              {h.targetTimeframe}
                            </span>
                          )}
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-foreground">
                            {h.primaryIndicator ? h.primaryIndicator.replace(/_/g, " ") : "Multi-Indicator"}
                          </span>
                          {h.breakevenLocked && (
                            <span className="rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 py-0.2 text-[8px] font-bold flex items-center gap-0.5" title="ขยับ SL บังทุนแล้ว">
                              <ShieldCheck className="h-2.5 w-2.5" /> บังทุน
                            </span>
                          )}
                          {h.manualLock && (
                            <span className="rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1 py-0.2 text-[8px] font-bold flex items-center gap-0.5" title="ล็อคป้องกันการขายอัตโนมัติ">
                              <Lock className="h-2.5 w-2.5" /> ล็อค
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono flex-wrap">
                          <Clock className={`h-3 w-3 ${isTimeExpired ? "text-amber-400" : "text-emerald-400"}`} />
                          <span className="text-foreground font-semibold">
                            เริ่ม {startTimeStr} ➔ สิ้นสุด {endTimeStr}
                          </span>
                          {isTimeExpired ? (
                            <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[8px] font-bold text-amber-400 border border-amber-500/30">
                              ครบกำหนด
                            </span>
                          ) : (
                            <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[8px] font-bold text-emerald-400 border border-emerald-500/30">
                              กำลังถือ ({maxMinutes} น.)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. Weighted Average Cost */}
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

                      {/* Targets (TP / SL / Trailing) */}
                      <td className="py-2.5 px-2 font-mono text-[10px]">
                        <div className="flex items-center gap-1 text-emerald-500">
                          <span>TP:</span>
                          <span className="font-bold">${h.takeProfitPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                          {isCloseToTp && <span className="rounded bg-emerald-500 px-1 text-[8px] text-white">ถึงเป้า</span>}
                        </div>
                        <div className="flex items-center gap-1 text-rose-500 mt-0.5">
                          <span>SL:</span>
                          <span className="font-bold">${h.cutLossPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                          {isCloseToSl && <span className="rounded bg-rose-500 px-1 text-[8px] text-white">แตะคัท</span>}
                        </div>
                        {h.trailingSlPrice && h.trailingSlPrice > h.cutLossPrice && (
                          <div className="text-[9px] text-sky-400">
                            Trail: ${h.trailingSlPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </div>
                        )}
                      </td>

                      {/* Fast Action Buttons */}
                      <td className="py-2.5 pr-4 pl-2 text-right">
                        <div className="flex justify-end items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {/* Tune / Adjust Settings Button */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => handleOpenEdit(h, e)}
                            className="h-6 px-1.5 text-[10px] border-border/80 text-muted-foreground hover:text-foreground"
                            title="ปรับแต่งเป้าหมาย TP / SL / ขยายเวลา / ล็อคเหรียญ"
                          >
                            <Sliders className="h-3 w-3" />
                          </Button>

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

        {/* Collapsible Foldable Drawer for Dust Balances (< $1.00) */}
        {dustHoldings.length > 0 && (
          <div className="border-t border-border/40 bg-muted/20 px-3 py-2 text-xs">
            <button
              onClick={() => setIsDustDrawerOpen(!isDustDrawerOpen)}
              className="flex items-center justify-between w-full text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <span>🧹 เศษเหรียญค้างพอร์ต (&lt; $1.00)</span>
                <span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-mono text-muted-foreground">
                  {dustHoldings.length} รายการ (ไม่นับรวมโควตา)
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <span>{isDustDrawerOpen ? "ซ่อน" : "ดูรายการ"}</span>
                {isDustDrawerOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </div>
            </button>

            {isDustDrawerOpen && (
              <div className="mt-2 space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {dustHoldings.map((dh) => (
                  <div
                    key={dh.symbol}
                    className="flex items-center justify-between rounded bg-card/60 px-2 py-1 text-[11px] font-mono border border-border/30"
                  >
                    <div>
                      <span className="font-bold text-foreground mr-1.5">{dh.symbol}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {dh.totalAmount} {dh.baseCoin}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        ≈ ${dh.totalInvestedUsdt.toFixed(2)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onSellHolding(dh.symbol, dh.currentPrice, true)}
                        className="h-5 px-1.5 text-[9px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                        title="ขายเศษเหรียญนี้ทิ้ง"
                      >
                        ล้างเศษ
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Manual Target & Strategy Adjustment Modal */}
      {editingHolding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in-0">
          <div 
            className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-primary" />
                <span className="font-bold text-sm">ปรับเป้า & ขยายเวลา: {editingHolding.symbol}</span>
              </div>
              <button 
                onClick={() => setEditingHolding(null)}
                className="text-muted-foreground hover:text-foreground rounded p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="rounded-lg bg-muted/40 p-2.5 flex justify-between items-center font-mono">
                <div>
                  <div className="text-[10px] text-muted-foreground">ต้นทุนเฉลี่ย</div>
                  <div className="font-bold text-sky-400">${editingHolding.avgCostPrice.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">ราคาตลาด</div>
                  <div className="font-bold text-foreground">${editingHolding.currentPrice.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">PnL ปัจจุบัน</div>
                  <div className={`font-bold ${editingHolding.pnlPercent >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    {editingHolding.pnlPercent >= 0 ? "+" : ""}{editingHolding.pnlPercent.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* Take Profit Price */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  🎯 ปรับราคาเป้าขายทำกำไร (TP Price)
                </label>
                <input
                  type="number"
                  step="any"
                  value={editTpPrice}
                  onChange={(e) => setEditTpPrice(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Cut Loss Price */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  🛑 ปรับราคาตัดขาดทุน (SL Price)
                </label>
                <input
                  type="number"
                  step="any"
                  value={editSlPrice}
                  onChange={(e) => setEditSlPrice(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Max Hold Minutes & Quick Extension Buttons */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  ⏱️ กำหนดเวลาถือครองสูงสุด (นาที)
                </label>
                <div className="flex gap-1.5 items-center mb-1.5">
                  <input
                    type="number"
                    value={editMaxHoldMinutes}
                    onChange={(e) => setEditMaxHoldMinutes(parseInt(e.target.value) || 60)}
                    className="w-24 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
                  />
                  <span className="text-[11px] text-muted-foreground">นาที</span>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditMaxHoldMinutes((prev) => prev + 30)}
                    className="h-6 text-[10px] px-2"
                  >
                    +30 นาที
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditMaxHoldMinutes((prev) => prev + 60)}
                    className="h-6 text-[10px] px-2"
                  >
                    +1 ชม.
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditMaxHoldMinutes((prev) => prev + 240)}
                    className="h-6 text-[10px] px-2"
                  >
                    +4 ชม.
                  </Button>
                </div>
              </div>

              {/* Manual Lock Checkbox */}
              <div className="flex items-center gap-2 pt-1 border-t">
                <input
                  type="checkbox"
                  id="manualLockCheckbox"
                  checked={editManualLock}
                  onChange={(e) => setEditManualLock(e.target.checked)}
                  className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                />
                <label htmlFor="manualLockCheckbox" className="text-[11px] font-medium cursor-pointer">
                  🛡️ ล็อคป้องกันการขาย (Manual Lock ห้ามบอทขายออก)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingHolding(null)}
                className="h-8 text-xs"
              >
                ยกเลิก
              </Button>
              <Button
                size="sm"
                onClick={handleSaveEdit}
                className="h-8 text-xs bg-primary hover:bg-primary/90 font-bold"
              >
                บันทึกการปรับแต่ง
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
