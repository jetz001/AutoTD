"use client"

import * as React from "react"
import {
  FileText,
  X,
  RefreshCw,
  Copy,
  Check,
  TrendingUp,
  Percent,
  Receipt,
  Sparkles,
  Calendar,
  AlertCircle,
  ExternalLink
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface DailyReportItem {
  id: string
  date: string
  title: string
  summary: string
  content?: string
  total_trades: number
  win_rate: number
  gross_pnl: number
  net_pnl: number
  total_fees: number
  ai_provider: string
  created_at: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function DailyReportModal({ isOpen, onClose }: Props) {
  const [reports, setReports] = React.useState<DailyReportItem[]>([])
  const [selectedReport, setSelectedReport] = React.useState<DailyReportItem | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)

  // Fetch report list
  const fetchReports = React.useCallback(async (selectFirst = true) => {
    setIsLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/api/reports")
      if (res.ok) {
        const data = await res.json()
        if (data.success && Array.isArray(data.reports)) {
          setReports(data.reports)
          if (selectFirst && data.reports.length > 0) {
            // Load full content of the latest report
            await loadReportDetail(data.reports[0].id)
          }
        }
      } else {
        setErrorMsg("ไม่สามารถโหลดรายการรายงานได้")
      }
    } catch (err: any) {
      setErrorMsg(err.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Load specific report content
  const loadReportDetail = async (reportId: string) => {
    try {
      const res = await fetch(`/api/reports?id=${reportId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.report) {
          setSelectedReport(data.report)
        }
      }
    } catch (err) {
      console.warn("Failed to load report detail:", err)
    }
  }

  React.useEffect(() => {
    if (isOpen) {
      fetchReports()
    }
  }, [isOpen, fetchReports])

  // Trigger manual generation
  const handleGenerateToday = async () => {
    setIsGenerating(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      })
      const data = await res.json()
      if (data.success && data.report) {
        setSelectedReport(data.report)
        await fetchReports(false)
      } else {
        setErrorMsg(data.msg || "สร้างรายงานไม่สำเร็จ")
      }
    } catch (err: any) {
      setErrorMsg(err.message || "สร้างรายงานไม่สำเร็จ")
    } finally {
      setIsGenerating(false)
    }
  }

  // Copy report to clipboard
  const handleCopy = () => {
    if (!selectedReport?.content) return
    navigator.clipboard.writeText(selectedReport.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[92vh] rounded-2xl border bg-card shadow-2xl overflow-hidden border-border/80">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3.5 sm:px-6 bg-gradient-to-r from-card via-card to-primary/5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-foreground truncate">
                  รายงานซื้อขาย & ข่าววิเคราะห์ประจำวัน
                </h2>
                <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-500/20 shrink-0">
                  AI DAILY INTEL
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                สรุปการตัดสินใจ JEV & Quant, คำนวณค่าธรรมเนียม Bitget (Taker 0.1%), และสรุปข่าวตลาด
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateToday}
              disabled={isGenerating}
              className="gap-1.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary border-primary/30 h-8"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{isGenerating ? "กำลังวิเคราะห์..." : "สร้างรายงานวันนี้ใหม่"}</span>
              <span className="sm:hidden">{isGenerating ? "กำลังเขียน..." : "สร้างใหม่"}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          
          {/* Sidebar: Reports List */}
          <div className="w-full md:w-64 border-b md:border-b-0 md:border-r bg-muted/20 p-3 overflow-y-auto max-h-40 md:max-h-none shrink-0 space-y-1.5">
            <div className="text-[11px] font-semibold text-muted-foreground px-2 py-1 flex items-center justify-between">
              <span>ประวัติรายงาน</span>
              <span className="font-mono text-[10px]">{reports.length} ฉบับ</span>
            </div>

            {isLoading && reports.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> กำลังโหลด...
              </div>
            )}

            {!isLoading && reports.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">
                ยังไม่มีรายงานในระบบ กดปุ่ม "สร้างรายงานวันนี้ใหม่" ด้านบนเพื่อเริ่มวิเคราะห์
              </div>
            )}

            {reports.map((r) => {
              const isSelected = selectedReport?.id === r.id || selectedReport?.date === r.date
              return (
                <button
                  key={r.id}
                  onClick={() => loadReportDetail(r.id)}
                  className={`w-full text-left p-2.5 rounded-xl text-xs transition-all border ${
                    isSelected
                      ? "bg-primary/15 border-primary/40 text-foreground font-medium shadow-sm"
                      : "bg-card/50 border-border/50 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between font-mono font-bold text-xs mb-1">
                    <span className="flex items-center gap-1 text-foreground">
                      <Calendar className="h-3 w-3 text-primary" />
                      {r.date}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                      r.net_pnl >= 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                    }`}>
                      {r.net_pnl >= 0 ? "+" : ""}${r.net_pnl}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate line-clamp-1 mb-1">
                    {r.title}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                    <span>เทรด {r.total_trades} ไม้</span>
                    <span>•</span>
                    <span>Win {r.win_rate}%</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Main Article Reader */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {errorMsg && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {selectedReport ? (
              <>
                {/* Stats Summary Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {/* Total Trades */}
                  <div className="rounded-xl border bg-muted/20 p-2.5">
                    <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                      <Receipt className="h-3 w-3 text-cyan-400" /> จำนวนคำสั่งซื้อขาย
                    </div>
                    <div className="text-base font-bold font-mono text-foreground mt-0.5">
                      {selectedReport.total_trades} <span className="text-xs font-normal text-muted-foreground">ไม้</span>
                    </div>
                  </div>

                  {/* Win Rate */}
                  <div className="rounded-xl border bg-muted/20 p-2.5">
                    <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                      <Percent className="h-3 w-3 text-emerald-400" /> Win Rate
                    </div>
                    <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">
                      {selectedReport.win_rate}%
                    </div>
                  </div>

                  {/* Bitget Fees */}
                  <div className="rounded-xl border bg-muted/20 p-2.5">
                    <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                      <Receipt className="h-3 w-3 text-amber-400" /> ค่าธรรมเนียม Bitget
                    </div>
                    <div className="text-base font-bold font-mono text-amber-400 mt-0.5">
                      -${selectedReport.total_fees} <span className="text-[10px] font-normal text-muted-foreground">USDT</span>
                    </div>
                    <div className="text-[9px] text-muted-foreground font-mono">Taker 0.1% ต่อรอบ</div>
                  </div>

                  {/* Net PnL */}
                  <div className="rounded-xl border bg-muted/20 p-2.5">
                    <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                      <TrendingUp className="h-3 w-3 text-primary" /> Net PnL สุทธิ
                    </div>
                    <div className={`text-base font-bold font-mono mt-0.5 ${
                      selectedReport.net_pnl >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {selectedReport.net_pnl >= 0 ? "+" : ""}${selectedReport.net_pnl}{" "}
                      <span className="text-[10px] font-normal text-muted-foreground">USDT</span>
                    </div>
                    <div className="text-[9px] text-muted-foreground font-mono">หักค่าฟี Bitget แล้ว</div>
                  </div>
                </div>

                {/* Article Header & Copy Button */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">ผู้เขียนวิเคราะห์:</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-primary/10 text-primary border border-primary/20">
                      🧠 {selectedReport.ai_provider}
                    </span>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="gap-1.5 text-xs h-7 px-2.5"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copied ? "คัดลอกแล้ว!" : "คัดลอกบทความ"}</span>
                  </Button>
                </div>

                {/* Formatted Article Content */}
                <div className="rounded-2xl border bg-card/60 p-4 sm:p-6 text-foreground text-xs sm:text-sm leading-relaxed space-y-3 prose prose-invert max-w-none">
                  {renderMarkdown(selectedReport.content || selectedReport.summary)}
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <Sparkles className="h-8 w-8 text-muted-foreground/50 mb-2 animate-bounce" />
                <p className="text-sm font-medium">เลือกรายงานจากแถบด้านซ้าย หรือกดสร้างรายงานใหม่</p>
                <p className="text-xs text-muted-foreground/80 mt-1">
                  ระบบจะรวบรวมประวัติการตัดสินใจของ JEV System One, คำนวณค่าธรรมเนียม และเขียนบทวิเคราะห์ให้ทันที
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-2.5 bg-muted/10 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 font-mono">
            ⚡ รอบคำนวณ: ทุก 15 นาที | Breakeven Guard: +0.35% (คุ้มค่าฟี Bitget)
          </span>
          <span className="hidden sm:inline">บันทึกอัตโนมัติลง Cloudflare D1</span>
        </div>
      </div>
    </div>
  )
}

// Lightweight Markdown Renderer with custom styled cards and callouts
function renderMarkdown(content: string) {
  if (!content) return null

  const lines = content.split("\n")
  const elements: React.ReactNode[] = []

  let inList = false
  let listItems: React.ReactNode[] = []

  const flushList = () => {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc pl-5 space-y-1 my-2 text-foreground/90">
          {listItems}
        </ul>
      )
      inList = false
      listItems = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Heading 1
    if (line.startsWith("# ")) {
      flushList()
      elements.push(
        <h1 key={i} className="text-lg sm:text-xl font-extrabold text-foreground tracking-tight border-b pb-2 pt-1 mt-2 text-primary">
          {line.replace("# ", "")}
        </h1>
      )
      continue
    }

    // Heading 2
    if (line.startsWith("## ")) {
      flushList()
      elements.push(
        <h2 key={i} className="text-base sm:text-lg font-bold text-foreground tracking-tight border-b pb-1.5 pt-3 text-cyan-400">
          {line.replace("## ", "")}
        </h2>
      )
      continue
    }

    // Heading 3
    if (line.startsWith("### ")) {
      flushList()
      elements.push(
        <h3 key={i} className="text-sm sm:text-base font-bold text-foreground pt-3 pb-1 text-emerald-400 flex items-center gap-1.5">
          {line.replace("### ", "")}
        </h3>
      )
      continue
    }

    // Unordered List item
    if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      inList = true
      const itemText = line.trim().replace(/^[-*]\s+/, "")
      listItems.push(
        <li key={i} className="leading-relaxed">
          {formatInline(itemText)}
        </li>
      )
      continue
    }

    // Empty line
    if (!line.trim()) {
      flushList()
      continue
    }

    // Regular paragraph
    flushList()
    elements.push(
      <p key={i} className="leading-relaxed text-foreground/90 my-1">
        {formatInline(line)}
      </p>
    )
  }

  flushList()
  return elements
}

// Inline formatting (bold, code, highlights)
function formatInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g)
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="px-1.5 py-0.5 rounded bg-muted/60 text-primary font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}
