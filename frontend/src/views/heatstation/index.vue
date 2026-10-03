<template>
  <section class="page" data-module="heatstation">
    <header class="page-head">
      <div>
        <h2>换热站台账管理</h2>
        <p class="page-desc">维护换热站，围绕站名、所属片区、供热面积、换热机组数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记换热站</button>
        <button class="btn" type="button" @click="exportRows">导出换热站台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>值班片区（决定底账修改权）</span>
        <select :value="session.district" @change="onDistrictChange">
          <option v-for="district in districtOptions" :key="district" :value="district">
            {{ district }}
          </option>
        </select>
      </label>
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <form v-if="editingRow" class="edit-bar" @submit.prevent="saveEdit">
      <span class="edit-title">
        编辑底账：{{ editingRow['站名'] }}（{{ editingRow['所属片区'] }} · 当月站长 {{ editingRow['站长'] }}）
      </span>
      <label class="filter-item">
        <span>站名</span>
        <input v-model="editForm['站名']" />
      </label>
      <label class="filter-item">
        <span>供热面积</span>
        <input v-model="editForm['供热面积']" placeholder="大于 0 的数字" />
      </label>
      <label class="filter-item">
        <span>换热机组数</span>
        <input v-model="editForm['换热机组数']" />
      </label>
      <button class="btn primary" type="submit">保存底账</button>
      <button class="btn ghost" type="button" @click="cancelEdit">取消</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openEdit(row)">编辑底账</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无换热站台账数据，可先登记换热站</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条换热站台账记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listDistricts,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  updateHeatStation,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('heatstation')
const columns = ["站名", "所属片区", "供热面积", "换热机组数", "投运日期", "站长", "设计负荷", "站点状态"]
const actions = ["提交投运", "登记停运", "办理移交"]
const statuses = ["待投运", "运行中", "已停运", "已移交"]
const stats = [{"label": "运行中站点", "value": 0}, {"label": "待投运站点", "value": 0}, {"label": "累计供热面积", "value": 0}]
const editableFields = ["站名", "供热面积", "换热机组数"]

const session = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const districtOptions = ref<string[]>([])
const editingId = ref<number | null>(null)
const editForm = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const editingRow = computed(() =>
  rows.value.find((row) => Number(row.id) === editingId.value) ?? null,
)

function onDistrictChange(event: Event) {
  session.setDistrict((event.target as HTMLSelectElement).value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '换热站登记入口尚未接入审批流'
}

function openEdit(row: EntryRow) {
  editingId.value = Number(row.id)
  editForm.value = Object.fromEntries(
    editableFields.map((field) => [field, String(row[field] ?? '')]),
  )
  errorMessage.value = ''
  noticeMessage.value = ''
}

function cancelEdit() {
  editingId.value = null
}

function saveEdit() {
  if (editingId.value === null) {
    return
  }
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = updateHeatStation(editingId.value, { ...editForm.value }, {
    operator: session.operator,
    district: session.district,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  editingId.value = null
  noticeMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    districtOptions.value = listDistricts()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '换热站台账列表读取失败'
  }
}

onMounted(reload)
</script>
