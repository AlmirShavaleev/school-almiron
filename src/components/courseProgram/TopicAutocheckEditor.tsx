import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Loader2, Trash2 } from 'lucide-react'
import { SignedImage } from '@/components/ui/SignedImage'
import { VerdictMark } from '@/components/ui/VerdictMark'
import {
  deleteAutocheckTask,
  reorderAutocheckTasks,
  useTopicAutocheck,
  useTopicAutocheckResults,
} from '@/hooks/useTopicAutocheck'
import {
  AUTOCHECK_MAX_ATTEMPTS,
  formatCorrectAnswer,
  sortResults,
  type AutocheckResultStudent,
  type AutocheckTask,
  type ResultsSort,
} from '@/lib/autocheck'
import { plural } from '@/lib/plural'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'

/**
 * §266. Тренировочный урок в окне темы (учитель/админ): задачи с
 * автопроверкой — просмотр (условие, ответ, решение), порядок, удаление — и
 * таблица результатов класса. Загружает задачи скрипт
 * (`scripts/import-autocheck.mjs`) или RPC `topic_autocheck_import`: условия и
 * решения — картинки, свёрстанные тем же шаблоном, что PDF курса, и руками в
 * окне их не рисуют.
 */
export function TopicAutocheckEditor({ topicId, canEdit = true }: { topicId: string; canEdit?: boolean }) {
  const { state, loading, error, reload } = useTopicAutocheck(topicId)
  const results = useTopicAutocheckResults(topicId)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const tasks = state?.tasks ?? []

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir
    if (j < 0 || j >= tasks.length) return
    const ids = tasks.map(t => t.id)
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    setBusyId(tasks[index].id)
    const err = await reorderAutocheckTasks(topicId, ids)
    setBusyId(null)
    if (err) toast.error(err)
    reload()
    results.reload()
  }

  async function remove(task: AutocheckTask, n: number) {
    if (!window.confirm(`Удалить задачу № ${n} (${task.code})? Если по ней уже отвечали, удалить не получится.`)) return
    setBusyId(task.id)
    const err = await deleteAutocheckTask(task.id)
    setBusyId(null)
    if (err) { toast.error(err); return }
    toast.success('Задача удалена')
    reload()
    results.reload()
  }

  return (
    <div data-testid="autocheck-editor" className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900">
          Задачи с автопроверкой{tasks.length > 0 && <span className="text-gray-400"> · {tasks.length}</span>}
        </div>
        {loading && <Loader2 size={14} className="animate-spin text-primary-500" />}
      </div>
      <p className="text-xs leading-snug text-gray-500">
        Вместо ДЗ на проверку: ученик вводит ответ, {AUTOCHECK_MAX_ATTEMPTS} попытки на задачу, после закрытия видит решение.
        Оценка в журнал — доля решённых по 100-балльной шкале. Задачи загружает скрипт из папки темы «автопроверка».
      </p>

      {error && !state ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Задачи сейчас недоступны: {error}</p>
      ) : tasks.length === 0 && !loading ? (
        <p data-testid="autocheck-editor-empty" className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-400">
          Задач пока нет — их загрузит скрипт.
        </p>
      ) : (
        <ol className="divide-y divide-graphite-200 rounded-xl border border-graphite-200">
          {tasks.map((t, i) => {
            const open = openId === t.id
            return (
              <li key={t.id} data-testid="autocheck-editor-task" className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-[13px] font-extrabold text-primary-700 tabular-nums">№ {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : t.id)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{t.code}</span>
                      <span className="block truncate text-xs text-gray-500">
                        Ответ: {formatCorrectAnswer(t) ?? '—'}
                      </span>
                    </span>
                    <ChevronDown size={14} className={cn('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
                  </button>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <IconButton label="Выше" disabled={i === 0 || busyId !== null} onClick={() => void move(i, -1)}><ArrowUp size={14} /></IconButton>
                      <IconButton label="Ниже" disabled={i === tasks.length - 1 || busyId !== null} onClick={() => void move(i, 1)}><ArrowDown size={14} /></IconButton>
                      <IconButton label="Удалить" danger disabled={busyId !== null} onClick={() => void remove(t, i + 1)}>
                        {busyId === t.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </IconButton>
                    </div>
                  )}
                </div>
                {open && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <figure className="space-y-1">
                      <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Условие</figcaption>
                      <SignedImage bucket="topic-autocheck" path={t.statementPath} alt={`Условие ${t.code}`} className="block h-auto w-full rounded border border-gray-100" />
                    </figure>
                    <figure className="space-y-1">
                      <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Решение</figcaption>
                      {t.solutionPath
                        ? <SignedImage bucket="topic-autocheck" path={t.solutionPath} alt={`Решение ${t.code}`} className="block h-auto w-full rounded border border-gray-100" />
                        : <p className="text-xs text-gray-400">Решения нет</p>}
                    </figure>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <AutocheckResultsTable
        tasks={results.results?.tasks ?? []}
        students={results.results?.students ?? []}
        loading={results.loading}
        error={results.error}
      />
    </div>
  )
}

function IconButton({ label, onClick, disabled, danger, children }: {
  label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors disabled:opacity-30 sm:h-8 sm:w-8',
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-primary-50 hover:text-primary-700',
      )}
    >
      {children}
    </button>
  )
}

/** §266. Кто сколько решил: ученики × задачи, попытки, итог. */
export function AutocheckResultsTable({
  tasks,
  students,
  loading,
  error,
}: {
  tasks: Array<{ id: string; code: string; position: number }>
  students: AutocheckResultStudent[]
  loading?: boolean
  error?: string | null
}) {
  const [sort, setSort] = useState<ResultsSort>('name')
  const rows = sortResults(students, sort)
  const finished = students.filter(s => s.finished).length

  return (
    <div data-testid="autocheck-results" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900">
          Результаты класса
          {students.length > 0 && (
            <span className="font-normal text-gray-500"> · закончили {finished} из {students.length}</span>
          )}
        </div>
        {students.length > 1 && (
          <div role="group" aria-label="Порядок" className="inline-flex rounded-full border border-graphite-300 p-0.5 text-xs">
            {(['name', 'grade'] as const).map(k => (
              <button
                key={k}
                type="button"
                aria-pressed={sort === k}
                onClick={() => setSort(k)}
                className={cn('rounded-full px-2.5 py-1', sort === k ? 'bg-primary-600 font-semibold text-white' : 'text-graphite-600')}
              >
                {k === 'name' ? 'По имени' : 'Сначала слабые'}
              </button>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Результаты сейчас недоступны.</p>
      ) : loading && students.length === 0 ? (
        <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-gray-300" /></div>
      ) : students.length === 0 ? (
        <p className="text-xs text-gray-400">В классе пока нет учеников (у каркаса учеников нет).</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-graphite-200">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className="border-b border-graphite-200 bg-graphite-50 text-left text-[11px] font-semibold uppercase tracking-[0.03em] text-graphite-500">
                <th scope="col" className="sticky left-0 z-10 bg-graphite-50 px-3 py-2">Ученик</th>
                {/* Балл и «решено» — сразу за именем: на телефоне задачи уезжают вбок, итог должен быть виден. */}
                <th scope="col" className="px-2 py-2 text-right">Балл</th>
                <th scope="col" className="px-2 py-2 text-right">Решено</th>
                {tasks.map((t, i) => (
                  <th key={t.id} scope="col" className="px-1.5 py-2 text-center" title={t.code}>№{i + 1}</th>
                ))}
                <th scope="col" className="px-3 py-2 text-right">Попыток</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.studentId} data-testid="autocheck-results-row" className="border-b border-graphite-200 last:border-0">
                  <th scope="row" className="sticky left-0 z-10 max-w-[9rem] truncate bg-white px-3 py-2 text-left font-medium text-graphite-900">
                    {s.name}
                  </th>
                  <td className="px-2 py-2 text-right font-semibold">
                    {s.finished && s.grade !== null
                      ? <span className={cn(s.grade >= 90 ? 'text-verdict-ok-ink' : s.grade >= 50 ? 'text-graphite-900' : 'text-verdict-bad-ink')}>{s.grade}</span>
                      : <span className="font-normal text-graphite-400">—</span>}
                  </td>
                  <td className="px-2 py-2 text-right text-graphite-900">{s.solved} из {tasks.length}</td>
                  {tasks.map(t => {
                    const c = s.cells.get(t.id)
                    const state = !c || c.attempts === 0 ? 'none' : c.solved ? 'ok' : c.closed ? 'bad' : 'part'
                    const label = !c || c.attempts === 0
                      ? 'не начата'
                      : c.solved
                        ? `решена, ${c.attempts} ${plural(c.attempts, 'попытка', 'попытки', 'попыток')}`
                        : c.closed ? 'не решена, попытки закончились' : `в работе, ${c.attempts} ${plural(c.attempts, 'попытка', 'попытки', 'попыток')}`
                    return (
                      <td key={t.id} className="px-1.5 py-2 text-center" title={label}>
                        <span className="inline-flex items-center gap-0.5">
                          <VerdictMark state={state} size={16} label={label} />
                          {c && c.attempts > 0 && <span className="text-[11px] text-graphite-500">{c.attempts}</span>}
                        </span>
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right text-graphite-600">{s.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[13px] text-graphite-500">
        Значок — состояние задачи (зелёный — решена, красный — попытки закончились, половина — в работе), число рядом — попытки.
        Балл ставится, когда закрыты все задачи урока, и сразу попадает в журнал ДЗ.
      </p>
    </div>
  )
}
