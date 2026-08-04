import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, Loader2, AlertTriangle, RefreshCw, FileDown } from 'lucide-react'
import { VariantDocument } from './VariantDocument'
import { usePrintReady } from '@/hooks/usePrintReady'
import {
  loadVariantPrintSettings,
  saveVariantPrintSettings,
  type VariantPrintSettings,
} from '@/types/variantPrint'
import { buildVariantFileName, buildHumanPdfFileName, marginsToCss, fontSizeToCss, printContentHeightMm, buildKeyTable, type PrintableItem } from '@/utils/variantPrintUtils'

interface Props {
  items:         PrintableItem[]
  subject:       string
  examType:      string
  className?:    string
  /** Seeds the document title field when there is no saved title yet (e.g. the variant's own title). */
  initialTitle?: string
  /** Optional one-time overrides applied on top of stored settings for this panel instance. */
  initialSettingsOverride?: Partial<VariantPrintSettings>
  /** Hard overrides applied at render time; useful for student-safe PDF mode. */
  lockedSettings?: Partial<VariantPrintSettings>
  /** Hide the left settings column entirely (e.g. student direct-download flow). */
  hideSettingsPanel?: boolean
  /**
   * Слово перед заголовком в имени файла: «Подборка — №1 Кинематика.pdf».
   * Не подставляется, если заголовок уже начинается с него.
   */
  fileNamePrefix?: string
}

const DEBOUNCE_MS = 300

/**
 * Inline, embedded live PDF preview + settings panel for a test variant.
 * No route, no modal, no reload — appears as soon as `items` is non-empty.
 * Renders real A4 sheets scaled to fit the container while preserving
 * proportions, and drives window.print() via the same VariantDocument used
 * for the on-screen preview.
 */
