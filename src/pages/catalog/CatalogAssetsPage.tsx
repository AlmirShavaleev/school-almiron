import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, ClipboardList, Copy, FolderOpen, Images, Loader2, RefreshCw, Upload, X,
} from 'lucide-react'
import {
  CATALOG_ASSETS_BUCKET,
  CATALOG_ASSET_ACCEPT,
  CATALOG_ASSET_FOLDER_EXAMPLE,
  CATALOG_ASSET_FOLDER_STORAGE_KEY,
  CATALOG_ASSET_FORMATS_HUMAN,
  CATALOG_ASSET_STATUS_LABEL,
  CATALOG_ASSET_STATUS_TONE,
  buildCatalogAssetPath,
  catalogAssetProblem,
  copyablePaths,
  normalizeAssetFolder,
  type CatalogAssetUploadResult,
} from '@/lib/catalogAssets'
import { formatBytes } from '@/lib/topicHomework'
import { formatUpdatedAt } from '@/utils/format'
import { plural } from '@/lib/plural'
import { uploadCatalogAsset, useCatalogAssetFolder } from '@/hooks/useCatalogAssets'
import { toast } from '@/store/toastStore'

/**
 * «Картинки каталога» — заливка файлов в бакет `catalog-assets` из браузера
 * (§195).
 *
 * До этого экрана картинка авторской задачи попадала в бакет так: подагент
 * перепечатывал base64 в SQL, строка ехала в базу текстом, разовая
 * edge-функция раскладывала её по бакету. Три картинки стоили 2,3 часа и 480
 * тысяч токенов, и часть кусков приехала битой. Глава «Кинематика» — это
 * десятки картинок, то есть тем же путём она не поедет вовсе.
 *
 * Экран занимается РОВНО файлами. Строки `catalog_task_assets` он не пишет и
 * писать не будет: связь «задача ↔ картинка» знает тот, кто собирает задачу, а
 * экран, который пишет половину связи, оставляет в базе полуправду, которую
 * потом ищут руками. Поэтому итог работы здесь — список готовых
 * `storage_path`, который человек забирает кнопкой и вставляет в импортёр.
 */
