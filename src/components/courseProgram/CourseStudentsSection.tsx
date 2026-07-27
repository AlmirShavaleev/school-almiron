import { useState, useEffect } from 'react'
import { Loader2, Users, AlertCircle, MessageCircle, RefreshCw, Copy, CheckCircle2, Copy as CopyIcon, RotateCcw, Pencil, UserMinus, Check, X, Lock, Unlock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'
import { formatInviteCode } from '@/lib/studentInviteSession'
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

interface CourseJoinLink {
  token: string
  shortCode: string
  isActive: boolean
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

  // Course join link
  const [link, setLink] = useState<CourseJoinLink | null>(null)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

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

        // Load course join link
        try {
          const linkResult: any = await (supabase.rpc as any)('course_join_link_get', {
            p_course_id: courseId,
          })

          if (linkResult.error) throw new Error(linkResult.error.message)

          const linkData = linkResult.data?.[0]
          if (!cancelled.value && linkData) {
            setLink({
              token: linkData.token,
              shortCode: linkData.short_code,
              isActive: linkData.is_active,
            })
          }
        } catch (e: any) {
          console.error('Ошибка при загрузке ссылки приглашения:', e)
          // Don't fail the whole load if link fetch fails
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
  async function handleSetActive(active: boolean) {
    if (!link) return

    setLinkError(null)
    setRpcError(null)

    try {
      const result: any = await (supabase.rpc as any)('course_join_link_set_active', {
        p_course_id: courseId,
        p_active: active,
      })

      if (result.error) throw new Error(result.error.message)

      const linkData = result.data?.[0]
      if (linkData) {
        setLink({
          token: linkData.token,
          shortCode: linkData.short_code,
          isActive: linkData.is_active,
        })
        toast.success(active ? 'Набор открыт' : 'Набор закрыт')
      }
    } catch (e: any) {
      const errMsg = e.message || `Ошибка при ${active ? 'открытии' : 'закрытии'} набора`
      setRpcError(errMsg)
      console.error('Error setting link active:', e)
    }
  }

  // Rotate join link
  async function handleRotate() {
    if (!link) return

    if (!window.confirm('Старая ссылка и код перестанут работать. Уже зачисленных это не касается. Продолжить?')) {
      return
    }

    setLinkError(null)
    setRpcError(null)

    try {
      const result: any = await (supabase.rpc as any)('course_join_link_rotate', {
        p_course_id: courseId,
      })

      if (result.error) throw new Error(result.error.message)

      const linkData = result.data?.[0]
      if (linkData) {
        setLink({
          token: linkData.token,
          shortCode: linkData.short_code,
          isActive: linkData.is_active,
        })
        toast.success('Ссылка перевыпущена')
      }
    } catch (e: any) {
      const errMsg = e.message || 'Ошибка при перевыпуске ссылки'
      setRpcError(errMsg)
      console.error('Error rotating link:', e)
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

      {/* Course Join Link Block */}
      {link && (
        <div className="border border-gray-200 rounded-lg p-6 bg-white space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900">Приглашение в курс</h3>
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
                type="text"
                readOnly
                value={`${window.location.origin}/join/${link.token}`}
                className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-600 font-mono truncate"
              />
              <button
                onClick={() => copyToClipboard(`${window.location.origin}/join/${link.token}`, 'Ссылка скопирована', 'link')}
                className={cn('px-3 py-2 rounded text-xs font-medium transition-colors shrink-0',
                  copiedField === 'link'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                {copiedField === 'link' ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
          </div>

          {/* Code row */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Код курса</p>
            <div className="flex gap-2 items-center">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 font-mono text-2xl tracking-widest text-gray-900 font-bold">
                {formatInviteCode(link.shortCode)}
              </div>
              <button
                onClick={() => copyToClipboard(link.shortCode, 'Код скопирован', 'code')}
                className={cn('px-3 py-2 rounded text-xs font-medium transition-colors shrink-0',
                  copiedField === 'code'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                {copiedField === 'code' ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
          </div>

          {/* Copy invitation message button */}
          <button
            onClick={() => {
              const origin = window.location.origin
              const url = `${origin}/join/${link.token}`
              const formattedCode = formatInviteCode(link.shortCode)
              const message = `Привет! Присоединяйся к курсу в School Almiron:\n${url}\n\nИли введи код на ${origin}/join: ${formattedCode}`
              copyToClipboard(message, 'Приглашение скопировано', 'invitation')
            }}
            className={cn('w-full text-xs px-3 py-2 rounded font-medium transition-colors flex items-center justify-center gap-2',
              copiedField === 'invitation'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
          >
            <CopyIcon size={14} />
            {copiedField === 'invitation' ? 'Приглашение скопировано' : 'Скопировать приглашение'}
          </button>

          {/* Caption */}
          <p className="text-xs text-gray-500">
            Ссылка постоянная и общая для всех учеников. Ученик регистрируется сам и сразу попадает в курс.
          </p>

          {/* Control buttons */}
          <div className="flex gap-2 border-t border-gray-100 pt-4">
            <button
              onClick={() => handleSetActive(!link.isActive)}
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
              onClick={handleRotate}
              className="flex-1 text-xs px-3 py-2 rounded font-medium transition-colors flex items-center justify-center gap-2 bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              <RotateCcw size={14} />
              Перевыпустить
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
