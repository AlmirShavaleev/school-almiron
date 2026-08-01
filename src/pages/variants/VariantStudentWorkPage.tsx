import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Calendar, CheckCircle2,
  Clock, FileText, Loader2, Save, UserRound,
} from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { useVariantStudentWork, type WorkItem } from '@/hooks/useVariantStudentWork'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'

const GRADING_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  not_submitted: { label: 'Не сдано',         cls: 'bg-gray-100 text-gray-500' },
  auto_graded:   { label: 'Проверено авто',   cls: 'bg-green-100 text-green-700' },
  needs_review:  { label: 'Требует проверки', cls: 'bg-amber-100 text-amber-700' },
  graded:        { label: 'Проверено',        cls: 'bg-green-100 text-green-700' },
}

function getAutoAnswerStatus(pointsEarned: number | null, pointsMax: number | null) {
  if (pointsEarned === null) return null
  const max = pointsMax ?? 1
  if (pointsEarned >= max) return { label: '✓ Верно', cls: 'text-green-600' }
  if (pointsEarned > 0) return { label: '◐ Частично верно', cls: 'text-amber-600' }
  return { label: '✗ Неверно', cls: 'text-red-500' }
}

function SignedImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    supabase.storage.from('variant-solutions').createSignedUrl(path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl ?? null))
  }, [path])
  if (!url) return <span className="text-xs text-gray-400">Загрузка…</span>
  const isImage = /\.(jpe?g|png|webp)$/i.test(path)
  if (isImage) {
    return <img src={url} alt="решение" className="max-h-64 rounded-lg border border-gray-200" />
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:underline">
      <FileText size={14} />Открыть PDF
    </a>
  )
}

