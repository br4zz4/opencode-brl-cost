import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui"

const RATE_FALLBACK = 5.0

const AWESOMEAPI_USD_BRL = "https://economia.awesomeapi.com.br/json/last/USD-BRL"
const OPENROUTER_CREDITS = "https://openrouter.ai/api/v1/credits"
const RATE_FILE = "brl-cost-rate.json"

type RateCache = { rate: number; date: string; timestamp: string }
type RateState = "fresh" | "stale_one_day" | "stale" | "unavailable"

const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

const loadCachedRate = (stateDir: string): RateCache | null => {
  try {
    const raw = readFileSync(join(stateDir, RATE_FILE), "utf8")
    const parsed = JSON.parse(raw) as Partial<RateCache>
    if (
      typeof parsed?.rate === "number" &&
      typeof parsed?.date === "string" &&
      typeof parsed?.timestamp === "string"
    ) {
      return { rate: parsed.rate, date: parsed.date, timestamp: parsed.timestamp }
    }
  } catch {
    // sem cache ainda
  }
  return null
}

const saveCachedRate = (stateDir: string, rate: number): void => {
  const cache: RateCache = {
    rate,
    date: toDateKey(new Date()),
    timestamp: new Date().toISOString(),
  }
  try {
    writeFileSync(join(stateDir, RATE_FILE), JSON.stringify(cache, null, 2), "utf8")
  } catch {
    // cache best-effort
  }
}

const rateState = (cache: RateCache | null): RateState => {
  if (!cache) return "unavailable"
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (cache.date === toDateKey(now)) return "fresh"
  if (cache.date === toDateKey(yesterday)) return "stale_one_day"
  return "stale"
}

const fetchRate = async (): Promise<number | undefined> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(AWESOMEAPI_USD_BRL, { signal: controller.signal })
    if (!res.ok) return undefined
    const body = (await res.json()) as { USDBRL?: { bid?: string } }
    const parsed = typeof body?.USDBRL?.bid === "string" ? Number(body.USDBRL.bid) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

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

const formatBRLValue = (brl: number) => {
  const rounded = Math.round(brl * 100) / 100
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

const computeProjection = (monthBrl: number): string => {
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const completedDays = now.getDate() - 1
  const remaining = daysInMonth - now.getDate()

  if (completedDays <= 0) return ""
  if (monthBrl <= 0) return ""
  if (remaining <= 0) return ""

  const average = monthBrl / completedDays
  const prediction = monthBrl + average * remaining
  return formatBRLValue(prediction)
}

const tui: TuiPlugin = async (api, options) => {
  const hideNativeCost = options?.hideNativeCost === true
  const [dayCost, setDayCost] = createSignal<string>("R$ 0,00")
  const [weekCost, setWeekCost] = createSignal<string>("R$ 0,00")
  const [monthCost, setMonthCost] = createSignal<string>("R$ 0,00")
  const [monthProjection, setMonthProjection] = createSignal<string>("")
  const [sessionCost, setSessionCost] = createSignal<string>("R$ 0,00")
  const [saldo, setSaldo] = createSignal<SaldoState | undefined>(undefined)
  const [currentRate, setCurrentRate] = createSignal<number | null>(null)
  const [rateStatus, setRateStatus] = createSignal<RateState>("unavailable")

  const costs = new Map<string, { cost: number; created: number; updated: number; rate: number }>()
  const contributions = new Map<string, { brl: number; ts: number }[]>()

  const assess = (
    info:
      | {
          id: string
          cost?: number
          time?: { created?: number; updated?: number }
          model?: { providerID?: string }
        }
      | undefined,
  ) => {
    if (!info || typeof info.cost !== "number" || typeof info.time?.created !== "number") return
    const existing = costs.get(info.id)
    const prevCost = existing?.cost ?? 0
    const delta = info.cost - prevCost
    const rate = existing?.rate ?? currentRate() ?? RATE_FALLBACK
    const updated = typeof info.time?.updated === "number" ? info.time.updated : info.time.created
    costs.set(info.id, {
      cost: info.cost,
      created: info.time.created,
      updated,
      rate,
    })
    if (delta <= 0) return
    const list = contributions.get(info.id) ?? []
    list.push({ brl: delta * rate, ts: updated })
    contributions.set(info.id, list)
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
      const entry = costs.get(sessionID)
      setSessionCost(formatBRLValue(entry ? entry.cost * entry.rate : 0))
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

    for (const list of contributions.values()) {
      for (const { brl, ts } of list) {
        if (ts >= dayStart) day += brl
        if (ts >= weekStart) week += brl
        if (ts >= monthStart) month += brl
      }
    }
    setDayCost(formatBRLValue(day))
    setWeekCost(formatBRLValue(week))
    setMonthCost(formatBRLValue(month))
    setMonthProjection(computeProjection(month))

    const sessionID = currentSessionID()
    const entry = sessionID ? costs.get(sessionID) : undefined
    setSessionCost(formatBRLValue(entry ? entry.cost * entry.rate : 0))
    if (sessionID) void fetchSessionCost(sessionID)
  }

  const openRouterSaldo = (theme: TuiThemeCurrent) => {
    const current = saldo()
    if (!current || current.kind === "unavailable") return undefined
    const rate = currentRate() ?? RATE_FALLBACK
    return (
      <>
        <text fg={theme.accent}>  |  ◆ openrouter: </text>
        <text fg={theme.success}>{formatBRLValue(current.value * rate)}</text>
      </>
    )
  }

  const rateSegment = (theme: TuiThemeCurrent) => {
    const status = rateStatus()
    const rate = currentRate()
    const fg = status === "fresh" ? theme.textMuted : theme.warning
    const value = rate !== null ? formatBRLValue(rate) : "--"
    return (
      <>
        <text fg={fg}>◆ USD: </text>
        <text fg={fg}>{value}</text>
      </>
    )
  }

  const seed = async () => {
    try {
      const result = await api.client.experimental.session.list({ limit: 1000, directory: "" })
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

  const stateDir = api.state.path.state
  const cachedRate = loadCachedRate(stateDir)
  if (cachedRate) {
    const state = rateState(cachedRate)
    setRateStatus(state)
    if (state === "fresh" || state === "stale_one_day") setCurrentRate(cachedRate.rate)
  }

  refresh()
  void seed()
  void (async () => {
    const rate = await fetchRate()
    if (typeof rate === "number") {
      saveCachedRate(stateDir, rate)
      setCurrentRate(rate)
      setRateStatus("fresh")
      refresh()
    }
  })()
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
              <text fg={theme.success}>
                {formatBRLValue(current.value * (currentRate() ?? RATE_FALLBACK))}
              </text>
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
              {monthProjection() ? (
                <>
                  <text fg={theme.accent}> → </text>
                  <text fg={theme.accent}>{monthProjection()}</text>
                </>
              ) : null}
            </box>
            <box flexDirection="row">
              {rateSegment(theme)}
              <text fg={theme.textMuted}>  |  ◆ session: </text>
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