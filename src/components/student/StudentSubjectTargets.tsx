import { useEffect, useMemo, useState } from 'react'
import { Loader2, Target } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useStudentSubjectTargets } from '@/hooks/useStudentSubjectTargets'
import { useStudentCourseMemberships } from '@/hooks/useStudentCourseMemberships'
import { useAuthStore } from '@/store/authStore'
import { EXAM_LABELS, SUBJECT_LABELS } from '@/utils/format'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'

/**
 * §216. Цель по баллу в карточке ученика — по строке на предмет.
 *
 * Строки берутся из курсов, на которые ученик реально записан
 * (`group_students → groups → courses`, тот же источник, что у блока
 * «Курсы» ниже), плюс все уже заведённые цели. Второе слагаемое нужно, чтобы
 * цель не исчезла с экрана, когда курс сняли с ведения: цель — про ученика, а
 * не про курс.
 *
 * Пусто — «не задана», и в отчёте родителю это прочерк, а не ноль.
 */

interface Slot {
  subject: string
  examType: string
  score: number | null
}

function slotKey(subject: string, examType: string) {
  return `${subject}::${examType}`
}

export function StudentSubjectTargets({ studentId }: { studentId: string }) {
  const profile = useAuthStore(s => s.profile)
  const canEdit = !!profile?.role && ['admin', 'owner', 'teacher', 'curator'].includes(profile.role)
  const { targets, loading, error, save } = useStudentSubjectTargets(studentId)
  const { courses, loading: coursesLoading } = useStudentCourseMemberships(studentId)

  const slots = useMemo<Slot[]>(() => {
    const byKey = new Map<string, Slot>()
    for (const c of courses) {
      if (!c.courseSubject || !c.courseExamType) continue
      const key = slotKey(c.courseSubject, c.courseExamType)
      if (!byKey.has(key)) byKey.set(key, { subject: c.courseSubject, examType: c.courseExamType, score: null })
    }
    for (const t of targets) {
      byKey.set(slotKey(t.subject, t.exam_type), {
        subject: t.subject,
        examType: t.exam_type,
        score: t.target_score,
      })
    }
    return Array.from(byKey.values()).sort((a, b) =>
      (SUBJECT_LABELS[a.subject] ?? a.subject).localeCompare(SUBJECT_LABELS[b.subject] ?? b.subject))
  }, [courses, targets])

  if (loading || coursesLoading) {
    return (
      <Card className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />Цели по предметам…
      </Card>
    )
  }

  return (
    <Card className="space-y-3">
      <div data-testid="student-subject-targets" className="flex items-center gap-2">
        <Target size={16} className="shrink-0 text-primary-600" />
        <h2 className="text-sm font-semibold text-gray-900">Цель по баллу</h2>
        <span className="text-xs text-gray-400">по предмету</span>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      {slots.length === 0 ? (
        <div className="text-sm text-gray-400">
          Курсов у ученика пока нет — цель ставить не к чему.
        </div>
      ) : (
        <div className="space-y-2">
          {slots.map(slot => (
            <TargetRow
              key={slotKey(slot.subject, slot.examType)}
              slot={slot}
              canEdit={canEdit}
              onSave={score => save(slot.subject, slot.examType, score, profile!.id)}
            />
          ))}
        </div>
      )}

      <div className="text-xs text-gray-400">
        Пусто — цель не задана; в отчёте родителю это прочерк, а не ноль.
      </div>
    </Card>
  )
}

function TargetRow({ slot, canEdit, onSave }: {
  slot: Slot
  canEdit: boolean
  onSave: (score: number | null) => Promise<void>
}) {
  const [value, setValue] = useState(slot.score === null ? '' : String(slot.score))
  const [saving, setSaving] = useState(false)

  useEffect(() => { setValue(slot.score === null ? '' : String(slot.score)) }, [slot.score])

  const label = [SUBJECT_LABELS[slot.subject] ?? slot.subject, EXAM_LABELS[slot.examType] ?? slot.examType]
    .filter(Boolean).join(' · ')

  async function commit() {
    const trimmed = value.trim()
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && (!Number.isInteger(next) || next < 0 || next > 100)) {
      toast.error('Цель — целое число от 0 до 100')
      setValue(slot.score === null ? '' : String(slot.score))
      return
    }
    if (next === slot.score) return
    setSaving(true)
    try {
      await onSave(next)
      toast.saved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить цель')
      setValue(slot.score === null ? '' : String(slot.score))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-testid={`student-subject-target-${slot.subject}-${slot.examType}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2"
    >
      <span className="min-w-0 flex-1 text-sm font-medium text-gray-800">{label}</span>
      {canEdit ? (
        <div className="relative shrink-0">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={value}
            placeholder="—"
            aria-label={`Цель по предмету ${label}`}
            onChange={e => setValue(e.target.value)}
            onBlur={() => { void commit() }}
            className={cn(
              'h-9 w-24 rounded-xl border border-gray-200 bg-white px-3 text-center text-sm font-semibold text-gray-900',
              'focus:outline-none focus:ring-2 focus:ring-primary-400',
            )}
          />
          {saving && <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-primary-500" />}
        </div>
      ) : (
        <span className="shrink-0 text-sm font-semibold text-gray-900">
          {slot.score === null ? <span className="text-gray-300">—</span> : slot.score}
        </span>
      )}
    </div>
  )
}
