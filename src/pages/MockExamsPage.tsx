import { useState, type ComponentProps } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, ChevronRight, TrendingUp, Plus, Download, Layers } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useMockExams, type MockExamExportItem, type MockExamListItem } from '@/hooks/useMockExams'
import { useMockExamClock } from '@/hooks/useMockExamClock'
import { examListStatus, type ExamListStatus } from '@/lib/mockExamV3'
import { formatDate, SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'
import { cn } from '@/utils/cn'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

const EXAM_STATUS: Record<ExamListStatus, { label: string; variant: ComponentProps<typeof Badge>['variant']; className?: string }> = {
  draft: { label: 'Черновик', variant: 'default' },
  upcoming: { label: 'Ожидается', variant: 'default', className: 'bg-gold-200 text-gold-900' },
  running: { label: 'Идёт', variant: 'info' },
  photos: { label: 'Приём фото', variant: 'info' },
  waiting: { label: 'Ждёт проверки', variant: 'warning' },
  checked: { label: 'Проверено', variant: 'success' },
  empty: { label: 'Нет работ', variant: 'default' },
}

export function MockExamsPage() {
  const profile = useAuthStore(s => s.profile)
  const canCreate = profile?.role && ['teacher', 'admin', 'owner'].includes(profile.role)
  const isStudent = profile?.role === 'student'

  const { exams, myResults, loading, loadExportExams } = useMockExams()
  const now = useMockExamClock()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  // §224. Выбор группы — в адресе (?group=…), чтобы список можно было открыть по ссылке.
  const [params, setParams] = useSearchParams()
  const groupFilter = params.get('group')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Загрузка…
      </div>
    )
  }

  // Build chart data from student results
  const chartData = myResults.map((r, i) => ({
    exam:  `Пр.#${i + 1}`,
    score: r.score,
    maxScore: r.mock_exams?.max_score || 100,
  }))

  const groupChips = isStudent ? [] : groupChipsOf(exams)
  const hasUngrouped = exams.some(exam => !exam.group_id)
  const showChips = groupChips.length + (hasUngrouped ? 1 : 0) >= 2
  const activeGroup = showChips && groupFilter && groupChips.some(g => g.id === groupFilter) ? groupFilter : null
  const shownExams = activeGroup ? exams.filter(exam => exam.group_id === activeGroup) : exams
  const pickGroup = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('group', id)
    else next.delete('group')
    setParams(next, { replace: true })
  }

  const lastScore = myResults.length > 0 ? myResults[myResults.length - 1].score : null
  const firstScore = myResults.length > 0 ? myResults[0].score : null
  const delta = lastScore != null && firstScore != null ? lastScore - firstScore : null

  async function downloadResults() {
    setExporting(true)
    setExportError('')
    try {
      const { data, error } = await loadExportExams(activeGroup)
      if (error) throw error
      const rows = (data ?? []).flatMap(exam => (exam.mock_exam_results ?? []).map(result => ({
        examTitle: exam.title,
        examDate: exam.date,
        subject: SUBJECT_LABELS[exam.subject] || exam.subject || '',
        groupName: exam.groups?.name || '',
        studentName: result.students?.profiles?.full_name || '—',
        score: result.score,
        maxScore: exam.max_score,
        pct: Math.round(result.score / exam.max_score * 100),
        part1: result.part1_score ?? null,
        part2: result.part2_score ?? null,
        notes: result.notes || '',
        ...(exam.mock_exam_templates ? {
          primary: result.primary_score ?? null,
          tasks: taskRow(exam, result.student_id),
        } : {}),
      })))
      const { exportMockExams } = await import('@/utils/exportExcel')
      exportMockExams(rows)
    } catch {
      setExportError('Не удалось выгрузить Excel. Попробуйте ещё раз.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Пробные экзамены</h1>
          {isStudent && <p className="mt-1 text-gray-500">Результаты и динамика прогресса</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isStudent && shownExams.length > 0 && (
            <Button size="sm" variant="secondary" loading={exporting} onClick={downloadResults}>
              <Download size={15} aria-hidden />Excel
            </Button>
          )}
          {canCreate && (
            <Link to="/mock-exams/templates" data-testid="mock-templates-link"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 text-sm font-medium text-graphite-800 hover:border-primary-200 sm:min-h-0">
              <Layers size={15} />Шаблоны
            </Link>
          )}
          {canCreate && (
            // §228. «Новый пробник» — одна форма на своей странице (вместо модалки §218).
            <Link to="/mock-exams/new" data-testid="mock-exams-add"
              className="inline-flex min-h-11 items-center gap-1 rounded-full bg-gradient-to-br from-action-from to-action-to px-3.5 py-1 text-sm font-bold text-white shadow-action hover:brightness-110 sm:min-h-8">
              <Plus size={16} />Добавить пробник
            </Link>
          )}
        </div>
      </div>
      {exportError && <p role="alert" className="text-sm text-verdict-bad-ink">{exportError}</p>}

      {isStudent && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard title="Всего пробников" value={exams.length} icon={<BookOpen size={20} />} color="blue" />
          <StatCard
            title="Последний балл"
            value={lastScore != null ? `${lastScore} б.` : '—'}
            icon={<TrendingUp size={20} />}
            color="green"
          />
          <StatCard
            title="Прирост"
            value={delta != null ? `${delta >= 0 ? '+' : ''}${delta} б.` : '—'}
            icon={<TrendingUp size={20} />}
            color="purple"
            subtitle="С начала"
          />
        </div>
      )}

      {/* Chart — only shown for students with results */}
      {isStudent && chartData.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Динамика результатов</CardTitle>
            {delta != null && (
              <Badge variant={delta >= 0 ? 'success' : 'error'}>
                {delta >= 0 ? '+' : ''}{delta} баллов
              </Badge>
            )}
          </CardHeader>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="exam" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => [`${v} б.`, 'Балл']} />
              <Bar dataKey="score" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Exams list */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isStudent ? 'Мои результаты' : 'Всего пробников'}
          </CardTitle>
          <Badge variant="default">{activeGroup ? `${shownExams.length} из ${exams.length}` : exams.length}</Badge>
        </CardHeader>
        {showChips && (
          <div className="-mt-1 mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Группа" data-testid="mock-group-chips">
            <GroupChip active={!activeGroup} onClick={() => pickGroup(null)}>Все</GroupChip>
            {groupChips.map(g => (
              <GroupChip key={g.id} active={activeGroup === g.id} onClick={() => pickGroup(g.id)}>{g.name}</GroupChip>
            ))}
          </div>
        )}
        {(isStudent ? exams.length : shownExams.length) === 0 ? (
          <p className="text-center text-gray-400 py-8">Нет пробников</p>
        ) : isStudent ? (
          <div className="space-y-4">
            {myResults.map((r: any, i: number) => {
              const exam = r.mock_exams
              if (!exam) return null
              const pct = Math.round((r.score / exam.max_score) * 100)
              const prevScore = i > 0 ? myResults[i - 1].score : null
              const diff = prevScore != null ? r.score - prevScore : null
              return (
                <div key={r.id} className="p-5 border border-gray-200 rounded-xl hover:border-primary-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{exam.title}</h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        <span>{formatDate(exam.date)}</span>
                        {exam.subject && (
                          <>
                            <span>•</span>
                            <span>{SUBJECT_LABELS[exam.subject] || exam.subject}</span>
                          </>
                        )}
                        {exam.exam_type && (
                          <>
                            <span>•</span>
                            <Badge variant="info">{EXAM_LABELS[exam.exam_type] || exam.exam_type}</Badge>
                          </>
                        )}
                      </div>
                      {exam.groups?.name && (
                        <div className="text-xs text-gray-400 mt-0.5">{exam.groups.name}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-primary-600">{r.score}</div>
                      <div className="text-xs text-gray-400">из {exam.max_score}</div>
                      {diff != null && (
                        <div className={`text-xs font-medium mt-1 ${diff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {diff >= 0 ? '↑' : '↓'} {diff >= 0 ? '+' : ''}{diff} б.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 w-full bg-gray-100 rounded-full h-2.5">
                    <div className="h-2.5 bg-primary-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>0</span>
                    <span>{pct}%</span>
                    <span>{exam.max_score} баллов</span>
                  </div>
                  {(r.part1_score != null || r.part2_score != null) && (
                    <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                      {r.part1_score != null && <span>1 часть: <b className="text-gray-700">{r.part1_score}</b></span>}
                      {r.part2_score != null && <span>2 часть: <b className="text-gray-700">{r.part2_score}</b></span>}
                    </div>
                  )}
                  {r.notes && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                      <strong>Заметка:</strong> {r.notes}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <ul className="divide-y divide-graphite-100 border-y border-graphite-100">
            {shownExams.map(exam => {
              const titleId = `mock-exam-title-${exam.id}`
              const statusId = `mock-exam-status-${exam.id}`
              const status = exam.progress && EXAM_STATUS[examListStatus(exam.progress, now)]
              const statusBadge = status && (
                <span id={statusId}><Badge variant={status.variant} className={cn('whitespace-nowrap', status.className)}>{status.label}</Badge></span>
              )
              const info = (
                <div className="min-w-0 space-y-1">
                  <h3 id={titleId} className="break-words font-semibold text-graphite-900 group-hover:text-primary-700">{exam.title}</h3>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-graphite-500">
                    <time dateTime={exam.date}>{formatDate(exam.date)}</time>
                    {exam.subject && <span>{SUBJECT_LABELS[exam.subject] || exam.subject}</span>}
                    {exam.exam_type && <Badge variant="info">{EXAM_LABELS[exam.exam_type] || exam.exam_type}</Badge>}
                    <span>{exam.groups?.name || 'Без группы'}</span>
                  </div>
                </div>
              )
              return (
                <li key={exam.id}>
                  {canCreate ? (
                    <Link to={`/mock-exams/${exam.id}`} aria-labelledby={titleId} aria-describedby={status ? statusId : undefined}
                      className="group flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 sm:px-3">
                      {info}
                      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
                        {statusBadge}
                        <ChevronRight size={18} className="text-graphite-400 group-hover:text-primary-700" aria-hidden />
                      </div>
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-3 px-2 py-3 sm:px-3">{info}{statusBadge}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** §224. Группы, у которых есть пробники, — по имени. */
function groupChipsOf(exams: MockExamListItem[]): { id: string; name: string }[] {
  const map = new Map<string, string>()
  for (const e of exams) if (e.group_id && !map.has(e.group_id)) map.set(e.group_id, e.groups?.name || 'группа')
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

function GroupChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid="mock-group-chip"
      className={cn(
        'min-h-9 rounded-full border px-3 py-1 text-sm transition-colors',
        active ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-200 bg-white text-graphite-700 hover:border-primary-200',
      )}
    >
      {children}
    </button>
  )
}

/** Баллы ученика по заданиям в порядке номеров; пустая клетка — null. */
function taskRow(exam: MockExamExportItem, studentId: string): (number | null)[] {
  const n: number = exam.mock_exam_templates?.max_points?.length ?? 0
  const row: (number | null)[] = Array(n).fill(null)
  for (const s of exam.mock_exam_task_scores ?? []) {
    if (s.student_id === studentId && s.task_number >= 1 && s.task_number <= n) row[s.task_number - 1] = Number(s.points)
  }
  return row
}