export function CatalogAssetsPage() {
  // Последняя папка переживает перезагрузку: пачку картинок главы льют в
  // несколько заходов, и набирать `physics-ege/author-kinematics` заново
  // каждый раз — это опечатка, а опечатка здесь означает потерянные файлы в
  // папке-призраке.
  const [folder, setFolder] = useState<string>(() => {
    try { return localStorage.getItem(CATALOG_ASSET_FOLDER_STORAGE_KEY) ?? '' } catch { return '' }
  })
  useEffect(() => {
    try { localStorage.setItem(CATALOG_ASSET_FOLDER_STORAGE_KEY, folder) } catch { /* приватный режим */ }
  }, [folder])

  const [picked,    setPicked]    = useState<File[]>([])
  const [overwrite, setOverwrite] = useState(false)
  const [results,   setResults]   = useState<CatalogAssetUploadResult[]>([])
  const [progress,  setProgress]  = useState<{ done: number; total: number } | null>(null)
  const [dragOver,  setDragOver]  = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const normalizedFolder = normalizeAssetFolder(folder)
  const listing = useCatalogAssetFolder(folder)

  // Отбор по типу и размеру делается СРАЗУ при выборе, а не в момент заливки:
  // пачку из двадцати файлов человек должен увидеть разобранной прежде, чем
  // нажмёт кнопку, иначе он узнает про негодный файл через сорок секунд.
  const checked = useMemo(
    () => picked.map(file => ({ file, problem: catalogAssetProblem(file) })),
    [picked],
  )
  const accepted = useMemo(() => checked.filter(c => !c.problem).map(c => c.file), [checked])
  const rejected = useMemo(() => checked.filter(c => c.problem), [checked])

  const uploading = progress != null

  const addFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return
    setPicked(prev => {
      const seen = new Set(prev.map(f => `${f.name}:${f.size}`))
      return [...prev, ...incoming.filter(f => !seen.has(`${f.name}:${f.size}`))]
    })
    if (fileInput.current) fileInput.current.value = ''
  }, [])

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    addFiles([...(e.dataTransfer?.files ?? [])])
  }

  /**
   * Заливка по одному файлу, а не `Promise.all`: счётчик «N из M» должен быть
   * правдой, а не анимацией, и при отказе на середине видно, что уже лежит в
   * бакете, а что нет.
   */
  async function handleUpload() {
    if (accepted.length === 0 || uploading) return
    setResults([])
    setProgress({ done: 0, total: accepted.length })
    const done: CatalogAssetUploadResult[] = []
    for (const file of accepted) {
      const result = await uploadCatalogAsset(folder, file, overwrite)
      done.push(result)
      setResults([...done])
      setProgress({ done: done.length, total: accepted.length })
    }
    setProgress(null)
    setPicked([])
    listing.reload()

    const failed = done.filter(r => r.status === 'failed').length
    if (failed > 0) toast.error(`Не загрузилось: ${failed} ${plural(failed, 'файл', 'файла', 'файлов')}`)
    else toast.success(`Загружено: ${done.length} ${plural(done.length, 'файл', 'файла', 'файлов')}`)
  }

  async function handleCopyPaths() {
    const paths = copyablePaths(results)
    if (paths.length === 0) return
    try {
      await navigator.clipboard.writeText(paths.join('\n'))
      toast.saved('Пути скопированы')
    } catch {
      toast.error('Браузер не дал доступ к буферу — скопируйте пути из списка вручную')
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Images size={22} className="text-primary-600" />
            <h1 className="text-xl font-bold text-gray-900">Картинки каталога</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Заливка файлов в бакет <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{CATALOG_ASSETS_BUCKET}</code>.
            Строки <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">catalog_task_assets</code> экран не пишет — он про файлы.
          </p>
        </div>
        <Link
          to="/catalog"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 transition-colors hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700"
        >
          <ClipboardList size={16} />
          В каталог
        </Link>
      </div>

      {/* Форма загрузки */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div>
          <label htmlFor="catalog-assets-folder" className="block text-sm font-medium text-gray-700 mb-1">
            Папка в бакете
          </label>
          <input
            id="catalog-assets-folder"
            data-testid="catalog-assets-folder"
            value={folder}
            onChange={e => setFolder(e.target.value)}
            placeholder={CATALOG_ASSET_FOLDER_EXAMPLE}
            spellCheck={false}
            autoComplete="off"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-800
                       focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
          />
          <p className="text-xs text-gray-400 mt-1">
            Без имени файла и без слешей по краям — например{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded">{CATALOG_ASSET_FOLDER_EXAMPLE}</code>.
          </p>
          {normalizedFolder
            ? normalizedFolder !== folder && (
                <p className="text-xs text-amber-700 mt-1" data-testid="catalog-assets-folder-normalized">
                  Путь будет <code className="bg-amber-50 px-1 py-0.5 rounded">{normalizedFolder}/…</code>
                </p>
              )
            : (
              <p className="text-xs text-amber-700 mt-1" data-testid="catalog-assets-folder-root">
                Папка не указана — файлы лягут в корень бакета.
              </p>
            )}
        </div>

        {/* Выбор файлов: кнопка и перетаскивание — один и тот же путь внутрь */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          data-testid="catalog-assets-dropzone"
          className={`rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
            dragOver ? 'border-primary-400 bg-primary-50/60' : 'border-gray-200 bg-gray-50/60'
          }`}
        >
          <FolderOpen size={26} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-600">Перетащите файлы сюда</p>
          <p className="text-xs text-gray-400 mt-1">{CATALOG_ASSET_FORMATS_HUMAN}, до 5 МБ каждый</p>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white
                       text-sm font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
          >
            <Upload size={16} />
            Выбрать файлы
          </button>
          <input
            ref={fileInput}
            data-testid="catalog-assets-input"
            type="file"
            multiple
            accept={CATALOG_ASSET_ACCEPT}
            className="hidden"
            onChange={e => addFiles([...(e.target.files ?? [])])}
          />
        </div>

        {checked.length > 0 && (
          <ul className="space-y-1" data-testid="catalog-assets-picked">
            {checked.map(({ file, problem }) => (
              <li
                key={`${file.name}:${file.size}`}
                className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                  problem ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium break-all">{file.name}</span>
                    <span className="text-xs text-gray-400">{formatBytes(file.size)}</span>
                  </div>
                  {problem
                    ? <p className="text-xs mt-0.5">{problem}</p>
                    : <p className="text-xs text-gray-400 mt-0.5 break-all">{buildCatalogAssetPath(folder, file.name)}</p>}
                </div>
                <button
                  type="button"
                  aria-label={`Убрать ${file.name}`}
                  onClick={() => setPicked(prev => prev.filter(f => !(f.name === file.name && f.size === file.size)))}
                  className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 transition-colors"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-600 select-none">
            <input
              type="checkbox"
              data-testid="catalog-assets-overwrite"
              checked={overwrite}
              onChange={e => setOverwrite(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            Перезаписывать существующие
          </label>

          <div className="flex items-center gap-3">
            {progress && (
              <span className="text-sm text-gray-500" data-testid="catalog-assets-progress">
                {progress.done} из {progress.total}
              </span>
            )}
            <button
              type="button"
              data-testid="catalog-assets-upload"
              onClick={handleUpload}
              disabled={accepted.length === 0 || uploading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium
                         hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading
                ? 'Загружаю…'
                : `Загрузить${accepted.length > 0 ? ` (${accepted.length})` : ''}`}
            </button>
          </div>
        </div>

        {rejected.length > 0 && (
          <p className="text-xs text-red-700" data-testid="catalog-assets-rejected-summary">
            {rejected.length} {plural(rejected.length, 'файл', 'файла', 'файлов')} не поедет в бакет — их не грузим.
          </p>
        )}
      </div>

      {/* Итог заливки */}
      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-testid="catalog-assets-results">
          <h2 className="text-sm font-bold text-gray-900">Результат</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400">
                  <th className="font-medium pb-1 pr-3">Файл</th>
                  <th className="font-medium pb-1 pr-3">Путь в бакете</th>
                  <th className="font-medium pb-1 pr-3 whitespace-nowrap">Размер</th>
                  <th className="font-medium pb-1">Результат</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr
                    key={r.path}
                    data-testid="catalog-assets-result-row"
                    className={`border-t border-gray-100 align-top ${r.status === 'failed' ? 'bg-red-50' : ''}`}
                  >
                    <td className="py-1.5 pr-3 text-gray-700 break-all">{r.fileName}</td>
                    <td className="py-1.5 pr-3 text-gray-500 break-all font-mono text-xs">{r.path}</td>
                    <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{formatBytes(r.size)}</td>
                    <td className={`py-1.5 ${CATALOG_ASSET_STATUS_TONE[r.status]}`}>
                      {CATALOG_ASSET_STATUS_LABEL[r.status]}
                      {r.detail && <div className="text-xs mt-0.5 break-words">{r.detail}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Готовый кусок для того, кто собирает задачи */}
          {copyablePaths(results).length > 0 && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-gray-500">
                  Пути для <code className="bg-white px-1 py-0.5 rounded border border-gray-200">catalog_task_assets</code>
                </span>
                <button
                  type="button"
                  data-testid="catalog-assets-copy"
                  onClick={handleCopyPaths}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white
                             text-xs font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
                >
                  <Copy size={13} />
                  Скопировать пути
                </button>
              </div>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all font-mono">
                {copyablePaths(results).join('\n')}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Что уже лежит в папке */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-testid="catalog-assets-listing">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-gray-900">
            В папке {normalizedFolder ? <code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-normal">{normalizedFolder}</code> : 'в корне бакета'}
          </h2>
          <button
            type="button"
            onClick={listing.reload}
            aria-label="Обновить список"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {listing.loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={22} className="animate-spin text-primary-600" />
          </div>
        ) : listing.error ? (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="break-words">{listing.error}</span>
          </div>
        ) : listing.objects.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">
            Тут пока пусто — ни одного файла по этому пути.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {listing.objects.map(o => (
              <li key={o.name} data-testid="catalog-assets-listing-row" className="py-2 flex items-center gap-3 text-sm">
                <span className="flex-1 min-w-0 text-gray-700 break-all">{o.name}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">{formatBytes(o.size) ?? '—'}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {o.updatedAt ? formatUpdatedAt(o.updatedAt) : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Удаления здесь нет намеренно: политика бакета его разрешает, но
            случайно снесённая картинка ломает задачу в каталоге молча — на
            странице задачи остаётся битая ссылка, и никто об этом не узнает. */}
        <p className="text-xs text-gray-400">
          Удаления на этом экране нет: снесённая картинка ломает задачу каталога молча.
        </p>
      </div>
    </div>
  )
}
