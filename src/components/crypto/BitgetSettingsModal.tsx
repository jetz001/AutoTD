"use client"

import * as React from "react"
import { Shield, Key, Lock, CheckCircle2, Sliders, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { BitgetConfig } from "@/services/bitgetSpot"
import { loadBitgetConfig, saveBitgetConfig } from "@/services/bitgetSpot"

interface Props {
  isOpen: boolean
  onClose: () => void
  onSave: (cfg: BitgetConfig) => void
}

export function BitgetSettingsModal({ isOpen, onClose, onSave }: Props) {
  const [cfg, setCfg] = React.useState<BitgetConfig>(loadBitgetConfig)
  const [savedSuccess, setSavedSuccess] = React.useState(false)

  React.useEffect(() => {
    if (isOpen) {
      setCfg(loadBitgetConfig())
      setSavedSuccess(false)
    }
  }, [isOpen])

  if (!isOpen) return null

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
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl text-card-foreground">
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

          {/* API Key Vault */}
          <div className="space-y-3">
            <div>
              <label className="mb-1 block font-medium text-muted-foreground">
                Bitget API Key
              </label>
              <Input
                type="password"
                placeholder="bg_xxxxxxxxxxxxxxxx"
                value={cfg.apiKey}
                onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-muted-foreground">
                Bitget Secret Key
              </label>
              <Input
                type="password"
                placeholder="ป้อน Secret Key..."
                value={cfg.secretKey}
                onChange={(e) => setCfg({ ...cfg, secretKey: e.target.value })}
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-muted-foreground">
                Bitget Passphrase
              </label>
              <Input
                type="password"
                placeholder="รหัสผ่าน API Passphrase..."
                value={cfg.passphrase}
                onChange={(e) => setCfg({ ...cfg, passphrase: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
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
