import { useMemo } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import { VariantConstructor, type VariantConstructorInitialData, type VariantConstructorSubmitPayload } from '@/components/variant/VariantConstructor'
import { useCreateSelfBuiltVariant, useVariantBuilder } from '@/hooks/useVariants'
import { useAuthStore } from '@/store/authStore'

/**
 * Конструктор варианта. Один экран на всех (решение владельца 12.08), но
 * сохранение у ролей разное — и это не прихоть интерфейса, а устройство базы:
 *
 *  - ученик идёт через `create_self_built_variant`, которая ТРЕБУЕТ роль
 *    student и строку в `students`, и сразу создаёт самоназначение — вариант
 *    открывается на прохождение;
 *  - персонал через `save_variant_atomic` получает обычный вариант в разделе
 *    «Тесты», который потом выдаётся группе.
 *
 * Поэтому вторая копия страницы не нужна, а ветка сохранения — нужна: пустить
 * персонал по ученической RPC нельзя, она откажет по роли.
 */
export function StudentVariantGeneratePage() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isStudent = profile?.role === 'student'

  const { create, saving: creatingSelfBuilt } = useCreateSelfBuiltVariant()
  const { saveVariant, saving: savingVariant } = useVariantBuilder()

  const initialData = useMemo<VariantConstructorInitialData>(() => ({
    subject: 'math',
    examType: 'ege',
    title: isStudent
      ? `Мой вариант от ${format(new Date(), 'd MMMM', { locale: ru })}`
      : `Вариант от ${format(new Date(), 'd MMMM', { locale: ru })}`,
    description: '',
  }), [isStudent])

  const handleComplete = async (payload: VariantConstructorSubmitPayload) => {
    if (isStudent) {
      const studentAssignmentId = await create({
        title: payload.title,
        subject: payload.subject,
        examType: payload.examType,
        items: payload.tasks.map(task => ({
          task_id: task.task_id,
          section_id: task.section_id || null,
          topic_id: task.topic_id || null,
        })),
      })
      if (!studentAssignmentId) throw new Error('Не удалось создать вариант')
      navigate(`/student/variants/${studentAssignmentId}`)
      return
    }

    const variantId = await saveVariant({
      variantId:   null,
      title:       payload.title,
      description: payload.description,
      subject:     payload.subject,
      examType:    payload.examType,
      status:      'ready',
      settings:    payload.settings,
      items:       payload.tasks,
    })
    navigate(`/variants/${variantId}`)
  }

  return (
    <VariantConstructor
      headerTitle="Конструктор варианта"
      backLabel={isStudent ? 'К вариантам' : 'К тестам'}
      initialData={initialData}
      saving={isStudent ? creatingSelfBuilt : savingVariant}
      showDescription={false}
      showDraftAction={false}
      completeOnGenerate={true}
      showPreviewStep={false}
      completeActionLabel={isStudent ? 'Начать вариант' : 'Сохранить вариант'}
      completeStepLabel={isStudent ? 'Начало' : 'Сохранение'}
      onBack={() => navigate(isStudent ? '/student/variants' : '/variants')}
      onComplete={handleComplete}
      onReplaceTask={async () => null}
    />
  )
}
