"use client"

import * as React from "react"
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
} from "lightweight-charts"
import type { IChartApi, ISeriesApi } from "lightweight-charts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { fetchBitgetSpotCandles, type SpotHolding } from "@/services/bitgetSpot"

interface Props {
  symbol: string
  currentPrice: number
  holding?: SpotHolding
}

const TIMEFRAMES = [
  { label: "1m", bitget: "1min", tv: "1" },
  { label: "5m", bitget: "5min", tv: "5" },
  { label: "15m", bitget: "15min", tv: "15" },
  { label: "1H", bitget: "1h", tv: "60" },
  { label: "4H", bitget: "4h", tv: "240" },
  { label: "1D", bitget: "1day", tv: "D" },
]

export function RealTradingChart({ symbol, currentPrice, holding }: Props) {
  const cleanSymbol = symbol.replace("/", "").toUpperCase()
  const [activeTfIdx, setActiveTfIdx] = React.useState(2) // 15m default
  const [viewMode, setViewMode] = React.useState<"canvas" | "tradingview">("canvas")
  const [loading, setLoading] = React.useState(false)

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const chartRef = React.useRef<IChartApi | null>(null)
  const candleSeriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null)
  const volumeSeriesRef = React.useRef<ISeriesApi<"Histogram"> | null>(null)

  const selectedTf = TIMEFRAMES[activeTfIdx]

  // Fetch Bitget Spot Candles
  const loadCandles = React.useCallback(async () => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return
    try {
      const candles = await fetchBitgetSpotCandles(cleanSymbol, selectedTf.bitget, 120)
      if (candles.length === 0) return

      candleSeriesRef.current.setData(
        candles.map((c) => ({
          time: c.time as any,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      )

      volumeSeriesRef.current.setData(
        candles.map((c) => ({
          time: c.time as any,
          value: c.volume,
          color: c.close >= c.open ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)",
        }))
      )
    } catch (e) {
      console.warn("Candle fetch error:", e)
    }
  }, [cleanSymbol, selectedTf])

  // Initialize Chart
  React.useEffect(() => {
    if (viewMode !== "canvas" || !containerRef.current) return

    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const container = containerRef.current
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#090d16" },
        textColor: "#64748b",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(30, 45, 74, 0.35)" },
        horzLines: { color: "rgba(30, 45, 74, 0.35)" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: {
        borderColor: "#1e2d4a",
        scaleMargins: { top: 0.1, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "#1e2d4a",
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
      priceFormat: {
        type: "price",
        precision: cleanSymbol.includes("DOGE") || cleanSymbol.includes("XRP") ? 4 : 2,
        minMove: cleanSymbol.includes("DOGE") || cleanSymbol.includes("XRP") ? 0.0001 : 0.01,
      },
    })

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    })

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries

    const handleResize = () => {
      if (chart && container) {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight })
      }
    }
    window.addEventListener("resize", handleResize)

    setLoading(true)
    loadCandles().finally(() => {
      setLoading(false)
      chart.timeScale().fitContent()
    })

    return () => {
      window.removeEventListener("resize", handleResize)
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
    }
  }, [viewMode, cleanSymbol, selectedTf.bitget, loadCandles])

  // Periodic candle update
  React.useEffect(() => {
    if (viewMode !== "canvas") return
    const interval = setInterval(loadCandles, 5000)
    return () => clearInterval(interval)
  }, [loadCandles, viewMode])

  // Price line refs to avoid duplicating lines on every re-render
  const priceLinesRef = React.useRef<any[]>([])

  // Draw Price Lines: Avg Cost (Blue), Take Profit (Green), Cut Loss (Red)
  React.useEffect(() => {
    if (!candleSeriesRef.current || viewMode !== "canvas") return

    // Clean up previous price lines
    priceLinesRef.current.forEach((pl) => {
      try {
        candleSeriesRef.current?.removePriceLine(pl)
      } catch {}
    })
    priceLinesRef.current = []

    if (!holding) return

    try {
      // 1. Avg Cost Line (Blue dashed)
      const avgLine = candleSeriesRef.current.createPriceLine({
        price: holding.avgCostPrice,
        color: "#38bdf8",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `ต้นทุนเฉลี่ย: $${holding.avgCostPrice}`,
      })
      if (avgLine) priceLinesRef.current.push(avgLine)

      // 2. Take Profit Line (Green dotted)
      if (holding.takeProfitPrice) {
        const tpLine = candleSeriesRef.current.createPriceLine({
          price: holding.takeProfitPrice,
          color: "#10b981",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `เป้าขาย TP: $${holding.takeProfitPrice}`,
        })
        if (tpLine) priceLinesRef.current.push(tpLine)
      }

      // 3. Cut Loss Line (Red dotted)
      if (holding.cutLossPrice) {
        const slLine = candleSeriesRef.current.createPriceLine({
          price: holding.cutLossPrice,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `จุดคัท SL: $${holding.cutLossPrice}`,
        })
        if (slLine) priceLinesRef.current.push(slLine)
      }
    } catch (e) {
      console.warn("Price lines error:", e)
    }

    return () => {
      priceLinesRef.current.forEach((pl) => {
        try {
          candleSeriesRef.current?.removePriceLine(pl)
        } catch {}
      })
      priceLinesRef.current = []
    }
  }, [holding?.avgCostPrice, holding?.takeProfitPrice, holding?.cutLossPrice, viewMode])

  return (
    <Card className="col-span-12 flex flex-col h-[460px]">
      {/* Header & Controls */}
      <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <span>📈 Bitget Spot Candlesticks: {cleanSymbol}</span>
            <span className="font-mono text-sm font-semibold text-emerald-500">
              ${currentPrice ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "---"}
            </span>
          </CardTitle>

          {holding && (
            <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[11px] font-mono font-bold text-sky-400">
              ต้นทุนเฉลี่ย: ${holding.avgCostPrice} [{holding.tranchesCount}/4 ไม้]
            </span>
          )}
        </div>

        {/* Right Tools */}
        <div className="flex items-center gap-2">
          {/* Timeframes */}
          {viewMode === "canvas" && (
            <div className="flex gap-1 rounded-md bg-muted p-1">
              {TIMEFRAMES.map((tf, i) => (
                <button
                  key={tf.label}
                  onClick={() => setActiveTfIdx(i)}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${
                    activeTfIdx === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex gap-1 rounded-md bg-muted p-1">
            <button
              onClick={() => setViewMode("canvas")}
              className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${
                viewMode === "canvas" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              ⚡ Bitget Canvas (AI เส้นคัท/TP)
            </button>
            <button
              onClick={() => setViewMode("tradingview")}
              className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${
                viewMode === "tradingview" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              📊 TradingView Pro
            </button>
          </div>
        </div>
      </CardHeader>

      {/* Chart Canvas Area */}
      <CardContent className="flex-1 p-0 relative">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 text-xs font-semibold text-primary">
            กำลังโหลดแท่งเทียน Bitget Spot...
          </div>
        )}

        {viewMode === "canvas" ? (
          <div ref={containerRef} className="w-full h-full" />
        ) : (
          <iframe
            key={`${cleanSymbol}-${selectedTf.tv}`}
            title="TradingView Real Chart"
            src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=BITGET%3A${cleanSymbol}&interval=${selectedTf.tv}&theme=dark&style=1&locale=th_TH&toolbar_bg=%23090d16&enable_publishing=false&hide_side_toolbar=false&allow_symbol_change=false&save_image=false`}
            className="w-full h-full border-none"
          />
        )}
      </CardContent>
    </Card>
  )
}
