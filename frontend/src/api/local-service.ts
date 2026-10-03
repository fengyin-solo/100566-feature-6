import { resolveManager } from '@/data/districts'
import { MODULE_BY_KEY } from '@/data/modules'
import {
  listAudit,
  listRows,
  nextAuditId,
  resetRows,
  saveAudit,
  saveRows,
  allRows,
} from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  StationAuditEntry,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 换热站归属字段：只有这三项受片区归属保护，其余字段（设计负荷等）不在本次收口范围。
const HEATSTATION_KEY = 'heatstation'
const HEATNOTICE_KEY = 'heatnotice'
const STATION_OWNED_FIELDS = ['站名', '供热面积', '换热机组数'] as const
const STATION_ACTION_TARGETS: Record<string, string> = {
  提交投运: '运行中',
  登记停运: '已停运',
  办理移交: '已移交',
}
const STATION_FINAL_STATUS = '已移交'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  // 换热站有归属/只读/去重等专属约束，任何入口都走同一套校验，页面绕不过去。
  if (key === HEATSTATION_KEY) {
    return runStationAction(id, action)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  // 「已办结」是移交待办的收口态，不在各模块状态轴里，但同样不该再计入待处理。
  const terminalExtra = target === '已办结'
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus && !terminalExtra,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  const month = useSessionStore().month
  for (const rawRow of listRows(key)) {
    // 换热站导出的站长同样按片区月份口径推导，和台账列表、编辑弹窗保持一致。
    const row = key === HEATSTATION_KEY ? stationManagerView(rawRow, month) : rawRow
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---------------------------------------------------------------------------
// 换热站归属收口
// ---------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function todayStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function nowStr(): string {
  const now = new Date()
  return `${todayStr()} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// 站长统一口径：台账列表、编辑弹窗、导出都从这里推导，禁止任何页面各自填一个站长。
function stationManagerView(row: EntryRow, month: string): EntryRow {
  return { ...row, 站长: resolveManager(String(row['所属片区'] ?? ''), month) }
}

export function listHeatStations(filters: Record<string, string> = {}): PageResult {
  const month = useSessionStore().month
  const matched = filterRows(listRows(HEATSTATION_KEY), filters).map((row) =>
    stationManagerView(row, month),
  )
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export type HeatStationStats = {
  running: number
  pending: number
  totalArea: number
  pendingNotices: number
}

export function heatStationStats(): HeatStationStats {
  const stations = listRows(HEATSTATION_KEY)
  const notices = listRows(HEATNOTICE_KEY)
  const totalArea = stations.reduce((sum, row) => {
    const area = Number(row['供热面积'])
    return sum + (Number.isFinite(area) && area > 0 ? area : 0)
  }, 0)
  return {
    running: stations.filter((row) => String(row.status) === '运行中').length,
    pending: stations.filter((row) => String(row.status) === '待投运').length,
    totalArea,
    pendingNotices: notices.filter((row) => String(row.status) === '待办理').length,
  }
}

export function listStationAudit(stationId?: number): StationAuditEntry[] {
  const entries = listAudit().filter((entry) => stationId === undefined || entry.stationId === stationId)
  return entries.sort((a, b) => (a.id < b.id ? 1 : -1))
}

function recordStationAudit(entry: Omit<StationAuditEntry, 'id'>): void {
  const entries = [...listAudit(), { ...entry, id: nextAuditId() }]
  saveAudit(entries)
}

function findStation(id: number): { rows: EntryRow[]; index: number; row: EntryRow } | null {
  const rows = listRows(HEATSTATION_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return null
  }
  return { rows, index, row: rows[index] }
}

// 归属校验：站挂在哪个片区，就只有该片区值班人能动；无归属片区的身份一律挡下。
function assertOwner(row: EntryRow): ActionResult | null {
  const session = useSessionStore()
  const district = String(row['所属片区'] ?? '')
  if (!session.district || session.district !== district) {
    return {
      ok: false,
      message:
        `越权拦截：${String(row['站名'])}归属「${district}」，仅该片区值班人可改；` +
        `当前值班「${session.operator}」${session.district ? `归属「${session.district}」` : '不属于任何片区'}，已拒绝本次提交。`,
    }
  }
  return null
}

function isTransferred(row: EntryRow): boolean {
  return String(row.status) === STATION_FINAL_STATUS
}

function parsePositiveNumber(raw: unknown, label: string, integer = false): number | string {
  const value = Number(raw)
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(value)) {
    return `${label}必须是${integer ? '正整数' : '大于 0 的数字'}，请填有效数值`
  }
  if (integer && !Number.isInteger(value)) {
    return `${label}必须是正整数，不能填小数`
  }
  if (value <= 0) {
    return `${label}必须大于 0，「${String(raw)}」无效`
  }
  return value
}

// 修改站名 / 供热面积 / 换热机组数：归属 + 只读 + 无效值三重校验。
export function updateStationFields(
  id: number,
  patch: Record<string, unknown>,
): ActionResult {
  const session = useSessionStore()
  const illegalKeys = Object.keys(patch).filter((key) => !(STATION_OWNED_FIELDS as readonly string[]).includes(key))
  if (illegalKeys.length > 0) {
    return { ok: false, message: `越权拦截：${illegalKeys.join('、')}不属于可由值班人修改的归属字段，已拒绝` }
  }

  const found = findStation(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的换热站` }
  }
  const { rows, index, row } = found
  const district = String(row['所属片区'] ?? '')

  if (isTransferred(row)) {
    const result: ActionResult = {
      ok: false,
      message: `「${String(row['站名'])}」已移交，整条记录已转只读，任何片区值班人都不能再改`,
    }
    recordStationAudit({
      stationId: id,
      stationName: String(row['站名'] ?? ''),
      district,
      month: session.month,
      operator: session.operator,
      action: '修改归属字段',
      detail: result.message,
      ok: false,
      at: nowStr(),
    })
    return result
  }

  const denied = assertOwner(row)
  if (denied) {
    const attempted = STATION_OWNED_FIELDS.filter((key) => key in patch).join('、') || '归属字段'
    recordStationAudit({
      stationId: id,
      stationName: String(row['站名'] ?? ''),
      district,
      month: session.month,
      operator: session.operator,
      action: '修改归属字段',
      detail: `试图修改${attempted}，${denied.message}`,
      ok: false,
      at: nowStr(),
    })
    return denied
  }

  const next: EntryRow = { ...row }
  const changes: string[] = []

  if ('站名' in patch) {
    const name = String(patch['站名'] ?? '').trim()
    if (!name) {
      return { ok: false, message: '站名不能为空，请填写有效站名' }
    }
    if (name !== String(row['站名'] ?? '')) {
      changes.push(`站名「${String(row['站名'] ?? '')}」→「${name}」`)
      next['站名'] = name
    }
  }
  if ('供热面积' in patch) {
    const parsed = parsePositiveNumber(patch['供热面积'], '供热面积（㎡）')
    if (typeof parsed === 'string') {
      return { ok: false, message: parsed }
    }
    if (parsed !== Number(row['供热面积'])) {
      changes.push(`供热面积 ${String(row['供热面积'] ?? '空')}㎡ → ${parsed}㎡`)
      next['供热面积'] = parsed
    }
  }
  if ('换热机组数' in patch) {
    const parsed = parsePositiveNumber(patch['换热机组数'], '换热机组数', true)
    if (typeof parsed === 'string') {
      return { ok: false, message: parsed }
    }
    if (parsed !== Number(row['换热机组数'])) {
      changes.push(`换热机组数 ${String(row['换热机组数'] ?? '空')} → ${parsed}`)
      next['换热机组数'] = parsed
    }
  }

  if (changes.length === 0) {
    return { ok: false, message: '内容没有变化，无需保存' }
  }

  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(HEATSTATION_KEY, nextRows)
  recordStationAudit({
    stationId: id,
    stationName: String(next['站名'] ?? ''),
    district,
    month: session.month,
    operator: session.operator,
    action: '修改归属字段',
    detail: changes.join('；'),
    ok: true,
    at: nowStr(),
  })
  return { ok: true, message: `已保存：${changes.join('；')}` }
}

