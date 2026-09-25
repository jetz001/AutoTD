"use client"

import * as React from "react"
import { Bot, Target, ShieldCheck, Activity } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { QuantExecutiveState } from "@/services/quantEngine"
import type { BitgetConfig } from "@/services/bitgetSpot"

interface Props {
  state: QuantExecutiveState
  config: BitgetConfig
  onTriggerScan?: () => void
  isScanning?: boolean
}

export function QuantExecutiveBriefing({ state, config }: Props) {
  const goalPercent = config.takeProfitPercent || 3.5
  const progressRatio = Math.min(100, Math.max(0, (state.currentRoundProgressPercent / goalPercent) * 100))

  return (
    <Card className="col-span-12 border-primary/20 bg-gradient-to-r from-card via-card to-primary/5 overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-inner mt-0.5 sm:mt-0">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <CardTitle className="text-sm sm:text-base font-bold tracking-tight text-foreground truncate">
                ศูนย์บัญชาการ Quant AI
              </CardTitle>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-primary shrink-0">
                QUANT AUTONOMOUS
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] sm:text-[10px] font-bold shrink-0 ${
                config.isPaperTrading ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"
              }`}>
                {config.isPaperTrading ? "🛡️ PAPER" : "🔥 LIVE BITGET"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] sm:text-[10px] font-bold shrink-0 ${
                config.autoPilotEnabled ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30" : "bg-zinc-500/15 text-zinc-400"
              }`}>
                {config.autoPilotEnabled ? "⚡ FULL BOT ON" : "⏸️ BOT PAUSED"}
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate">
              <Activity className="h-3 w-3 text-emerald-500 animate-pulse shrink-0" />
              <span className="truncate">{state.statusMessage}</span>
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3 pt-2 grid-cols-1 md:grid-cols-12">
        {/* Goal Progress Metric */}
        <div className="md:col-span-4 rounded-lg border bg-muted/20 p-2.5 sm:p-3 min-w-0">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="flex items-center gap-1 font-medium text-muted-foreground text-[11px] sm:text-xs">
              <Target className="h-3.5 w-3.5 text-primary shrink-0" />
              เป้าหมายกำไรรอบนี้
            </span>
            <span className="font-bold text-emerald-500 font-mono text-xs">
              +{state.currentRoundProgressPercent.toFixed(2)}% / +{goalPercent.toFixed(1)}%
            </span>
          </div>
          <Progress value={progressRatio} className="h-2" />
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
            <span>ความคืบหน้า {progressRatio.toFixed(0)}%</span>
            <span>เกณฑ์ TP: ทุน +{goalPercent}%</span>
          </div>
        </div>

        {/* Portfolio Guardrails Metric */}
        <div className="md:col-span-4 rounded-lg border bg-muted/20 p-2.5 sm:p-3 min-w-0">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="flex items-center gap-1 font-medium text-muted-foreground text-[11px] sm:text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              กรอบการเงิน (Guardrails)
            </span>
            <span className="font-bold text-foreground font-mono text-xs">
              ถือ {state.activeCoinsCount} / {config.maxCoins} เหรียญ
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
            <div className="rounded bg-background/60 p-1.5 border border-border/50 min-w-0">
              <div className="text-[10px] text-muted-foreground truncate">เงินในเหรียญ</div>
              <div className="font-bold font-mono text-primary truncate text-xs">
                ${state.totalDeployedUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="rounded bg-background/60 p-1.5 border border-border/50 min-w-0">
              <div className="text-[10px] text-muted-foreground truncate">เงินสด USDT</div>
              <div className="font-bold font-mono text-emerald-500 truncate text-xs">
                ${state.cashReserveUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>

        {/* Latest Thought & Decision Log */}
        <div className="md:col-span-4 rounded-lg border bg-muted/20 p-2.5 sm:p-3 flex flex-col justify-between min-w-0">
          <div className="text-[11px] font-medium text-muted-foreground mb-1 flex items-center justify-between">
            <span>บันทึกการตัดสินใจล่าสุด</span>
            <span className="text-[9px] text-muted-foreground/80 font-mono">Live</span>
          </div>
          <div className="space-y-1 overflow-hidden">
            {state.recentLogs.slice(0, 2).map((log) => (
              <div key={log.id} className="flex items-center gap-1 text-[10px] leading-tight min-w-0">
                <span className="font-mono text-muted-foreground shrink-0 text-[9px]">[{log.time}]</span>
                <span className="font-bold shrink-0 text-[10px]" style={{ color: log.color }}>
                  {log.action}
                </span>
                <span className="font-semibold text-foreground shrink-0 text-[10px]">{log.symbol}</span>
                <span className="truncate text-muted-foreground text-[10px]">{log.note}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
