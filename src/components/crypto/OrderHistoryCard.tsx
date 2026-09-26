"use client"

import * as React from "react"
import {
  History,
  RefreshCw,
  Download,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Bot,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  fetchRealBitgetOrderHistory,
  loadBitgetConfig,
  type BitgetConfig,
  type BitgetHistoryOrder,
} from "@/services/bitgetSpot"
import { loadQuantLogs } from "@/services/quantEngine"

interface Props {
  config: BitgetConfig
  quantLogs: Array<{ id: string; time: string; action: string; symbol: string; note: string; color: string }>
}

export function OrderHistoryCard({ config, quantLogs }: Props) {
  const [activeTab, setActiveTab] = React.useState<"bitget" | "quant">("bitget")
  const [bitgetOrders, setBitgetOrders] = React.useState<BitgetHistoryOrder[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [sideFilter, setSideFilter] = React.useState<"ALL" | "BUY" | "SELL">("ALL")
  const [lastRefreshed, setLastRefreshed] = React.useState<string>("")

  const loadBitgetHistory = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const activeCfg = config || loadBitgetConfig()
      const data = await fetchRealBitgetOrderHistory(activeCfg)
      setBitgetOrders(data)
      setLastRefreshed(new Date().toLocaleTimeString("th-TH"))
    } catch (e) {
      console.warn("Failed to load Bitget order history:", e)
    } finally {
      setIsLoading(false)
    }
  }, [config])

  React.useEffect(() => {
    loadBitgetHistory()
  }, [loadBitgetHistory])

  // Filtered Bitget Orders
  const filteredBitgetOrders = React.useMemo(() => {
    return bitgetOrders.filter((ord) => {
      const matchSearch =
        !searchQuery ||
        ord.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ord.orderId && ord.orderId.includes(searchQuery))
      const matchSide =
        sideFilter === "ALL" ||
        (sideFilter === "BUY" && ord.side.toLowerCase() === "buy") ||
        (sideFilter === "SELL" && ord.side.toLowerCase() === "sell")
      return matchSearch && matchSide
    })
  }, [bitgetOrders, searchQuery, sideFilter])

  // Filtered Quant Logs
  const filteredQuantLogs = React.useMemo(() => {
    const logs = quantLogs && quantLogs.length > 0 ? quantLogs : loadQuantLogs()
    return logs.filter((log) => {
      const matchSearch =
        !searchQuery ||
        log.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.note.toLowerCase().includes(searchQuery.toLowerCase())
      const matchSide =
        sideFilter === "ALL" ||
        (sideFilter === "BUY" && log.action.toUpperCase().includes("BUY")) ||
        (sideFilter === "SELL" &&
          (log.action.toUpperCase().includes("SELL") ||
            log.action.toUpperCase().includes("PROFIT") ||
            log.action.toUpperCase().includes("CUT")))
      return matchSearch && matchSide
    })
  }, [quantLogs, searchQuery, sideFilter])

  // Export to CSV
  function handleExportCsv() {
    if (activeTab === "bitget") {
      if (filteredBitgetOrders.length === 0) return
      const header = "Time,Order ID,Symbol,Side,Type,Price,Amount,Status"
      const rows = filteredBitgetOrders.map((o) => {
        const timeStr = o.cTime
          ? new Date(Number(o.cTime)).toLocaleString("th-TH")
          : "-"
        const price = o.priceAvg || o.price || "0"
        return `"${timeStr}","${o.orderId}","${o.symbol}","${o.side.toUpperCase()}","${o.orderType}","${price}","${o.size}","${o.status}"`
      })
      downloadCsv([header, ...rows].join("\n"), `bitget_orders_${Date.now()}.csv`)
    } else {
      if (filteredQuantLogs.length === 0) return
      const header = "Time,Action,Symbol,Note"
      const rows = filteredQuantLogs.map((l) => {
        const cleanNote = (l.note || "").replace(/"/g, '""')
        return `"${l.time}","${l.action}","${l.symbol}","${cleanNote}"`
      })
      downloadCsv([header, ...rows].join("\n"), `quant_decision_logs_${Date.now()}.csv`)
    }
  }

  function downloadCsv(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleClearLogs() {
    if (typeof window !== "undefined") {
      if (confirm("ต้องการล้างประวัติบันทึกการตัดสินใจทั้งหมดใช่หรือไม่?")) {
        localStorage.removeItem("bitget_quant_logs_v1")
        fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantLogs: [] }),
        }).finally(() => {
          window.location.reload()
        })
      }
    }
  }

  return (
    <Card className="col-span-12 overflow-hidden border-border/60 shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-inner">
            <History className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2">
              <span>ประวัติการทำรายการ (Order & Trade History)</span>
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                {activeTab === "bitget" ? `${filteredBitgetOrders.length} ออเดอร์` : `${filteredQuantLogs.length} บันทึก`}
              </Badge>
            </CardTitle>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <span>ตรวจสอบคำสั่งซื้อขายจริงจาก Bitget และบันทึกคำสั่ง Quant AI</span>
              {lastRefreshed && (
                <span className="text-[10px] text-muted-foreground/80 font-mono">
                  (อัปเดตล่าสุด: {lastRefreshed})
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={loadBitgetHistory}
            disabled={isLoading}
            className="h-8 text-xs gap-1.5"
            title="รีเฟรชข้อมูลสด"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-primary" : ""}`} />
            <span className="hidden sm:inline">รีเฟรช</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCsv}
            className="h-8 text-xs gap-1.5"
            title="ส่งออกประวัติเป็นไฟล์ CSV"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">ส่งออก CSV</span>
          </Button>

          {activeTab === "quant" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearLogs}
              className="h-8 text-xs gap-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 border-rose-500/20"
              title="ล้างประวัติบันทึก Quant AI เก่าทั้งหมด"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">ล้างประวัติ</span>
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          {/* Tabs & Filters Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b">
            <TabsList className="grid grid-cols-2 w-full sm:w-[380px] h-8 p-0.5">
              <TabsTrigger value="bitget" className="text-xs flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>ประวัติออเดอร์ Bitget จริง</span>
              </TabsTrigger>
              <TabsTrigger value="quant" className="text-xs flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5" />
                <span>บันทึกการตัดสินใจ Quant AI</span>
              </TabsTrigger>
            </TabsList>

            {/* Search & Filter */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-44">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="ค้นหาเหรียญ..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 pr-2.5 text-xs bg-muted/20"
                />
              </div>

              <Select value={sideFilter} onValueChange={(v: any) => setSideFilter(v)}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <Filter className="h-3 w-3 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="ประเภท" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">ทั้งหมด</SelectItem>
                  <SelectItem value="BUY" className="text-xs">ฝั่งซื้อ (BUY)</SelectItem>
                  <SelectItem value="SELL" className="text-xs">ฝั่งขาย (SELL)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tab 1: Real Bitget Order History */}
          <TabsContent value="bitget" className="m-0 pt-2">
            {isLoading ? (
              <div className="flex h-48 flex-col items-center justify-center text-center p-4 text-muted-foreground">
                <RefreshCw className="h-7 w-7 mb-2 animate-spin text-primary opacity-60" />
                <p className="text-xs font-medium">กำลังดึงข้อมูลประวัติออเดอร์จาก Bitget API...</p>
              </div>
            ) : filteredBitgetOrders.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center text-center p-4 text-muted-foreground">
                <History className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-xs font-semibold">ไม่พบประวัติคำสั่งซื้อขายบน Bitget</p>
                <p className="text-[11px] mt-0.5">
                  {config.isPaperTrading
                    ? "ขณะนี้อยู่ในโหมด Paper Trading รายการคำสั่งจะบันทึกในแท็บ 'บันทึกการตัดสินใจ Quant AI'"
                    : "คำสั่งซื้อขายจริงที่ส่งผ่าน API จะปรากฏที่นี่เมื่อมีรายการ"}
                </p>
              </div>
            ) : (
              <div className="max-h-[360px] overflow-x-auto overflow-y-auto w-full">
                <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-card border-b z-10 text-muted-foreground text-[11px]">
                    <tr>
                      <th className="py-2.5 pl-3 pr-2 font-medium">เวลาทำรายการ</th>
                      <th className="py-2.5 px-2 font-medium">เหรียญ / คู่เทรด</th>
                      <th className="py-2.5 px-2 font-medium">ประเภทคำสั่ง</th>
                      <th className="py-2.5 px-2 font-medium">ราคาที่จับคู่</th>
                      <th className="py-2.5 px-2 font-medium">ปริมาณ (Size)</th>
                      <th className="py-2.5 px-2 font-medium">มูลค่ารวม</th>
                      <th className="py-2.5 pr-3 pl-2 font-medium text-right">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-mono">
                    {filteredBitgetOrders.map((ord) => {
                      const isBuy = ord.side.toLowerCase() === "buy"
                      const timeStr = ord.cTime
                        ? new Date(Number(ord.cTime)).toLocaleString("th-TH", {
                            dateStyle: "short",
                            timeStyle: "medium",
                          })
                        : "-"
                      const priceNum = parseFloat(ord.priceAvg || ord.price || "0")
                      const sizeNum = parseFloat(ord.size || "0")
                      const totalUsdt = priceNum * sizeNum

                      return (
                        <tr key={ord.orderId} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2 pl-3 pr-2 text-muted-foreground text-[11px]">
                            {timeStr}
                          </td>
                          <td className="py-2 px-2 font-bold text-foreground">
                            {ord.symbol}
                          </td>
                          <td className="py-2 px-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                isBuy
                                  ? "bg-emerald-500/15 text-emerald-500"
                                  : "bg-rose-500/15 text-rose-500"
                              }`}
                            >
                              {isBuy ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3" />
                              )}
                              {ord.side.toUpperCase()} ({ord.orderType?.toUpperCase() || "MARKET"})
                            </span>
                          </td>
                          <td className="py-2 px-2 font-semibold">
                            ${priceNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                          </td>
                          <td className="py-2 px-2 text-muted-foreground">
                            {sizeNum.toFixed(4)}
                          </td>
                          <td className="py-2 px-2 font-semibold text-primary">
                            ${totalUsdt > 0 ? totalUsdt.toFixed(2) : "-"}
                          </td>
                          <td className="py-2 pr-3 pl-2 text-right">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                ord.status === "filled"
                                  ? "bg-emerald-500/15 text-emerald-500"
                                  : ord.status === "cancelled"
                                  ? "bg-zinc-500/15 text-zinc-400"
                                  : "bg-amber-500/15 text-amber-500"
                              }`}
                            >
                              {ord.status === "filled" ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : ord.status === "cancelled" ? (
                                <XCircle className="h-3 w-3" />
                              ) : (
                                <Clock className="h-3 w-3" />
                              )}
                              {ord.status?.toUpperCase() || "SUCCESS"}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* Tab 2: Quant & AI Decision Logs */}
          <TabsContent value="quant" className="m-0 pt-2">
            {filteredQuantLogs.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center text-center p-4 text-muted-foreground">
                <Bot className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-xs font-semibold">ยังไม่มีบันทึกการตัดสินใจ</p>
                <p className="text-[11px] mt-0.5">เมื่อ Quant สแกนตลาดหรือ AI ตัดสินใจเข้าซื้อ/ขาย ข้อมูลจะถูกบันทึกที่นี่</p>
              </div>
            ) : (
              <div className="max-h-[360px] overflow-x-auto overflow-y-auto w-full">
                <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-card border-b z-10 text-muted-foreground text-[11px]">
                    <tr>
                      <th className="py-2.5 pl-3 pr-2 font-medium w-24">เวลา</th>
                      <th className="py-2.5 px-2 font-medium w-32">คำสั่ง / แอ็กชัน</th>
                      <th className="py-2.5 px-2 font-medium w-28">เหรียญ</th>
                      <th className="py-2.5 pr-3 pl-2 font-medium">บันทึกเหตุผลการวิเคราะห์</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {filteredQuantLogs.map((log) => {
                      return (
                        <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 pl-3 pr-2 font-mono text-[11px] text-muted-foreground">
                            {log.time}
                          </td>
                          <td className="py-2.5 px-2">
                            <span
                              className="inline-block rounded px-2 py-0.5 text-[10px] font-bold"
                              style={{
                                color: log.color,
                                backgroundColor: `${log.color}15`,
                              }}
                            >
                              {log.action}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 font-bold font-mono text-foreground">
                            {log.symbol}
                          </td>
                          <td className="py-2.5 pr-3 pl-2 text-muted-foreground text-[11px] leading-relaxed">
                            {log.note}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
