import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  ATTEMPT_STATUS_LABEL,
  ATTEMPT_STATUS_TONE,
  gradeScaleMax,
  type GradeScale,
  type TopicHomeworkAttemptStatus,
} from '@/lib/topicHomework'
import { cn } from '@/utils/cn'

interface SubmissionRow {
  attemptId: string
  studentName: string
  status: TopicHomeworkAttemptStatus
  /** Когда сдано; у черновика сдачи ещё не было — тогда когда начато. */
  at: string | null
  score: number | null
}

/**
 * Аккордеон «Работы учеников» в разделе ДЗ темы.
 *
 * Это НЕ возврат блока, снесённого в §75. Тогда убирали полный просмотрщик:
 * он тянул попытки, файлы попыток, вердикты и имена всего курса сразу при
 * открытии модалки темы — и дублировал очередь проверки. Здесь список, четыре
 * поля в строке и ссылка; данные грузятся только при раскрытии, как у
 * аккордеона оповещений из того же §75.
 *
 * Видят преподаватель и куратор курса: чтение держит RLS через
 * `topic_homework_attempts_select` → `topic_homework_can_manage` →
 * `course_is_staff`, куда куратор входит с §86. Своей проверки роли здесь нет
 * намеренно — две независимые проверки прав неминуемо разъезжаются.
 */
export function TopicHomeworkSubmissions({
  homeworkId,
  gradeScale,
  className,
}: {
  homeworkId: string
  gradeScale: GradeScale | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<SubmissionRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: attempts, error: aErr } = await supabase
        .from('topic_homework_attempts')
        .select('id, student_id, status, submitted_at, created_at')
        .eq('homework_id', homeworkId)
        .order('created_at', { ascending: false })
      if (aErr) throw new Error(aErr.message)

      const list = (attempts ?? []) as Array<{
        id: string; student_id: string; status: TopicHomeworkAttemptStatus
        submitted_at: string | null; created_at: string
      }>
      if (list.length === 0) { setRows([]); return }

      // Имена и вердикты — отдельными запросами, а не вложенным select с
      // `!inner`: при нехватке прав на одну из таблиц такой джойн молча
      // выбрасывает строки, и список выглядит пустым вместо ошибки (ловушка
      // из CLAUDE.md). Тем же способом их берёт очередь проверки.
      const studentIds = Array.from(new Set(list.map(a => a.student_id)))
      const attemptIds = list.map(a => a.id)
      const [studentsRes, reviewsRes] = await Promise.all([
        supabase.from('students').select('id, profiles!inner(full_name)').in('id', studentIds),
        supabase.from('topic_homework_reviews').select('attempt_id, score, created_at').in('attempt_id', attemptIds).order('created_at'),
      ])

      const names: Record<string, string> = {}
      for (const s of (studentsRes.data ?? []) as any[]) names[s.id] = s.profiles?.full_name ?? 'Ученик'

      // Вердиктов на попытку может быть несколько; берём последний по времени.
      const scoreByAttempt: Record<string, number | null> = {}
      for (const r of (reviewsRes.data ?? []) as any[]) scoreByAttempt[r.attempt_id] = r.score ?? null

      setRows(list.map(a => ({
        attemptId: a.id,
        studentName: names[a.student_id] ?? 'Ученик',
        status: a.status,
        at: a.submitted_at ?? a.created_at,
        score: scoreByAttempt[a.id] ?? null,
      })))
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось загрузить работы')
    } finally {
      setLoading(false)
    }
  }, [homeworkId])

  // Только при раскрытии: закрытый аккордеон не должен стоить ни одного
  // запроса — модалку темы открывают и ради других правок.
  useEffect(() => {
    if (open && rows === null) void load()
  }, [open, rows, load])

  const max = gradeScaleMax(gradeScale)

  return (
    <div className={cn('rounded-xl border border-gray-200', className)}>
      <button
        type="button"
        data-testid="homework-submissions-accordion"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        {open ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
        <Users size={14} className="text-gray-400" />
        Работы учеников
        {rows !== null && (
          <span className="ml-auto text-xs font-normal text-gray-400">
            сдач: {rows.length}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-3 py-2.5">
          {loading && (
            <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Загружаем работы…
            </div>
          )}

          {error && (
            <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {!loading && rows !== null && rows.length === 0 && (
            <p className="py-2 text-sm text-gray-400">Работ пока нет</p>
          )}

          {!loading && rows !== null && rows.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {rows.map(r => (
                <li key={r.attemptId} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{r.studentName}</span>

                  <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium', ATTEMPT_STATUS_TONE[r.status])}>
                    {ATTEMPT_STATUS_LABEL[r.status]}
                  </span>

                  <span className="shrink-0 text-xs text-gray-400">{formatAt(r.at)}</span>

                  <span className="w-16 shrink-0 text-right text-xs text-gray-500">
                    {r.score == null ? '—' : max == null ? r.score : `${r.score} / ${max}`}
                  </span>

                  {/*
                    Переход в существующий оверлей проверки. Сам оверлей живёт
                    состоянием страницы очереди, роута у него нет, поэтому
                    ссылка ведёт на очередь с номером работы — страница
                    открывает её сама (одноразово, без синхронизации адреса).
                  */}
                  <Link
                    to={`/homework-queue?attempt=${r.attemptId}`}
                    title="Открыть работу в проверке"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:border-primary-300 hover:text-primary-700"
                  >
                    <ExternalLink size={11} />
                    Проверить
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function formatAt(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
