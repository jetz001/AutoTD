"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
} from "@/components/ui/sidebar"
import {
  Bot,
  Activity,
  Layers,
  Search,
  ShieldAlert,
  Key,
  Sliders,
  Cpu,
  Zap,
} from "lucide-react"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()

  return (
    <Sidebar variant="inset" {...props}>
      {/* Brand Header */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/crypto" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Bot className="size-5" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-bold tracking-tight text-foreground flex items-center gap-1.5">
                  Bitget Quant AI
                </span>
                <span className="truncate text-[10px] font-semibold text-emerald-400">
                  Autonomous Spot Desk
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Main Navigation: ONLY Quant Trading & Bitget Spot */}
      <SidebarContent>
        {/* Group 1: Core Quant Trading */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            ระบบเทรด Quant AI
          </SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/crypto" || pathname === "/"}
                tooltip="ศูนย์เทรดสปอต Quant"
                render={<Link href="/crypto" />}
              >
                <Activity className="size-4 text-emerald-400" />
                <span className="font-semibold">Spot Terminal</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={false}
                tooltip="สแกน Top 20 เหรียญย่อตัวในขาขึ้น"
                render={<Link href="/crypto" />}
              >
                <Search className="size-4 text-sky-400" />
                <span>Spot AI Screener</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={false}
                tooltip="คำนวณราคาเฉลี่ยรวมทุกไม้ DCA"
                render={<Link href="/crypto" />}
              >
                <Layers className="size-4 text-purple-400" />
                <span>ต้นทุนเฉลี่ย (Avg Cost)</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Group 2: Risk & Execution Engine */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            วินัย & ความเสี่ยง
          </SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={false}
                tooltip="ระบบตัดขาดทุน Hard Stop -5% และ Cooldown 3 ชม."
                render={<Link href="/crypto" />}
              >
                <ShieldAlert className="size-4 text-rose-400" />
                <span>Cut-Loss & Cooldown</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={false}
                tooltip="เป้าหมายกำไร +3.5% จากต้นทุนเฉลี่ย"
                render={<Link href="/crypto" />}
              >
                <Zap className="size-4 text-amber-400" />
                <span>Take Profit Engine</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer: Quant Commander Agent Status */}
      <SidebarFooter className="border-t border-border/40 p-2">
        <div className="flex items-center gap-2.5 rounded-lg bg-muted/40 p-2 border border-border/50">
          <div className="flex size-7 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400">
            <Cpu className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-xs leading-tight">
            <span className="truncate font-bold text-foreground">Quant Commander</span>
            <span className="truncate text-[10px] text-emerald-400 font-medium">● รันสแตนด์บาย 24/7</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
