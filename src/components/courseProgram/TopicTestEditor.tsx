import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, AlertCircle, Trash2, Plus, Search, X, Users } from 'lucide-react'
import { useTopicTestAssignment, useTestBank } from '@/hooks/useTopicTest'
import { useTopicVariantAttachment } from '@/hooks/useVariantTopicAttach'
import { useVariants } from '@/hooks/useVariants'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/store/toastStore'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS:    Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

/**
 * Секция «Тестирование» на теме курса.
 *
 * К теме можно привязать два разных зверя: тестирование из раздела «Тесты»
 * (`test_variants`, выдаётся группам) и тест из банка (`topic_tests`, привязан
 * самой темой). Раньше они жили двумя блоками, и каждый показывал развёрнутый
 * каталог своих кандидатов — страница читалась как склад, а не как тема.
 *
 * Теперь секция одна и показывает только то, что УЖЕ привязано, строками в
 * едином стиле. Тип различает бейдж «банк»: отдельный заголовок ради этого
 * держать дорого. Выбор кандидатов открывается по кнопке.
 *
 * Правка чисто представления: привязка, выдача и счётчики не менялись.
 */
export function TopicTestEditor({ topicId }: { topicId: string }) {
  const { assignment, hasAttempts, loading: bankLoading, error: bankError, attach: attachBank, detach: detachBank } =
    useTopicTestAssignment(topicId)
  const { tests, loading: testsLoading } = useTestBank()
  const {
    attached, groups, loading: variantsLoading, error: variantError,
    busy: variantBusy, attach: attachVariant, detach: detachVariant,
  } = useTopicVariantAttachment(topicId)
  const { variants, loading: candidatesLoading } = useVariants()

  const [openPicker, setOpenPicker] = useState<'variant' | 'bank' | null>(null)
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

  const loading = bankLoading || variantsLoading
  const error = localError || variantError || bankError
  const nothingAttached = !assignment?.test && attached.length === 0

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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpenPicker(openPicker === 'variant' ? null : 'variant')}
          disabled={busy || variantBusy}
        >
          <Plus size={14} className="mr-1" />
          Привязать тестирование
        </Button>
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

      {openPicker === 'variant' && (
        <VariantPicker
          variants={variants}
          loading={candidatesLoading}
          attachedIds={new Set(attached.map(a => a.variant_id))}
          groups={groups}
          busy={variantBusy}
          onClose={() => setOpenPicker(null)}
          onAttach={async (variantId, groupIds, dueAt) => {
            await attachVariant(variantId, groupIds, dueAt)
            setOpenPicker(null)
          }}
        />
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

      {nothingAttached && !openPicker && (
        <p className="text-sm text-gray-400 py-1">К теме пока ничего не привязано.</p>
      )}

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

// ── Выбор тестирования ───────────────────────────────────────────────────────

function VariantPicker({
  variants, loading, attachedIds, groups, busy, onClose, onAttach,
}: {
  variants: { id: string; title: string; subject: string; exam_type: string; tasks_count: number }[]
  loading: boolean
  attachedIds: Set<string>
  groups: { group_id: string; group_name: string; student_count: number }[]
  busy: boolean
  onClose: () => void
  onAttach: (variantId: string, groupIds: string[], dueAt: string | null) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [chosenGroups, setChosenGroups] = useState<string[] | null>(null)
  const [dueAt, setDueAt] = useState('')

  const effectiveGroups = chosenGroups ?? groups.map(g => g.group_id)

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return variants
      .filter(v => !attachedIds.has(v.id))
      .filter(v => !q || v.title.toLowerCase().includes(q))
  }, [variants, attachedIds, search])

  return (
    <PickerShell title="Какое тестирование привязать" onClose={onClose}>
      <SearchInput value={search} onChange={setSearch} placeholder="Поиск по названию…" />

      {loading ? (
        <PickerLoading />
      ) : candidates.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">Нет доступных тестирований.</p>
      ) : (
        <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
          {candidates.map(v => (
            <label key={v.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
              <input
                type="radio"
                name="variant-pick"
                checked={chosen === v.id}
                onChange={() => setChosen(v.id)}
                className="flex-shrink-0"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-gray-800 truncate">{v.title}</span>
                <span className="block text-xs text-gray-400">
                  {SUBJECT_LABELS[v.subject] ?? v.subject} {EXAM_LABELS[v.exam_type] ?? v.exam_type} · {v.tasks_count} задач
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {chosen && (
        <>
          <div>
            <span className="block text-xs text-gray-500 mb-1.5">
              Кому выдать — привязка к теме означает выдачу
            </span>
            {groups.length === 0 ? (
              <p className="text-sm text-amber-700">У курса нет групп — выдать тестирование некому.</p>
            ) : groups.length === 1 ? (
              /* Один курс = одна группа (§61). Выбор из одного варианта — лишний
                 клик, но кому уйдёт тест, всё равно написано. */
              <p className="text-sm text-gray-700">
                {groups[0].group_name}
                <span className="ml-2 text-xs text-gray-400">{groups[0].student_count} уч.</span>
              </p>
            ) : (
              <div className="space-y-1">
                {groups.map(g => (
                  <label key={g.group_id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={effectiveGroups.includes(g.group_id)}
                      onChange={() => setChosenGroups(
                        effectiveGroups.includes(g.group_id)
                          ? effectiveGroups.filter(id => id !== g.group_id)
                          : [...effectiveGroups, g.group_id]
                      )}
                    />
                    {g.group_name}
                    <span className="text-xs text-gray-400">{g.student_count} уч.</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Срок сдачи — не обязателен</label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={e => setDueAt(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            disabled={busy || effectiveGroups.length === 0}
            onClick={() => {
              void onAttach(chosen, effectiveGroups, dueAt ? new Date(dueAt).toISOString() : null)
                .catch(() => { /* текст ошибки в error хука */ })
            }}
          >
            {busy && <Loader2 size={14} className="mr-1 animate-spin" />}
            Привязать и выдать
          </Button>
        </>
      )}
    </PickerShell>
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
