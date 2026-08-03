import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, AlertCircle, Trash2, Plus, Users, X } from 'lucide-react'
import { useTopicVariantAttachment } from '@/hooks/useVariantTopicAttach'
import { useVariants } from '@/hooks/useVariants'
import { Button } from '@/components/ui/Button'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS:    Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

/**
 * Привязка тестирования из раздела «Тесты» к теме курса (§58).
 *
 * Отдельно от привязки теста из банка: это разные системы. Банк живёт в
 * topic_tests и привязывается самой темой, тестирования — в test_variants и
 * выдаются группам. Привязать тестирование к теме значит выдать его группам
 * курса: без выдачи ученик его не увидит, а счётчик прохождений всегда
 * показывал бы ноль.
 */
export function TopicVariantAttach({ topicId }: { topicId: string }) {
  const { attached, groups, loading, error, busy, attach, detach } = useTopicVariantAttachment(topicId)
  const { variants, loading: variantsLoading } = useVariants()

  const [picking, setPicking]       = useState(false)
  const [search, setSearch]         = useState('')
  const [chosenVariant, setChosen]  = useState<string | null>(null)
  const [chosenGroups, setGroups]   = useState<string[] | null>(null)
  const [dueAt, setDueAt]           = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  // По умолчанию отмечены все группы курса — самый частый случай, а когда
  // группа одна, выбор вообще не мешает.
  const effectiveGroups = chosenGroups ?? groups.map(g => g.group_id)

  const attachedIds = useMemo(() => new Set(attached.map(a => a.variant_id)), [attached])

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return variants
      .filter(v => !attachedIds.has(v.id))
      .filter(v => !q || v.title.toLowerCase().includes(q))
  }, [variants, attachedIds, search])

  function reset() {
    setPicking(false)
    setChosen(null)
    setGroups(null)
    setDueAt('')
    setSearch('')
    setLocalError(null)
  }

  async function handleAttach() {
    if (!chosenVariant) return
    setLocalError(null)
    try {
      await attach(chosenVariant, effectiveGroups, dueAt ? new Date(dueAt).toISOString() : null)
      reset()
    } catch {
      /* текст ошибки уже в error хука */
    }
  }

  async function handleDetach(variantId: string, title: string) {
    if (!confirm(`Открепить «${title}» от темы? Выдача ученикам будет снята.`)) return
    setLocalError(null)
    try {
      await detach(variantId)
    } catch {
      /* текст ошибки уже в error хука */
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Загрузка тестирований…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-medium text-gray-800">Тестирования</h4>
        {!picking && (
          <Button variant="secondary" size="sm" onClick={() => setPicking(true)} disabled={busy}>
            <Plus size={14} className="mr-1" />
            Привязать тестирование
          </Button>
        )}
      </div>

      {(error || localError) && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{localError || error}</span>
        </div>
      )}

      {attached.length === 0 && !picking && (
        <p className="text-sm text-gray-400">
          К теме не привязано ни одного тестирования из раздела «Тесты».
        </p>
      )}

      {attached.map(item => (
        <div key={item.variant_id} className="rounded-xl border border-gray-200 px-3 py-2 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <Link
              to={`/variants/${item.variant_id}`}
              className="text-sm font-medium text-gray-800 hover:text-primary-600 truncate block"
            >
              {item.title}
            </Link>
            <div className="text-xs text-gray-400 flex items-center gap-3 flex-wrap mt-0.5">
              <span>
                {SUBJECT_LABELS[item.subject] ?? item.subject} · {EXAM_LABELS[item.exam_type] ?? item.exam_type} · {item.tasks_count} задач
              </span>
              <span className="flex items-center gap-1">
                <Users size={11} />
                {item.group_count} гр. · выдано {item.assigned_count} · прошли {item.passed_count}
              </span>
            </div>
          </div>
          <button
            type="button"
            title="Открепить"
            disabled={busy}
            onClick={() => handleDetach(item.variant_id, item.title)}
            className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      {picking && (
        <div className="rounded-xl border border-gray-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-800">Какое тестирование привязать</span>
            <button onClick={reset} className="text-gray-400 hover:text-gray-600">
              <X size={15} />
            </button>
          </div>

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />

          {variantsLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Загрузка…
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">
              Нет доступных тестирований.{' '}
              <Link to="/variants" className="text-primary-600 hover:underline">
                Собрать в разделе «Тесты» →
              </Link>
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
              {candidates.map(v => (
                <label key={v.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="variant-pick"
                    checked={chosenVariant === v.id}
                    onChange={() => setChosen(v.id)}
                    className="flex-shrink-0"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-gray-800 truncate">{v.title}</span>
                    <span className="block text-xs text-gray-400">
                      {SUBJECT_LABELS[v.subject] ?? v.subject} · {EXAM_LABELS[v.exam_type] ?? v.exam_type} · {v.tasks_count} задач
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {chosenVariant && (
            <>
              <div>
                <span className="block text-xs text-gray-500 mb-1.5">
                  Кому выдать — привязка к теме означает выдачу
                </span>
                {groups.length === 0 ? (
                  <p className="text-sm text-amber-700">
                    У курса нет групп — выдать тестирование некому.
                  </p>
                ) : groups.length === 1 ? (
                  /* Один курс = одна группа (§61). Выбор из одного варианта —
                     лишний клик, поэтому группа подставляется молча, но кому
                     уйдёт тест, всё равно написано. */
                  <p className="text-sm text-gray-700">
                    {groups[0].group_name}
                    <span className="ml-2 text-xs text-gray-400">
                      {groups[0].student_count} уч.
                    </span>
                  </p>
                ) : (
                  <div className="space-y-1">
                    {groups.map(g => (
                      <label key={g.group_id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={effectiveGroups.includes(g.group_id)}
                          onChange={() => setGroups(
                            effectiveGroups.includes(g.group_id)
                              ? effectiveGroups.filter(id => id !== g.group_id)
                              : [...effectiveGroups, g.group_id]
                          )}
                        />
                        {g.group_name}
                        <span className="text-xs text-gray-400">
                          {g.student_count} уч.
                        </span>
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
            </>
          )}

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleAttach}
              disabled={busy || !chosenVariant || effectiveGroups.length === 0}
            >
              {busy && <Loader2 size={14} className="mr-1 animate-spin" />}
              Привязать и выдать
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
