import { useState } from 'react'
import { Loader2, AlertCircle, Check, RotateCcw, Eye, CheckCircle2 } from 'lucide-react'
import type { useTopicTasks, TopicTaskRow } from '@/hooks/useTopicTasks'
import { CatalogTaskContent } from '@/components/catalog/CatalogTaskContent'
import type { CatalogTask } from '@/hooks/useCatalog'
import { Button } from '@/components/ui/Button'

/**
 * Задачи к уроку (§162) — «как в Stepik».
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
 * Хук поднят на страницу темы: она же показывает «решено N из M» в шапке
 * группы. Иначе тот же запрос ушёл бы дважды за одно открытие урока.
 */
export function TopicTasksStudent({ tasks }: { tasks: ReturnType<typeof useTopicTasks> }) {
  const { rows, total, solved, loading, error, busyItem, answer, reveal, closeSelf } = tasks

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

  return (
    <div className="space-y-4">
      {/* Счёт сверху: видно, сколько осталось, без прокрутки до конца. */}
      <div className="sticky top-16 z-10 -mx-1 px-1 py-2 bg-white/90 backdrop-blur rounded-xl">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-gray-900">
            Решено {solved} из {total}
          </span>
          {solved === total && (
            <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
              <CheckCircle2 size={13} /> всё решено
            </span>
          )}
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: total === 0 ? '0%' : `${Math.round((solved / total) * 100)}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {rows.map((row, idx) => (
        <TaskCard
          key={row.item_id}
          row={row}
          index={idx + 1}
          busy={busyItem === row.item_id}
          onAnswer={raw => answer(row.item_id, raw)}
          onReveal={() => reveal(row.item_id)}
          onCloseSelf={() => closeSelf(row.item_id)}
        />
      ))}
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
  const [draft, setDraft] = useState('')
  const [lastWrong, setLastWrong] = useState(false)

  const solved   = row.closed_by !== null
  const revealed = row.solution_shown_at !== null

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
    setLastWrong(ok === false)
    if (ok) setDraft('')
  }

  return (
    <div className={`rounded-2xl border bg-white p-3 sm:p-4 ${solved ? 'border-emerald-200' : 'border-gray-200'}`}>
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
        ) : !row.auto_checkable ? (
          <span className="text-xs text-gray-400">самопроверка по решению</span>
        ) : null}
      </div>

      <CatalogTaskContent task={task} showControls={revealed} />

      {row.auto_checkable ? (
        <AutoCheckBlock
          solved={solved}
          revealed={revealed}
          busy={busy}
          draft={draft}
          lastWrong={lastWrong}
          attempts={row.attempts_count}
          onDraft={v => { setDraft(v); setLastWrong(false) }}
          onSubmit={submit}
          onReveal={onReveal}
        />
      ) : (
        <SelfCheckBlock
          solved={solved}
          revealed={revealed}
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
  solved, revealed, busy, draft, lastWrong, attempts, onDraft, onSubmit, onReveal,
}: {
  solved: boolean
  revealed: boolean
  busy: boolean
  draft: string
  lastWrong: boolean
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
        {/* Разбор — только после верного ответа: до него он был бы ответом. */}
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
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={draft}
          onChange={e => onDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit() }}
          inputMode="text"
          placeholder="Ответ"
          aria-label="Ответ на задачу"
          className={`flex-1 min-w-0 px-3 py-2.5 border rounded-xl text-base focus:outline-none focus:ring-2 ${
            lastWrong
              ? 'border-red-300 bg-red-50 focus:ring-red-300'
              : 'border-gray-200 focus:ring-primary-400'
          }`}
        />
        <Button variant="primary" onClick={onSubmit} disabled={busy || !draft.trim()}>
          {busy ? <Loader2 size={15} className="mr-1 animate-spin" /> : null}
          Проверить
        </Button>
      </div>

      {lastWrong && (
        <p className="text-sm text-red-600 flex items-center gap-1.5">
          <RotateCcw size={13} />
          Неверно, попробуйте ещё раз{attempts > 0 ? ` · попыток: ${attempts}` : ''}
        </p>
      )}
    </div>
  )
}

// ── Задача без короткого ответа ──────────────────────────────────────────────

function SelfCheckBlock({ solved, revealed, busy, onReveal, onCloseSelf }: {
  solved: boolean
  revealed: boolean
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
