"use client"

import * as React from "react"
import { Shield, Key, Lock, CheckCircle2, Sliders, X, Eye, EyeOff, AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { BitgetConfig } from "@/services/bitgetSpot"
import { loadBitgetConfig, saveBitgetConfig, EDGE_BOT_URL } from "@/services/bitgetSpot"

interface Props {
  isOpen: boolean
  onClose: () => void
  onSave: (cfg: BitgetConfig) => void
}

export function BitgetSettingsModal({ isOpen, onClose, onSave }: Props) {
  const [cfg, setCfg] = React.useState<BitgetConfig>(loadBitgetConfig)
  const [savedSuccess, setSavedSuccess] = React.useState(false)
  const [showSecret, setShowSecret] = React.useState(false)
  const [isTesting, setIsTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)

  React.useEffect(() => {
    if (isOpen) {
      setCfg(loadBitgetConfig())
      setSavedSuccess(false)
      setTestResult(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const headers: Record<string, string> = {}
      if (cfg.apiKey) headers["x-bitget-key"] = cfg.apiKey
      if (cfg.secretKey) headers["x-bitget-secret"] = cfg.secretKey
      if (cfg.passphrase) headers["x-bitget-passphrase"] = cfg.passphrase

      const res = await fetch("/api/bitget?action=check", { headers })
      const json = await res.json()
      if (res.ok && json.code === "00000") {
        setTestResult({
          success: true,
          message: "✓ เชื่อมต่อสำเร็จ! สิทธิ์ API Key ใช้งานได้ปกติ (Bitget Spot)",
        })
      } else {
        setTestResult({
          success: false,
          message: `เชื่อมต่อไม่สำเร็จ: ${json.msg || "กรุณาตรวจสอบ API Key / Secret / Passphrase"}`,
        })
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: `ข้อผิดพลาดการเชื่อมต่อ: ${e.message}`,
      })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSave = () => {
    saveBitgetConfig(cfg)
    onSave(cfg)
    setSavedSuccess(true)
    setTimeout(() => {
      setSavedSuccess(false)
      onClose()
    }, 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl text-card-foreground max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">ตั้งค่า Bitget Spot & Quant AI</h2>
              <p className="text-xs text-muted-foreground">
                สลับโหมดเทรดจริง / Paper Trading และใส่ API Key
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4 space-y-4 text-xs">
          {/* Paper vs Live Toggle */}
          <div className="rounded-lg border p-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">โหมดการเทรด (Trading Mode)</div>
                <div className="text-muted-foreground text-[11px]">
                  {cfg.isPaperTrading
                    ? "🛡️ Paper Trading (จำลองเทรดด้วยราคาตลาดสด ไม่เสียเงินจริง)"
                    : "🔥 Real Live Trading (ยิงคำสั่งจริงเข้ากระดาน Bitget Spot)"}
                </div>
              </div>
              <Button
                variant={cfg.isPaperTrading ? "outline" : "destructive"}
                size="sm"
                onClick={() => setCfg({ ...cfg, isPaperTrading: !cfg.isPaperTrading })}
                className="font-bold"
              >
                {cfg.isPaperTrading ? "🛡️ สลับเป็น LIVE" : "🔥 สลับเป็น PAPER"}
              </Button>
            </div>
          </div>

          {/* Bitget API Credentials */}
          <div className="rounded-lg border border-primary/20 bg-muted/10 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span>Bitget V2 API Credentials</span>
              </div>
              <span className="text-[10px] text-muted-foreground">เฉพาะสิทธิ์ Read + Spot Trade</span>
            </div>

            <div className="space-y-2">
              <div>
                <label className="text-[11px] text-muted-foreground">API Key</label>
                <Input
                  type="text"
                  placeholder="bg_..."
                  value={cfg.apiKey}
                  onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value.trim() })}
                  className="mt-1 h-8 text-xs font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-muted-foreground">Secret Key</label>
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="text-[10px] text-primary flex items-center gap-1 hover:underline"
                  >
                    {showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showSecret ? "ซ่อน" : "แสดง"}
                  </button>
                </div>
                <Input
                  type={showSecret ? "text" : "password"}
                  placeholder="Secret Key"
                  value={cfg.secretKey}
                  onChange={(e) => setCfg({ ...cfg, secretKey: e.target.value.trim() })}
                  className="mt-1 h-8 text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground">Passphrase</label>
                <Input
                  type={showSecret ? "text" : "password"}
                  placeholder="Passphrase"
                  value={cfg.passphrase}
                  onChange={(e) => setCfg({ ...cfg, passphrase: e.target.value.trim() })}
                  className="mt-1 h-8 text-xs font-mono"
                />
              </div>

              <div className="pt-1 flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={isTesting || (!cfg.apiKey && !process.env.NEXT_PUBLIC_BITGET_API_KEY)}
                  className="h-7 text-[11px] gap-1"
                >
                  {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Key className="h-3 w-3" />}
                  <span>ทดสอบเชื่อมต่อ API</span>
                </Button>
                {testResult && (
                  <span
                    className={`text-[11px] font-medium ${
                      testResult.success ? "text-emerald-500" : "text-rose-500"
                    }`}
                  >
                    {testResult.message}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* OpenRouter AI Agent Credentials */}
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                <Sliders className="h-3.5 w-3.5 text-purple-400" />
                <span>OpenRouter AI Agent (วิเคราะห์ตัดสินใจ)</span>
              </div>
              <span className="text-[10px] text-muted-foreground">ระบบ 6 โมเดลฟรี Auto-Fallback</span>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">
                OpenRouter API Key (เว้นว่างไว้เพื่อใช้คีย์จาก Cloudflare Secrets)
              </label>
              <Input
                type="password"
                placeholder="sk-or-v1-... (หรือดึงจาก Pages Secret อัตโนมัติ)"
                value={cfg.openrouterApiKey || ""}
                onChange={(e) => setCfg({ ...cfg, openrouterApiKey: e.target.value.trim() })}
                className="mt-1 h-8 text-xs font-mono"
              />
            </div>
          </div>

          {/* Cloudflare Pages Deployment Info */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-400" />
                <span className="font-semibold text-xs text-foreground">
                  Cloudflare Pages Edge Network
                </span>
              </div>
              <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                autotd.pages.dev
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              ✓ ข้อมูล API Key จะถูกจัดเก็บอย่างปลอดภัยในเบราว์เซอร์ของคุณ และเชื่อมต่อไปยัง Bitget API ด้วยการเข้ารหัส HMAC-SHA256
            </p>
          </div>

          {/* Quant Rules & Guardrails */}
          <div className="rounded-lg border p-3 bg-muted/20 space-y-3">
            <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
              <Sliders className="h-3.5 w-3.5 text-primary" />
              <span>กติกา Quant: เป้าหมาย & กรอบความเสี่ยง</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground">
                  เป้าหมายทำกำไรต่อรอบ (TP %)
                </label>
                <div className="mt-1 flex items-center gap-1">
                  <Input
                    type="number"
                    step="0.5"
                    value={cfg.takeProfitPercent}
                    onChange={(e) =>
                      setCfg({ ...cfg, takeProfitPercent: parseFloat(e.target.value) || 3.5 })
                    }
                    className="h-8 text-xs font-semibold text-emerald-500"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground">
                  จุดตัดขาดทุน Hard Stop (SL %)
                </label>
                <div className="mt-1 flex items-center gap-1">
                  <Input
                    type="number"
                    step="0.5"
                    value={cfg.cutLossPercent}
                    onChange={(e) =>
                      setCfg({ ...cfg, cutLossPercent: parseFloat(e.target.value) || 5.0 })
                    }
                    className="h-8 text-xs font-semibold text-rose-500"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground">
                  จำนวนไม้สูงสุดต่อเหรียญ (Max Tranches)
                </label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={cfg.maxTranches}
                  onChange={(e) =>
                    setCfg({ ...cfg, maxTranches: parseInt(e.target.value) || 4 })
                  }
                  className="mt-1 h-8 text-xs"
                />
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground">
                  เงินสดสำรอง USDT ขั้นต่ำ (%)
                </label>
                <div className="mt-1 flex items-center gap-1">
                  <Input
                    type="number"
                    value={cfg.cashReservePercent}
                    onChange={(e) =>
                      setCfg({ ...cfg, cashReservePercent: parseInt(e.target.value) || 30 })
                    }
                    className="h-8 text-xs"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground">
                  ขนาดเงินต่อไม้ (% ของเงินสด)
                </label>
                <div className="mt-1 flex items-center gap-1">
                  <Input
                    type="number"
                    min="5"
                    max="50"
                    value={cfg.tranchePercent || 20}
                    onChange={(e) =>
                      setCfg({ ...cfg, tranchePercent: parseInt(e.target.value) || 20 })
                    }
                    className="h-8 text-xs font-semibold text-cyan-400"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            {/* Auto-Pilot Full Bot Switch */}
            <div className="flex items-center justify-between rounded border border-cyan-500/30 p-2.5 bg-cyan-500/10 mt-2">
              <div>
                <div className="font-semibold text-xs text-cyan-400">
                  ⚡ FULL BOT AUTO-PILOT (เข้าซื้อ & ขายอัตโนมัติเต็มระบบ)
                </div>
                <div className="text-[10px] text-muted-foreground">
                  เมื่อเปิด: บอทจะคัดเหรียญ ส่ง AI คอนเฟิร์ม ซื้อไม้ 1, ซื้อ DCA, ขายทำกำไร, และคัทลอสโดยไม่ต้องกดเอง
                </div>
              </div>
              <Button
                variant={cfg.autoPilotEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => setCfg({ ...cfg, autoPilotEnabled: !cfg.autoPilotEnabled })}
                className={`font-bold h-7 text-xs ${cfg.autoPilotEnabled ? "bg-cyan-500 hover:bg-cyan-600 text-black" : ""}`}
              >
                {cfg.autoPilotEnabled ? "เปิดใช้งาน" : "ปิด"}
              </Button>
            </div>

            {/* Auto Rebalance Toggle */}
            <div className="flex items-center justify-between rounded border p-2 bg-background/50 mt-2">
              <div>
                <div className="font-semibold text-[11px] text-foreground">
                  🔄 หมุนเงินสลับตัวอัตโนมัติ (Auto Rebalance on Grade A+)
                </div>
                <div className="text-[10px] text-muted-foreground">
                  เมื่อไม้เต็มมือแล้วเจอเหรียญคะแนน ≥ 85 ให้ขายตัวนิ่งเสมอตัวเพื่อสลับเข้าตัวใหม่
                </div>
              </div>
              <Button
                variant={cfg.autoRebalanceEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => setCfg({ ...cfg, autoRebalanceEnabled: !cfg.autoRebalanceEnabled })}
                className="h-6 px-2 text-[10px] font-bold"
              >
                {cfg.autoRebalanceEnabled ? "เปิดใช้งาน (ON)" : "ปิด (OFF)"}
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between border-t pt-3">
          <div className="text-[11px] text-muted-foreground">
            {savedSuccess ? (
              <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" /> บันทึกการตั้งค่าเรียบร้อยแล้ว
              </span>
            ) : (
              <span>ข้อมูลจะถูกบันทึกอย่างปลอดภัยในเบราว์เซอร์นี้</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={handleSave} className="font-semibold">
              บันทึกการตั้งค่า
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
