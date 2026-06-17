import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Check, X, Clock, ChevronDown, ChevronUp, Loader2, BarChart2, Download } from 'lucide-react'
import { useAttendanceReport, type GroupReport, type AttendanceRow } from '@/hooks/useAttendanceReport'
import { StudentAttendanceModal } from '@/components/modals/StudentAttendanceModal'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { exportAttendance } from '@/utils/exportExcel'

function PercentBar({ value }: { value: number }) {
  const color =
    value >= 80 ? 'bg-green-500' :
    value >= 60 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${value}%` }} />
      </div>
      <span className={cn(
        'text-xs font-semibold w-9 text-right',
        value >= 80 ? 'text-green-600' : value >= 60 ? 'text-yellow-600' : 'text-red-500'
      )}>{value}%</span>
    </div>
  )
}

function GroupCard({ group, onStudentClick }: { group: GroupReport; onStudentClick: (row: AttendanceRow) => void }) {
  const [open, setOpen] = useState(true)

  const totalLessons = group.rows[0]
    ? group.rows[0].total
    : 0

  const avgPercent = group.rows.length
    ? Math.round(group.rows.reduce((s, r) => s + r.percent, 0) / group.rows.length)
    : 0

  return (
    <Card className="overflow-hidden p-0">
      {/* Group header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary-100 rounded-xl flex items-center justify-center">
            <Users size={16} className="text-primary-600" />
          </div>
          <div>
            <div className="font-semibold text-gray-900">{group.group_name}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {group.rows.length} студентов · {totalLessons} занятий отмечено
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className={cn(
              'text-lg font-bold',
              avgPercent >= 80 ? 'text-green-600' :
              avgPercent >= 60 ? 'text-yellow-600' : 'text-red-500'
            )}>{avgPercent}%</div>
            <div className="text-xs text-gray-400">средняя</div>
          </div>
          {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {/* Table */}
      {open && (
        <div className="border-t border-gray-100">
          {group.rows.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">Нет студентов</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                  <th className="px-5 py-2.5 text-left font-medium">Студент</th>
                  <th className="px-3 py-2.5 text-center font-medium">
                    <span className="flex items-center justify-center gap-1 text-green-600"><Check size={11} />Присут.</span>
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium">
                    <span className="flex items-center justify-center gap-1 text-orange-500"><Clock size={11} />Опоздал</span>
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium">
                    <span className="flex items-center justify-center gap-1 text-red-500"><X size={11} />Отсутст.</span>
                  </th>
                  <th className="px-5 py-2.5 text-left font-medium w-40">Посещаемость</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {group.rows.map((row, i) => (
                  <tr key={row.student_id} className={cn('hover:bg-gray-50/50 transition-colors cursor-pointer', i % 2 === 0 ? '' : 'bg-gray-50/30')}
                    onClick={() => onStudentClick(row)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-xs shrink-0">
                          {row.avatar_url
                            ? <img src={row.avatar_url} className="w-full h-full rounded-full object-cover" />
                            : row.full_name.charAt(0)
                          }
                        </div>
                        <span className="font-medium text-gray-800 hover:text-primary-600 transition-colors">{row.full_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="font-semibold text-green-600">{row.present}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="font-semibold text-orange-500">{row.late}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="font-semibold text-red-500">{row.absent}</span>
                    </td>
                    <td className="px-5 py-3">
                      <PercentBar value={row.percent} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  )
}

export function AttendancePage() {
  const { groups, loading } = useAttendanceReport()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null)

  function handleExport() {
    const rows = groups.flatMap(g =>
      g.rows.map(r => ({
        studentName: r.full_name,
        groupName:   g.group_name,
        present:     r.present,
        late:        r.late,
        absent:      r.absent,
        total:       r.total,
        pct:         r.percent,
      }))
    )
    exportAttendance(rows)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Посещаемость</h1>
          <p className="text-gray-500 mt-1">Статистика присутствия студентов по группам</p>
        </div>
        {!loading && groups.length > 0 && (
          <Button size="sm" variant="secondary" onClick={handleExport}>
            <Download size={15} className="mr-1.5" />Excel
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
          <Loader2 size={20} className="animate-spin" />Загрузка…
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <div className="text-center py-16 text-gray-400">
            <BarChart2 size={40} className="mx-auto mb-3 opacity-30" />
            <p>Нет данных о посещаемости</p>
            <p className="text-xs mt-1">Отметьте посещаемость на странице Занятий</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <GroupCard
              key={g.group_id}
              group={g}
              onStudentClick={row => navigate(`/students/${row.student_id}`)}
            />
          ))}
        </div>
      )}

      <StudentAttendanceModal
        open={!!selected}
        onClose={() => setSelected(null)}
        studentId={selected?.id ?? null}
        studentName={selected?.name ?? ''}
      />
    </div>
  )
}
