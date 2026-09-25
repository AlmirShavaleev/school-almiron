import { useEffect, useState } from 'react'
import { X, Loader2, Check, Save, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { notifyMockExamResult } from '@/utils/notify'
import {
  checkResultRow,
  isBlankRow,
  scoreIsNew,
  type MockExamField,
  type MockExamResultValue,
} from '@/lib/mockExamResults'

/**
 * §215. Ввод результатов пробника.
 *
 * Три починки, и первая — корень остальных:
 *
 *  1. Модалка читала и писала колонку `feedback`, которой в
 *     `mock_exam_results` нет: там `notes`. Каждое сохранение возвращало
 *     ошибку базы, и за три месяца при девяти пробниках в таблице осталось
 *     ноль строк. Заодно не работал и подхват: чтение падало на том же
 *     несуществующем поле.
 *  2. Колонки `part1_score` и `part2_score` в таблице есть, а полей не было.
 *     Разбивка «первая часть / вторая часть» — то, на чём строится отчёт
 *     родителю.
 *  3. Уведомление слалось по ВСЕМ заполненным строкам при каждом
 *     сохранении: правка одной опечатки будила всю группу.
 *
 * Правила ввода вынесены в `lib/mockExamResults` — чистый модуль под
 * тестами. Здесь остаётся только показ.
 */

interface StudentRow {
  student_id: string
  profile_id: string
  full_name:  string
  avatar_url: string | null
  score:      string
  part1:      string
  part2:      string
  notes:      string
}

/** Что лежало в базе на момент открытия — для «балл изменился?». */
type LoadedRow = { score: number }

/** Строка `mock_exam_results` в том виде, в каком её отдаёт PostgREST. */
interface SavedResult {
  student_id: string
  score: number | null
  part1_score: number | null
  part2_score: number | null
  notes: string | null
}

interface GroupStudentRow {
  student_id: string
  students?: {
    profile_id?: string | null
    profiles?: { full_name?: string | null; avatar_url?: string | null } | null
  } | null
}

/**
 * Узкий вид клиента для таблицы, которой нет в сгенерированных типах.
 * Лучше `as any`: ошибку в имени колонки он по-прежнему не поймает, но и
 * остальной файл не теряет типизацию.
 */
interface SupabaseLike {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): Promise<{ data: unknown; error: { message?: string } | null }> }
    upsert(rows: unknown[], options: { onConflict: string }): Promise<{ error: { message?: string } | null }>
  }
}

interface Props {
  open:     boolean
  onClose:  () => void
  onSaved:  () => void
  examId:   string | null
  groupId:  string | null
  maxScore: number
  examTitle?: string
}

const numberField = 'w-16 rounded-lg border px-2 py-1.5 text-center text-sm font-bold focus:outline-none focus:ring-2'

