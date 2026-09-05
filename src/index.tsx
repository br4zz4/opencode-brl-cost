import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui"

const BRL_PER_USD = 5

const OPENROUTER_CREDITS = "https://openrouter.ai/api/v1/credits"

type SaldoState =
  | { kind: "credits"; value: number }
  | { kind: "unavailable" }

const readOpenRouterKey = (stateDir: string): string | undefined => {
  const candidates = [
    join(stateDir, "auth.json"),
    join(homedir(), ".local", "share", "opencode", "auth.json"),
    join(homedir(), ".config", "opencode", "auth.json"),
  ]
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
      const openrouter = parsed["openrouter"] as { key?: string } | undefined
      const key = openrouter?.key
      if (typeof key === "string" && key.length > 0) return key
    } catch {
      // try next candidate
    }
  }
  return undefined
}

const fetchSaldo = async (key: string): Promise<SaldoState | undefined> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(OPENROUTER_CREDITS, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    })
    if (!res.ok) return { kind: "unavailable" }
    const body = (await res.json()) as {
      data?: { total_credits?: number; total_usage?: number }
    }
    const data = body?.data
    if (typeof data?.total_credits === "number" && typeof data?.total_usage === "number") {
      return { kind: "credits", value: Math.max(0, data.total_credits - data.total_usage) }
    }
    return { kind: "unavailable" }
  } catch {
    return { kind: "unavailable" }
  } finally {
    clearTimeout(timeout)
  }
}

const formatBRL = (usd: number) => {
  const rounded = Math.round(usd * BRL_PER_USD * 100) / 100
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(rounded)
}

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const startOfWeek = (date: Date): number => {
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  current.setDate(current.getDate() - ((current.getDay() + 6) % 7))
  return current.getTime()
}

const startOfMonth = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), 1).getTime()

