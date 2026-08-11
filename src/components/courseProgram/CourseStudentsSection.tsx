import { useState, useEffect } from 'react'
import { Loader2, Users, AlertCircle, MessageCircle, RefreshCw, Copy, CheckCircle2, Copy as CopyIcon, RotateCcw, Pencil, UserMinus, UserPlus, Check, X, Lock, Unlock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'
import { formatInviteCode } from '@/lib/studentInviteSession'
import { toast } from '@/store/toastStore'
import { ROLE_LABELS } from '@/store/staffModeStore'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'

interface StudentInfo {
  studentId: string
  profileId: string
  name: string
  email: string
  phone: string | null
  groupName: string
  enrolledAt: string | null
}

interface StudentRow {
  studentId: string
  profileId: string
  name: string
  email: string
  phone: string | null
  groupNames: Set<string>
  enrolledAt: string | null
}

interface CourseJoinLink {
  token: string
  shortCode: string
  isActive: boolean
}

interface Curator {
  id: string
  profileId: string
  fullName: string
  email: string
}

interface CuratorCandidate {
  profileId: string
  fullName: string
  email: string
  role: string
}

/** Минимум символов, с которого RPC вообще что-то ищет (см. миграцию). */
const CANDIDATE_MIN_QUERY = 2

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

interface JoinLinkCardProps {
  link: CourseJoinLink | null
  role: 'student' | 'curator'
  courseTitle?: string
  copiedField: string | null
  onCopy: (text: string | undefined, successMsg: string, fieldId?: string) => Promise<void>
  onSetActive: (active: boolean, role: 'student' | 'curator') => Promise<void>
  onRotate: (role: 'student' | 'curator') => Promise<void>
}

function JoinLinkCard({
  link,
  role,
  courseTitle,
  copiedField,
  onCopy,
  onSetActive,
  onRotate,
}: JoinLinkCardProps) {
  if (!link) return null

  const roleLabel = role === 'student' ? 'Для учеников' : 'Для кураторов'
  const caption = role === 'curator'
    ? 'Куратор проверяет ДЗ и видит результаты учеников этого курса. Подойдёт любой аккаунт, в том числе ученический: роль профиля не меняется. Количество кураторов не ограничено.'
    : 'Ссылка постоянная и общая для всех учеников. Ученик регистрируется сам и сразу попадает в курс.'
  const invitationButtonLabel = role === 'curator' ? 'Скопировать приглашение куратора' : 'Скопировать приглашение'
  const fieldIdPrefix = role === 'curator' ? 'curator_' : ''

  return (
    <div data-testid="join-link-card" data-role={role} className="border border-gray-200 rounded-lg p-6 bg-white space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-900">{roleLabel}</h3>
        <span className={cn(
          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
          link.isActive
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-gray-100 text-gray-700'
        )}>
          {link.isActive ? 'Набор открыт' : 'Набор закрыт'}
        </span>
      </div>

      {/* Link row */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Ссылка</p>
        <div className="flex gap-2">
          <input
            data-testid="join-link-url"
            type="text"
            readOnly
            value={`${window.location.origin}/join/${link.token}`}
            className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-600 font-mono truncate"
          />
          <button
            data-testid="join-copy-link"
            onClick={() => onCopy(`${window.location.origin}/join/${link.token}`, 'Ссылка скопирована', `${fieldIdPrefix}link`)}
            className={cn('px-3 py-2 rounded text-xs font-medium transition-colors shrink-0',
              copiedField === `${fieldIdPrefix}link`
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
          >
            {copiedField === `${fieldIdPrefix}link` ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
      </div>

      {/* Code row */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Код курса</p>
        <div className="flex gap-2 items-center">
          <div data-testid="join-link-code" className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 font-mono text-2xl tracking-widest text-gray-900 font-bold">
            {formatInviteCode(link.shortCode)}
          </div>
          <button
            data-testid="join-copy-code"
            onClick={() => onCopy(link.shortCode, 'Код скопирован', `${fieldIdPrefix}code`)}
            className={cn('px-3 py-2 rounded text-xs font-medium transition-colors shrink-0',
              copiedField === `${fieldIdPrefix}code`
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
          >
            {copiedField === `${fieldIdPrefix}code` ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
      </div>

      {/* Copy invitation message button */}
      <button
        onClick={() => {
          const origin = window.location.origin
          const url = `${origin}/join/${link.token}`
          const formattedCode = formatInviteCode(link.shortCode)
          let message: string
          if (role === 'curator') {
            // «зарегистрируйся» здесь стояло от отменённой модели, где
            // кураторство было ролью и требовало отдельного аккаунта. Теперь
            // это назначение поверх любого аккаунта — у ученика он уже есть.
            message = `Привет! Ты куратор курса «${courseTitle}» в School Almiron. Перейди по ссылке — войди в свой аккаунт или заведи новый:\n${url}\n\nИли введи код на ${origin}/join: ${formattedCode}`
          } else {
            message = `Привет! Присоединяйся к курсу в School Almiron:\n${url}\n\nИли введи код на ${origin}/join: ${formattedCode}`
          }
          onCopy(message, 'Приглашение скопировано', `${fieldIdPrefix}invitation`)
        }}
        className={cn('w-full text-xs px-3 py-2 rounded font-medium transition-colors flex items-center justify-center gap-2',
          copiedField === `${fieldIdPrefix}invitation`
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        )}
      >
        <CopyIcon size={14} />
        {copiedField === `${fieldIdPrefix}invitation` ? `${invitationButtonLabel} скопировано` : invitationButtonLabel}
      </button>

      {/* Caption */}
      <p className="text-xs text-gray-500">
        {caption}
      </p>

      {/* Control buttons */}
      <div className="flex gap-2 border-t border-gray-100 pt-4">
        <button
          onClick={() => onSetActive(!link.isActive, role)}
          className={cn('flex-1 text-xs px-3 py-2 rounded font-medium transition-colors flex items-center justify-center gap-2',
            link.isActive
              ? 'bg-red-50 text-red-700 hover:bg-red-100'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          )}
        >
          {link.isActive ? (
            <>
              <Lock size={14} />
              Закрыть набор
            </>
          ) : (
            <>
              <Unlock size={14} />
              Открыть набор
            </>
          )}
        </button>
        <button
          onClick={() => onRotate(role)}
          className="flex-1 text-xs px-3 py-2 rounded font-medium transition-colors flex items-center justify-center gap-2 bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          <RotateCcw size={14} />
          Перевыпустить
        </button>
      </div>
    </div>
  )
}

export function CourseStudentsSection({ courseId }: { courseId: string }) {
  // Куратор набором курса не занимается: ни ученических ссылок, ни
  // кураторской, ни назначения, ни удаления учеников (решение владельца
  // 05.08). Список учеников он видит — это его работа.
  const { readOnly } = useMyTeachingScope()
  const [students, setStudents] = useState<StudentRow[]>([])
  const [telegramSet, setTelegramSet] = useState<Set<string>>(new Set())
  const [showTelegramColumn, setShowTelegramColumn] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Course join link
  const [studentLink, setStudentLink] = useState<CourseJoinLink | null>(null)
  const [curatorLink, setCuratorLink] = useState<CourseJoinLink | null>(null)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Curators
  const [curators, setCurators] = useState<Curator[]>([])
  const [loadingCurators, setLoadingCurators] = useState(false)

  // Назначение куратора: поиск по всей школе через definer-RPC. Куратором
  // можно сделать ЛЮБОЙ профиль, в том числе ученика чужого курса, — обычные
  // profiles-политики такого человека вызывающему не покажут.
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignQuery, setAssignQuery] = useState('')
  const [assignResults, setAssignResults] = useState<CuratorCandidate[]>([])
  const [assignSearching, setAssignSearching] = useState(false)
  const [assignBusyId, setAssignBusyId] = useState<string | null>(null)

  // Refresh trigger
  const [tick, setTick] = useState(0)

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [rpcError, setRpcError] = useState<string | null>(null)

  useEffect(() => {
    // Флажок живёт ВНУТРИ эффекта: в StrictMode эффект гоняется дважды,
    // и внешний объект остался бы «отменённым» навсегда (вечный спиннер).
    const cancelled = { value: false }
    const abortController = new AbortController()

    async function loadData() {
      try {
        setLoading(true)
        setError(null)

        // Load course join link (students).
        // Куратору обе ссылки теперь отвечают 42501 — не спрашиваем вовсе,
        // иначе на каждое открытие страницы летели бы два заведомо отказных
        // запроса и две записи в консоль.
        if (!readOnly) {
        try {
          const linkResult: any = await (supabase.rpc as any)('course_join_link_get', {
            p_course_id: courseId,
            p_role: 'student',
          })

          if (linkResult.error) throw new Error(linkResult.error.message)

          const linkData = linkResult.data?.[0]
          if (!cancelled.value && linkData) {
            setStudentLink({
              token: linkData.token,
              shortCode: linkData.short_code,
              isActive: linkData.is_active,
            })
          }
        } catch (e: any) {
          console.error('Ошибка при загрузке ссылки приглашения для учеников:', e)
          // Don't fail the whole load if link fetch fails
        }

        // Load course join link (curators)
        try {
          const linkResult: any = await (supabase.rpc as any)('course_join_link_get', {
            p_course_id: courseId,
            p_role: 'curator',
          })

          if (linkResult.error) throw new Error(linkResult.error.message)

          const linkData = linkResult.data?.[0]
          if (!cancelled.value && linkData) {
            setCuratorLink({
              token: linkData.token,
              shortCode: linkData.short_code,
              isActive: linkData.is_active,
            })
          }
        } catch (e: any) {
          console.error('Ошибка при загрузке ссылки приглашения для кураторов:', e)
          // Don't fail the whole load if link fetch fails
        }
        }

        // Load curators
        try {
          const curatorResult: any = await (supabase as any)
            .from('course_curators')
            .select('id, profile_id, profiles(full_name, email)')
            .eq('course_id', courseId)

          if (!cancelled.value && curatorResult.data) {
            const curatorsList = (curatorResult.data || []).map((row: any) => ({
              id: row.id,
              profileId: row.profile_id,
              fullName: row.profiles?.full_name || 'Куратор',
              email: row.profiles?.email || '',
            }))
            setCurators(curatorsList)
          }
        } catch (e: any) {
          console.error('Ошибка при загрузке списка кураторов:', e)
          // Don't fail the whole load if curators fetch fails
        }

        // Load enrolled students
        const enrolledResult: any = await supabase
          .from('group_students')
          .select(
            'student_id, joined_at, groups!inner(id, name, course_id), students!inner(id, profile_id, profiles!inner(id, full_name, email, phone))'
          )
          .eq('groups.course_id', courseId)

        if (enrolledResult.error) throw new Error(enrolledResult.error.message)

        const enrolledData = (enrolledResult.data || []) as any[]

        // Deduplicate by studentId, collect groups
        const studentMap = new Map<string, StudentRow>()
        const profileIds: string[] = []

        for (const row of enrolledData) {
          const studentId = row.student_id
          const profileId = row.students?.profile_id
          const name = row.students?.profiles?.full_name || 'Ученик'
          const email = row.students?.profiles?.email || ''
          const phone = row.students?.profiles?.phone || null
          const groupName = row.groups?.name || ''
          const enrolledAt = (row as any).joined_at || null

          if (!studentMap.has(studentId)) {
            studentMap.set(studentId, {
              studentId,
              profileId,
              name,
              email,
              phone,
              groupNames: new Set(),
              enrolledAt,
            })
            if (profileId) profileIds.push(profileId)
          }

          const student = studentMap.get(studentId)!
          if (groupName) student.groupNames.add(groupName)
        }

        // Load telegram connections
        let hasTelegramError = false
        if (profileIds.length > 0) {
          const telegramResult = await supabase
            .from('telegram_connections')
            .select('profile_id, is_enabled')
            .in('profile_id', profileIds)

          if (telegramResult.error) {
            hasTelegramError = true
          } else {
            const telegramData = (telegramResult.data || []) as any[]
            const connected = new Set<string>()
            for (const row of telegramData) {
              if (row.is_enabled) {
                connected.add(row.profile_id)
              }
            }
            setTelegramSet(connected)

            // Show column only if we have data or no error
            setShowTelegramColumn(connected.size > 0)
          }
        } else {
          setShowTelegramColumn(false)
        }

        // If telegram query failed, hide column
        if (hasTelegramError && profileIds.length > 0) {
          setShowTelegramColumn(false)
        }

        // Sort by name
        const sortedStudents = Array.from(studentMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name, 'ru')
        )

        if (!cancelled.value) {
          setStudents(sortedStudents)
        }
      } catch (e: any) {
        if (!cancelled.value) {
          setError(e.message || 'Не удалось загрузить список учеников')
        }
      } finally {
        if (!cancelled.value) {
          setLoading(false)
        }
      }
    }

    loadData()

    return () => {
      cancelled.value = true
      abortController.abort()
    }
    // readOnly в зависимостях обязателен: на первом кадре он ещё «true»
    // (кураторство не проверено), и без перезапуска преподаватель остался бы
    // без ссылок приглашения навсегда.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, tick, readOnly])


  // Helper function to copy text
  async function copyToClipboard(text: string | undefined, successMsg: string, fieldId?: string) {
    if (!text) {
      toast.error('Нечего копировать')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      if (fieldId) {
        setCopiedField(fieldId)
        setTimeout(() => setCopiedField(null), 2000)
      }
      toast.success(successMsg)
    } catch (err) {
      toast.error('Не удалось скопировать')
    }
  }

  // Set active status for join link
  async function handleSetActive(active: boolean, role: 'student' | 'curator') {
    const link = role === 'student' ? studentLink : curatorLink
    if (!link) return

    setLinkError(null)
    setRpcError(null)

    try {
      const result: any = await (supabase.rpc as any)('course_join_link_set_active', {
        p_course_id: courseId,
        p_active: active,
        p_role: role,
      })

      if (result.error) throw new Error(result.error.message)

      const linkData = result.data?.[0]
      if (linkData) {
        const updatedLink = {
          token: linkData.token,
          shortCode: linkData.short_code,
          isActive: linkData.is_active,
        }
        if (role === 'student') {
          setStudentLink(updatedLink)
        } else {
          setCuratorLink(updatedLink)
        }
        toast.success(active ? 'Набор открыт' : 'Набор закрыт')
      }
    } catch (e: any) {
      const errMsg = e.message || `Ошибка при ${active ? 'открытии' : 'закрытии'} набора`
      setRpcError(errMsg)
      console.error('Error setting link active:', e)
    }
  }

  // Rotate join link
  async function handleRotate(role: 'student' | 'curator') {
    const link = role === 'student' ? studentLink : curatorLink
    if (!link) return

    if (!window.confirm('Старая ссылка и код перестанут работать. Уже зачисленных это не касается. Продолжить?')) {
      return
    }

    setLinkError(null)
    setRpcError(null)

    try {
      const result: any = await (supabase.rpc as any)('course_join_link_rotate', {
        p_course_id: courseId,
        p_role: role,
      })

      if (result.error) throw new Error(result.error.message)

      const linkData = result.data?.[0]
      if (linkData) {
        const updatedLink = {
          token: linkData.token,
          shortCode: linkData.short_code,
          isActive: linkData.is_active,
        }
        if (role === 'student') {
          setStudentLink(updatedLink)
        } else {
          setCuratorLink(updatedLink)
        }
        toast.success('Ссылка перевыпущена')
      }
    } catch (e: any) {
      const errMsg = e.message || 'Ошибка при перевыпуске ссылки'
      setRpcError(errMsg)
      console.error('Error rotating link:', e)
    }
  }

  // Поиск кандидатов. Запрос уезжает не на каждую букву: RPC ходит по всей
  // таблице профилей, и дёргать её посимвольно — лишняя нагрузка на базу
  // ради строки, которую человек ещё дописывает.
  useEffect(() => {
    const needle = assignQuery.trim()
    if (!assignOpen || needle.length < CANDIDATE_MIN_QUERY) {
      setAssignResults([])
      setAssignSearching(false)
      return
    }

    let cancelled = false
    setAssignSearching(true)

    const timer = setTimeout(async () => {
      const { data, error } = await (supabase.rpc as any)('course_curator_candidates', {
        p_course_id: courseId,
        p_query:     needle,
      })
      if (cancelled) return

      if (error) {
        setRpcError(error.message)
        setAssignResults([])
      } else {
        setAssignResults(((data || []) as any[]).map(row => ({
          profileId: row.profile_id,
          fullName:  row.full_name || '—',
          email:     row.email || '',
          role:      row.role || '',
        })))
      }
      setAssignSearching(false)
    }, 300)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [assignOpen, assignQuery, courseId])

  // Перечитать список кураторов курса. Нужен и после назначения, и после
  // снятия: держать локальную копию в согласии с базой руками — способ
  // однажды показать курс с куратором, которого там уже нет.
  async function refreshCurators() {
    const { data } = await (supabase as any)
      .from('course_curators')
      .select('id, profile_id, profiles(full_name, email)')
      .eq('course_id', courseId)

    setCurators((data || []).map((row: any) => ({
      id:        row.id,
      profileId: row.profile_id,
      fullName:  row.profiles?.full_name || 'Куратор',
      email:     row.profiles?.email || '',
    })))
  }

  // Remove curator
  async function handleRemoveCurator(profileId: string, curatorName: string) {
    if (!window.confirm(`Убрать ${curatorName} из кураторов курса?`)) {
      return
    }

    setRpcError(null)

    try {
      // Через RPC, а не голым delete: у отказа должен быть человеческий
      // текст. Голая правка под RLS удаляет ноль строк и молчит — «ничего не
      // произошло» неотличимо от «получилось» (уроки §47/§54).
      const { error } = await (supabase.rpc as any)('course_curator_remove', {
        p_course_id:  courseId,
        p_profile_id: profileId,
      })
      if (error) throw new Error(error.message)

      await refreshCurators()
      toast.success('Куратор снят с курса')
    } catch (e: any) {
      setRpcError(e.message || 'Ошибка при снятии куратора')
    }
  }

  // Assign curator
  async function handleAssignCurator(candidate: CuratorCandidate) {
    setRpcError(null)
    setAssignBusyId(candidate.profileId)

    try {
      const { error } = await (supabase.rpc as any)('course_curator_assign', {
        p_course_id:  courseId,
        p_profile_id: candidate.profileId,
      })
      if (error) throw new Error(error.message)

      await refreshCurators()
      setAssignResults(prev => prev.filter(c => c.profileId !== candidate.profileId))
      setAssignQuery('')
      toast.success(`${candidate.fullName} — куратор курса`)
    } catch (e: any) {
      setRpcError(e.message || 'Ошибка при назначении куратора')
    } finally {
      setAssignBusyId(null)
    }
  }

  // Handle rename
  async function handleStartEdit(studentId: string, currentName: string) {
    setEditingId(studentId)
    setEditName(currentName)
    setEditError(null)
  }

  async function handleSaveRename(studentId: string) {
    if (!editName.trim()) {
      setEditError('Имя не может быть пустым')
      return
    }

    setEditLoading(true)
    setEditError(null)
    setRpcError(null)

    try {
      const { error } = await (supabase.rpc as any)('course_member_rename', {
        p_student_id: studentId,
        p_full_name: editName.trim(),
      })

      if (error) {
        throw new Error(error.message)
      }

      // Update locally
      setStudents(students.map(s =>
        s.studentId === studentId ? { ...s, name: editName.trim() } : s
      ))
      setEditingId(null)
      setEditName('')
      toast.success('Имя ученика изменено')
    } catch (e: any) {
      setRpcError(e.message || 'Ошибка при переименовании')
    } finally {
      setEditLoading(false)
    }
  }

  function handleCancelEdit() {
    setEditingId(null)
    setEditName('')
    setEditError(null)
  }

  // Handle remove
  async function handleRemoveStudent(studentId: string, studentName: string) {
    if (!window.confirm(`Отчислить ${studentName} с курса? Аккаунт и его работы сохранятся, но доступ к курсу пропадёт.`)) {
      return
    }

    setRpcError(null)

    try {
      const { error } = await (supabase.rpc as any)('course_member_remove', {
        p_course_id: courseId,
        p_student_id: studentId,
      })

      if (error) {
        throw new Error(error.message)
      }

      // Remove locally
      setStudents(students.filter(s => s.studentId !== studentId))
      toast.success('Ученик отчислен с курса')
    } catch (e: any) {
      setRpcError(e.message || 'Ошибка при отчислении')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" />
        Загрузка…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
        <div className="flex gap-2">
          <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* RPC Error banner */}
      {rpcError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex gap-2">
            <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{rpcError}</p>
          </div>
        </div>
      )}

      {/* Students section */}
      {students.length > 0 ? (
        <div className="space-y-4">
          {/* Header with badge and refresh button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-gray-900">Ученики курса</h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 text-xs font-medium">
                {students.length}
              </span>
            </div>
            <button
              onClick={() => setTick(t => t + 1)}
              title="Обновить список"
              className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-600"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {/* Table */}
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Ученик</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Группа</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Телефон</th>
                    {showTelegramColumn && (
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Telegram</th>
                    )}
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Зачислен</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, idx) => (
                    <tr
                      key={student.studentId}
                      data-testid="course-student-row"
                      data-student-id={student.studentId}
                      className={cn('border-b border-gray-100', idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')}
                    >
                      <td className="px-4 py-2">
                        <div className="flex flex-col gap-0.5">
                          {editingId === student.studentId ? (
                            <div className="flex gap-1 items-center">
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleSaveRename(student.studentId)
                                  } else if (e.key === 'Escape') {
                                    handleCancelEdit()
                                  }
                                }}
                                autoFocus
                                className="flex-1 text-sm border border-primary-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                              <button
                                onClick={() => handleSaveRename(student.studentId)}
                                disabled={editLoading}
                                className="p-1 rounded hover:bg-primary-100 text-primary-600"
                                title="Сохранить"
                              >
                                {editLoading ? (
                                  <Loader2 size={16} className="animate-spin" />
                                ) : (
                                  <Check size={16} />
                                )}
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                disabled={editLoading}
                                className="p-1 rounded hover:bg-gray-200 text-gray-600"
                                title="Отмена"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-sm font-medium text-gray-900">{student.name}</span>
                          )}
                          <span className="text-xs text-gray-400">{student.email}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-sm text-gray-900">
                          {Array.from(student.groupNames).join(', ') || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-sm text-gray-600">{student.phone || '—'}</span>
                      </td>
                      {showTelegramColumn && (
                        <td className="px-4 py-2">
                          {telegramSet.has(student.profileId) ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium">
                              <MessageCircle size={12} />
                              привязан
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-medium">
                              —
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2">
                        <span className="text-sm text-gray-600">{formatDate(student.enrolledAt)}</span>
                      </td>
                      <td className="px-4 py-2">
                        {/* Куратор состав не меняет: обе RPC ему теперь
                            отвечают 42501, и кнопка была бы обещанием
                            гарантированной ошибки. */}
                        {!readOnly && (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleStartEdit(student.studentId, student.name)}
                              disabled={editingId !== null}
                              className="p-1.5 rounded text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition-colors disabled:opacity-50"
                              title="Переименовать"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleRemoveStudent(student.studentId, student.name)}
                              disabled={editingId !== null}
                              className="p-1.5 rounded text-red-600 hover:bg-red-100 hover:text-red-800 transition-colors disabled:opacity-50"
                              title="Отчислить с курса"
                            >
                              <UserMinus size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center">
          <Users size={32} className="mx-auto mb-3 opacity-30 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">В курсе пока нет учеников</p>
          <p className="mt-1 text-sm text-gray-400">Приглашение принимается ниже, ученики появятся в этом списке</p>
        </div>
      )}

      {/* Course Join Link Block — набор на курс ведёт тот, кто курс ведёт. */}
      {!readOnly && (studentLink || curatorLink) && (
        <div className="space-y-6">
          {/* Student link card */}
          <JoinLinkCard
            link={studentLink}
            role="student"
            copiedField={copiedField}
            onCopy={copyToClipboard}
            onSetActive={handleSetActive}
            onRotate={handleRotate}
          />

          {/* Curator link card */}
          <JoinLinkCard
            link={curatorLink}
            role="curator"
            courseTitle={students.length > 0 || curators.length > 0 ? (students[0] as any)?.courseTitle : 'курс'}
            copiedField={copiedField}
            onCopy={copyToClipboard}
            onSetActive={handleSetActive}
            onRotate={handleRotate}
          />

          {/* Curators list */}
          <div className="border border-gray-200 rounded-lg p-6 bg-white">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-medium text-gray-900">
                Кураторы курса ({curators.length})
              </h3>
              <button
                data-testid="assign-curator-toggle"
                onClick={() => { setAssignOpen(!assignOpen); setAssignQuery('') }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0"
              >
                <UserPlus size={14} />
                {assignOpen ? 'Отмена' : 'Назначить куратора'}
              </button>
            </div>

            {assignOpen && (
              <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
                <input
                  data-testid="assign-curator-search"
                  autoFocus
                  value={assignQuery}
                  onChange={e => setAssignQuery(e.target.value)}
                  placeholder="Имя или email — куратором можно назначить любого"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {/* Куратором может стать и ученик — это не ошибка, а замысел:
                    роль профиля кураторство не меняет. */}
                <p className="mt-2 text-xs text-gray-500">
                  Ученик остаётся учеником в своих курсах. Куратор проверяет ДЗ и
                  видит программу, но не меняет её.
                </p>

                <div className="mt-3 space-y-1.5">
                  {assignQuery.trim().length < CANDIDATE_MIN_QUERY ? (
                    <p className="text-sm text-gray-500">Введите хотя бы два символа</p>
                  ) : assignSearching ? (
                    <p className="text-sm text-gray-500 flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" /> Ищем…
                    </p>
                  ) : assignResults.length === 0 ? (
                    <p className="text-sm text-gray-500">Никого не нашли</p>
                  ) : (
                    assignResults.map(candidate => (
                      <button
                        key={candidate.profileId}
                        onClick={() => handleAssignCurator(candidate)}
                        disabled={assignBusyId != null}
                        className="w-full flex items-center justify-between gap-2 p-2.5 rounded-lg bg-white border border-gray-200 hover:border-primary-400 hover:bg-primary-50 transition-colors text-left disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900 truncate">
                            {candidate.fullName}
                          </span>
                          <span className="block text-xs text-gray-500 truncate">
                            {candidate.email} · {ROLE_LABELS[candidate.role] ?? candidate.role}
                          </span>
                        </span>
                        {assignBusyId === candidate.profileId
                          ? <Loader2 size={14} className="animate-spin shrink-0 text-primary-600" />
                          : <UserPlus size={14} className="shrink-0 text-primary-600" />}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {curators.length > 0 ? (
              <div className="space-y-2">
                {curators.map(curator => (
                  <div
                    key={curator.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {curator.fullName} ({curator.email})
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveCurator(curator.profileId, curator.fullName)}
                      className="ml-2 p-1.5 rounded text-red-600 hover:bg-red-100 hover:text-red-800 transition-colors shrink-0"
                      title="Убрать куратора"
                    >
                      <UserMinus size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Кураторов пока нет</p>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
