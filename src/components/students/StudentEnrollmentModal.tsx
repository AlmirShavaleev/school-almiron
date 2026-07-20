import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Copy, Download, Loader2, Plus, Trash2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/utils/cn'
import {
  buildInviteMessage,
  buildInviteUrl,
  createStudentInvite,
  createStudentInviteBatch,
  type StudentInviteBatchItem,
} from '@/lib/studentEnrollment'
import { toast } from '@/store/toastStore'

type WizardMode = 'chooser' | 'single' | 'batch'
type BatchStage = 'edit' | 'preview' | 'result'

export interface EnrollmentGroupOption {
  id: string
  name: string
  courseId: string | null
  courseTitle: string | null
  disabled?: boolean
  disabledReason?: string | null
}

interface BatchRow {
  clientRowId: string
  fullName: string
  classGrade: string
  email: string
  phone: string
}

interface BatchPreviewRow extends BatchRow {
  statuses: string[]
  isEmpty: boolean
  isValid: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  groups: EnrollmentGroupOption[]
  defaultGroupId?: string | null
  onCreated?: () => void
}

const MAX_NON_EMPTY_ROWS = 500
const INITIAL_ROWS = 10
const TABLE_HEADERS = ['ФИО', 'Класс', 'Email', 'Телефон']

const STATUS_LABELS: Record<string, string> = {
  invite_created: 'Приглашение создано',
  duplicate_in_batch: 'Дубликат в пакете',
  active_invite_exists: 'Уже есть активное приглашение',
  already_enrolled: 'Уже зачислен',
  invalid_data: 'Некорректные данные',
  group_capacity_reached: 'Группа заполнена',
}

