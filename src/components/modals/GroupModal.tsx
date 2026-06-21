import { useState, useEffect, useRef } from 'react'
import {
  X, Users, Settings, Search, UserPlus, UserMinus,
  Loader2, Check, ExternalLink, GraduationCap, BookOpen,
  Shield, ChevronDown,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupData {
  id:             string
  name:           string
  course_id:      string | null
  teacher_id:     string | null
  curator_id:     string | null
  max_students:   number
  schedule_days:  string[]
  schedule_time:  string | null
  is_active:      boolean
}

interface SelectOption { id: string; label: string; sub?: string }
interface StudentRow   { student_id: string; full_name: string; email: string; avatar_url: string | null }

interface Props {
  open:         boolean
  onClose:      () => void
  onSaved:      () => void
  group?:       GroupData | null   // null/undefined = create mode
  initialTab?:  'settings' | 'students'
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

// ─── Component ────────────────────────────────────────────────────────────────

export function GroupModal({ open, onClose, onSaved, group, initialTab = 'settings' }: Props) {
  const navigate   = useNavigate()
  const isEdit     = !!group?.id
  const [tab, setTab] = useState<'settings' | 'students'>('settings')

  // ── Form fields ──────────────────────────────────────────────────────────
  const [name,         setName]         = useState('')
  const [courseId,     setCourseId]     = useState<string>('')
  const [teacherId,    setTeacherId]    = useState<string>('')
  const [curatorId,    setCuratorId]    = useState<string>('')
  const [maxStudents,  setMaxStudents]  = useState(20)
  const [days,         setDays]         = useState<string[]>([])
  const [time,         setTime]         = useState('')
  const [isActive,     setIsActive]     = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [errors,       setErrors]       = useState<Record<string, string>>({})

  // ── Options ──────────────────────────────────────────────────────────────
  const [courses,  setCourses]  = useState<SelectOption[]>([])
  const [teachers, setTeachers] = useState<SelectOption[]>([])
  const [curators, setCurators] = useState<SelectOption[]>([])
  const [optsLoading, setOptsLoading] = useState(false)

  // ── Students tab ─────────────────────────────────────────────────────────
  const [members,   setMembers]   = useState<StudentRow[]>([])
  const [membLoading, setMembLoading] = useState(false)
  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState<StudentRow[]>([])
  const [searching, setSearching] = useState(false)
  const [adding,    setAdding]    = useState<string | null>(null)
  const [removing,  setRemoving]  = useState<string | null>(null)
  const [addedIds,  setAddedIds]  = useState<Set<string>>(new Set())
  const searchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ── Load options + fill form ─────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    setErrors({})
    setOptsLoading(true)

    // Fill form if editing
    if (group) {
      setName(group.name)
      setCourseId(group.course_id || '')
      setTeacherId(group.teacher_id || '')
      setCuratorId(group.curator_id || '')
      setMaxStudents(group.max_students || 20)
      setDays(group.schedule_days || [])
      setTime(group.schedule_time || '')
      setIsActive(group.is_active ?? true)
    } else {
      setName(''); setCourseId(''); setTeacherId(''); setCuratorId('')
      setMaxStudents(20); setDays([]); setTime(''); setIsActive(true)
    }

    // Load select options
    Promise.all([
      supabase.from('courses').select('id, title, subject, exam_type').order('title'),
      supabase.from('teachers').select('id, profiles(full_name, email)').eq('is_active', true).order('id'),
      supabase.from('curators').select('id, profiles(full_name, email)').eq('is_active', true).order('id'),
    ]).then(([cRes, tRes, curRes]) => {
      setCourses((cRes.data || []).map((c: any) => ({
        id:    c.id,
        label: c.title,
        sub:   [SUBJECT_LABELS[c.subject] || c.subject, EXAM_LABELS[c.exam_type] || c.exam_type].filter(Boolean).join(' · '),
      })))
      setTeachers((tRes.data || []).map((t: any) => ({
        id:    t.id,
        label: t.profiles?.full_name || '—',
        sub:   t.profiles?.email,
      })))
      setCurators((curRes.data || []).map((c: any) => ({
        id:    c.id,
        label: c.profiles?.full_name || '—',
        sub:   c.profiles?.email,
      })))
      setOptsLoading(false)
    })
  }, [open, group?.id])

  // ── Load members when students tab opens ─────────────────────────────────

  useEffect(() => {
    if (!open || tab !== 'students' || !group?.id) return
    setMembLoading(true)
    setQuery(''); setResults([]); setAddedIds(new Set())
    supabase
      .from('group_students')
      .select('student_id, students(id, profiles(full_name, email, avatar_url))')
      .eq('group_id', group.id)
      .then(({ data }) => {
        setMembers((data || []).map((r: any) => ({
          student_id: r.student_id,
          full_name:  r.students?.profiles?.full_name || '—',
          email:      r.students?.profiles?.email     || '',
          avatar_url: r.students?.profiles?.avatar_url || null,
        })))
        setMembLoading(false)
      })
  }, [open, tab, group?.id])

  // ── Search students (debounced) ──────────────────────────────────────────

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    clearTimeout(searchRef.current)
    setSearching(true)
    const memberIds = new Set(members.map(m => m.student_id))

    searchRef.current = setTimeout(async () => {
      // Step 1: find matching profiles with role=student
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url')
        .eq('role', 'student')
        .ilike('full_name', `%${query.trim()}%`)
        .limit(15)

      if (!profileRows?.length) { setResults([]); setSearching(false); return }

      // Step 2: get student IDs for those profiles
      const profileIds = profileRows.map((p: any) => p.id)
      const { data: studentRows } = await supabase
        .from('students')
        .select('id, profile_id')
        .in('profile_id', profileIds)

      const profileMap = new Map((profileRows || []).map((p: any) => [p.id, p]))
      const rows: StudentRow[] = (studentRows || [])
        .filter((s: any) => !memberIds.has(s.id))
        .map((s: any) => {
          const p = profileMap.get(s.profile_id) || {}
          return {
            student_id: s.id,
            full_name:  (p as any).full_name  || '—',
            email:      (p as any).email      || '',
            avatar_url: (p as any).avatar_url || null,
          }
        })

      setResults(rows)
      setSearching(false)
    }, 350)
    return () => clearTimeout(searchRef.current)
  }, [query, members])

  // ── Save group ───────────────────────────────────────────────────────────

  async function handleSave() {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Введите название группы'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    try {
      const payload = {
        name:          name.trim(),
        course_id:     courseId || null,
        teacher_id:    teacherId || null,
        curator_id:    curatorId || null,
        max_students:  maxStudents,
        schedule_days: days.length ? days : null,
        schedule_time: time || null,
        is_active:     isActive,
      }

      if (isEdit) {
        const { error } = await supabase.from('groups').update(payload).eq('id', group!.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('groups').insert(payload)
        if (error) throw error
      }

      onSaved()
      onClose()
    } catch (e: any) {
      setErrors({ general: e.message || 'Ошибка сохранения' })
    } finally {
      setSaving(false)
    }
  }

  // ── Add student ──────────────────────────────────────────────────────────

  async function handleAddStudent(s: StudentRow) {
    if (!group?.id) return
    setAdding(s.student_id)
    try {
      const { error } = await supabase.from('group_students')
        .insert({ group_id: group.id, student_id: s.student_id })
      if (error) throw error
      setMembers(prev => [...prev, s])
      setAddedIds(prev => new Set(prev).add(s.student_id))
      setResults(prev => prev.filter(r => r.student_id !== s.student_id))
      onSaved()
    } catch (e: any) {
      const msg = (e.message || '') as string
      if (msg.includes('GROUP_FULL')) {
        alert(`Группа заполнена — достигнут лимит в ${maxStudents} учеников`)
      } else {
        alert(msg)
      }
    } finally { setAdding(null) }
  }

  // ── Remove student ───────────────────────────────────────────────────────

  async function handleRemoveStudent(studentId: string) {
    if (!group?.id || !confirm('Удалить ученика из группы?')) return
    setRemoving(studentId)
    try {
      const { error } = await supabase.from('group_students')
        .delete().eq('group_id', group.id).eq('student_id', studentId)
      if (error) throw error
      setMembers(prev => prev.filter(m => m.student_id !== studentId))
      onSaved()
    } catch (e: any) { alert(e.message) } finally { setRemoving(null) }
  }

  // ── Toggle day ───────────────────────────────────────────────────────────

  function toggleDay(d: string) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  if (!open) return null

  const isFull = members.length >= maxStudents

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col z-10">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">
              {isEdit ? `Редактирование: ${group!.name}` : 'Новая группа'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {isEdit ? 'Изменение настроек и состава группы' : 'Создание учебной группы'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3 shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-gray-100 px-6 shrink-0">
          <button
            onClick={() => setTab('settings')}
            className={cn(
              'flex items-center gap-1.5 px-1 py-3 mr-6 text-sm font-semibold border-b-2 -mb-px transition-colors',
              tab === 'settings' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            )}
          >
            <Settings size={14} />Настройки
          </button>
          <button
            onClick={() => setTab('students')}
            disabled={!isEdit}
            className={cn(
              'flex items-center gap-1.5 px-1 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors',
              tab === 'students' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800',
              !isEdit && 'opacity-40 cursor-not-allowed'
            )}
          >
            <Users size={14} />
            Ученики
            {isEdit && <span className="ml-1 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{members.length}</span>}
            {!isEdit && <span className="ml-1 text-xs text-gray-400">(сначала создайте)</span>}
          </button>
        </div>

        {/* ════ TAB: НАСТРОЙКИ ════ */}
        {tab === 'settings' && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {errors.general && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                {errors.general}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Название группы <span className="text-red-500">*</span>
              </label>
              <input
                value={name}
                onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })) }}
                placeholder="Например: ЕГЭ Физика 11А"
                className={cn(
                  'w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400',
                  errors.name ? 'border-red-300' : 'border-gray-200'
                )}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>

            {/* Course */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                <BookOpen size={13} className="inline mr-1.5 -mt-0.5" />Курс
              </label>
              {optsLoading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                  <Loader2 size={14} className="animate-spin" />Загрузка…
                </div>
              ) : (
                <SelectField
                  value={courseId}
                  onChange={setCourseId}
                  options={courses}
                  placeholder="Выберите курс…"
                />
              )}
            </div>

            {/* Teacher + Curator row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  <GraduationCap size={13} className="inline mr-1.5 -mt-0.5" />Преподаватель
                </label>
                {optsLoading ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                    <Loader2 size={14} className="animate-spin" />
                  </div>
                ) : (
                  <SelectField
                    value={teacherId}
                    onChange={setTeacherId}
                    options={teachers}
                    placeholder="Не назначен"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  <Shield size={13} className="inline mr-1.5 -mt-0.5" />Куратор
                </label>
                {optsLoading ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                    <Loader2 size={14} className="animate-spin" />
                  </div>
                ) : (
                  <SelectField
                    value={curatorId}
                    onChange={setCuratorId}
                    options={curators}
                    placeholder="Не назначен"
                  />
                )}
              </div>
            </div>

            {/* Max students + active row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Макс. учеников
                </label>
                <input
                  type="number" min={1} max={100}
                  value={maxStudents}
                  onChange={e => setMaxStudents(Number(e.target.value) || 20)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Статус</label>
                <button
                  type="button"
                  onClick={() => setIsActive(v => !v)}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors',
                    isActive
                      ? 'border-green-300 bg-green-50 text-green-700'
                      : 'border-gray-200 bg-gray-50 text-gray-500'
                  )}
                >
                  <span>{isActive ? '✅ Активна' : '⏸ Закрыта'}</span>
                  <span className="text-xs opacity-60">нажать чтобы изменить</span>
                </button>
              </div>
            </div>

            {/* Schedule */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Расписание
              </label>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {DAYS.map(d => (
                  <button
                    key={d} type="button"
                    onClick={() => toggleDay(d)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
                      days.includes(d)
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {days.length > 0 && (
                <input
                  type="time"
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 w-36"
                />
              )}
            </div>

          </div>
        )}

        {/* ════ TAB: УЧЕНИКИ ════ */}
        {tab === 'students' && isEdit && (
          <div className="flex-1 overflow-y-auto flex flex-col">

            {/* Search bar */}
            <div className="px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Найти ученика по имени…"
                  disabled={isFull}
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {searching && (
                  <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
                )}
              </div>
              {isFull && (
                <p className="text-xs text-orange-600 mt-1.5">Группа заполнена ({members.length}/{maxStudents})</p>
              )}

              {/* Search results dropdown */}
              {results.length > 0 && (
                <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 shadow-sm">
                  {results.map(s => (
                    <div key={s.student_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                      <StudentAvatar s={s} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{s.full_name}</div>
                        <div className="text-xs text-gray-400 truncate">{s.email}</div>
                      </div>
                      {addedIds.has(s.student_id) ? (
                        <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                          <Check size={12} />Добавлен
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAddStudent(s)}
                          disabled={adding === s.student_id || isFull}
                          className="flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                        >
                          {adding === s.student_id ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                          Добавить
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {query.trim() && !searching && results.length === 0 && (
                <p className="text-xs text-gray-400 mt-2">Ничего не найдено</p>
              )}
            </div>

            {/* Members */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {membLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
                  <Loader2 size={18} className="animate-spin" />Загрузка…
                </div>
              ) : members.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Users size={36} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">В группе пока нет учеников</p>
                  <p className="text-xs mt-1 opacity-70">Используйте поиск выше</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                      Участники — {members.length} / {maxStudents}
                    </p>
                    <div className="w-24 bg-gray-100 rounded-full h-1.5">
                      <div
                        className={cn('h-1.5 rounded-full transition-all', isFull ? 'bg-red-400' : 'bg-primary-500')}
                        style={{ width: `${Math.min(members.length / maxStudents * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                  {members.map(s => (
                    <div key={s.student_id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors group">
                      <StudentAvatar s={s} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800">{s.full_name}</div>
                        <div className="text-xs text-gray-400">{s.email}</div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 transition-all">
                        <button
                          onClick={() => { onClose(); navigate(`/students/${s.student_id}`) }}
                          className="p-1.5 text-gray-400 border border-gray-200 rounded-lg hover:text-primary-600 hover:border-primary-300 transition-colors"
                          title="Открыть профиль"
                        >
                          <ExternalLink size={12} />
                        </button>
                        <button
                          onClick={() => handleRemoveStudent(s.student_id)}
                          disabled={removing === s.student_id}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          {removing === s.student_id ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                          Убрать
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between gap-3">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors px-3 py-2">
            Отмена
          </button>

          {tab === 'settings' && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold rounded-xl disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {isEdit ? 'Сохранить изменения' : 'Создать группу'}
            </button>
          )}
          {tab === 'students' && (
            <button onClick={onClose} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-xl transition-colors">
              Готово
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StudentAvatar({ s, size = 'md' }: { s: StudentRow; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm'
  return (
    <div className={cn('rounded-full bg-primary-100 text-primary-600 font-bold flex items-center justify-center shrink-0 overflow-hidden', cls)}>
      {s.avatar_url
        ? <img src={s.avatar_url} className="w-full h-full object-cover" alt="" />
        : s.full_name.charAt(0).toUpperCase()
      }
    </div>
  )
}

function SelectField({
  value, onChange, options, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder: string
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white pr-9"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.label}{o.sub ? ` — ${o.sub}` : ''}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  )
}
