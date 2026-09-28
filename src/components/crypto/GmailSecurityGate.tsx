"use client"

import * as React from "react"
import Script from "next/script"
import { AlertTriangle, LogOut, CheckCircle2, Lock, KeyRound, Eye, EyeOff, ShieldCheck, ChevronDown, ChevronUp, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const AUTHORIZED_EMAIL = "jimwar02@gmail.com"
const STORAGE_KEY_AUTH = "autotd_session_auth_v1"
const STORAGE_KEY_USER = "autotd_auth_email_v1"
const STORAGE_KEY_CLIENT_ID = "autotd_google_client_id_v1"

// Known master security passphrases for jimwar02@gmail.com
const VALID_MASTER_KEYS = ["Jetsada12", "1234", "jimwar02"]

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
  const [showPinInput, setShowPinInput] = React.useState(false)
  const [pinInput, setPinInput] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [clientId, setClientId] = React.useState("")
  const [showClientIdConfig, setShowClientIdConfig] = React.useState(false)

  const googleBtnContainerRef = React.useRef<HTMLDivElement>(null)

  // Verify existing session
  React.useEffect(() => {
    setIsClient(true)
    const authedLocal = localStorage.getItem(STORAGE_KEY_AUTH)
    const userLocal = localStorage.getItem(STORAGE_KEY_USER)
    const authedSession = sessionStorage.getItem(STORAGE_KEY_AUTH)
    const userSession = sessionStorage.getItem(STORAGE_KEY_USER)

    const isAuthed =
      (authedLocal === "true" && userLocal?.toLowerCase() === AUTHORIZED_EMAIL.toLowerCase()) ||
      (authedSession === "true" && userSession?.toLowerCase() === AUTHORIZED_EMAIL.toLowerCase())

    if (isAuthed) {
      setIsUnlocked(true)
    }

    const savedClientId =
      localStorage.getItem(STORAGE_KEY_CLIENT_ID) ||
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
      ""
    setClientId(savedClientId)
  }, [])

  // Grant access ONLY when strictly verified
  const grantVerifiedAccess = React.useCallback((email: string) => {
    localStorage.setItem(STORAGE_KEY_AUTH, "true")
    localStorage.setItem(STORAGE_KEY_USER, email)
    sessionStorage.setItem(STORAGE_KEY_AUTH, "true")
    sessionStorage.setItem(STORAGE_KEY_USER, email)
    setIsUnlocked(true)
    setIsLoading(false)
    setErrorMsg("")
  }, [])

  // Callback from Google OAuth credential response (ID Token JWT)
  const handleGoogleCredentialResponse = React.useCallback(
    (response: any) => {
      setIsLoading(true)
      setErrorMsg("")

      if (!response || !response.credential) {
        setErrorMsg("❌ ไม่พบข้อมูลการเข้าสู่ระบบจาก Google กรุณาลองใหม่อีกครั้ง")
        setIsLoading(false)
        return
      }

      try {
        const payload = parseJwt(response.credential)
        const userEmail = payload?.email?.trim().toLowerCase()

        if (userEmail === AUTHORIZED_EMAIL.toLowerCase()) {
          grantVerifiedAccess(userEmail)
        } else {
          setErrorMsg(
            `⛔ การเข้าถึงถูกปฏิเสธ: บัญชี "${userEmail || "ไม่ระบุ"}" ไม่ได้รับอนุญาต (ระบบนี้ล็อกเฉพาะ ${AUTHORIZED_EMAIL} เท่านั้น)`
          )
          setIsLoading(false)
        }
      } catch (err: any) {
        setErrorMsg("ไม่สามารถตรวจสอบข้อมูลความถูกต้องของบัญชี Google ได้")
        setIsLoading(false)
      }
    },
    [grantVerifiedAccess]
  )

  // Initialize Google Identity Services (GIS)
  const initGsi = React.useCallback(() => {
    if (typeof window !== "undefined" && window.google?.accounts?.id && clientId) {
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
        })

        if (googleBtnContainerRef.current) {
          googleBtnContainerRef.current.innerHTML = ""
          window.google.accounts.id.renderButton(googleBtnContainerRef.current, {
            type: "standard",
            theme: "filled_blue",
            size: "large",
            text: "signin_with",
            shape: "pill",
            logo_alignment: "left",
            width: 280,
          })
        }
      } catch (err) {
        console.warn("Google Identity init notice:", err)
      }
    }
  }, [clientId, handleGoogleCredentialResponse])

  // Re-run initGsi when clientId updates or script finishes
  React.useEffect(() => {
    initGsi()
  }, [clientId, initGsi])

  // OAuth 2.0 Token Popup Trigger
  const handleGoogleOAuthPopup = () => {
    if (!clientId) {
      setErrorMsg("⚠️ ยังไม่ได้ระบุ Google Client ID กรุณาระบุ Client ID ด้านล่าง หรือใช้ Master PIN เพื่อเข้าใช้งานทันที")
      setShowClientIdConfig(true)
      return
    }

    if (typeof window !== "undefined" && window.google?.accounts?.oauth2) {
      try {
        setIsLoading(true)
        setErrorMsg("")

        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: "https://www.googleapis.com/auth/userinfo.email openid profile",
          callback: async (tokenResponse: any) => {
            if (tokenResponse.error) {
              if (tokenResponse.error === "popup_closed_by_user") {
                setErrorMsg("คุณปิดหน้าต่างการลงชื่อเข้าใช้ Google")
              } else {
                setErrorMsg(`Google OAuth: ${tokenResponse.error_description || tokenResponse.error}`)
              }
              setIsLoading(false)
              return
            }

            if (tokenResponse.access_token) {
              try {
                const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                  headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
                })
                const userInfo = await res.json()
                const userEmail = userInfo?.email?.trim().toLowerCase()

                if (userEmail === AUTHORIZED_EMAIL.toLowerCase()) {
                  grantVerifiedAccess(userEmail)
                } else {
                  setErrorMsg(
                    `⛔ การเข้าถึงถูกปฏิเสธ: บัญชี "${userEmail || "ไม่ระบุ"}" ไม่ได้รับอนุญาต (ระบบนี้ล็อกเฉพาะ ${AUTHORIZED_EMAIL} เท่านั้น)`
                  )
                  setIsLoading(false)
                }
              } catch (e: any) {
                setErrorMsg("ไม่สามารถดึงข้อมูลยืนยันตัวตนจาก Google ได้")
                setIsLoading(false)
              }
            }
          },
        })

        tokenClient.requestAccessToken()
        return
      } catch (e: any) {
        setErrorMsg("เกิดข้อผิดพลาดในการเชื่อมต่อ Google: " + (e.message || "ไม่สามารถเปิดหน้าต่างล็อกอินได้"))
        setIsLoading(false)
        return
      }
    }

    // Try standard prompt
    if (typeof window !== "undefined" && window.google?.accounts?.id) {
      window.google.accounts.id.prompt((notification: any) => {
        if (notification.isNotDisplayed()) {
          setErrorMsg("⚠️ หน้าต่าง Google Sign-In ไม่แสดงบนเบราว์เซอร์นี้ (แนะนำให้ใช้ Master PIN ด้านล่าง หรือเปิดจากหน้าต่างปกติ)")
          setIsLoading(false)
        }
      })
    } else {
      setErrorMsg("ระบบ Google Identity กำลังโหลด กรุณารอสักครู่แล้วลองใหม่")
      setIsLoading(false)
    }
  }

  // Master PIN / Passphrase verification
  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")
    const trimmed = pinInput.trim()

    if (!trimmed) {
      setErrorMsg("กรุณาระบุรหัสผ่านหรือ PIN")
      return
    }

    if (VALID_MASTER_KEYS.includes(trimmed)) {
      grantVerifiedAccess(AUTHORIZED_EMAIL)
    } else {
      setErrorMsg("❌ รหัส Master PIN / Password ไม่ถูกต้อง (ไม่อนุญาตให้เข้าใช้งาน)")
    }
  }

  const handleSaveClientId = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = clientId.trim()
    localStorage.setItem(STORAGE_KEY_CLIENT_ID, trimmed)
    setClientId(trimmed)
    setShowClientIdConfig(false)
    setErrorMsg("บันทึก Google Client ID เรียบร้อย กำลังรีเฟรชปุ่มล็อกอิน...")
    setTimeout(() => {
      initGsi()
      setErrorMsg("")
    }, 500)
  }

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY_AUTH)
    localStorage.removeItem(STORAGE_KEY_USER)
    sessionStorage.removeItem(STORAGE_KEY_AUTH)
    sessionStorage.removeItem(STORAGE_KEY_USER)
    setIsUnlocked(false)
    setErrorMsg("")
    setPinInput("")
  }

  if (!isClient) {
    return <div className="fixed inset-0 z-[999999] bg-[#000000]" />
  }

  // If unlocked, render dashboard content with top status bar
  if (isUnlocked) {
    return (
      <div className="relative min-h-screen">
        {/* Top Authorized User Bar */}
        <div className="fixed top-2 right-14 z-50 flex items-center gap-2 rounded-full border border-emerald-500/30 bg-black/80 px-2.5 sm:px-3 py-1 text-[10px] sm:text-[11px] backdrop-blur-md shadow-lg max-w-[220px] sm:max-w-none truncate">
          <span className="flex h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-emerald-400 font-semibold truncate">{AUTHORIZED_EMAIL}</span>
          <button
            onClick={handleLogout}
            title="ออกจากระบบ"
            className="text-zinc-400 hover:text-rose-400 ml-1 transition-colors flex items-center gap-1"
          >
            <LogOut className="h-3 w-3" />
          </button>
        </div>

        {/* Dashboard Content */}
        {children}
      </div>
    )
  }

  // PURE PITCH BLACK SECURE LOGIN GATE
  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={initGsi}
      />

      <div className="fixed inset-0 z-[999999] flex flex-col items-center justify-center bg-[#000000] p-4 text-white select-none">
        <div className="w-full max-w-sm rounded-2xl border border-zinc-800/80 bg-[#09090b] p-6 sm:p-8 shadow-[0_0_70px_rgba(0,0,0,0.95)] text-center space-y-5">
          {/* Brand Icon */}
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 shadow-inner">
            <ShieldCheck className="h-7 w-7 text-emerald-400" />
          </div>

          {/* Title */}
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">AutoTD</h1>
            <p className="text-xs text-zinc-400 mt-1">Autonomous Quant Terminal</p>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] text-emerald-400 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>ล็อกเฉพาะ: {AUTHORIZED_EMAIL}</span>
            </div>
          </div>

          {/* REAL Google Official Button Container (Rendered by Google GIS) */}
          <div className="flex flex-col items-center justify-center gap-3">
            <div ref={googleBtnContainerRef} id="google-btn-slot" className="flex items-center justify-center min-h-[44px]" />

            {/* Google OAuth Popup Button */}
            <Button
              onClick={handleGoogleOAuthPopup}
              disabled={isLoading}
              className="w-full h-11 bg-white hover:bg-zinc-200 text-black font-bold gap-2.5 text-xs transition-all shadow-lg rounded-full"
            >
              <GoogleIcon className="h-4 w-4" />
              <span>{isLoading ? "กำลังตรวจสอบกับ Google..." : "ลงชื่อเข้าใช้ด้วย Google (OAuth)"}</span>
            </Button>
          </div>

          {/* Error Notice */}
          {errorMsg && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-400 flex items-start gap-2 text-left">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="leading-snug break-words">{errorMsg}</span>
            </div>
          )}

          {/* Master PIN / Password Option Toggle */}
          <div className="pt-2 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={() => setShowPinInput(!showPinInput)}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors py-1"
            >
              <KeyRound className="h-3.5 w-3.5 text-amber-400" />
              <span>{showPinInput ? "ซ่อนช่องกรอก Master PIN" : "หรือ เข้าสู่ระบบด้วย Master PIN / Password"}</span>
              {showPinInput ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>

            {showPinInput && (
              <form onSubmit={handlePinSubmit} className="mt-3 space-y-2.5 text-left animate-in fade-in duration-200">
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoFocus
                    placeholder="กรอก Master PIN หรือ Password"
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value)
                      setErrorMsg("")
                    }}
                    className="bg-black/90 border-zinc-700 text-white font-mono text-xs pr-10 placeholder:text-zinc-600 focus:border-emerald-500 h-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  type="submit"
                  className="w-full h-9 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-lg"
                >
                  ยืนยันตัวตนด้วย Master PIN
                </Button>
              </form>
            )}
          </div>

          {/* Google Client ID Configuration Toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowClientIdConfig(!showClientIdConfig)}
              className="text-[10px] text-zinc-500 hover:text-zinc-400 inline-flex items-center gap-1"
            >
              <Settings2 className="h-3 w-3" />
              <span>ตั้งค่า Google Client ID สำหรับโดเมนนี้</span>
            </button>

            {showClientIdConfig && (
              <form onSubmit={handleSaveClientId} className="mt-2 space-y-2 text-left bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800 text-[11px]">
                <label className="text-zinc-400 block text-[10px]">
                  Google OAuth Client ID (จาก Google Cloud Console):
                </label>
                <Input
                  type="text"
                  placeholder="xxxxx.apps.googleusercontent.com"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="bg-black border-zinc-700 text-white font-mono text-[10px] h-8"
                />
                <Button type="submit" size="sm" className="w-full h-7 text-[10px] bg-zinc-700 hover:bg-zinc-600">
                  บันทึก Client ID
                </Button>
              </form>
            )}
          </div>

          <p className="text-[10px] text-zinc-600 pt-1">
            AutoTD Security Guard | Private Authorized Access
          </p>
        </div>
      </div>
    </>
  )
}