function createEmptyRow(clientRowId: string): BatchRow {
  return { clientRowId, fullName: '', classGrade: '', email: '', phone: '' }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizePhone(value: string): string {
  return value.replace(/\D+/g, '')
}

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function copyText(value: string, successMessage: string) {
  await navigator.clipboard.writeText(value)
  toast.success(successMessage)
}

export function StudentEnrollmentModal({ open, onClose, groups, defaultGroupId = null, onCreated }: Props) {
  const nextRowId = useRef(1)
  const [mode, setMode] = useState<WizardMode>('chooser')
  const [singleGroupId, setSingleGroupId] = useState(defaultGroupId ?? '')
  const [singleFullName, setSingleFullName] = useState('')
  const [singleClassGrade, setSingleClassGrade] = useState('')
  const [singleEmail, setSingleEmail] = useState('')
  const [singlePhone, setSinglePhone] = useState('')
  const [singleSaving, setSingleSaving] = useState(false)
  const [singleError, setSingleError] = useState<string | null>(null)
  const [singleResult, setSingleResult] = useState<null | { fullName: string; groupName: string; token: string; shortCode: string; expiresAt: string }>(null)

  const [batchGroupId, setBatchGroupId] = useState(defaultGroupId ?? '')
  const [batchStage, setBatchStage] = useState<BatchStage>('edit')
  const [batchRows, setBatchRows] = useState<BatchRow[]>([])
  const [activeCell, setActiveCell] = useState<{ rowId: string; col: keyof BatchRow } | null>(null)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchResult, setBatchResult] = useState<null | { batchId: string; items: StudentInviteBatchItem[] }>(null)

  useEffect(() => {
    if (!open) return
    nextRowId.current = 1
    setMode(defaultGroupId ? 'single' : 'chooser')
    setSingleGroupId(defaultGroupId ?? '')
    setSingleFullName('')
    setSingleClassGrade('')
    setSingleEmail('')
    setSinglePhone('')
    setSingleSaving(false)
    setSingleError(null)
    setSingleResult(null)

    setBatchGroupId(defaultGroupId ?? '')
    setBatchStage('edit')
    setBatchRows(Array.from({ length: INITIAL_ROWS }, () => createEmptyRow(String(nextRowId.current++))))
    setActiveCell(null)
    setBatchError(null)
    setBatchSaving(false)
    setBatchResult(null)
  }, [open, defaultGroupId])

  const selectedSingleGroup = useMemo(
    () => groups.find(group => group.id === singleGroupId) ?? null,
    [groups, singleGroupId],
  )
  const selectedBatchGroup = useMemo(
    () => groups.find(group => group.id === batchGroupId) ?? null,
    [groups, batchGroupId],
  )

  const previewRows = useMemo<BatchPreviewRow[]>(() => {
    const nameCount = new Map<string, number>()
    const emailCount = new Map<string, number>()
    const phoneCount = new Map<string, number>()

    for (const row of batchRows) {
      const trimmedName = row.fullName.trim().toLowerCase()
      const normalizedEmail = normalizeEmail(row.email)
      const normalizedPhone = normalizePhone(row.phone)
      if (trimmedName) nameCount.set(trimmedName, (nameCount.get(trimmedName) ?? 0) + 1)
      if (normalizedEmail) emailCount.set(normalizedEmail, (emailCount.get(normalizedEmail) ?? 0) + 1)
      if (normalizedPhone) phoneCount.set(normalizedPhone, (phoneCount.get(normalizedPhone) ?? 0) + 1)
    }

    return batchRows.map(row => {
      const statuses: string[] = []
      const fullName = row.fullName.trim()
      const classGrade = row.classGrade.trim()
      const email = normalizeEmail(row.email)
      const phone = normalizePhone(row.phone)
      const isEmpty = !fullName && !classGrade && !email && !phone

      if (!isEmpty && !fullName) statuses.push('ФИО обязательно')
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) statuses.push('Некорректный email')
      if (phone && phone.length < 10) statuses.push('Некорректный телефон')
      if (fullName && (nameCount.get(fullName.toLowerCase()) ?? 0) > 1) statuses.push('Дубликат ФИО')
      if (email && (emailCount.get(email) ?? 0) > 1) statuses.push('Дубликат email')
      if (phone && (phoneCount.get(phone) ?? 0) > 1) statuses.push('Дубликат телефона')

      return {
        ...row,
        statuses,
        isEmpty,
        isValid: !statuses.length,
      }
    })
  }, [batchRows])

  const filledPreviewRows = previewRows.filter(row => !row.isEmpty)
  const previewErrorCount = filledPreviewRows.filter(row => !row.isValid).length

  if (!open) return null

  function appendRows(count: number) {
    setBatchRows(prev => [...prev, ...Array.from({ length: count }, () => createEmptyRow(String(nextRowId.current++)))])
  }

  function updateBatchCell(rowId: string, key: keyof BatchRow, value: string) {
    setBatchRows(prev => prev.map(row => row.clientRowId === rowId ? { ...row, [key]: value } : row))
  }

  function removeBatchRow(rowId: string) {
    setBatchRows(prev => prev.length > 1 ? prev.filter(row => row.clientRowId !== rowId) : prev)
  }

  function clearEmptyRows() {
    setBatchRows(prev => {
      const filtered = prev.filter(row => row.fullName.trim() || row.classGrade.trim() || row.email.trim() || row.phone.trim())
      return filtered.length ? filtered : [createEmptyRow(String(nextRowId.current++))]
    })
  }

  async function handleSingleSubmit() {
    if (!singleGroupId || !selectedSingleGroup || selectedSingleGroup.disabled) {
      setSingleError(selectedSingleGroup?.disabledReason || 'Выберите группу с назначенным курсом')
      return
    }
    if (!singleFullName.trim()) {
      setSingleError('Укажите ФИО ученика')
      return
    }

    setSingleSaving(true)
    setSingleError(null)
    try {
      const result = await createStudentInvite({
        groupId: singleGroupId,
        fullName: singleFullName.trim(),
        classGrade: singleClassGrade.trim() || null,
        email: singleEmail.trim() || null,
        phone: singlePhone.trim() || null,
      })
      setSingleResult({
        fullName: singleFullName.trim(),
        groupName: selectedSingleGroup.name,
        token: result.token,
        shortCode: result.shortCode,
        expiresAt: result.expiresAt,
      })
      onCreated?.()
    } catch (error) {
      setSingleError(error instanceof Error ? error.message : 'Не удалось создать приглашение')
    } finally {
      setSingleSaving(false)
    }
  }

  function canOpenBatchPreview(): boolean {
    if (!batchGroupId || !selectedBatchGroup || selectedBatchGroup.disabled) {
      setBatchError(selectedBatchGroup?.disabledReason || 'Выберите группу с назначенным курсом')
      return false
    }
    if (!filledPreviewRows.length) {
      setBatchError('Заполните хотя бы одну строку')
      return false
    }
    setBatchError(null)
    return true
  }

  function ensureBatchReady(): boolean {
    if (!canOpenBatchPreview()) return false
    if (filledPreviewRows.length > MAX_NON_EMPTY_ROWS) {
      setBatchError(`Можно отправить не более ${MAX_NON_EMPTY_ROWS} заполненных строк`)
      return false
    }
    if (previewErrorCount > 0) {
      setBatchError('Исправьте ошибки в таблице перед подтверждением')
      return false
    }
    setBatchError(null)
    return true
  }

  async function handleBatchSubmit() {
    if (!ensureBatchReady()) return
    setBatchSaving(true)
    try {
      const result = await createStudentInviteBatch({
        groupId: batchGroupId,
        rows: filledPreviewRows.map(row => ({
          clientRowId: row.clientRowId,
          fullName: row.fullName.trim(),
          classGrade: row.classGrade.trim() || null,
          email: row.email.trim() || null,
          phone: row.phone.trim() || null,
        })),
      })
      setBatchResult({ batchId: result.batchId, items: result.items })
      setBatchStage('result')
      onCreated?.()
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : 'Не удалось создать пакет приглашений')
    } finally {
      setBatchSaving(false)
    }
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLInputElement>, rowId: string, col: keyof BatchRow) {
    const text = event.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return
    event.preventDefault()

    const rows = text
      .replace(/\r/g, '')
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => line.split('\t'))
    if (!rows.length) return

    const rowIndex = batchRows.findIndex(row => row.clientRowId === rowId)
    const columns: Array<keyof BatchRow> = ['fullName', 'classGrade', 'email', 'phone']
    const colIndex = columns.indexOf(col)
    const next = [...batchRows]

    while (next.length < rowIndex + rows.length) {
      next.push(createEmptyRow(String(nextRowId.current++)))
    }

    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < rows[r].length; c += 1) {
        const targetKey = columns[colIndex + c]
        if (!targetKey) continue
        next[rowIndex + r] = { ...next[rowIndex + r], [targetKey]: rows[r][c] }
      }
    }

    setBatchRows(next)
  }

  async function downloadBatchCsv() {
    if (!batchResult) return
    const mapById = new Map(filledPreviewRows.map(row => [row.clientRowId, row]))
    const lines = [
      ['ФИО', 'Класс', 'Персональная ссылка', 'Короткий код', 'Статус', 'Ошибка'].join(','),
      ...batchResult.items.map(item => {
        const row = mapById.get(item.clientRowId)
        return [
          csvEscape(row?.fullName ?? ''),
          csvEscape(row?.classGrade ?? ''),
          csvEscape(item.token ? buildInviteUrl(item.token) : ''),
          csvEscape(item.shortCode ?? ''),
          csvEscape(STATUS_LABELS[item.status] ?? 'Неизвестный результат'),
          csvEscape(item.error ?? ''),
        ].join(',')
      }),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `student-invites-${batchResult.batchId}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function copyAllInvites() {
    if (!batchResult) return
    const mapById = new Map(filledPreviewRows.map(row => [row.clientRowId, row]))
    const text = batchResult.items
      .filter(item => item.token && item.shortCode)
      .map(item => buildInviteMessage(item.token!, item.shortCode!))
      .map((message, index) => {
        const row = mapById.get(batchResult.items[index].clientRowId)
        return row ? `${row.fullName}\n${message}` : message
      })
      .join('\n\n')
    if (!text.trim()) return
    await copyText(text, 'Все приглашения скопированы')
  }

  const renderedRows = batchRows.length
  const singleInviteUrl = singleResult ? buildInviteUrl(singleResult.token) : ''
  const canCopySingleInvite = Boolean(singleInviteUrl && singleResult?.shortCode)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[94vh] sm:max-w-6xl sm:rounded-2xl">
        <div className="flex items-start justify-between border-b border-gray-100 px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-bold text-graphite-950">Добавить учеников</h2>
            <p className="mt-1 text-sm text-slate-500">Приглашения и зачисление в учебные группы</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {mode === 'chooser' && (
            <div className="grid gap-4 md:grid-cols-2">
              <ChoiceCard
                title="Одного ученика"
                body="Создать персональное приглашение с ссылкой и коротким кодом."
                onClick={() => setMode('single')}
              />
              <ChoiceCard
                title="Целый класс"
                body="Заполнить таблицу или вставить данные из Excel / Google Sheets."
                onClick={() => setMode('batch')}
              />
            </div>
          )}

          {mode === 'single' && (
            <div className="mx-auto max-w-3xl space-y-5">
              {!singleResult ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Группа" required>
                      <GroupSelect value={singleGroupId} onChange={setSingleGroupId} groups={groups} />
                    </FormField>
                    <FormField label="Класс">
                      <input
                        value={singleClassGrade}
                        onChange={event => setSingleClassGrade(event.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </FormField>
                  </div>
                  <FormField label="ФИО" required>
                    <input
                      value={singleFullName}
                      onChange={event => setSingleFullName(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </FormField>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Email">
                      <input
                        value={singleEmail}
                        onChange={event => setSingleEmail(event.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </FormField>
                    <FormField label="Телефон">
                      <input
                        value={singlePhone}
                        onChange={event => setSinglePhone(event.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </FormField>
                  </div>
                  {singleError && <InlineError message={singleError} />}
                </>
              ) : (
                <Card className="space-y-4 border-emerald-100 bg-emerald-50/50">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 text-emerald-600" size={20} />
                    <div>
                      <h3 className="font-semibold text-graphite-950">Приглашение создано</h3>
                      <p className="text-sm text-slate-600">{singleResult.fullName} · {singleResult.groupName}</p>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <ResultTile label="Срок действия" value={formatDate(singleResult.expiresAt)} />
                    <ResultTile label="Короткий код" value={singleResult.shortCode} />
                    <ResultTile label="Персональная ссылка" value={singleInviteUrl || '—'} className="md:col-span-2" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" disabled={!singleInviteUrl} onClick={() => copyText(singleInviteUrl, 'Ссылка скопирована')}>
                      <Copy size={14} />Скопировать ссылку
                    </Button>
                    <Button type="button" variant="secondary" disabled={!singleResult.shortCode} onClick={() => copyText(singleResult.shortCode, 'Код скопирован')}>
                      <Copy size={14} />Скопировать код
                    </Button>
                    <Button type="button" variant="secondary" disabled={!canCopySingleInvite} onClick={() => copyText(buildInviteMessage(singleResult.token, singleResult.shortCode), 'Приглашение скопировано')}>
                      <Copy size={14} />Скопировать приглашение целиком
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )}

          {mode === 'batch' && (
            <div className="space-y-5">
              {batchStage === 'edit' && (
                <>
                  <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                    <Card className="space-y-3">
                      <FormField label="Группа" required>
                        <GroupSelect value={batchGroupId} onChange={setBatchGroupId} groups={groups} />
                      </FormField>
                      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                        Вставьте таблицу прямо из Excel или Google Sheets. Каждая строка получит стабильный `client_row_id`.
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={() => appendRows(1)}>
                          <Plus size={14} />Добавить строку
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => appendRows(10)}>
                          <Plus size={14} />Добавить 10 строк
                        </Button>
                        <Button type="button" variant="secondary" onClick={clearEmptyRows}>
                          Очистить пустые
                        </Button>
                      </div>
                      <div className="text-sm text-slate-500">
                        Заполнено строк: <span className="font-semibold text-graphite-950">{filledPreviewRows.length}</span> из {MAX_NON_EMPTY_ROWS}
                      </div>
                    </Card>

                    <Card className="overflow-hidden p-0">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              {TABLE_HEADERS.map(header => (
                                <th key={header} className="px-3 py-3 text-left font-semibold text-slate-600">{header}</th>
                              ))}
                              <th className="px-3 py-3 text-right font-semibold text-slate-600">Действие</th>
                            </tr>
                          </thead>
                          <tbody>
                            {batchRows.map(row => (
                              <tr key={row.clientRowId} data-testid={`batch-row-${row.clientRowId}`} className="border-t border-slate-100">
                                {(['fullName', 'classGrade', 'email', 'phone'] as Array<keyof BatchRow>).map(key => (
                                  <td key={key} className="px-3 py-2">
                                    <input
                                      value={row[key]}
                                      onFocus={() => setActiveCell({ rowId: row.clientRowId, col: key })}
                                      onChange={event => updateBatchCell(row.clientRowId, key, event.target.value)}
                                      onPaste={event => handlePaste(event, row.clientRowId, key)}
                                      className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    />
                                  </td>
                                ))}
                                <td className="px-3 py-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => removeBatchRow(row.clientRowId)}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </div>
                  <div className="text-sm text-slate-500">
                    Активная ячейка: {activeCell ? `${activeCell.rowId} · ${activeCell.col}` : 'не выбрана'} · Строк в таблице: {renderedRows}
                  </div>
                  {batchError && <InlineError message={batchError} />}
                </>
              )}

              {batchStage === 'preview' && (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <ResultTile label="Заполненных строк" value={String(filledPreviewRows.length)} />
                    <ResultTile label="Ошибок" value={String(previewErrorCount)} />
                    <ResultTile label="Группа" value={selectedBatchGroup?.name ?? '—'} />
                  </div>
                  <Card className="overflow-hidden p-0">
                    <div className="divide-y divide-slate-100">
                      {filledPreviewRows.map(row => (
                        <div key={row.clientRowId} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="font-medium text-graphite-950">{row.fullName}</div>
                            <div className="text-sm text-slate-500">{[row.classGrade, row.email, row.phone].filter(Boolean).join(' · ') || 'Без контактов'}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(row.statuses.length ? row.statuses : ['Готово к отправке']).map(status => (
                              <span
                                key={status}
                                className={cn(
                                  'rounded-full px-2.5 py-1 text-xs font-semibold',
                                  row.statuses.length ? 'bg-red-50 text-red-600 ring-1 ring-red-100' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
                                )}
                              >
                                {status}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                  {batchError && <InlineError message={batchError} />}
                </div>
              )}

              {batchStage === 'result' && batchResult && (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <ResultTile label="Batch ID" value={batchResult.batchId} />
                    <ResultTile label="Создано" value={String(batchResult.items.filter(item => item.status === 'invite_created').length)} />
                    <ResultTile label="Пропущено" value={String(batchResult.items.filter(item => item.status !== 'invite_created' && !item.error).length)} />
                    <ResultTile label="Ошибок" value={String(batchResult.items.filter(item => item.error).length)} />
                  </div>
                  <Card className="overflow-hidden p-0">
                    <div className="divide-y divide-slate-100">
                      {batchResult.items.map(item => {
                        const sourceRow = filledPreviewRows.find(row => row.clientRowId === item.clientRowId)
                        return (
                          <div key={item.clientRowId} className="space-y-2 px-4 py-3">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div>
                                <div className="font-medium text-graphite-950">{sourceRow?.fullName ?? item.clientRowId}</div>
                                <div className="text-sm text-slate-500">{STATUS_LABELS[item.status] ?? 'Неизвестный результат'}</div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {item.token && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">Ссылка готова</span>}
                                {item.shortCode && <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100">{item.shortCode}</span>}
                              </div>
                            </div>
                            {(item.token || item.error) && (
                              <div className="text-sm text-slate-600">
                                {item.token && <div>{buildInviteUrl(item.token)}</div>}
                                {item.error && <div className="text-red-600">{item.error}</div>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={copyAllInvites}>
                      <Copy size={14} />Скопировать все приглашения
                    </Button>
                    <Button type="button" variant="secondary" onClick={downloadBatchCsv}>
                      <Download size={14} />Скачать CSV
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-col gap-3 border-t border-slate-100 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="text-sm text-slate-500">
            {mode === 'batch' && batchStage === 'edit' && 'Можно вставлять TSV-таблицу прямо в выбранную ячейку'}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {mode !== 'chooser' && !defaultGroupId && (
              <Button type="button" variant="ghost" onClick={() => setMode('chooser')}>
                Назад
              </Button>
            )}
            {mode === 'single' && !singleResult && (
              <Button type="button" onClick={handleSingleSubmit} loading={singleSaving}>
                Создать приглашение
              </Button>
            )}
            {mode === 'single' && singleResult && (
              <Button type="button" onClick={onClose}>Готово</Button>
            )}
            {mode === 'batch' && batchStage === 'edit' && (
              <Button
                type="button"
                onClick={() => {
                  if (!canOpenBatchPreview()) return
                  setBatchStage('preview')
                }}
              >
                Проверить строки
              </Button>
            )}
            {mode === 'batch' && batchStage === 'preview' && (
              <>
                <Button type="button" variant="secondary" onClick={() => setBatchStage('edit')}>Вернуться к таблице</Button>
                <Button type="button" onClick={handleBatchSubmit} loading={batchSaving}>Подтвердить импорт</Button>
              </>
            )}
            {mode === 'batch' && batchStage === 'result' && (
              <Button type="button" onClick={onClose}>Готово</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ChoiceCard({ title, body, onClick }: { title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-slate-200 bg-white p-5 text-left transition-colors hover:border-primary-200 hover:bg-primary-50/30"
    >
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
        <Users size={18} />
      </div>
      <div className="font-semibold text-graphite-950">{title}</div>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
    </button>
  )
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-graphite-900">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  )
}

function GroupSelect({
  value,
  onChange,
  groups,
}: {
  value: string
  onChange: (value: string) => void
  groups: EnrollmentGroupOption[]
}) {
  return (
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
    >
      <option value="">Выберите группу</option>
      {groups.map(group => (
        <option key={group.id} value={group.id} disabled={group.disabled}>
          {group.name}{group.disabled ? ' — Сначала назначьте курс' : group.courseTitle ? ` — ${group.courseTitle}` : ''}
        </option>
      ))}
    </select>
  )
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function ResultTile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-slate-50 px-3 py-3', className)}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-all text-sm font-semibold text-graphite-950">{value}</div>
    </div>
  )
}