export function VariantPrintPanel({
  items,
  subject,
  examType,
  className,
  initialTitle,
  initialSettingsOverride,
  lockedSettings,
  hideSettingsPanel = false,
  fileNamePrefix,
}: Props) {
  const [settings, setSettings] = useState<VariantPrintSettings>(() => {
    const loaded = loadVariantPrintSettings()
    const withTitle = loaded.title ? loaded : { ...loaded, title: initialTitle ?? loaded.title }
    return {
      ...withTitle,
      ...initialSettingsOverride,
      title: initialTitle ?? initialSettingsOverride?.title ?? withTitle.title,
    }
  })
  const [debouncedSettings, setDebouncedSettings] = useState(settings)
  const [printing, setPrinting] = useState(false)
  const [confirmedBroken, setConfirmedBroken] = useState(false)

  const effectiveSettings = useMemo(
    () => ({ ...debouncedSettings, ...lockedSettings }),
    [debouncedSettings, lockedSettings]
  )

  const printRef = useRef<HTMLDivElement>(null)
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // Debounce settings -> preview re-render
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSettings(settings), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [settings])

  // Persist to localStorage on every change (cheap, debounce not required for storage)
  useEffect(() => {
    saveVariantPrintSettings(settings)
  }, [settings])

  const { ready, total, loaded, broken, timedOut, recheck } = usePrintReady(
    printRef,
    [effectiveSettings, items.length],
  )

  // Scale A4 sheet to container width
  useEffect(() => {
    function updateScale() {
      const el = previewWrapRef.current
      if (!el) return
      const A4_WIDTH = effectiveSettings.orientation === 'landscape' ? 1123 : 794
      const available = el.clientWidth - 32
      setScale(Math.min(1, Math.max(0.3, available / A4_WIDTH)))
    }
    updateScale()
    const ro = new ResizeObserver(updateScale)
    if (previewWrapRef.current) ro.observe(previewWrapRef.current)
    return () => ro.disconnect()
  }, [effectiveSettings.orientation])

  useEffect(() => {
    function onAfterPrint() { setPrinting(false) }
    window.addEventListener('afterprint', onAfterPrint)
    return () => window.removeEventListener('afterprint', onAfterPrint)
  }, [])

  // Keep --print-margins/--print-font-size in sync with settings at all
  // times, not just inside handlePrint() right before printing. Previously
  // these were only set on click, so any PDF generated without first
  // clicking "Печать" (and the live preview's own use of the print CSS
  // cascade) fell back to the :root defaults regardless of the actual
  // margins/font-size setting — the real, root cause of preview/PDF drift.
  useEffect(() => {
    document.documentElement.style.setProperty('--print-margins', marginsToCss(effectiveSettings.margins))
    document.documentElement.style.setProperty('--print-font-size', fontSizeToCss(effectiveSettings.fontSize))
    // Worksheet mode's ruled-grid field needs to know exactly how tall the
    // printable page area is (page height minus top+bottom margins) so it
    // can stretch to the bottom margin instead of a guessed fixed height.
    document.documentElement.style.setProperty(
      '--print-content-height',
      `${printContentHeightMm(effectiveSettings.orientation, effectiveSettings.margins)}mm`,
    )
  }, [effectiveSettings.margins, effectiveSettings.fontSize, effectiveSettings.orientation])

  const canPrint = ready || confirmedBroken
  const isLoading = !ready && !timedOut && !confirmedBroken && total > 0
  const hasBroken = broken.length > 0

  // Имя, которое браузер предложит в «Сохранить как PDF»: берётся из
  // document.title (см. handlePrint). Человеческий заголовок документа
  // читается лучше слага, поэтому слаг остаётся запасным — на случай, когда
  // заголовок пуст.
  const fileName = useMemo(
    () =>
      buildHumanPdfFileName(effectiveSettings.title, {
        prefix: fileNamePrefix,
        variantNumber: effectiveSettings.variantNumber,
      }) ?? buildVariantFileName(subject, examType, effectiveSettings.variantNumber),
    [subject, examType, effectiveSettings.title, effectiveSettings.variantNumber, fileNamePrefix],
  )

  const isWorksheet = effectiveSettings.mode === 'worksheet'

  // Key table rows are computed once from the full item set regardless of
  // how the preview splits into sheets below. Worksheet mode never shows a
  // key, regardless of the stored showKey toggle (see VariantDocument).
  const previewKeyRows = useMemo(
    () => (!isWorksheet && effectiveSettings.showKey ? buildKeyTable(items) : []),
    [isWorksheet, effectiveSettings.showKey, items],
  )

  // Worksheet mode is the only mode that guarantees "one task = exactly one
  // page". Standard onePerPage merely inserts a page break *before* each
  // task, but the task itself (especially with long explanations/answers)
  // may still span multiple pages. Splitting the live preview into one fixed
  // A4 box per task in that mode caused long explanation blocks to overflow,
  // overlap and appear cropped on screen. Keep the preview as one continuous
  // document there; the actual print CSS still applies the correct breaks.
  const previewPages = useMemo(() => {
    if (!isWorksheet) {
      return [{ items, startIndex: 0, showTitleBlock: true, showKeyTable: true, hideEmptyMessage: false }]
    }

    // Worksheet mode: task 0's sheet also carries the header/title block —
    // same shape VariantDocument expects, since it renders that block as
    // task 0's own first flex child in worksheet mode.
    const pages = items.map((item, idx) => ({
      items:            [item],
      startIndex:       idx,
      showTitleBlock:   idx === 0,
      showKeyTable:     false,
      hideEmptyMessage: false,
    }))
    // Worksheet mode never shows a key table (see effShowKey in
    // VariantDocument), so this trailing sheet only applies to standard mode.
    if (!isWorksheet && previewKeyRows.length > 0) {
      pages.push({ items: [], startIndex: items.length, showTitleBlock: false, showKeyTable: true, hideEmptyMessage: true })
    }
    return pages
  }, [items, isWorksheet, previewKeyRows])

  function patch<K extends keyof VariantPrintSettings>(key: K, val: VariantPrintSettings[K]) {
    setSettings(s => ({ ...s, [key]: val }))
  }

  function handlePrint() {
    if (!canPrint) return
    setPrinting(true)

    // --print-margins/--print-font-size are kept in sync continuously by
    // the effect above — no need to set them here too.

    // @page size cannot be scoped by a class selector, so orientation is
    // switched by injecting/removing a dedicated <style> tag right before
    // printing instead.
    const ORIENTATION_STYLE_ID = 'print-orientation-override'
    document.getElementById(ORIENTATION_STYLE_ID)?.remove()
    if (effectiveSettings.orientation === 'landscape') {
      const style = document.createElement('style')
      style.id = ORIENTATION_STYLE_ID
      style.media = 'print'
      style.textContent = '@page { size: A4 landscape; }'
      document.head.appendChild(style)
    }

    const prevTitle = document.title
    document.title = fileName.replace(/\.pdf$/, '')
    setTimeout(() => {
      window.print()
      document.title = prevTitle
    }, 80)
  }

  if (items.length === 0) {
    return null
  }

  return (
    <div className={className}>
      {/* Print portal rendered outside #root — @media print sets #root to
          display:none, which would hide any descendant regardless of its
          own display value, so the print target must live in document.body. */}
      {createPortal(
        <div className="print-portal-wrapper" aria-hidden="true">
          <VariantDocument ref={printRef} items={items} settings={effectiveSettings} />
        </div>,
        document.body,
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Settings */}
        {!hideSettingsPanel && (
          <div className="space-y-5 lg:w-80 flex-shrink-0">
            <SettingsPanel settings={settings} patch={patch} />
          </div>
        )}

        {/* Live preview */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <StatusBar
              isLoading={isLoading}
              hasBroken={hasBroken}
              confirmedBroken={confirmedBroken}
              total={total}
              loaded={loaded}
              broken={broken.length}
              onRecheck={recheck}
            />
            <button
              onClick={handlePrint}
              disabled={!canPrint || printing}
              title={isLoading ? 'Дождитесь загрузки изображений' : fileName}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium
                hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {printing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Подготовка PDF…</>
              ) : (
                <><Printer className="w-4 h-4" /> Печать / Сохранить PDF</>
              )}
            </button>
          </div>

          {/* Диалог печати — не загрузка: файл сохраняет сам браузер, и в
              списке загрузок он не появляется. Раньше это выглядело как
              «PDF пропал», поэтому имя файла и место сохранения названы прямо. */}
          <p className="mb-3 text-xs text-gray-500">
            Откроется диалог печати браузера — выберите «Сохранить как PDF».
            Имя файла: <span className="font-medium text-gray-700">{fileName}</span>.
            Такой файл сохраняется мимо списка загрузок — там его не ищите.
          </p>

          {timedOut && !confirmedBroken ? (
            <TimeoutNotice
              total={total} loaded={loaded} broken={broken.length}
              onRecheck={recheck}
              onConfirm={() => setConfirmedBroken(true)}
            />
          ) : (
            <div
              ref={previewWrapRef}
              className="overflow-auto bg-gray-200 rounded-xl p-4 max-h-[75vh] flex flex-col items-center gap-4"
            >
              {previewPages.map((page, i) => (
                <div
                  key={i}
                  style={{
                    width: (effectiveSettings.orientation === 'landscape' ? 1123 : 794) * scale,
                    height: (effectiveSettings.orientation === 'landscape' ? 794 : 1123) * scale,
                    flexShrink: 0,
                  }}
                >
                  <div
                    className="print-preview-page"
                    style={{
                      width: effectiveSettings.orientation === 'landscape' ? 1123 : 794,
                      minHeight: effectiveSettings.orientation === 'landscape' ? 794 : 1123,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                      fontSize: fontSizeToCss(effectiveSettings.fontSize),
                      // Same helper the real @page margin uses — previously
                      // this was a hardcoded "56px 48px" regardless of the
                      // margins setting, so "Увеличенные" changed the actual
                      // PDF but not what the preview showed.
                      padding: marginsToCss(effectiveSettings.margins),
                    }}
                  >
                    <VariantDocument
                      items={page.items}
                      settings={effectiveSettings}
                      startIndex={page.startIndex}
                      showTitleBlock={page.showTitleBlock}
                      showKeyTable={page.showKeyTable}
                      keyRows={previewKeyRows}
                      hideEmptyMessage={page.hideEmptyMessage}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Settings panel ───────────────────────────────────────────────────────────

function SettingsPanel({
  settings,
  patch,
}: {
  settings: VariantPrintSettings
  patch: <K extends keyof VariantPrintSettings>(key: K, val: VariantPrintSettings[K]) => void
}) {
  const isWorksheet = settings.mode === 'worksheet'

  return (
    <div className="space-y-5">
      <Section label="Режим">
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={!isWorksheet}
            label="Обычный вариант"
            onClick={() => patch('mode', 'standard')}
          />
          <ModeButton
            active={isWorksheet}
            label="Рабочий лист"
            onClick={() => patch('mode', 'worksheet')}
          />
        </div>
        {isWorksheet && (
          <p className="text-xs text-gray-500 leading-snug pt-1">
            Только условия, по одному заданию на страницу, ниже — поле в клетку
            до конца страницы. Решения, ответы и ключ не показываются.
          </p>
        )}
      </Section>

      <Section label="Документ">
        <Field label="Заголовок">
          <input
            type="text"
            value={settings.title}
            onChange={e => patch('title', e.target.value)}
            placeholder="Например: Тренировочный вариант"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </Field>
        <Field label="Колонтитул (слева)">
          <input
            type="text"
            value={settings.headerLeft}
            onChange={e => patch('headerLeft', e.target.value)}
            placeholder="School Almiron — физика"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </Field>
        <Field label="№ варианта">
          <input
            type="text"
            value={settings.variantNumber ?? ''}
            onChange={e => patch('variantNumber', e.target.value)}
            placeholder="57189903"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </Field>
        <Field label="Комментарий">
          <textarea
            value={settings.comment ?? ''}
            onChange={e => patch('comment', e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </Field>
        <Field label="Инструкция">
          <textarea
            value={settings.instruction ?? ''}
            onChange={e => patch('instruction', e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </Field>
      </Section>

      <Section label="Содержание">
        <Toggle checked={settings.showNumbers} label="Номера заданий" onChange={v => patch('showNumbers', v)} />
        <Toggle checked={!isWorksheet && settings.showExplanations} disabled={isWorksheet} label="Пояснения" onChange={v => patch('showExplanations', v)} />
        <Toggle checked={!isWorksheet && settings.showAnswers} disabled={isWorksheet} label="Ответы" onChange={v => patch('showAnswers', v)} />
        <Toggle checked={!isWorksheet && settings.showKey} disabled={isWorksheet} label="Ключ (таблица ответов)" onChange={v => patch('showKey', v)} />
        <Toggle checked={settings.showSource} label="Источник" onChange={v => patch('showSource', v)} />
        <Toggle checked={settings.showCodifierSection} label="Раздел кодификатора" onChange={v => patch('showCodifierSection', v)} />
      </Section>

      <Section label="Разметка">
        <Toggle
          checked={isWorksheet || settings.onePerPage}
          disabled={isWorksheet}
          label="Каждое задание с новой страницы"
          onChange={v => patch('onePerPage', v)}
        />

        <div className="grid grid-cols-2 gap-2 pt-1">
          <SelectField
            label="Ориентация"
            value={settings.orientation}
            onChange={v => patch('orientation', v as VariantPrintSettings['orientation'])}
            options={[['portrait', 'Книжная'], ['landscape', 'Альбомная']]}
          />
          <SelectField
            label="Шрифт"
            value={settings.fontSize}
            onChange={v => patch('fontSize', v as VariantPrintSettings['fontSize'])}
            options={[['normal', 'Обычный'], ['large', 'Крупный']]}
          />
          <SelectField
            label="Поля"
            value={settings.margins}
            onChange={v => patch('margins', v as VariantPrintSettings['margins'])}
            options={[['normal', 'Обычные'], ['wide', 'Широкие']]}
          />
        </div>
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">{label}</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  )
}

function SelectField({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-600 mb-1">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function Toggle({
  checked, label, onChange, disabled = false,
}: {
  checked: boolean
  label: string
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center gap-2 group ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
      />
      <span className="text-sm text-gray-700 group-hover:text-gray-900 leading-tight">{label}</span>
    </label>
  )
}

function ModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
        active
          ? 'bg-blue-600 border-blue-600 text-white'
          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )
}

// ── Status bar / timeout ─────────────────────────────────────────────────────

function StatusBar({
  isLoading, hasBroken, confirmedBroken, total, loaded, broken, onRecheck,
}: {
  isLoading: boolean
  hasBroken: boolean
  confirmedBroken: boolean
  total: number
  loaded: number
  broken: number
  onRecheck: () => void
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
      isLoading ? 'bg-blue-50 text-blue-700'
      : hasBroken ? 'bg-amber-50 text-amber-800'
      : 'bg-green-50 text-green-700'
    }`}>
      {isLoading ? (
        <><Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /><span>Загрузка изображений… {loaded} / {total}</span></>
      ) : hasBroken ? (
        <>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{broken} изображение(й) недоступно. {confirmedBroken ? 'Продолжение подтверждено.' : ''}</span>
          {!confirmedBroken && (
            <button onClick={onRecheck} className="flex items-center gap-1 underline underline-offset-2">
              <RefreshCw className="w-3.5 h-3.5" /> Повторить
            </button>
          )}
        </>
      ) : (
        <span className="flex items-center gap-1.5"><FileDown className="w-4 h-4" /> {total > 0 ? `Готово: ${total} изображений загружено` : 'Готово к печати'}</span>
      )}
    </div>
  )
}

function TimeoutNotice({
  total, loaded, broken, onRecheck, onConfirm,
}: {
  total: number
  loaded: number
  broken: number
  onRecheck: () => void
  onConfirm: () => void
}) {
  const stillPending = total - loaded
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 text-amber-800 font-medium">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        <span>Время ожидания изображений истекло</span>
      </div>
      <p className="text-sm text-amber-700">
        {stillPending > 0
          ? `Не загружено: ${stillPending} изображений (из ${total}).`
          : `Загружено ${loaded} из ${total}, часть может быть повреждена.`}
        {broken > 0 && ` Повреждено: ${broken}.`}
      </p>
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <button onClick={onRecheck} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-amber-300 text-amber-800 text-sm font-medium hover:bg-amber-50 transition-colors">
          <RefreshCw className="w-4 h-4" /> Повторить загрузку
        </button>
        <button onClick={onConfirm} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors">
          <Printer className="w-4 h-4" /> Продолжить без недоступных изображений
        </button>
      </div>
    </div>
  )
}