const tui: TuiPlugin = async (api, options) => {
  const hideNativeCost = options?.hideNativeCost === true
  const [dayCost, setDayCost] = createSignal<string>("R$ 0,00")
  const [weekCost, setWeekCost] = createSignal<string>("R$ 0,00")
  const [monthCost, setMonthCost] = createSignal<string>("R$ 0,00")
  const [sessionCost, setSessionCost] = createSignal<string>("R$ 0,00")
  const [saldo, setSaldo] = createSignal<SaldoState | undefined>(undefined)

  const costs = new Map<string, { cost: number; created: number }>()

  const assess = (
    info:
      | {
          id: string
          cost?: number
          time?: { created?: number }
          model?: { providerID?: string }
        }
      | undefined,
  ) => {
    if (!info || typeof info.cost !== "number" || typeof info.time?.created !== "number") return
    costs.set(info.id, { cost: info.cost, created: info.time.created })
  }

  const openRouterKey = readOpenRouterKey(api.state.path.state)

  const loadOpenRouterSaldo = async () => {
    if (!openRouterKey) return
    const next = await fetchSaldo(openRouterKey)
    console.error("[brl-cost] saldo:", next && next.kind)
    if (next) setSaldo(next)
  }

  const currentSessionID = (): string | undefined => {
    const route = api.route.current
    return route.name === "session" && typeof route.params?.sessionID === "string"
      ? route.params.sessionID
      : undefined
  }

  const fetchSessionCost = async (sessionID: string) => {
    try {
      const result = await api.client.session.get({ sessionID }, { throwOnError: true })
      const info = result.data
      if (!info) return
      assess(info)
      setSessionCost(formatBRL(typeof info.cost === "number" ? info.cost : 0))
    } catch {
      // ignore
    }
  }

  const refresh = () => {
    const now = new Date()
    const dayStart = startOfDay(now)
    const weekStart = startOfWeek(now)
    const monthStart = startOfMonth(now)
    let day = 0
    let week = 0
    let month = 0

    for (const entry of costs.values()) {
      if (entry.created >= dayStart) day += entry.cost
      if (entry.created >= weekStart) week += entry.cost
      if (entry.created >= monthStart) month += entry.cost
    }
    setDayCost(formatBRL(day))
    setWeekCost(formatBRL(week))
    setMonthCost(formatBRL(month))

    const sessionID = currentSessionID()
    const sessionCost = sessionID ? costs.get(sessionID)?.cost : undefined
    setSessionCost(formatBRL(typeof sessionCost === "number" ? sessionCost : 0))
    if (sessionID) void fetchSessionCost(sessionID)
  }

  const openRouterSaldo = (theme: TuiThemeCurrent) => {
    const current = saldo()
    if (!current || current.kind === "unavailable") return undefined
    return (
      <>
        <text fg={theme.accent}>  |  ◆ openrouter: </text>
        <text fg={theme.success}>{formatBRL(current.value)}</text>
      </>
    )
  }

  const seed = async () => {
    try {
      const result = await api.client.experimental.session.list({ limit: 1000 })
      if (Array.isArray(result?.data)) result.data.forEach((s) => assess(s))
    } catch {
      try {
        const result = await api.client.session.list({ limit: 1000 })
        if (Array.isArray(result?.data)) result.data.forEach((s) => assess(s))
      } catch {
        // ignore
      }
    }
    refresh()
  }

  refresh()
  void seed()
  void loadOpenRouterSaldo()
  setTimeout(() => void loadOpenRouterSaldo(), 2_000)
  const saldoInterval = setInterval(() => void loadOpenRouterSaldo(), 60_000)
  api.lifecycle.onDispose(() => clearInterval(saldoInterval))

  api.event.on("session.created", (event) => {
    assess(event.properties.info)
    refresh()
  })
  api.event.on("session.updated", (event) => {
    assess(event.properties.info)
    if (event.properties.sessionID === currentSessionID()) refresh()
  })
  api.event.on("session.deleted", (event) => {
    costs.delete(event.properties.sessionID)
    refresh()
  })
  api.event.on("session.idle", (event) => {
    if (event.properties.sessionID === currentSessionID()) refresh()
  })
  api.event.on("tui.session.select", (event) => {
    if (event.properties.sessionID === currentSessionID()) refresh()
  })

  api.slots.register({
    slots: {
      ...(hideNativeCost
        ? {
            session_prompt(ctx, props) {
              const theme = ctx.theme.current
              const session = props.session_id
                ? api.state.session.get(props.session_id)
                : undefined
              const model = session?.model
              return (
                <box flexDirection="column" flexGrow={1} minHeight={0}>
                  <box flexDirection="row" paddingLeft={2} gap={1}>
                    {model ? (
                      <text fg={theme.textMuted}>◆ {model.id}</text>
                    ) : undefined}
                  </box>
                  <api.ui.Prompt
                    sessionID={props.session_id}
                    visible={props.visible}
                    disabled={props.disabled}
                    onSubmit={props.on_submit}
                    ref={props.ref}
                    right={
                      <api.ui.Slot
                        name="session_prompt_right"
                        session_id={props.session_id}
                      />
                    }
                  />
                </box>
              )
            },
          }
        : {}),
      home_bottom(ctx) {
        if (!openRouterKey) return undefined
        const current = saldo()
        if (!current || current.kind === "unavailable") return undefined
        const theme = ctx.theme.current
        return (
          <box
            flexDirection="row"
            justifyContent="space-between"
            flexGrow={1}
            paddingLeft={2}
            paddingRight={2}
            border
            borderColor={theme.border}
          >
            <box flexDirection="row">
              <text fg={theme.accent}>◆ openrouter: </text>
              <text fg={theme.success}>{formatBRL(current.value)}</text>
            </box>
          </box>
        )
      },
      app_bottom(ctx) {
        if (!currentSessionID()) return undefined
        const theme = ctx.theme.current
        const separator = "  |  "
        return (
          <box
            flexDirection="row"
            justifyContent="space-between"
            flexGrow={1}
            paddingLeft={2}
            paddingRight={2}
            border
            borderColor={theme.border}
          >
            <box flexDirection="row">
              <text fg={theme.textMuted}>dia: </text>
              <text fg={theme.accent}>{dayCost()}</text>
              <text fg={theme.textMuted}>{separator}semana: </text>
              <text fg={theme.success}>{weekCost()}</text>
              <text fg={theme.textMuted}>{separator}mês: </text>
              <text fg={theme.warning}>{monthCost()}</text>
            </box>
            <box flexDirection="row">
              <text fg={theme.textMuted}>◆ session: </text>
              <text fg={theme.text}>{sessionCost()}</text>
              {openRouterSaldo(theme)}
            </box>
          </box>
        )
      },
    },
  })
}

const plugin: TuiPluginModule = {
  id: "opencode-brl-cost",
  tui,
}

export default plugin