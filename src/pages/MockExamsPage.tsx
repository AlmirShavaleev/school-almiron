import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, TrendingUp, Plus, Table2, Download, Layers, Settings2 } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useMockExams } from '@/hooks/useMockExams'
import { formatDate, SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'
import { exportMockExams } from '@/utils/exportExcel'
import { cn } from '@/utils/cn'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

export function MockExamsPage() {
  const profile = useAuthStore(s => s.profile)
  const canCreate = profile?.role && ['teacher', 'admin', 'owner'].includes(profile.role)
  const isStudent = profile?.role === 'student'

  const { exams, myResults, loading } = useMockExams(0)

  // §224. У каждой группы свой список: чипы групп + «Все». Выбор — в адресе
  // (?group=…), чтобы ссылка вела сразу в список группы. Плитки сверху
  // считают по-прежнему всё — их эта работа не трогает.
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
  const hasUngrouped = exams.some((e: any) => !e.group_id)
  const showChips = groupChips.length + (hasUngrouped ? 1 : 0) >= 2
  const activeGroup = showChips && groupFilter && groupChips.some(g => g.id === groupFilter) ? groupFilter : null
  const shownExams = activeGroup ? exams.filter((e: any) => e.group_id === activeGroup) : exams
  const pickGroup = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('group', id)
    else next.delete('group')
    setParams(next, { replace: true })
  }

  const lastScore = myResults.length > 0 ? myResults[myResults.length - 1].score : null
  const firstScore = myResults.length > 0 ? myResults[0].score : null
  const delta = lastScore != null && firstScore != null ? lastScore - firstScore : null

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Пробные экзамены</h1>
          <p className="text-gray-500 mt-1">Результаты и динамика прогресса</p>
        </div>
        <div className="flex items-center gap-2">
          {!isStudent && shownExams.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => {
              const rows = shownExams.flatMap((e: any) =>
                (e.mock_exam_results || []).map((r: any) => ({
                  examTitle:   e.title,
                  examDate:    e.date || '',
                  subject:     SUBJECT_LABELS[e.subject] || e.subject || '',
                  groupName:   e.groups?.name || '',
                  studentName: r.students?.profiles?.full_name || '—',
                  score:       r.score,
                  maxScore:    e.max_score,
                  pct:         Math.round(r.score / e.max_score * 100),
                  // §215. В базе это `notes`; `feedback` там нет, и выгрузка
                  // молча печатала пустой столбец.
                  part1:       r.part1_score ?? null,
                  part2:       r.part2_score ?? null,
                  notes:       r.notes || '',
                  // §218. Баллы по номерам заданий — у пробников с шаблоном.
                  ...(e.mock_exam_templates ? {
                    primary: r.primary_score ?? null,
                    tasks: taskRow(e, r.student_id),
                  } : {}),
                }))
              )
              exportMockExams(rows)
            }}>
              <Download size={15} className="mr-1.5" />Excel
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

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          title="Всего пробников"
          value={exams.length}
          icon={<BookOpen size={20} />}
          color="blue"
        />
        {isStudent ? (
          <>
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
          </>
        ) : (
          <>
            <StatCard
              title="Средний балл"
              value={
                exams.length > 0
                  ? `${Math.round(
                      exams.flatMap((e: any) => e.mock_exam_results || [])
                           .reduce((sum: number, r: any, _: any, arr: any[]) => sum + r.score / arr.length, 0)
                    )} б.`
                  : '—'
              }
              icon={<TrendingUp size={20} />}
              color="green"
            />
            <StatCard
              title="Участников"
              value={exams.flatMap((e: any) => e.mock_exam_results || []).length}
              icon={<TrendingUp size={20} />}
              color="purple"
            />
          </>
        )}
      </div>

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
            {isStudent ? 'Мои результаты' : 'История пробников'}
          </CardTitle>
          <Badge variant="default">{isStudent ? exams.length : shownExams.length}</Badge>
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
          // Teacher / admin view — list exams with average scores
          <div className="space-y-4">
            {shownExams.map((exam: any) => {
              const results: any[] = exam.mock_exam_results || []
              const avg = results.length > 0
                ? Math.round(results.reduce((s: number, r: any) => s + r.score, 0) / results.length)
                : null
              return (
                <div key={exam.id} className="p-5 border border-gray-200 rounded-xl hover:border-primary-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">
                        {canCreate && exam.group_id ? <Link to={`/mock-exams/${exam.id}`} className="hover:text-primary-700 hover:underline">{exam.title}</Link> : exam.title}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        <span>{formatDate(exam.date)}</span>
                        {exam.subject && <><span>•</span><span>{SUBJECT_LABELS[exam.subject] || exam.subject}</span></>}
                        {exam.exam_type && <><span>•</span><Badge variant="info">{EXAM_LABELS[exam.exam_type] || exam.exam_type}</Badge></>}
                      </div>
                      {exam.groups?.name && (
                        <div className="text-xs text-gray-400 mt-0.5">{exam.groups.name}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-4 ml-4">
                      <div className="text-right">
                        {avg != null ? (
                          <>
                            <div className="text-3xl font-bold text-primary-600">{avg}</div>
                            <div className="text-xs text-gray-400">средний / {exam.max_score}</div>
                          </>
                        ) : (
                          <div className="text-sm text-gray-400">Нет результатов</div>
                        )}
                        <Badge variant="default" className="mt-1">{results.length} уч.</Badge>
                      </div>
                      {canCreate && <GridEntry exam={exam} />}
                    </div>
                  </div>
                  {results.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {results.map((r: any) => (
                        <div key={r.student_id} className="flex items-center gap-1 text-xs bg-gray-50 rounded-lg px-2 py-1">
                          <span className="text-gray-600">{r.students?.profiles?.full_name || '—'}</span>
                          <span className="font-bold text-primary-600">{r.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

/**
 * §218. Вход в таблицу по номерам. У пробника без группы или без шаблона
 * таблицы нет, и это говорится словами, а не пропавшей кнопкой: все девять
 * образцов на проде заведены с `group_id = null`, и молча спрятанная кнопка
 * выглядела бы как поломка.
 */
function GridEntry({ exam }: { exam: any }) {
  if (!exam.group_id) {
    return <span className="max-w-[180px] text-right text-xs text-amber-800" data-testid="mock-exam-no-group">нет группы — результаты не ввести</span>
  }
  if (!exam.template_id) {
    return <span className="max-w-[180px] text-right text-xs text-graphite-500" data-testid="mock-exam-no-template">старый пробник без шаблона — таблицы по номерам нет</span>
  }
  return (
    <span className="inline-flex flex-wrap justify-end gap-1.5">
      {/* §221: онлайн-окно, условие, решение, ключ, место в программе курса. */}
      <Link
        to={`/mock-exams/${exam.id}?tab=setup`}
        data-testid="mock-exam-setup-open"
        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 text-sm font-medium text-graphite-800 hover:border-primary-200 sm:min-h-0"
      >
        <Settings2 size={14} />{exam.starts_at ? 'Онлайн' : 'Настройка'}
      </Link>
      <Link
        to={`/mock-exams/${exam.id}?tab=table`}
        data-testid="mock-exam-grid-open"
        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 text-sm font-medium text-graphite-800 hover:border-primary-200 sm:min-h-0"
      >
        <Table2 size={14} />Таблица
      </Link>
    </span>
  )
}

/** §224. Группы, у которых есть пробники, — по имени. */
function groupChipsOf(exams: any[]): { id: string; name: string }[] {
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
function taskRow(exam: any, studentId: string): (number | null)[] {
  const n: number = exam.mock_exam_templates?.max_points?.length ?? 0
  const row: (number | null)[] = Array(n).fill(null)
  for (const s of exam.mock_exam_task_scores ?? []) {
    if (s.student_id === studentId && s.task_number >= 1 && s.task_number <= n) row[s.task_number - 1] = Number(s.points)
  }
  return row
}
