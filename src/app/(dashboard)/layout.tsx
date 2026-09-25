import { CommandPalette } from "@/components/command-palette"
import { ThemeToggle } from "@/components/theme-toggle"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top utility bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4 bg-card/60 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20 text-emerald-400 font-black text-[11px] border border-emerald-500/30">
            Q
          </div>
          <span className="text-xs font-bold tracking-tight text-foreground">
            AutoTD Quant AI Desk
          </span>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            | Full Width Terminal
          </span>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[9px] font-medium text-muted-foreground sm:flex">
            <span className="text-[10px]">⌘</span>K
          </kbd>
          <ThemeToggle />
        </div>
      </header>

      <CommandPalette />
      <main className="flex-1 w-full p-2 sm:p-4">{children}</main>
    </div>
  )
}
