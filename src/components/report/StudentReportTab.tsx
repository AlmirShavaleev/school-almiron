import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Loader2, Printer } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useStudentProgressReport } from '@/hooks/useStudentProgressReport'
import { useReportNextSteps } from '@/hooks/useReportNextSteps'
import { ParentReportSheet } from '@/components/report/ParentReportSheet'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/store/toastStore'
import { cleanSteps } from '@/lib/parentReport'

/**
 * §217. Вкладка «Отчёт для родителя» в карточке ученика.
 *
 * Разница между экраном и листом ровно одна и ровно та, что на утверждённом
 * макете: на экране есть внутренняя заметка преподавателя, на листе её нет.
 * Причём «нет» здесь означает «нет в разметке» — заметка живёт ОТДЕЛЬНЫМ
 * блоком этого файла, а `ParentReportSheet` про неё не знает вовсе.
 *
 * Печатает браузер. Своей кнопки печати нет намеренно (решение владельца):
 * системный диалог умеет поля, масштаб и выбор принтера, а вторая кнопка
 * рядом с ним только сбивает. Подсказка про Ctrl/Cmd + P — это подсказка, а
 * не кнопка.
 *
 * Лист уезжает в портал `document.body`: в `@media print` весь `#root`
 * выключен (`src/index.css`), и напечатать что-либо изнутри приложения
 * нельзя — тот же приём стоит у печати вариантов (`VariantPrintPanel`).
 */

function firstOfMonth(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA')
}

function today(): string {
  return new Date().toLocaleDateString('en-CA')
}

export function StudentReportTab({ studentId }: { studentId: string }) {
  const profile = useAuthStore(s => s.profile)
  const canEdit = !!profile?.role && ['admin', 'owner', 'teacher', 'curator'].includes(profile.role)

  const [from, setFrom] = useState(() => firstOfMonth(new Date()))
  const [to, setTo] = useState(() => today())
  const { report, loading, error, reload } = useStudentProgressReport(studentId, from, to)
  const { save, saving } = useReportNextSteps(studentId)

  // Три поля «что делать». Пустые строки в базу не уезжают и на листе не
  // печатаются пустыми пунктами списка.
  const saved = useMemo(() => cleanSteps(report?.next_steps), [report])
  const [steps, setSteps] = useState<string[]>(['', '', ''])
  useEffect(() => {
    setSteps([saved[0] ?? '', saved[1] ?? '', saved[2] ?? ''])
  }, [saved])

  const dirty = useMemo(
    () => cleanSteps(steps).join('\u0000') !== saved.join('\u0000'),
    [steps, saved],
  )

  async function commitSteps() {
    if (!profile?.id) return
    try {
      await save(from, to, steps, profile.id)
      toast.saved()
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
    }
  }

  return (
    <div className="space-y-4" data-testid="student-report-tab">

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-graphite-500">
            Период с
            <input
              type="date"
              value={from}
              max={to}
              onChange={e => setFrom(e.target.value)}
              aria-label="Начало периода отчёта"
              className="mt-1 block h-10 rounded-xl border border-graphite-200 bg-white px-3 text-sm text-graphite-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </label>
          <label className="text-xs text-graphite-500">
            по
            <input
              type="date"
              value={to}
              min={from}
              onChange={e => setTo(e.target.value)}
              aria-label="Конец периода отчёта"
              className="mt-1 block h-10 rounded-xl border border-graphite-200 bg-white px-3 text-sm text-graphite-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </label>
          <span className="flex items-center gap-1.5 text-xs text-graphite-500">
            <Printer size={13} className="shrink-0" />
            Печать — средствами браузера: Ctrl / Cmd + P. На бумагу уйдут два листа без этой подсказки
            и без внутренней заметки.
          </span>
        </div>
      </Card>

      {loading && (
        <Card className="flex items-center gap-2 text-sm text-graphite-500">
          <Loader2 size={16} className="animate-spin" />Собираем отчёт…
        </Card>
      )}

      {error && (
        <Card className="flex items-start gap-2 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span data-testid="report-error">{error}</span>
        </Card>
      )}

      {report && !loading && (
        <>
          {/* Три строки преподавателя. Кнопки «собрать черновик ИИ» здесь нет
              намеренно — решение оркестратора: она живёт в соседнем блоке
              заметок, и тащить её сюда отдельный разговор. */}
          {canEdit && (
            <Card className="space-y-3">
              <h3 className="text-sm font-semibold text-graphite-900">Что делать до следующей встречи</h3>
              <p className="text-xs text-graphite-500">
                Три строки. Они печатаются на листе для родителя и сохраняются вместе с этим периодом.
              </p>
              <div className="space-y-2">
                {[0, 1, 2].map(i => (
                  <input
                    key={i}
                    type="text"
                    value={steps[i] ?? ''}
                    maxLength={300}
                    aria-label={`Что делать до следующей встречи, строка ${i + 1}`}
                    onChange={e => setSteps(prev => prev.map((s, k) => (k === i ? e.target.value : s)))}
                    className="block w-full rounded-xl border border-graphite-200 bg-white px-3 py-2 text-sm text-graphite-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
                  />
                ))}
              </div>
              <Button size="sm" onClick={() => void commitSteps()} disabled={!dirty} loading={saving}>
                Сохранить
              </Button>
            </Card>
          )}

          {/* Внутренняя заметка преподавателя. ТОЛЬКО здесь: в `ParentReportSheet`
              её нет в разметке вовсе, и в печатный портал ниже она не уезжает. */}
          {report.teacher_note && (
            <Card className="border-l-4 border-l-gold-400">
              <div data-testid="report-teacher-note">
                <div className="text-[10px] uppercase tracking-wider text-gold-700">
                  Видно только преподавателям и кураторам — на лист родителю не попадает
                </div>
                <p className="mt-1 text-sm text-graphite-800">{report.teacher_note.body}</p>
              </div>
            </Card>
          )}

          <div className="report-preview">
            <ParentReportSheet report={report} />
          </div>

          {createPortal(
            <div className="print-portal-wrapper" aria-hidden="true">
              <ParentReportSheet report={report} />
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  )
}
