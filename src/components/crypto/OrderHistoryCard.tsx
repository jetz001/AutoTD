"use client"

import * as React from "react"
import {
  History,
  Download,
  Search,
  Bot,
  Filter,
  Trash2,
  RotateCcw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type BitgetConfig } from "@/services/bitgetSpot"
import { loadQuantLogs, clearAllQuantLogs, resetAllTradingData } from "@/services/quantEngine"

interface Props {
  config: BitgetConfig
  quantLogs: Array<{ id: string; time: string; action: string; symbol: string; note: string; color: string }>
}

export function OrderHistoryCard({ config, quantLogs }: Props) {
  const [searchQuery, setSearchQuery] = React.useState("")
  const [sideFilter, setSideFilter] = React.useState<"ALL" | "BUY" | "SELL">("ALL")

  // Filtered Quant Logs
  const filteredQuantLogs = React.useMemo(() => {
    const rawLogs = (Array.isArray(quantLogs) ? quantLogs : loadQuantLogs(config.isPaperTrading)) as any[]
    const sortedLogs = [...rawLogs].sort((a, b) => {
      const timeA = Number(a.timestamp || (a.id && !isNaN(Number(a.id)) && a.id.length >= 13 ? Number(a.id) : 0))
      const timeB = Number(b.timestamp || (b.id && !isNaN(Number(b.id)) && b.id.length >= 13 ? Number(b.id) : 0))
      if (timeA && timeB && timeA !== timeB) return timeB - timeA
      return 0
    })
    return sortedLogs.filter((log) => {
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
  }, [quantLogs, searchQuery, sideFilter, config.isPaperTrading])

  // Export to CSV
  function handleExportCsv() {
    if (filteredQuantLogs.length === 0) return
    const header = "Time,Action,Symbol,Note"
    const rows = filteredQuantLogs.map((l) => {
      const cleanNote = (l.note || "").replace(/"/g, '""')
      return `"${l.time}","${l.action}","${l.symbol}","${cleanNote}"`
    })
    downloadCsv([header, ...rows].join("\n"), `quant_decision_logs_${Date.now()}.csv`)
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

  async function handleClearLogs(fullReset = false) {
    if (typeof window !== "undefined") {
      const modeText = config.isPaperTrading ? "โหมดจำลอง (Paper)" : "โหมดเทรดจริง (Live)"
      const confirmMsg = fullReset
        ? "⚠️ ยืนยันเคลียนับใหม่ทั้งหมด?\n- ล้างประวัติบันทึก Quant AI ทุกเครื่อง\n- รีเซ็ตเหรียญจำลองในพอร์ต\n- รีเซ็ตยอดเงินทุนจำลองเป็น $10,000 USDT\n(ซิงค์เคลียทันทีบน Cloudflare D1 ทุกอุปกรณ์)"
        : `ต้องการล้างประวัติบันทึกการตัดสินใจของ ${modeText} ทั้งหมด (ซิงค์ D1 ทุกเครื่อง) ใช่หรือไม่?`
      if (confirm(confirmMsg)) {
        if (fullReset) {
          await resetAllTradingData()
        } else {
          await clearAllQuantLogs(config.isPaperTrading)
        }
        window.location.reload()
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
              <span>บันทึกการตัดสินใจ Quant AI</span>
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                {filteredQuantLogs.length} บันทึก
              </Badge>
            </CardTitle>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
              บันทึกเหตุผลการวิเคราะห์ สัญญาณเข้าซื้อ/ขาย และประวัติการเทรดอัตโนมัติ
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
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

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleClearLogs(false)}
            className="h-8 text-xs gap-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 border-rose-500/20"
            title="ล้างประวัติบันทึก Quant AI (ซิงค์ D1 ทุกเครื่อง)"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">ล้างประวัติ</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleClearLogs(true)}
            className="h-8 text-xs gap-1.5 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10 border-amber-500/20"
            title="เคลียนับใหม่ทั้งหมด รีเซ็ตพอร์ตและบันทึกสู่เริ่มต้น ($10,000 USDT) ทุกเครื่องผ่าน Cloudflare D1"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">เคลียนับใหม่</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Bot className="h-4 w-4 text-primary" />
            <span>รายการตัดสินใจของ AI & สัญญาณทางเทคนิค</span>
          </div>

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

        {/* Quant & AI Decision Logs Table */}
        {filteredQuantLogs.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center p-4 text-muted-foreground">
            <Bot className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-xs font-semibold">ยังไม่มีบันทึกการตัดสินใจ</p>
            <p className="text-[11px] mt-0.5">เมื่อ Quant สแกนตลาดหรือ AI ตัดสินใจเข้าซื้อ/ขาย ข้อมูลจะถูกบันทึกที่นี่</p>
          </div>
        ) : (
          <div className="max-h-[380px] overflow-x-auto overflow-y-auto w-full">
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
                {filteredQuantLogs.map((log: any) => {
                  const rawTs = Number(log.timestamp || (log.id && !isNaN(Number(log.id)) && log.id.length >= 13 ? Number(log.id) : 0))
                  const displayTime = rawTs > 0
                    ? new Date(rawTs).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour12: false })
                    : log.time
                  return (
                    <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pl-3 pr-2 font-mono text-[11px] text-muted-foreground">
                        {displayTime}
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
      </CardContent>
    </Card>
  )
}
