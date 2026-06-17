import { useState, useCallback } from 'react'
import { BookOpen, TrendingUp, Plus, ClipboardList, Download } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useMockExams } from '@/hooks/useMockExams'
import { CreateMockExamModal } from '@/components/modals/CreateMockExamModal'
import { MockExamResultsModal } from '@/components/modals/MockExamResultsModal'
import { formatDate, SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'
import { exportMockExams } from '@/utils/exportExcel'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

export function MockExamsPage() {
  const profile = useAuthStore(s => s.profile)
  const canCreate = profile?.role && ['teacher', 'admin', 'owner'].includes(profile.role)
  const isStudent = profile?.role === 'student'

  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const { exams, myResults, loading } = useMockExams(tick)

  const [showCreate, setShowCreate]   = useState(false)
  const [resultsTarget, setResultsTarget] = useState<{
    examId: string; groupId: string; maxScore: number; title: string
  } | null>(null)

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
          {!isStudent && exams.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => {
              const rows = exams.flatMap((e: any) =>
                (e.mock_exam_results || []).map((r: any) => ({
                  examTitle:   e.title,
                  examDate:    e.date || '',
                  subject:     SUBJECT_LABELS[e.subject] || e.subject || '',
                  groupName:   e.groups?.name || '',
                  studentName: r.students?.profiles?.full_name || '—',
                  score:       r.score,
                  maxScore:    e.max_score,
                  pct:         Math.round(r.score / e.max_score * 100),
                  feedback:    r.feedback || '',
                }))
              )
              exportMockExams(rows)
            }}>
              <Download size={15} className="mr-1.5" />Excel
            </Button>
          )}
          {canCreate && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={16} className="mr-1" />Добавить пробник
            </Button>
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
          <Badge variant="default">{exams.length}</Badge>
        </CardHeader>
        {exams.length === 0 ? (
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
                  {r.feedback && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                      <strong>Комментарий:</strong> {r.feedback}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          // Teacher / admin view — list exams with average scores
          <div className="space-y-4">
            {exams.map((exam: any) => {
              const results: any[] = exam.mock_exam_results || []
              const avg = results.length > 0
                ? Math.round(results.reduce((s: number, r: any) => s + r.score, 0) / results.length)
                : null
              return (
                <div key={exam.id} className="p-5 border border-gray-200 rounded-xl hover:border-primary-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">{exam.title}</h3>
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
                      {canCreate && exam.group_id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setResultsTarget({
                            examId:   exam.id,
                            groupId:  exam.group_id,
                            maxScore: exam.max_score,
                            title:    exam.title,
                          })}
                        >
                          <ClipboardList size={14} className="mr-1" />
                          Результаты
                        </Button>
                      )}
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
      {/* Modals */}
      {canCreate && (
        <>
          <CreateMockExamModal
            open={showCreate}
            onClose={() => setShowCreate(false)}
            onCreated={(examId, groupId, maxScore, title) => {
              setShowCreate(false)
              setResultsTarget({ examId, groupId, maxScore, title })
              reload()
            }}
          />
          <MockExamResultsModal
            open={resultsTarget != null}
            onClose={() => setResultsTarget(null)}
            onSaved={reload}
            examId={resultsTarget?.examId ?? null}
            groupId={resultsTarget?.groupId ?? null}
            maxScore={resultsTarget?.maxScore ?? 100}
            examTitle={resultsTarget?.title}
          />
        </>
      )}
    </div>
  )
}
