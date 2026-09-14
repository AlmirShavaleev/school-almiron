import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, AlertCircle, Check, XCircle, Eye, CheckCircle2, ArrowLeft, ArrowRight } from 'lucide-react'
import type { useTopicTasks, TopicTaskRow } from '@/hooks/useTopicTasks'
import { CatalogTaskContent } from '@/components/catalog/CatalogTaskContent'
import type { CatalogTask } from '@/hooks/useCatalog'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

/**
 * Задачи к уроку (§162, §175) — «как в Stepik».
 *
 * Ничего не надо начинать и завершать: открыл урок, решаешь. Вердикт приходит
 * на каждую задачу отдельно, попыток сколько угодно, верный ответ запирает
 * задачу. Условие рендерится тем же `CatalogTaskContent`, что и каталог, —
 * не копия, поэтому картинки и таблицы выглядят одинаково.
 *
 * Задача без короткого ответа (вторая часть) вердикта не имеет: у неё кнопка
 * «Посмотреть решение», а после разбора — зелёная «Разобрал». Нажать её, не
 * открыв решение, нельзя — это проверяет сервер, не только кнопка.
 *
 * Неверный ответ — состояние карточки, а не строка под полем (§176): красная
 * плашка «Неверно · попытка N», поле красное с тем, что ввёл ученик, кнопка
 * «Проверить ещё раз». После первой попытки у задачи с коротким ответом
 * появляется «Посмотреть решение»; открытое решение переводит задачу в
 * самопроверку — поле исчезает, закрывает её «Разобрал», как вторую часть.
 *
 * На экране одна задача (§175): сверху лента квадратов по числу задач — по
 * ней видно, что решено, и по ней же переключаются; внизу «Назад / Дальше».
 * Текущая задача лежит в адресе (`?task=`), чтобы обновление страницы не
 * сбрасывало на первую. После верного ответа карточка НЕ перескакивает:
 * ученик читает разбор и сам жмёт «Дальше».
 *
 * Хук поднят на страницу темы: она же показывает «решено N из M» в шапке
 * группы. Иначе тот же запрос ушёл бы дважды за одно открытие урока.
 */
