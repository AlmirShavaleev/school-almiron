import { lazy, Suspense, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Clock, FileText, Download, Send, X } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useHomeworks } from '@/hooks/useHomeworks'
import { SubmitHomeworkModal } from '@/components/modals/SubmitHomeworkModal'
import { AssignHomeworkModal } from '@/components/modals/AssignHomeworkModal'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { formatDate, isOverdue, HW_STATUS_COLORS, HW_STATUS_LABELS } from '@/utils/format'
import { exportHomeworks } from '@/utils/exportExcel'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'
import { getPrimarySubmissionFilePath, getSubmissionFilePaths } from '@/lib/homeworkSubmissionFiles'

const SubmissionReviewer = lazy(() => import('@/components/SubmissionReviewer'))

export function HomeworksPage() {
  const navigate = useNavigate()
  const profile   = useAuthStore(s => s.profile)
  const isStudent = profile?.role === 'student'
  const canCreate = profile?.role && ['teacher', 'admin', 'owner'].includes(profile.role)
  const canReview = profile?.role && ['teacher', 'admin', 'owner', 'curator'].includes(profile.role)

  const { homeworks, loading, error, reload } = useHomeworks()

  // Student ID for submission
  const [studentId, setStudentId] = useState<string | null>(null)
  useEffect(() => {
    if (!isStudent || !profile) return
    supabase.from('students').select('id').eq('profile_id', profile.id).single()
      .then(({ data }) => setStudentId(data?.id || null))
  }, [profile, isStudent])

  // Modals
  const [submitTarget,  setSubmitTarget]  = useState<{
    id: string; title: string; max_score: number; file_url?: string
    isResubmit?: boolean; previousFileUrl?: string | null; previousFilePaths?: string[]; feedback?: string | null
  } | null>(null)
  const [studentReview, setStudentReview] = useState<{ id: string; title: string; file_url: string; filePaths: string[] } | null>(null)
  const [assignTarget, setAssignTarget] = useState<{ id: string; title: string; topic_id?: string | null; max_score?: number | null } | null>(null)

  // Enrich with submission status for student view
  const withStatus = homeworks.map(hw => {
    const sub = Array.isArray(hw.homework_submissions)
      ? hw.homework_submissions[0]
      : hw.homework_submissions
    return { ...hw, _sub: sub }
  })

  const pending   = withStatus.filter(h => !h._sub || h._sub.status === 'not_submitted').length
  const submitted = withStatus.filter(h => h._sub?.status === 'submitted').length
  const checked   = withStatus.filter(h => h._sub?.status === 'checked').length

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Загрузка…</div>
  }

  if (error) {
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Домашние задания</h1>
          <p className="text-gray-500 mt-1">Все ДЗ по вашим группам</p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && homeworks.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => {
              const rows = withStatus.flatMap(hw => {
                const subs = Array.isArray(hw.homework_submissions) ? hw.homework_submissions : []
                if (subs.length === 0) return [{
                  studentName: '—',
                  groupName:   hw.topics?.title || '—',
                  hwTitle:     hw.title,
                  status:      'not_submitted',
                  score:       null,
                  maxScore:    hw.max_score,
                  submittedAt: '',
                  checkedAt:   '',
                }]
                return subs.map((s: any) => ({
                  studentName: s.students?.profiles?.full_name || '—',
                  groupName:   hw.topics?.title || '—',
                  hwTitle:     hw.title,
                  status:      s.status,
                  score:       s.score ?? null,
                  maxScore:    hw.max_score,
                  submittedAt: s.submitted_at ? formatDate(s.submitted_at) : '',
                  checkedAt:   s.checked_at   ? formatDate(s.checked_at)   : '',
                }))
              })
              exportHomeworks(rows)
            }}>
              <Download size={15} className="mr-1.5" />Excel
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Не сдано"    value={pending}   icon={<ClipboardList size={20} />} color="red" />
        <StatCard title="На проверке" value={submitted}  icon={<Clock size={20} />}         color="orange" />
        <StatCard title="Проверено"   value={checked}    icon={<ClipboardList size={20} />} color="green" />
      </div>

      {/* Homeworks list */}
      <Card>
        <CardHeader>
          <CardTitle>Все задания</CardTitle>
          <Badge variant="default">{homeworks.length}</Badge>
        </CardHeader>

        {homeworks.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Нет заданий</p>
        ) : (
          <div className="space-y-4">
            {withStatus.map(hw => {
              const overdue    = hw.due_date ? isOverdue(hw.due_date) : false
              const status: string = hw._sub?.status || 'not_submitted'
              const groupName  = hw.topics?.title || '—'
              const subList    = Array.isArray(hw.homework_submissions) ? hw.homework_submissions : []
              const submittedCount = subList.filter((s: any) => s.status === 'submitted').length

              return (
                <div
                  key={hw.id}
                  data-testid="homework-card"
                  data-homework-id={hw.id}
                  className={cn(
                    'p-5 rounded-xl border transition-all hover:shadow-sm',
                    overdue && status === 'not_submitted'
                      ? 'border-red-200 bg-red-50'
                      : 'border-gray-200 bg-white'
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{hw.title}</h3>
                        {overdue && status === 'not_submitted' && (
                          <Badge variant="error">Просрочено</Badge>
                        )}
                      </div>
                      {hw.description && (
                        <p className="text-sm text-gray-500 mb-2">{hw.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-gray-400">
                        {hw.due_date ? (
                          <span className="flex items-center gap-1">
                            <Clock size={12} />До {formatDate(hw.due_date)}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Clock size={12} />Дедлайн задаётся при назначении
                          </span>
                        )}
                        <span>Макс: {hw.max_score} б.</span>
                        <span>{groupName}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {canReview ? (
                        <>
                          <Badge variant="info">{subList.length} сдали</Badge>
                          {canCreate && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setAssignTarget({
                                id: hw.id,
                                title: hw.title,
                                topic_id: hw.topic_id,
                                max_score: hw.max_score,
                              })}
                            >
                              <Send size={14} className="mr-1.5" />Назначить
                            </Button>
                          )}
                          {submittedCount > 0 && (
                            <Button
                              size="sm"
                              onClick={() => navigate(`/homeworks/${hw.id}/review`)}
                            >
                              Проверить ({submittedCount})
                            </Button>
                          )}
                        </>
                      ) : (
                        <>
                          <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full', HW_STATUS_COLORS[status] || '')}>
                            {HW_STATUS_LABELS[status] || status}
                          </span>
                          {hw._sub?.score != null && (
                            <span className="text-sm font-bold text-primary-600">
                              {hw._sub.score}/{hw.max_score}
                            </span>
                          )}
                          {status === 'checked' && hw._sub?.id && getPrimarySubmissionFilePath(hw._sub) && (
                            <Button
                              size="sm"
                              variant="secondary"
                              data-testid="view-review-button"
                              onClick={() => {
                                const filePath = getPrimarySubmissionFilePath(hw._sub)
                                if (!filePath) return
                                setStudentReview({ id: hw._sub.id, title: hw.title, file_url: filePath, filePaths: getSubmissionFilePaths(hw._sub) })
                              }}
                            >
                              Посмотреть проверку
                            </Button>
                          )}
                          {(status === 'not_submitted' || status === 'revision') && (
                            <Button
                              size="sm"
                              data-testid="submit-homework-button"
                              onClick={() => setSubmitTarget({
                                id: hw.id, title: hw.title, max_score: hw.max_score, file_url: hw.file_url,
                                isResubmit:      status === 'revision',
                                previousFileUrl: getPrimarySubmissionFilePath(hw._sub),
                                previousFilePaths: getSubmissionFilePaths(hw._sub),
                                feedback:        hw._sub?.feedback ?? null,
                              })}
                            >
                              {status === 'revision' ? 'Пересдать' : 'Сдать'}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {hw.file_url && (
                    <div className="mt-3">
                      <SignedFileLink
                        bucket="homeworks"
                        url={hw.file_url}
                        className="inline-flex items-center gap-2 text-xs text-primary-600 hover:text-primary-800 bg-primary-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <FileText size={13} />
                        Открыть файл задания
                      </SignedFileLink>
                    </div>
                  )}

                  {hw._sub?.feedback && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                      <strong>Комментарий:</strong> {hw._sub.feedback}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Modals */}
      <SubmitHomeworkModal
        open={!!submitTarget}
        onClose={() => setSubmitTarget(null)}
        onSubmitted={reload}
        homework={submitTarget}
        studentId={studentId}
        isResubmit={submitTarget?.isResubmit}
        previousFileUrl={submitTarget?.previousFileUrl}
        previousFilePaths={submitTarget?.previousFilePaths}
        feedback={submitTarget?.feedback}
      />
      <AssignHomeworkModal
        open={!!assignTarget}
        onClose={() => setAssignTarget(null)}
        onAssigned={reload}
        homework={assignTarget}
      />
      {studentReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setStudentReview(null)} />
          <div className="relative z-10 flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,.08)]">
              <div><h2 className="font-semibold text-gray-900">Проверенная работа</h2><p className="text-xs text-gray-500">{studentReview.title}</p></div>
              <button type="button" aria-label="Закрыть" onClick={() => setStudentReview(null)} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-[transform,background-color] hover:bg-gray-100 active:scale-[0.96]"><X size={19} /></button>
            </div>
            <div className="overflow-auto p-2 sm:p-4">
              <Suspense fallback={<div className="flex min-h-64 items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500">Загрузка проверенной работы…</div>}>
                <SubmissionReviewer submissionId={studentReview.id} filePath={studentReview.file_url} readOnly />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
