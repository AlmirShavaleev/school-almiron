import { useState } from 'react'
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Users, User, Calendar, XCircle,
  RefreshCw, PlusCircle, Loader2, CheckCircle2, Clock, AlertCircle,
  Edit2, BarChart2, ClipboardList, Search,
} from 'lucide-react'
import { useVariantDetail } from '@/hooks/useVariants'
import {
  useVariantAssignments,
  cancelAssignment,
  syncGroupAssignment,
  updateAssignment,
  type VariantAssignment,
} from '@/hooks/useVariantAssignments'
import { useVariantResults } from '@/hooks/useVariantResults'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/store/toastStore'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { dateTimeLocalToIso, toDateTimeLocalValue } from '@/utils/dateTimeLocal'
import { buildVariantAssignmentSummaryLines } from '@/utils/variantAssignmentSummary'
import {
  deriveDisplayStatus,
  buildResultSummary,
  DISPLAY_STATUS_LABEL,
  DISPLAY_STATUS_CLASS,
  type VariantResultRow,
} from '@/utils/variantResultsUtils'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS: Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Активно',
  draft: 'Черновик',
  cancelled: 'Отменено',
  completed: 'Завершено',
}
const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'default' | 'error'> = {
  assigned: 'success',
  draft: 'default',
  cancelled: 'error',
  completed: 'success',
}

type TabId = 'assignments' | 'results'

