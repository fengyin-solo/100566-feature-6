import { MODULE_BY_KEY } from '@/data/modules'
import { DUTY_ROSTER, dutyManagerFor, todayKey } from '@/data/duty'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OperatorContext, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 换热站底账的归属规则：只有这三个字段允许值班人改，其余字段（投运日期、站长、所属片区等）
// 一律不许经手；移交之后整条只读。
const HEATSTATION_KEY = 'heatstation'
const STATION_EDITABLE_FIELDS = ['站名', '供热面积', '换热机组数']
const STATION_READONLY_STATUS = '已移交'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 读路径统一派生：换热站的「站长」不存死值，按所属片区从值班名册取当月轮换结果，
// 列表、筛选、导出看到的都是同一个人。
function withDerivedFields(key: string, rows: EntryRow[]): EntryRow[] {
  if (key !== HEATSTATION_KEY) {
    return rows
  }
  return rows.map((row) => ({ ...row, 站长: dutyManagerFor(String(row['所属片区'] ?? '')) }))
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
  const matched = filterRows(withDerivedFields(key, listRows(key)), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 值班片区下拉口径：名册里的片区加上台账里已挂出的片区，不另起一套片区叫法。
export function listDistricts(): string[] {
  const fromRows = listRows(HEATSTATION_KEY)
    .map((row) => String(row['所属片区'] ?? '').trim())
    .filter((name) => name !== '')
  return [...new Set([...Object.keys(DUTY_ROSTER), ...fromRows])]
}

export function runAction(key: string, id: number, action: string): ActionResult {
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
  if (key === HEATSTATION_KEY && current === STATION_READONLY_STATUS) {
    return { ok: false, message: `换热站已移交，整条记录只读，「${action}」办不了` }
  }
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  let note = ''
  if (key === HEATSTATION_KEY) {
    // 投运日期不由人填，提交投运时由系统盖章，免得填错了只能翻操作记录。
    if (action === '提交投运') {
      updated['投运日期'] = todayKey()
    }
    note = appendHandlingNotice(updated, action)
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${note}` }
}

// 换热站每办结一个动作，就把办理结果挂到停暖通知的待办理清单；同一座站同一个动作
// 只留一条（比如重复提交投运报送），清单里已有就不再重复登记。
function appendHandlingNotice(station: EntryRow, action: string): string {
  const notices = listRows('heatnotice')
  const stationId = Number(station.id)
  const duplicated = notices.some(
    (notice) => Number(notice['来源换热站ID']) === stationId && notice['来源动作'] === action,
  )
  if (duplicated) {
    return '，停暖通知待办理清单里已有这条报送，未重复登记'
  }
  const district = String(station['所属片区'] ?? '')
  const noticeMeta = moduleMeta('heatnotice')
  const nextId = notices.reduce((max, notice) => Math.max(max, Number(notice.id) || 0), 0) + 1
  const notice: EntryRow = {
    id: nextId,
    status: noticeMeta.statuses[0],
    pending: true,
    abnormal: false,
    通知编号: nextNoticeCode(notices),
    影响片区: district,
    停暖原因: `换热站「${String(station['站名'] ?? '')}」${action}`,
    计划开始: todayKey(),
    计划恢复: '',
    通知方式: '平台待办',
    发布人: dutyManagerFor(district),
    通知状态: noticeMeta.statuses[0],
    来源换热站ID: stationId,
    来源动作: action,
  }
  saveRows('heatnotice', [...notices, notice])
  return '，办理结果已落到停暖通知待办理清单'
}

function nextNoticeCode(notices: EntryRow[]): string {
  const maxCode = notices.reduce((max, notice) => {
    const match = /^HEAT-(\d+)$/.exec(String(notice['通知编号'] ?? ''))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `HEAT-${String(maxCode + 1).padStart(4, '0')}`
}

// 换热站底账修改入口：先查归属再落笔。
// 1) 已移交的整条只读；2) 只放行站名、供热面积、换热机组数，改别的字段算越权；
// 3) 换热站挂在哪个片区，就只有该片区值班人能改，别处提交的一律挡下并说明原因；
// 4) 供热面积填成无效值的挡回。
export function updateHeatStation(
  id: number,
  changes: Record<string, string>,
  operator: OperatorContext,
): ActionResult {
  const meta = moduleMeta(HEATSTATION_KEY)
  const rows = listRows(HEATSTATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  if (String(row.status) === STATION_READONLY_STATUS) {
    return { ok: false, message: '换热站已移交，整条记录只读，谁都改不动' }
  }
  const keys = Object.keys(changes)
  const overreach = keys.filter((field) => !STATION_EDITABLE_FIELDS.includes(field))
  if (overreach.length > 0) {
    return {
      ok: false,
      message: `底账只允许改站名、供热面积与换热机组数，对「${overreach.join('、')}」的改动越权，已拒绝`,
    }
  }
  if (keys.length === 0) {
    return { ok: false, message: '没有提交任何改动' }
  }
  const district = String(row['所属片区'] ?? '')
  if (operator.district !== district) {
    return {
      ok: false,
      message: `该换热站挂在「${district}」，只有本片区值班人能改底账；当前值班片区是「${operator.district || '未登记'}」，已挡下`,
    }
  }
  const patch: Record<string, string> = {}
  for (const field of keys) {
    patch[field] = String(changes[field]).trim()
  }
  if ('供热面积' in patch) {
    const area = Number(patch['供热面积'])
    if (patch['供热面积'] === '' || !Number.isFinite(area) || area <= 0) {
      return { ok: false, message: `供热面积「${changes['供热面积']}」不是有效值，已挡回：请填大于 0 的数字` }
    }
  }
  const next = [...rows]
  next[index] = { ...row, ...patch }
  saveRows(HEATSTATION_KEY, next)
  return { ok: true, message: `${meta.entity}底账已更新：${keys.join('、')}` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of withDerivedFields(key, listRows(key))) {
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
