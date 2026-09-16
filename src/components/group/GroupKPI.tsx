import { Users, UserCheck } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { GroupKpi } from '@/hooks/useGroupControl'

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col gap-1">
      <div className={cn('flex items-center gap-1.5 text-xs font-medium', tone)}>{icon}{label}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
    </div>
  )
}

/**
 * Четыре плитки по ДЗ («Сдача ДЗ», «На проверке», «Просрочки», «Риск») сняты
 * в §185: они считались по `homeworks`/`homework_submissions` — старому
 * контуру с 0 строк, — и всегда показывали 0 при живой очереди проверки.
 */
export function GroupKPI({ kpi }: { kpi: GroupKpi }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Kpi icon={<Users size={13} />}        label="Учеников"    value={kpi.students}            tone="text-blue-500" />
      <Kpi icon={<UserCheck size={13} />}    label="Посещаем."   value={`${kpi.attendancePct}%`} tone="text-green-500" />
    </div>
  )
}
