import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle, Trash2, Plus, Search, X, Users, ListPlus, ArrowUp, ArrowDown } from 'lucide-react'
import { useTopicTestAssignment, useTestBank } from '@/hooks/useTopicTest'
import { useTopicVariantAttachment } from '@/hooks/useVariantTopicAttach'
import { useTopicTaskProgress } from '@/hooks/useTopicTaskProgress'
import { useTopicTasksStaff, fetchAttachTarget, type StaffTaskRow } from '@/hooks/useTopicTaskAttach'
import { useTopicTemplateLink } from '@/hooks/useTopicTemplateLink'
import { useAttachTargetStore } from '@/store/attachStore'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/store/toastStore'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS:    Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

/**
 * Секция «Задачи» на теме курса.
 *
 * Главное здесь — задачи к уроку (§162): что прикреплено, в каком порядке и как
 * это решают. Подбор идёт в каталоге (§164) — там фильтры, поиск по темам и
 * «В подборку», и второго способа отбирать задачи мы не заводим. Модалку выбора
 * готового тестирования убрали: два входа к одному нельзя, а неудобным был
 * именно этот.
 *
 * Рядом остаются две вещи из прежней жизни раздела: уже привязанные
 * тестирования (открепить можно, привязать новое отсюда — нет) и тест из банка
 * (`topic_tests`), у которого свой выбор.
 */
