"use client"

import * as React from "react"
import Script from "next/script"
import { AlertTriangle, LogOut, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"

const AUTHORIZED_EMAIL = "jimwar02@gmail.com"
const STORAGE_KEY_SESSION = "autotd_auth_session_30d"
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000 // 30 วัน

const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "923607029699-ca3iblmagb592gfrnsu0sldh7602i71k.apps.googleusercontent.com"

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

  // Verify existing 30-day session on mount
  React.useEffect(() => {
    setIsClient(true)
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSION)
      if (raw) {
        const session = JSON.parse(raw)
        if (session?.authenticated && session?.expireAt && Date.now() < session.expireAt) {
          setIsUnlocked(true)
          return
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY_SESSION)
    }
  }, [])

  // Grant 30-day persistent session
  const grant30DaySession = React.useCallback(() => {
    try {
      const sessionData = {
        authenticated: true,
        expireAt: Date.now() + THIRTY_DAYS_MS,
      }
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(sessionData))
      setIsUnlocked(true)
      setIsLoading(false)
      setErrorMsg("")
    } catch (e) {
      console.error(e)
      setIsUnlocked(true)
      setIsLoading(false)
    }
  }, [])

  // Callback from Google OAuth credential response (ID Token JWT)
  const handleGoogleCredentialResponse = React.useCallback(
    (response: any) => {
      setIsLoading(true)
      setErrorMsg("")

      if (!response || !response.credential) {
        setErrorMsg("ไม่พบข้อมูลการเข้าสู่ระบบจาก Google กรุณาลองใหม่อีกครั้ง")
        setIsLoading(false)
        return
      }

      try {
        const payload = parseJwt(response.credential)
        const userEmail = payload?.email?.trim().toLowerCase()

        if (userEmail === AUTHORIZED_EMAIL.toLowerCase()) {
          grant30DaySession()
        } else {
          setErrorMsg("⛔ บัญชี Google นี้ไม่ได้รับอนุญาตให้เข้าใช้งานระบบ")
          setIsLoading(false)
        }
      } catch {
        setErrorMsg("ไม่สามารถตรวจสอบข้อมูลบัญชี Google ได้ กรุณาลองใหม่")
        setIsLoading(false)
      }
    },
    [grant30DaySession]
  )

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
        console.warn("GIS Init:", err)
      }
    }
  }, [handleGoogleCredentialResponse])

  // Single Click Google Login Handler
  const handleGoogleLoginClick = () => {
    if (isLoading) return
    setIsLoading(true)
    setErrorMsg("")

    // 1. Google Identity Services OAuth 2.0 Popup
    if (typeof window !== "undefined" && window.google?.accounts?.oauth2) {
      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "https://www.googleapis.com/auth/userinfo.email openid profile",
          callback: async (tokenResponse: any) => {
            if (tokenResponse?.error) {
              if (tokenResponse.error === "popup_closed_by_user") {
                setErrorMsg("คุณปิดหน้าต่างการลงชื่อเข้าใช้ Google")
              } else {
                setErrorMsg("เกิดข้อผิดพลาดจาก Google: " + (tokenResponse.error_description || tokenResponse.error))
              }
              setIsLoading(false)
              return
            }

            if (tokenResponse?.access_token) {
              try {
                const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                  headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
                })
                const userInfo = await res.json()
                const userEmail = userInfo?.email?.trim().toLowerCase()

                if (userEmail === AUTHORIZED_EMAIL.toLowerCase()) {
                  grant30DaySession()
                } else {
                  setErrorMsg("⛔ บัญชี Google นี้ไม่ได้รับอนุญาตให้เข้าใช้งานระบบ")
                  setIsLoading(false)
                }
              } catch {
                setErrorMsg("ไม่สามารถดึงข้อมูลยืนยันตัวตนจาก Google ได้")
                setIsLoading(false)
              }
            }
          },
        })

        tokenClient.requestAccessToken()
        return
      } catch (e: any) {
        console.error(e)
      }
    }

    // 2. Fallback to GIS Prompt
    if (typeof window !== "undefined" && window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt((notification: any) => {
          if (notification.isNotDisplayed()) {
            setErrorMsg("เบราว์เซอร์บล็อกหน้าต่างป็อปอัป กรุณาอนุญาตป็อปอัปสำหรับเว็บไซต์นี้")
            setIsLoading(false)
          }
        })
        return
      } catch (err: any) {
        console.error(err)
      }
    }

    setErrorMsg("กำลังเชื่อมต่อไปยังบริการ Google Identity กรุณารอสักครู่แล้วลองใหม่")
    setIsLoading(false)
  }

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY_SESSION)
    sessionStorage.clear()
    setIsUnlocked(false)
    setErrorMsg("")
  }

  if (!isClient) {
    return <div className="fixed inset-0 z-[999999] bg-[#000000]" />
  }

  // If unlocked, render dashboard with discreet top status bar
  if (isUnlocked) {
    return (
      <div className="relative min-h-screen">
        {/* Top Authorized User Bar (Discreet, does NOT expose email) */}
        <div className="fixed top-2 right-14 z-50 flex items-center gap-2 rounded-full border border-emerald-500/30 bg-black/80 px-3 py-1 text-[11px] backdrop-blur-md shadow-lg">
          <span className="flex h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-emerald-400 font-semibold">Authorized Session (30 Days)</span>
          <button
            onClick={handleLogout}
            title="ออกจากระบบ"
            className="text-zinc-400 hover:text-rose-400 ml-1.5 transition-colors flex items-center gap-1"
          >
            <LogOut className="h-3 w-3" />
          </button>
        </div>

        {/* Dashboard Content */}
        {children}
      </div>
    )
  }

  // PURE PITCH BLACK MINIMAL LOGIN CARD - EXACTLY 1 GOOGLE AUTH BUTTON
  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={initGsi}
      />

      <div className="fixed inset-0 z-[999999] flex flex-col items-center justify-center bg-[#000000] p-4 text-white select-none">
        <div className="w-full max-w-sm rounded-2xl border border-zinc-800/80 bg-[#09090b] p-6 sm:p-8 shadow-[0_0_70px_rgba(0,0,0,0.95)] text-center space-y-6">
          {/* Brand Icon */}
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 shadow-inner">
            <ShieldCheck className="h-7 w-7 text-emerald-400" />
          </div>

          {/* Title - Clean & Discreet, No email exposed */}
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">AutoTD</h1>
            <p className="text-xs text-zinc-400 mt-1">Autonomous Quant Terminal</p>
          </div>

          {/* EXACTLY ONE CLEAN GOOGLE SIGN-IN BUTTON */}
          <div className="pt-2">
            <Button
              onClick={handleGoogleLoginClick}
              disabled={isLoading}
              className="w-full h-12 bg-white hover:bg-zinc-200 text-black font-bold gap-3 text-sm transition-all shadow-lg rounded-full cursor-pointer"
            >
              <GoogleIcon className="h-5 w-5" />
              <span>{isLoading ? "กำลังลงชื่อเข้าใช้..." : "ลงชื่อเข้าใช้ด้วย Google"}</span>
            </Button>
          </div>

          {/* Error Notice (if any) */}
          {errorMsg && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-400 flex items-start gap-2 text-left">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="leading-snug break-words">{errorMsg}</span>
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
