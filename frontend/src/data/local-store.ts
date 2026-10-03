import { SEED_ROWS } from './seed'
import type { EntryRow, StationAuditEntry } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：换热站换成真实片区口径与数值字段，旧的占位种子作废，换键避免读到脏数据。
const STORAGE_KEY = 'district-heating:entries:v2'
const AUDIT_KEY = 'district-heating:station-audit:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 换热站操作记录单独存：它要长期保留，resetModule 重置台账也不能抹掉历史经办归属。
let auditCache: StationAuditEntry[] | null = null

function readAudit(): StationAuditEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(AUDIT_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StationAuditEntry[]) : []
  } catch {
    return []
  }
}

export function listAudit(): StationAuditEntry[] {
  if (auditCache === null) {
    auditCache = readAudit()
  }
  return auditCache
}

export function saveAudit(entries: StationAuditEntry[]): void {
  auditCache = entries
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(entries))
  }
}

export function nextAuditId(): number {
  return listAudit().reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0) + 1
}
