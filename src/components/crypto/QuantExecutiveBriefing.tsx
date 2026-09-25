"use client"

import * as React from "react"
import { Bot, Target, ShieldCheck, Zap, Activity } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { QuantExecutiveState } from "@/services/quantEngine"
import type { BitgetConfig } from "@/services/bitgetSpot"

interface Props {
  state: QuantExecutiveState
  config: BitgetConfig
  onTriggerScan: () => void
  isScanning: boolean
}

export function QuantExecutiveBriefing({ state, config, onTriggerScan, isScanning }: Props) {
  const goalPercent = config.takeProfitPercent || 3.5
  const progressRatio = Math.min(100, Math.max(0, (state.currentRoundProgressPercent / goalPercent) * 100))

  return (
    <Card className="col-span-12 border-primary/20 bg-gradient-to-r from-card via-card to-primary/5">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-inner">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-bold tracking-tight">
                ศูนย์บัญชาการ Quant AI Commander
              </CardTitle>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                คนคุมคือ QUANT
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                config.isPaperTrading ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"
              }`}>
                {config.isPaperTrading ? "🛡️ PAPER SIMULATION" : "🔥 LIVE BITGET SPOT"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-emerald-500 animate-pulse" />
              <span>{state.statusMessage}</span>
            </p>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onTriggerScan}
          disabled={isScanning}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50"
        >
          <Zap className="h-3.5 w-3.5 fill-current" />
          <span>{isScanning ? "กำลังสแกนตลาด..." : "สั่ง Quant สแกนเดี๋ยวนี้"}</span>
        </button>
      </CardHeader>

      <CardContent className="grid gap-4 pt-2 md:grid-cols-12">
        {/* Goal Progress Metric */}
        <div className="md:col-span-4 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="flex items-center gap-1 font-medium text-muted-foreground">
              <Target className="h-3.5 w-3.5 text-primary" />
              เป้าหมายกำไรรอบนี้
            </span>
            <span className="font-bold text-emerald-500">
              +{state.currentRoundProgressPercent.toFixed(2)}% / +{goalPercent.toFixed(1)}%
            </span>
          </div>
          <Progress value={progressRatio} className="h-2" />
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
            <span>ความคืบหน้า {progressRatio.toFixed(0)}%</span>
            <span>เกณฑ์ขาย TP: ทุนเฉลี่ย +{goalPercent}%</span>
          </div>
        </div>

        {/* Portfolio Guardrails Metric */}
        <div className="md:col-span-4 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="flex items-center gap-1 font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              กรอบการเงิน (Guardrails)
            </span>
            <span className="font-bold text-foreground">
              ถือ {state.activeCoinsCount} / {config.maxCoins} เหรียญ
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
            <div className="rounded bg-background/60 p-1.5 border border-border/50">
              <div className="text-[10px] text-muted-foreground">เงินลงทุนในเหรียญ</div>
              <div className="font-bold font-mono text-primary">
                ${state.totalDeployedUsdt.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="rounded bg-background/60 p-1.5 border border-border/50">
              <div className="text-[10px] text-muted-foreground">เงินสดสำรอง USDT</div>
              <div className="font-bold font-mono text-emerald-500">
                ${state.cashReserveUsdt.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>

        {/* Latest Thought & Decision Log */}
        <div className="md:col-span-4 rounded-lg border bg-muted/20 p-3 flex flex-col justify-between">
          <div className="text-[11px] font-medium text-muted-foreground mb-1">
            บันทึกการตัดสินใจล่าสุดของ Quant
          </div>
          <div className="space-y-1 overflow-hidden">
            {state.recentLogs.slice(0, 2).map((log) => (
              <div key={log.id} className="flex items-center gap-1.5 text-[10px] leading-tight">
                <span className="font-mono text-muted-foreground">[{log.time}]</span>
                <span className="font-bold" style={{ color: log.color }}>
                  {log.action}
                </span>
                <span className="font-semibold text-foreground">{log.symbol}</span>
                <span className="truncate text-muted-foreground">{log.note}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
