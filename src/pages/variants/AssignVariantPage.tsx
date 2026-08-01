import { useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Users, User, Search, CheckSquare, Square,
  Calendar, RefreshCw, Eye, BookOpen, ChevronRight, Loader2,
} from 'lucide-react'
import { useVariantDetail } from '@/hooks/useVariants'
import { useTeacherGroups, assignVariant } from '@/hooks/useVariantAssignments'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/toastStore'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

type Tab = 'groups' | 'students'
type Step = 'select' | 'settings' | 'confirm'

interface Settings {
  available_from: string
  due_at: string
  max_attempts: number
  allow_retry: boolean
  show_answers_after_submit: boolean
  show_solutions_after_submit: boolean
}

const DEFAULT_SETTINGS: Settings = {
  available_from: '',
  due_at: '',
  max_attempts: 1,
  allow_retry: false,
  show_answers_after_submit: false,
  show_solutions_after_submit: false,
}

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS: Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

function toRpcDate(value: string) {
  return value ? new Date(value).toISOString() : null
}

interface AssignmentSummary {
  students_created: number
  notifications_created: number
  telegram_connected: number
  telegram_not_connected: number
  telegram_queued: number
}

function formatWarning(raw: string) {
  const parts = raw.split(':')
  return parts.length >= 3 ? parts.slice(2).join(':') : raw
}

