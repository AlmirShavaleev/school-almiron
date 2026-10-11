/**
 * §288. Вкладка «Прохождение» (персонал курса «по прохождению»): ученики ×
 * уроки, по разделам. Данные — один вызов `course_progress_matrix` на курс
 * (то же определение `_progress_state`, что у ворот ученика).
 *
 * Ячейка: ✓ закрыт (с % урока) / ○ открыт / ⏳ ДЗ на проверке / 🔒 заблокирован;
 * ✋ — ручная отметка. Подсказка — причина открытия или чего не хватает.
 * Клик — меню «Открыть / Закрыть вручную / Снять отметку» с подтверждением.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import {
  cellHint,
  fetchCourseProgressMatrix,
  isStuck,
  openModuleForStudent,
  openTopicForCourse,
  setTopicOverride,
  type MatrixCell,
} from '@/lib/progressUnlock'

const ICON: Record<MatrixCell[0], string> = { closed: '✓', open: '○', pending_review: '⏳', locked: '🔒' }
const CELL_CLS: Record<MatrixCell[0], string> = {
  closed: 'bg-verdict-ok-tint text-verdict-ok-ink',
  open: 'bg-white text-graphite-700',
  pending_review: 'bg-verdict-part-tint text-verdict-part-ink',
  locked: 'bg-graphite-100 text-graphite-400',
}

type Action =
  | { kind: 'cell'; studentId: string; studentName: string; topicId: string; topicTitle: string; cell: MatrixCell }

export function CourseProgressTab({ courseId }: { courseId: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['course-progress', courseId], queryFn: () => fetchCourseProgressMatrix(courseId) })
  const [moduleId, setModuleId] = useState<string>('')
  const [stuckOnly, setStuckOnly] = useState(false)
  const [stuckDays, setStuckDays] = useState(7)
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<Action | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const done = () => {
    setMenu(null)
    void qc.invalidateQueries({ queryKey: ['course-progress', courseId] })
  }
  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: done,
    onError: (e) => setMsg(e instanceof Error ? e.message : 'Ошибка'),
  })

  const data = q.data
  const modules = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of data?.topics ?? []) if (!seen.has(t.module_id)) seen.set(t.module_id, t.module_title)
    return [...seen].map(([id, title]) => ({ id, title }))
  }, [data])
  const activeModule = moduleId || modules[0]?.id || ''
  const cols = useMemo(
    () => (data?.topics ?? []).map((t, i) => ({ ...t, i })).filter((t) => t.module_id === activeModule),
    [data, activeModule],
  )
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.students ?? []).filter((s) =>
      (!stuckOnly || isStuck(s, stuckDays))
      && (!needle || `${s.full_name ?? ''} ${s.email ?? ''}`.toLowerCase().includes(needle)))
  }, [data, search, stuckOnly, stuckDays])

  if (q.isLoading) return <p className="flex items-center gap-2 text-graphite-500"><Loader2 size={16} className="animate-spin" />Загружаем…</p>
  if (q.error) return <p className="text-verdict-bad-ink">✕ {(q.error as Error).message}</p>
  if (!data) return null
  if (data.mode !== 'progress') {
    return <p className="text-graphite-500">Курс открывается по датам. Режим «по прохождению» включается в «Настройках».</p>
  }
  if (data.students.length === 0) return <p className="text-graphite-500">В курсе пока нет учеников.</p>

  const confirmRun = (text: string, fn: () => Promise<unknown>) => {
    if (window.confirm(text)) act.mutate(fn)
  }

  return (
    <div className="space-y-4" data-testid="course-progress">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[13px] text-graphite-700">
          Раздел
          <select className="mt-1 block rounded-lg border border-graphite-200 px-3 py-2 text-[15px]" value={activeModule}
            onChange={(e) => setModuleId(e.target.value)} data-testid="progress-module">
            {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>
        <label className="text-[13px] text-graphite-700">
          Ученик
          <input className="mt-1 block rounded-lg border border-graphite-200 px-3 py-2 text-[15px]" placeholder="имя или email"
            value={search} onChange={(e) => setSearch(e.target.value)} data-testid="progress-search" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-[15px] text-graphite-700">
          <input type="checkbox" checked={stuckOnly} onChange={(e) => setStuckOnly(e.target.checked)} data-testid="progress-stuck" />
          застрявшие: нет закрытых уроков
          <input type="number" min={1} max={90} className="w-16 rounded-lg border border-graphite-200 px-2 py-1"
            value={stuckDays} onChange={(e) => setStuckDays(Math.max(1, Number(e.target.value) || 1))} aria-label="дней" />
          дн.
        </label>
      </div>
      <p className="text-[13px] text-graphite-500">✓ закрыт (% урока) · ○ открыт · ⏳ ДЗ на проверке · 🔒 заблокирован · ✋ ручная отметка</p>
      {msg && <p className="text-[13px] text-verdict-bad-ink">✕ {msg}</p>}

      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-[13px]" data-testid="progress-table">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[12rem] bg-white p-2 text-left font-semibold text-graphite-700">Ученик</th>
              {cols.map((t) => (
                <th key={t.id} className="max-w-[7rem] p-1 align-bottom font-normal text-graphite-700" title={t.title}>
                  <div className="line-clamp-3 text-left">{t.title}</div>
                  <button type="button" className="mt-1 text-[12px] text-primary-600 underline" data-testid="progress-open-topic"
                    onClick={() => confirmRun(`Открыть урок «${t.title}» всем ученикам курса?`, () => openTopicForCourse(t.id))}>
                    открыть всем
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} data-testid="progress-row">
                <td className="sticky left-0 z-10 border-t border-graphite-100 bg-white p-2">
                  <div className="font-medium text-graphite-900">{s.full_name ?? '—'}</div>
                  <div className="text-graphite-500">закрыто: {s.closed}</div>
                  <button type="button" className="text-[12px] text-primary-600 underline" data-testid="progress-open-module"
                    onClick={() => confirmRun(`Открыть ученику ${s.full_name ?? ''} весь раздел?`, () => openModuleForStudent(s.id, activeModule))}>
                    открыть раздел
                  </button>
                </td>
                {cols.map((t) => {
                  const cell = s.cells[t.i]
                  const [state, , , , pct, ovr] = cell
                  return (
                    <td key={t.id} className="border-t border-graphite-100 p-0.5">
                      <button type="button" title={cellHint(cell)} aria-label={`${t.title}: ${cellHint(cell)}`}
                        className={cn('h-9 w-full min-w-[3rem] rounded-md text-center', CELL_CLS[state])}
                        onClick={() => setMenu({ kind: 'cell', studentId: s.id, studentName: s.full_name ?? '', topicId: t.id, topicTitle: t.title, cell })}
                        data-testid="progress-cell" data-state={state}>
                        {ICON[state]}{state === 'closed' && pct != null ? ` ${pct}%` : ''}{ovr ? ' ✋' : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {menu && (
        <div className="rounded-card border border-graphite-200 bg-white p-4" role="dialog" aria-label="Ручная отметка" data-testid="progress-menu">
          <p className="text-[15px] font-semibold text-graphite-900">{menu.studentName} · «{menu.topicTitle}»</p>
          <p className="mt-1 text-[13px] text-graphite-500">{cellHint(menu.cell)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-lg bg-primary-600 px-3 py-2 text-white" data-testid="progress-set-open"
              onClick={() => confirmRun(`Открыть урок «${menu.topicTitle}» ученику ${menu.studentName}?`,
                () => setTopicOverride(menu.studentId, menu.topicId, 'open'))}>Открыть вручную</button>
            <button type="button" className="rounded-lg border border-graphite-200 px-3 py-2" data-testid="progress-set-closed"
              onClick={() => confirmRun(`Закрыть урок «${menu.topicTitle}» ученику ${menu.studentName}? Это важнее всех правил.`,
                () => setTopicOverride(menu.studentId, menu.topicId, 'closed'))}>Закрыть вручную</button>
            {menu.cell[5] && (
              <button type="button" className="rounded-lg border border-graphite-200 px-3 py-2" data-testid="progress-set-clear"
                onClick={() => confirmRun('Снять ручную отметку? Урок снова откроется по правилам.',
                  () => setTopicOverride(menu.studentId, menu.topicId, null))}>Снять ручную отметку</button>
            )}
            <button type="button" className="px-3 py-2 text-graphite-500" onClick={() => setMenu(null)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  )
}
