import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Copy, Loader2, RefreshCw, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/store/toastStore'
import { useGroups } from '@/hooks/useGroups'
import {
  buildInviteMessage,
  buildInviteUrl,
  getMyStudentInvites,
  getMyStudents,
  reissueStudentInvite,
  reissueStudentInviteBatch,
  revokeStudentInvite,
  type MyStudent,
  type MyStudentInvite,
} from '@/lib/studentEnrollment'
import { StudentEnrollmentModal, type EnrollmentGroupOption } from '@/components/students/StudentEnrollmentModal'

type TabKey = 'students' | 'invites'

const INVITE_STATUS_LABELS: Record<string, string> = {
  pending: 'Активно',
  revoked: 'Отозвано',
  accepted: 'Принято',
  expired: 'Истекло',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function StudentsPage() {
  const { groups } = useGroups()
  const [tab, setTab] = useState<TabKey>('students')
  const [modalOpen, setModalOpen] = useState(false)

  const [students, setStudents] = useState<MyStudent[]>([])
  const [studentsLoading, setStudentsLoading] = useState(true)
  const [studentsError, setStudentsError] = useState<string | null>(null)
  const [studentQuery, setStudentQuery] = useState('')
  const [studentGroupFilter, setStudentGroupFilter] = useState('')

  const [invites, setInvites] = useState<MyStudentInvite[]>([])
  const [invitesLoading, setInvitesLoading] = useState(true)
  const [invitesError, setInvitesError] = useState<string | null>(null)
  const [inviteGroupFilter, setInviteGroupFilter] = useState('')
  const [inviteStatusFilter, setInviteStatusFilter] = useState('')
  const [tokenMap, setTokenMap] = useState<Record<string, { token: string; shortCode: string; expiresAt: string }>>({})
  const [reissuingId, setReissuingId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [reissuingBatchId, setReissuingBatchId] = useState<string | null>(null)

  const groupOptions = useMemo<EnrollmentGroupOption[]>(
    () => groups.map(group => ({
      id: group.id,
      name: group.name,
      courseId: group.course_id ?? null,
      courseTitle: group.courses?.title ?? null,
      disabled: !group.course_id,
      disabledReason: group.course_id ? null : 'Сначала назначьте курс',
    })),
    [groups],
  )

  async function loadStudents() {
    setStudentsLoading(true)
    setStudentsError(null)
    try {
      setStudents(await getMyStudents())
    } catch (error) {
      setStudentsError(error instanceof Error ? error.message : 'Не удалось загрузить учеников')
    } finally {
      setStudentsLoading(false)
    }
  }

  async function loadInvites() {
    setInvitesLoading(true)
    setInvitesError(null)
    try {
      setInvites(await getMyStudentInvites({
        groupId: inviteGroupFilter || null,
        status: inviteStatusFilter || null,
      }))
    } catch (error) {
      setInvitesError(error instanceof Error ? error.message : 'Не удалось загрузить приглашения')
    } finally {
      setInvitesLoading(false)
    }
  }

  useEffect(() => {
    loadStudents()
  }, [])

  useEffect(() => {
    loadInvites()
  }, [inviteGroupFilter, inviteStatusFilter])

  const filteredStudents = useMemo(() => {
    const query = studentQuery.trim().toLowerCase()
    return students.filter(student => {
      const matchesQuery = !query || student.fullName.toLowerCase().includes(query)
      const matchesGroup = !studentGroupFilter || student.groups.some(group => group.id === studentGroupFilter)
      return matchesQuery && matchesGroup
    })
  }, [students, studentQuery, studentGroupFilter])

  const visibleInvites = invites
  const batchIds = Array.from(new Set(invites.map(invite => invite.batchId).filter(Boolean) as string[]))

  async function handleReissueInvite(invite: MyStudentInvite) {
    setReissuingId(invite.inviteId)
    try {
      const result = await reissueStudentInvite(invite.inviteId)
      setTokenMap(prev => ({
        ...prev,
        [invite.inviteId]: {
          token: result.token,
          shortCode: result.shortCode,
          expiresAt: result.expiresAt,
        },
      }))
      setInvites(prev => prev.map(item => item.inviteId === invite.inviteId ? { ...item, status: 'pending', expiresAt: result.expiresAt } : item))
      toast.success('Приглашение перевыпущено')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось перевыпустить приглашение')
    } finally {
      setReissuingId(null)
    }
  }

  async function handleReissueBatch(batchId: string) {
    setReissuingBatchId(batchId)
    try {
      const rows = await reissueStudentInviteBatch(batchId)
      const nextTokens: Record<string, { token: string; shortCode: string; expiresAt: string }> = {}
      for (const row of rows) {
        if (row.inviteId && row.token && row.shortCode && row.expiresAt) {
          nextTokens[row.inviteId] = { token: row.token, shortCode: row.shortCode, expiresAt: row.expiresAt }
        }
      }
      setTokenMap(prev => ({ ...prev, ...nextTokens }))
      setInvites(prev => prev.map(item => {
        const row = rows.find(entry => entry.inviteId === item.inviteId)
        return row?.expiresAt ? { ...item, status: 'pending', expiresAt: row.expiresAt } : item
      }))
      toast.success('Пакет приглашений перевыпущен')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось перевыпустить пакет')
    } finally {
      setReissuingBatchId(null)
    }
  }

  async function handleRevokeInvite(invite: MyStudentInvite) {
    setRevokingId(invite.inviteId)
    try {
      await revokeStudentInvite(invite.inviteId)
      setInvites(prev => prev.map(item => item.inviteId === invite.inviteId ? { ...item, status: 'revoked' } : item))
      setTokenMap(prev => {
        const next = { ...prev }
        delete next[invite.inviteId]
        return next
      })
      toast.success('Приглашение отозвано')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отозвать приглашение')
    } finally {
      setRevokingId(null)
    }
  }

  async function copyInvite(inviteId: string) {
    const tokenState = tokenMap[inviteId]
    if (!tokenState) return
    await navigator.clipboard.writeText(buildInviteUrl(tokenState.token))
    toast.success('Ссылка скопирована')
  }

  async function copyCode(inviteId: string) {
    const tokenState = tokenMap[inviteId]
    if (!tokenState) return
    await navigator.clipboard.writeText(tokenState.shortCode)
    toast.success('Код скопирован')
  }

  async function copyMessage(inviteId: string) {
    const tokenState = tokenMap[inviteId]
    if (!tokenState) return
    await navigator.clipboard.writeText(buildInviteMessage(tokenState.token, tokenState.shortCode))
    toast.success('Приглашение скопировано')
  }

  return (
    <div className="space-y-6">
      <div className="platform-surface rounded-lg p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100">
              <Users size={13} />
              Teacher CRM
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-graphite-950 sm:text-3xl">Ученики</h1>
            <p className="mt-1 text-slate-500">Ваши ученики и активные приглашения</p>
          </div>
          <Button onClick={() => setModalOpen(true)}>
            <UserPlus size={15} />Добавить учеников
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        <TabButton active={tab === 'students'} onClick={() => setTab('students')}>Ученики</TabButton>
        <TabButton active={tab === 'invites'} onClick={() => setTab('invites')}>Приглашения</TabButton>
      </div>

      {tab === 'students' && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <input
              value={studentQuery}
              onChange={event => setStudentQuery(event.target.value)}
              placeholder="Поиск по уже загруженным ученикам"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select
              value={studentGroupFilter}
              onChange={event => setStudentGroupFilter(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Все группы</option>
              {groupOptions.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </div>

          {studentsLoading ? (
            <LoadingState label="Загружаем учеников…" />
          ) : studentsError ? (
            <ErrorState label={studentsError} onRetry={loadStudents} />
          ) : filteredStudents.length === 0 ? (
            <EmptyState title="Пока нет учеников" body="После приглашения или зачисления ученики появятся в этом списке." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredStudents.map(student => (
                <Card key={`${student.studentId ?? student.profileId ?? student.fullName}`} className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-graphite-950">{student.fullName}</h3>
                      <p className="text-sm text-slate-500">{student.classGrade || 'Класс не указан'}</p>
                    </div>
                    {student.relationStatus && <Badge variant="info">{student.relationStatus}</Badge>}
                  </div>
                  <div className="space-y-2 text-sm text-slate-600">
                    <div><span className="font-medium text-graphite-900">Группы:</span> {student.groups.length ? student.groups.map(group => group.name).join(', ') : '—'}</div>
                    <div><span className="font-medium text-graphite-900">Курсы:</span> {student.courses.length ? student.courses.map(course => course.title).join(', ') : '—'}</div>
                    <div><span className="font-medium text-graphite-900">Дата добавления:</span> {formatDate(student.addedAt)}</div>
                  </div>
                  {student.studentId && (
                    <div>
                      <Link to={`/students/${student.studentId}`} className="text-sm font-medium text-primary-700 hover:text-primary-800">
                        Открыть профиль
                      </Link>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'invites' && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[220px_220px_minmax(0,1fr)]">
            <select
              value={inviteGroupFilter}
              onChange={event => setInviteGroupFilter(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Все группы</option>
              {groupOptions.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <select
              value={inviteStatusFilter}
              onChange={event => setInviteStatusFilter(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Все статусы</option>
              <option value="pending">Активно</option>
              <option value="revoked">Отозвано</option>
              <option value="accepted">Принято</option>
              <option value="expired">Истекло</option>
            </select>
            <div className="flex flex-wrap gap-2">
              {batchIds.map(batchId => (
                <Button
                  key={batchId}
                  type="button"
                  variant="secondary"
                  loading={reissuingBatchId === batchId}
                  onClick={() => handleReissueBatch(batchId)}
                >
                  <RefreshCw size={14} />Перевыпустить пакет {batchId.slice(0, 8)}
                </Button>
              ))}
            </div>
          </div>

          {invitesLoading ? (
            <LoadingState label="Загружаем приглашения…" />
          ) : invitesError ? (
            <ErrorState label={invitesError} onRetry={loadInvites} />
          ) : visibleInvites.length === 0 ? (
            <EmptyState title="Приглашений пока нет" body="После создания приглашения оно появится на этой вкладке." />
          ) : (
            <div className="space-y-3">
              {visibleInvites.map(invite => {
                const tokenState = tokenMap[invite.inviteId]
                return (
                  <Card key={invite.inviteId} className="space-y-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-graphite-950">{invite.fullName}</h3>
                          <Badge variant={invite.status === 'pending' ? 'success' : 'default'}>
                            {INVITE_STATUS_LABELS[invite.status] ?? invite.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          {[invite.classGrade, invite.groupName, invite.email, invite.phone].filter(Boolean).join(' · ') || 'Без дополнительных данных'}
                        </p>
                      </div>
                      <div className="text-sm text-slate-500">
                        <div>Создано: {formatDate(invite.createdAt)}</div>
                        <div>Действует до: {formatDate(tokenState?.expiresAt ?? invite.expiresAt)}</div>
                        {invite.batchId && <div>Batch: {invite.batchId}</div>}
                      </div>
                    </div>

                    {tokenState && (
                      <div className="rounded-lg bg-primary-50/60 px-3 py-3 text-sm text-slate-700">
                        <div className="font-medium text-graphite-950">{buildInviteUrl(tokenState.token)}</div>
                        <div className="mt-1">Короткий код: <span className="font-semibold">{tokenState.shortCode}</span></div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" loading={reissuingId === invite.inviteId} onClick={() => handleReissueInvite(invite)}>
                        <RefreshCw size={14} />Перевыпустить приглашение
                      </Button>
                      <Button type="button" variant="secondary" loading={revokingId === invite.inviteId} onClick={() => handleRevokeInvite(invite)}>
                        Отозвать приглашение
                      </Button>
                      {tokenState && (
                        <>
                          <Button type="button" variant="secondary" onClick={() => copyInvite(invite.inviteId)}>
                            <Copy size={14} />Скопировать ссылку
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => copyCode(invite.inviteId)}>
                            <Copy size={14} />Скопировать код
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => copyMessage(invite.inviteId)}>
                            <Copy size={14} />Скопировать приглашение
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      <StudentEnrollmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        groups={groupOptions}
        onCreated={() => {
          loadStudents()
          loadInvites()
        }}
      />
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-1 py-3 text-sm font-semibold transition-colors ${active ? 'border-primary-700 text-primary-700' : 'border-transparent text-slate-500 hover:text-graphite-950'}`}
    >
      {children}
    </button>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white p-8 text-slate-500">
      <Loader2 size={18} className="animate-spin" />
      {label}
    </div>
  )
}

function ErrorState({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 p-6 text-center">
      <AlertCircle size={20} className="mx-auto mb-2 text-red-500" />
      <p className="text-sm text-red-600">{label}</p>
      <Button type="button" variant="secondary" className="mt-3" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-10 text-center">
      <Users size={28} className="mx-auto mb-3 text-slate-300" />
      <h3 className="font-semibold text-graphite-950">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  )
}
