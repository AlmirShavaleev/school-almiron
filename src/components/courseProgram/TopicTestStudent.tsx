import { useState, useEffect } from 'react'
import {
  Loader2, ClipboardList, CheckCircle, XCircle, MinusCircle, AlertCircle,
} from 'lucide-react'
import { useTopicTestStudent } from '@/hooks/useTopicTest'
import { formatScore, scorePercent } from '@/lib/topicTest'
import { Button } from '@/components/ui/Button'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { cn } from '@/utils/cn'

/**
 * Ученический блок тестирования темы.
 *
 * Этапы:
 * 1. Загрузка → спиннер
 * 2. Нет теста → null (секцию не показываем)
 * 3. Попытка не начата → описание теста + кнопка «Начать тест»
 * 4. Попытка в прогрессе → форма с заданиями
 * 5. Попытка завершена → результаты и разбор
 */
export function TopicTestStudent({ topicId }: { topicId: string }) {
  const {
    test, items, attempt, answers, loading, error,
    start, saveAnswer, submit, refresh,
  } = useTopicTestStudent(topicId)

  // ──────── Локальное состояние ────────

  // Управление ответами: Record<itemId, string>
  const [localAnswers, setLocalAnswers] = useState<Record<string, string>>({})

  // Какие ответы были сохранены на сервере (чтобы знать, что нужно сохранить перед submit)
  const [savedAnswers, setSavedAnswers] = useState<Set<string>>(new Set())

  const [busySubmit, setBusySubmit] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Инициализируем localAnswers из ответов с сервера при загрузке
  useEffect(() => {
    if (attempt?.status === 'in_progress' && answers.length > 0 && Object.keys(localAnswers).length === 0) {
      const init: Record<string, string> = {}
      answers.forEach(a => {
        init[a.item_id] = a.answer_text || ''
      })
      setLocalAnswers(init)
      setSavedAnswers(new Set(answers.map(a => a.item_id)))
    }
  }, [attempt?.status, answers])

  // ──────── Обработчики ────────

  async function handleSaveAnswer(itemId: string, text: string) {
    setLocalError(null)
    try {
      await saveAnswer(itemId, text)
      setSavedAnswers(prev => new Set([...prev, itemId]))
    } catch (e: any) {
      setLocalError(e?.message ?? 'Ошибка сохранения ответа')
    }
  }

  async function handleSubmit() {
    // 1. Проверка пустых ответов
    const emptyCount = items.filter(item => !localAnswers[item.id]?.trim()).length
    if (emptyCount > 0) {
      const confirmed = window.confirm(
        `Без ответа: ${emptyCount} ${emptyCount === 1 ? 'задание' : 'заданий'}. Завершить?`
      )
      if (!confirmed) return
    }

    // 2. Сохранить все непустые несохранённые ответы
    setBusySubmit(true)
    setLocalError(null)
    try {
      const toSave = items.filter(item => {
        const text = localAnswers[item.id]?.trim()
        return text && !savedAnswers.has(item.id)
      })

      for (const item of toSave) {
        await saveAnswer(item.id, localAnswers[item.id])
      }

      // 3. Отправить тест
      await submit()
    } catch (e: any) {
      setLocalError(e?.message ?? 'Ошибка отправки теста')
    } finally {
      setBusySubmit(false)
    }
  }

  // ──────── States ────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Загрузка теста…
      </div>
    )
  }

  // Теста нет или не опубликован
  if (!test) return null

  // ──────── Render ────────

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      {/* ─── Заголовок ─── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ClipboardList size={16} className="text-primary-600" />
        <h2 className="text-base font-semibold text-gray-900 truncate">
          Тестирование · {test.title}
        </h2>
        {attempt && (
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', {
            'in_progress': 'bg-blue-100 text-blue-700',
            'completed':   'bg-green-100 text-green-700',
          }[attempt.status])}>
            {attempt.status === 'in_progress' ? 'В процессе' : 'Завершено'}
          </span>
        )}
      </div>

      {/* ─── Ошибки ─── */}
      {(error || localError) && (
        <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {localError || error}
        </div>
      )}

      {/* ═══ ДО НАЧАЛА ТЕСТА ═══ */}
      {!attempt && (
        <div className="space-y-4">
          {/* Описание */}
          {test.description && (
            <p className="text-sm text-gray-700 leading-relaxed">{test.description}</p>
          )}

          {/* Информация */}
          <div className="text-sm text-gray-600">
            <span className="font-medium">{items.length} заданий</span>
            <span className="mx-1">·</span>
            <span className="font-medium">
              {items.reduce((sum, item) => sum + (item.max_points || 0), 0)} баллов
            </span>
          </div>

          {/* Предупреждение */}
          <div className="flex gap-2.5 rounded-xl bg-amber-50 p-3 border border-amber-200">
            <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Попытка одна — результат фиксируется сразу после отправки.
            </p>
          </div>

          {/* Кнопка начать / статус готовности */}
          {items.length === 0 ? (
            <p className="text-sm text-gray-400">Тест пока не готов</p>
          ) : (
            <Button
              onClick={() => start().catch((e: any) => setLocalError(e?.message ?? 'Не удалось начать тест'))}
              size="md"
            >
              Начать тест
            </Button>
          )}
        </div>
      )}

      {/* ═══ ПРОХОЖДЕНИЕ ТЕСТА ═══ */}
      {attempt?.status === 'in_progress' && (
        <div className="space-y-5">
          {/* Список заданий */}
          {items.map((item, idx) => (
            <div key={item.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              {/* Номер и бейджи */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-900">Задание {idx + 1}</span>
                {item.exam_part !== null && (
                  <span className="rounded-md bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                    Часть {item.exam_part}
                  </span>
                )}
                {item.max_points !== null && (
                  <span className="rounded-md bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                    {item.max_points} б.
                  </span>
                )}
              </div>

              {/* Условие задания */}
              {item.statement_html && (
                <div className="mb-4 rounded-lg bg-white p-3 text-sm text-gray-800">
                  <TaskContentRenderer
                    html={resolveTaskHtml(item.statement_html, item.assets)}
                  />
                </div>
              )}

              {/* Поле ответа */}
              <textarea
                value={localAnswers[item.id] || ''}
                onChange={e => setLocalAnswers(prev => ({ ...prev, [item.id]: e.target.value }))}
                onBlur={e => handleSaveAnswer(item.id, e.target.value)}
                placeholder="Ваш ответ…"
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
              />
            </div>
          ))}

          {/* Кнопка завершить */}
          <Button
            onClick={handleSubmit}
            loading={busySubmit}
            disabled={busySubmit}
            size="md"
            className="w-full"
          >
            Завершить тест
          </Button>
        </div>
      )}

      {/* ═══ РЕЗУЛЬТАТЫ ═══ */}
      {attempt?.status === 'completed' && (
        <div className="space-y-6">
          {/* Блок результата */}
          <div className="rounded-xl bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-200 p-5 text-center">
            <div className="text-4xl font-bold text-gray-900">
              {formatScore(attempt.total_points, attempt.max_points)}
            </div>
            {attempt.max_points !== null && attempt.total_points !== null && (
              <div className="mt-2 text-sm">
                <span className={cn('font-semibold', {
                  'text-green-700': (scorePercent(attempt.total_points, attempt.max_points) ?? 0) >= 70,
                  'text-amber-700': (scorePercent(attempt.total_points, attempt.max_points) ?? 0) < 70 && (scorePercent(attempt.total_points, attempt.max_points) ?? 0) >= 40,
                  'text-red-700': (scorePercent(attempt.total_points, attempt.max_points) ?? 0) < 40,
                })}>
                  {scorePercent(attempt.total_points, attempt.max_points)}%
                </span>
              </div>
            )}
          </div>

          {/* Разбор */}
          <div className="space-y-4">
            {items.map((item, idx) => {
              const ans = answers.find(a => a.item_id === item.id)
              const isCorrect = ans?.is_correct ?? false
              const hasPartial = (ans?.awarded_points ?? 0) > 0 && !isCorrect

              return (
                <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  {/* Номер и статус */}
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-semibold text-gray-900">Задание {idx + 1}</span>
                    {isCorrect && <CheckCircle size={18} className="text-green-600" />}
                    {!isCorrect && !hasPartial && <XCircle size={18} className="text-red-600" />}
                    {hasPartial && <MinusCircle size={18} className="text-amber-500" />}
                  </div>

                  {/* Условие */}
                  {item.statement_html && (
                    <div className="mb-3 text-sm text-gray-700">
                      <TaskContentRenderer
                        html={resolveTaskHtml(item.statement_html, item.assets)}
                      />
                    </div>
                  )}

                  {/* Ответ учащегося */}
                  <div className="mb-2 rounded-lg bg-gray-50 p-2.5 text-sm">
                    <div className="text-xs font-medium text-gray-500 mb-1">Ваш ответ:</div>
                    <div className="text-gray-800">{ans?.answer_text || '—'}</div>
                  </div>

                  {/* Балл */}
                  {ans && (
                    <div className="mb-2 text-xs font-medium text-gray-600">
                      {ans.awarded_points ?? 0}/{item.max_points ?? 0} баллов
                    </div>
                  )}

                  {/* Правильный ответ */}
                  {item.answer_text && (
                    <div className="mb-3 rounded-lg bg-green-50 p-2.5 text-sm border border-green-200">
                      <div className="text-xs font-medium text-green-700 mb-1">Правильный ответ:</div>
                      <div className="text-green-900">{item.answer_text}</div>
                    </div>
                  )}

                  {/* Решение */}
                  {item.solution_html && (
                    <details className="mt-3 cursor-pointer">
                      <summary className="text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors">
                        Показать решение
                      </summary>
                      <div className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 border border-blue-200">
                        <TaskContentRenderer
                          html={resolveTaskHtml(item.solution_html, item.assets)}
                        />
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
