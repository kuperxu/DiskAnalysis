// Min-heap priority queue. Lower priority value pops first.
// We expose a `reprioritize` method that walks the heap and rebuilds — this is
// O(n) but n is bounded by "directories pending in the current scan",
// typically < 100k, called only on user click.

export interface Heaped<T> {
  value: T
  priority: number
}

export class PriorityQueue<T> {
  private heap: Heaped<T>[] = []

  get size(): number {
    return this.heap.length
  }

  push(value: T, priority: number): void {
    this.heap.push({ value, priority })
    this.bubbleUp(this.heap.length - 1)
  }

  pop(): T | undefined {
    const n = this.heap.length
    if (n === 0) return undefined
    const top = this.heap[0]
    const last = this.heap.pop()!
    if (n > 1) {
      this.heap[0] = last
      this.bubbleDown(0)
    }
    return top.value
  }

  /** Rebuild priorities from a callback. Returns count of changed entries. */
  reprioritize(fn: (v: T, currentPriority: number) => number): number {
    let changed = 0
    for (const h of this.heap) {
      const np = fn(h.value, h.priority)
      if (np !== h.priority) {
        h.priority = np
        changed++
      }
    }
    if (changed > 0) this.heapify()
    return changed
  }

  /** Drop entries matching predicate. */
  drop(fn: (v: T) => boolean): number {
    const before = this.heap.length
    this.heap = this.heap.filter((h) => !fn(h.value))
    if (this.heap.length !== before) this.heapify()
    return before - this.heap.length
  }

  clear(): void {
    this.heap = []
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.heap[i].priority < this.heap[parent].priority) {
        ;[this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]]
        i = parent
      } else break
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length
    for (;;) {
      const l = i * 2 + 1
      const r = i * 2 + 2
      let smallest = i
      if (l < n && this.heap[l].priority < this.heap[smallest].priority) smallest = l
      if (r < n && this.heap[r].priority < this.heap[smallest].priority) smallest = r
      if (smallest === i) break
      ;[this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]]
      i = smallest
    }
  }

  private heapify(): void {
    for (let i = (this.heap.length >> 1) - 1; i >= 0; i--) this.bubbleDown(i)
  }
}
