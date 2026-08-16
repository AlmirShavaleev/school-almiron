import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Copy, Loader2, RefreshCw, UserPlus, Users, UserCheck, XCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/store/toastStore'
import { useAuthStore } from '@/store/authStore'
import { useGroups } from '@/hooks/useGroups'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'
import { isMyInvite, isMyJoinRequest, isMyStudent } from '@/lib/studentsScope'
import { enrollableGroups } from '@/lib/enrollmentTargets'
import { fetchLastSubmissions, fetchTelegramFlags, type LastSubmissions, type TelegramFlags } from '@/lib/studentListData'
import { StudentsTable } from '@/components/students/StudentsTable'
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
import { buildTeacherJoinUrl, createOrGetTeacherJoinLink, rotateTeacherJoinLink } from '@/lib/teacherJoinLink'
import { getMyJoinRequests, rejectTeacherJoinRequest, restoreTeacherJoinRequest, type MyJoinRequest } from '@/lib/teacherJoinRequests'
import { StudentEnrollmentModal, type EnrollmentGroupOption } from '@/components/students/StudentEnrollmentModal'
import { InviteStudentWizard, type WizardGroupOption } from '@/components/students/InviteStudentWizard'
import { DistributeJoinRequestWizard, type DistributeGroupOption } from '@/components/students/DistributeJoinRequestWizard'

