---
title: Projeção de gasto mensal
status: proposed
created: 2026-09-06
updated: 2026-09-06
owner: "@gporpino"
certainty: high
---

# Projeção de gasto mensal

> **TLDR**: exibir na barra `app_bottom`, ao lado do `mês`, uma projeção do gasto total estimado para o mês com base na média diária de dias já fechados.

## Contexto

Hoje o plugin exibe `mês: R$ X,XX` com o gasto acumulado no mês corrente. O usuário não tem visibilidade de quanto o mês deve fechar se o ritmo de gasto se mantiver.

A projeção usa a **média diária dos dias já fechados** (até ontem) e multiplica pelos dias restantes, somando ao valor já gasto.

## Objetivos

- Exibir projeção de gasto mensal inline no `app_bottom` no formato `mês: R$ X,XX → R$ Y,YY`
- Calcular média com base apenas em **dias fechados** (até ontem), evitando distorção do dia corrente incompleto
- Usar `daysInMonth` dinâmico (28/29/30/31 dias conforme o mês)
- Não exibir projeção quando não há dados suficientes (dia 1 do mês ou custo zero)

## Fora de escopo

- Projeção para dia, semana ou qualquer outro período
- Gráficos, histórico ou tendências
- Exibição no `home_bottom`
- Métricas de "orçamento restante" ou alertas de estouro

## Mudanças

### `src/index.tsx`

1. **Novo signal `monthProjection`** (`string`) — valor formatado da projeção (ex: `"R$ 52,30"`) ou string vazia quando não exibir.

2. **Nova função `computeProjection(monthBrl: number): string`** — pura, recebe o custo bruto do mês em BRL e retorna a projeção formatada ou `""`. Lógica:

   ```
   const now = new Date()
   const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
   const completedDays = now.getDate() - 1       // dias fechados (até ontem)
   const remaining = daysInMonth - now.getDate()  // dias ainda não iniciados

   if (completedDays <= 0) return ""              // dia 1: sem dados
   if (monthBrl <= 0) return ""                   // sem custo no mês
   if (remaining <= 0) return ""                  // último dia: sem dias restantes

   const average = monthBrl / completedDays
   const prediction = monthBrl + average * remaining
   return formatBRLValue(prediction)
   ```

3. **`refresh()`** — a variável local `month` (número bruto, antes da chamada `formatBRLValue(month)`) é usada para alimentar `setMonthProjection(computeProjection(month))` logo após `setMonthCost(formatBRLValue(month))`.

4. **`app_bottom` slot** — inserir a projeção após `monthCost()`:
   ```tsx
   {monthProjection() && (
     <>
       <text fg={theme.accent}> → </text>
       <text fg={theme.accent}>{monthProjection()}</text>
     </>
   )}
   ```

### Nenhum novo arquivo

## Como verificar

1. **Dia 1 do mês**: abrir plugin em dia 1 → barra mostra `mês: R$ X,XX` sem seta nem projeção
2. **Dia 2+**: após algumas sessões no mês → barra mostra `mês: R$ 15,00 → R$ 225,00` com a seta e projeção em cor `accent`
3. **Último dia**: no dia 30/31 (ou 28/29) → sem projeção (apenas valor real)
4. **Custo zero**: mês sem gastos → sem projeção (apenas `R$ 0,00` sem seta)
5. **Fevereiro**: rodar em fevereiro para confirmar que usa 28 ou 29 dias conforme o ano
6. **Atualização em tempo real**: criar uma nova sessão → valor atualizado e projeção recalculada

## Documentação

- Atualizar `README.md` mencionando a nova funcionalidade de projeção
- Nenhum arquivo novo em `.project/docs/`