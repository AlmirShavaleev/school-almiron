import { useEffect, useState } from 'react'
import { ExternalLink, FileText, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getSignedFileUrl } from '@/lib/storage'
import {
  bucketForMaterialPath,
  toTopicMaterial,
  type TopicMaterial,
  type TopicMaterialItemRow,
} from '@/lib/topicMaterialItems'

/**
 * Решение задания рядом с работой ученика.
 *
 * Панель СПРАВОЧНАЯ и только для персонала. Три вещи, которые здесь важнее
 * оформления:
 *
 *  1. Она никогда не попадает в ленту страниц аннотатора. Пометки хранятся по
 *     паре «попытка + путь файла» и уходят ученику при вердикте — окажись
 *     решение среди этих страниц, ученик получил бы его вместе с проверкой.
 *  2. Топик передаёт сюда только преподавательский экран. Ученическому
 *     `TopicHomeworkStudent` этот проп не передаётся вовсе, так что показать
 *     решение ему нечем даже по ошибке.
 *  3. Скрытые материалы (`is_visible = false`) тоже показываются: решение
 *     обычно и лежит скрытым до разбора, в этом весь смысл раздела.
 */

export function useTopicSolutionMaterials(topicId: string | null | undefined) {
  const [materials, setMaterials] = useState<TopicMaterial[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!topicId) {
      setMaterials([])
      return
    }
    let cancelled = false
    setLoading(true)

    supabase
      .from('topic_material_items')
      .select('*')
      .eq('topic_id', topicId)
      .eq('section', 'solution')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []) as unknown as TopicMaterialItemRow[]
        setMaterials(rows.map(toTopicMaterial).filter((m): m is TopicMaterial => m !== null))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [topicId])

  return { materials, loading }
}

export function SolutionReferencePanel({
  topicId, materials, loading,
}: {
  topicId: string
  materials: TopicMaterial[]
  loading: boolean
}) {
  return (
    <aside
      data-testid="solution-reference-panel"
      className="flex max-h-64 min-h-0 shrink-0 flex-col overflow-hidden border-b border-slate-200 bg-white lg:max-h-none lg:w-96 lg:border-b-0 lg:border-r"
    >
      <div className="shrink-0 border-b border-slate-100 px-4 py-2.5">
        <p className="text-sm font-semibold text-gray-900">Решение задания</p>
        <p className="mt-0.5 text-xs text-gray-400">Только для вас — ученик этого не увидит</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            Загружаю решение…
          </div>
        ) : (
          materials.map(m => <SolutionItem key={m.id} material={m} topicId={topicId} />)
        )}
      </div>
    </aside>
  )
}

function SolutionItem({ material, topicId }: { material: TopicMaterial; topicId: string }) {
  return (
    <div className="space-y-1.5">
      {material.title && (
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{material.title}</p>
      )}

      {material.kind === 'text' && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{material.content}</p>
      )}

      {(material.kind === 'link' || material.kind === 'video') && (
        <a
          href={material.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:underline"
        >
          <ExternalLink size={13} />
          {material.url}
        </a>
      )}

      {material.kind === 'file' && (
        <SolutionFile
          storagePath={material.storagePath}
          fileName={material.fileName}
          topicId={topicId}
        />
      )}
    </div>
  )
}

/**
 * Картинку показываем сразу, PDF — встроенным просмотрщиком. Ссылку «открыть
 * отдельно» оставляем всегда: встроенный движок PDF в браузере иногда не
 * заводится, и без запасного пути преподаватель остался бы без решения.
 */
function SolutionFile({
  storagePath, fileName, topicId,
}: {
  storagePath: string
  fileName: string | null
  topicId: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const name = fileName ?? 'Файл решения'
  const lower = (fileName ?? storagePath).toLowerCase()
  const isImage = /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/.test(lower)
  const isPdf = lower.endsWith('.pdf')

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    getSignedFileUrl(bucketForMaterialPath(storagePath, topicId), storagePath)
      .then(signed => { if (!cancelled) setUrl(signed) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [storagePath, topicId])

  if (failed) {
    return <p className="text-xs text-red-600">Не удалось открыть «{name}»</p>
  }

  if (!url) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Loader2 size={12} className="animate-spin" />
        {name}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {isImage && (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt={name}
            className="w-full rounded-lg border border-gray-200 bg-white"
            loading="lazy"
          />
        </a>
      )}

      {isPdf && (
        <object data={url} type="application/pdf" className="h-72 w-full rounded-lg border border-gray-200 lg:h-96">
          <p className="p-3 text-xs text-gray-500">Встроенный просмотр недоступен — откройте файл отдельно.</p>
        </object>
      )}

      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-primary-600 hover:underline"
      >
        <FileText size={12} />
        {name}
      </a>
    </div>
  )
}
