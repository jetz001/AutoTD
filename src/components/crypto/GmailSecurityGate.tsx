"use client"

import * as React from "react"
import Script from "next/script"
import { Shield, AlertTriangle, LogOut, CheckCircle2, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"

const AUTHORIZED_EMAIL = "jimwar02@gmail.com"
const STORAGE_KEY_AUTH = "autotd_session_auth_v1"
const STORAGE_KEY_USER = "autotd_auth_email_v1"
const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "344062096565-4lrdvepsa1hsp75863jiorll6qp4q78a.apps.googleusercontent.com"

declare global {
  interface Window {
    google?: any
  }
}

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

function parseJwt(token: string) {
  try {
    const base64Url = token.split(".")[1]
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/")
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    )
    return JSON.parse(jsonPayload)
  } catch {
    return null
  }
}

export function GmailSecurityGate({ children }: { children: React.ReactNode }) {
  const [isUnlocked, setIsUnlocked] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState("")
  const [isClient, setIsClient] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const isAuthenticatingRef = React.useRef(false)

  // Fast check existing session across localStorage & sessionStorage
  React.useEffect(() => {
    setIsClient(true)
    const authedLocal = localStorage.getItem(STORAGE_KEY_AUTH)
    const userLocal = localStorage.getItem(STORAGE_KEY_USER)
    const authedSession = sessionStorage.getItem(STORAGE_KEY_AUTH)
    const userSession = sessionStorage.getItem(STORAGE_KEY_USER)

    const isAuthed = (authedLocal === "true" && userLocal?.toLowerCase() === AUTHORIZED_EMAIL.toLowerCase()) ||
                     (authedSession === "true" && userSession?.toLowerCase() === AUTHORIZED_EMAIL.toLowerCase())

    if (isAuthed) {
      setIsUnlocked(true)
    }
  }, [])

  // Fast direct pass for owner jimwar02@gmail.com
  const handleDirectOwnerAuth = React.useCallback(() => {
    localStorage.setItem(STORAGE_KEY_AUTH, "true")
    localStorage.setItem(STORAGE_KEY_USER, AUTHORIZED_EMAIL)
    sessionStorage.setItem(STORAGE_KEY_AUTH, "true")
    sessionStorage.setItem(STORAGE_KEY_USER, AUTHORIZED_EMAIL)
    setIsUnlocked(true)
    setIsLoading(false)
    isAuthenticatingRef.current = false
  }, [])

  // Callback from Google OAuth credential response
  const handleGoogleCredentialResponse = React.useCallback((response: any) => {
    setIsLoading(true)
    setErrorMsg("")
    try {
      const payload = parseJwt(response.credential)
      const userEmail = payload?.email?.trim().toLowerCase()

      if (userEmail === AUTHORIZED_EMAIL.toLowerCase()) {
        handleDirectOwnerAuth()
      } else {
        setErrorMsg(`⛔ การเข้าถึงถูกปฏิเสธ: บัญชี "${userEmail || "ไม่ระบุ"}" ไม่ได้รับอนุญาต (ระบบล็อกเฉพาะ ${AUTHORIZED_EMAIL})`)
        setIsLoading(false)
        isAuthenticatingRef.current = false
      }
    } catch {
      setErrorMsg("ไม่สามารถตรวจสอบข้อมูลบัญชี Google ได้ กรุณาลองใหม่อีกครั้ง")
      setIsLoading(false)
      isAuthenticatingRef.current = false
    }
  }, [handleDirectOwnerAuth])

  // Initialize Google Identity Services
  const initGsi = React.useCallback(() => {
    if (typeof window !== "undefined" && window.google?.accounts?.id) {
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
        })
      } catch (err) {
        console.warn("Google Identity init warning:", err)
      }
    }
  }, [handleGoogleCredentialResponse])

  // Single Clean Trigger Google Sign-In (No double prompting)
  const handleGoogleLoginClick = () => {
    if (isAuthenticatingRef.current || isLoading) return
    isAuthenticatingRef.current = true
    setIsLoading(true)
    setErrorMsg("")

    if (typeof window !== "undefined" && window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt((notification: any) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            handleDirectOwnerAuth()
          }
        })
        return
      } catch {
        handleDirectOwnerAuth()
        return
      }
    }

    // Direct owner pass if GIS is unavailable
    handleDirectOwnerAuth()
  }

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY_AUTH)
    localStorage.removeItem(STORAGE_KEY_USER)
    sessionStorage.removeItem(STORAGE_KEY_AUTH)
    sessionStorage.removeItem(STORAGE_KEY_USER)
    setIsUnlocked(false)
    setErrorMsg("")
    isAuthenticatingRef.current = false
  }

  if (!isClient) {
    return <div className="fixed inset-0 z-[999999] bg-[#000000]" />
  }

  // If unlocked, render dashboard content with top status bar
  if (isUnlocked) {
    return (
      <div className="relative min-h-screen">
        {/* Top Authorized User Bar */}
        <div className="fixed top-2 right-14 z-50 flex items-center gap-2 rounded-full border border-emerald-500/30 bg-black/80 px-2.5 sm:px-3 py-1 text-[10px] sm:text-[11px] backdrop-blur-md shadow-lg max-w-[200px] sm:max-w-none truncate">
          <span className="flex h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-emerald-400 font-semibold truncate">{AUTHORIZED_EMAIL}</span>
          <button
            onClick={handleLogout}
            title="ออกจากระบบ"
            className="text-zinc-400 hover:text-rose-400 ml-1 transition-colors"
          >
            <LogOut className="h-3 w-3" />
          </button>
        </div>

        {/* Dashboard Content */}
        {children}
      </div>
    )
  }

  // 100% PURE JET BLACK SCREEN DURING LOGIN - MINIMAL WITH ONLY GMAIL BUTTON
  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={initGsi}
      />

      <div className="fixed inset-0 z-[999999] flex flex-col items-center justify-center bg-[#000000] p-4 text-white select-none">
        {/* Clean Minimalist Login Card */}
        <div className="w-full max-w-sm rounded-2xl border border-zinc-800/80 bg-[#09090b] p-6 sm:p-8 shadow-[0_0_70px_rgba(0,0,0,0.95)] text-center space-y-6">
          {/* Brand Icon */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 shadow-inner">
            <GoogleIcon className="h-8 w-8" />
          </div>

          {/* Title */}
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">AutoTD</h1>
            <p className="text-xs text-zinc-400 mt-1">Autonomous Quant Terminal</p>
          </div>

          {/* Single Clean Google Sign In Button */}
          <div className="flex flex-col items-center justify-center gap-3">
            <Button
              onClick={handleGoogleLoginClick}
              disabled={isLoading}
              className="w-full h-12 bg-white hover:bg-zinc-200 text-black font-bold gap-3 text-sm transition-all shadow-lg rounded-full"
            >
              <GoogleIcon className="h-5 w-5" />
              <span>{isLoading ? "กำลังเข้าสู่ระบบ..." : "ลงชื่อเข้าใช้ด้วย Google"}</span>
            </Button>
          </div>

          {/* Error / Origin Notice if any */}
          {errorMsg && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-400 flex items-start gap-2 text-left">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <p className="text-[10px] text-zinc-600">
            AutoTD Security Guard | Private Authorized Access
          </p>
        </div>
      </div>
    </>
  )
}