function ItemCard({ item, grade, onPointsChange, onCommentChange, onSave, disabled }: {
  item:            WorkItem
  grade?:          { points: string; comment: string; saving: boolean; saved: boolean; error: string | null }
  onPointsChange:  (v: string) => void
  onCommentChange: (v: string) => void
  onSave:          () => void
  disabled:        boolean
}) {
  const ans     = item.answer
  const gsLabel = GRADING_STATUS_LABEL[ans.grading_status] ?? GRADING_STATUS_LABEL.not_submitted
  const autoStatus = item.grading_type === 'auto'
    ? getAutoAnswerStatus(ans.points_earned, ans.points_max ?? item.points)
    : null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Задача {item.item_position}
          </span>
          {item.grading_type === 'manual' && (
            <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5 font-medium">
              Развёрнутый ответ
            </span>
          )}
          <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${gsLabel.cls}`}>
            {gsLabel.label}
          </span>
        </div>
        <span className="text-xs text-gray-500">{item.points} б. макс.</span>
      </div>

      {/* Statement */}
      <div className="border-b border-gray-100 pb-4">
        <TaskContentRenderer html={resolveTaskHtml(item.statement_html, [])} />
      </div>

      {/* Student answer */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5">Ответ ученика</p>
        {ans.grading_status === 'not_answered' ? (
          <p className="text-sm text-gray-400 italic">Нет ответа</p>
        ) : (
          <>
            {ans.answer_raw && (
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap mb-2">
                {ans.answer_raw}
              </div>
            )}
            {item.attachments.length > 0 && (
              <div className="space-y-2">
                {item.attachments.map(att => (
                  <div key={att.id}>
                    <SignedImage path={att.storage_path} />
                    <p className="text-xs text-gray-400 mt-1">{att.file_name}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Correct answer (auto tasks) */}
      {item.grading_type === 'auto' && item.answer_html && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">Правильный ответ</p>
          <div className="text-sm font-medium text-green-700 bg-green-50 rounded-lg px-3 py-2 inline-block">
            <TaskContentRenderer html={resolveTaskHtml(item.answer_html, [])} className="text-green-700" />
          </div>
          {autoStatus && (
            <span className={`ml-2 text-xs font-medium ${autoStatus.cls}`}>
              {autoStatus.label}
              {ans.points_max !== null && (
                <span className="ml-1 opacity-80">{ans.points_earned ?? 0}/{ans.points_max}</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Grade criteria (manual tasks) */}
      {item.grading_type === 'manual' && item.grade_criteria_html && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
            Критерии оценки
          </summary>
          <TaskContentRenderer
            html={resolveTaskHtml(item.grade_criteria_html, [])}
            className="mt-2 text-gray-700"
          />
        </details>
      )}

      {/* Grade form (manual tasks with answer) */}
      {item.grading_type === 'manual' && ans.grading_status === 'pending_review' && grade && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-xs font-semibold text-amber-800">Выставить оценку</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Баллы (0–{item.points})</label>
              <input
                type="number"
                min={0}
                max={item.points}
                step={0.5}
                value={grade.points}
                onChange={e => onPointsChange(e.target.value)}
                disabled={disabled || grade.saving}
                className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50"
                data-testid={`grade-points-${item.item_id}`}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-gray-600 block mb-1">Комментарий (необязательно)</label>
              <textarea
                value={grade.comment}
                onChange={e => onCommentChange(e.target.value)}
                disabled={disabled || grade.saving}
                rows={2}
                placeholder="Объяснение оценки..."
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50"
                data-testid={`grade-comment-${item.item_id}`}
              />
            </div>
          </div>
          {grade.error && <p className="text-xs text-red-600">{grade.error}</p>}
          <button
            onClick={onSave}
            disabled={disabled || grade.saving || grade.points === ''}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            data-testid={`grade-save-${item.item_id}`}
          >
            {grade.saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Сохранить оценку
          </button>
        </div>
      )}

      {/* Already graded */}
      {item.grading_type === 'manual' && ans.grading_status === 'graded' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 space-y-1">
          <p className="text-xs font-semibold text-green-800">
            Оценка: <span className="font-bold">{ans.manual_points ?? ans.points_earned} / {item.points}</span>
          </p>
          {ans.teacher_comment && (
            <p className="text-sm text-green-700">{ans.teacher_comment}</p>
          )}
          {ans.graded_at && (
            <p className="text-xs text-green-600">
              {format(new Date(ans.graded_at), 'd MMM yyyy HH:mm', { locale: ru })}
            </p>
          )}
        </div>
      )}

      {/* Auto score */}
      {item.grading_type === 'auto' && ans.points_earned !== null && (
        <p className="text-sm text-gray-600">
          Баллы: <span className="font-semibold">{ans.points_earned} / {ans.points_max ?? item.points}</span>
        </p>
      )}
    </div>
  )
}

export function VariantStudentWorkPage() {
  const { variantId, studentAssignmentId } = useParams<{ variantId: string; studentAssignmentId: string }>()
  const navigate = useNavigate()
  const {
    work, loading, error, load,
    grades, setGradeField, saveGrade,
    finalizing, finalizeError, finalizeOk,
    finalizeGrading,
  } = useVariantStudentWork(studentAssignmentId)

  useEffect(() => { load() }, [load])

  const pendingCount = work?.items.filter(
    i => i.grading_type === 'manual' && i.answer.grading_status === 'pending_review'
  ).length ?? 0

  const canFinalize = pendingCount === 0 && work?.grading_status === 'needs_review'

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-10 text-center">
        <Loader2 size={28} className="animate-spin text-primary-500 mx-auto" />
      </div>
    )
  }

  if (error || !work) {
    return (
      <div className="max-w-4xl mx-auto py-10 text-center">
        <AlertTriangle size={40} className="text-red-400 mx-auto mb-3" />
        <p className="text-red-600 font-medium">{error ?? 'Работа не найдена'}</p>
        <button onClick={() => navigate(-1)} className="mt-3 text-sm text-primary-600 hover:underline">
          Назад
        </button>
      </div>
    )
  }

  const gStatus = GRADING_STATUS_LABEL[work.grading_status] ?? GRADING_STATUS_LABEL.not_submitted

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate(`/variants/${variantId}/assignments`)}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
        >
          <ArrowLeft size={18} />
        </button>
        <nav className="text-sm text-gray-500 flex items-center gap-1.5 min-w-0">
          <Link to="/variants" className="hover:text-primary-600">Варианты</Link>
          <span>/</span>
          <Link to={`/variants/${variantId}/assignments`} className="hover:text-primary-600 truncate max-w-[140px]">
            {work.variant_title}
          </Link>
          <span>/</span>
          <span className="text-gray-700 truncate">{work.student_name ?? 'Ученик'}</span>
        </nav>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">{work.student_name ?? '—'}</h1>
            {work.group_name && (
              <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
                <UserRound size={13} /> {work.group_name}
              </p>
            )}
          </div>
          <span className={`text-sm font-medium rounded-full px-3 py-1 ${gStatus.cls}`}>
            {gStatus.label}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
          <div className="rounded-lg bg-gray-50 p-2">
            <p className="text-xs text-gray-400">Отвечено</p>
            <p className="font-semibold">{work.answered_count ?? '—'} / {work.items.length}</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-2">
            <p className="text-xs text-gray-400">Автобалл</p>
            <p className="font-semibold">{work.auto_score ?? '—'}</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-2">
            <p className="text-xs text-gray-400">Итог</p>
            <p className="font-semibold">
              {work.score !== null && work.max_score !== null
                ? `${work.score} / ${work.max_score}`
                : work.grading_status === 'needs_review' ? 'Ожидает' : '—'}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-2">
            <p className="text-xs text-gray-400">%</p>
            <p className="font-semibold">
              {work.percentage !== null ? `${work.percentage}%` : '—'}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
          {work.started_at && (
            <span className="flex items-center gap-1">
              <Clock size={12} />
              Начато {format(new Date(work.started_at), 'd MMM yyyy HH:mm', { locale: ru })}
            </span>
          )}
          {work.submitted_at && (
            <span className="flex items-center gap-1">
              <CheckCircle2 size={12} />
              Сдано {format(new Date(work.submitted_at), 'd MMM yyyy HH:mm', { locale: ru })}
            </span>
          )}
          {work.due_at && (
            <span className="flex items-center gap-1">
              <Calendar size={12} />
              Дедлайн {format(new Date(work.due_at), 'd MMM yyyy HH:mm', { locale: ru })}
            </span>
          )}
          {work.reviewed_at && (
            <span className="flex items-center gap-1">
              <CheckCircle2 size={12} className="text-green-500" />
              Проверено {format(new Date(work.reviewed_at), 'd MMM yyyy HH:mm', { locale: ru })}
            </span>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="space-y-4 mb-6">
        {work.items.map(item => (
          <ItemCard
            key={item.item_id}
            item={item}
            grade={grades[item.item_id]}
            onPointsChange={v => setGradeField(item.item_id, 'points', v)}
            onCommentChange={v => setGradeField(item.item_id, 'comment', v)}
            onSave={() => saveGrade(item.item_id, item.points)}
            disabled={work.grading_status === 'graded'}
          />
        ))}
      </div>

      {/* Finalize section */}
      {work.grading_status === 'needs_review' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {finalizeOk ? (
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 size={18} />
              <span className="font-medium">Проверка завершена. Ученик получил уведомление.</span>
            </div>
          ) : (
            <>
              {pendingCount > 0 && (
                <p className="text-sm text-amber-700 mb-3">
                  Осталось оценить: {pendingCount} {pendingCount === 1 ? 'задание' : 'заданий'}
                </p>
              )}
              {finalizeError && (
                <p className="text-sm text-red-600 mb-3">{finalizeError}</p>
              )}
              <button
                onClick={finalizeGrading}
                disabled={!canFinalize || finalizing}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                data-testid="finalize-grading-btn"
              >
                {finalizing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Завершить проверку
              </button>
            </>
          )}
        </div>
      )}

      {work.grading_status === 'graded' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center gap-2 text-green-700">
          <CheckCircle2 size={18} />
          <span className="font-medium">
            Работа проверена. Итоговый балл: {work.score} / {work.max_score} ({work.percentage}%)
          </span>
        </div>
      )}
    </div>
  )
}