export function TopicTasksStudent({ tasks }: { tasks: ReturnType<typeof useTopicTasks> }) {
  const { rows, total, solved, loading, error, busyItem, answer, reveal, closeSelf } = tasks

  const [searchParams, setSearchParams] = useSearchParams()
  const urlTask = searchParams.get('task')

  // Текущая задача — та, что в адресе. Адрес здесь не запись «на память», а
  // единственный источник выбора: после верного ответа строки перезагружаются,
  // и «первая нерешённая» уехала бы вперёд — а карточка должна остаться на
  // месте, пока ученик читает разбор. Правило «первая нерешённая» работает
  // только пока в адресе задачи нет (или там чужая), и эффект ниже сразу
  // закрепляет выбор в адресе.
  const currentId = useMemo(() => {
    if (rows.length === 0) return null
    if (urlTask && rows.some(r => r.item_id === urlTask)) return urlTask
    return (rows.find(r => r.closed_by === null) ?? rows[0]).item_id
  }, [rows, urlTask])

  const select = useCallback((id: string) => {
    // Заменой записи, а не новой: «Назад» браузера должен уводить со
    // страницы, а не листать задачи.
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('task', id)
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    if (currentId && urlTask !== currentId) select(currentId)
  }, [currentId, urlTask, select])

  const currentIndex = rows.findIndex(r => r.item_id === currentId)
  const current = currentIndex >= 0 ? rows[currentIndex] : null

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Загрузка задач…
      </div>
    )
  }

  if (error && rows.length === 0) {
    return (
      <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    )
  }

  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 py-2">К этому уроку задач пока нет.</p>
  }

  const allSolved = solved === total
  const isLast = currentIndex === rows.length - 1

  return (
    <div className="space-y-4">
      {/* Лента сверху: видно, сколько решено и где ты, без прокрутки. */}
      <div className="sticky top-16 z-10 -mx-1 px-1 py-2 bg-white/90 backdrop-blur rounded-xl">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <TaskStrip rows={rows} currentId={currentId} onSelect={select} />
          <span className="shrink-0 text-sm font-semibold text-gray-900 flex items-center gap-2">
            Решено {solved} из {total}
            {allSolved && (
              <span className="text-xs font-medium text-emerald-700 inline-flex items-center gap-1">
                <CheckCircle2 size={13} /> всё решено
              </span>
            )}
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Одна карточка. `key` по задаче: черновик ответа и подсветка «неверно»
          принадлежат задаче, а не месту на экране. */}
      {current && (
        <TaskCard
          key={current.item_id}
          row={current}
          index={currentIndex + 1}
          busy={busyItem === current.item_id}
          onAnswer={raw => answer(current.item_id, raw)}
          onReveal={() => reveal(current.item_id)}
          onCloseSelf={() => closeSelf(current.item_id)}
        />
      )}

      {/* На телефоне — две колонки на всю ширину: кнопки под большим пальцем.
          «Дальше» у последней задачи неактивна; когда всё решено, вместо неё
          стоит итог — листать дальше некуда, и это не ошибка. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-between">
        <Button
          variant="secondary"
          onClick={() => currentIndex > 0 && select(rows[currentIndex - 1].item_id)}
          disabled={currentIndex <= 0}
        >
          <ArrowLeft size={15} /> Назад
        </Button>
        {isLast && allSolved ? (
          <span
            data-testid="topic-tasks-all-solved"
            className="inline-flex min-h-11 sm:min-h-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800"
          >
            <CheckCircle2 size={15} /> Все задачи решены
          </span>
        ) : (
          <Button
            variant="primary"
            onClick={() => !isLast && select(rows[currentIndex + 1].item_id)}
            disabled={isLast || currentIndex < 0}
          >
            Дальше <ArrowRight size={15} />
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Лента шагов ──────────────────────────────────────────────────────────────

type StripState = 'solved' | 'attempted' | 'untouched'

function stripState(row: TopicTaskRow): StripState {
  if (row.closed_by !== null) return 'solved'
  if (row.attempts_count > 0) return 'attempted'
  return 'untouched'
}

const STRIP_STATE_LABEL: Record<StripState, string> = {
  solved: 'решена',
  attempted: 'есть попытки, не решена',
  untouched: 'не начата',
}

/**
 * Квадрат на задачу, как верхняя полоса в Stepik. Цвет по смыслу (§152):
 * зелёная заливка — решена, янтарный контур — отвечал, но не решил, серый
 * контур — не трогал; тёмная обводка поверх любого состояния — текущая.
 *
 * На телефоне лента прокручивается внутри себя (§158: страница по ширине не
 * едет), текущий квадрат подтягивается в видимую область.
 */
function TaskStrip({ rows, currentId, onSelect }: {
  rows: TopicTaskRow[]
  currentId: string | null
  onSelect: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="step"]')
    // jsdom не умеет scrollIntoView — в тестах метода нет.
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [currentId])

  return (
    <div ref={ref} data-testid="topic-tasks-strip" className="min-w-0 flex-1 overflow-x-auto">
      <ul aria-label="Задачи урока" className="flex w-max gap-1.5 px-1 py-1">
        {rows.map((row, idx) => {
          const state = stripState(row)
          const isCurrent = row.item_id === currentId
          const label = row.closed_by === 'self' ? 'разобрана' : STRIP_STATE_LABEL[state]
          return (
            <li key={row.item_id} className="shrink-0">
              <button
                type="button"
                data-state={state}
                data-current={isCurrent || undefined}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`Задача ${idx + 1}, ${label}`}
                onClick={() => onSelect(row.item_id)}
                className={cn(
                  'block h-8 w-8 rounded-md border-2 text-xs font-semibold transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                  state === 'solved' && 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600',
                  state === 'attempted' && 'border-amber-400 bg-white text-amber-700 hover:bg-amber-50',
                  state === 'untouched' && 'border-gray-300 bg-white text-gray-500 hover:border-gray-400',
                  isCurrent && 'ring-2 ring-offset-1 ring-gray-900',
                )}
              >
                {idx + 1}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Одна задача ──────────────────────────────────────────────────────────────

function TaskCard({ row, index, busy, onAnswer, onReveal, onCloseSelf }: {
  row: TopicTaskRow
  index: number
  busy: boolean
  onAnswer: (raw: string) => Promise<boolean | null>
  onReveal: () => Promise<unknown>
  onCloseSelf: () => Promise<void>
}) {
  const solved   = row.closed_by !== null
  const revealed = row.solution_shown_at !== null

  // Состояние «неверно» — факт из базы (`is_correct = false` у открытой
  // задачи), а не только память о последнем нажатии: карточка обязана его
  // показать и после обновления страницы, и после любого перемонтирования.
  // Именно перемонтирование (спиннер «Загрузка…» на время перечитывания
  // строк) прятало «Неверно» от владельца (§176). Гаснет при следующем вводе.
  const wrongOnServer = row.auto_checkable && !solved && row.is_correct === false
  const [wrong, setWrong] = useState(wrongOnServer)
  // Введённый ответ не очищается: ученик должен видеть, что именно ввёл мимо.
  const [draft, setDraft] = useState(() => (wrongOnServer ? row.answer_raw ?? '' : ''))

  // Каталожному рендеру отдаём только то, что ученику уже положено видеть:
  // разбор появляется в карточке лишь после явного «Посмотреть решение».
  const task = {
    id: row.task_id,
    statement_html: row.statement_html,
    assets: row.assets,
    answer_html: revealed ? row.answer_html : null,
    solution_html: revealed ? row.solution_html : null,
    solution_plan_html: null,
    grade_criteria_html: null,
    has_answer: revealed && !!row.answer_html,
    has_solution: revealed && !!row.solution_html,
    max_points: row.max_points,
  } as unknown as CatalogTask

  async function submit() {
    if (!draft.trim() || busy) return
    const ok = await onAnswer(draft)
    setWrong(ok === false)
    if (ok) setDraft('')
  }

  // Задача с коротким ответом после открытого решения закрывается отметкой,
  // как вторая часть: ответ после подсмотренного разбора не засчитывается
  // (сервер откажет `SOLUTION_SHOWN`), поле ответа убираем. Решённая ответом
  // и разобранная потом остаётся «Верно».
  const selfCheck = !row.auto_checkable || (revealed && row.closed_by !== 'auto')
  const showWrong = wrong && !selfCheck

  return (
    <div
      data-testid="topic-task-card"
      data-verdict={solved ? 'solved' : showWrong ? 'wrong' : undefined}
      className={`rounded-2xl border bg-white p-3 sm:p-4 ${solved ? 'border-emerald-200' : showWrong ? 'border-red-200' : 'border-gray-200'}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-gray-500">Задача {index}</span>
        {solved ? (
          <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
            <Check size={13} />
            {row.closed_by === 'self'
              ? 'разобрана'
              : row.attempts_count > 1
                ? `решена с ${row.attempts_count}-й попытки`
                : 'решена с первой попытки'}
          </span>
        ) : selfCheck ? (
          <span className="text-xs text-gray-400">самопроверка по решению</span>
        ) : null}
      </div>

      <CatalogTaskContent task={task} showControls={revealed} audience="student" />

      {!selfCheck ? (
        <AutoCheckBlock
          solved={solved}
          revealed={revealed}
          busy={busy}
          draft={draft}
          wrong={wrong}
          attempts={row.attempts_count}
          onDraft={v => { setDraft(v); setWrong(false) }}
          onSubmit={submit}
          onReveal={onReveal}
        />
      ) : (
        <SelfCheckBlock
          solved={solved}
          revealed={revealed}
          afterAttempt={row.auto_checkable}
          busy={busy}
          onReveal={onReveal}
          onCloseSelf={onCloseSelf}
        />
      )}
    </div>
  )
}

// ── Задача с коротким ответом ────────────────────────────────────────────────

function AutoCheckBlock({
  solved, revealed, busy, draft, wrong, attempts, onDraft, onSubmit, onReveal,
}: {
  solved: boolean
  revealed: boolean
  busy: boolean
  draft: string
  wrong: boolean
  attempts: number
  onDraft: (v: string) => void
  onSubmit: () => void
  onReveal: () => Promise<unknown>
}) {
  if (solved) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
          <Check size={15} /> Верно
        </span>
        {!revealed && (
          <Button variant="secondary" size="sm" onClick={() => void onReveal()} disabled={busy}>
            <Eye size={14} className="mr-1" />
            Посмотреть решение
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2">
      {/* Плашка на всю ширину карточки, тон `bad` (§152): неверный ответ —
          состояние карточки, а не подпись под полем. Живёт до следующего ввода. */}
      {wrong && (
        <div
          role="alert"
          data-testid="topic-task-wrong"
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
        >
          <XCircle size={16} className="shrink-0" />
          Неверно{attempts > 0 ? ` · попытка ${attempts}` : ''}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={draft}
          onChange={e => onDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit() }}
          inputMode="text"
          placeholder="Ответ"
          aria-label="Ответ на задачу"
          aria-invalid={wrong || undefined}
          className={`flex-1 min-w-0 px-3 py-2.5 border rounded-xl text-base focus:outline-none focus:ring-2 ${
            wrong
              ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-300'
              : 'border-gray-200 focus:ring-primary-400'
          }`}
        />
        <Button variant="primary" onClick={onSubmit} disabled={busy || !draft.trim()}>
          {busy ? <Loader2 size={15} className="mr-1 animate-spin" /> : null}
          {wrong ? 'Проверить ещё раз' : 'Проверить'}
        </Button>
        {/* Разбор — после хотя бы одной попытки, не раньше: до неё он был бы
            ответом. Сервер проверяет то же (`NOT_ATTEMPTED_YET`). */}
        {attempts > 0 && (
          <Button variant="secondary" onClick={() => void onReveal()} disabled={busy}>
            <Eye size={14} className="mr-1" />
            Посмотреть решение
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Задача без короткого ответа ──────────────────────────────────────────────

function SelfCheckBlock({ solved, revealed, afterAttempt, busy, onReveal, onCloseSelf }: {
  solved: boolean
  revealed: boolean
  /** Задача с коротким ответом, пришедшая сюда после открытого решения (§176). */
  afterAttempt: boolean
  busy: boolean
  onReveal: () => Promise<unknown>
  onCloseSelf: () => Promise<void>
}) {
  if (solved) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
        <Check size={15} /> Разобрана
      </p>
    )
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {afterAttempt && revealed && (
        <p className="w-full text-xs text-gray-500">
          Решение открыто — ответ больше не проверяется, задачу закрывает отметка «Разобрал».
        </p>
      )}
      {!revealed ? (
        <Button variant="secondary" onClick={() => void onReveal()} disabled={busy}>
          <Eye size={14} className="mr-1" />
          Посмотреть решение
        </Button>
      ) : (
        // Зелёная кнопка появляется только после разбора — и сервер это
        // проверяет отдельно, не полагаясь на то, что кнопки не было видно.
        <Button variant="success" onClick={() => void onCloseSelf()} disabled={busy}>
          {busy ? <Loader2 size={15} className="mr-1 animate-spin" /> : <Check size={15} className="mr-1" />}
          Разобрал
        </Button>
      )}
    </div>
  )
}
