// 片区值班名册：站长按月轮换。台账列表、停暖通知单等所有读口径都从这里取当月经办人，
// 保证两处读到的站长一致；轮换后历史单据上留存的仍是当月盖下去的经办人。
export const DUTY_ROSTER: Record<string, string[]> = {
  城东片区: ['王建国', '李秀兰', '张志强'],
  城西片区: ['赵永刚', '陈丽', '刘洋'],
  城北片区: ['孙明', '周敏', '吴海涛'],
}

// 名册外的片区沿用同一套轮换口径，只是用通用值班称呼兜底。
const FALLBACK_ROSTER = ['值班站长', '值班工程师', '值班员']

export function todayKey(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function currentMonthKey(now: Date = new Date()): string {
  return todayKey(now).slice(0, 7)
}

function monthIndex(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month) {
    return 0
  }
  return year * 12 + (month - 1)
}

// 某片区在某个月份的当班站长：按月轮换，同一个月份无论从哪里读都是同一个人。
export function dutyManagerFor(district: string, monthKey: string = currentMonthKey()): string {
  const roster = DUTY_ROSTER[district] ?? FALLBACK_ROSTER
  return roster[monthIndex(monthKey) % roster.length]
}
