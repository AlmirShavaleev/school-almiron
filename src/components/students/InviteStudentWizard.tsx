import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Copy, Info, Loader2, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/utils/cn'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/store/toastStore'
import {
  COURSE_SELECTION_REQUIRED,
  buildInviteMessage,
  buildInviteUrl,
  countDirectionCourses,
  inviteStudentFlow,
  listDirectionCourses,
  type DirectionCourseOption,
  type EnrollmentFormat,
  type InviteStudentFlowResult,
} from '@/lib/studentEnrollment'

// Direction = (subject, exam_type). No separate directions entity.
const SUBJECTS: Array<{ value: string; label: string }> = [
  { value: 'physics', label: 'Физика' },
  { value: 'math', label: 'Математика' },
  { value: 'algebra', label: 'Алгебра' },
  { value: 'geometry', label: 'Геометрия' },
  { value: 'probability_statistics', label: 'Вероятность и статистика' },
]

const EXAMS: Array<{ value: string; label: string }> = [
  { value: 'ege', label: 'ЕГЭ' },
  { value: 'oge', label: 'ОГЭ' },
  { value: 'grade_7', label: '7 класс' },
  { value: 'grade_8', label: '8 класс' },
  { value: 'grade_9', label: '9 класс' },
  { value: 'grade_10', label: '10 класс' },
  { value: 'grade_11', label: '11 класс' },
]

