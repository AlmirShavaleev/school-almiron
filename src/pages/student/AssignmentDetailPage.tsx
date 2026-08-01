import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Send, Paperclip, X, CheckCircle2, MessageSquare } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  useAssignmentDetail, useSubmitSolution,
  uploadSubmissionFile, deleteSubmissionFile, getSubmissionFileSignedUrl,
} from '@/hooks/useAssignments'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'
import { ASSIGNED_STATUS_LABELS, SUBMISSION_STATUS_LABELS } from '@/types/assignments'
import type { StudentAssignmentTask } from '@/types/assignments'
import type { CatalogTask } from '@/hooks/useCatalog'

/** Adapts the safe RPC row into the shape TaskDisplayCard expects.
 *  has_answer/has_solution are forced false — the RPC never returns
 *  answer_html/solution_html, so those toggle buttons must not appear. */
function toCatalogTask(t: StudentAssignmentTask): CatalogTask {
  return {
    id: t.catalog_task_id,
    external_id: t.external_id,
    section_id: '',
    subject: t.subject,
    exam_type: t.exam_type,
    statement_html: t.statement_html,
    answer_html: null,
    solution_html: null,
    solution_plan_html: null,
    grade_criteria_html: null,
    has_answer: false,
    has_solution: false,
    position: t.item_position,
    assets: t.assets,
  }
}

export function AssignmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const profile = useAuthStore(s => s.profile)
  const { data, loading, error, reload } = useAssignmentDetail(id)
  const { submit, loading: submitting, error: submitError } = useSubmitSolution()

  const [studentRowId, setStudentRowId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [files,   setFiles]   = useState<string[]>([])
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!profile) return
    supabase.from('students').select('id').eq('profile_id', profile.id).single()
      .then(({ data: s }: { data: { id: string } | null }) => setStudentRowId(s?.id ?? null))
  }, [profile])

  useEffect(() => {
    if (data?.submission) {
      setAnswers(data.submission.answers ?? {})
      setFiles(data.submission.files ?? [])
    }
  }, [data?.submission])

  // Resolve signed URLs for currently attached files
  useEffect(() => {
    let cancelled = false
    async function resolve() {
      const entries = await Promise.all(
        files.map(async path => [path, await getSubmissionFileSignedUrl(path)] as const),
      )
      if (cancelled) return
      setFileUrls(Object.fromEntries(entries.filter(([, url]) => url) as [string, string][]))
    }
    if (files.length) resolve()
    return () => { cancelled = true }
  }, [files])

  if (loading) return <PageSkeleton />
  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-3">
        <p className="text-red-600">{error ?? 'Задание не найдено'}</p>
        <Link to="/my-assignments" className="text-blue-600 hover:underline text-sm">Назад к заданиям</Link>
      </div>
    )
  }

  const { assignment, collection, items, submission } = data
  // Editing is only allowed with no submission yet, or after the teacher returned it
  const isLocked = !!submission && submission.status !== 'returned'

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !id || !studentRowId) return
    setUploading(true)
    const path = await uploadSubmissionFile(id, studentRowId, file)
    if (path) setFiles(f => [...f, path])
    setUploading(false)
  }

  async function handleRemoveFile(path: string) {
    setFiles(f => f.filter(p => p !== path))
    await deleteSubmissionFile(path)
  }

  async function handleSubmit() {
    if (!id) return
    setSuccess(false)
    const ok = await submit(id, answers, files)
    if (ok) { setSuccess(true); reload() }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/my-assignments" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={14} /> Мои задания
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{collection.title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {collection.subject} · {items.length} задание(й)
            {assignment.due_date && <> · срок до {new Date(assignment.due_date).toLocaleDateString('ru-RU')}</>}
            {' · '}{ASSIGNED_STATUS_LABELS[assignment.status]}
          </p>
        </div>
      </div>

      {submission && (
        <Card className={
          submission.status === 'accepted' ? 'bg-green-50 border-green-200' :
          submission.status === 'rejected' ? 'bg-red-50 border-red-200' :
          submission.status === 'returned' ? 'bg-amber-50 border-amber-200' :
          'bg-blue-50 border-blue-200'
        }>
          <p className="text-sm font-medium text-gray-800">
            Статус сдачи: {SUBMISSION_STATUS_LABELS[submission.status]}
          </p>
          {submission.score !== null && (
            <p className="text-sm text-gray-700 mt-1">Оценка: {submission.score}</p>
          )}
          {submission.teacher_comment && (
            <p className="flex items-start gap-1.5 text-sm text-gray-700 mt-2">
              <MessageSquare size={14} className="mt-0.5 flex-shrink-0" /> {submission.teacher_comment}
            </p>
          )}
        </Card>
      )}

      <div className="space-y-4">
        {items.map((item, idx) => (
          <div key={item.item_id} className="space-y-2">
            <TaskDisplayCard task={toCatalogTask(item)} number={idx + 1} />
            <div className="pl-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Ваш ответ</label>
              <textarea
                value={answers[item.catalog_task_id] ?? ''}
                onChange={e => setAnswers(a => ({ ...a, [item.catalog_task_id]: e.target.value }))}
                disabled={isLocked}
                rows={2}
                placeholder="Введите ответ…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
          </div>
        ))}
      </div>

      {/* File attachments */}
      <Card>
        <p className="text-sm font-medium text-gray-700 mb-2">Прикреплённые файлы</p>
        <div className="space-y-2">
          {files.map(path => (
            <div key={path} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
              {fileUrls[path] ? (
                <a href={fileUrls[path]} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-blue-600 hover:underline truncate">
                  <Paperclip size={13} /> {path.split('/').pop()}
                </a>
              ) : (
                <span className="flex items-center gap-1.5 text-gray-400 truncate">
                  <Paperclip size={13} /> {path.split('/').pop()}
                </span>
              )}
              {!isLocked && (
                <button onClick={() => handleRemoveFile(path)} className="text-gray-400 hover:text-red-500">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          {!isLocked && (
            <label className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg py-3 text-sm text-gray-500 cursor-pointer hover:border-blue-300 hover:text-blue-600 transition-colors">
              <Paperclip size={14} />
              {uploading ? 'Загрузка…' : 'Прикрепить файл'}
              <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading || !studentRowId} />
            </label>
          )}
        </div>
      </Card>

      {submitError && <p className="text-sm text-red-600">{submitError}</p>}
      {success && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
          <CheckCircle2 size={16} /> Решение отправлено
        </div>
      )}

      {!isLocked && (
        <Button onClick={handleSubmit} loading={submitting} className="w-full">
          <Send size={16} /> {submission ? 'Отправить заново' : 'Отправить'}
        </Button>
      )}
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-32" />
      <div className="h-8 bg-gray-200 rounded w-64" />
      {[1, 2, 3].map(n => <div key={n} className="h-24 bg-gray-100 rounded-xl" />)}
    </div>
  )
}
