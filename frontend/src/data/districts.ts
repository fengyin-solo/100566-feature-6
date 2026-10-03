// 片区口径：换热站归属、片区值班人、站长按月轮换都以这里为唯一来源。
// 台账列表与编辑弹窗读到的站长一律走 resolveManager，保证两处一致、沿用既有「所属片区」口径。

export interface DistrictIdentity {
  operator: string
  // 空串表示不属于任何片区（跨片区机动值班），提交任何片区的改动都应被挡下。
  district: string
  label: string
}

// 既有「所属片区」字段沿用的片区集合，不在这张表里的片区名一律视为无归属。
export const DISTRICTS = ['城东片区', '城西片区', '城南片区', '城北片区'] as const
export type DistrictName = (typeof DISTRICTS)[number]

// 每个片区的当班值班人：换热站挂在哪个片区，就只有这个人能改该站的归属字段。
export const DISTRICT_OFFICERS: Record<string, string> = {
  城东片区: '王东',
  城西片区: '李楠',
  城南片区: '赵敏',
  城北片区: '孙磊',
}

// 站长按月轮换：键为 YYYY-MM。轮换后当月在任是谁由月份决定，
// 历史操作记录里另存经办月份与经办人，不随轮换被改写。
const MANAGER_ROTATION: Record<string, Record<string, string>> = {
  '2026-09': {
    城东片区: '周建国',
    城西片区: '吴桂芳',
    城南片区: '郑海涛',
    城北片区: '冯秀兰',
  },
  '2026-10': {
    城东片区: '陈志远',
    城西片区: '林晚秋',
    城南片区: '黄立业',
    城北片区: '许文博',
  },
}

export const CALENDAR_MONTHS: string[] = Object.keys(MANAGER_ROTATION).sort()
export const CURRENT_MONTH = '2026-10'

// 按「片区 + 月份」推导在任站长。查不到当月时取最近一个已排月份兜底，绝不各写各的。
export function resolveManager(district: string, month: string): string {
  const exact = MANAGER_ROTATION[month]?.[district]
  if (exact) {
    return exact
  }
  const months = CALENDAR_MONTHS
  const past = [...months].reverse().find((item) => item <= month)
  const fallbackMonth = past ?? months[0]
  return (fallbackMonth && MANAGER_ROTATION[fallbackMonth]?.[district]) || '未安排站长'
}

export function districtOfficer(district: string): string {
  return DISTRICT_OFFICERS[district] ?? ''
}

// 可切换的值班身份：前四个是各片区值班人，最后一个模拟不属于任何片区的跨片区机动值班。
export const IDENTITIES: DistrictIdentity[] = [
  ...DISTRICTS.map((district) => ({
    operator: DISTRICT_OFFICERS[district],
    district,
    label: `${DISTRICT_OFFICERS[district]}（${district}值班）`,
  })),
  {
    operator: '周启航',
    district: '',
    label: '周启航（跨片区机动值班，无归属片区）',
  },
]
