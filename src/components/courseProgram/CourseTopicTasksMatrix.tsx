import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Loader2, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'
import {
  buildTopicTasksMatrix,
  type MatrixCell,
  type TopicTasksMatrixRow,
} from '@/lib/topicTasksMatrix'

// Типы базы не перегенерированы после PENDING_174 — RPC зовётся через `any`,
// результат типизируется локально (`TopicTasksMatrixRow`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Ширина закреплённого первого столбца. Фиксированная, а не «по содержимому»:
 * иначе длинная фамилия на телефоне забирает все 390 px, и темы уезжают за
 * экран целиком — таблица выглядит пустой. Имя обрезается, полное — в `title`.
 */
const FIRST_COL = 'w-[9.5rem] sm:w-56 lg:w-72'

/**
 * «Задачи к уроку» по всему курсу: таблица «ученик × тема» (§174).
 *
 * Одна RPC на курс (`course_topic_tasks_matrix`), а не запрос на тему: у
 * живого курса до 170 тем. Считает сервер тем же способом, что и окно темы
 * (§164) — числа здесь и там обязаны совпадать.
 *
 * Столбцы — только темы с набором задач: пустые столбцы — шум. Ячейка —
 * «закрыто / всего», цвет по смыслу (§152): всё закрыто — зелёный, часть —
 * янтарный, ноль при наличии ответов — серый с числом, тему не открывал —
 * пустая «—». На телефоне первый столбец закреплён, темы прокручиваются
 * внутри своего контейнера, страница целиком по горизонтали не едет (§158).
 */
export function CourseTopicTasksMatrix({
  courseId,
  templateTitle = null,
  refreshKey = 0,
}: {
  courseId: string
  /** Название каркаса, если курс — копия: подсказка в пустом состоянии. */
  templateTitle?: string | null
  refreshKey?: number
}) {
  const [rows, setRows] = useState<TopicTasksMatrixRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await db.rpc('course_topic_tasks_matrix', { p_course_id: courseId })
        if (cancelled) return
        if (err) throw new Error(err.message)
        setRows(((data ?? []) as TopicTasksMatrixRow[]))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить задачи к уроку')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [courseId, refreshKey])

  const matrix = useMemo(() => buildTopicTasksMatrix(rows), [rows])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
        <Loader2 size={18} className="animate-spin" />
        Загрузка…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
        <div className="flex gap-2">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    )
  }

  if (matrix.topics.length === 0) {
    return (
      <div
        data-testid="tasks-matrix-empty"
        className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-10 text-center"
      >
        <p className="text-sm font-medium text-gray-700">Задачи к уроку ещё не прикреплены</p>
        <p className="mt-2 text-xs text-gray-500">
          {templateTitle
            ? <>Прикрепляются в каркасе курса «{templateTitle}» → тема → «Задачи» → «Подобрать в каталоге»</>
            : <>Прикрепляются в окне темы → «Задачи» → «Подобрать в каталоге»</>}
        </p>
      </div>
    )
  }

  if (matrix.students.length === 0) {
    return (
      <div
        data-testid="tasks-matrix-no-students"
        className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-10 text-center"
      >
        <Users size={32} className="mx-auto mb-3 text-gray-400 opacity-30" />
        <p className="text-sm font-medium text-gray-700">В курсе пока нет учеников</p>
        <p className="mt-1 text-xs text-gray-500">
          Задачи прикреплены к {matrix.topics.length} {plural(matrix.topics.length, 'теме', 'темам', 'темам')} — таблица появится с первым учеником
        </p>
      </div>
    )
  }

  return (
    <div
      data-testid="tasks-matrix"
      className="max-w-full overflow-x-auto rounded-lg border border-gray-200"
    >
      {/* min-w-full, не w-full: на телефоне таблица шире экрана и должна
          сохранять естественные ширины столбцов, а не ужимать их. */}
      <table className="w-max min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th
              scope="col"
              className="sticky left-0 z-10 bg-gray-50 px-3 py-2.5 text-left text-xs font-medium text-gray-500 sm:px-4"
            >
              <div className={FIRST_COL}>Ученик</div>
            </th>
            {matrix.topics.map(t => (
              <th
                key={t.id}
                scope="col"
                title={t.title}
                className="px-2 py-2.5 text-center text-xs font-medium text-gray-500"
              >
                <div className="w-24 truncate sm:w-28 lg:w-36">{t.title}</div>
                <div className="mt-0.5 font-normal text-gray-400">
                  {t.tasksTotal} {plural(t.tasksTotal, 'задача', 'задачи', 'задач')}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.students.map((s, idx) => (
            <tr
              key={s.id}
              data-testid="tasks-matrix-row"
              className={cn('border-b border-gray-100', idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')}
            >
              <td className="sticky left-0 z-10 bg-inherit px-3 py-2 sm:px-4">
                <div className={FIRST_COL}>
                  <Link
                    to={`/students/${s.id}?course=${courseId}`}
                    data-testid="tasks-matrix-student-link"
                    className="block truncate text-sm font-medium text-gray-900 hover:text-primary-700 hover:underline"
                    title={s.name}
                  >
                    {s.name}
                  </Link>
                  <div
                    className="mt-0.5 truncate text-xs text-gray-500"
                    title={`решено ${s.closedTotal} из ${s.tasksTotal} по курсу`}
                  >
                    решено {s.closedTotal} из {s.tasksTotal}<span className="hidden sm:inline"> по курсу</span>
                  </div>
                </div>
              </td>
              {s.cells.map(c => (
                <td key={c.topicId} className="px-2 py-2 text-center">
                  <Cell cell={c} />
                </td>
              ))}
            </tr>
          ))}
          <tr data-testid="tasks-matrix-footer" className="border-t-2 border-gray-200 bg-gray-50">
            <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 sm:px-4">
              <div className={FIRST_COL}>Решили все</div>
            </td>
            {matrix.footer.map(f => (
              <td
                key={f.topicId}
                className="whitespace-nowrap px-2 py-2 text-center text-xs text-gray-600"
                title={`решили все: ${f.doneStudents} из ${f.students} ${plural(f.students, 'ученика', 'учеников', 'учеников')}`}
              >
                <span className={cn(f.doneStudents > 0 && f.doneStudents === f.students && 'font-semibold text-green-700')}>
                  {f.doneStudents} из {f.students}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/**
 * Ячейка. Цвет — по СМЫСЛУ (§152): зелёный только когда закрыто всё; серый с
 * числом — «отвечал, но не закрыл ничего»: это не то же самое, что не открывал.
 */
function Cell({ cell }: { cell: MatrixCell }) {
  if (cell.state === 'untouched') {
    return (
      <span data-testid="tasks-cell" data-state="untouched" title="тему не открывал" className="text-sm text-gray-300">
        —
      </span>
    )
  }
  const hint = `по ответу ${cell.closedAuto} · по разбору ${cell.closedSelf}`
  return (
    <span
      data-testid="tasks-cell"
      data-state={cell.state}
      title={hint}
      className={cn(
        'inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium tabular-nums',
        cell.state === 'done'    && 'bg-green-50 text-green-700',
        cell.state === 'partial' && 'bg-amber-50 text-amber-700',
        cell.state === 'zero'    && 'bg-gray-100 text-gray-600',
      )}
    >
      {cell.closed} / {cell.total}
    </span>
  )
}
