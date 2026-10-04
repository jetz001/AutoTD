"use client"

import * as React from "react"
import { AlertCircle, RefreshCw, Trash2, Home } from "lucide-react"

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error("AutoTD Application Error:", error)
  }, [error])

  const handleClearCacheAndReload = () => {
    try {
      localStorage.removeItem("bitget_spot_live_holdings_v2")
      localStorage.removeItem("bitget_spot_paper_holdings_v2")
      localStorage.removeItem("bitget_spot_holdings_v1")
      sessionStorage.clear()
    } catch {}
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#090d16] p-4 text-white select-none">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#0f172a] p-6 text-center shadow-2xl space-y-5">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
          <AlertCircle className="h-7 w-7" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">ระบบตรวจพบข้อผิดพลาดในการโหลดหน้าจอ</h2>
          <p className="text-xs text-zinc-400 mt-1">
            ตรวจพบข้อมูลชั่วคราวที่ไม่สมบูรณ์ กำลังเตรียมฟื้นฟูระบบอัตโนมัติ
          </p>
          {error?.message && (
            <p className="mt-3 rounded bg-black/50 p-2.5 font-mono text-[11px] text-rose-400 break-all border border-zinc-800 text-left">
              {error.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={() => reset()}
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
            ลองโหลดใหม่อีกครั้ง (Retry)
          </button>
          <button
            onClick={handleClearCacheAndReload}
            className="w-full py-2.5 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <Trash2 className="h-4 w-4" />
            ล้างแคชพอร์ต & รีเซ็ต (Clear Cache & Reset)
          </button>
          <a
            href="/crypto"
            className="w-full py-2 px-4 rounded-lg text-zinc-400 hover:text-white text-xs flex items-center justify-center gap-2 transition"
          >
            <Home className="h-4 w-4" />
            รีเฟรชหน้าหลัก
          </a>
        </div>
      </div>
    </div>
  )
}