// 换热站状态流转：移交即只读；投运报送同一站点只认一次。
export function runStationAction(id: number, action: string): ActionResult {
  const session = useSessionStore()
  const target = STATION_ACTION_TARGETS[action]
  if (!target) {
    return { ok: false, message: `换热站没有登记「${action}」这个动作` }
  }
  const found = findStation(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的换热站` }
  }
  const { rows, index, row } = found
  const district = String(row['所属片区'] ?? '')
  const stationName = String(row['站名'] ?? '')
  const current = String(row.status)

  const deny = (message: string): ActionResult => {
    recordStationAudit({
      stationId: id,
      stationName,
      district,
      month: session.month,
      operator: session.operator,
      action,
      detail: message,
      ok: false,
      at: nowStr(),
    })
    return { ok: false, message }
  }

  if (isTransferred(row)) {
    return deny(`「${stationName}」已移交，整条记录已转只读，任何片区值班人都不能再操作`)
  }

  const ownerDenied = assertOwner(row)
  if (ownerDenied) {
    return deny(ownerDenied.message)
  }

  if (current === target) {
    return deny(`「${stationName}」已经是「${target}」，${action === '提交投运' ? '重复提交投运报送只留一条，不再受理' : '不用重复操作'}`)
  }

  // 状态只能按业务顺序走，禁止跨状态硬跳（也顺带兜住重复投运）。
  if (action === '提交投运' && current !== '待投运') {
    return deny(
      current === '已停运'
        ? `「${stationName}」已停运，不能再次提交投运报送；投运报送每站只留一条`
        : `「${stationName}」当前为「${current}」，投运报送只能在待投运时提交一次`,
    )
  }
  if (action === '登记停运' && current !== '运行中') {
    return deny(`「${stationName}」当前为「${current}」，只有运行中的站点才能登记停运`)
  }
  if (action === '办理移交' && current === '待投运') {
    return deny(`「${stationName}」尚未投运，没有可移交的运行资产`)
  }

  const next: EntryRow = {
    ...row,
    status: target,
    pending: target !== STATION_FINAL_STATUS,
    abnormal: false,
  }
  // 投运日期由系统在首次投运时落死，不靠手填，填错也无从发生。
  if (action === '提交投运' && !String(next['投运日期'] ?? '').trim()) {
    next['投运日期'] = todayStr()
  }
  next['站点状态'] = target

  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(HEATSTATION_KEY, nextRows)

  let extra = ''
  if (action === '办理移交') {
    extra = createHandoverNotice(next, session.operator)
  }

  recordStationAudit({
    stationId: id,
    stationName: String(next['站名'] ?? ''),
    district,
    month: session.month,
    operator: session.operator,
    action,
    detail: `状态「${current}」→「${target}」`,
    ok: true,
    at: nowStr(),
  })
  return { ok: true, message: `换热站已${action}，当前状态「${target}」${extra}` }
}

// 移交办理结果落到停暖通知的待办理清单：一座站只生成一条，重复移交（已被只读拦截）不会再落单。
function createHandoverNotice(station: EntryRow, operator: string): string {
  const notices = listRows(HEATNOTICE_KEY)
  const stationId = Number(station.id)
  const district = String(station['所属片区'] ?? '')
  if (notices.some((item) => Number(item['来源换热站']) === stationId)) {
    return ''
  }
  const nextId = notices.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const month = todayStr().slice(0, 7)
  const notice: EntryRow = {
    id: nextId,
    status: '待办理',
    pending: true,
    abnormal: false,
    通知编号: `HN-${month.replace('-', '')}-${String(nextId).padStart(4, '0')}`,
    影响片区: district,
    停暖原因: `换热站移交：${String(station['站名'] ?? '')}（编号 ${stationId}）已办理移交，台账整条转只读，请跟进停暖相关手续`,
    计划开始: '',
    计划恢复: '',
    通知方式: '系统流转',
    发布人: operator,
    通知状态: '待办理',
    来源换热站: stationId,
  }
  saveRows(HEATNOTICE_KEY, [...notices, notice])
  return '；已在停暖通知待办理清单生成一条'
}
