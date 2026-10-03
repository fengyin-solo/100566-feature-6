import { defineStore } from 'pinia'

import { CURRENT_MONTH, IDENTITIES } from '@/data/districts'

// 会话：当前值班人及其所属片区、当前经办月份。
// 归属校验在数据服务里读这份身份；切换身份只是为了模拟不同片区值班人提交。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: IDENTITIES[0].operator,
    district: IDENTITIES[0].district,
    month: CURRENT_MONTH,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市集中供热管网与换热站运行管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setIdentity(operator: string) {
      const found = IDENTITIES.find((item) => item.operator === operator)
      if (!found) {
        return
      }
      this.operator = found.operator
      this.district = found.district
    },
    setMonth(month: string) {
      this.month = month
    },
  },
})