export function TopicTestEditor({ topicId }: { topicId: string }) {
  const { assignment, hasAttempts, loading: bankLoading, error: bankError, attach: attachBank, detach: detachBank } =
    useTopicTestAssignment(topicId)
  const { tests, loading: testsLoading } = useTestBank()
  const {
    attached, loading: variantsLoading, error: variantError,
    busy: variantBusy, detach: detachVariant,
  } = useTopicVariantAttachment(topicId)
  const taskProgress = useTopicTaskProgress(topicId)
  const tasks = useTopicTasksStaff(topicId)
  const setAttachTarget = useAttachTargetStore(s => s.setTarget)
  const navigate = useNavigate()

  // Задачи темы-отражения задаются в каркасе (§172). Здесь их видно, но не
  // правят: иначе класс и каркас разъедутся, и никто не вспомнит, когда.
  const { link } = useTopicTemplateLink(topicId)
  const fromTemplate = !link.is_template && !!link.source_topic_id

  const [openPicker, setOpenPicker] = useState<'bank' | null>(null)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  /** `confirmSave` выключен на отвязке: подтверждать удаление словом
   *  «сохранено» — врать. Привязка подтверждается тостом (§98). */
  async function run(fn: () => Promise<unknown>, confirmSave = true) {
    setBusy(true)
    setLocalError(null)
    try {
      await fn()
      if (confirmSave) toast.saved()
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Уход в каталог за задачами (§164).
   *
   * Отбор идёт там же, где он и был: фильтры, «В подборку», плавающая кнопка.
   * Отсюда уезжает только контекст — кому подбираем и куда вернуться.
   */
  async function pickInCatalog() {
    const target = await fetchAttachTarget(topicId)
    if (!target) {
      setLocalError('Не удалось открыть каталог для этой темы')
      return
    }
    setAttachTarget(target)
    navigate(`/catalog?attachTo=${topicId}`)
  }

  const loading = bankLoading || variantsLoading
  const error = localError || variantError || bankError || tasks.error
  const nothingAttached = !assignment?.test && attached.length === 0 && tasks.rows.length === 0

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Загрузка привязки…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {fromTemplate ? (
          /* Отражение каркаса: отсюда ведём туда, где задачи задаются. */
          <Link
            to={`/course-program?materialsTopic=${link.source_topic_id}&tile=test`}
            data-testid="tasks-in-template"
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-sm
              font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
          >
            <ListPlus size={14} />
            Задачи задаются в шаблоне → открыть
          </Link>
        ) : (
          <Button
            variant="primary"
            size="sm"
            data-testid="pick-in-catalog"
            onClick={() => { void pickInCatalog() }}
            disabled={busy || variantBusy}
          >
            <ListPlus size={14} className="mr-1" />
            Подобрать в каталоге
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpenPicker(openPicker === 'bank' ? null : 'bank')}
          disabled={busy || variantBusy}
        >
          <Plus size={14} className="mr-1" />
          Прикрепить тест из банка
        </Button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {openPicker === 'bank' && (
        <BankPicker
          tests={tests}
          loading={testsLoading}
          busy={busy}
          alreadyAttachedId={assignment?.test_id ?? null}
          onClose={() => setOpenPicker(null)}
          onAttach={async testId => {
            await run(() => attachBank(testId))
            setOpenPicker(null)
          }}
        />
      )}

      {nothingAttached && !openPicker && !tasks.loading && (
        <p className="text-sm text-gray-400 py-1">
          К теме пока ничего не привязано. Задачи к уроку подбираются в каталоге.
        </p>
      )}

      <AttachedTasks tasks={tasks} progress={taskProgress} readOnly={fromTemplate} />

      {attached.map(item => (
        <AttachedRow
          key={item.variant_id}
          title={item.title}
          to={`/variants/${item.variant_id}`}
          meta={[
            `${SUBJECT_LABELS[item.subject] ?? item.subject} ${EXAM_LABELS[item.exam_type] ?? item.exam_type}`,
            `${item.tasks_count} задач`,
          ]}
          stats={`выдано ${item.assigned_count} · прошли ${item.passed_count}`}
          disabled={variantBusy}
          onDelete={() => {
            if (!confirm(`Открепить «${item.title}» от темы? Выдача ученикам будет снята.`)) return
            void detachVariant(item.variant_id).catch(() => { /* текст ошибки в error хука */ })
          }}
        />
      ))}

      {assignment?.test && (
        <AttachedRow
          title={assignment.test.title}
          to={`/tests/${assignment.test_id}`}
          badge="банк"
          meta={[`${assignment.test.description ? assignment.test.description : 'Тест из банка'}`]}
          stats={hasAttempts ? 'есть попытки' : 'попыток пока нет'}
          disabled={busy || hasAttempts}
          deleteTitle={hasAttempts ? 'По тесту уже есть попытки' : 'Открепить'}
          onDelete={() => {
            if (!confirm('Открепить тест? По нему ещё нет попыток.')) return
            void run(() => detachBank(), false)
          }}
        />
      )}
    </div>
  )
}

// ── Задачи к уроку ───────────────────────────────────────────────────────────

/**
 * Что прикреплено к уроку и как это решают (§164).
 *
 * Строка «задач к уроку: 7 · решают 12 из 16» живёт здесь, а не на строке
 * варианта: с ленивой выдачей строки варианта может не быть вовсе — пока тему
 * не открыл ни один ученик, выдачи нет, а задачи уже есть.
 */
function AttachedTasks({
  tasks, progress, readOnly = false,
}: {
  tasks: ReturnType<typeof useTopicTasksStaff>
  progress: ReturnType<typeof useTopicTaskProgress>
  /** Набор приехал из каркаса: показываем, но порядок и состав не трогаем. */
  readOnly?: boolean
}) {
  if (tasks.loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" />
        Загрузка задач…
      </div>
    )
  }

  if (tasks.rows.length === 0) return null

  const solvedLine = progress
    ? `решают ${progress.students_started} из ${progress.students_total}`
      + (progress.students_done > 0 ? ` · решили все: ${progress.students_done}` : '')
      + (progress.closed_self  > 0 ? ` · по решению: ${progress.closed_self}` : '')
    : 'ученики ещё не открывали'

  return (
    <div className="rounded-xl border border-gray-200" data-testid="topic-tasks-staff">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <span className="text-sm font-medium text-gray-800">
          Задач к уроку: {tasks.rows.length}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Users size={11} />
          {solvedLine}
        </span>
      </div>

      <div className="divide-y divide-gray-100">
        {tasks.rows.map((row, index) => (
          <TaskRow
            key={row.item_id}
            row={row}
            first={index === 0}
            last={index === tasks.rows.length - 1}
            readOnly={readOnly}
            busy={tasks.busy === row.item_id}
            onMove={delta => { void tasks.move(row.item_id, delta) }}
            onDetach={async () => {
              const answers = await tasks.detach(row.item_id)
              if (answers === null) return
              // Ответы по задаче уже есть — снимать её молча нельзя: вместе с
              // задачей уйдут и они.
              if (!confirm(
                `По этой задаче уже есть ответы (${answers}). Убрать задачу вместе с ними?`
              )) return
              await tasks.detach(row.item_id, true)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function TaskRow({
  row, first, last, busy, readOnly = false, onMove, onDetach,
}: {
  row: StaffTaskRow
  first: boolean
  last: boolean
  busy: boolean
  readOnly?: boolean
  onMove: (delta: number) => void
  onDetach: () => Promise<void>
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="w-5 shrink-0 text-xs tabular-nums text-gray-400">{row.item_position}</span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-gray-800">{plainPreview(row.statement_html)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
          {row.external_id && <span>№ {row.external_id}</span>}
          <span>{row.auto_checkable ? 'автопроверка' : 'самопроверка по решению'}</span>
          {row.answers_count > 0 && <span>ответов: {row.answers_count}</span>}
        </div>
      </div>

      {readOnly ? (
        <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
          из шаблона
        </span>
      ) : (
      <div className="flex shrink-0 items-center">
        <button
          type="button" title="Выше" disabled={first || busy} onClick={() => onMove(-1)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button" title="Ниже" disabled={last || busy} onClick={() => onMove(1)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ArrowDown size={14} />
        </button>
        <button
          type="button" title="Убрать из темы" disabled={busy} onClick={() => { void onDetach() }}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
        >
          <Trash2 size={14} />
        </button>
      </div>
      )}
    </div>
  )
}

/** Короткая строка вместо условия целиком: это подпись в списке, не показ задачи. */
function plainPreview(html: string): string {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

// ── Строка привязанного ──────────────────────────────────────────────────────

function AttachedRow({
  title, to, badge, meta, stats, disabled, deleteTitle, onDelete,
}: {
  title: string
  to: string
  badge?: string
  meta: string[]
  stats: string
  disabled?: boolean
  deleteTitle?: string
  onDelete: () => void
}) {
  return (
    <div className="rounded-xl border border-gray-200 px-3 py-2 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link to={to} className="text-sm font-medium text-gray-800 hover:text-primary-600 truncate">
            {title}
          </Link>
          {badge && <Badge variant="default">{badge}</Badge>}
        </div>
        <div className="mt-0.5 text-xs text-gray-400 flex items-center gap-2 flex-wrap">
          <span>{meta.filter(Boolean).join(' · ')}</span>
          <span className="flex items-center gap-1">
            <Users size={11} />
            {stats}
          </span>
        </div>
      </div>
      <button
        type="button"
        title={deleteTitle ?? 'Открепить'}
        disabled={disabled}
        onClick={onDelete}
        className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:bg-transparent"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

// ── Выбор теста из банка ─────────────────────────────────────────────────────

function BankPicker({
  tests, loading, busy, alreadyAttachedId, onClose, onAttach,
}: {
  tests: { id: string; title: string; itemCount: number }[]
  loading: boolean
  busy: boolean
  alreadyAttachedId: string | null
  onClose: () => void
  onAttach: (testId: string) => Promise<void>
}) {
  const [search, setSearch] = useState('')

  // Пустой тест прикреплять бессмысленно, а строка «0 заданий» — мусор,
  // который и создавал ощущение перегруза. Такие тесты не показываем вовсе.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tests
      .filter(t => t.itemCount > 0)
      .filter(t => t.id !== alreadyAttachedId)
      .filter(t => !q || t.title.toLowerCase().includes(q))
  }, [tests, alreadyAttachedId, search])

  return (
    <PickerShell title="Какой тест прикрепить" onClose={onClose}>
      <SearchInput value={search} onChange={setSearch} placeholder="Поиск теста по названию…" />

      {loading ? (
        <PickerLoading />
      ) : candidates.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">
          {tests.length === 0 ? 'Тестов в банке ещё нет.' : 'Подходящих тестов нет.'}
        </p>
      ) : (
        <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
          {candidates.map(test => (
            <button
              key={test.id}
              type="button"
              disabled={busy}
              onClick={() => { void onAttach(test.id) }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
            >
              <span className="block text-sm text-gray-800 truncate">{test.title}</span>
              <span className="block text-xs text-gray-400">{test.itemCount} заданий</span>
            </button>
          ))}
        </div>
      )}

      <Link to="/tests" className="block text-xs text-primary-600 hover:underline">
        Создать новый тест в банке →
      </Link>
    </PickerShell>
  )
}

// ── Оболочка выбора ──────────────────────────────────────────────────────────

function PickerShell({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-800">{title}</span>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={15} />
        </button>
      </div>
      {children}
    </div>
  )
}

function SearchInput({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
      />
    </div>
  )
}

function PickerLoading() {
  return (
    <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
      <Loader2 size={14} className="animate-spin" /> Загрузка…
    </div>
  )
}
