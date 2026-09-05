---
title: Indicador de saldo do OpenRouter na TUI
status: proposed
created: 2026-09-05
updated: 2026-09-05
owner: "@oporpino"
certainty: high
---

# Indicador de saldo do OpenRouter na TUI

> **TLDR**: o plugin `opencode-brl-cost` passa a exibir créditos restantes
> do OpenRouter (em R$, taxa fixa 5) na barra inferior e na tela inicial,
> usando a própria API do provedor — como piloto apenas para OpenRouter.

## Contexto

O custo por sessão (USD) já vem da API do OpenCode e é convertido com taxa
fixa. Não existe endpoint de saldo no SDK 1.18.29 (`api.client.app` só tem
`log` e `agents`). O OpenRouter expõe saldo/uso via `GET /api/v1/auth/key`,
e o plugin tem acesso à chave salva em `auth.json` local. Piloto: somente
provedor `openrouter`.

## Objetivos

- Exibir créditos restantes do OpenRouter em R$ (USD × 5, taxa fixa).
- Mostrar na tela inicial (`home_bottom`) e na barra de sessão (`app_bottom`).
- Não quebrar o plugin quando não houver chave OpenRouter.

## Fora de escopo

- Outros provedores (piloto é só OpenRouter).
- Taxa USD→BRL configurável.
- Exibir "uso do mês/dia" (escolha foi só créditos restantes).

## Mudanças

- `src/index.tsx`:
  - `import { readFileSync } from "node:fs"` e `join` de `node:path`.
  - Nova função `fetchSaldoOpenRouter()`: lê
    `${api.state.path.state}/auth.json` (campo `openrouter.key`), chama
    `GET https://openrouter.ai/api/v1/auth/key` (Bearer, timeout 15s via
    `AbortSignal.timeout`), atualiza signal `saldo: string | null`.
  - Lógica de exibição: sem chave → oculta; `limit_remaining` numérico →
    `formatBRL`; `limit` nulo → "sem limite" (muted); erro → null e tenta
    no próximo refresh.
  - Refresh no load + `setInterval` (~60s), limpo via `api.lifecycle.onDispose`.
  - Registrar slot `home_bottom` com `◆ openrouter: <saldo>` e adicionar o
    segmento de saldo ao bloco direito de `app_bottom`.
- Apenas renderiza quando o provider da sessão atual é `openrouter`.

## Como verificar

- `npm run build` + `npm run typecheck`.
- Manual: abrir opencode na home (ver saldo) e dentro de uma sessão
  OpenRouter (ver `◆ session` + `◆ openrouter`).
- Caso sem chave: nada novo aparece (comportamento atual).

## Documentação

Atualizar `README.md` (How it works + Roadmap).