type TabKey = 'students' | 'invites' | 'newStudents'

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
  const profile = useAuthStore(s => s.profile)
  const { groups } = useGroups()
  // `get_my_students` — definer-RPC, и её первое условие — `is_admin_or_owner()`:
  // администратору она отдаёт ВСЕХ учеников школы. Трогать общую функцию ради
  // режима представления нельзя (ей пользуются и настоящие учителя), поэтому
  // в режиме учителя сужаем на клиенте по своим курсам и группам.
  const scope = useMyTeachingScope()
  const [tab, setTab] = useState<TabKey>('students')
  const [modalOpen, setModalOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)

  const [joinRequests, setJoinRequests] = useState<MyJoinRequest[]>([])
  const [joinRequestsLoading, setJoinRequestsLoading] = useState(true)
  const [joinRequestsError, setJoinRequestsError] = useState<string | null>(null)
  const [newStudentsFilter, setNewStudentsFilter] = useState<'pending' | 'rejected'>('pending')
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null)

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

  // Шаблоны из всех списков выбора курса убраны: зачислять в каркас нельзя.
  // Правило общее — `enrollableGroups`, чтобы четыре списка не разъехались.
  const groupOptions = useMemo<EnrollmentGroupOption[]>(
    () => enrollableGroups(groups).map(group => ({
      id: group.id,
      name: group.name,
      courseId: group.course_id ?? null,
      courseTitle: group.courses?.title ?? null,
      disabled: !group.course_id,
      disabledReason: group.course_id ? null : 'Сначала назначьте курс',
    })),
    [groups],
  )

  const wizardGroups = useMemo<WizardGroupOption[]>(
    () => enrollableGroups(groups).map(group => ({
      id: group.id,
      name: group.name,
      courseTitle: group.courses?.title ?? null,
      hasCourse: Boolean(group.course_id),
    })),
    [groups],
  )

  const distributeGroups = useMemo<DistributeGroupOption[]>(
    () => enrollableGroups(groups).map(group => ({
      id: group.id,
      name: group.name,
      courseId: group.course_id ?? null,
      isActive: Boolean(group.is_active),
      maxStudents: group.max_students ?? 0,
      studentCount: group.student_count ?? 0,
      memberStudentIds: (group.group_students ?? []).map((gs: any) => gs.student_id),
      scheduleDays: group.schedule_days ?? null,
      scheduleTime: group.schedule_time ?? null,
    })),
    [groups],
  )

  const [distributeTarget, setDistributeTarget] = useState<MyJoinRequest | null>(null)
  /** Ученик, которому назначаем группу из строки списка. */
  const [assignGroupFor, setAssignGroupFor] = useState<MyStudent | null>(null)
  const [telegramFlags, setTelegramFlags] = useState<TelegramFlags>({})
  const [lastSubmissions, setLastSubmissions] = useState<LastSubmissions>({})

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

  async function loadJoinRequests() {
    setJoinRequestsLoading(true)
    setJoinRequestsError(null)
    try {
      setJoinRequests(await getMyJoinRequests(newStudentsFilter))
    } catch (error) {
      setJoinRequestsError(error instanceof Error ? error.message : 'Не удалось загрузить заявки')
    } finally {
      setJoinRequestsLoading(false)
    }
  }

  useEffect(() => {
    loadStudents()
  }, [])

  useEffect(() => {
    loadInvites()
  }, [inviteGroupFilter, inviteStatusFilter])

  useEffect(() => {
    loadJoinRequests()
  }, [newStudentsFilter])

  async function handleCopyJoinLink() {
    setLinkBusy(true)
    try {
      const result = await createOrGetTeacherJoinLink()
      if (!result.token) {
        toast.error('Не удалось получить ссылку регистрации')
        return
      }
      await navigator.clipboard.writeText(buildTeacherJoinUrl(result.token))
      toast.success('Ссылка регистрации скопирована')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось получить ссылку регистрации')
    } finally {
      setLinkBusy(false)
    }
  }

  async function handleRotateJoinLink() {
    setLinkBusy(true)
    try {
      const result = await rotateTeacherJoinLink()
      if (result.token) {
        await navigator.clipboard.writeText(buildTeacherJoinUrl(result.token))
        toast.success('Новая ссылка создана и скопирована. Старая ссылка больше не работает.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить ссылку')
    } finally {
      setLinkBusy(false)
    }
  }

  async function handleRejectJoinRequest(request: MyJoinRequest) {
    setReviewingRequestId(request.id)
    try {
      await rejectTeacherJoinRequest(request.id)
      toast.success('Заявка отклонена')
      loadJoinRequests()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отклонить заявку')
    } finally {
      setReviewingRequestId(null)
    }
  }

  async function handleRestoreJoinRequest(request: MyJoinRequest) {
    setReviewingRequestId(request.id)
    try {
      await restoreTeacherJoinRequest(request.id)
      toast.success('Заявка возвращена в новые')
      loadJoinRequests()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось вернуть заявку')
    } finally {
      setReviewingRequestId(null)
    }
  }

  function handleOpenDistribute(request: MyJoinRequest) {
    setDistributeTarget(request)
  }

  function handleDistributed() {
    toast.success('Ученик распределён')
    loadJoinRequests()
  }

  const filteredStudents = useMemo(() => {
    const query = studentQuery.trim().toLowerCase()
    return students.filter(student => {
      // Правило «мой ученик» — общее с тестом, живёт в lib/studentsScope.
      const mine = isMyStudent(student, scope)
      const matchesQuery = !query || student.fullName.toLowerCase().includes(query)
      const matchesGroup = !studentGroupFilter || student.groups.some(group => group.id === studentGroupFilter)
      return mine && matchesQuery && matchesGroup
    })
    // Сортировка по алфавиту (решение владельца 04.08). `localeCompare` с
    // русской локалью, иначе «Ё» уезжает в конец, а регистр начинает значить.
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
  }, [students, studentQuery, studentGroupFilter, scope])

  /**
   * Telegram и последняя сдача грузятся ПОСЛЕ основного списка и отдельно:
   * список должен появляться сразу, а эти две колонки дорисовываются. Ключ —
   * состав видимых учеников, а не сам массив: пересортировка или правка
   * поиска не должна дёргать базу.
   */
  const visibleStudentIdsKey = useMemo(
    () => filteredStudents.map(s => s.studentId).filter(Boolean).sort().join(','),
    [filteredStudents],
  )

  useEffect(() => {
    const ids = visibleStudentIdsKey ? visibleStudentIdsKey.split(',') : []
    if (ids.length === 0) {
      setTelegramFlags({})
      setLastSubmissions({})
      return
    }
    let cancelled = false
    void fetchTelegramFlags(ids).then(flags => { if (!cancelled) setTelegramFlags(flags) })
    void fetchLastSubmissions(ids).then(last => { if (!cancelled) setLastSubmissions(last) })
    return () => { cancelled = true }
  }, [visibleStudentIdsKey])

  /**
   * Сужение вкладок «Новые ученики» и «Приглашения».
   *
   * Обе RPC устроены одинаково: `X = моё OR is_admin_or_owner()` — то есть
   * администратору отдают всю школу. В §80 под гребень попала только первая
   * вкладка, эти две остались с утечкой.
   *
   * Пока набор «что моё» не приехал (`scope.loading`), не показываем ничего:
   * лучше пустой список на мгновение, чем чужие ученики.
   */
  const visibleJoinRequests = useMemo(
    () => joinRequests.filter(request => isMyJoinRequest(request, scope)),
    [joinRequests, scope],
  )

  const visibleInvites = useMemo(
    () => invites.filter(invite => isMyInvite(invite, scope, profile?.id)),
    [invites, scope, profile?.id],
  )
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleCopyJoinLink} loading={linkBusy}>
              <Copy size={15} />Скопировать ссылку регистрации
            </Button>
            <Button variant="secondary" onClick={() => setWizardOpen(true)}>
              <UserPlus size={15} />Пригласить сразу в группу
            </Button>
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              <Users size={15} />Добавить класс
            </Button>
            <Button variant="ghost" onClick={handleRotateJoinLink} loading={linkBusy} title="Отзывает старую ссылку и создаёт новую">
              <RotateCcw size={14} />Обновить ссылку
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        <TabButton active={tab === 'students'} onClick={() => setTab('students')}>Ученики</TabButton>
        <TabButton active={tab === 'newStudents'} onClick={() => setTab('newStudents')}>
          Новые ученики
          {visibleJoinRequests.length > 0 && newStudentsFilter === 'pending' && (
            <span className="ml-1.5 rounded-full bg-primary-100 px-1.5 py-0.5 text-xs font-semibold text-primary-700">{visibleJoinRequests.length}</span>
          )}
        </TabButton>
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
            <StudentsTable
              students={filteredStudents}
              telegramFlags={telegramFlags}
              lastSubmissions={lastSubmissions}
              onAssignGroup={setAssignGroupFor}
            />
          )}
        </div>
      )}

      {tab === 'newStudents' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={newStudentsFilter === 'pending' ? 'primary' : 'secondary'}
              onClick={() => setNewStudentsFilter('pending')}
            >
              Новые
            </Button>
            <Button
              type="button"
              size="sm"
              variant={newStudentsFilter === 'rejected' ? 'primary' : 'secondary'}
              onClick={() => setNewStudentsFilter('rejected')}
            >
              Отклонённые
            </Button>
          </div>

          {joinRequestsLoading ? (
            <LoadingState label="Загружаем заявки…" />
          ) : joinRequestsError ? (
            <ErrorState label={joinRequestsError} onRetry={loadJoinRequests} />
          ) : visibleJoinRequests.length === 0 ? (
            <EmptyState
              title={newStudentsFilter === 'pending' ? 'Новых заявок нет' : 'Отклонённых заявок нет'}
              body={newStudentsFilter === 'pending'
                ? 'Отправьте ученикам ссылку регистрации — заявки появятся здесь.'
                : 'Отклонённые заявки будут показаны в этом фильтре.'}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {visibleJoinRequests.map(request => (
                <Card key={request.id} className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-graphite-950">{request.fullName}</h3>
                      <p className="text-sm text-slate-500">{request.email || 'Email не указан'}</p>
                    </div>
                    <Badge variant={request.status === 'rejected' ? 'default' : 'success'}>
                      {request.status === 'rejected' ? 'Отклонена' : 'Новая'}
                    </Badge>
                  </div>
                  <div className="text-sm text-slate-500">Заявка подана: {formatDate(request.createdAt)}</div>
                  <div className="flex flex-wrap gap-2">
                    {request.status === 'pending' ? (
                      <>
                        <Button type="button" size="sm" onClick={() => handleOpenDistribute(request)}>
                          <UserCheck size={14} />Распределить
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          loading={reviewingRequestId === request.id}
                          onClick={() => handleRejectJoinRequest(request)}
                        >
                          <XCircle size={14} />Отклонить
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        loading={reviewingRequestId === request.id}
                        onClick={() => handleRestoreJoinRequest(request)}
                      >
                        <RotateCcw size={14} />Вернуть в новые
                      </Button>
                    )}
                  </div>
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

      <InviteStudentWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        groups={wizardGroups}
        onCreated={() => {
          loadStudents()
          loadInvites()
        }}
      />

      <StudentEnrollmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        groups={groupOptions}
        onCreated={() => {
          loadStudents()
          loadInvites()
        }}
      />

      {assignGroupFor && (
        <DistributeJoinRequestWizard
          open={Boolean(assignGroupFor)}
          onClose={() => setAssignGroupFor(null)}
          studentId={assignGroupFor.studentId ?? ''}
          studentFullName={assignGroupFor.fullName}
          groups={distributeGroups}
          onDistributed={() => {
            setAssignGroupFor(null)
            loadStudents()
          }}
        />
      )}

      {distributeTarget && (
        <DistributeJoinRequestWizard
          open={Boolean(distributeTarget)}
          onClose={() => setDistributeTarget(null)}
          joinRequestId={distributeTarget.id}
          studentId={distributeTarget.studentId}
          studentFullName={distributeTarget.fullName}
          groups={distributeGroups}
          onDistributed={handleDistributed}
        />
      )}
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
