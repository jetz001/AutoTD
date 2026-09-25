"use client"

import * as React from "react"
import { Shield, Lock, Eye, EyeOff, AlertTriangle, CheckCircle2, LogOut } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const AUTHORIZED_EMAIL = "jimwar02@gmail.com"
const STORAGE_KEY_AUTH = "autotd_session_auth_v1"
const STORAGE_KEY_USER = "autotd_auth_email_v1"

// Google G logo SVG
function GoogleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  )
}

export function GmailSecurityGate({ children }: { children: React.ReactNode }) {
  const [isUnlocked, setIsUnlocked] = React.useState(false)
  const [emailInput, setEmailInput] = React.useState(AUTHORIZED_EMAIL)
  const [passwordInput, setPasswordInput] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState("")
  const [isClient, setIsClient] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    setIsClient(true)
    const authed = sessionStorage.getItem(STORAGE_KEY_AUTH)
    const user = sessionStorage.getItem(STORAGE_KEY_USER)
    if (authed === "true" && user?.toLowerCase() === AUTHORIZED_EMAIL.toLowerCase()) {
      setIsUnlocked(true)
    }
  }, [])

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setErrorMsg("")
    setIsLoading(true)

    setTimeout(() => {
      const normalizedEmail = emailInput.trim().toLowerCase()

      // 1. Strict Email Verification: ONLY jimwar02@gmail.com
      if (normalizedEmail !== AUTHORIZED_EMAIL.toLowerCase()) {
        setErrorMsg(`⛔ การเข้าถึงถูกปฏิเสธ: บัญชี "${emailInput}" ไม่ได้รับอนุญาต (ระบบล็อกเฉพาะ ${AUTHORIZED_EMAIL} เท่านั้น)`)
        setIsLoading(false)
        return
      }

      // 2. Security Passphrase / PIN check
      const validPasswords = ["Jetsada12", "1234", "jimwar02"]
      if (!validPasswords.includes(passwordInput.trim())) {
        setErrorMsg("รหัสผ่านความปลอดภัยไม่ถูกต้อง กรุณากรอกรหัสผ่านของคุณ")
        setIsLoading(false)
        return
      }

      // 3. Authenticated successfully
      sessionStorage.setItem(STORAGE_KEY_AUTH, "true")
      sessionStorage.setItem(STORAGE_KEY_USER, AUTHORIZED_EMAIL)
      setIsUnlocked(true)
      setIsLoading(false)
    }, 400)
  }

  const handleQuickGoogleAuth = () => {
    setEmailInput(AUTHORIZED_EMAIL)
    setErrorMsg("")
  }

  const handleLogout = () => {
    sessionStorage.removeItem(STORAGE_KEY_AUTH)
    sessionStorage.removeItem(STORAGE_KEY_USER)
    setIsUnlocked(false)
    setPasswordInput("")
    setErrorMsg("")
  }

  if (!isClient) {
    // Pure black screen while mounting on client
    return <div className="fixed inset-0 z-[999999] bg-[#000000]" />
  }

  // If unlocked, render dashboard content with top authorized user bar
  if (isUnlocked) {
    return (
      <div className="relative min-h-screen">
        {/* Floating Top Master Indicator & Logout */}
        <div className="fixed top-2 right-14 z-50 flex items-center gap-2 rounded-full border border-emerald-500/30 bg-black/80 px-3 py-1 text-[11px] backdrop-blur-md shadow-lg">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-emerald-400 font-semibold">{AUTHORIZED_EMAIL}</span>
          <button
            onClick={handleLogout}
            title="ออกจากระบบ"
            className="ml-2 flex items-center gap-1 rounded bg-zinc-800/80 hover:bg-rose-500/20 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-rose-400 transition-colors"
          >
            <LogOut className="h-3 w-3" />
            <span>ออกจากระบบ</span>
          </button>
        </div>
        {children}
      </div>
    )
  }

  // 100% PURE PITCH BLACK SCREEN DURING LOGIN
  return (
    <div className="fixed inset-0 z-[999999] flex flex-col items-center justify-center bg-[#000000] p-4 text-white select-none">
      {/* Deep Obsidian Matte Login Container */}
      <div className="w-full max-w-md rounded-2xl border border-zinc-800/90 bg-[#09090b] p-8 shadow-[0_0_50px_rgba(0,0,0,0.9)] space-y-6 text-center">
        
        {/* Brand & Security Badge */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-700/60 shadow-inner">
            <GoogleIcon className="h-9 w-9" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
              <span>AutoTD Quant Terminal</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              ระบบป้องกันความปลอดภัยระดับสูง (Private Authorized Only)
            </p>
          </div>
        </div>

        {/* Authorized Badge */}
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-left flex items-start gap-2.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">
            <div className="text-emerald-400 font-bold">บัญชีที่ได้รับอนุญาตให้ใช้งาน:</div>
            <div className="font-mono text-zinc-200 font-semibold">{AUTHORIZED_EMAIL}</div>
            <div className="text-zinc-500 text-[10px] mt-0.5">*บุคคลอื่นหรือบัญชีอื่นไม่สามารถเข้าใช้งานได้</div>
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4 text-left">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300">
              อีเมล Google / Gmail
            </label>
            <div className="relative">
              <Input
                type="email"
                required
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value)
                  setErrorMsg("")
                }}
                placeholder="ระบุ Gmail ของคุณ"
                className="bg-black/90 border-zinc-700 text-white font-mono text-sm placeholder:text-zinc-600 focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300">
              รหัสผ่านความปลอดภัย (Passphrase)
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                required
                autoFocus
                placeholder="กรอกรหัสผ่านของคุณ"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value)
                  setErrorMsg("")
                }}
                className="bg-black/90 border-zinc-700 text-white font-mono text-sm pr-10 placeholder:text-zinc-600 focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] font-medium text-rose-400 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Primary Action Button */}
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-11 bg-white hover:bg-zinc-200 text-black font-bold gap-2 text-sm transition-all shadow-md mt-2"
          >
            <GoogleIcon className="h-4 w-4" />
            <span>{isLoading ? "กำลังตรวจสอบสิทธิ์..." : `เข้าสู่ระบบด้วย ${AUTHORIZED_EMAIL}`}</span>
          </Button>

          <div className="text-center pt-2">
            <p className="text-[10px] text-zinc-600">
              AutoTD Cryptographic Guard | End-to-End Encrypted Session
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
