import { useState, useEffect } from 'react'
import {
  GraduationCap, Shield, Users, ChevronDown,
  Loader2, Check, BookOpen, Plus, AlertCircle, UserX, UserCheck,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaffMember {
  id:         string   // teacher.id or curator.id
  profile_id: string
  full_name:  string
  email:      string
  avatar_url: string | null
  is_active:  boolean
  groups:     { id: string; name: string }[]
}

interface GroupOption {
  id:   string
  name: string
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StaffTab() {
  const [teachers, setTeachers] = useState<StaffMember[]>([])
  const [curators, setCurators] = useState<StaffMember[]>([])
  const [groups,   setGroups]   = useState<GroupOption[]>([])
  const [loading,  setLoading]  = useState(true)
  const [tick,     setTick]     = useState(0)

  const reload = () => setTick(t => t + 1)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      // Teachers with their groups
      supabase.from('teachers')
        .select('id, profile_id, is_active, profiles(full_name, email, avatar_url)')
        .order('id'),

      // Curators with their groups
      supabase.from('curators')
        .select('id, profile_id, is_active, profiles(full_name, email, avatar_url)')
        .order('id'),

      // All active groups
      supabase.from('groups')
        .select('id, name, teacher_id, curator_id')
        .eq('is_active', true)
        .order('name'),
    ]).then(([tRes, cRes, gRes]) => {
      const allGroups: any[] = gRes.data || []
      setGroups(allGroups.map(g => ({ id: g.id, name: g.name })))

      setTeachers((tRes.data || []).map((t: any) => ({
        id:         t.id,
        profile_id: t.profile_id,
        full_name:  t.profiles?.full_name  || '—',
        email:      t.profiles?.email      || '',
        avatar_url: t.profiles?.avatar_url || null,
        is_active:  t.is_active ?? true,
        groups:     allGroups.filter(g => g.teacher_id === t.id).map(g => ({ id: g.id, name: g.name })),
      })))

      setCurators((cRes.data || []).map((c: any) => ({
        id:         c.id,
        profile_id: c.profile_id,
        full_name:  c.profiles?.full_name  || '—',
        email:      c.profiles?.email      || '',
        avatar_url: c.profiles?.avatar_url || null,
        is_active:  c.is_active ?? true,
        groups:     allGroups.filter(g => g.curator_id === c.id).map(g => ({ id: g.id, name: g.name })),
      })))

      setLoading(false)
    })
  }, [tick])

  if (loading) return (
    <div className="flex items-center justify-center h-48 gap-2 text-gray-400">
      <Loader2 size={20} className="animate-spin" />Загрузка…
    </div>
  )

  return (
    <div className="space-y-8">

      {/* ── УЧИТЕЛЯ ── */}
      <StaffSection
        title="Преподаватели"
        icon={<GraduationCap size={18} className="text-green-600" />}
        color="green"
        members={teachers}
        groups={groups}
        role="teacher"
        onReload={reload}
      />

      {/* ── КУРАТОРЫ ── */}
      <StaffSection
        title="Кураторы"
        icon={<Shield size={18} className="text-yellow-600" />}
        color="yellow"
        members={curators}
        groups={groups}
        role="curator"
        onReload={reload}
      />
    </div>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

function StaffSection({
  title, icon, color, members, groups, role, onReload,
}: {
  title:    string
  icon:     React.ReactNode
  color:    'green' | 'yellow'
  members:  StaffMember[]
  groups:   GroupOption[]
  role:     'teacher' | 'curator'
  onReload: () => void
}) {
  const borderCls = color === 'green' ? 'border-green-200' : 'border-yellow-200'
  const bgCls     = color === 'green' ? 'bg-green-50'      : 'bg-yellow-50'
  const badgeCls  = color === 'green'
    ? 'bg-green-100 text-green-700'
    : 'bg-yellow-100 text-yellow-700'

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-base font-bold text-gray-800">{title}</h2>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{members.length}</span>
      </div>

      {members.length === 0 ? (
        <div className="flex items-center gap-3 py-6 px-5 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 text-sm">
          <AlertCircle size={18} className="opacity-50" />
          Нет {role === 'teacher' ? 'преподавателей' : 'кураторов'} в базе
        </div>
      ) : (
        <div className="space-y-3">
          {members.map(m => (
            <StaffCard
              key={m.id}
              member={m}
              groups={groups}
              role={role}
              badgeCls={badgeCls}
              borderCls={borderCls}
              bgCls={bgCls}
              onReload={onReload}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Staff card ───────────────────────────────────────────────────────────────

function StaffCard({
  member, groups, role, badgeCls, borderCls, bgCls, onReload,
}: {
  member:     StaffMember
  groups:     GroupOption[]
  role:       'teacher' | 'curator'
  badgeCls:   string
  borderCls:  string
  bgCls:      string
  onReload:   () => void
}) {
  const [assigning,    setAssigning]    = useState(false)
  const [removing,     setRemoving]     = useState<string | null>(null)
  const [toggling,     setToggling]     = useState(false)

  async function toggleActive() {
    setToggling(true)
    const table = role === 'teacher' ? 'teachers' : 'curators'
    const { error } = await supabase.from(table as any)
      .update({ is_active: !member.is_active } as any)
      .eq('id', member.id)
    setToggling(false)
    if (error) { alert(error.message); return }
    onReload()
  }

  // Groups not yet assigned to this member
  const assignedIds  = new Set(member.groups.map(g => g.id))
  const available    = groups.filter(g => !assignedIds.has(g.id))

  async function assignGroup(groupId: string) {
    if (!groupId) return
    setAssigning(true)
    const field = role === 'teacher' ? 'teacher_id' : 'curator_id'
    const { error } = await supabase.from('groups')
      .update({ [field]: member.id } as any)
      .eq('id', groupId)
    setAssigning(false)
    if (error) { alert(error.message); return }
    onReload()
  }

  async function removeFromGroup(groupId: string) {
    if (!confirm('Убрать из группы?')) return
    setRemoving(groupId)
    const field = role === 'teacher' ? 'teacher_id' : 'curator_id'
    const { error } = await supabase.from('groups')
      .update({ [field]: null } as any)
      .eq('id', groupId)
    setRemoving(null)
    if (error) { alert(error.message); return }
    onReload()
  }

  return (
    <div className={cn('rounded-2xl border p-4 bg-white transition-opacity', borderCls, !member.is_active && 'opacity-60')}>
      <div className="flex items-start gap-3">

        {/* Avatar */}
        <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center font-bold text-base shrink-0', bgCls)}>
          {member.avatar_url
            ? <img src={member.avatar_url} className="w-full h-full object-cover rounded-xl" alt="" />
            : member.full_name.charAt(0).toUpperCase()
          }
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{member.full_name}</span>
            {!member.is_active && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-md">неактивен</span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">{member.email}</div>

          {/* Current groups */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {member.groups.length === 0 ? (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">
                ⚠ Нет групп
              </span>
            ) : (
              member.groups.map(g => (
                <span key={g.id}
                  className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-lg', badgeCls)}>
                  <Users size={10} />{g.name}
                  <button
                    onClick={() => removeFromGroup(g.id)}
                    disabled={removing === g.id}
                    className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
                    title="Убрать из группы"
                  >
                    {removing === g.id ? <Loader2 size={9} className="animate-spin" /> : '×'}
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1.5">
          {member.is_active && available.length > 0 && (
            <AssignDropdown
              available={available}
              onAssign={assignGroup}
              loading={assigning}
            />
          )}
          <button
            onClick={toggleActive}
            disabled={toggling}
            title={member.is_active ? 'Деактивировать' : 'Восстановить'}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors disabled:opacity-50',
              member.is_active
                ? 'border-gray-200 text-gray-500 hover:border-red-200 hover:text-red-600 hover:bg-red-50'
                : 'border-green-200 text-green-600 hover:bg-green-50'
            )}
          >
            {toggling
              ? <Loader2 size={12} className="animate-spin" />
              : member.is_active ? <UserX size={12} /> : <UserCheck size={12} />
            }
            {member.is_active ? 'Деакт.' : 'Восстановить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Assign dropdown ──────────────────────────────────────────────────────────

function AssignDropdown({
  available, onAssign, loading,
}: {
  available: GroupOption[]
  onAssign:  (groupId: string) => void
  loading:   boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-xl text-gray-600 hover:border-primary-300 hover:text-primary-700 transition-colors bg-white disabled:opacity-50"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
        Группа
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden min-w-44">
            <div className="py-1">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                Назначить в группу
              </div>
              {available.map(g => (
                <button
                  key={g.id}
                  onClick={() => { onAssign(g.id); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors text-left"
                >
                  <BookOpen size={12} className="text-gray-400 shrink-0" />
                  <span className="truncate">{g.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
