import { useMemo, useState, type ReactNode } from 'react'
import type { AdminCourse } from '@/hooks/useAdminDashboard'
import '@/components/charts/schoolCharts.css'

/** All courses remain available; a large school starts with a compact directory. */
export function AdminCourseBrowser({ courses, renderCourse }: { courses: AdminCourse[]; renderCourse: (course: AdminCourse) => ReactNode }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const groups = useMemo(() => {
    const result = new Map<string, AdminCourse[]>()
    for (const c of courses) {
      if (status === 'active' && !c.is_active || status === 'archived' && c.is_active) continue
      const subject = c.subject === 'physics' ? 'Физика' : c.subject === 'math' ? 'Математика' : c.subject || 'Другие предметы'
      const label = `${subject}${c.exam_type ? ` · ${c.exam_type.toUpperCase()}` : ''}`
      if (query.trim() && !`${c.title} ${label} ${c.description ?? ''}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))) continue
      result.set(label, [...result.get(label) ?? [], c])
    }
    return [...result].sort(([a], [b]) => a.localeCompare(b, 'ru'))
  }, [courses, query, status])
  const found = groups.reduce((n, [, rows]) => n + rows.length, 0)
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3">
      <input type="search" aria-label="Найти курс" placeholder="Найти курс по названию или предмету" value={query} onChange={e => setQuery(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-gray-200 px-4 text-sm focus:ring-2 focus:ring-primary-400" />
      <select aria-label="Статус курсов" value={status} onChange={e => setStatus(e.target.value)} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm"><option value="all">Все курсы</option><option value="active">Активные</option><option value="archived">Архив</option></select>
    </div>
    <p className="text-xs text-gray-500">Показано {found} из {courses.length} · раскройте предмет, затем нужный курс</p>
    {groups.map(([label, rows]) => <details key={`${label}:${!!query.trim()}:${status}`} open={query.trim() ? true : undefined} className="school-course-disclosure">
      <summary><span className="min-w-0 flex-1 font-semibold text-graphite-900">{label}</span><span className="school-chart-pill">{rows.length}</span></summary>
      <div className="school-course-content space-y-3">{rows.map(c => <details key={c.id} className="school-course-disclosure">
        <summary><span className="min-w-0 flex-1 break-words text-sm font-semibold">{c.title}</span><span className="text-xs text-gray-500">{c.is_active ? 'Активен' : 'Архив'}</span></summary>
        <div className="school-course-content">{renderCourse(c)}</div>
      </details>)}</div>
    </details>)}
    {found === 0 && <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-gray-500">{courses.length ? 'Курсы не найдены. Измените поиск или статус.' : 'Курсов пока нет'}</p>}
  </div>
}
