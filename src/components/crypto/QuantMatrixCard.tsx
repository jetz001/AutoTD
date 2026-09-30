"use client"

import * as React from "react"
import {
  TrendingUp,
  Activity,
  Layers,
  ChevronDown,
  ChevronUp,
  Zap,
  CheckCircle2,
  Clock,
  BarChart3,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Filter
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export interface ScreenerItem {
  symbol: string;
  baseCoin: string;
  price: number;
  change24h: number;
  vol: number;
  totalScore: number;
  grade: "A+" | "A" | "B" | "C";
  bestTf: "5m" | "15m" | "1h";
  primaryIndicator: string;
  isSupertrendBullish: boolean;
  timeframes?: {
    "5m"?: any;
    "15m"?: any;
    "1h"?: any;
  };
  updatedAt?: number;
}

interface Props {
  screenerMatrix: ScreenerItem[];
  onSelectCoin?: (symbol: string) => void;
}

export function QuantMatrixCard({ screenerMatrix = [], onSelectCoin }: Props) {
  const [expandedSymbol, setExpandedSymbol] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [gradeFilter, setGradeFilter] = React.useState<"ALL" | "A+" | "A" | "B">("ALL");

  const filteredItems = React.useMemo(() => {
    return (screenerMatrix || [])
      .filter((item) => {
        const matchesSearch =
          !searchQuery ||
          item.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.baseCoin.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesGrade =
          gradeFilter === "ALL" || item.grade === gradeFilter;
        return matchesSearch && matchesGrade;
      })
      .sort((a, b) => b.totalScore - a.totalScore);
  }, [screenerMatrix, searchQuery, gradeFilter]);

  const triggerLabelMap: Record<string, string> = {
    BOLL_RSI_DIP: "ช้อนแนวรับ Bollinger + RSI Dip",
    SUPERTREND_STOCH_CROSS: "SuperTrend Bull + StochRSI ตัดขึ้น",
    RSI_OVERSOLD: "RSI ขายมากเกินไป (Oversold Bounce)",
    MFI_ACCUMULATION: "MFI เม็ดเงินไหลเข้าสะสม",
    TREND_ALIGNMENT: "EMA Ribbon เรียงตัวขาขึ้นสมบูรณ์",
    BOLLINGER_LOWER_BOUNCE: "ชนกรอบล่าง Bollinger Bands เด้งกลับ",
    NEUTRAL: "เฝ้าระวังรอจังหวะ"
  };

  return (
    <Card className="col-span-12 overflow-hidden border-border/60 shadow-sm bg-card/60 backdrop-blur-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/40">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 shadow-inner">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2">
              <span>ตารางวิเคราะห์ตัวชี้วัดหลายกรอบเวลา (Multi-Timeframe Quant Matrix)</span>
              <Badge variant="outline" className="text-[10px] py-0 px-2 font-mono bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                Top 20 เหรียญ
              </Badge>
            </CardTitle>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
              คำนวณ SuperTrend, RSI, Bollinger Bands, MACD, StochRSI, และ Choppiness Index (5m, 15m, 1h)
            </p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex items-center gap-2">
          <div className="relative w-36 sm:w-44">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="ค้นหาเหรียญ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-2.5 text-xs bg-muted/20"
            />
          </div>
          <div className="flex rounded-lg border p-0.5 bg-muted/20 text-xs">
            {(["ALL", "A+", "A", "B"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGradeFilter(g)}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${
                  gradeFilter === g
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {g === "ALL" ? "ทั้งหมด" : `เกรด ${g}`}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {filteredItems.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-center p-4 text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-xs font-semibold">กำลังเชื่อมต่อและประมวลผลตัวชี้วัด 20 เหรียญจากคลาวด์...</p>
            <p className="text-[11px] mt-0.5">ระบบจะอัปเดตตารางตัวเลขทุกรอบ 5 นาทีอัตโนมัติ 24 ชม.</p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[700px] border-collapse text-left text-xs">
              <thead className="bg-muted/40 border-b text-muted-foreground text-[11px]">
                <tr>
                  <th className="py-2.5 pl-4 pr-2 font-medium">เหรียญ / คู่เทรด</th>
                  <th className="py-2.5 px-2 font-medium">ราคาตลาด</th>
                  <th className="py-2.5 px-2 font-medium">24h Change</th>
                  <th className="py-2.5 px-2 font-medium">คะแนน Confluence</th>
                  <th className="py-2.5 px-2 font-medium">SuperTrend</th>
                  <th className="py-2.5 px-2 font-medium">สัญญาณเด่น (Dominant Trigger)</th>
                  <th className="py-2.5 pr-4 pl-2 font-medium text-right">เจาะลึก 3 Timeframe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredItems.map((item) => {
                  const isExpanded = expandedSymbol === item.symbol;
                  const isPos = item.change24h >= 0;
                  const scoreColor =
                    item.totalScore >= 80
                      ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/30"
                      : item.totalScore >= 70
                      ? "text-cyan-400 bg-cyan-500/15 border-cyan-500/30"
                      : item.totalScore >= 55
                      ? "text-blue-400 bg-blue-500/15 border-blue-500/30"
                      : "text-zinc-400 bg-zinc-500/15 border-zinc-500/30";

                  return (
                    <React.Fragment key={item.symbol}>
                      <tr
                        onClick={() => {
                          setExpandedSymbol(isExpanded ? null : item.symbol);
                          if (onSelectCoin) onSelectCoin(item.symbol);
                        }}
                        className={`hover:bg-muted/30 transition-colors cursor-pointer ${
                          isExpanded ? "bg-muted/20" : ""
                        }`}
                      >
                        <td className="py-2.5 pl-4 pr-2 font-bold font-mono text-foreground flex items-center gap-2">
                          <span>{item.symbol}</span>
                          <span className="text-[10px] text-muted-foreground font-normal">
                            ({item.baseCoin})
                          </span>
                        </td>
                        <td className="py-2.5 px-2 font-mono font-semibold">
                          ${item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </td>
                        <td className="py-2.5 px-2 font-mono font-medium">
                          <span className={`inline-flex items-center gap-0.5 ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
                            {isPos ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {isPos ? "+" : ""}{item.change24h.toFixed(2)}%
                          </span>
                        </td>
                        <td className="py-2.5 px-2">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border ${scoreColor}`}>
                            <span>{item.totalScore}/100</span>
                            <span className="text-[10px] opacity-80 font-normal">({item.grade})</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.isSupertrendBullish
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-rose-500/15 text-rose-400"
                            }`}
                          >
                            <TrendingUp className="h-3 w-3" />
                            {item.isSupertrendBullish ? "ขาขึ้น (BULL)" : "ขาลง (BEAR)"}
                          </span>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="flex flex-col">
                            <span className="text-[11px] font-semibold text-foreground flex items-center gap-1">
                              <Zap className="h-3 w-3 text-amber-400" />
                              {triggerLabelMap[item.primaryIndicator] || item.primaryIndicator}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              กรอบเวลาหลัก: {item.bestTf}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 pl-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 rounded-full hover:bg-muted"
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </td>
                      </tr>

                      {/* Expandable Indicator Deep-Dive Row */}
                      {isExpanded && item.timeframes && (
                        <tr className="bg-muted/15 border-b">
                          <td colSpan={7} className="p-3 pl-6 pr-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              {(["5m", "15m", "1h"] as const).map((tf) => {
                                const tfData = item.timeframes?.[tf];
                                if (!tfData) return null;
                                return (
                                  <div
                                    key={tf}
                                    className="rounded-xl border border-border/60 bg-card/80 p-3 space-y-2 shadow-xs"
                                  >
                                    <div className="flex items-center justify-between border-b pb-1.5 border-border/40">
                                      <span className="font-bold text-xs flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5 text-cyan-400" />
                                        กรอบเวลา {tf}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className={`text-[10px] py-0 px-1.5 font-bold ${
                                          tfData.score >= 75
                                            ? "text-emerald-400 border-emerald-500/30"
                                            : "text-zinc-400 border-zinc-500/30"
                                        }`}
                                      >
                                        คะแนน {tfData.score}/100
                                      </Badge>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                                      <div className="bg-muted/30 p-1.5 rounded">
                                        <div className="text-muted-foreground text-[10px]">RSI (14)</div>
                                        <div className={`font-bold ${tfData.rsiVal <= 35 ? "text-emerald-400" : tfData.rsiVal >= 70 ? "text-rose-400" : "text-foreground"}`}>
                                          {tfData.rsiVal} {tfData.rsiVal <= 35 ? "(Dip)" : tfData.rsiVal >= 70 ? "(Overbought)" : ""}
                                        </div>
                                      </div>

                                      <div className="bg-muted/30 p-1.5 rounded">
                                        <div className="text-muted-foreground text-[10px]">Bollinger %B</div>
                                        <div className={`font-bold ${tfData.bollPctB <= 30 ? "text-emerald-400" : "text-foreground"}`}>
                                          {tfData.bollPctB}%
                                        </div>
                                      </div>

                                      <div className="bg-muted/30 p-1.5 rounded">
                                        <div className="text-muted-foreground text-[10px]">Stoch RSI (%K)</div>
                                        <div className="font-bold text-foreground">
                                          {tfData.stochK}
                                        </div>
                                      </div>

                                      <div className="bg-muted/30 p-1.5 rounded">
                                        <div className="text-muted-foreground text-[10px]">Choppiness Index</div>
                                        <div className={`font-bold ${tfData.chopIndex > 61.8 ? "text-amber-400" : "text-cyan-400"}`}>
                                          {tfData.chopIndex} {tfData.chopIndex > 61.8 ? "(Sideway)" : "(Trending)"}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="text-[10px] text-muted-foreground flex items-center justify-between pt-1">
                                      <span>SuperTrend: <strong className={tfData.supertrendDir === 1 ? "text-emerald-400" : "text-rose-400"}>{tfData.supertrendDir === 1 ? "Bullish" : "Bearish"}</strong></span>
                                      {tfData.atrVal > 0 && <span>ATR: ${tfData.atrVal.toFixed(4)}</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