export function VariantAssignmentsPage() {
  const { variantId } = useParams<{ variantId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuthStore()
  const { variant, loading: variantLoading } = useVariantDetail(variantId)
  const { assignments, loading, error, refresh } = useVariantAssignments(variantId)
  const { rows: resultRows, loading: resultsLoading, error: resultsError, refresh: refreshResults } =
    useVariantResults(variantId)

  const [tab, setTab] = useState<TabId>('assignments')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDueAt, setEditDueAt] = useState('')
  const [editFrom, setEditFrom] = useState('')
  const [clearDueAt, setClearDueAt] = useState(false)
  const [clearFrom, setClearFrom] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [search, setSearch] = useState('')

  // Results tab filters
  const [resSearch, setResSearch] = useState('')
  const [resStatusFilter, setResStatusFilter] = useState('')
  const [resGroupFilter, setResGroupFilter] = useState('')
  const [resSortKey, setResSortKey] = useState<'student_name' | 'due_at' | 'started_at' | 'completed_at'>('student_name')
  const [resSortDir, setResSortDir] = useState<'asc' | 'desc'>('asc')

  const assignmentSummary = (location.state as {
    assignmentSummary?: {
      students_created: number
      notifications_created: number
      telegram_connected: number
      telegram_not_connected: number
      telegram_queued: number
    }
  } | null)?.assignmentSummary

  const canManage = profile && ['teacher', 'admin', 'owner'].includes(profile.role)
  const groupOptions = Array.from(
    new Map(assignments.filter(a => a.group_id && a.group).map(a => [a.group_id!, a.group!.name])).entries()
  )
  const filteredAssignments = assignments.filter(a => {
    if (statusFilter && a.status !== statusFilter) return false
    if (groupFilter && a.group_id !== groupFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    const text = [
      a.group?.name,
      (a as any)._student_profile?.profiles?.full_name,
      a.assigned_by_profile?.full_name,
      a.group?.course?.title,
    ].filter(Boolean).join(' ').toLowerCase()
    return text.includes(q)
  })

  // ── Results filtering + sorting ───────────────────────────────────────────
  const now = new Date()
  const resGroupOptions = Array.from(
    new Map(
      resultRows.filter(r => r.group_id && r.group_name).map(r => [r.group_id!, r.group_name!])
    ).entries()
  )
  const filteredResults: VariantResultRow[] = resultRows
    .filter(r => {
      if (resGroupFilter && r.group_id !== resGroupFilter) return false
      if (resStatusFilter) {
        const ds = deriveDisplayStatus(r, now)
        if (ds !== resStatusFilter) return false
      }
      const q = resSearch.trim().toLowerCase()
      return !q || (r.student_name ?? '').toLowerCase().includes(q) ||
        (r.group_name ?? '').toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const dir = resSortDir === 'asc' ? 1 : -1
      const va = (a[resSortKey] ?? '') as string
      const vb = (b[resSortKey] ?? '') as string
      return va < vb ? -dir : va > vb ? dir : 0
    })

  const summary = buildResultSummary(resultRows, now)

  // Average score: only completed rows with non-NULL percentage
  const completedWithScore = resultRows.filter(
    r => (r.status === 'submitted' || r.status === 'completed') && r.percentage !== null
  )
  const avgScore = completedWithScore.length > 0
    ? Math.round(completedWithScore.reduce((s, r) => s + (r.percentage ?? 0), 0) / completedWithScore.length)
    : null

  function toggleSort(key: typeof resSortKey) {
    if (resSortKey === key) {
      setResSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setResSortKey(key)
      setResSortDir('asc')
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Отменить это назначение? Ученики потеряют доступ к варианту.')) return
    try {
      await cancelAssignment(id)
      toast.success('Назначение отменено')
      refresh()
    } catch {
      toast.error('Не удалось отменить')
    }
  }

  async function handleSync(id: string) {
    try {
      const result = await syncGroupAssignment(id)
      toast.success(`Синхронизировано: добавлено ${result.added} новых учеников`)
      refresh()
    } catch {
      toast.error('Не удалось синхронизировать')
    }
  }

  function startEdit(a: VariantAssignment) {
    setEditingId(a.id)
    setEditDueAt(toDateTimeLocalValue(a.due_at))
    setEditFrom(toDateTimeLocalValue(a.available_from))
    setClearDueAt(false)
    setClearFrom(false)
  }

  async function saveEdit(id: string) {
    if (savingId === id) return
    setSavingId(id)
    try {
      await updateAssignment(id, {
        available_from: dateTimeLocalToIso(editFrom),
        due_at: dateTimeLocalToIso(editDueAt),
        clear_available_from: clearFrom,
        clear_due_at: clearDueAt,
      })
      toast.success('Изменения сохранены')
      setEditingId(null)
      refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message.replace(/^[A-Z_]+: /, '') : 'Ошибка')
    } finally {
      setSavingId(null)
    }
  }

  if (!canManage) return <div className="p-8 text-center text-gray-500">Нет доступа</div>

  if (variantLoading || loading) {
    return (
      <div className="max-w-4xl mx-auto py-10 text-center">
        <Loader2 size={28} className="animate-spin text-primary-500 mx-auto" />
      </div>
    )
  }

  if (!variant) return <div className="p-8 text-center text-red-500">Вариант не найден</div>

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(`/variants/${variantId}`)}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <nav className="text-sm text-gray-500 flex items-center gap-1.5 flex-1 min-w-0">
          <Link to="/variants" className="hover:text-primary-600">Варианты</Link>
          <span>/</span>
          <Link to={`/variants/${variantId}`} className="hover:text-primary-600 truncate max-w-[200px]">
            {variant.title}
          </Link>
          <span>/</span>
          <span className="text-gray-700">{tab === 'assignments' ? 'Назначения' : 'Результаты'}</span>
        </nav>
        <Button onClick={() => navigate(`/variants/${variantId}/assign`)}>
          <PlusCircle size={14} className="mr-1.5" /> Назначить
        </Button>
      </div>

      <h1 className="text-xl font-bold text-gray-900 mb-4">
        {variant.title}
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200" data-testid="variant-tabs">
        <TabButton
          active={tab === 'assignments'}
          icon={<ClipboardList size={15} />}
          label="Назначения"
          count={assignments.length}
          onClick={() => setTab('assignments')}
          testId="tab-assignments"
        />
        <TabButton
          active={tab === 'results'}
          icon={<BarChart2 size={15} />}
          label="Результаты"
          count={resultRows.length}
          onClick={() => { setTab('results'); refreshResults() }}
          testId="tab-results"
        />
      </div>

      {error && tab === 'assignments' && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {/* ── ASSIGNMENTS TAB ─────────────────────────────────────────────────── */}
      {tab === 'assignments' && (
        <div data-testid="assignments-panel">
          {assignmentSummary && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <div className="font-semibold mb-2">Итог назначения</div>
              {buildVariantAssignmentSummaryLines(assignmentSummary).map(line => (
                <div key={line}>{line}</div>
              ))}
            </div>
          )}

          <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по группе, ученику, автору"
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select
              value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Все группы</option>
              {groupOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Все статусы</option>
              <option value="assigned">Активно</option>
              <option value="cancelled">Отменено</option>
              <option value="completed">Завершено</option>
              <option value="draft">Черновик</option>
            </select>
          </div>

          {assignments.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <Users size={36} className="mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 text-sm mb-4">Этот вариант ещё никому не назначен</p>
              <Button onClick={() => navigate(`/variants/${variantId}/assign`)}>
                <PlusCircle size={14} className="mr-1.5" /> Назначить первым
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAssignments.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
                  По выбранным фильтрам назначений нет
                </div>
              )}
              {filteredAssignments.map(a => (
                <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    {/* Left */}
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`p-2 rounded-lg shrink-0 ${a.group_id ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                        {a.group_id ? <Users size={16} /> : <User size={16} />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-gray-900">
                            {a.group_id
                              ? (a.group as any)?.name ?? 'Группа'
                              : (a as any)._student_profile?.profiles?.full_name ?? 'Ученик'
                            }
                          </span>
                          <Badge variant={STATUS_VARIANT[a.status] ?? 'default'}>
                            {STATUS_LABEL[a.status] ?? a.status}
                          </Badge>
                          {a.group_id && a.student_count !== undefined && (
                            <span className="text-xs text-gray-400">{a.student_count} уч.</span>
                          )}
                        </div>
                        {a.group?.course && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {SUBJECT_LABELS[a.group.course.subject] ?? a.group.course.subject} · {EXAM_LABELS[a.group.course.exam_type] ?? a.group.course.exam_type}
                            {' · '}{a.group.teacher?.profiles?.full_name ?? a.assigned_by_profile?.full_name ?? 'Преподаватель'}
                          </div>
                        )}
                        <div className="flex items-center gap-4 mt-1 flex-wrap">
                          <DateChip icon={<Clock size={11} />}
                            label={a.available_from
                              ? format(new Date(a.available_from), 'd MMM HH:mm', { locale: ru })
                              : 'Немедленно'
                            }
                          />
                          <DateChip icon={<Calendar size={11} />}
                            label={a.due_at
                              ? format(new Date(a.due_at), 'd MMM yyyy HH:mm', { locale: ru })
                              : 'Без дедлайна'
                            }
                            overdue={!!a.due_at && new Date(a.due_at) < new Date()}
                          />
                          <DateChip icon={<RefreshCw size={11} />}
                            label={a.allow_retry ? `${a.max_attempts} поп.` : '1 попытка'}
                          />
                          <DateChip icon={<Clock size={11} />}
                            label={`Создано ${format(new Date(a.created_at), 'd MMM yyyy HH:mm', { locale: ru })}`}
                          />
                          {a.assigned_by_profile?.full_name && (
                            <span className="text-xs text-gray-400">Назначил: {a.assigned_by_profile.full_name}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    {a.status === 'assigned' && (
                      <div className="flex items-center gap-2 shrink-0">
                        {a.group_id && (
                          <button
                            onClick={() => handleSync(a.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Синхронизировать группу"
                          >
                            <RefreshCw size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => startEdit(a)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          title="Изменить сроки"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleCancel(a.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Отменить"
                        >
                          <XCircle size={15} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Inline edit */}
                  {editingId === a.id && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="flex items-end gap-3 flex-wrap">
                        <label className="block">
                          <span className="text-xs text-gray-500 block mb-1">Открыть с</span>
                          <input type="datetime-local" value={editFrom}
                            onChange={e => { setEditFrom(e.target.value); setClearFrom(false) }}
                            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => { setEditFrom(''); setClearFrom(true) }}
                          className="text-xs text-gray-400 hover:text-red-600 mb-2"
                        >
                          Очистить открытие
                        </button>
                        <label className="block">
                          <span className="text-xs text-gray-500 block mb-1">Дедлайн</span>
                          <input type="datetime-local" value={editDueAt}
                            onChange={e => { setEditDueAt(e.target.value); setClearDueAt(false) }}
                            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => { setEditDueAt(''); setClearDueAt(true) }}
                          className="text-xs text-gray-400 hover:text-red-600 mb-2"
                        >
                          Очистить дедлайн
                        </button>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveEdit(a.id)} disabled={savingId === a.id}>
                            {savingId === a.id
                              ? <Loader2 size={13} className="animate-spin mr-1" />
                              : <CheckCircle2 size={13} className="mr-1" />
                            }
                            Сохранить
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                            Отмена
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── RESULTS TAB ─────────────────────────────────────────────────────── */}
      {tab === 'results' && (
        <div data-testid="results-panel">
          {resultsError && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{resultsError}</div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5" data-testid="results-summary">
            <StatCard label="Назначено"   value={summary.total}       color="gray" />
            <StatCard label="Не начали"   value={summary.not_started} color="gray" />
            <StatCard label="В процессе"  value={summary.in_progress} color="blue" />
            <StatCard label="Завершили"   value={summary.completed}   color="green" />
            <StatCard label="Просрочили"  value={summary.overdue}     color="red" />
            <StatCard label="Средний %"    value={avgScore !== null ? `${avgScore}%` : '—'} color="gray" />
          </div>

          {/* Results filters */}
          <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={resSearch}
                onChange={e => setResSearch(e.target.value)}
                placeholder="Поиск по ученику или группе"
                className="w-full text-sm border border-gray-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                data-testid="results-search"
              />
            </div>
            <select
              value={resStatusFilter}
              onChange={e => setResStatusFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              data-testid="results-status-filter"
            >
              <option value="">Все статусы</option>
              <option value="not_started">Не начат</option>
              <option value="in_progress">В процессе</option>
              <option value="completed">Завершён</option>
              <option value="overdue">Просрочен</option>
              <option value="cancelled">Отменён</option>
            </select>
            <select
              value={resGroupFilter}
              onChange={e => setResGroupFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              data-testid="results-group-filter"
            >
              <option value="">Все группы</option>
              {resGroupOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>

          {/* Results table */}
          {resultsLoading ? (
            <div className="py-16 text-center">
              <Loader2 size={24} className="animate-spin text-primary-500 mx-auto" />
            </div>
          ) : resultRows.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <BarChart2 size={36} className="mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 text-sm">Нет данных — вариант ещё никому не назначен</p>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
              По выбранным фильтрам учеников нет
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" data-testid="results-table">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <SortTh label="Ученик"    sortKey="student_name"  current={resSortKey} dir={resSortDir} onSort={toggleSort} />
                      <th className="px-3 py-2.5 text-left font-medium text-gray-500">Группа</th>
                      <th className="px-3 py-2.5 text-left font-medium text-gray-500">Статус</th>
                      <SortTh label="Дедлайн"   sortKey="due_at"        current={resSortKey} dir={resSortDir} onSort={toggleSort} />
                      <SortTh label="Начал"      sortKey="started_at"    current={resSortKey} dir={resSortDir} onSort={toggleSort} />
                      <SortTh label="Завершил"   sortKey="completed_at"  current={resSortKey} dir={resSortDir} onSort={toggleSort} />
                      <th className="px-3 py-2.5 text-left font-medium text-gray-500">Прогресс</th>
                      <th className="px-3 py-2.5 text-left font-medium text-gray-500">Балл</th>
                      <th className="px-3 py-2.5 text-left font-medium text-gray-500">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map(row => (
                      <ResultRow key={row.tvsa_id} row={row} now={now} variantId={variantId ?? ''} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TabButton({
  active, icon, label, count, onClick, testId,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  count: number
  onClick: () => void
  testId: string
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      aria-selected={active}
      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary-600 text-primary-700'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
          active ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

function StatCard({
  label, value, color,
}: {
  label: string
  value: number | string
  color: 'gray' | 'blue' | 'green' | 'red'
}) {
  const colorMap: Record<string, string> = {
    gray:  'text-gray-900',
    blue:  'text-blue-700',
    green: 'text-green-700',
    red:   'text-red-700',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
      <div className={`text-xl font-bold ${colorMap[color]}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

function ResultRow({ row, now, variantId }: { row: VariantResultRow; now: Date; variantId: string }) {
  const navigate = useNavigate()
  const ds = deriveDisplayStatus(row, now)
  const canReview = row.status === 'submitted' || row.grading_status === 'needs_review' || row.grading_status === 'graded'
  const handleClick = () => {
    if (canReview) navigate(`/variants/${variantId}/work/${row.tvsa_id}`)
  }
  return (
    <tr
      className={`border-b border-gray-50 transition-colors ${canReview ? 'hover:bg-blue-50/40 cursor-pointer' : 'hover:bg-gray-50/50'}`}
      data-testid="result-row"
      onClick={handleClick}
    >
      <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">
        {row.student_name ?? '—'}
      </td>
      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
        {row.group_name ?? <span className="text-gray-300">индив.</span>}
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${DISPLAY_STATUS_CLASS[ds]}`}>
          {DISPLAY_STATUS_LABEL[ds]}
        </span>
      </td>
      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">
        {row.due_at
          ? format(new Date(row.due_at), 'd MMM yyyy HH:mm', { locale: ru })
          : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">
        {row.started_at
          ? format(new Date(row.started_at), 'd MMM HH:mm', { locale: ru })
          : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">
        {row.completed_at
          ? format(new Date(row.completed_at), 'd MMM HH:mm', { locale: ru })
          : <span className="text-gray-300">—</span>}
      </td>
      {/* Прогресс: answered / total */}
      <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">
        {row.answered_count !== null
          ? `${row.answered_count} / ${row.variant_tasks_count}`
          : <span className="text-gray-300">—</span>}
      </td>
      {/* Балл */}
      <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">
        {row.score !== null && row.max_score !== null
          ? `${row.score} / ${row.max_score}`
          : <span className="text-gray-300">—</span>}
      </td>
      {/* % */}
      <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">
        {row.percentage !== null
          ? `${row.percentage}%`
          : <span className="text-gray-300">—</span>}
      </td>
    </tr>
  )
}

function SortTh({
  label, sortKey, current, dir, onSort,
}: {
  label: string
  sortKey: 'student_name' | 'due_at' | 'started_at' | 'completed_at'
  current: string
  dir: 'asc' | 'desc'
  onSort: (k: 'student_name' | 'due_at' | 'started_at' | 'completed_at') => void
}) {
  const active = current === sortKey
  return (
    <th
      className="px-3 py-2.5 text-left font-medium text-gray-500 cursor-pointer select-none hover:text-gray-800 whitespace-nowrap"
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span className="ml-1 text-gray-300">
        {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </th>
  )
}

function DateChip({
  icon, label, overdue,
}: {
  icon: React.ReactNode; label: string; overdue?: boolean
}) {
  return (
    <span className={`flex items-center gap-1 text-xs ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
      {overdue ? <AlertCircle size={11} /> : icon}
      {label}
    </span>
  )
}
