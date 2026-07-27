import { useState, useEffect } from 'react'
import { Loader2, Users, AlertCircle, MessageCircle, RefreshCw, Copy, CheckCircle2, Copy as CopyIcon, Trash2, RotateCcw, Pencil, UserMinus, Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'
import {
  createStudentInvite,
  buildInviteUrl,
  buildInviteMessage,
  getMyStudentInvites,
  revokeStudentInvite,
  reissueStudentInvite,
  type MyStudentInvite,
} from '@/lib/studentEnrollment'
import { toast } from '@/store/toastStore'

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

interface CourseGroup {
  id: string
  name: string
}

interface InviteResult {
  inviteId: string
  token: string
  shortCode: string
  expiresAt: string
  fullName: string
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function CourseStudentsSection({ courseId }: { courseId: string }) {
  const [students, setStudents] = useState<StudentRow[]>([])
  const [telegramSet, setTelegramSet] = useState<Set<string>>(new Set())
  const [showTelegramColumn, setShowTelegramColumn] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite form state
  const [courseGroup, setCourseGroup] = useState<CourseGroup | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)

  // Active invites
  const [activeInvites, setActiveInvites] = useState<MyStudentInvite[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)

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

        // Load course group
        const groupResult: any = await supabase
          .from('groups')
          .select('id, name')
          .eq('course_id', courseId)
          .order('created_at')
          .limit(1)

        if (groupResult.error) throw new Error(groupResult.error.message)

        const groupData = groupResult.data?.[0]
        if (!cancelled.value) {
          setCourseGroup(groupData ? { id: groupData.id, name: groupData.name } : null)
        }

        // Load enrolled students
        let enrolledResult: any = await supabase
          .from('group_students')
          .select(
            'student_id, created_at, groups!inner(id, name, course_id), students!inner(id, profile_id, profiles!inner(id, full_name, email, phone))'
          )
          .eq('groups.course_id', courseId)

        // If error about created_at column, retry without it
        if (enrolledResult.error) {
          enrolledResult = await supabase
            .from('group_students')
            .select(
              'student_id, groups!inner(id, name, course_id), students!inner(id, profile_id, profiles!inner(id, full_name, email, phone))'
            )
            .eq('groups.course_id', courseId)

          if (enrolledResult.error) throw new Error(enrolledResult.error.message)
        }

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
          const enrolledAt = (row as any).created_at || null

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
  }, [courseId, tick])

  // Load active invites when courseGroup changes
  useEffect(() => {
    if (!courseGroup) {
      setActiveInvites([])
      return
    }

    let cancelled = false

    async function loadInvites() {
      try {
        setInvitesLoading(true)
        const invites = await getMyStudentInvites({ groupId: courseGroup!.id })
        // Filter only pending invites (not accepted)
        const pendingInvites = invites.filter(i => i.status === 'pending')
        if (!cancelled) {
          setActiveInvites(pendingInvites)
        }
      } catch (e: any) {
        if (!cancelled) {
          console.error('Ошибка при загрузке приглашений:', e)
        }
      } finally {
        if (!cancelled) {
          setInvitesLoading(false)
        }
      }
    }

    loadInvites()

    return () => {
      cancelled = true
    }
  }, [courseGroup])

  // Helper function to copy text
  async function copyToClipboard(text: string | undefined, successMsg: string, inviteId?: string) {
    if (!text) {
      toast.error('Нечего копировать')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      if (inviteId) {
        setCopiedInviteId(inviteId)
        setTimeout(() => setCopiedInviteId(null), 2000)
      }
      toast.success(successMsg)
    } catch (err) {
      toast.error('Не удалось скопировать')
    }
  }

  // Create or get course group, then create invite
  async function handleCreateInvite() {
    if (!fullName.trim()) {
      setInviteError('Укажите ФИО ученика')
      return
    }

    setCreatingInvite(true)
    setInviteError(null)

    try {
      let groupId = courseGroup?.id

      // If no group, create one
      if (!groupId) {
        const createGroupResult: any = await supabase
          .from('groups')
          .insert({ course_id: courseId, name: 'Группа курса' })
          .select('id, name')
          .single()

        if (createGroupResult.error) throw new Error(createGroupResult.error.message)

        const newGroup = createGroupResult.data
        setCourseGroup({ id: newGroup.id, name: newGroup.name })
        groupId = newGroup.id
      }

      // Create invite
      const result = await createStudentInvite({
        groupId: groupId!,
        fullName: fullName.trim(),
        email: email.trim() || null,
      })

      setInviteResult({
        ...result,
        fullName: fullName.trim(),
      })
      setFullName('')
      setEmail('')

      // Reload active invites
      const invites = await getMyStudentInvites({ groupId })
      const pendingInvites = invites.filter(i => i.status === 'pending')
      setActiveInvites(pendingInvites)
    } catch (e: any) {
      setInviteError(e.message || 'Ошибка при создании приглашения')
    } finally {
      setCreatingInvite(false)
    }
  }

  // Revoke invite
  async function handleRevokeInvite(inviteId: string) {
    if (!window.confirm('Отозвать приглашение?')) return

    try {
      await revokeStudentInvite(inviteId)
      // Reload active invites
      if (courseGroup) {
        const invites = await getMyStudentInvites({ groupId: courseGroup.id })
        const pendingInvites = invites.filter(i => i.status === 'pending')
        setActiveInvites(pendingInvites)
      }
      toast.success('Приглашение отозвано')
    } catch (e: any) {
      setInviteError(e.message || 'Ошибка при отзыве приглашения')
    }
  }

  // Reissue invite
  async function handleReissueInvite(inviteId: string) {
    try {
      const result = await reissueStudentInvite(inviteId)
      setInviteResult({
        ...result,
        fullName: 'Переизданное приглашение',
      })
      // Reload active invites
      if (courseGroup) {
        const invites = await getMyStudentInvites({ groupId: courseGroup.id })
        const pendingInvites = invites.filter(i => i.status === 'pending')
        setActiveInvites(pendingInvites)
      }
      toast.success('Приглашение переиздано')
    } catch (e: any) {
      setInviteError(e.message || 'Ошибка при переиздании приглашения')
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

      {/* Invite block */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900">Пригласить ученика в курс</h3>
          <p className="text-xs text-gray-500 mt-1">1. Создайте персональное приглашение → 2. Отправьте ссылку ученику → 3. После регистрации он появится в таблице выше</p>
        </div>

        {/* Invite form */}
        <div className="border border-gray-200 rounded-lg p-4 bg-white">
          {inviteResult ? (
            // Show invite result
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={20} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-900">Приглашение создано</p>
                  <p className="text-xs text-emerald-700">{inviteResult.fullName}</p>
                </div>
              </div>

              <div className="space-y-3 border-t border-gray-200 pt-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Персональная ссылка</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={buildInviteUrl(inviteResult.token)}
                      className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-600"
                    />
                    <button
                      onClick={() => copyToClipboard(buildInviteUrl(inviteResult.token), 'Ссылка скопирована', inviteResult.inviteId)}
                      className={cn('px-3 py-1 rounded text-xs font-medium transition-colors',
                        copiedInviteId === inviteResult.inviteId ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}
                    >
                      {copiedInviteId === inviteResult.inviteId ? 'Скопировано' : 'Скопировать'}
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => copyToClipboard(buildInviteMessage(inviteResult.token, inviteResult.shortCode), 'Приглашение скопировано', 'msg_' + inviteResult.inviteId)}
                  className="w-full text-xs px-3 py-2 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors font-medium flex items-center justify-center gap-2"
                >
                  <CopyIcon size={14} />
                  Скопировать приглашение
                </button>

                {inviteResult.expiresAt && (
                  <p className="text-xs text-gray-500">
                    Действует до {new Date(inviteResult.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                )}
              </div>

              <button
                onClick={() => {
                  setInviteResult(null)
                  setFullName('')
                  setEmail('')
                }}
                className="w-full text-xs px-3 py-2 rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors font-medium"
              >
                Создать ещё одно приглашение
              </button>
            </div>
          ) : (
            // Show invite form
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">ФИО ученика *</label>
                <input
                  type="text"
                  placeholder="Иван Петров"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Email (необязательно)</label>
                <input
                  type="email"
                  placeholder="ivan@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {inviteError && (
                <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{inviteError}</p>
                </div>
              )}

              <button
                onClick={handleCreateInvite}
                disabled={creatingInvite || !fullName.trim()}
                className={cn('w-full text-sm px-3 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2',
                  creatingInvite || !fullName.trim()
                    ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                    : 'bg-primary-500 text-white hover:bg-primary-600'
                )}
              >
                {creatingInvite ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Создаём…
                  </>
                ) : (
                  'Создать приглашение'
                )}
              </button>
            </div>
          )}
        </div>

        {/* Active invites */}
        {courseGroup && activeInvites.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-gray-600">Активные приглашения</h4>
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left font-medium text-gray-500">ФИО</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Статус</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {activeInvites.map((invite, idx) => (
                    <tr key={invite.inviteId} className={cn('border-b border-gray-100', idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                      <td className="px-3 py-2">
                        <span className="text-gray-900">{invite.fullName}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                          Ожидание
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => handleReissueInvite(invite.inviteId)}
                            className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                            title="Перевыпустить приглашение (получить свежую ссылку)"
                          >
                            <RotateCcw size={12} />
                          </button>
                          <button
                            onClick={() => handleRevokeInvite(invite.inviteId)}
                            className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-600 transition-colors"
                            title="Отозвать приглашение"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
