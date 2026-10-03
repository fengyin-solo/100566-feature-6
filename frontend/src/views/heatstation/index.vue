<template>
  <section class="page" data-module="heatstation">
    <header class="page-head">
      <div>
        <h2>换热站台账管理</h2>
        <p class="page-desc">换热站挂在哪个片区，就只有该片区值班人能改站名、供热面积与换热机组数；移交后整条转只读。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出换热站台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">运行中站点</span>
        <strong class="stat-value">{{ stats.running }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待投运站点</span>
        <strong class="stat-value">{{ stats.pending }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">累计供热面积（㎡）</span>
        <strong class="stat-value">{{ stats.totalArea.toLocaleString() }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">移交待办（停暖通知）</span>
        <strong class="stat-value">{{ stats.pendingNotices }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <p class="owner-hint">
      当前值班：{{ session.operator }}
      <template v-if="session.district">（归属{{ session.district }}）</template>
      <template v-else>（无归属片区，不能修改任何换热站）</template>
      ；经办月份 {{ session.month }}，站长按该月轮换口径显示。
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>归属</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</td>
          <td>
            <span v-if="String(row.status) === '已移交'" class="badge-readonly">已移交·只读</span>
            <span v-else-if="isOwner(row)" class="badge-owner">本片区可改</span>
            <span v-else class="badge-other">非本片区</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openEdit(row)">修改</button>
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
          <td :colspan="columns.length + 3" class="empty-state">暂无换热站台账数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条换热站台账记录</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>

    <div v-if="editing" class="modal-mask" @click.self="closeEdit">
      <div class="modal">
        <h3>修改换热站归属信息</h3>
        <p class="owner-hint">
          站名、供热面积、换热机组数仅{{ String(editing['所属片区']) }}值班人可改；
          所属片区、站长、投运日期按片区/月份口径固定展示，不在此修改。
        </p>

        <div class="form-row">
          <label>所属片区（沿用既有口径，不可改）</label>
          <input :value="String(editing['所属片区'])" readonly />
        </div>
        <div class="form-row">
          <label>站长（按 {{ session.month }} 轮换口径）</label>
          <input :value="editingManager" readonly />
        </div>
        <div class="form-row">
          <label>站名</label>
          <input v-model="form['站名']" :readonly="readOnlyForm" placeholder="请输入站名" />
        </div>
        <div class="form-row">
          <label>供热面积（㎡，须为大于 0 的数字）</label>
          <input v-model="form['供热面积']" :readonly="readOnlyForm" inputmode="decimal" placeholder="例如 186000" />
        </div>
        <div class="form-row">
          <label>换热机组数（正整数）</label>
          <input v-model="form['换热机组数']" :readonly="readOnlyForm" inputmode="numeric" placeholder="例如 4" />
        </div>
        <div class="form-row">
          <label>投运日期（首次投运由系统落定）</label>
          <input :value="String(editing['投运日期'] || '尚未投运')" readonly />
        </div>

        <p v-if="formError" class="error-text">{{ formError }}</p>

        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeEdit">关闭</button>
          <button class="btn primary" type="button" :disabled="readOnlyForm" @click="saveEdit">保存修改</button>
        </div>
      </div>
    </div>

    <div class="audit-box">
      <h3>操作记录（站长按月轮换，历史记录仍归当月经办人）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>经办月份</th>
            <th>换热站</th>
            <th>归属片区</th>
            <th>经办人</th>
            <th>动作</th>
            <th>结果</th>
            <th>明细</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in auditRows" :key="entry.id">
            <td>{{ entry.at }}</td>
            <td>{{ entry.month }}</td>
            <td>{{ entry.stationName }}</td>
            <td>{{ entry.district }}</td>
            <td>{{ entry.operator }}</td>
            <td>{{ entry.action }}</td>
            <td :class="entry.ok ? 'tag-ok' : 'tag-no'">{{ entry.ok ? '通过' : '已拒绝' }}</td>
            <td>{{ entry.detail }}</td>
          </tr>
          <tr v-if="!auditRows.length">
            <td colspan="8" class="empty-state">暂无操作记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  downloadEntries,
  heatStationStats,
  listHeatStations,
  listStationAudit,
  moduleMeta,
  runAction as applyAction,
  updateStationFields,
} from '@/api/local-service'
import { resolveManager } from '@/data/districts'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, StationAuditEntry } from '@/data/types'

const meta = moduleMeta('heatstation')
const session = useSessionStore()
const columns = ['站名', '所属片区', '供热面积', '换热机组数', '投运日期', '站长', '设计负荷', '站点状态']
const actions = ['提交投运', '登记停运', '办理移交']
const statuses = ['待投运', '运行中', '已停运', '已移交']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = ['站名', '所属片区', '供热面积']
const stats = ref(heatStationStats())
const auditRows = ref<StationAuditEntry[]>([])

const editing = ref<EntryRow | null>(null)
const form = reactive<{ 站名: string; 供热面积: string; 换热机组数: string }>({
  站名: '',
  供热面积: '',
  换热机组数: '',
})
const formError = ref('')

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const readOnlyForm = computed(() => editing.value !== null && String(editing.value.status) === '已移交')
const editingManager = computed(() =>
  editing.value ? resolveManager(String(editing.value['所属片区'] ?? ''), session.month) : '',
)

function isOwner(row: EntryRow): boolean {
  return session.district !== '' && session.district === String(row['所属片区'] ?? '')
}

function flash(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openEdit(row: EntryRow) {
  editing.value = row
  formError.value = ''
  form['站名'] = String(row['站名'] ?? '')
  form['供热面积'] = String(row['供热面积'] ?? '')
  form['换热机组数'] = String(row['换热机组数'] ?? '')
}

function closeEdit() {
  editing.value = null
  formError.value = ''
}

function saveEdit() {
  if (!editing.value) {
    return
  }
  formError.value = ''
  const result = updateStationFields(Number(editing.value.id), {
    站名: form['站名'],
    供热面积: form['供热面积'],
    换热机组数: form['换热机组数'],
  })
  if (!result.ok) {
    formError.value = result.message
    reload()
    return
  }
  closeEdit()
  reload()
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  flash(result.ok, result.message)
  reload()
}

function reload() {
  message.value = ''
  const payload = listHeatStations(filters.value)
  rows.value = payload.items
  total.value = payload.total
  stats.value = heatStationStats()
  auditRows.value = listStationAudit()
  if (editing.value) {
    const refreshed = rows.value.find((row) => Number(row.id) === Number(editing.value?.id))
    if (refreshed) {
      editing.value = refreshed
    }
  }
}

// 顶栏切换经办月份后，站长口径随之变化，无需重开页面。
watch(() => session.month, reload)

onMounted(reload)
</script>