export function AssignVariantPage() {
  const { variantId } = useParams<{ variantId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { variant, loading: variantLoading } = useVariantDetail(variantId)
  const { groups, loading: groupsLoading } = useTeacherGroups()

  const [step, setStep] = useState<Step>('select')
  const [tab, setTab] = useState<Tab>('groups')
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [submitting, setSubmitting] = useState(false)

  const canAssign = profile && ['teacher', 'admin', 'owner'].includes(profile.role)

  // All unique students from all groups
  const allStudents = useMemo(() => {
    const map = new Map<string, { id: string; full_name: string; group_names: string[] }>()
    for (const g of groups) {
      for (const s of g.students) {
        if (map.has(s.id)) {
          map.get(s.id)!.group_names.push(g.name)
        } else {
          map.set(s.id, { id: s.id, full_name: s.full_name, group_names: [g.name] })
        }
      }
    }
    return Array.from(map.values())
  }, [groups])

  const filteredGroups = useMemo(
    () => groups.filter(g => {
      const haystack = [
        g.name,
        g.teacher_name,
        g.course_title,
        g.subject ? SUBJECT_LABELS[g.subject] : '',
        g.exam_type ? EXAM_LABELS[g.exam_type] : '',
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(search.toLowerCase())
    }),
    [groups, search]
  )
  const filteredStudents = useMemo(
    () => allStudents.filter(s => s.full_name.toLowerCase().includes(search.toLowerCase())),
    [allStudents, search]
  )

  // Count affected students
  const affectedStudentIds = useMemo(() => {
    const ids = new Set<string>(selectedStudents)
    for (const gid of selectedGroups) {
      const g = groups.find(g => g.id === gid)
      if (g) g.students.forEach(s => ids.add(s.id))
    }
    return ids
  }, [selectedGroups, selectedStudents, groups])

  function toggleGroup(id: string) {
    setSelectedGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleStudent(id: string) {
    setSelectedStudents(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllGroups() {
    if (selectedGroups.size === filteredGroups.length) {
      setSelectedGroups(new Set())
    } else {
      setSelectedGroups(new Set(filteredGroups.map(g => g.id)))
    }
  }
  function toggleAllStudents() {
    if (selectedStudents.size === filteredStudents.length) {
      setSelectedStudents(new Set())
    } else {
      setSelectedStudents(new Set(filteredStudents.map(s => s.id)))
    }
  }

  const hasSelection = selectedGroups.size > 0 || selectedStudents.size > 0

  function validateSettings() {
    const availableFrom = settings.available_from ? new Date(settings.available_from) : null
    const dueAt = settings.due_at ? new Date(settings.due_at) : null

    if (dueAt && availableFrom && dueAt < availableFrom) {
      return 'Дедлайн не может быть раньше даты открытия'
    }
    if (dueAt && dueAt < new Date()) {
      return 'Прошлый дедлайн запрещён'
    }
    if (settings.max_attempts < 1) {
      return 'Количество попыток должно быть не меньше 1'
    }
    if (!settings.allow_retry && settings.max_attempts !== 1) {
      return 'Если пересдача выключена, доступна только 1 попытка'
    }
    return null
  }

  async function handleSubmit() {
    if (!variantId) return
    const validationError = validateSettings()
    if (validationError) {
      toast.error(validationError)
      return
    }
    setSubmitting(true)
    try {
      const result = await assignVariant({
        variant_id: variantId,
        group_ids: Array.from(selectedGroups),
        student_ids: Array.from(selectedStudents),
        available_from: toRpcDate(settings.available_from),
        due_at: toRpcDate(settings.due_at),
        max_attempts: settings.max_attempts,
        allow_retry: settings.allow_retry,
        show_answers_after_submit: settings.show_answers_after_submit,
        show_solutions_after_submit: settings.show_solutions_after_submit,
      })
      const skipped = result.already_assigned ?? 0
      const created = result.students_created ?? 0
      const msg = skipped > 0
        ? `Назначено: ${created} учеников (${skipped} уже были назначены)`
        : `Вариант назначен ${created} ученикам`
      toast.success(msg)
      if (result.warnings?.length) {
        result.warnings.forEach((w: string) => toast.info(formatWarning(w)))
      }
      navigate(`/variants/${variantId}/assignments`, {
        state: {
          assignmentSummary: {
            students_created: result.students_created ?? 0,
            notifications_created: result.notifications_created ?? 0,
            telegram_connected: result.telegram_connected ?? 0,
            telegram_not_connected: result.telegram_not_connected ?? 0,
            telegram_queued: result.telegram_queued ?? 0,
          } satisfies AssignmentSummary,
        },
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ошибка назначения'
      toast.error(msg.replace(/^[A-Z_]+: /, ''))
    } finally {
      setSubmitting(false)
    }
  }

  if (!canAssign) {
    return <div className="p-8 text-center text-gray-500">Нет доступа</div>
  }
  if (variantLoading || groupsLoading) {
    return (
      <div className="max-w-3xl mx-auto py-10 text-center">
        <Loader2 size={28} className="animate-spin text-primary-500 mx-auto" />
      </div>
    )
  }
  if (!variant) {
    return <div className="p-8 text-center text-red-500">Вариант не найден</div>
  }

  // ── Step: Select ────────────────────────────────────────────────────────────
  if (step === 'select') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <BackBreadcrumb variantId={variantId!} variantTitle={variant.title} />

        <h1 className="text-xl font-bold text-gray-900 mb-1">Назначить вариант</h1>
        <p className="text-sm text-gray-500 mb-5">«{variant.title}»</p>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {(['groups', 'students'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setSearch('') }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'groups' ? (
                <span className="flex items-center gap-1.5"><Users size={14} /> Группы</span>
              ) : (
                <span className="flex items-center gap-1.5"><User size={14} /> Ученики</span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'groups' ? 'Поиск группы…' : 'Поиск ученика…'}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Select all row */}
        {tab === 'groups' ? (
          <>
            <SelectAllRow
              count={filteredGroups.length}
              selected={selectedGroups.size === filteredGroups.length && filteredGroups.length > 0}
              onToggle={toggleAllGroups}
              label="группу"
            />
            <div className="space-y-2 mt-2">
              {filteredGroups.length === 0 && (
                <p className="py-8 text-center text-sm text-gray-400">Нет групп</p>
              )}
              {filteredGroups.map(g => (
                <label key={g.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedGroups.has(g.id)
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <input type="checkbox" className="sr-only"
                    checked={selectedGroups.has(g.id)}
                    onChange={() => toggleGroup(g.id)}
                  />
                  {selectedGroups.has(g.id)
                    ? <CheckSquare size={18} className="text-primary-600 shrink-0" />
                    : <Square size={18} className="text-gray-300 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900">{g.name}</div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                      <span>{g.teacher_name}</span>
                      {g.subject && g.exam_type && (
                        <span>{SUBJECT_LABELS[g.subject] ?? g.subject} · {EXAM_LABELS[g.exam_type] ?? g.exam_type}</span>
                      )}
                      <span className={g.student_count === 0 ? 'text-amber-600 font-medium' : ''}>
                        {g.student_count === 0 ? 'В группе нет учеников' : `${g.student_count} учеников`}
                      </span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <SelectAllRow
              count={filteredStudents.length}
              selected={selectedStudents.size === filteredStudents.length && filteredStudents.length > 0}
              onToggle={toggleAllStudents}
              label="ученика"
            />
            <div className="space-y-2 mt-2">
              {filteredStudents.length === 0 && (
                <p className="py-8 text-center text-sm text-gray-400">Нет учеников</p>
              )}
              {filteredStudents.map(s => (
                <label key={s.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedStudents.has(s.id)
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <input type="checkbox" className="sr-only"
                    checked={selectedStudents.has(s.id)}
                    onChange={() => toggleStudent(s.id)}
                  />
                  {selectedStudents.has(s.id)
                    ? <CheckSquare size={18} className="text-primary-600 shrink-0" />
                    : <Square size={18} className="text-gray-300 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900">{s.full_name}</div>
                    <div className="text-xs text-gray-500">{s.group_names.join(', ')}</div>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {hasSelection
              ? `Выбрано: ${affectedStudentIds.size} уч. (${selectedGroups.size} гр. + ${selectedStudents.size} лично)`
              : 'Выберите получателей'
            }
          </span>
          <Button disabled={!hasSelection} onClick={() => setStep('settings')}>
            Далее <ChevronRight size={14} className="ml-1" />
          </Button>
        </div>
      </div>
    )
  }

  // ── Step: Settings ──────────────────────────────────────────────────────────
  if (step === 'settings') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <BackBreadcrumb variantId={variantId!} variantTitle={variant.title} />
        <h1 className="text-xl font-bold text-gray-900 mb-1">Параметры назначения</h1>
        <p className="text-sm text-gray-500 mb-5">«{variant.title}»</p>

        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {/* Dates */}
          <div className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Calendar size={15} /> Сроки
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs text-gray-500 mb-1 block">Открыть с</span>
                <input
                  type="datetime-local"
                  value={settings.available_from}
                  onChange={e => setSettings(s => ({ ...s, available_from: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 mb-1 block">Дедлайн</span>
                <input
                  type="datetime-local"
                  value={settings.due_at}
                  onChange={e => setSettings(s => ({ ...s, due_at: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </label>
            </div>
          </div>

          {/* Attempts */}
          <div className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <RefreshCw size={15} /> Попытки
            </h3>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.allow_retry}
                  onChange={e => setSettings(s => ({
                    ...s,
                    allow_retry: e.target.checked,
                    max_attempts: e.target.checked ? Math.max(s.max_attempts, 2) : 1,
                  }))}
                  className="rounded border-gray-300 text-primary-600"
                />
                <span className="text-sm text-gray-700">Разрешить повтор</span>
              </label>
              {settings.allow_retry && (
                <label className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Макс. попыток:</span>
                  <input
                    type="number"
                    min={2} max={10}
                    value={settings.max_attempts}
                    onChange={e => setSettings(s => ({ ...s, max_attempts: Math.max(2, +e.target.value) }))}
                    className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Show after submit */}
          <div className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Eye size={15} /> После отправки
            </h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_answers_after_submit}
                  onChange={e => setSettings(s => ({ ...s, show_answers_after_submit: e.target.checked }))}
                  className="rounded border-gray-300 text-primary-600"
                />
                <span className="text-sm text-gray-700">Показать правильные ответы</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_solutions_after_submit}
                  onChange={e => setSettings(s => ({ ...s, show_solutions_after_submit: e.target.checked }))}
                  className="rounded border-gray-300 text-primary-600"
                />
                <span className="text-sm text-gray-700">Показать разбор</span>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Button variant="secondary" onClick={() => setStep('select')}>
            <ArrowLeft size={14} className="mr-1" /> Назад
          </Button>
          <Button onClick={() => {
            const validationError = validateSettings()
            if (validationError) {
              toast.error(validationError)
              return
            }
            setStep('confirm')
          }}>
            Далее <ChevronRight size={14} className="ml-1" />
          </Button>
        </div>
      </div>
    )
  }

  // ── Step: Confirm ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <BackBreadcrumb variantId={variantId!} variantTitle={variant.title} />
      <h1 className="text-xl font-bold text-gray-900 mb-1">Подтверждение</h1>
      <p className="text-sm text-gray-500 mb-5">Проверьте параметры перед назначением</p>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        <ConfirmRow label="Вариант">
          <span className="flex items-center gap-1.5 text-sm text-gray-900">
            <BookOpen size={14} className="text-primary-500" /> {variant.title}
          </span>
        </ConfirmRow>

        {selectedGroups.size > 0 && (
          <ConfirmRow label="Группы">
            <div className="flex flex-wrap gap-1">
              {Array.from(selectedGroups).map(gid => {
                const g = groups.find(g => g.id === gid)
                return g ? (
                  <span key={gid} className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">
                    {g.name} ({g.student_count})
                  </span>
                ) : null
              })}
            </div>
          </ConfirmRow>
        )}

        {selectedStudents.size > 0 && (
          <ConfirmRow label="Ученики лично">
            <span className="text-sm text-gray-700">{selectedStudents.size} чел.</span>
          </ConfirmRow>
        )}

        <ConfirmRow label="Итого охват">
          <span className="text-sm font-semibold text-primary-700">
            ~{affectedStudentIds.size} учеников
          </span>
        </ConfirmRow>

        <ConfirmRow label="Предмет">
          <span className="text-sm text-gray-700">
            {SUBJECT_LABELS[variant.subject] ?? variant.subject} · {EXAM_LABELS[variant.exam_type] ?? variant.exam_type}
          </span>
        </ConfirmRow>

        <ConfirmRow label="Задач">
          <span className="text-sm text-gray-700">{variant.tasks_count}</span>
        </ConfirmRow>

        <ConfirmRow label="Открыть с">
          <span className="text-sm text-gray-700">
            {settings.available_from
              ? format(new Date(settings.available_from), 'd MMM yyyy HH:mm', { locale: ru })
              : 'Немедленно'
            }
          </span>
        </ConfirmRow>

        <ConfirmRow label="Дедлайн">
          <span className="text-sm text-gray-700">
            {settings.due_at
              ? format(new Date(settings.due_at), 'd MMM yyyy HH:mm', { locale: ru })
              : 'Без ограничений'
            }
          </span>
        </ConfirmRow>

        <ConfirmRow label="Попытки">
          <span className="text-sm text-gray-700">
            {settings.allow_retry ? `До ${settings.max_attempts}` : '1 (без повтора)'}
          </span>
        </ConfirmRow>

        <ConfirmRow label="После сдачи">
          <span className="text-sm text-gray-700">
            {[
              settings.show_answers_after_submit && 'ответы',
              settings.show_solutions_after_submit && 'разбор',
            ].filter(Boolean).join(', ') || 'ничего не показывать'}
          </span>
        </ConfirmRow>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="secondary" onClick={() => setStep('settings')}>
          <ArrowLeft size={14} className="mr-1" /> Назад
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
          Назначить группе
        </Button>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BackBreadcrumb({ variantId, variantTitle }: { variantId: string; variantTitle: string }) {
  return (
    <div className="flex items-center gap-2 mb-4 text-sm text-gray-500">
      <Link to="/variants" className="hover:text-primary-600">Варианты</Link>
      <span>/</span>
      <Link to={`/variants/${variantId}`} className="hover:text-primary-600 truncate max-w-[200px]">
        {variantTitle}
      </Link>
      <span>/</span>
      <span className="text-gray-700">Назначить</span>
    </div>
  )
}

function SelectAllRow({
  count, selected, onToggle, label
}: {
  count: number; selected: boolean; onToggle: () => void; label: string
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-600 py-1 px-1"
    >
      {selected
        ? <CheckSquare size={16} className="text-primary-600" />
        : <Square size={16} className="text-gray-300" />
      }
      {selected ? 'Снять всё' : `Выбрать все ${label} (${count})`}
    </button>
  )
}

function ConfirmRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3 flex items-start gap-4">
      <span className="text-sm text-gray-500 w-32 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}