export interface WizardGroupOption {
  id: string
  name: string
  courseTitle: string | null
  hasCourse: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  /** existing groups (with a course) that can be reused as a mini-group */
  groups: WizardGroupOption[]
  onCreated?: () => void
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function copyText(value: string, message: string) {
  await navigator.clipboard.writeText(value)
  toast.success(message)
}

/** idempotency key for one send attempt; reused across retries, rotated per new action */
function makeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function InviteStudentWizard({ open, onClose, groups, onCreated }: Props) {
  const profile = useAuthStore(s => s.profile)
  const ownerId = profile?.id ?? ''

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [classGrade, setClassGrade] = useState('')
  const [format, setFormat] = useState<EnrollmentFormat>('individual')
  const [subject, setSubject] = useState('physics')
  const [examType, setExamType] = useState('ege')
  const [existingGroupId, setExistingGroupId] = useState('')

  const [directionCourseCount, setDirectionCourseCount] = useState<number | null>(null)
  const [coursePicker, setCoursePicker] = useState<DirectionCourseOption[] | null>(null)
  const [chosenCourseId, setChosenCourseId] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<null | (InviteStudentFlowResult & { fullName: string })>(null)
  // one request_id per send attempt; retries/course-pick reuse it, a full reset rotates it
  const [requestId, setRequestId] = useState<string>(makeRequestId())

  useEffect(() => {
    if (!open) return
    setFullName(''); setEmail(''); setPhone(''); setClassGrade('')
    setFormat('individual'); setSubject('physics'); setExamType('ege'); setExistingGroupId('')
    setDirectionCourseCount(null); setCoursePicker(null); setChosenCourseId('')
    setSaving(false); setError(null); setResult(null)
    setRequestId(makeRequestId())
  }, [open])

  // "новая группа" path -> tell the teacher upfront if a draft program will be created
  const usesNewGroup = format === 'individual' || (format === 'mini_group' && !existingGroupId)

  useEffect(() => {
    if (!open || !usesNewGroup || !ownerId) {
      setDirectionCourseCount(null)
      return
    }
    let cancelled = false
    countDirectionCourses(ownerId, subject, examType)
      .then(count => { if (!cancelled) setDirectionCourseCount(count) })
      .catch(() => { if (!cancelled) setDirectionCourseCount(null) })
    return () => { cancelled = true }
  }, [open, usesNewGroup, ownerId, subject, examType])

  const groupsWithCourse = useMemo(() => groups.filter(g => g.hasCourse), [groups])

  if (!open) return null

  async function submit(courseId?: string) {
    if (!fullName.trim()) { setError('Укажите ФИО ученика'); return }
    if (format === 'mini_group' && existingGroupId) {
      // existing group -> course/direction already known
    } else if (!subject || !examType) {
      setError('Выберите направление'); return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await inviteStudentFlow({
        fullName: fullName.trim(),
        format,
        email: email.trim() || null,
        phone: phone.trim() || null,
        classGrade: classGrade.trim() || null,
        subject: format === 'mini_group' && existingGroupId ? null : subject,
        examType: format === 'mini_group' && existingGroupId ? null : examType,
        groupId: format === 'mini_group' && existingGroupId ? existingGroupId : null,
        courseId: courseId ?? null,
        requestId,
      })
      setResult({ ...res, fullName: fullName.trim() })
      setCoursePicker(null)
      onCreated?.()
    } catch (err) {
      const e = err as { message?: string; code?: string | null }
      if (e?.code === COURSE_SELECTION_REQUIRED) {
        // several eligible courses, no default -> compact picker, then resubmit
        try {
          const options = await listDirectionCourses(ownerId, subject, examType)
          setCoursePicker(options)
          setChosenCourseId(options[0]?.id ?? '')
          setError('Для этого направления несколько программ. Выберите нужную.')
        } catch {
          setError('Не удалось загрузить список программ направления')
        }
      } else {
        setError(e?.message || 'Не удалось создать приглашение')
      }
    } finally {
      setSaving(false)
    }
  }

  const inviteUrl = result ? buildInviteUrl(result.token) : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[94vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between border-b border-gray-100 px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-bold text-graphite-950">Пригласить ученика</h2>
            <p className="mt-1 text-sm text-slate-500">Программа и группа подберутся автоматически</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {result ? (
            <Card className="space-y-4 border-emerald-100 bg-emerald-50/50">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 text-emerald-600" size={20} />
                <div>
                  <h3 className="font-semibold text-graphite-950">Приглашение отправлено</h3>
                  <p className="text-sm text-slate-600">{result.fullName}</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Tile label="Срок действия" value={formatDate(result.expiresAt)} />
                <Tile label="Короткий код" value={result.shortCode} />
                <Tile label="Персональная ссылка" value={inviteUrl || '—'} className="md:col-span-2" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={!inviteUrl} onClick={() => copyText(inviteUrl, 'Ссылка скопирована')}>
                  <Copy size={14} />Скопировать ссылку
                </Button>
                <Button type="button" variant="secondary" onClick={() => copyText(result.shortCode, 'Код скопирован')}>
                  <Copy size={14} />Скопировать код
                </Button>
                <Button type="button" variant="secondary" onClick={() => copyText(buildInviteMessage(result.token, result.shortCode), 'Приглашение скопировано')}>
                  <Copy size={14} />Скопировать приглашение
                </Button>
              </div>
              {result.draftCourse && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                  <Info size={16} className="mt-0.5 shrink-0" />
                  <div>
                    Для этого направления создан черновик учебной программы. Наполните его позже.
                    <div className="mt-1">
                      <Link
                        to={result.courseId ? `/course-program?courseId=${encodeURIComponent(result.courseId)}` : '/course-program'}
                        className="font-semibold text-amber-900 underline"
                      >
                        Наполнить программу
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ) : (
            <>
              <Field label="ФИО ученика" required>
                <input value={fullName} onChange={e => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </Field>

              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Email"><input value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /></Field>
                <Field label="Телефон"><input value={phone} onChange={e => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /></Field>
                <Field label="Класс"><input value={classGrade} onChange={e => setClassGrade(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /></Field>
              </div>

              <Field label="Формат">
                <div className="flex gap-2">
                  <FormatButton active={format === 'individual'} onClick={() => setFormat('individual')} label="Индивидуально" />
                  <FormatButton active={format === 'mini_group'} onClick={() => setFormat('mini_group')} label="Мини-группа" />
                </div>
              </Field>

              {format === 'mini_group' && groupsWithCourse.length > 0 && (
                <Field label="Группа">
                  <select value={existingGroupId} onChange={e => setExistingGroupId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="">Новая мини-группа</option>
                    {groupsWithCourse.map(g => (
                      <option key={g.id} value={g.id}>{g.name}{g.courseTitle ? ` — ${g.courseTitle}` : ''}</option>
                    ))}
                  </select>
                </Field>
              )}

              {usesNewGroup && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Предмет" required>
                    <select value={subject} onChange={e => setSubject(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      {SUBJECTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Экзамен / класс" required>
                    <select value={examType} onChange={e => setExamType(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      {EXAMS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                    </select>
                  </Field>
                </div>
              )}

              {usesNewGroup && directionCourseCount === 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                  <Info size={16} className="mt-0.5 shrink-0" />
                  Для этого направления пока нет учебной программы. При отправке приглашения будет создан черновик, который можно наполнить позже.
                </div>
              )}

              {coursePicker && coursePicker.length > 0 && (
                <Field label="Учебная программа" required>
                  <select value={chosenCourseId} onChange={e => setChosenCourseId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {coursePicker.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </Field>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-4 py-4 sm:px-6">
          {result ? (
            <Button type="button" onClick={onClose}>Готово</Button>
          ) : coursePicker ? (
            <Button type="button" loading={saving} disabled={!chosenCourseId} onClick={() => submit(chosenCourseId)}>
              <Send size={14} />Отправить с выбранной программой
            </Button>
          ) : (
            <Button type="button" loading={saving} onClick={() => submit()}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Создать и отправить приглашение
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-graphite-900">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
    </label>
  )
}

function FormatButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors',
        active ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:border-primary-200')}>
      {label}
    </button>
  )
}

function Tile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white px-3 py-3', className)}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-all text-sm font-semibold text-graphite-950">{value}</div>
    </div>
  )
}
