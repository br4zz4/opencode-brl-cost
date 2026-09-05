# opencode-brl-cost

OpenCode **TUI plugin** that pins cost tracking to the bottom bar, in Brazilian Reais (R$).

## How it works

- Renders a fixed status bar via the `app_bottom` TUI slot.
- Bottom-left shows **aggregated spend across ALL opencode sessions** (every project, not just the current one) since the start of today, this week (Monday), and this month.
- Bottom-right shows **the active session's total cost** (`session.cost`, USD).
- Costs come from each session's cumulative cost (`session.cost`, USD), attributed to the day it was **created**, converted with a **hardcoded rate of R$ 5,00 / US$ 1,00**.
- Sessions are enumerated via the SDK's global endpoint (`experimental.session.list`, with fallback to `session.list`) on load, and kept fresh through `session.*` events.
- Falls back to `R$ 0,00` when there's no data.
- Currency formatting uses `Intl.NumberFormat` with `pt-BR` (e.g. `R$ 1,23`).

Your session's cost is shown bottom-right (`◆ session`), the OpenRouter balance is
shown on the right of the bar, and the **native bar below the prompt** still shows the
USD price (tokens + `$cost`). With a plugin option you can replace that native bar with
a cost-free prompt that keeps the model name:

```json
{
  "plugin": [["opencode-brl-cost", { "hideNativeCost": true }]]
}
```

When `hideNativeCost` is enabled, the plugin registers the `session_prompt` slot
(`mode: "replace"`) and renders the prompt with the model name only — no USD price,
no tokens. Drop the option (or set `false`) to restore the native bar.

### OpenRouter balance (pilot)

- Reads the OpenRouter key from `<state>/auth.json` (field `openrouter.key`) and calls
  `GET https://openrouter.ai/api/v1/auth/key` on load, +2s, and every ~60s.
- On the **home** screen (`home_bottom`) and on the session bar (`app_bottom`), shows the
  remaining credits in BRL (`limit_remaining` × 5) — or `sem limite` when no limit is set on the key.
- No OpenRouter key found → nothing extra is rendered, plugin behaves as before.

## Install

Add the plugin to `tui.json`:

```json
{
  "plugin": ["opencode-brl-cost"]
}
```

Then **restart OpenCode**. The bottom bar appears at the bottom.

> Pin a version for stability: `"opencode-brl-cost@0.1.2"`.

## Why this shape

Per the `qwert:opencode-plugin` skill, OpenCode plugins must ship a **built `.js`** via npm with an
`exports["./tui"]` entrypoint. The runtime does **not** transpile `.tsx`/`.ts` from `node_modules` — it
fails silently. So this package publishes `dist/index.js` (esbuild output), never raw `.tsx`.

## Local development

```bash
npm install
npm run build      # → dist/index.js
npm run typecheck
```

To test a local checkout without publishing, point `tui.json` at the built file:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-brl-cost/dist/index.js"]
}
```

## Publish

```bash
npm version patch
npm publish
```

## Roadmap

- Configurable USD→BRL rate (instead of the hardcoded 5)
- Session cost delta per last response
- Token counters (input/output)
- Balance for providers other than OpenRouter (pilot only)

## License

AGPL-3.0 · Copyright (C) 2025 oporpino <dev@porpi.no>