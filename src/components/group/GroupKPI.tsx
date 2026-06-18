import { Users, UserCheck, ClipboardList, Clock, AlertTriangle, Activity } from 'lucide-react'
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

export function GroupKPI({ kpi }: { kpi: GroupKpi }) {
  const risk = kpi.riskPct >= 40 ? 'text-red-600' : kpi.riskPct >= 15 ? 'text-orange-500' : 'text-green-600'
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Kpi icon={<Users size={13} />}        label="Учеников"    value={kpi.students}            tone="text-blue-500" />
      <Kpi icon={<UserCheck size={13} />}    label="Посещаем."   value={`${kpi.attendancePct}%`} tone="text-green-500" />
      <Kpi icon={<ClipboardList size={13} />}label="Сдача ДЗ"    value={`${kpi.submissionPct}%`} tone="text-indigo-500" />
      <Kpi icon={<Clock size={13} />}        label="На проверке" value={kpi.activeReviews}       tone="text-orange-500" />
      <Kpi icon={<AlertTriangle size={13} />}label="Просрочки"   value={kpi.overdue}             tone="text-red-500" />
      <Kpi icon={<Activity size={13} />}     label="Риск"        value={`${kpi.riskPct}%`}       tone={risk} />
    </div>
  )
}
