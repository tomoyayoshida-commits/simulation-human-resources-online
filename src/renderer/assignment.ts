// 設計書§5.3: 内側の人員割当（最小費用流 / successive shortest path）
//
// ポテンシャル（Johnson法）＋Dijkstra による多項式時間の厳密解法。
// 初期グラフに負コスト辺（社員→事業部 = -value）を含むため、最初に一度だけ
// Bellman-Ford でポテンシャルを初期化し、以降は非負の被約コスト上で Dijkstra を回す。
//
// 価値 value(i,X) は連続値（浮動小数）のため、有効ポテンシャル下でも被約コストが
// 丸め誤差で僅かに負になりうる。これを 0 にクランプすることで Dijkstra の非負性を保ち、
// 増加路の親ポインタが循環して停止しなくなる不具合を防ぐ（本来の被約コストは非負のため、
// クランプは FP 誤差のみを吸収し最適性への影響は無視できる）。フローは1増加路ごとに
// 必ず増え、最大フロー(=N)で停止する。

import type { AllocationCounts, Employee, UnitId } from './types.ts'
import { UNIT_IDS } from './constants.ts'

interface Edge {
  to: number
  cap: number
  cost: number
  flow: number
  rev: number
}

class MinCostFlow {
  private adj: Edge[][]

  constructor(n: number) {
    this.adj = Array.from({ length: n }, () => [])
  }

  addEdge(from: number, to: number, cap: number, cost: number): void {
    const forward: Edge = { to, cap, cost, flow: 0, rev: this.adj[to].length }
    const backward: Edge = { to: from, cap: 0, cost: -cost, flow: 0, rev: this.adj[from].length }
    this.adj[from].push(forward)
    this.adj[to].push(backward)
  }

  /** Bellman-Ford でポテンシャル h[] を初期化（初期の負辺に対応） */
  private initPotential(source: number, h: number[]): void {
    const n = this.adj.length
    h.fill(Infinity)
    h[source] = 0
    for (let iter = 0; iter < n; iter++) {
      let updated = false
      for (let v = 0; v < n; v++) {
        if (h[v] === Infinity) continue
        for (const e of this.adj[v]) {
          if (e.cap - e.flow > 0 && h[v] + e.cost < h[e.to]) {
            h[e.to] = h[v] + e.cost
            updated = true
          }
        }
      }
      if (!updated) break
    }
    for (let v = 0; v < n; v++) if (h[v] === Infinity) h[v] = 0
  }

  run(source: number, sink: number): void {
    const n = this.adj.length
    const h = new Array<number>(n).fill(0)
    this.initPotential(source, h)

    const dist = new Array<number>(n)
    const prevV = new Array<number>(n)
    const prevE = new Array<number>(n)
    const done = new Array<boolean>(n)

    for (;;) {
      dist.fill(Infinity)
      done.fill(false)
      dist[source] = 0

      // O(V^2) Dijkstra（V が小さいため十分高速）
      for (;;) {
        let u = -1
        let best = Infinity
        for (let i = 0; i < n; i++) {
          if (!done[i] && dist[i] < best) {
            best = dist[i]
            u = i
          }
        }
        if (u === -1) break
        done[u] = true
        const du = dist[u]
        const hu = h[u]
        const edges = this.adj[u]
        for (let i = 0; i < edges.length; i++) {
          const e = edges[i]
          if (e.cap - e.flow <= 0) continue
          let reduced = e.cost + hu - h[e.to]
          if (reduced < 0) reduced = 0 // FP 誤差による僅かな負値を吸収
          const nd = du + reduced
          if (nd < dist[e.to]) {
            dist[e.to] = nd
            prevV[e.to] = u
            prevE[e.to] = i
          }
        }
      }

      if (dist[sink] === Infinity) break

      // ポテンシャル更新
      for (let v = 0; v < n; v++) {
        if (dist[v] < Infinity) h[v] += dist[v]
      }

      // 最短路に沿って流す（本問題では常に 1 単位）
      let addFlow = Infinity
      for (let v = sink; v !== source; v = prevV[v]) {
        const e = this.adj[prevV[v]][prevE[v]]
        const residual = e.cap - e.flow
        if (residual < addFlow) addFlow = residual
      }
      for (let v = sink; v !== source; v = prevV[v]) {
        const e = this.adj[prevV[v]][prevE[v]]
        e.flow += addFlow
        this.adj[v][e.rev].flow -= addFlow
      }
    }
  }

  flowBetween(from: number, to: number): number {
    for (const e of this.adj[from]) {
      if (e.to === to && e.cap > 0) return e.flow
    }
    return 0
  }
}

/**
 * 人員割当（設計書§5.3）。
 * value(i,X) の合計を最大化する割当を、符号反転した最小費用流として厳密に解く。
 *
 * ノード構成:
 *   source(0) → 社員ノード(1..N) → 事業部ノード(N+1..N+3) → sink(N+4)
 * 決定性: 社員を入力順、事業部を A→B→C の順で辺を張り、strict-less 更新で
 *   経路選択を安定化する（§5.3のタイブレーク方針）。
 */
export function solveAssignment(
  employees: Employee[],
  values: Record<string, Record<UnitId, number>>,
  counts: AllocationCounts,
): Record<string, UnitId> {
  const n = employees.length
  const source = 0
  const empBase = 1
  const unitBase = 1 + n
  const sink = unitBase + 3
  const mcmf = new MinCostFlow(sink + 1)

  for (let i = 0; i < n; i++) {
    mcmf.addEdge(source, empBase + i, 1, 0)
  }
  for (let i = 0; i < n; i++) {
    const v = values[employees[i].id]
    for (let u = 0; u < UNIT_IDS.length; u++) {
      mcmf.addEdge(empBase + i, unitBase + u, 1, -v[UNIT_IDS[u]])
    }
  }
  for (let u = 0; u < UNIT_IDS.length; u++) {
    mcmf.addEdge(unitBase + u, sink, counts[UNIT_IDS[u]], 0)
  }

  mcmf.run(source, sink)

  const assignment: Record<string, UnitId> = {}
  for (let i = 0; i < n; i++) {
    for (let u = 0; u < UNIT_IDS.length; u++) {
      if (mcmf.flowBetween(empBase + i, unitBase + u) > 0) {
        assignment[employees[i].id] = UNIT_IDS[u]
        break
      }
    }
  }
  return assignment
}
