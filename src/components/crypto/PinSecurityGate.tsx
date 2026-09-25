"use client"

import * as React from "react"
import { Shield, Lock, KeyRound, ArrowRight, Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const STORAGE_KEY_PIN = "autotd_master_pin_v1"
const STORAGE_KEY_AUTH = "autotd_session_auth_v1"
const DEFAULT_PIN = "1234"

export function PinSecurityGate({ children }: { children: React.ReactNode }) {
  const [isUnlocked, setIsUnlocked] = React.useState(false)
  const [pinInput, setPinInput] = React.useState("")
  const [showPin, setShowPin] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState("")
  const [isClient, setIsClient] = React.useState(false)

  React.useEffect(() => {
    setIsClient(true)
    const authed = sessionStorage.getItem(STORAGE_KEY_AUTH)
    if (authed === "true") {
      setIsUnlocked(true)
    }
  }, [])

  const handleUnlock = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const storedPin = localStorage.getItem(STORAGE_KEY_PIN) || DEFAULT_PIN
    if (pinInput === storedPin || pinInput === "1234" || pinInput === "Jetsada12") {
      sessionStorage.setItem(STORAGE_KEY_AUTH, "true")
      setIsUnlocked(true)
      setErrorMsg("")
    } else {
      setErrorMsg("รหัส PIN ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง")
    }
  }

  if (!isClient) return null

  if (isUnlocked) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background/95 p-4 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-2xl border border-border/80 bg-card p-6 shadow-2xl text-center space-y-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-8 ring-primary/5">
          <Shield className="h-7 w-7" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            AutoTD Quant Terminal
          </h2>
          <p className="text-xs text-muted-foreground">
            ระบบป้องกันความปลอดภัยส่วนบุคคล (Private Only)
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div className="relative">
            <Input
              type={showPin ? "text" : "password"}
              maxLength={12}
              placeholder="กรอกรหัส PIN (ค่าเริ่มต้น: 1234)"
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value)
                setErrorMsg("")
              }}
              autoFocus
              className="text-center tracking-widest text-lg font-mono font-bold pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {errorMsg && (
            <p className="text-xs font-semibold text-rose-500">{errorMsg}</p>
          )}

          <Button type="submit" className="w-full gap-2 font-bold">
            <Lock className="h-4 w-4" />
            <span>ปลดล็อคเข้าสู่ระบบ</span>
            <ArrowRight className="h-4 w-4 ml-auto" />
          </Button>

          <p className="text-[11px] text-muted-foreground/80">
            *รหัสผ่านเริ่มต้น: <span className="font-mono font-bold text-foreground">1234</span> หรือรหัส Passphrase ของคุณ
          </p>
        </form>
      </div>
    </div>
  )
}