export function MockExamResultsModal({ open, onClose, onSaved, examId, groupId, maxScore, examTitle }: Props) {
  const [rows,    setRows]    = useState<StudentRow[]>([])
  const [loaded,  setLoaded]  = useState<Record<string, LoadedRow>>({})
  const [errors,  setErrors]  = useState<Record<string, { field: MockExamField; message: string }>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    if (!open || !groupId || !examId) return
    setLoading(true)
    setSaved(false)
    setErrors({})
    setSaveError(null)

    async function load() {
      const { data: rawGroup } = await supabase
        .from('group_students')
        .select('student_id, students(id, profile_id, profiles(full_name, avatar_url))')
        .eq('group_id', groupId!)

      // Колонки — те, что есть в таблице. Именно здесь и ломался подхват
      // введённого: `feedback` в `mock_exam_results` не существует, и запрос
      // возвращал ошибку вместо уже сохранённых строк.
      // `supabase as any` — как в `useHomeworkReviewTasks`: сгенерированные
      // типы отстают от прода (CLAUDE.md — руками их не дописывать).
      const { data: existing } = await (supabase as unknown as SupabaseLike)
        .from('mock_exam_results')
        .select('student_id, score, part1_score, part2_score, notes')
        .eq('mock_exam_id', examId!)

      const existMap: Record<string, SavedResult> = {}
      for (const r of (existing || []) as SavedResult[]) existMap[r.student_id] = r

      setLoaded(Object.fromEntries(
        Object.entries(existMap).map(([id, r]) => [id, { score: Number(r.score) }]),
      ))
      setRows(((rawGroup || []) as unknown as GroupStudentRow[]).map(g => {
        const saved = existMap[g.student_id]
        return {
          student_id: g.student_id,
          profile_id: g.students?.profile_id || '',
          full_name:  g.students?.profiles?.full_name || '—',
          avatar_url: g.students?.profiles?.avatar_url || null,
          score: saved?.score != null ? String(saved.score) : '',
          part1: saved?.part1_score != null ? String(saved.part1_score) : '',
          part2: saved?.part2_score != null ? String(saved.part2_score) : '',
          notes: saved?.notes || '',
        }
      }))
      setLoading(false)
    }
    load()
  }, [open, groupId, examId])

  /** Правка любого поля снимает прежнюю ошибку этой строки: человек уже чинит. */
  function patch(studentId: string, part: Partial<StudentRow>) {
    setRows(prev => prev.map(r => (r.student_id === studentId ? { ...r, ...part } : r)))
    setErrors(prev => {
      if (!prev[studentId]) return prev
      const next = { ...prev }
      delete next[studentId]
      return next
    })
    setSaveError(null)
  }

  async function handleSave() {
    if (!examId) return

    // Сначала проверяем ВСЁ и только потом пишем: сохранить половину строк,
    // а про остальные показать ошибку — значит оставить преподавателя гадать,
    // что уехало, а что нет.
    const nextErrors: Record<string, { field: MockExamField; message: string }> = {}
    const ready: { studentId: string; profileId: string; value: MockExamResultValue }[] = []
    for (const row of rows) {
      const check = checkResultRow(row, maxScore)
      if (check.error) {
        nextErrors[row.student_id] = check.error
        continue
      }
      if (check.value) ready.push({ studentId: row.student_id, profileId: row.profile_id, value: check.value })
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setSaveError('Проверьте выделенные строки — ничего не сохранено')
      return
    }
    if (ready.length === 0) return

    setSaving(true)
    setSaveError(null)
    const { error } = await (supabase as unknown as SupabaseLike)
      .from('mock_exam_results')
      .upsert(
        ready.map(r => ({ mock_exam_id: examId, student_id: r.studentId, ...r.value })),
        { onConflict: 'mock_exam_id,student_id' },
      )
    setSaving(false)

    if (error) {
      // Ошибку показываем В МОДАЛКЕ и введённого не теряем: `alert` закрывал
      // разговор ничем и уводил человека с экрана.
      setSaveError(error.message || 'Не удалось сохранить результаты')
      return
    }

    // §215. Уведомляем только тех, у кого балл появился или изменился.
    const examTitleStr = examTitle || 'Пробный экзамен'
    for (const r of ready) {
      if (!r.profileId) continue
      if (!scoreIsNew(r.value, loaded[r.studentId])) continue
      notifyMockExamResult(r.profileId, examTitleStr, r.value.score, maxScore)
    }

    // Сохранённое становится новой точкой отсчёта: второе нажатие подряд
    // уведомлений уже не шлёт.
    setLoaded(prev => {
      const next = { ...prev }
      for (const r of ready) next[r.studentId] = { score: r.value.score }
      return next
    })

    setSaved(true)
    onSaved()
    setTimeout(() => { setSaved(false); onClose() }, 800)
  }

  if (!open) return null

  const filledCount = rows.filter(r => !isBlankRow(r)).length
  // Среднее — по строкам с читаемым баллом. Недописанное («1», пока человек
  // печатает «12») в среднее попадает, и это верно: цифра справочная.
  const scored = rows
    .filter(r => String(r.score).trim() !== '')
    .map(r => Number(String(r.score).trim()))
    .filter(n => Number.isFinite(n))
  const avg = scored.length > 0 ? Math.round(scored.reduce((sum, n) => sum + n, 0) / scored.length) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div data-testid="mock-exam-results-modal" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col z-10">

        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">Результаты</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {examTitle} · макс. {maxScore} б.
              {avg != null && <span className="ml-2 text-primary-600 font-medium">среднее: {avg}</span>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Закрыть" className="text-gray-400 hover:text-gray-600 ml-3"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" />Загрузка…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">В группе нет студентов</div>
          ) : (
            rows.map(row => {
              const error = errors[row.student_id]
              const bad = (field: MockExamField) =>
                error != null && (error.field === field || (error.field === 'parts' && (field === 'part1' || field === 'part2')))
              const scoreNum = Number(row.score)
              const pct = row.score !== '' && Number.isFinite(scoreNum) && maxScore > 0
                ? Math.round(scoreNum / maxScore * 100)
                : null
              return (
                <div
                  key={row.student_id}
                  data-testid="mock-exam-result-row"
                  data-student={row.student_id}
                  className={cn(
                    'rounded-xl border p-3 space-y-2',
                    error ? 'border-red-300 bg-red-50/40' : 'border-gray-100',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-sm shrink-0 overflow-hidden">
                      {row.avatar_url
                        ? <img src={row.avatar_url} alt="" className="w-full h-full object-cover" />
                        : row.full_name.charAt(0)
                      }
                    </div>
                    <span className="min-w-0 flex-1 text-sm font-medium text-gray-800">{row.full_name}</span>

                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={maxScore}
                        value={row.score}
                        onChange={e => patch(row.student_id, { score: e.target.value })}
                        placeholder="—"
                        aria-label={`Общий балл: ${row.full_name}`}
                        aria-invalid={bad('score') || undefined}
                        className={cn(numberField, bad('score')
                          ? 'border-red-400 text-red-700 focus:ring-red-400'
                          : 'border-gray-200 text-primary-700 focus:ring-primary-500')}
                      />
                      <span className="text-xs text-gray-400">/ {maxScore}</span>
                      {pct != null && (
                        <span className={cn(
                          'text-xs font-semibold w-10 text-right',
                          // Ошибочный балл не красим «зелёным, всё хорошо»:
                          // 101 % из 100 не повод для зелёного.
                          bad('score') ? 'text-red-600'
                            : pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-500',
                        )}>{pct}%</span>
                      )}
                    </div>
                  </div>

                  {pct != null && (
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden mx-11">
                      <div
                        className={cn('h-full rounded-full transition-all',
                          bad('score') ? 'bg-red-400'
                            : pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-400')}
                        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                      />
                    </div>
                  )}

                  {/*
                    §215. Части — необязательные: деление на первую и вторую
                    есть не у каждого пробника, и пустое поле здесь значит
                    «деления нет», а не «ноль баллов».
                  */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-11">
                    <label className="flex items-center gap-1.5 text-xs text-gray-500">
                      1 часть
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={maxScore}
                        value={row.part1}
                        onChange={e => patch(row.student_id, { part1: e.target.value })}
                        placeholder="—"
                        aria-label={`Первая часть: ${row.full_name}`}
                        aria-invalid={bad('part1') || undefined}
                        className={cn(numberField, 'w-14 font-semibold', bad('part1')
                          ? 'border-red-400 text-red-700 focus:ring-red-400'
                          : 'border-gray-200 text-gray-700 focus:ring-primary-400')}
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-500">
                      2 часть
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={maxScore}
                        value={row.part2}
                        onChange={e => patch(row.student_id, { part2: e.target.value })}
                        placeholder="—"
                        aria-label={`Вторая часть: ${row.full_name}`}
                        aria-invalid={bad('part2') || undefined}
                        className={cn(numberField, 'w-14 font-semibold', bad('part2')
                          ? 'border-red-400 text-red-700 focus:ring-red-400'
                          : 'border-gray-200 text-gray-700 focus:ring-primary-400')}
                      />
                    </label>
                    <span className="text-[11px] text-gray-400">части необязательны</span>
                  </div>

                  {error && (
                    <p data-testid="mock-exam-row-error" className="flex items-center gap-1 pl-11 text-xs font-medium text-red-600">
                      <AlertCircle size={12} />
                      {error.message}
                    </p>
                  )}

                  {/* §215. В базе это `notes`, и называется оно заметкой. */}
                  <input
                    type="text"
                    value={row.notes}
                    onChange={e => patch(row.student_id, { notes: e.target.value })}
                    placeholder="Заметка (необязательно)"
                    aria-label={`Заметка: ${row.full_name}`}
                    className="w-full border border-gray-100 rounded-lg px-3 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-400 bg-gray-50"
                  />
                </div>
              )
            })
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 shrink-0 space-y-2">
          {saveError && (
            <p data-testid="mock-exam-save-error" className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
              <AlertCircle size={13} />
              {saveError}
            </p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{filledCount} / {rows.length} заполнено</span>
            <div className="flex items-center gap-2">
              {saved && (
                <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                  <Check size={13} />Сохранено
                </span>
              )}
              <Button variant="secondary" size="sm" onClick={onClose}>Отмена</Button>
              <Button data-testid="mock-exam-save" size="sm" onClick={handleSave} loading={saving} disabled={filledCount === 0}>
                <Save size={14} className="mr-1" />Сохранить результаты
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
