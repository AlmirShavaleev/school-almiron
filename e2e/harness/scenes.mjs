import { D227, D228, D229, D252, D258, D259, D260, IDS, KR, LESSON, LIVE, SANDBOX } from './fixtures.mjs'
const S = IDS
const cart = JSON.stringify({ state: { items: Array.from({ length: 7 }, (_, k) => ({ catalog_task_id: S.task(k + 1), added_at: '2026-09-12T08:00:00.000Z' })) }, version: 0 })
// §195: папка, в которую сцены каталожных картинок льют файлы. Ровно тот
// формат, что ждёт импортёр задач, — он же стоит подсказкой в самом поле.
const CATALOG_ASSETS_FOLDER = 'physics-ege/author-kinematics'

// §186: панель ИИ живёт в футере под работой — до неё надо доскроллить, иначе
// на снимке будут только страницы работы.
const toAiPanel = `document.querySelector('[data-testid="ai-check-panel"]')?.scrollIntoView({ block: 'start' })`
// §207: строка про отброшенные находки и оба абзаца пояснений ушли под знак
// вопроса в заголовке блока — снимаем его раскрытым.
const openAiHint = `(() => { const b = document.querySelector('[data-testid="ai-check-hint-toggle"]'); b?.click(); b?.scrollIntoView({ block: 'center' }) })()`
// §212: счётчик-фильтр. Оставляем в списке только неверные.
const filterWrong = `(() => { const b = document.querySelector('[data-testid="review-tasks-filter-wrong"]'); b?.click(); document.querySelector('[data-testid="ai-check-tasks"]')?.scrollIntoView({ block: 'start' }) })()`
// §218: пробник по номерам. Пример владельца из макета — «нарочно с
// подвохами»: «Елкина» через «е», двое Ивановых, лишние пробелы, ученик не с
// этого курса и балл выше максимума. Вставляется в клетку столбца «Ученик»
// настоящим событием paste — тем же, что даёт Ctrl + V.
const MOCK_SAMPLE = [
  'Абрамова Д.\t1\t1\t1\t0\t1\t1\t1\t1\t0\t1\t1\t1\t2\t1\t2\t0\t1\t0\t0',
  'Белов Артём\t1\t1\t1\t1\t1\t1\t0\t1\t1\t1\t1\t1\t1\t2\t1\t1\t0\t1\t0',
  'Елкина Мария\t1\t1\t0\t1\t1\t1\t1\t1\t1\t0\t1\t1\t2\t3\t2\t2\t1\t2\t1',
  'Иванов К.\t1\t1\t1\t1\t0\t1\t1\t0\t1\t1\t1\t0\t0\t1\t0\t1\t0\t0\t0',
  'Иванов\t1\t0\t1\t1\t1\t1\t1\t1\t1\t1\t0\t1\t2\t2\t1\t1\t1\t0\t0',
  'Петров Олег\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t2\t3\t2\t2\t3\t4\t4',
  '  Сафин   Амир \t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t2\t4\t2\t2\t2\t1\t1',
].join('\n')
const pasteMockSample = `(() => {
  const td = document.querySelector('[data-testid="mock-grid-name"]')
  if (!td) return
  td.focus()
  const dt = new DataTransfer()
  dt.setData('text/plain', ${JSON.stringify(MOCK_SAMPLE)})
  td.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})()`
const toMockReport = `document.querySelector('[data-testid="mock-grid-report"]')?.scrollIntoView({ block: 'start' })`
// §219. Прокрутка таблицы вправо до столбца «Ученику» (на 390 он не
// закреплён) и к полосе «Уведомить всех» под таблицей.
const toMockNotifyCol = `(() => {
  const sc = document.querySelector('[data-testid="mock-grid-scroll"]')
  if (sc) sc.scrollLeft = sc.scrollWidth
})()`
const toMockNotifyBar = `document.querySelector('[data-testid="mock-grid-notify-bar"]')?.scrollIntoView({ block: 'center' })`
// «Уведомить» у Абрамовой — первая строка, итог не отправлялся.
const clickFirstNotify = `(() => {
  const b = [...document.querySelectorAll('[data-testid="mock-grid-notify"]')].find(x => !x.disabled)
  b?.click()
})()`
// Красная клетка: Абрамова, №14 = 4 при максимуме 3 — и «Сохранить».
const typeMockOver = `(() => {
  const input = document.getElementById('mx-c-0-13')
  if (!input) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '4')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  document.querySelector('[data-testid="mock-grid-save"]')?.click()
  window.scrollTo(0, 0)
})()`
// §214 (board/066): включённый фильтр «не решено» — пятый счётчик в полосе.
const filterUnsolved = `(() => { const b = document.querySelector('[data-testid="review-tasks-filter-unsolved"]'); b?.click(); document.querySelector('[data-testid="ai-check-tasks"]')?.scrollIntoView({ block: 'start' }) })()`
// §214: открытый список вердиктов — в нём должно быть видно все пять.
const openVerdictMenu = `(() => { const row = document.querySelector('[data-testid="review-task-row"][data-verdict="unsolved"]') ?? document.querySelector('[data-testid="review-task-row"]'); row?.scrollIntoView({ block: 'center' }); row?.querySelector('[data-testid="review-task-verdict"]')?.click() })()`
// §212: список статусов открывается кликом по кружку и живёт в body —
// прокрутка колонки его не обрезает. Берём кружок НИЖНЕЙ видимой строки:
// именно там обрезание и было видно.
const toLastRow = `(() => { const rows = [...document.querySelectorAll('[data-testid="review-task-row"]')]; rows[rows.length - 1]?.scrollIntoView({ block: 'center' }) })()`
const openStatusPicker = `(() => { const rows = [...document.querySelectorAll('[data-testid="review-task-row"]')]; rows[rows.length - 1]?.querySelector('[data-testid="review-task-verdict"]')?.click() })()`
// §212: правка замечания — клик по самому тексту.
const editFirstNote = `(() => { const el = document.querySelector('[data-testid="review-task-note-text"]'); el?.scrollIntoView({ block: 'center' }); el?.click() })()`
const openSecondAttempt = `[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Проверить')[1]?.click()`
// §199: таблица проверки — то, ради чего панель теперь открывают.
const toReviewTasks = `(document.querySelector('[data-testid="ai-check-tasks"]') ?? document.querySelector('[data-testid="ai-check-panel"]'))?.scrollIntoView({ block: 'start' })`
// §199: заметка разворачивается по фокусу — снимаем развёрнутой.
const openFirstNote = `(() => { const el = document.querySelector('[data-testid="review-task-row"][data-verdict="wrong"] [data-testid="review-task-note"]'); el?.focus(); el?.scrollIntoView({ block: 'center' }) })()`
// §204: отметка «Просмотрено» стоит под плеером — до неё надо доскроллить;
// если её нет (видео не досмотрено), показываем сам плеер.
const toWatchBadge = `(document.querySelector('[data-testid="video-watched-badge"]') ?? document.querySelector('iframe[title="Видео темы"]'))?.scrollIntoView({ block: 'center' })`
// §199: блок «По заданиям» в разборе работы у ученика.
const toStudentTasks = `document.querySelector('[data-testid="student-review-tasks"]')?.scrollIntoView({ block: 'center' })`
// §209: предложение ИИ и спор вердикта с замечанием — оба под своей строкой.
const toSuggestion = `document.querySelector('[data-testid="ai-finding-suggestion"]')?.scrollIntoView({ block: 'center' })`
const toConflict = `document.querySelector('[data-testid="review-task-row"][data-conflict="true"]')?.scrollIntoView({ block: 'center' })`
const toFirstPage = `document.querySelector('[data-testid="review-page-1"]')?.scrollIntoView({ block: 'center' })`
// §202 (board/054): печатный лист прокручивается к МЕЛКОЙ иллюстрации — рядом с
// ней на листе стоит задача с крупным чертежом, на этой паре и видно полосу
// ширин. Прокрутка по элементу, а не по пикселю: высота листа зависит как раз
// от правила, которое проверяем.
const toSmallFigure = `document.querySelector('.print-document img[alt*="мелкий"]')?.scrollIntoView({ block: 'center' })`
// §205 (board/056): печатный лист с формулами. Прокрутка по элементу, а не по
// пикселю — высота листа зависит ровно от правила, которое проверяем.
const toPrintTop = `document.querySelector('.print-document img.math-display')?.scrollIntoView({ block: 'center' })`
const toShortSystem = `document.querySelector('.print-document img[alt*="система и три"]')?.scrollIntoView({ block: 'center' })`
// §208 (board/059): поле комментария стоит в форме вердикта внизу колонки
// документа — до него надо доскроллить, иначе на снимке страницы работы.
const toCommentBox = `document.querySelector('[data-testid="review-comment-input"]')?.scrollIntoView({ block: 'center' })`
// §208: граница колонок — ползунок, и двигаем мы её так же, как человек без
// мыши: стрелками с клавиатуры. Шесть шагов по 2 % = с 40 % до 52 %.
const moveSplitRight = `(() => { const h = document.querySelector('[data-testid="solution-split-handle"]'); if (!h) return; h.focus(); for (let i = 0; i < 6; i += 1) h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })()`
// §210: вторая граница — между работой и таблицей проверки. Двигаем тоже с
// клавиатуры: шесть шагов влево = таблица с 37 % до 49 %.
const moveReviewSplitLeft = `(() => { const h = document.querySelector('[data-testid="review-split-handle"]'); if (!h) return; h.focus(); for (let i = 0; i < 6; i += 1) h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })()`
// §210/§211: прокрутка ТОЛЬКО третьей колонки. Если колонки общие, вместе с
// ней уедет и работа — на снимке это видно сразу. С §211 прокручивается вся
// колонка целиком (форма вердикта вернулась в поток, за таблицу), поэтому и
// свиток теперь колонкин, а не таблицын.
const scrollTableDown = `(() => { const el = document.querySelector('[data-testid="review-side-scroll-area"]') ?? document.querySelector('[data-testid="review-document-scroll-area"]'); if (el) el.scrollTop = el.scrollHeight })()`
// §213 (board/064): кнопка «Переписать по таблице» стоит у поля комментария —
// это низ третьей колонки, до него надо домотать.
const toRewriteButton = `document.querySelector('[data-testid="review-rewrite-button"]')?.scrollIntoView({ block: 'center' })`
// §213: и предложение, и поле под ним должны попасть в кадр целиком.
const toRewriteSuggestion = `document.querySelector('[data-testid="review-rewrite-suggestion"]')?.scrollIntoView({ block: 'center' })`
// §211 (board/062): страница, снятая боком, — вторая в первой работе очереди.
const toSidewaysPage = `document.querySelector('[data-testid="review-page-2"]')?.scrollIntoView({ block: 'center' })`
// §211: доворот той же страницы кнопкой у её угла — ровно то, что делает рукой
// преподаватель. Ждать сохранения не надо: на экране страница разворачивается
// сразу, запись уходит следом.
const rotateSidewaysPage = `document.querySelector('[data-testid="review-rotate-2"]')?.click()`
// §211: увеличили работу «плюсом» — по ширине колонки она больше не влезает.
const zoomInTwice = `(() => { const b = document.querySelector('[title="Увеличить"]'); b?.click(); b?.click() })()`
// §210: ниже 1024 колонки идут друг под другом, и таблица лежит третьим
// блоком — до неё мотают всю полосу. Сцена показывает, что порядок прежний:
// решение, работа, таблица.
const scrollStripDown = `(() => { const el = document.querySelector('[data-testid="attempt-split-row"]') ?? document.querySelector('[data-testid="review-document-scroll-area"]'); if (el) el.scrollTop = el.scrollHeight })()`
// §226: задание с предложением ИИ. Новая версия — клик по строке списка
// заданий; старая — предложение и так под строкой, докручиваем до него.
const pickSuggestedTask = `(() => { const row = document.querySelector('[data-testid="review-task-pick"][data-has-suggestion="true"]'); row?.click(); setTimeout(() => document.querySelector('[data-testid="ai-finding-suggestion"]')?.scrollIntoView({ block: 'center' }), 200) })()`
// §226: задание 3 — у него рамка-замечание на первой странице.
const pickTaskThree = `(() => { const row = document.querySelector('[data-testid="review-task-pick"][data-no="3"]'); if (row) { row.click(); return } document.querySelector('[data-testid="review-task-row"][data-no="3"]')?.scrollIntoView({ block: 'center' }) })()`
// §226: низ экрана на телефоне — всё, что под работой, домотано до конца.
const scrollReviewDown = `(() => { for (const sel of ['[data-testid="attempt-split-row"]', '[data-testid="review-side-scroll-area"]', '[data-testid="attempt-annotation-overlay"]']) { const el = document.querySelector(sel); if (el && el.scrollHeight > el.clientHeight + 5) { el.scrollTop = el.scrollHeight; return } } })()`

export const scenes = [
  // ── guest ──
  { persona: 'guest', name: 'g01-login', url: '/login' },
  { persona: 'guest', name: 'g01-login-keyboard', url: '/login', height: 430, actions: [{ focus: 'input[type=email], input[name=email], input' }], full: false },
  { persona: 'guest', name: 'g02-register', url: '/register' },
  { persona: 'guest', name: 'g02-register-filled', url: '/register', actions: [{ fill: ['input', 'Константинопольская Анна Владимировна'] }] },
  { persona: 'guest', name: 'g03-forgot', url: '/forgot-password' },
  { persona: 'guest', name: 'g04-landing', url: '/about' },

  // ── student ──
  { persona: 'student', name: 's01-dashboard', url: '/student' },
  { persona: 'student', name: 's01-menu', url: '/student', actions: [{ clickSel: 'header button' }, { wait: 500 }], full: false },
  { persona: 'student', name: 's02-my-course', url: '/my-course' },
  { persona: 'student', name: 's03-course', url: `/my-course/${S.group}` },
  { persona: 'student', name: 's04-topic', url: `/my-course/${S.group}/topic/${S.topic(1)}` },
  { persona: 'student', name: 's04-topic-solution', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ click: 'Решение ДЗ' }, { wait: 800 }] },
  { persona: 'student', name: 's04-topic-hw', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 1000 }] },
  { persona: 'student', name: 's04-topic-hw-keyboard', url: `/my-course/${S.group}/topic/${S.topic(1)}`, height: 430, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 800 }, { focus: 'textarea' }], full: false },
  // §199 (board/051): разбор работы у ученика — блок «По заданиям». Строки
  // приходят только после вердикта (политика), у работы 1 он есть.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'student', name: 's04-topic-hw-tasks', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 1200 }, { eval: toStudentTasks }, { wait: 600 }], full: false },
  ]),
  { persona: 'student', name: 's04-topic-theory', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Теория")' }, { wait: 800 }] },
  { persona: 'student', name: 's05-my-homework-submit', url: '/my-homework', actions: [{ click: 'Сдать' }, { wait: 1500 }] },
  { persona: 'student', name: 's04-topic-test', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Тест")' }, { wait: 800 }] },
  // board/016: тема ученика с вкладкой «Задачи» — 7 задач к уроку, две второй
  // части, часть уже решена (§162). С §175 на экране одна задача и лента
  // шагов сверху; открывается первая нерешённая (3). Сцены ниже — те же
  // действия, что ученик делает руками: ответ, переход по квадрату, «Дальше».
  { persona: 'student', name: 's04-topic-tasks', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 800 }] },
  // Верный ответ (6 = 3·2): квадрат 3 зеленеет, карточка остаётся с «Верно» и
  // «Посмотреть решение», «Решено 4 из 7».
  { persona: 'student', name: 's04-topic-tasks-answered', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 800 }, { fill: ['input[aria-label="Ответ на задачу"]', '6'] }, { clickRole: ['button', 'Проверить'] }, { wait: 1000 }] },
  // Клик по квадрату ленты: задача второй части без автопроверки, последняя —
  // «Дальше» неактивна. Контекст один на персону и ширину, поэтому ответ из
  // сцены выше здесь уже учтён («Решено 4 из 7») — как в живой сессии.
  // §176: неверный ответ (5 ≠ 6) — карточка в состоянии «неверно»: красная
  // плашка, поле красное с введённым ответом, «Проверить ещё раз».
  { persona: 'student', name: 's04-topic-tasks-wrong', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 800 }, { clickRole: ['button', 'Задача 4, есть попытки, не решена'] }, { wait: 400 }, { fill: ['input[aria-label="Ответ на задачу"]', '5'] }, { clickRole: ['button', /Проверить/] }, { wait: 1000 }, { eval: `document.querySelector('[data-testid="topic-task-wrong"]')?.scrollIntoView({ block: 'center' })` }, { wait: 300 }] },
  // Решение после неверной попытки (§176): «Посмотреть решение» → поле ответа
  // исчезает, виден ответ и разбор, внизу «Разобрал». Контекст тот же, что у
  // сцены выше, — у задачи 4 уже есть неверный ответ «5».
  { persona: 'student', name: 's04-topic-tasks-wrong-reveal', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 800 }, { clickRole: ['button', 'Задача 4, есть попытки, не решена'] }, { wait: 400 }, { clickRole: ['button', /Посмотреть решение/] }, { wait: 1000 }, { eval: `[...document.querySelectorAll('[data-testid="topic-task-card"] button')].pop()?.scrollIntoView({ block: 'center' })` }, { wait: 300 }] },
  // «Разобрал» → задача закрыта «по разбору», квадрат 4 зелёный, «Решено 4 из 7».
  { persona: 'student', name: 's04-topic-tasks-wrong-closed', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 800 }, { clickRole: ['button', 'Задача 4, есть попытки, не решена'] }, { wait: 400 }, { clickRole: ['button', /Разобрал/] }, { wait: 1000 }] },
  { persona: 'student', name: 's04-topic-tasks-part2', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 800 }, { clickRole: ['button', 'Задача 7, не начата'] }, { wait: 600 }] },
  { persona: 'student', name: 's04-topic2-submitted', url: `/my-course/${S.group}/topic/${S.topic(2)}`, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 800 }] },
  { persona: 'student', name: 's04-topic4-notsubmitted', url: `/my-course/${S.group}/topic/${S.topic(4)}`, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 800 }] },
  { persona: 'student', name: 's04-topic4-upload', url: `/my-course/${S.group}/topic/${S.topic(4)}`, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 800 }, { clickSel: 'button:has-text("Загрузить работу")' }, { wait: 1200 }] },
  { persona: 'student', name: 's04-topic4-upload-keyboard', url: `/my-course/${S.group}/topic/${S.topic(4)}`, height: 430, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 800 }, { clickSel: 'button:has-text("Загрузить работу")' }, { wait: 1000 }, { focus: 'textarea' }], full: false },
  { persona: 'student', name: 's04-topic4-upload-selected', url: `/my-course/${S.group}/topic/${S.topic(4)}`, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 800 }, { clickSel: 'button:has-text("Загрузить работу")' }, { wait: 1500 }, { files: ['photo.png', 'figure.png'] }, { wait: 7000 }] },
  // §173: файл, который платформа не покажет (ProRAW .dng), отклоняется до загрузки — фото из той же пачки грузится, рядом с объяснением «Сфотографировать».
  { persona: 'student', name: 's04-topic4-upload-dng', url: `/my-course/${S.group}/topic/${S.topic(4)}`, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 800 }, { clickSel: 'button:has-text("Загрузить работу")' }, { wait: 1500 }, { files: ['photo.png', 'raw.dng'] }, { wait: 5000 }] },
  { persona: 'student', name: 's04-topic4-upload-selected-keyboard', url: `/my-course/${S.group}/topic/${S.topic(4)}`, height: 430, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 800 }, { clickSel: 'button:has-text("Загрузить работу")' }, { wait: 1500 }, { files: ['photo.png'] }, { wait: 2000 }, { focus: 'textarea' }], full: false },
  { persona: 'student', name: 's05-my-homework', url: '/my-homework' },
  { persona: 'student', name: 's06-catalog', url: '/catalog' },
  { persona: 'student', name: 's06-catalog-physics', url: '/catalog?subject=physics&exam=ege' },
  { persona: 'student', name: 's06-catalog-section', url: `/catalog/${S.section(1)}?subject=physics&exam=ege` },
  { persona: 'student', name: 's06-catalog-topic', url: `/catalog/${S.section(1)}/topic/${S.ctopic(2)}?subject=physics&exam=ege` },
  { persona: 'student', name: 's06-catalog-task', url: `/catalog/task/${S.task(1)}?subject=physics&exam=ege` },
  { persona: 'student', name: 's07-variants', url: '/student/variants' },
  { persona: 'student', name: 's07-variant-work', url: `/student/variants/${S.myAssignment(1)}` },
  { persona: 'student', name: 's07-variant-work-answer', url: `/student/variants/${S.myAssignment(1)}`, height: 430, actions: [{ focus: 'input[type=text], input:not([type=hidden])' }], full: false },
  { persona: 'student', name: 's07-variant-generate', url: '/student/variants/generate' },
  { persona: 'student', name: 's07-variant-build', url: '/student/variants/build' },
  { persona: 'student', name: 's07-variant-stats', url: '/student/variants/stats' },
  { persona: 'student', name: 's08-progress', url: '/my-progress' },
  { persona: 'student', name: 's09-notifications', url: '/notifications' },
  { persona: 'student', name: 's10-settings', url: '/settings' },
  { persona: 'student', name: 's10-settings-telegram', url: '/settings', actions: [{ clickRole: ['button', 'Уведомления'] }, { wait: 800 }] },

  // ── owner (admin mode) ──
  { persona: 'owner', name: 'o01-admin-now', url: '/admin', actions: [{ clickRole: ['button', 'Сейчас'] }, { wait: 1200 }] },
  { persona: 'owner', name: 'o01-admin-overview', url: '/admin', actions: [{ clickRole: ['button', 'Обзор'] }, { wait: 800 }] },
  { persona: 'owner', name: 'o01-admin-students', url: '/admin', actions: [{ clickRole: ['button', 'Ученики'] }, { wait: 800 }] },
  { persona: 'owner', name: 'o01-admin-learning', url: '/admin', actions: [{ clickRole: ['button', 'Учёба'] }, { wait: 800 }] },
  { persona: 'owner', name: 'o01-admin-site', url: '/admin', actions: [{ clickRole: ['button', 'Сайт'] }, { wait: 800 }] },
  { persona: 'owner', name: 'o01-admin-video', url: '/admin', actions: [{ clickRole: ['button', 'Видео'] }, { wait: 800 }] },
  { persona: 'owner', name: 'o01-admin-staff', url: '/admin', actions: [{ clickRole: ['button', 'Команда'] }, { wait: 800 }] },
  { persona: 'owner', name: 'o01-menu', url: '/admin', actions: [{ clickSel: 'header button' }, { wait: 500 }], full: false },
  { persona: 'owner', name: 'o02-telegram-journal', url: '/admin/telegram' },
  { persona: 'owner', name: 'o03-course-program', url: '/course-program' },
  { persona: 'owner', name: 'o03-course-program-course', url: `/course-program?course=${S.course}`, actions: [{ click: 'Физика ЕГЭ 2027' }, { wait: 1000 }] },
  { persona: 'owner', name: 'o03-course-program-topic', url: `/course-program?course=${S.course}`, actions: [{ click: 'Физика ЕГЭ 2027' }, { wait: 800 }, { click: 'Равноускоренное прямолинейное' }, { wait: 1000 }] },
  { persona: 'owner', name: 'o03-course-program-materials', url: `/course-program?course=${S.course}`, actions: [{ click: 'Физика ЕГЭ 2027' }, { wait: 800 }, { clickSel: 'button:has-text("Материалы")' }, { wait: 1200 }] },
  { persona: 'owner', name: 'o03-course-program-materials-topic', url: `/course-program?course=${S.course}`, actions: [{ click: 'Физика ЕГЭ 2027' }, { wait: 800 }, { clickSel: 'button:has-text("Материалы")' }, { wait: 1000 }, { click: 'Равноускоренное прямолинейное' }, { wait: 1200 }] },
  // §177 (board/030): вкладка «Материалы» на 1280 — в столбце «Задачи» число
  // прикреплённых задач (тема 1 — «7» при тесте из банка, тема 3 — «12»),
  // ниже — клик по числу открывает окно темы сразу на рубрике «Задачи».
  { persona: 'owner', name: 'o03-course-program-materials', url: `/course-program?courseId=${S.course}&tab=materials`, width: 1280, height: 800, actions: [{ wait: 1200 }] },
  { persona: 'owner', name: 'o03-course-program-materials-count-click', url: `/course-program?courseId=${S.course}&tab=materials`, width: 1280, height: 800, actions: [{ wait: 1200 }, { clickSel: '[data-testid="matrix-tasks-count"]' }, { wait: 1500 }], full: false },
  // То же на 390: матрица прокручивается внутри контейнера (§158), столбец
  // «Задачи» — крайний правый, докручиваем до него и смотрим, что число не
  // расширило столбец.
  { persona: 'owner', name: 'o03-course-program-materials-tasks-col', url: `/course-program?courseId=${S.course}&tab=materials`, actions: [{ wait: 1200 }, { eval: '(() => { const el = document.querySelector("[data-testid=matrix-tasks-count]")?.closest(".overflow-x-auto"); if (el) el.scrollLeft = el.scrollWidth; window.scrollTo(0, 420) })()' }, { wait: 500 }], full: false },
  // board/016: экран преподавателя той же темы — тайл «Задачи» (§162/§164):
  // сколько прикреплено и как решают.
  { persona: 'owner', name: 'o03-course-program-tasks', url: `/course-program?course=${S.course}`, actions: [{ click: 'Физика ЕГЭ 2027' }, { wait: 800 }, { clickSel: 'button:has-text("Материалы")' }, { wait: 1000 }, { click: 'Равноускоренное прямолинейное' }, { wait: 1500 }, { clickSel: '[data-testid="topic-tile-test"]' }, { wait: 1000 }, { eval: '(() => { const el = [...document.querySelectorAll("div")].find(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 5); if (el) el.scrollTop = el.scrollHeight })()' }, { wait: 500 }], full: false },
  // §174 (board/027): вкладка «Результаты тестов» класса — матрица «ученик ×
  // тема» задач к уроку, ниже тесты из банка; каркас — без ученических вкладок,
  // со строкой классов-копий. Снимаются на 390 и 1280.
  { persona: 'owner', name: 'o13-course-task-results', url: `/course-program?courseId=${S.course}&tab=testresults`, actions: [{ wait: 1200 }] },
  { persona: 'owner', name: 'o13-course-task-results', url: `/course-program?courseId=${S.course}&tab=testresults`, width: 1280, height: 800, actions: [{ wait: 1200 }] },
  { persona: 'owner', name: 'o13-course-template', url: `/course-program?courseId=${S.courseTemplate}&tab=students`, width: 1280, height: 800, actions: [{ wait: 1200 }] },
  { persona: 'owner', name: 'o04-catalog', url: '/catalog' },
  { persona: 'owner', name: 'o04-catalog-physics', url: '/catalog?subject=physics&exam=ege' },
  { persona: 'owner', name: 'o04-catalog-section', url: `/catalog/${S.section(1)}?subject=physics&exam=ege` },
  { persona: 'owner', name: 'o04-catalog-topic', url: `/catalog/${S.section(1)}/topic/${S.ctopic(2)}?subject=physics&exam=ege` },
  { persona: 'owner', name: 'o04-catalog-task', url: `/catalog/task/${S.task(1)}?subject=physics&exam=ege` },
  // §202 (board/054): экран каталога на 1280 и карточка математической задачи —
  // контроль, что правка ПЕЧАТИ не поехала на экран. У математики свой класс
  // .scale-figures-math-exam (35 % карточки), он тут и виден.
  { persona: 'owner', name: 'o04-catalog-topic', url: `/catalog/${S.section(1)}/topic/${S.ctopic(2)}?subject=physics&exam=ege`, width: 1280, height: 900 },
  { persona: 'owner', name: 'o04-catalog-task', url: `/catalog/task/${S.task(1)}?subject=physics&exam=ege`, width: 1280, height: 900 },
  { persona: 'owner', name: 'o04-catalog-task-math', url: `/catalog/task/${S.task(41)}?subject=math&exam=ege` },
  { persona: 'owner', name: 'o04-catalog-task-math', url: `/catalog/task/${S.task(41)}?subject=math&exam=ege`, width: 1280, height: 900 },
  { persona: 'owner', name: 'o04-catalog-task-solution', url: `/catalog/task/${S.task(1)}?subject=physics&exam=ege`, actions: [{ click: 'Решение' }, { wait: 500 }] },
  // §195 (board/047): заливка картинок каталога. Пара сцен на каждую ширину —
  // пустая папка и та же папка после заливки трёх файлов. Второй снимок
  // делается настоящей заливкой через форму (харнесс кладёт объект в свой
  // «бакет» и отдаёт его следующим листингом), а не подложенным списком.
  ...[[390, 844], [1280, 800]].map(([width, height]) => ({
    persona: 'owner', name: 'o14-catalog-assets-empty', url: '/catalog/assets', width, height,
    actions: [{ fill: ['[data-testid="catalog-assets-folder"]', CATALOG_ASSETS_FOLDER] }, { wait: 800 }],
  })),
  ...[[390, 844], [1280, 800]].map(([width, height]) => ({
    persona: 'owner', name: 'o14-catalog-assets-uploaded', url: '/catalog/assets', width, height,
    actions: [
      { fill: ['[data-testid="catalog-assets-folder"]', CATALOG_ASSETS_FOLDER] },
      { wait: 600 },
      { files: ['figure.png', 'table.png', 'formula.png'] },
      { wait: 600 },
      { clickSel: '[data-testid="catalog-assets-upload"]' },
      // Ждём дольше жизни тоста «Загружено: 3 файла» (4,5 с): иначе он
      // закрывает собой кнопку «Скопировать пути» — ради которой экран и есть.
      { wait: 5200 },
    ],
  })),
  { persona: 'owner', name: 'o05-cart', url: '/catalog', actions: [{ ls: ['almiron-cart', cart] }, { goto: '/cart' }] },
  { persona: 'owner', name: 'o05-catalog-with-cart', url: `/catalog/${S.section(1)}/topic/${S.ctopic(2)}?subject=physics&exam=ege` },
  // §188 (board/041): список «Мои подборки». В фикстурах пять строк, в списке
  // обязаны быть три: архивная и чужая не показываются.
  { persona: 'owner', name: 'o05-collections', url: '/collections', actions: [{ wait: 600 }] },
  { persona: 'owner', name: 'o05-collections-wide', url: '/collections', width: 1280, height: 800, actions: [{ wait: 600 }] },
  { persona: 'owner', name: 'o05-collections-archived', url: '/collections', width: 1280, height: 800, actions: [{ wait: 600 }, { clickSel: 'button[aria-label="В архив"]' }, { wait: 800 }] },
  // §200 (board/052): открывает вся карточка. Playwright бьёт в ЦЕНТР элемента —
  // то самое пустое место между названием и архивом, куда владелец жал и не
  // получал ничего. Конечный адрес в логе (`-> /collections/…`) и есть проверка.
  { persona: 'owner', name: 'o05-collections-row-click', url: '/collections', width: 1280, height: 800, actions: [{ wait: 600 }, { clickSel: '[role="link"][aria-label^="Открыть подборку"]' }, { wait: 800 }] },
  { persona: 'owner', name: 'o05-collections-row-click-390', url: '/collections', actions: [{ wait: 600 }, { clickSel: '[role="link"][aria-label^="Открыть подборку"]' }, { wait: 800 }] },
  { persona: 'owner', name: 'o05-collection', url: `/collections/${S.collection}` },
  { persona: 'owner', name: 'o05-collection-export', url: `/collections/${S.collection}`, actions: [{ click: 'PDF' }, { wait: 800 }] },
  // §201 (board/053): печать подборки с задачами части 2. С включёнными
  // ответами вместо «Ответ не указан» — максимум баллов и критерии; у задачи
  // без критериев надпись остаётся. Второй снимок — те же задачи с
  // выключенными ответами: критериев в листе быть не должно, преподаватель
  // печатает такую подборку ученику.
  {
    persona: 'owner', name: 'o05-collection-part2-answers', url: `/collections/${S.collection6}`, width: 1280, height: 900,
    actions: [
      { click: 'PDF' }, { wait: 800 },
      { clickSel: 'label:has-text("Ответы") input[type=checkbox]' },
      { clickSel: 'label:has-text("Ключ (таблица ответов)") input[type=checkbox]' },
      { wait: 800 },
    ],
  },
  {
    persona: 'owner', name: 'o05-collection-part2-no-answers', url: `/collections/${S.collection6}`, width: 1280, height: 900,
    actions: [{ click: 'PDF' }, { wait: 800 }],
  },
  // §201: та же задача части 2 в каталоге — подпись рядом с кнопками вместо
  // отсутствующей кнопки «Ответ».
  { persona: 'owner', name: 'o04-catalog-task-part2', url: `/catalog/task/${S.task(15)}?subject=math&exam=ege`, width: 1280, height: 900 },
  // §202 (board/054): лист печатной подборки, на котором рядом стоят задача с
  // крупным чертежом (600 px) и задача с мелким сканом (150 px) — именно на
  // этой паре видно, приведены ли иллюстрации к одной полосе ширин.
  { persona: 'owner', name: 'o05-print-figures', url: `/collections/${S.collection}`, width: 1280, height: 900, actions: [{ click: 'PDF' }, { wait: 1500 }, { eval: toSmallFigure }, { wait: 500 }], full: false },
  { persona: 'owner', name: 'o05-print-figures', url: `/collections/${S.collection}`, actions: [{ click: 'PDF' }, { wait: 1500 }, { eval: toSmallFigure }, { wait: 500 }], full: false },
  // Та же печатная страница, но подборка МАТЕМАТИКИ: у неё работает базовое
  // правило ширины (print-figures-boost — только физика ЕГЭ), и именно на ней
  // видно, что было «крупный чертёж рядом с ноготком».
  { persona: 'owner', name: 'o05-print-figures-math', url: `/collections/${S.collection2}`, width: 1280, height: 900, actions: [{ click: 'PDF' }, { wait: 1500 }, { eval: toSmallFigure }, { wait: 500 }], full: false },
  { persona: 'owner', name: 'o05-print-figures-math', url: `/collections/${S.collection2}`, actions: [{ click: 'PDF' }, { wait: 1500 }, { eval: toSmallFigure }, { wait: 500 }], full: false },
  // §205 (board/056): печатный лист подборки, где ВСЁ содержимое — формулы
  // картинками (как в подборке владельца по математике). «Пояснения» включаем:
  // блочные формулы живут в разборе, без них на листе видны только строчные.
  { persona: 'owner', name: 'o05-print-formulas', url: `/collections/${S.collection7}`, width: 1280, height: 900, actions: [{ click: 'PDF' }, { wait: 1500 }, { click: 'Пояснения' }, { wait: 1200 }, { eval: toPrintTop }, { wait: 400 }], full: false },
  { persona: 'owner', name: 'o05-print-formulas', url: `/collections/${S.collection7}`, actions: [{ click: 'PDF' }, { wait: 1500 }, { click: 'Пояснения' }, { wait: 1200 }, { eval: toPrintTop }, { wait: 400 }], full: false },
  // Второй лист той же подборки: гигант из первой задачи и следующие за ним
  // короткое равенство и строчные формулы — на этой паре и виден разброс.
  { persona: 'owner', name: 'o05-print-formulas-2', url: `/collections/${S.collection7}`, width: 1280, height: 900, actions: [{ click: 'PDF' }, { wait: 1500 }, { click: 'Пояснения' }, { wait: 1200 }, { eval: toShortSystem }, { wait: 400 }], full: false },
  { persona: 'owner', name: 'o05-print-formulas-2', url: `/collections/${S.collection7}`, actions: [{ click: 'PDF' }, { wait: 1500 }, { click: 'Пояснения' }, { wait: 1200 }, { eval: toShortSystem }, { wait: 400 }], full: false },
  // Контроль «экран не поехал»: та же задача-формула в каталоге.
  { persona: 'owner', name: 'o04-catalog-task-formula', url: `/catalog/task/${S.task(50)}?subject=math&exam=ege`, width: 1280, height: 900, actions: [{ click: 'Решение' }, { wait: 600 }] },
  { persona: 'owner', name: 'o04-catalog-task-formula', url: `/catalog/task/${S.task(50)}?subject=math&exam=ege`, actions: [{ click: 'Решение' }, { wait: 600 }] },
  { persona: 'owner', name: 'o06-queue', url: '/homework-queue' },
  { persona: 'owner', name: 'o06-queue-filters', url: '/homework-queue', actions: [{ clickSel: 'text=На доработке' }, { wait: 500 }] },
  { persona: 'owner', name: 'o06-review', url: '/homework-queue', actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2000 }] },
  { persona: 'owner', name: 'o06-review-verdict', url: '/homework-queue', actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2000 }, { eval: '(() => { const el = [...document.querySelectorAll("div")].find(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 5); if (el) el.scrollTop = el.scrollHeight })()' }, { wait: 600 }], full: false },
  { persona: 'owner', name: 'o06-review-keyboard', url: '/homework-queue', height: 430, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2000 }, { focus: 'textarea' }, { wait: 400 }], full: false },
  { persona: 'owner', name: 'o06-review-landscape', url: '/homework-queue', width: 844, height: 390, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2000 }], full: false },
  // ── §186 (board/039) + §199 (board/051): блок «По заданиям» ──
  // Сцены подсветки находок строкой таблицы сняты вместе с самим списком
  // находок (§199: он дословно дублировал «Комментарии»). Осталось то, что
  // живо: подсказка под знаком вопроса (§207 — туда ушли пояснения и счётчик
  // отброшенных находок) и проверка старее v17, у которой таблицы нет
  // вовсе, — панель ей обязана выглядеть как до §186.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o06-review-ai-hint', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: openAiHint }, { wait: 600 }], full: false },
    { persona: 'owner', name: 'o06-review-ai-legacy', url: '/homework-queue', width, height, actions: [{ wait: 1200 }, { eval: openSecondAttempt }, { wait: 2500 }, { eval: toAiPanel }, { wait: 600 }], full: false },
  ]),

  // ── §199 (board/051): таблица проверки правится, экран разгружен ──
  // Та же работа очереди, что и у §186, но блок «По заданиям» теперь СВОЙ:
  // строки из `topic_homework_review_tasks`, вердикт выпадающим списком,
  // заметка и ответы правятся, строку можно добавить и удалить. Списка находок
  // в панели больше нет, резюме ИИ свёрнуто.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o06-review-tasks', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toReviewTasks }, { wait: 600 }], full: false },
    // Длинная заметка: в таблице одна строка, в фокусе — целиком.
    { persona: 'owner', name: 'o06-review-tasks-note', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toReviewTasks }, { wait: 400 }, { eval: openFirstNote }, { wait: 400 }], full: false },
    // §212: включённый фильтр «неверно» — в списке остались только неверные.
    { persona: 'owner', name: 'o06-review-tasks-filter', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toReviewTasks }, { wait: 400 }, { eval: filterWrong }, { wait: 500 }], full: false },
    // §212: список статусов открыт у нижней строки — он в body и не обрезан.
    { persona: 'owner', name: 'o06-review-tasks-status', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toReviewTasks }, { wait: 400 }, { eval: toLastRow }, { wait: 500 }, { eval: openStatusPicker }, { wait: 500 }], full: false },
    // §212: правка замечания начинается кликом по самому тексту.
    { persona: 'owner', name: 'o06-review-tasks-note-edit', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toReviewTasks }, { wait: 400 }, { eval: editFirstNote }, { wait: 500 }], full: false },
  ]),

  // ── §209 (board/060): один список — задания с замечаниями ──
  // Колонки «Комментарии» на этих снимках нет вовсе: всё, что в ней было,
  // стоит под строками заданий. Сцены про переключатель похвал убраны
  // вместе с колонкой — прятать стало нечего.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    // Предложение ИИ: «взять» / «мимо» под своей строкой.
    { persona: 'owner', name: 'o06-review-ai-suggestion', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toSuggestion }, { wait: 600 }], full: false },
    // Расхождение: у верного задания есть замечание.
    { persona: 'owner', name: 'o06-review-conflict', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toConflict }, { wait: 600 }], full: false },
    // Создание заметки, шаг 1: нажали «+ Заметка» — включилось рисование.
    { persona: 'owner', name: 'o06-review-note-draw', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toConflict }, { wait: 400 }, { clickSel: '[data-testid="review-task-add-note"]' }, { wait: 500 }], full: false },
    // Шаг 2: обвели место — выбор типа и текст замечания.
    { persona: 'owner', name: 'o06-review-note-editor', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toConflict }, { wait: 400 }, { clickSel: '[data-testid="review-task-add-note"]' }, { wait: 400 }, { eval: toFirstPage }, { wait: 600 }, { drag: { sel: '[data-testid="review-overlay-1"]', from: [0.18, 0.37], to: [0.68, 0.43] } }, { wait: 500 }, { fill: ['[data-testid="comment-editor-text"]', 'Потерян второй корень'] }, { wait: 400 }], full: false },
  ]),

  // ── §208 (board/059): шапка, граница колонок, поле комментария ──
  // 1440 добавлен намеренно: между 1024 и 1536 граница панели решения до §208
  // не показывалась вовсе, а владелец работает именно здесь.
  ...[[390, 844], [1280, 800], [1440, 900]].flatMap(([width, height]) => [
    // Шапка: крупно «кто и по какой теме», полосы с именами файлов нет.
    { persona: 'owner', name: 'o06-review-head', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }], full: false },
    // Та же шапка с раскрытой полосой файлов — оригиналы никуда не делись.
    { persona: 'owner', name: 'o06-review-files-open', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { clickSel: '[data-testid="attempt-files-toggle"]' }, { wait: 500 }], full: false },
    // Пустое поле: видно стартовые шесть строк вместо прежних двух.
    { persona: 'owner', name: 'o06-review-comment', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toCommentBox }, { wait: 600 }], full: false },
    // То же поле с разбором ИИ. Текст приходит НЕ с клавиатуры — кнопка
    // подставляет его целиком, и высота обязана пересчитаться и в этом случае.
    { persona: 'owner', name: 'o06-review-comment-ai', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { clickSel: '[data-testid="ai-check-use-text"]' }, { wait: 500 }, { eval: toCommentBox }, { wait: 600 }], full: false },
  ]),
  // Граница колонок сдвинута с клавиатуры. На 390 колонки идут друг под
  // другом — там границы нет и снимать нечего.
  ...[[1280, 800], [1440, 900]].map(([width, height]) => (
    { persona: 'owner', name: 'o06-review-split-moved', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: moveSplitRight }, { wait: 600 }], full: false }
  )),

  // ── §215 → §218: пробники ──
  // Модалка §215 заменена таблицей по номерам заданий (§218). На снимках:
  // список (образец без группы говорит «нет группы» словами), таблица с
  // заполненной половиной группы, отчёт о вставке примера владельца с «не
  // найден» и «неоднозначно», красная клетка при сохранении, экран шаблона.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o15-mock-exams', url: '/mock-exams', width, height, actions: [{ wait: 1200 }] },
    { persona: 'owner', name: 'o15-mock-grid', url: '/mock-exams/c000000-0000-4000-8000-000000000720', width, height, actions: [{ wait: 1200 }] },
    { persona: 'owner', name: 'o15-mock-paste', url: '/mock-exams/c000000-0000-4000-8000-000000000720', width, height, actions: [{ wait: 1200 }, { eval: pasteMockSample }, { wait: 500 }, { eval: toMockReport }, { wait: 300 }] },
    { persona: 'owner', name: 'o15-mock-red', url: '/mock-exams/c000000-0000-4000-8000-000000000720', width, height, actions: [{ wait: 1200 }, { eval: typeMockOver }, { wait: 500 }] },
    { persona: 'owner', name: 'o15-mock-template', url: '/mock-exams/templates', width, height, actions: [{ wait: 1000 }] },
  ]),

  // ── §219 (071): уведомление кнопкой ──
  // Строки: «Уведомить» (итог не отправлялся), «отправлено …» (Каримова),
  // «итог изменён после отправки» (Никитина), недоступная кнопка у тех, у
  // кого итога нет. Затем — нажата «Уведомить» в строке, и подтверждение
  // «Уведомить всех» внутри страницы. Сцены пишут в фикстуры — гонять по
  // ширине отдельным процессом (README, §211).
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o15-mock-notify-rows', url: '/mock-exams/c000000-0000-4000-8000-000000000720', width, height, actions: [{ wait: 1200 }, { eval: toMockNotifyCol }, { wait: 300 }] },
    { persona: 'owner', name: 'o15-mock-notify-sent', url: '/mock-exams/c000000-0000-4000-8000-000000000720', width, height, actions: [{ wait: 1200 }, { eval: toMockNotifyCol }, { eval: clickFirstNotify }, { wait: 700 }] },
    { persona: 'owner', name: 'o15-mock-notify-all', url: '/mock-exams/c000000-0000-4000-8000-000000000720', width, height, actions: [{ wait: 1200 }, { clickSel: '[data-testid="mock-grid-notify-all"]' }, { wait: 400 }, { eval: toMockNotifyBar }, { wait: 300 }] },
  ]),

  // ── §214 (board/066): пятый вердикт «не решено» ──
  // «Не сверено» тащило два смысла — «ИИ не смогла сверить» и «ученик не
  // делал». На снимках: открытый список из пяти значений и включённый фильтр
  // «не решено», по которому остаются только несделанные задания.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o06-unsolved-menu', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toReviewTasks }, { wait: 400 }, { eval: openVerdictMenu }, { wait: 600 }], full: false },
    { persona: 'owner', name: 'o06-unsolved-filter', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toReviewTasks }, { wait: 400 }, { eval: filterUnsolved }, { wait: 600 }], full: false },
  ]),

  // ── §213 (board/064): «Переписать по таблице» ──
  // Пара до/после: кнопка у поля комментария и результат ПРЕДЛОЖЕНИЕМ над
  // полем. На «после» видно главное: в поле остался текст преподавателя, а
  // предложение ждёт «Вставить» или «Отмена».
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o06-rewrite-button', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { fill: ['[data-testid="review-comment-input"]', 'Мой черновик комментария — его нельзя затирать молча.'] }, { wait: 300 }, { eval: toRewriteButton }, { wait: 500 }], full: false },
    { persona: 'owner', name: 'o06-rewrite-suggestion', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { fill: ['[data-testid="review-comment-input"]', 'Мой черновик комментария — его нельзя затирать молча.'] }, { wait: 300 }, { clickSel: '[data-testid="review-rewrite-button"]' }, { wait: 1200 }, { eval: toRewriteSuggestion }, { wait: 500 }], full: false },
  ]),

  // ── §211 (board/062): поворот страницы, «по ширине», вердикт в потоке ──
  // Пары до/после на одной и той же странице: вторая страница первой работы
  // снята боком (так приезжает половина работ). На «после» видно, что
  // страница встала прямо, а рамка преподавателя осталась на своём месте, —
  // ради этого поворот и пересчитывает координаты.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o06-rotate-before', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toSidewaysPage }, { wait: 800 }], full: false },
    { persona: 'owner', name: 'o06-rotate-after', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toSidewaysPage }, { wait: 800 }, { eval: rotateSidewaysPage }, { wait: 900 }, { eval: toSidewaysPage }, { wait: 500 }], full: false },
    // «По ширине»: увеличенная работа возвращается в колонку одним щелчком.
    { persona: 'owner', name: 'o06-fit-before', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: zoomInTwice }, { wait: 700 }], full: false },
    { persona: 'owner', name: 'o06-fit-after', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: zoomInTwice }, { wait: 500 }, { clickSel: '[data-testid="review-fit-width"]' }, { wait: 700 }], full: false },
    // Вердикт вернулся в поток: сверху колонки его не видно, он доезжает
    // прокруткой — и все освободившиеся строки достались таблице.
    { persona: 'owner', name: 'o06-verdict-flow-top', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }], full: false },
    { persona: 'owner', name: 'o06-verdict-flow-bottom', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: scrollTableDown }, { wait: 700 }], full: false },
  ]),

  // ── §210 (board/061): три колонки — решение, работа, таблица ──
  // Главное на этих снимках: таблица проверки стоит СБОКУ от работы, а не под
  // ней, и кнопки вердикта видны сразу, без прокрутки.
  ...[[1280, 800], [1440, 900], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o06-3col', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }], full: false },
    // Решение выключено — колонок две, и работа сразу шире.
    { persona: 'owner', name: 'o06-3col-nosolution', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { clickSel: '[data-testid="attempt-solution-toggle"]' }, { wait: 600 }], full: false },
    // Прокрутили таблицу до конца: работа слева осталась на месте.
    { persona: 'owner', name: 'o06-3col-table-scrolled', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: scrollTableDown }, { wait: 600 }], full: false },
    // Ученик: класть в третью колонку нечего, и колонок у него столько же,
    // сколько было, — проверка, что ничего не поехало.
    { persona: 'student', name: 's04-hw-marks', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 1200 }, { clickSel: '[data-testid="hw-view-marks-button"]' }, { wait: 2500 }], full: false },
  ]),
  // Вторая граница сдвинута с клавиатуры. Ниже 1024 её нет — снимать нечего.
  ...[[1280, 800], [1440, 900]].map(([width, height]) => (
    { persona: 'owner', name: 'o06-3col-split-moved', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: moveReviewSplitLeft }, { wait: 600 }], full: false }
  )),
  // 390: домотали полосу до конца — таблица и вердикт стоят третьим блоком,
  // порядок тот же, что был.
  { persona: 'owner', name: 'o06-3col-strip-bottom', url: '/homework-queue', actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: scrollStripDown }, { wait: 800 }], full: false },

  { persona: 'owner', name: 'o07-students', url: '/students' },
  { persona: 'owner', name: 'o07-students-invites', url: '/students', actions: [{ clickRole: ['button', 'Приглашения'] }, { wait: 600 }] },
  { persona: 'owner', name: 'o07-students-distribute', url: '/students', actions: [{ clickRole: ['button', 'Новые ученики'] }, { wait: 600 }, { clickRole: ['button', 'Распределить'] }, { wait: 800 }] },
  { persona: 'owner', name: 'o07-student-profile', url: `/students/${S.otherStudent(0)}` },
  // §217 (board/069). Отчёт об успеваемости: экран в кабинете и лист для
  // родителя. Разница между ними ровно одна — внутренняя заметка
  // преподавателя, и на паре снимков `-report` / `-report-print` она должна
  // быть видна: в первом блок с жёлтой полосой есть, во втором его нет.
  // `media: 'print'` переключает носитель — без него печатный вид снять
  // нечем: лист живёт в портале и показывается правилами @media print.
  { persona: 'owner', name: 'o07-student-report', url: `/students/${S.otherStudent(0)}?tab=report`, actions: [{ wait: 900 }] },
  { persona: 'owner', name: 'o07-student-report-print', url: `/students/${S.otherStudent(0)}?tab=report`, media: 'print', actions: [{ wait: 900 }] },
  { persona: 'owner', name: 'o07-student-journal', url: `/students/${S.otherStudent(0)}/journal` },
  { persona: 'owner', name: 'o08-variants', url: '/variants' },
  { persona: 'owner', name: 'o08-variants-list', url: '/variants/all' },
  { persona: 'owner', name: 'o08-variants-exam', url: '/variants/exam/physics/ege' },
  // §187 (board/040): в фикстурах `test_variants` лежат вперемешку четыре
  // самостоятельных варианта и четыре носителя задач к уроку (`topic_id`
  // заполнен, `topicVariants`), причём носители свежее половины вариантов по
  // `updated_at`. На снимках «Тесты» и «Тесты → Физика ЕГЭ» на 1280 строк
  // «Задачи к уроку «…»» быть не должно, а на карточке «Физика ЕГЭ» — «4
  // теста», а не «8 тестов».
  { persona: 'owner', name: 'o08-variants', url: '/variants', width: 1280, height: 800, actions: [{ wait: 900 }] },
  { persona: 'owner', name: 'o08-variants-exam', url: '/variants/exam/physics/ege', width: 1280, height: 800, actions: [{ wait: 900 }] },
  { persona: 'owner', name: 'o08-variant-assign', url: `/variants/${S.variant(1)}/assign` },
  { persona: 'owner', name: 'o08-variant-assignments', url: `/variants/${S.variant(1)}/assignments` },
  { persona: 'owner', name: 'o08-variant-detail', url: `/variants/${S.variant(1)}` },
  { persona: 'owner', name: 'o08-variant-builder', url: '/variant-builder' },
  { persona: 'owner', name: 'o08-tests', url: '/tests' },
  { persona: 'owner', name: 'o08-test-detail', url: `/tests/${S.test(1)}` },
  { persona: 'owner', name: 'o09-notifications', url: '/notifications' },
  { persona: 'owner', name: 'o10-settings', url: '/settings' },
  { persona: 'owner', name: 'o11-teacher-dashboard', url: '/teacher' },
  { persona: 'owner', name: 'o12-groups', url: `/groups/${S.group}` },

  // ── 1280: лента шагов и карточка на компьютере (§175) ──
  { persona: 'student', name: 's04-topic-tasks', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 1280, height: 800, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 800 }] },
  { persona: 'student', name: 's04-topic-tasks-answered', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 1280, height: 800, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 800 }, { fill: ['input[aria-label="Ответ на задачу"]', '6'] }, { clickRole: ['button', 'Проверить'] }, { wait: 1000 }] },

  { persona: 'student', name: 's04-topic-tasks-wrong', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 1280, height: 800, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 800 }, { clickRole: ['button', 'Задача 4, есть попытки, не решена'] }, { wait: 400 }, { fill: ['input[aria-label="Ответ на задачу"]', '5'] }, { clickRole: ['button', /Проверить/] }, { wait: 1000 }] },

  // ── §182 (board/035): тема в списке курса — три сигнала вместо рубрик ──
  // Раздел «Механика»: шесть тем в разных состояниях (ДЗ вернули / на проверке /
  // принято с баллом / черновик / не сдано, задачи 3 из 7, 5 из 5, «Задачи: 12»,
  // 1 из 4, закрытая тема). Списочный вид и тот же раздел карточками; вид
  // запоминается в localStorage, поэтому каждая сцена сама жмёт переключатель.
  ...[[1280, 800], [390, 844]].map(([width, height]) => ({
    persona: 'student', name: 's03-course-topics', url: `/my-course/${S.group}`, width, height,
    actions: [{ clickSel: 'button:has-text("Механика: кинематика")' }, { wait: 800 }, { clickSel: '[data-testid="view-toggle-list"]' }, { wait: 500 }],
  })),
  { persona: 'student', name: 's03-course-topics-cards', url: `/my-course/${S.group}`, width: 1280, height: 800,
    actions: [{ clickSel: 'button:has-text("Механика: кинематика")' }, { wait: 800 }, { clickSel: '[data-testid="view-toggle-cards"]' }, { wait: 600 }] },

  // ── owner в предпросмотре «глазами ученика» (§178, board/031) ──
  // Переключатель в шапке на «Ученик», под шапкой жёлтая полоса; /dashboard
  // ведёт на ученический список курсов без каркаса; тема — ученическая
  // вёрстка с лентой задач из topic_tasks_for_staff, поле и кнопки выключены.
  { persona: 'ownerPreview', name: 'p01-switch', url: '/dashboard', width: 1280, height: 800, actions: [{ wait: 1000 }] },
  { persona: 'ownerPreview', name: 'p02-my-course', url: '/my-course', actions: [{ wait: 1000 }] },
  { persona: 'ownerPreview', name: 'p03-course', url: `/my-course/${S.group}`, actions: [{ wait: 1000 }] },
  { persona: 'ownerPreview', name: 'p04-topic-tasks', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 1280, height: 800, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 1000 }] },
  // Докрутка до поля ответа: видно выключенное поле и кнопки под условием.
  { persona: 'ownerPreview', name: 'p04-topic-tasks-input', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 1280, height: 800, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 1000 }, { eval: `document.querySelector('input[aria-label="Ответ на задачу"]')?.scrollIntoView({ block: 'center' })` }, { wait: 300 }], full: false },
  { persona: 'ownerPreview', name: 'p04-topic-tasks', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 1000 }] },
  { persona: 'ownerPreview', name: 'p04-topic-tasks-input', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 1000 }, { eval: `document.querySelector('input[aria-label="Ответ на задачу"]')?.scrollIntoView({ block: 'center' })` }, { wait: 300 }], full: false },
  { persona: 'ownerPreview', name: 'p04-topic-hw', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 1000 }] },
  // §179 (board/032): в предпросмотре задачи РАБОТАЮТ, но только в памяти
  // вкладки. Каждая сцена начинается с `goto` — то есть с обновления страницы,
  // и весь путь проходится заново: в логе после каждого перехода все семь
  // задач снова «не начата», а из RPC — только `topic_tasks_for_staff` и чистый
  // `preview_task_verdict`; ни `answer_topic_task`, ни `reveal_…`, ни `close_…`.
  // Неверный ответ на задачу 1 (5 ≠ 2): «Неверно · попытка 1», квадрат янтарный.
  ...[[390, 844], [1280, 800]].map(([width, height]) => ({ persona: 'ownerPreview', name: 'p04-topic-tasks-wrong', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 1000 }, { fill: ['input[aria-label="Ответ на задачу"]', '5'] }, { clickRole: ['button', /Проверить/] }, { wait: 1000 }, { eval: `document.querySelector('[data-testid="topic-task-wrong"]')?.scrollIntoView({ block: 'center' })` }, { wait: 300 }] })),
  // Верный ответ на задачу 2 (4 = 2·2) после неверного на первую: в ленте
  // сразу три состояния — янтарный, зелёный, серый; «Верно», «Решено 1 из 7».
  ...[[390, 844], [1280, 800]].map(([width, height]) => ({ persona: 'ownerPreview', name: 'p04-topic-tasks-answered', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 1000 }, { fill: ['input[aria-label="Ответ на задачу"]', '5'] }, { clickRole: ['button', /Проверить/] }, { wait: 800 }, { clickRole: ['button', 'Задача 2, не начата'] }, { wait: 400 }, { fill: ['input[aria-label="Ответ на задачу"]', '4'] }, { clickRole: ['button', /Проверить/] }, { wait: 1000 }, { eval: `document.querySelector('[data-testid="topic-task-card"]')?.scrollIntoView({ block: 'start' })` }, { wait: 300 }] })),
  // Разбор после неверной попытки — из `catalog_tasks`: поле исчезает, ответ и
  // разбор видны, внизу «Разобрал».
  ...[[390, 844], [1280, 800]].map(([width, height]) => ({ persona: 'ownerPreview', name: 'p04-topic-tasks-reveal', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 1000 }, { fill: ['input[aria-label="Ответ на задачу"]', '5'] }, { clickRole: ['button', /Проверить/] }, { wait: 800 }, { clickRole: ['button', /Посмотреть решение/] }, { wait: 1000 }, { eval: `[...document.querySelectorAll('[data-testid="topic-task-card"] button')].pop()?.scrollIntoView({ block: 'center' })` }, { wait: 300 }] })),
  // «Разобрал» → «Разобрана», квадрат 1 зелёный, «Решено 1 из 7» — в памяти.
  ...[[390, 844], [1280, 800]].map(([width, height]) => ({ persona: 'ownerPreview', name: 'p04-topic-tasks-closed', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 1000 }, { fill: ['input[aria-label="Ответ на задачу"]', '5'] }, { clickRole: ['button', /Проверить/] }, { wait: 800 }, { clickRole: ['button', /Посмотреть решение/] }, { wait: 1000 }, { clickRole: ['button', /Разобрал/] }, { wait: 1000 }] })),
  // «Отметить как сделанное» у группы «Теория» — переключатель в памяти:
  // «Отметил сам», таблица отметок не запрашивается.
  { persona: 'ownerPreview', name: 'p04-topic-mark', url: `/my-course/${S.group}/topic/${S.topic(1)}`, actions: [{ wait: 800 }, { clickSel: '[data-testid="topic-group-mark-theory"]' }, { wait: 600 }] },
  { persona: 'ownerPreview', name: 'p05-my-homework-stub', url: '/my-homework', actions: [{ wait: 800 }] },

  // ── «Мобильный вид» (§181, board/034) ──
  // Владелец на компьютере (1280×800) с включённым переключателем «Телефон»:
  // вместо кабинета — тёмная полоса и рамка 390×844 с тем же приложением
  // внутри. Внутри — телефонная вёрстка (шапка с «бургером»), потому что у
  // iframe свой viewport. `full: false`: оболочка `position: fixed`.
  { persona: 'ownerMobile', name: 'm01-course-program-topic', url: `/course-program?course=${S.course}`, width: 1280, height: 800, actions: [{ wait: 1500 }, { frameClick: 'Физика ЕГЭ 2027' }, { wait: 800 }, { frameClick: 'Равноускоренное прямолинейное' }, { wait: 1200 }], full: false },
  { persona: 'ownerMobile', name: 'm01-course-program-menu', url: `/course-program?course=${S.course}`, width: 1280, height: 800, actions: [{ wait: 1500 }, { frameClickSel: 'header button' }, { wait: 600 }], full: false },
  // Ноутбук 1280×720: рамка масштабируется, телефон виден целиком.
  { persona: 'ownerMobile', name: 'm01-course-program-topic-720', url: `/course-program?course=${S.course}`, width: 1280, height: 720, actions: [{ wait: 1500 }, { frameClick: 'Физика ЕГЭ 2027' }, { wait: 800 }, { frameClick: 'Равноускоренное прямолинейное' }, { wait: 1200 }], full: false },
  // «Ученик + телефон»: жёлтая полоса предпросмотра (§178) — внутри телефона.
  { persona: 'ownerPreviewMobile', name: 'm02-student-topic', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 1280, height: 800, actions: [{ wait: 1500 }], full: false },
  { persona: 'ownerPreviewMobile', name: 'm02-student-topic-tasks', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 1280, height: 800, actions: [{ wait: 1500 }, { frameClickSel: 'button:has-text("Задачи")' }, { wait: 1200 }, { frameEval: `document.querySelector('[data-testid="topic-task-card"]')?.scrollIntoView({ block: 'center' })` }, { wait: 300 }], full: false },
  // Переход внутри телефона подтягивает внешний адрес; «Выйти из мобильного
  // вида» возвращает обычный кабинет на том же экране (в логе `-> /students`).
  // Последняя в группе: после выхода «телефон» в контексте персоны выключен.
  { persona: 'ownerMobile', name: 'm03-exit-synced', url: '/admin', width: 1280, height: 800, actions: [{ wait: 1500 }, { frameClickSel: 'header button' }, { wait: 600 }, { frameClick: 'Ученики' }, { wait: 1200 }, { clickSel: '[data-testid="mobile-preview-exit"]' }, { wait: 1200 }] },

  // ── §183 (board/036): те же экраны на 1280 — доказательство, что правки
  // мобильной вёрстки не тронули компьютер. Сцены на 390 уже есть выше под
  // теми же именами; здесь дубли только по ширине.
  { persona: 'owner', name: 'o03-course-program-topic', url: `/course-program?course=${S.course}`, width: 1280, height: 800, actions: [{ click: 'Физика ЕГЭ 2027' }, { wait: 800 }, { click: 'Равноускоренное прямолинейное' }, { wait: 1200 }], full: false },
  { persona: 'owner', name: 'o07-student-profile', url: `/students/${S.otherStudent(0)}`, width: 1280, height: 800, actions: [{ wait: 900 }] },
  { persona: 'owner', name: 'o07-student-report', url: `/students/${S.otherStudent(0)}?tab=report`, width: 1280, height: 800, actions: [{ wait: 900 }] },
  { persona: 'owner', name: 'o07-student-report-print', url: `/students/${S.otherStudent(0)}?tab=report`, media: 'print', width: 1280, height: 800, actions: [{ wait: 900 }] },
  { persona: 'owner', name: 'o07-student-journal', url: `/students/${S.otherStudent(0)}/journal`, width: 1280, height: 800, actions: [{ wait: 900 }] },
  { persona: 'owner', name: 'o12-groups', url: `/groups/${S.group}`, width: 1280, height: 800, actions: [{ wait: 900 }] },
  { persona: 'student', name: 's04-topic', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 1280, height: 800, actions: [{ wait: 900 }] },
  { persona: 'student', name: 's05-my-homework', url: '/my-homework', width: 1280, height: 800, actions: [{ wait: 900 }] },

  // ── §190 (board/043): очередь проверки и окно проверки на 1280 — тем же
  // способом доказываем, что мобильные правки не тронули компьютер. Сцены на
  // 390 и 844×390 уже есть выше под теми же именами.
  { persona: 'owner', name: 'o06-queue', url: '/homework-queue', width: 1280, height: 800, actions: [{ wait: 900 }] },
  { persona: 'owner', name: 'o06-queue-filters', url: '/homework-queue', width: 1280, height: 800, actions: [{ clickSel: 'text=На доработке' }, { wait: 700 }] },
  { persona: 'owner', name: 'o06-review', url: '/homework-queue', width: 1280, height: 800, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }], full: false },

  // ── §204 (board/055): запись просмотра видео ──
  // Плеер Bunny харнесс не поднимает (внешние адреса обрываются), и это ровно
  // тот случай, который карточка называет главным: событий нет — значит, в
  // логе не должно быть ни одного `RPC video_watch_add`. Отметка
  // «Просмотрено» при этом рисуется по записанной строке `video_watch_daily`,
  // а не по тому, что вкладка открыта.
  ...[[390, 844], [1280, 800]].flatMap(([width, height]) => [
    // Видео темы 1: у ученика записано 840 из 900 — отметка есть.
    { persona: 'student', name: 's04-topic-video-watched', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Видео")' }, { wait: 1200 }, { eval: toWatchBadge }, { wait: 400 }] },
    // Видео темы 3: записи нет — отметки быть не должно.
    { persona: 'student', name: 's04-topic3-video-fresh', url: `/my-course/${S.group}/topic/${S.topic(3)}`, width, height, actions: [{ clickSel: 'button:has-text("Видео")' }, { wait: 1200 }, { eval: toWatchBadge }, { wait: 400 }] },
    // Тот же ролик карточкой рубрики «Теория» — второе место, где он живёт.
    { persona: 'student', name: 's04-topic-theory-video', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Теория")' }, { wait: 1200 }, { eval: toWatchBadge }, { wait: 400 }] },
    // Карточка ученика у преподавателя: минуты за неделю, всего и дата начала.
    { persona: 'owner', name: 'o07-student-video', url: `/students/${S.otherStudent(0)}`, width, height, actions: [{ wait: 1200 }, { eval: `document.querySelector('[data-testid="student-video-watch"]')?.scrollIntoView({ block: 'center' })` }, { wait: 400 }], full: false },
  ]),

  // ── §206 (board/057): кнопка «Скачать PDF» в разборе работы ──
  // Кнопка одна на обе двери, поэтому и сцен две: преподаватель в очереди
  // проверок и ученик в своих пометках. У ученика попытка возвращена на
  // доработку, то есть вердикт есть — без вердикта кнопки быть не должно.
  ...[[390, 844], [1280, 800]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o06-review-pdf', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }], full: false },
    { persona: 'student', name: 's04-topic-hw-pdf', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 1500 }, { clickSel: '[data-testid="hw-view-marks-button"]' }, { wait: 2500 }], full: false },
  ]),

  // ── §221 (072): пробник как урок в курсе ──
  // Ученик: раздел курса с четырьмя пробниками в разных состояниях (на своих
  // местах среди тем), затем каждый пробник — до начала, идёт (таймер от
  // server_now), подтверждение сдачи с пустым №9, отклонённый .dng, сдан,
  // результат. Преподаватель: настройка (окно, место, файлы, ключ) и таблица
  // §218 с авто-клетками первой части и работами учеников.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'student', name: 's221-program', url: `/my-course/${LESSON.group}`, width, height,
      actions: [{ clickSel: 'button:has-text("Первый блок")' }, { wait: 800 }, { clickSel: '[data-testid="view-toggle-list"]' }, { wait: 600 }] },
    { persona: 'student', name: 's221-upcoming', url: `/my-course/${LESSON.group}/mock/${LESSON.up}`, width, height, actions: [{ wait: 1200 }] },
    { persona: 'student', name: 's221-open', url: `/my-course/${LESSON.group}/mock/${LESSON.open}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'student', name: 's221-open-confirm', url: `/my-course/${LESSON.group}/mock/${LESSON.open}`, width, height,
      actions: [{ wait: 1200 }, { clickSel: '[data-testid="mock-lesson-submit"]' }, { wait: 400 }, { eval: `document.querySelector('[data-testid="mock-lesson-confirm"]')?.scrollIntoView({ block: 'center' })` }, { wait: 300 }], full: false },
    { persona: 'student', name: 's221-open-dng', url: `/my-course/${LESSON.group}/mock/${LESSON.open}`, width, height,
      actions: [{ wait: 1200 }, { files: ['raw.dng'] }, { wait: 800 }, { eval: `document.querySelector('[data-testid="mock-lesson-photos"]')?.scrollIntoView({ block: 'center' })` }, { wait: 300 }], full: false },
    { persona: 'student', name: 's221-submitted', url: `/my-course/${LESSON.group}/mock/${LESSON.sub}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'student', name: 's221-result', url: `/my-course/${LESSON.group}/mock/${LESSON.res}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'owner', name: 'o221-setup', url: `/mock-exams/${LESSON.up}/setup`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'owner', name: 'o221-grid', url: `/mock-exams/${LESSON.res}`, width, height, actions: [{ wait: 1500 }] },
    // Та же таблица, прокрученная к границе частей: авто-клетки №1–12, ручная
    // исправленная №11 во второй строке и ручная вторая часть.
    { persona: 'owner', name: 'o221-grid-parts', url: `/mock-exams/${LESSON.res}`, width, height,
      actions: [{ wait: 1500 }, { eval: `(() => { const sc = document.querySelector('[data-testid="mock-grid-scroll"]'); const c = document.getElementById('mx-c-0-7'); if (sc && c) sc.scrollLeft = c.closest('td').offsetLeft - sc.clientWidth / 3 })()` }, { wait: 300 }], full: false },
  ]),

  // ── §224 (073): монитор идущего пробника, раздел «Пробники», настройка без раздела ──
  // Монитор: группа из 16 выдуманных учеников, пробник идёт 47 минут
  // (9 пишут, 4 сдали, 1 ушёл, 2 не заходили) и пробник, закончившийся 5 минут
  // назад (догрузка фото). Ученик: главная курса — раздел «Пробники» над
  // разделами (идёт / ближайший / прошедшие, среди прошедших — «Тест» без
  // раздела, как на проде). Настройка — без полей «Раздел» и «Место».
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o224-monitor-run', url: `/mock-exams/${LIVE.run}`, width, height, actions: [{ wait: 1800 }] },
    { persona: 'owner', name: 'o224-monitor-grace', url: `/mock-exams/${LIVE.grace}`, width, height, actions: [{ wait: 1800 }] },
    { persona: 'student', name: 's224-section', url: `/my-course/${LESSON.group}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'owner', name: 'o224-setup', url: `/mock-exams/${LESSON.up}/setup`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'owner', name: 'o224-list-groups', url: '/mock-exams', width, height, actions: [{ wait: 1200 }, { clickSel: '[data-testid="mock-group-chip"]:has-text("11Б")' }, { wait: 500 }] },
  ]),

  // ── §224.2: сценарий владельца 26.09 — «ученик пробник не видит» ──
  // Курс с ОДНИМ разделом и одной пустой темой, пробник «№1» без раздела идёт,
  // осталось 7 минут. Каждый вход ученика в курс: «Мои курсы», кабинет, главная
  // курса, открытый раздел, страница темы (скриншот владельца был с неё), и то
  // же у владельца в предпросмотре «Ученик». Настройка — время «на сейчас».
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'student', name: 's2242-my-courses', url: '/my-course', width, height, actions: [{ wait: 1500 }] },
    { persona: 'student', name: 's2242-dashboard', url: '/student', width, height, actions: [{ wait: 1500 }] },
    { persona: 'student', name: 's2242-course', url: `/my-course/${SANDBOX.group}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'student', name: 's2242-course-module', url: `/my-course/${SANDBOX.group}`, width, height, actions: [{ wait: 1200 }, { clickSel: 'button:has-text("Основной")' }, { wait: 600 }] },
    { persona: 'student', name: 's2242-topic', url: `/my-course/${SANDBOX.group}/topic/${SANDBOX.topic}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'ownerPreview', name: 'p2242-course', url: `/my-course/${SANDBOX.group}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'ownerPreview', name: 'p2242-topic', url: `/my-course/${SANDBOX.group}/topic/${SANDBOX.topic}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'owner', name: 'o2242-setup-now', url: `/mock-exams/${SANDBOX.exam}/setup`, width, height,
      actions: [{ wait: 1500 }, { fill: ['[data-testid="mock-setup-start"]', new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16)] }, { wait: 400 }], full: false },
  ]),

  // ── §225: новый дизайн, шаг 1 (основа) — пары «было/стало» ──
  // Восемь экранов из задания на двух ширинах: главная преподавателя,
  // проверка работы, таблица пробника, карточка ученика, программа курса и
  // пробник у ученика, вход и меню на телефоне. Сцены только смотрят — ничего
  // не пишут, поэтому обе ширины можно гнать одним процессом.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'd225-teacher-home', url: '/teacher', width, height, actions: [{ wait: 1500 }] },
    { persona: 'owner', name: 'd225-review', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }], full: false },
    { persona: 'owner', name: 'd225-mock-grid', url: `/mock-exams/${LESSON.res}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'owner', name: 'd225-student-card', url: `/students/${S.otherStudent(0)}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'student', name: 'd225-course-program', url: `/my-course/${S.group}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'student', name: 'd225-mock-student', url: `/my-course/${LESSON.group}/mock/${LESSON.open}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'guest', name: 'd225-login', url: '/login', width, height },
    { persona: 'student', name: 'd225-student-menu', url: '/student', width, height, actions: [{ wait: 1200 }, { clickSel: 'header button[aria-label="Открыть меню"]' }, { wait: 600 }], full: false },
    { persona: 'owner', name: 'd225-staff-menu', url: '/homework-queue', width, height, actions: [{ wait: 1200 }, { clickSel: 'header button[aria-label="Открыть меню"]' }, { wait: 600 }], full: false },
  ]),

  // ── §226: новый дизайн, шаг 2 — экран «Проверка работы» ──
  // Пары «было/стало» на одних и тех же действиях. Выбор задания с замечанием
  // ИИ написан так, чтобы работать на обеих версиях: в новой строка задания
  // выбирается кликом (`data-has-suggestion`), в старой предложение ИИ стоит
  // под строкой всегда — до него докручиваем. «Не из очереди» — прямая ссылка
  // на работу, возвращённую на доработку, при открытой вкладке «Ждут
  // проверки»: её нет в видимом списке, и «N из M» со «Следующей» не будет.
  // Сцены ничего не пишут — обе ширины можно гнать одним процессом.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'd226-review', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }], full: false },
    { persona: 'owner', name: 'd226-review-ai', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: pickSuggestedTask }, { wait: 600 }], full: false },
    { persona: 'owner', name: 'd226-review-frames', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: pickTaskThree }, { wait: 800 }], full: false },
    { persona: 'owner', name: 'd226-review-link', url: `/homework-queue?attempt=${S.attempt(12)}`, width, height, actions: [{ wait: 3000 }], full: false },
    { persona: 'owner', name: 'd226-review-bottom', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: scrollReviewDown }, { wait: 700 }], full: false },
    { persona: 'student', name: 'd226-student-marks', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Домашнее задание")' }, { wait: 1200 }, { clickSel: '[data-testid="hw-view-marks-button"]' }, { wait: 2500 }], full: false },
  ]),

  // ── §227: новый дизайн, шаг 3 — «Таблица пробника» ──
  // Заполненная таблица (12 учеников: частичные, нули, «авто», не сверено,
  // одна пустая строка), пустая таблица, идущий пробник с монитором; на
  // телефоне — ещё таблица, прокрученная вправо (липкий «Ученик»). Сцены
  // ничего не пишут — обе ширины можно гнать одним процессом.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'd227-grid', url: `/mock-exams/${D227.grid}`, width, height, actions: [{ wait: 1800 }] },
    { persona: 'owner', name: 'd227-grid-empty', url: `/mock-exams/${D227.empty}`, width, height, actions: [{ wait: 1500 }] },
    { persona: 'owner', name: 'd227-monitor', url: `/mock-exams/${LIVE.run}`, width, height, actions: [{ wait: 1800 }] },
    { persona: 'owner', name: 'd227-grid-scrolled', url: `/mock-exams/${D227.grid}`, width, height, full: false,
      actions: [{ wait: 1800 }, { eval: `(() => { const sc = document.querySelector('[data-testid="mock-grid-scroll"]'); sc?.scrollIntoView({ block: 'start' }); if (sc) sc.scrollLeft = sc.scrollWidth })()` }, { wait: 300 }] },
    { persona: 'owner', name: 'd227-grid-dirty', url: `/mock-exams/${D227.grid}`, width, height, full: false,
      actions: [{ wait: 1800 }, { eval: `(() => { const i = document.getElementById('mx-c-4-14'); if (!i) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '1'); i.dispatchEvent(new Event('input', { bubbles: true })) })()` }, { wait: 400 }] },
    { persona: 'owner', name: 'd227-notify-confirm', url: `/mock-exams/${D227.grid}`, width, height, full: false,
      actions: [{ wait: 1800 }, { clickSel: '[data-testid="mock-grid-notify-all"]' }, { wait: 400 }] },
  ]),

  // ── §228: пробник v3 — макет МАКЕТ-ПРОБНИК-V3.html, экраны 1–4 ──
  // Форма «Новый пробник» заполняется действиями (название, две группы, дата,
  // время, условие, ключ вставкой строки из Excel) — ничего не отправляется.
  // Страница пробника (вкладки), проверка работы «ждёт проверки», «Работы» во
  // время окна (11Б, монитор §224); ученик — пункт «Пробники» и результат.
  // §229. Варианты и файлы: форма с тремя вариантами (у третьего нет условия —
  // «не назначить»), «Кому какой вариант», вкладка «Настройка» с дозагрузкой,
  // проверка с «Вариант 2» и критериями, PDF вместо фото листами; ученик пишет:
  // задания страницами, вкладки на телефоне, окно «Сдать работу», плитка PDF.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const form = [
      { wait: 1200 },
      { fill: ['[data-testid="mock-form-title"]', 'Пробник №7'] },
      { clickSel: '[data-testid="mock-form-group-chip"]:has-text("11А профиль")' },
      { fill: ['[data-testid="mock-form-date"]', '2026-10-10'] },
      { fill: ['[data-testid="mock-form-time"]', '10:00'] },
      { clickSel: '[data-testid="mock-form-variant-count"] [data-key="multi"]' },
      { clickSel: '[data-testid="mock-form-variant-add"]' },
      { wait: 300 },
      { chooseFiles: { clickSel: '[data-testid="mock-form-file-condition"] >> nth=0', files: ['variant.pdf'] } },
      { chooseFiles: { clickSel: '[data-testid="mock-form-file-criteria"] >> nth=0', files: ['criteria.pdf'] } },
      { chooseFiles: { clickSel: '[data-testid="mock-form-file-condition"] >> nth=1', files: ['variant.pdf'] } },
      { chooseFiles: { clickSel: '[data-testid="mock-form-file-solution"] >> nth=1', files: ['doc.pdf'] } },
      { clickSel: '[data-testid="mock-form-variant-key-summary"] >> nth=0' },
      { eval: `(() => { const i = document.querySelector('[data-testid="mock-form-key-input"]'); if (!i) return; const dt = new DataTransfer(); dt.setData('text/plain', '0,25\t-3\t8\t4\t17\t0,6\t112\t0,8\t\t5,5\t3\t-1'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })()` },
      { wait: 600 },
    ]
    // Под липкой шапкой кабинета — на 96 точек ниже.
    const toSel = (sel) => ({ eval: `(() => { const el = document.querySelector('${sel}'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96) })()` })
    const lesson = `/my-course/${LESSON.group}/mock/${LESSON.open}`
    return [
      { persona: 'owner', name: 'd229-new-variants', url: '/mock-exams/new', width, height, actions: [...form, toSel('[data-testid="mock-form-variants"]'), { wait: 300 }] },
      { persona: 'owner', name: 'd229-distribution', url: '/mock-exams/new', width, height, actions: [...form, toSel('[data-testid="mock-form-distribution"]'), { wait: 300 }] },
      { persona: 'owner', name: 'd229-setup', url: `/mock-exams/${D228.done}?tab=setup`, width, height, actions: [{ wait: 1800 }, toSel('[data-testid="mock-form-variants"]'), { wait: 300 }] },
      { persona: 'owner', name: 'd229-review-v2', url: `/mock-exams/${D228.done}/review/${D229.safin}`, width, height, actions: [{ wait: 1800 }, { clickSel: '[data-task-row="14"]' }, { wait: 400 }], full: false },
      { persona: 'owner', name: 'd229-review-pdf', url: `/mock-exams/${D228.done}/review/${D229.safin}`, width, height, actions: [{ wait: 1800 }, { clickSel: '[data-testid="mock-review-photo-tab"]:has-text("стр. 1")' }, { wait: 1500 }], full: false },
      { persona: 'owner', name: 'd229-grid', url: `/mock-exams/${D228.done}?tab=table`, width, height, actions: [{ wait: 1800 }], full: false },
      { persona: 'student', name: 's229-write', url: lesson, width, height, actions: [{ wait: 2500 }] },
      { persona: 'student', name: 's229-write-sheet', url: lesson, width, height, actions: [{ wait: 1500 }, { clickSel: '[data-testid="mock-lesson-tabs"] [data-key="sheet"]' }, { wait: 400 }, toSel('[data-testid="mock-lesson-tabs"]'), { wait: 300 }] },
      { persona: 'student', name: 's229-write-photos', url: lesson, width, height, actions: [{ wait: 1500 }, { clickSel: '[data-testid="mock-lesson-tabs"] [data-key="photos"]' }, { wait: 1500 }, toSel('[data-testid="mock-lesson-drop"]'), { wait: 300 }] },
      { persona: 'student', name: 's229-submit', url: lesson, width, height, full: false, actions: [{ wait: 2000 }, { clickSel: width > 1000 ? '[data-testid="mock-lesson-submit-top"]' : '[data-testid="mock-lesson-submit"]' }, { wait: 600 }] },
    ]
  }),
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'd228-new', url: '/mock-exams/new', width, height, actions: [
      { wait: 1200 },
      { fill: ['[data-testid="mock-form-title"]', 'Пробник №7'] },
      { clickSel: '[data-testid="mock-form-group-chip"]:has-text("11А профиль")' },
      { clickSel: '[data-testid="mock-form-group-chip"]:has-text("11Б")' },
      { fill: ['[data-testid="mock-form-date"]', '2026-10-10'] },
      { fill: ['[data-testid="mock-form-time"]', '10:00'] },
      { chooseFiles: { clickSel: '[data-testid="mock-form-file-condition"]', files: ['doc.pdf'] } },
      { eval: `(() => { const i = document.querySelector('[data-testid="mock-form-key-input"]'); if (!i) return; const dt = new DataTransfer(); dt.setData('text/plain', '0,25\t-3\t8\t4\t17\t0,6\t112\t0,8\t\t5,5\t3\t-1'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })()` },
      { wait: 400 }, { scroll: 0 },
    ] },
    { persona: 'owner', name: 'd228-page-works', url: `/mock-exams/${D228.done}`, width, height, actions: [{ wait: 1800 }] },
    { persona: 'owner', name: 'd228-page-table', url: `/mock-exams/${D228.done}?tab=table`, width, height, actions: [{ wait: 1800 }], full: false },
    { persona: 'owner', name: 'd228-page-setup', url: `/mock-exams/${D228.done}?tab=setup`, width, height, actions: [{ wait: 1800 }] },
    { persona: 'owner', name: 'd228-review', url: `/mock-exams/${D228.done}/review/${D228.garipov}`, width, height, actions: [{ wait: 1800 }], full: false },
    { persona: 'owner', name: 'd228-review-full', url: `/mock-exams/${D228.done}/review/${D228.garipov}`, width, height, actions: [{ wait: 1800 }, { clickSel: '[data-task-row="16"]' }, { wait: 300 }] },
    { persona: 'owner', name: 'd228-live-works', url: `/mock-exams/${LIVE.run}`, width, height, actions: [{ wait: 1800 }] },
    { persona: 'student', name: 's228-my-mocks', url: '/my-mock-exams', width, height, actions: [{ wait: 1800 }] },
    { persona: 'student', name: 's228-result', url: `/my-course/${LESSON.group}/mock/${LESSON.res}`, width, height, actions: [{ wait: 1800 }] },
  ]),

  // ── §230: хвосты пробника — окно сдачи на весь экран, подпись варианта,
  // метки варианта в «Работах» и мониторе, кнопка поддержки не закрывает
  // «Уведомить». Сцена подписи пишет (update) — по ширине отдельным процессом.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const toSel = (sel, gap = 96) => ({ eval: `(() => { const el = document.querySelector('${sel}'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - ${gap}) })()` })
    const toEnd = { eval: '(() => window.scrollTo(0, document.documentElement.scrollHeight))()' }
    // Таблица целиком в окне, её низ — у низа экрана, внутри прокручено вниз (и вправо на телефоне).
    const gridBottom = { eval: `(() => { const sc = document.querySelector('[data-testid="mock-grid-scroll"]'); if (!sc) return; sc.scrollTop = sc.scrollHeight; sc.scrollLeft = sc.scrollWidth; const r = sc.getBoundingClientRect(); window.scrollTo(0, r.bottom + window.scrollY - window.innerHeight + 8) })()` }
    const lesson = `/my-course/${LESSON.group}/mock/${LESSON.open}`
    return [
      { persona: 'student', name: 'd230-submit', url: lesson, width, height, full: false, actions: [{ wait: 2000 }, { clickSel: width > 1000 ? '[data-testid="mock-lesson-submit-top"]' : '[data-testid="mock-lesson-submit"]' }, { wait: 600 }] },
      { persona: 'owner', name: 'd230-setup-label', url: `/mock-exams/${D228.done}?tab=setup`, width, height, actions: [
        { wait: 1800 },
        { fill: ['[data-testid="mock-form-variant-label"] >> nth=0', 'Вариант А'] },
        { eval: '(() => document.activeElement?.blur())()' },
        { wait: 400 },
        toSel('[data-testid="mock-form-variants"]'), { wait: 300 },
      ] },
      { persona: 'owner', name: 'd230-new-label', url: '/mock-exams/new', width, height, actions: [
        { wait: 1200 },
        { fill: ['[data-testid="mock-form-title"]', 'Пробник №7'] },
        { clickSel: '[data-testid="mock-form-group-chip"]:has-text("11А профиль")' },
        { clickSel: '[data-testid="mock-form-variant-count"] [data-key="multi"]' },
        { clickSel: '[data-testid="mock-form-variant-add"]' },
        { wait: 300 },
        { fill: ['[data-testid="mock-form-variant-label"] >> nth=0', 'Вариант А'] },
        { fill: ['[data-testid="mock-form-variant-label"] >> nth=1', 'Вариант Б'] },
        { fill: ['[data-testid="mock-form-variant-label"] >> nth=2', 'Резерв'] },
        { wait: 300 },
        toSel('[data-testid="mock-form-variants"]'), { wait: 300 },
      ] },
      { persona: 'owner', name: 'd230-works-variants', url: `/mock-exams/${D228.done}`, width, height, actions: [{ wait: 1800 }, toSel('[data-testid="mock-works"]', 140), { wait: 300 }] },
      { persona: 'owner', name: 'd230-live-variants', url: `/mock-exams/${LIVE.run}`, width, height, actions: [{ wait: 1800 }, toSel('[data-testid="mock-works-live"]', 120), { wait: 300 }] },
      { persona: 'owner', name: 'd230-grid-rows', url: `/mock-exams/${D228.done}?tab=table`, width, height, full: false, actions: [{ wait: 1800 }, gridBottom, { wait: 400 }] },
      { persona: 'owner', name: 'd230-grid-end', url: `/mock-exams/${D228.done}?tab=table`, width, height, full: false, actions: [{ wait: 1800 }, toEnd, { wait: 400 }] },
      { persona: 'owner', name: 'd230-works-end', url: `/mock-exams/${D228.done}`, width, height, full: false, actions: [{ wait: 1800 }, toEnd, { wait: 400 }] },
      { persona: 'owner', name: 'd230-review-bar', url: `/mock-exams/${D228.done}/review/${D229.safin}`, width, height, full: false, actions: [{ wait: 1800 }] },
    ]
  }),

  // §232: вкладка «Видео» с двумя библиотеками Bunny — математика и физика с
  // данными; физика без ключа (персона ownerNoPhysicsKey) — спокойная пометка.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'v232-video-math', url: '/admin', width, height, actions: [{ clickRole: ['button', 'Видео'] }, { wait: 1200 }] },
    { persona: 'owner', name: 'v232-video-physics', url: '/admin', width, height, actions: [{ clickRole: ['button', 'Видео'] }, { wait: 1200 }, { clickSel: '[data-testid="video-library-switch"] button:has-text("Физика")' }, { wait: 400 }] },
    { persona: 'owner', name: 'v232-video-physics-heat', url: '/admin', width, height, actions: [{ clickRole: ['button', 'Видео'] }, { wait: 1200 }, { clickSel: '[data-testid="video-library-switch"] button:has-text("Физика")' }, { wait: 400 }, { click: 'Законы Ньютона' }, { wait: 800 }] },
    { persona: 'ownerNoPhysicsKey', name: 'v232-video-nokey', url: '/admin', width, height, actions: [{ clickRole: ['button', 'Видео'] }, { wait: 1200 }, { clickSel: '[data-testid="video-library-switch"] button:has-text("Физика")' }, { wait: 400 }] },
  ]),

  // §233: главная преподавателя v2 — с данными, пустая, после «Напомнить всем».
  // «Напомнить» пишет в фикстуры — гонять по ширине своим процессом (§211):
  //   node e2e/harness/tour.mjs d233 1280 ; node e2e/harness/tour.mjs d233 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'ownerTeacher', name: 'd233-home', url: '/teacher', width, height, actions: [{ wait: 1800 }] },
    { persona: 'ownerHomeEmpty', name: 'd233-home-empty', url: '/teacher', width, height, actions: [{ wait: 1800 }] },
    { persona: 'ownerTeacher', name: 'd233-home-reminded', url: '/teacher', width, height, actions: [
      { wait: 1800 }, { clickSel: '[data-testid="home-remind"]' }, { wait: 1500 },
      { eval: "document.querySelector('[data-testid=\"home-overdue\"]')?.scrollIntoView({ block: 'center' })" }, { wait: 300 },
    ] },
  ]),

  // §234: вкладка «Тренировка». Тема 9 — ФИПИ + три подтемы задачника, 1.15
  // скрыта учителем (ученик её не видит, учитель видит «скрыта»); тема 10 —
  // математика без тренировки, у неё не меняется ничего (нет ни «Тренировки»,
  // ни «Формат ЕГЭ»). Переключатель учителя пишет в фикстуры — гонять по
  // ширине своим процессом (§211):
  //   node e2e/harness/tour.mjs d234 1280 ; node e2e/harness/tour.mjs d234 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'student', name: 'd234-student-training', url: `/my-course/${S.group}/topic/${S.topic(9)}`, width, height, actions: [
      { wait: 1200 }, { clickSel: '[data-testid="topic-tab-training"]' }, { wait: 600 },
    ] },
    { persona: 'student', name: 'd234-student-lesson', url: `/my-course/${S.group}/topic/${S.topic(9)}`, width, height, actions: [
      { wait: 1200 }, { clickSel: '[data-testid="topic-tab-group-lesson"] button:has-text("Задачи")' }, { wait: 600 },
    ] },
    { persona: 'ownerPreview', name: 'd234-preview-training', url: `/my-course/${S.group}/topic/${S.topic(9)}`, width, height, actions: [
      { wait: 1200 }, { clickSel: '[data-testid="topic-tab-training"]' }, { wait: 600 },
    ] },
    { persona: 'owner', name: 'd234-teacher-editor', url: `/course-program?course=${S.course}`, width, height, full: false, actions: [
      { click: 'Физика ЕГЭ 2027' }, { wait: 800 }, { click: 'Кинематика. Баллистика' }, { wait: 1500 },
      { eval: `document.querySelector('[data-testid="topic-training-editor"]')?.scrollIntoView({ block: 'center' })` }, { wait: 400 },
    ] },
    { persona: 'student', name: 'd234-math-topic', url: `/my-course/${S.group2}/topic/${S.topic(10)}`, width, height, actions: [{ wait: 1200 }] },
  ]),

  // §234.1: задачник по математике — у подтемы один файл («Теория» или
  // «Задачи»); пустых строк «Дома»/«На уроке» быть не должно. Тема 11 курса
  // математики, подтемы 1.0 / 1.1 / 1.2.
  //   node e2e/harness/tour.mjs d2341 1280 ; node e2e/harness/tour.mjs d2341 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'student', name: 'd2341-math-student', url: `/my-course/${S.group2}/topic/${S.topic(11)}`, width, height, actions: [
      { wait: 1200 }, { clickSel: '[data-testid="topic-tab-training"]' }, { wait: 400 },
      { clickSel: '[data-testid="training-subtopic"][data-code="1.1"] button' }, { wait: 400 },
    ] },
    { persona: 'owner', name: 'd2341-math-teacher', url: `/course-program?course=${S.course2}`, width, height, full: false, actions: [
      { click: 'Математика ОГЭ' }, { wait: 800 }, { click: 'Задание 1. Планиметрия' }, { wait: 1500 },
      { eval: `document.querySelector('[data-testid="topic-training-editor"]')?.scrollIntoView({ block: 'center' })` }, { wait: 400 },
    ] },
  ]),

  // §235: «Решение: Рядом / Внизу» на экране проверки. Выбор живёт в
  // localStorage, а контекст браузера общий на персону и ширину — поэтому
  // каждая сцена выставляет его сама (`ls`) до открытия работы, иначе «Рядом»
  // после «Внизу» приехало бы уже «Внизу». В базу сцены не пишут.
  //   node e2e/harness/tour.mjs d235
  ...[[1280, 800], [1024, 768]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'd235-side', url: '/homework-queue', width, height, full: false, actions: [
      { ls: ['review:reference-placement', 'side'] }, { clickSel: 'button:has-text("Проверить")' }, { wait: 3000 },
    ] },
    { persona: 'owner', name: 'd235-below', url: '/homework-queue', width, height, full: false, actions: [
      { ls: ['review:reference-placement', 'side'] }, { clickSel: 'button:has-text("Проверить")' }, { wait: 2500 },
      { clickSel: '[data-testid="reference-placement-below"]' }, { wait: 1200 },
    ] },
  ]),
  { persona: 'owner', name: 'd235-side-show', url: '/homework-queue', width: 1280, height: 800, full: false, actions: [
    { ls: ['review:reference-placement', 'side'] }, { clickSel: 'button:has-text("Проверить")' }, { wait: 3000 },
    { eval: "document.querySelector('[data-testid=\"solution-reference-column-scroll\"]')?.scrollTo(0, 400)" }, { wait: 300 },
    { clickSel: '[data-testid="review-task-show-reference"]' }, { wait: 300 },
  ] },
  // Телефон: запомнено «Рядом», но на узком экране всегда «Внизу» и
  // переключателя нет; вторая сцена докручена до блока эталона.
  { persona: 'owner', name: 'd235-narrow', url: '/homework-queue', width: 390, height: 844, full: false, actions: [
    { ls: ['review:reference-placement', 'side'] }, { clickSel: 'button:has-text("Проверить")' }, { wait: 3000 },
  ] },
  { persona: 'owner', name: 'd235-narrow-ref', url: '/homework-queue', width: 390, height: 844, full: false, actions: [
    { ls: ['review:reference-placement', 'side'] }, { clickSel: 'button:has-text("Проверить")' }, { wait: 3000 },
    { eval: "document.querySelector('[data-testid=\"solution-reference-panel\"]')?.scrollIntoView({ block: 'start' })" }, { wait: 800 },
  ] },

  // §238: «светофор» в таблице заданий. Работа из 14 заданий (3 жёлтых, 11
  // зелёных) открывается прямой ссылкой; настройку «Зелёные» каждая сцена
  // выставляет сама (`ls`) — контекст браузера общий на персону и ширину.
  // В базу сцены не пишут.
  //   node e2e/harness/tour.mjs d238 1280 ; node e2e/harness/tour.mjs d238 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'd238-folded', url: `/homework-queue?attempt=${S.attempt(38)}`, width, height, full: false, actions: [
      { ls: ['review:greens', 'folded'] }, { goto: `/homework-queue?attempt=${S.attempt(38)}` }, { wait: 3000 },
      { eval: "document.querySelector('[data-testid=\"triage-strip\"]')?.scrollIntoView({ block: 'start' })" }, { wait: 400 },
    ] },
    { persona: 'owner', name: 'd238-open', url: `/homework-queue?attempt=${S.attempt(38)}`, width, height, full: false, actions: [
      { ls: ['review:greens', 'folded'] }, { goto: `/homework-queue?attempt=${S.attempt(38)}` }, { wait: 3000 },
      { clickSel: '[data-testid="triage-green-fold"]' }, { wait: 500 },
      { eval: "document.querySelector('[data-testid=\"triage-green-fold\"]')?.scrollIntoView({ block: 'center' })" }, { wait: 400 },
    ] },
    { persona: 'owner', name: 'd238-false-claim', url: `/homework-queue?attempt=${S.attempt(38)}`, width, height, full: false, actions: [
      { ls: ['review:greens', 'folded'] }, { goto: `/homework-queue?attempt=${S.attempt(38)}` }, { wait: 3000 },
      { eval: "document.querySelector('[data-testid=\"review-task-rootcheck\"]')?.scrollIntoView({ block: 'center' })" }, { wait: 400 },
    ] },
    { persona: 'owner', name: 'd238-admin-accuracy', url: '/admin', width, height, full: false, actions: [
      { wait: 1200 }, { clickRole: ['button', 'Учёба'] }, { wait: 1500 },
      { eval: "document.querySelector('[data-testid=\"ai-check-accuracy\"]')?.scrollIntoView({ block: 'center' })" }, { wait: 400 },
    ] },
  ]),

  // §239: разбор проверенной работы у ученика — свои фото с рамками учителя
  // прямо в разборе. Персоны `s239*` — один ученик в разных состояниях ДЗ
  // темы 1 (фикстуры `apply239`). В базу сцены не пишут.
  //   node e2e/harness/tour.mjs d239 1280 ; node e2e/harness/tour.mjs d239 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const hwTab = [{ clickSel: 'button[role="tab"]:has-text("Домашнее задание")' }, { wait: 2500 }]
    const toFeedback = { eval: "(() => { document.querySelector('[data-testid=\"attempt-feedback\"]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -84) })()" }
    const topic1 = `/my-course/${S.group}/topic/${S.topic(1)}`
    // Страницы грузятся лениво (IntersectionObserver): снимок всей страницы
    // её не прокручивает — проходим экран сверху вниз, чтобы всё загрузилось.
    const walk = { eval: '(async () => { for (let y = 0; y < document.body.scrollHeight; y += 350) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)) } })()' }
    return [
      ...['ret', 'acc', 'plain', 'nomarks', 'pdf', 'many'].map(k => ({
        persona: `s239${k}`, name: `d239-${k}`, url: topic1, width, height, actions: [...hwTab, walk, { wait: 2000 }, toFeedback, { wait: 800 }],
      })),
      // Вырезка под заданием и «Вся страница →»: просмотр открывается сразу на
      // странице 2 у рамки задания 7.
      { persona: 's239ret', name: 'd239-ret-open', url: topic1, width, height, full: false, actions: [
        ...hwTab, { clickSel: '[data-testid="feedback-task"][data-no="7"] [data-testid="feedback-open-page"]' }, { wait: 3500 },
      ] },
      // Нажатие на чип задания: на телефоне — к карточке, с 1024 — ещё и левая
      // колонка к его рамке.
      { persona: 's239many', name: 'd239-many-chip', url: topic1, width, height, full: false, actions: [
        ...hwTab, toFeedback, { wait: 2000 }, { clickSel: '[data-testid="feedback-chip"][data-no="10"]' }, { wait: 1500 },
      ] },
      { persona: 's239acc', name: 'd239-acc-solution', url: topic1, width, height, full: false, actions: [
        ...hwTab, { clickSel: '[data-testid="feedback-solution"]' }, { wait: 1500 },
      ] },
      // Учитель: свободная рамка → «к заданию №» (из строк таблицы работы).
      { persona: 'owner', name: 'd239-teacher-task', url: '/homework-queue', width, height, full: false, actions: [
        { clickSel: 'button:has-text("Проверить")' }, { wait: 2500 },
        { eval: "document.querySelector('[data-testid=\"review-page-1\"]')?.scrollIntoView({ block: 'start' })" }, { wait: 500 },
        { drag: { sel: '[data-testid="review-overlay-1"]', from: [0.1, 0.52], to: [0.7, 0.58] } }, { wait: 500 },
        { eval: "(() => { const el = document.querySelector('[data-testid=\"comment-task-select\"]'); if (!el) return; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(el, '15'); el.dispatchEvent(new Event('change', { bubbles: true })) })()" },
        { fill: ['[data-testid="comment-editor-text"]', 'Потерян процент во втором шаге'] }, { wait: 400 },
      ] },
    ]
  }),

  // §240: проверочная и контрольная по времени. Ученик — пять состояний макета
  // (+ «за 5 минут» — красный таймер); «сейчас» задаёт заглушка сервера на
  // персону (`apply240`), часы машины не влияют. Учитель — тип темы и окно в
  // настройках работы, сводка после закрытия, «Открыть заново», очередь с
  // плашками и фильтром, экран проверки КР без «Вернуть на доработку».
  // В базу сцены не пишут.
  //   node e2e/harness/tour.mjs d240 1280 ; node e2e/harness/tour.mjs d240 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const kr = `/my-course/${S.group}/topic/${KR.topic}`
    const toDone = { eval: "(() => { document.querySelector('[data-testid=\"timed-done\"]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -96) })()" }
    return [
      // Снимок экрана — докручен до работы (над ней шапка темы и вкладки),
      // полный снимок — вся страница.
      ...['before', 'live', 'warn', 'sent', 'missed'].map(k => ({
        persona: `s240${k}`, name: `d240-student-${k}`, url: kr, width, height, actions: [
          { wait: 2500 }, { eval: "(() => { document.querySelector('[data-testid=\"timed-work\"]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -140) })()" }, { wait: 400 },
        ],
      })),
      { persona: 's240done', name: 'd240-student-done', url: kr, width, height, actions: [{ wait: 3000 }, toDone, { wait: 600 }] },
      // Таймер держится на виду, пока ученик листает к своим фото.
      { persona: 's240live', name: 'd240-student-live-scrolled', url: kr, width, height, full: false, actions: [
        { wait: 2500 }, { eval: "document.querySelector('[data-testid=\"timed-photos\"]')?.scrollIntoView({ block: 'center' })" }, { wait: 500 },
      ] },
      { persona: 's240live', name: 'd240-student-live-confirm', url: kr, width, height, full: false, actions: [
        { wait: 2500 }, { clickSel: '[data-testid="timed-submit"]' }, { wait: 300 },
        { eval: "document.querySelector('[data-testid=\"timed-submit-confirm\"]')?.scrollIntoView({ block: 'center' })" }, { wait: 300 },
      ] },
      { persona: 'o240', name: 'd240-teacher-program', url: `/course-program?course=${S.course}`, width, height, actions: [
        { click: 'Физика ЕГЭ 2027' }, { wait: 1200 },
        { eval: "[...document.querySelectorAll('[data-testid=\"topic-kind-mark\"]')][0]?.scrollIntoView({ block: 'center' })" }, { wait: 400 },
      ] },
      { persona: 'o240', name: 'd240-teacher-settings', url: `/course-program?course=${S.course}`, width, height, full: false, actions: [
        { click: 'Физика ЕГЭ 2027' }, { wait: 1200 }, { click: 'Контрольная работа. Кинематика' }, { wait: 1200 },
        { eval: "document.querySelector('[data-testid=\"topic-kind\"]')?.scrollIntoView({ block: 'start' })" }, { wait: 400 },
      ] },
      { persona: 'o240', name: 'd240-teacher-settings-window', url: `/course-program?course=${S.course}`, width, height, full: false, actions: [
        { click: 'Физика ЕГЭ 2027' }, { wait: 1200 }, { click: 'Контрольная работа. Кинематика' }, { wait: 1200 },
        { wait: 800 },
        { eval: "document.querySelector('[data-testid=\"timed-window-editor\"]')?.scrollIntoView({ block: 'start' })" }, { wait: 500 },
      ] },
      { persona: 'o240', name: 'd240-teacher-reopen', url: `/course-program?course=${S.course}`, width, height, actions: [
        { click: 'Физика ЕГЭ 2027' }, { wait: 1200 },
        { clickSel: 'button:has-text("Домашние задания")' }, { wait: 1500 },
        { click: 'Контрольная работа. Кинематика' }, { wait: 600 },
        { clickSel: '[data-testid="hw-reopen"]' }, { wait: 400 },
        { eval: "document.querySelector('[data-testid=\"hw-reopen-form\"]')?.scrollIntoView({ block: 'center', inline: 'center' })" }, { wait: 400 },
      ] },
      { persona: 'o240', name: 'd240-queue', url: '/homework-queue', width, height, actions: [
        { ls: ['homework-queue:kind', 'all'] }, { goto: '/homework-queue' }, { wait: 1500 },
      ] },
      { persona: 'o240', name: 'd240-queue-kr', url: '/homework-queue', width, height, actions: [
        { ls: ['homework-queue:kind', 'control'] }, { goto: '/homework-queue' }, { wait: 1500 },
      ] },
      { persona: 'o240', name: 'd240-review-kr', url: `/homework-queue?attempt=${KR.attempt(2)}`, width, height, full: false, actions: [
        { ls: ['homework-queue:kind', 'all'] }, { goto: `/homework-queue?attempt=${KR.attempt(2)}` }, { wait: 3000 },
      ] },
    ]
  }),

  // §241: раздел «Контрольные, самостоятельные и пробники». Ученик — блоки по
  // типам, график, лист пробника и лист проверочной, идущая КР строкой
  // сверху, свёрнутые блоки, курс без работ (раздела нет); учитель — сводка по
  // классу над программой, каркас — только список. «Сейчас» — у сервера
  // (`apply241`). В базу сцены не пишут. Свёрнутая сцена у персоны последняя:
  // состояние блоков живёт в localStorage контекста.
  //   node e2e/harness/tour.mjs d241 1280 ; node e2e/harness/tour.mjs d241 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const course = `/my-course/${S.group}`
    const toSection = { eval: "(() => { document.querySelector('[data-testid=\"assessments-section\"]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80) })()" }
    const row = (t) => ({ clickSel: `[data-testid="assessments-row"]:has-text("${t}")` })
    const toSummary = { eval: "(() => { document.querySelector('[data-testid=\"course-assessments\"]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80) })()" }
    return [
      { persona: 's241', name: 'd241-student', url: course, width, height, actions: [{ wait: 2500 }, toSection, { wait: 400 }] },
      { persona: 's241', name: 'd241-student-chart-tip', url: course, width, height, full: false, actions: [
        { wait: 2500 }, { eval: "document.querySelector('[data-testid=\"mock-chart\"]')?.scrollIntoView({ block: 'center' })" }, { wait: 300 },
        { clickSel: '[data-testid="mock-chart-hit"] >> nth=3' }, { wait: 300 },
      ] },
      { persona: 's241', name: 'd241-student-sheet-mock', url: course, width, height, full: false, actions: [{ wait: 2500 }, toSection, row('Пробник №4'), { wait: 1200 }] },
      { persona: 's241', name: 'd241-student-sheet-kr', url: course, width, height, full: false, actions: [{ wait: 2500 }, toSection, row('Импульс и энергия'), { wait: 800 }] },
      { persona: 's241', name: 'd241-student-module', url: course, width, height, actions: [{ wait: 2500 }, { click: 'Механика: кинематика' }, { wait: 800 }] },
      { persona: 's241', name: 'd241-student-collapsed', url: course, width, height, actions: [
        { ls: [`course-assessments:collapsed:${S.group}`, '["mock","control","check"]'] }, { goto: course }, { wait: 2500 }, toSection, { wait: 400 },
      ] },
      { persona: 's241live', name: 'd241-student-live', url: course, width, height, actions: [{ wait: 2500 }, toSection, { wait: 400 }] },
      { persona: 's241empty', name: 'd241-student-empty', url: course, width, height, actions: [{ wait: 2500 }] },
      { persona: 'o241', name: 'd241-teacher', url: `/course-program?course=${S.course}`, width, height, actions: [
        { click: 'Физика ЕГЭ 2027' }, { wait: 1800 }, toSummary, { wait: 400 },
      ] },
      // «Кто пишет» у идущей КР — вкладка «Домашние задания» с раскрытой темой.
      { persona: 'o241', name: 'd241-teacher-who', url: `/course-program?course=${S.course}`, width, height, full: false, actions: [
        { click: 'Физика ЕГЭ 2027' }, { wait: 1800 }, { clickRole: ['button', 'Кто пишет'] }, { wait: 2000 },
      ] },
      { persona: 'o241', name: 'd241-template', url: '/course-program', width, height, actions: [
        { click: 'Физика ЕГЭ Шаблон' }, { wait: 1800 }, toSummary, { wait: 400 },
      ] },
    ]
  }),

  // §242: статистика курса у учителя на «Программе курса» — сводка за 7/30/всё
  // время, подсказка графика, по темам с раскрытой темой, по ученикам (порядок
  // по умолчанию и сортировка по видео), каркас без статистики. Период и разрез
  // каждая сцена выставляет сама (`ls`): localStorage общий на персону и ширину.
  //   node e2e/harness/tour.mjs d242 1280 ; node e2e/harness/tour.mjs d242 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const url = `/course-program?courseId=${S.course}`
    const prep = (period, view) => [{ ls: ['course-stats:period', period] }, { ls: ['course-stats:view', view] }, { goto: url }, { wait: 1800 }]
    const to = (sel) => ({ eval: `(() => { document.querySelector('${sel}')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -96) })()` })
    return [
      { persona: 'o242', name: 'd242-summary-7', url, width, height, actions: [...prep('7d', 'topics'), to('[data-testid="course-stats"]'), { wait: 300 }] },
      { persona: 'o242', name: 'd242-summary-30', url, width, height, actions: [...prep('7d', 'topics'), { clickSel: '[data-testid="stats-period"] button[data-key="30d"]' }, { wait: 800 }, to('[data-testid="course-stats"]'), { wait: 300 }] },
      { persona: 'o242', name: 'd242-summary-all', url, width, height, actions: [...prep('all', 'topics'), to('[data-testid="course-stats"]'), { wait: 300 }] },
      { persona: 'o242', name: 'd242-chart-tip', url, width, height, full: false, actions: [
        ...prep('7d', 'topics'), { eval: "document.querySelector('[data-testid=\"activity-chart\"]')?.scrollIntoView({ block: 'center' })" }, { wait: 300 },
        { clickSel: '[data-testid="activity-hit"] >> nth=26' }, { wait: 300 },
      ] },
      { persona: 'o242', name: 'd242-topics-open', url, width, height, actions: [
        ...prep('30d', 'topics'), { clickSel: '[data-testid="stats-topic-row"] >> nth=0 >> [data-expand]' }, { wait: 900 },
        to('[data-testid="stats-view"]'), { wait: 300 },
      ] },
      { persona: 'o242', name: 'd242-students', url, width, height, actions: [...prep('7d', 'students'), to('[data-testid="stats-view"]'), { wait: 300 }] },
      { persona: 'o242', name: 'd242-students-sort', url, width, height, actions: [
        ...prep('30d', 'students'), { clickSel: '[data-sort="video"]' }, { wait: 300 }, to('[data-testid="stats-view"]'), { wait: 300 },
      ] },
      { persona: 'o242', name: 'd242-template', url: '/course-program', width, height, actions: [
        { click: 'Физика ЕГЭ Шаблон' }, { wait: 1800 }, to('[data-testid="course-stats-template"]'), { wait: 300 },
      ] },
    ]
  }),

  // §243: «тема открыта = ДЗ выдано». Окно темы — блок «Домашнее задание»:
  // выдано (+ «Сводка ученикам уйдёт в …»), нет файлов, закрыта с датой;
  // раздел «Домашние задания» программы — без кнопок публикации и плашки,
  // статус у каждой темы. В базу сцены не пишут.
  //   node e2e/harness/tour.mjs d243 1280 ; node e2e/harness/tour.mjs d243 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const url = `/course-program?course=${S.course}`
    const toIssue = { eval: "(() => { document.querySelector('[data-testid=\"homework-issue\"]')?.scrollIntoView({ block: 'center' }); })()" }
    const topicHw = (title) => [
      { click: 'Физика ЕГЭ 2027' }, { wait: 1200 }, { click: title }, { wait: 1200 },
      { clickSel: '[data-testid="topic-tile-homework"]' }, { wait: 1200 }, toIssue, { wait: 400 },
    ]
    return [
      { persona: 'o243', name: 'd243-topic-issued', url, width, height, full: false, actions: topicHw('Равноускоренное прямолинейное движение') },
      { persona: 'o243', name: 'd243-topic-nofiles', url, width, height, full: false, actions: topicHw('Закон сохранения импульса') },
      { persona: 'o243', name: 'd243-topic-closed', url, width, height, full: false, actions: topicHw('Статика. Момент силы') },
      { persona: 'o243', name: 'd243-hw-section', url, width, height, actions: [
        { click: 'Физика ЕГЭ 2027' }, { wait: 1200 },
        { clickSel: 'button:has-text("Домашние задания")' }, { wait: 1800 },
        { eval: "(() => { document.querySelector('[data-testid=\"hw-section-issue\"]')?.closest('.space-y-2')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80) })()" }, { wait: 400 },
      ] },
    ]
  }),

  // §244: страница «Курсы» у учителя — по классам (по умолчанию), по
  // программам, «＋ Класс» (окно копирования шаблона), учитель без курсов,
  // администратор с чужими курсами. Вид каждая сцена выставляет сама (`ls`):
  // localStorage общий на персону и ширину. В базу сцены не пишут.
  //   node e2e/harness/tour.mjs d244 1280 ; node e2e/harness/tour.mjs d244 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const view = (v) => [{ ls: ['courses:view', v] }, { goto: '/course-program' }, { wait: 1200 }]
    return [
      { persona: 'o244', name: 'd244-classes', url: '/course-program', width, height, actions: view('classes') },
      { persona: 'o244', name: 'd244-programs', url: '/course-program', width, height, actions: [
        ...view('classes'), { clickRole: ['button', 'По программам'] }, { wait: 500 },
      ] },
      { persona: 'o244', name: 'd244-templates', url: '/course-program', width, height, full: false, actions: [
        ...view('classes'), { eval: "document.querySelector('[data-testid=\"courses-templates\"]')?.scrollIntoView({ block: 'start' })" }, { wait: 400 },
      ] },
      { persona: 'o244', name: 'd244-add-class', url: '/course-program', width, height, full: false, actions: [
        ...view('classes'), { clickSel: '[data-testid="template-add-class"]' }, { wait: 600 },
      ] },
      { persona: 'o244empty', name: 'd244-empty', url: '/course-program', width, height, actions: [{ wait: 1200 }] },
      { persona: 'o244admin', name: 'd244-admin', url: '/course-program', width, height, actions: view('classes') },
    ]
  }),

  // §246: главная «Каталога заданий» — ученик решает активно, «мало сравнения»,
  // новичок, учитель (§246.1: с двумя своими отметками, без сравнения); плюс подсказка столбика (фокус на №12 математики ЕГЭ).
  // Данные — одна заглушка `catalog_my_overview` (apply246). В базу сцены не пишут.
  //   node e2e/harness/tour.mjs d246 1280 ; node e2e/harness/tour.mjs d246 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 's246active', name: 'd246-active', url: '/catalog', width, height, actions: [{ wait: 1200 }] },
    { persona: 's246active', name: 'd246-tip', url: '/catalog', width, height, full: false, actions: [
      { wait: 1200 },
      { eval: "document.querySelector('[data-exam=\"Математика ЕГЭ\"]')?.scrollIntoView({ block: 'center' })" },
      { wait: 300 },
      { eval: "document.querySelector('[data-exam=\"Математика ЕГЭ\"] [data-testid=\"number-bar\"][data-n=\"12\"]')?.focus()" },
      { wait: 300 },
    ] },
    { persona: 's246few', name: 'd246-few', url: '/catalog', width, height, actions: [{ wait: 1200 }] },
    { persona: 's246new', name: 'd246-new', url: '/catalog', width, height, actions: [{ wait: 1200 }] },
    { persona: 'o246', name: 'd246-teacher', url: '/catalog', width, height, actions: [{ wait: 1200 }] },
  ]),

  // §248: спокойный экран проверки по утверждённому макету. Работа «светофора»
  // (attempt 38) — черновик ИИ с заметками по заданиям; attempt 2 — без ИИ
  // вовсе; первая в очереди (attempt 15) — пара «до/после» к o06-review-head.
  // В базу сцены не пишут: вердиктов не ставят, рамку только обводят.
  //   node e2e/harness/tour.mjs d248 1280 ; node e2e/harness/tour.mjs d248 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const open = id => [{ goto: `/homework-queue?attempt=${id}` }, { wait: 3000 }]
    const pick = no => [{ clickSel: `[data-testid="review-focus-cell"][data-no="${no}"]` }, { wait: 700 }]
    const toPanel = { eval: "document.querySelector('[data-testid=\"review-side-column\"]')?.scrollIntoView({ block: 'start' })" }
    return [
      { persona: 'owner', name: 'd248-queue-first', url: '/homework-queue', width, height, full: false, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 3000 }] },
      { persona: 'owner', name: 'd248-ai', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), ...pick('5')] },
      { persona: 'owner', name: 'd248-ai-panel', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), ...pick('9'), toPanel, { wait: 400 }] },
      { persona: 'owner', name: 'd248-noai', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(2)), toPanel, { wait: 400 }] },
      { persona: 'owner', name: 'd248-etalon', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), ...pick('9'), { clickSel: '[data-testid="attempt-reference-toggle"]' }, { wait: 1500 }] },
      { persona: 'owner', name: 'd248-menu', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), { clickSel: '[data-testid="attempt-more-menu"]' }, { wait: 500 }] },
      { persona: 'owner', name: 'd248-last', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), ...pick('14'), toPanel, { wait: 400 }] },
      { persona: 'owner', name: 'd248-remark', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), ...pick('9'), { clickSel: '[data-testid="review-focus-remark-toggle"]' }, { wait: 300 }, toPanel, { wait: 400 }] },
      { persona: 'owner', name: 'd248-draw', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), ...pick('12'), { drag: { sel: '[data-testid="review-overlay-1"]', from: [0.12, 0.2], to: [0.72, 0.28] } }, { wait: 600 }] },
      { persona: 'owner', name: 'd248-table', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), { clickSel: '[data-testid="attempt-more-menu"]' }, { wait: 300 }, { clickSel: '[data-testid="review-open-table"]' }, { wait: 800 }] },
      { persona: 'owner', name: 'd248-comment', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), { clickSel: '[data-testid="review-comment-edit"]' }, { wait: 500 }] },
    ]
  }),

  // §249: вкладка курса «Проверочные и контрольные» — работы со сводкой и журнал
  // «ученик × работа»: одна проверочная (как сейчас в 11А), несколько работ к
  // концу четверти, «Сначала слабые», нажатая оценка (строка с переходом к
  // работе), курс без работ. В базу сцены не пишут.
  //   node e2e/harness/tour.mjs d249 1280 ; node e2e/harness/tour.mjs d249 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const url = `/course-program?courseId=${S.course}&tab=assessments`
    const to = (sel) => ({ eval: `(() => { document.querySelector('${sel}')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -16) })()` })
    return [
      { persona: 'o249', name: 'd249-one', url, width, height, actions: [{ wait: 2000 }] },
      { persona: 'o249', name: 'd249-one-journal', url, width, height, full: false, actions: [{ wait: 2000 }, to('[data-testid="assessments-journal"]'), { wait: 300 }] },
      { persona: 'o249many', name: 'd249-many', url, width, height, actions: [{ wait: 2000 }] },
      { persona: 'o249many', name: 'd249-many-weak', url, width, height, full: false, actions: [
        { wait: 2000 }, { clickSel: '[data-testid="grades-sort"] button[data-key="weak"]' }, { wait: 300 }, to('[data-testid="assessments-journal"]'), { wait: 300 },
      ] },
      { persona: 'o249many', name: 'd249-many-scrolled', url, width, height, full: false, actions: [
        { wait: 2000 }, to('[data-testid="assessments-journal"]'), { eval: "document.querySelector('[data-testid=\"grades-scroll\"]').scrollLeft = 10000" }, { wait: 300 },
      ] },
      { persona: 'o249', name: 'd249-detail', url, width, height, full: false, actions: [
        { wait: 2000 }, { clickSel: '[data-testid="grades-cell"][data-state="wait"] >> nth=0' }, { wait: 300 }, to('[data-testid="assessments-journal"]'), { wait: 300 },
      ] },
      { persona: 'o249empty', name: 'd249-empty', url, width, height, actions: [{ wait: 2000 }] },
    ]
  }),

  // §250: вкладка «Курс» (разделы → раздел №13 → тема глазами ученика с полосой
  // учителя) и «Домашние задания» журналом (свёрнут; раскрыты №13 и №15, прокрутка
  // вбок; нажатая «ждёт»; «Сначала отстающие») и прежним видом «По темам». В базу
  // сцены не пишут.
  //   node e2e/harness/tour.mjs d250 1280 ; node e2e/harness/tour.mjs d250 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const C = 'd000000-0000-4000-8000-000000002500'
    const M13 = 'e000000-0000-4000-8000-000000002510'
    const T = '1000000-0000-4000-8000-000000026006'
    const base = `/course-program?courseId=${C}`
    const to = (sel) => ({ eval: `(() => { document.querySelector('${sel}')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -110) })()` })
    const openSec = (n) => ({ eval: `document.querySelectorAll('[data-testid="hw-section-toggle"]')[${n}]?.click()` })
    return [
      { persona: 'o250', name: 'd250-kurs', url: base, width, height, actions: [{ wait: 2500 }] },
      { persona: 'o250', name: 'd250-section', url: `${base}&module=${M13}`, width, height, actions: [{ wait: 2500 }] },
      { persona: 'o250', name: 'd250-topic', url: `${base}&module=${M13}&topic=${T}`, width, height, actions: [{ wait: 2500 }] },
      { persona: 'o250', name: 'd250-topic-hw', url: `${base}&module=${M13}&topic=${T}`, width, height, full: false, actions: [
        { wait: 2500 }, { clickSel: '[role="tab"]:has-text("Домашнее задание")' }, { wait: 800 }, to('[role="tablist"][aria-label="Разделы темы"]'), { wait: 300 },
      ] },
      { persona: 'o250', name: 'd250-dz', url: `${base}&tab=homework`, width, height, actions: [{ wait: 2500 }] },
      { persona: 'o250', name: 'd250-dz-open', url: `${base}&tab=homework`, width, height, full: false, actions: [
        { wait: 2500 }, openSec(7), { wait: 200 }, to('[data-testid="hw-table"]'), { wait: 300 },
      ] },
      { persona: 'o250', name: 'd250-dz-open-scrolled', url: `${base}&tab=homework`, width, height, full: false, actions: [
        { wait: 2500 }, openSec(7), openSec(8), { wait: 200 }, to('[data-testid="hw-table"]'),
        { eval: "document.querySelector('[data-testid=\"hw-scroll\"]').scrollLeft = document.querySelector('[data-testid=\"hw-section-toggle\"][aria-expanded=\"true\"]').closest('th').offsetLeft - 180" }, { wait: 300 },
      ] },
      { persona: 'o250', name: 'd250-dz-detail', url: `${base}&tab=homework`, width, height, full: false, actions: [
        { wait: 2500 }, openSec(7), { wait: 200 }, { clickSel: '[data-testid="hw-cell"][data-state="wait"] >> nth=0' }, { wait: 300 }, to('[data-testid="hw-detail"]'), { wait: 300 },
      ] },
      { persona: 'o250', name: 'd250-dz-behind', url: `${base}&tab=homework`, width, height, full: false, actions: [
        { wait: 2500 }, { clickSel: '[data-testid="hw-sort-behind"]' }, { wait: 300 }, to('[data-testid="hw-table"]'), { wait: 300 },
      ] },
      { persona: 'o250', name: 'd250-dz-topics', url: `${base}&tab=homework`, width, height, actions: [
        { wait: 2500 }, { clickSel: '[data-testid="hw-view"] button[data-key="topics"]' }, { wait: 1500 },
      ] },
    ]
  }),

  // §252: пометки ИИ уходят ученику при вердикте. Учитель (o252): галочка над
  // «Принять», список в колонке заданий, «посмотреть на фото», убранная
  // крестиком находка, работа без подходящих находок (строки нет) и «Принять»
  // с тостом. Потом тот же ученик (s252) видит рамки ИИ на фото и в «По
  // заданиям». Сцены ПИШУТ в базу и идут по порядку — каждую ширину своим
  // процессом:
  //   node e2e/harness/tour.mjs d252 1280 ; node e2e/harness/tour.mjs d252 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const open = id => [{ goto: `/homework-queue?attempt=${id}` }, { wait: 3000 }]
    const toList = { eval: "document.querySelector('[data-testid=\"ai-marks-list\"]')?.scrollIntoView({ block: 'center' })" }
    const toBar = { eval: "document.querySelector('[data-testid=\"ai-marks-toggle\"]')?.scrollIntoView({ block: 'end' })" }
    const hwTab = [{ clickSel: 'button[role="tab"]:has-text("Домашнее задание")' }, { wait: 2500 }]
    const walk = { eval: '(async () => { for (let y = 0; y < document.body.scrollHeight; y += 350) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)) } })()' }
    const toFeedback = { eval: "(() => { document.querySelector('[data-testid=\"attempt-feedback\"]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -84) })()" }
    const toTask = no => ({ eval: `(() => { document.querySelector('[data-testid="feedback-task"][data-no="${no}"]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -84) })()` })
    const topic1 = `/my-course/${S.group}/topic/${S.topic(1)}`
    return [
      { persona: 'o252', name: 'd252-review', url: '/homework-queue', width, height, full: false, actions: [...open(D252.a), toBar, { wait: 300 }] },
      { persona: 'o252', name: 'd252-list', url: '/homework-queue', width, height, full: false, actions: [...open(D252.a), toList, { wait: 400 }] },
      { persona: 'o252', name: 'd252-look', url: '/homework-queue', width, height, full: false, actions: [...open(D252.a), { clickSel: '[data-testid="ai-marks-look"]' }, { wait: 1500 }] },
      { persona: 'o252', name: 'd252-removed', url: '/homework-queue', width, height, full: false, actions: [
        ...open(D252.a), toList, { wait: 300 },
        { clickSel: '[data-testid="ai-marks-item"]:has-text("множитель 2") [data-testid="ai-marks-remove"]' }, { wait: 400 }, toList, { wait: 300 },
      ] },
      { persona: 'o252', name: 'd252-removed-bar', url: '/homework-queue', width, height, full: false, actions: [
        ...open(D252.a), { clickSel: '[data-testid="ai-marks-item"]:has-text("множитель 2") [data-testid="ai-marks-remove"]' }, { wait: 400 }, toBar, { wait: 300 },
      ] },
      { persona: 'o252', name: 'd252-unchecked', url: '/homework-queue', width, height, full: false, actions: [
        ...open(D252.a), { clickSel: '[data-testid="ai-marks-checkbox"]' }, { wait: 300 }, toList, { wait: 300 },
      ] },
      { persona: 'o252', name: 'd252-none', url: '/homework-queue', width, height, full: false, actions: [...open(D252.b), toList, { wait: 400 }] },
      // Пишет: вердикт по работе A с галочкой (все пять подходящих находок, кроме №10 «верно»).
      { persona: 'o252', name: 'd252-accept', url: '/homework-queue', width, height, full: false, actions: [
        ...open(D252.a), { clickSel: '[data-testid="review-accept-button"]' }, { wait: 900 },
      ] },
      { persona: 's252', name: 'd252-student', url: topic1, width, height, actions: [...hwTab, walk, { wait: 2000 }, toFeedback, { wait: 800 }] },
      { persona: 's252', name: 'd252-student-task', url: topic1, width, height, full: false, actions: [...hwTab, walk, { wait: 1500 }, toTask('4'), { wait: 800 }] },
      { persona: 's252', name: 'd252-student-open', url: topic1, width, height, full: false, actions: [
        ...hwTab, { clickSel: '[data-testid="feedback-task"][data-no="12"] [data-testid="feedback-open-page"]' }, { wait: 3500 },
      ] },
    ]
  }),

  // §253: отчёты по физике ушли из сборки (useCatalog 1,1 МБ → 43 КБ), а страница
  // темы во вкладке «Курс» учителя грузится лениво. Внешне ничего не меняется —
  // сцены для сверки «до/после»: тема каталога физики с метками сложности, задачи
  // темы ученика и тема во вкладке «Курс». В базу сцены не пишут.
  //   node e2e/harness/tour.mjs d253 1280 ; node e2e/harness/tour.mjs d253 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const kurs = '/course-program?courseId=d000000-0000-4000-8000-000000002500&module=e000000-0000-4000-8000-000000002510&topic=1000000-0000-4000-8000-000000026006'
    return [
      { persona: 'student', name: 'd253-catalog-topic', url: `/catalog/${S.section(1)}/topic/${S.ctopic(2)}?subject=physics&exam=ege`, width, height, actions: [{ wait: 1500 }] },
      { persona: 'owner', name: 'd253-catalog-section', url: `/catalog/${S.section(1)}?subject=physics&exam=ege`, width, height, actions: [{ wait: 1500 }] },
      { persona: 'student', name: 'd253-topic-tasks', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width, height, actions: [{ clickSel: 'button:has-text("Задачи")' }, { wait: 1200 }] },
      { persona: 'o250', name: 'd253-kurs-topic', url: kurs, width, height, actions: [{ wait: 2500 }] },
    ]
  }),

  // §254: главная ученика — кнопки-счётчики, серия, задачи по неделям, «Мои курсы».
  // Персоны `s254*` (фикстуры `apply254`, даты от настоящего «сегодня»). Ничего
  // не пишут, обе ширины можно одним процессом: node e2e/harness/tour.mjs d254
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 's254', name: 'd254-home', url: '/student', width, height, actions: [{ wait: 1500 }] },
    { persona: 's254', name: 'd254-home-tip', url: '/student', width, height, full: false, actions: [{ wait: 1200 }, { eval: 'document.querySelector("[data-testid=activity-calendar] [data-today]").scrollIntoView({ block: "center" })' }, { focus: '[data-testid=activity-calendar] [data-today]' }, { wait: 300 }] },
    { persona: 's254', name: 'd254-home-weeks-tip', url: '/student', width, height, full: false, actions: [{ wait: 1200 }, { eval: 'document.querySelector("[data-testid=week-bars] li:nth-child(9)").scrollIntoView({ block: "center" })' }, { focus: '[data-testid=week-bars] li:nth-child(9)' }, { wait: 300 }] },
    { persona: 's254ret', name: 'd254-home-returned', url: '/student', width, height, actions: [{ wait: 1500 }] },
    { persona: 's254clear', name: 'd254-home-clear', url: '/student', width, height, actions: [{ wait: 1500 }] },
    { persona: 's254new', name: 'd254-home-new', url: '/student', width, height, actions: [{ wait: 1500 }] },
    { persona: 's254', name: 'd254-hw-overdue', url: '/student', width, height, actions: [{ wait: 1200 }, { clickSel: '[data-testid=home-action-overdue]' }, { wait: 1500 }] },
    { persona: 's254', name: 'd254-hw-soon', url: '/student', width, height, actions: [{ wait: 1200 }, { clickSel: '[data-testid=home-action-soon]' }, { wait: 1500 }] },
    { persona: 's254', name: 'd254-hw-checked', url: '/student', width, height, actions: [{ wait: 1200 }, { clickSel: '[data-testid=home-action-checked]' }, { wait: 1500 }] },
    { persona: 's254ret', name: 'd254-hw-returned', url: '/student', width, height, actions: [{ wait: 1200 }, { clickSel: '[data-testid=home-action-returned]' }, { wait: 1500 }] },
    { persona: 's254new', name: 'd254-hw-later', url: '/my-homework?show=later', width, height, actions: [{ wait: 1500 }] },
    { persona: 's254', name: 'd254-hw-nodue', url: '/student', width, height, actions: [{ wait: 1200 }, { click: 'Без срока: 1' }, { wait: 1500 }] },
  ]),
  // Тёмная тема — один снимок: в проекте её нет (Tailwind без darkMode, §248),
  // снимок показывает, что при системной тёмной теме главная читается.
  { persona: 's254', name: 'd254-home-dark', url: '/student', width: 390, height: 844, colorScheme: 'dark', actions: [{ wait: 1500 }] },

  // §255: «Примерный балл на ЕГЭ», «Баллы школы», «N дней до ЕГЭ». Персоны
  // `s255*` (фикстуры `apply255`). Сцена ввода цели пишет в фикстуры процесса —
  // гонять по ширине отдельно: node e2e/harness/tour.mjs d255 1280 ; … d255 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 's255', name: 'd255-home', url: '/student', width, height, actions: [{ wait: 1500 }] },
    { persona: 's255', name: 'd255-forecast-math', url: '/student', width, height, full: false, actions: [{ wait: 1500 }, { eval: 'document.querySelector("[data-testid=forecast-card]").scrollIntoView({ block: "start" }); window.scrollBy(0, -110)' }, { wait: 200 }] },
    { persona: 's255', name: 'd255-forecast-physics', url: '/student', width, height, full: false, actions: [{ wait: 1500 }, { eval: 'document.querySelector("[data-testid=forecast-card]").scrollIntoView({ block: "start" }); window.scrollBy(0, -110)' }, { wait: 200 }, { clickSel: '[data-testid=forecast-subject-physics]' }, { wait: 300 }] },
    { persona: 's255', name: 'd255-kim-tip', url: '/student', width, height, full: false, actions: [{ wait: 1500 }, { eval: 'document.querySelector("[data-testid=kim-part1] [data-n=\'6\']").scrollIntoView({ block: "center" })' }, { focus: '[data-testid=kim-part1] [data-n="6"]' }, { wait: 300 }] },
    { persona: 's255', name: 'd255-goal', url: '/student', width, height, full: false, actions: [{ wait: 1500 }, { clickSel: '[data-testid=forecast-subject-physics]' }, { clickSel: '[data-testid=forecast-goal-edit]' }, { fill: ['[data-testid=forecast-goal-input]', '120'] }, { clickSel: '[data-testid=forecast-goal-form] button[type=submit]' }, { wait: 200 }, { eval: 'document.querySelector("[data-testid=forecast-goal-form]").scrollIntoView({ block: "center" })' }, { wait: 200 }] },
    { persona: 's255', name: 'd255-goal-saved', url: '/student', width, height, full: false, actions: [{ wait: 1500 }, { clickSel: '[data-testid=forecast-subject-physics]' }, { clickSel: '[data-testid=forecast-goal-edit]' }, { fill: ['[data-testid=forecast-goal-input]', '70'] }, { clickSel: '[data-testid=forecast-goal-form] button[type=submit]' }, { wait: 500 }, { eval: 'document.querySelector("[data-testid=forecast-scale]").scrollIntoView({ block: "center" })' }, { wait: 200 }] },
    { persona: 's255', name: 'd255-points', url: '/student', width, height, full: false, actions: [{ wait: 1500 }, { eval: 'document.querySelector("[data-testid=points-card]").scrollIntoView({ block: "center" })' }, { focus: '[data-badge=forecast5]' }, { wait: 300 }] },
    { persona: 's255few', name: 'd255-few', url: '/student', width, height, actions: [{ wait: 1500 }] },
    { persona: 'owner', name: 'd255-teacher-goal', url: `/students/${S.otherStudent(0)}`, width, height, full: false, actions: [{ wait: 1200 }, { eval: 'document.querySelector("[data-testid=student-subject-targets]").scrollIntoView({ block: "center" })' }, { wait: 200 }] },
  ]),

  // §256: каталог поднимает прогноз — задача дня, цель недели, «Решите в каталоге», проверка
  // ответа в каталоге (верно / неверно / ответ открыт), таблица наград, раздел, учитель.
  // Персона `s256` (фикстуры `apply256`, состояние попыток — на процесс). Сцены ПИШУТ —
  // каждую ширину своим процессом: node e2e/harness/tour.mjs d256 1280 ; … d256 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const topic = '/catalog/d000000-0000-4000-8000-000000002566/topic/d000000-0000-4000-8000-000000002600?subject=math&exam=ege'
    const task = (k) => `[data-task-id="d000000-0000-4000-8000-0000000026${10 + k}"]`
    const toTask = (k) => ({ eval: `document.querySelector('${task(k)}').scrollIntoView({ block: "center" })` })
    return [
      { persona: 's256', name: 'd256-home', url: '/student', width, height, actions: [{ wait: 1600 }] },
      { persona: 's256', name: 'd256-home-forecast', url: '/student', width, height, full: false, actions: [{ wait: 1600 }, { eval: 'document.querySelector("[data-testid=forecast-catalog]").scrollIntoView({ block: "center" })' }, { wait: 200 }] },
      { persona: 's256', name: 'd256-home-daily-bad', url: '/student', width, height, full: false, actions: [{ wait: 1600 }, { fill: ['[data-testid=daily-task-card] [data-testid=task-answer-input]', '4'] }, { clickSel: '[data-testid=daily-task-card] [data-testid=task-answer-submit]' }, { wait: 600 }, { eval: 'document.querySelector("[data-testid=daily-task-card]").scrollIntoView({ block: "start" }); window.scrollBy(0, -20)' }] },
      { persona: 's256', name: 'd256-home-daily-ok', url: '/student', width, height, full: false, actions: [{ wait: 1600 }, { fill: ['[data-testid=daily-task-card] [data-testid=task-answer-input]', '5'] }, { clickSel: '[data-testid=daily-task-card] [data-testid=task-answer-submit]' }, { wait: 900 }, { eval: 'document.querySelector("[data-testid=daily-task-card]").scrollIntoView({ block: "start" }); window.scrollBy(0, -20)' }, { wait: 200 }] },
      { persona: 's256', name: 'd256-task', url: topic, width, height, actions: [{ wait: 1800 }] },
      { persona: 's256', name: 'd256-task-bad', url: topic, width, height, full: false, actions: [{ wait: 1800 }, toTask(3), { fill: [`${task(3)} [data-testid=task-answer-input]`, '6'] }, { clickSel: `${task(3)} [data-testid=task-answer-submit]` }, { wait: 600 }, toTask(3)] },
      { persona: 's256', name: 'd256-task-ok', url: topic, width, height, full: false, actions: [{ wait: 1800 }, toTask(1), { fill: [`${task(1)} [data-testid=task-answer-input]`, '7'] }, { clickSel: `${task(1)} [data-testid=task-answer-submit]` }, { wait: 1000 }, toTask(1)] },
      { persona: 's256', name: 'd256-task-revealed', url: topic, width, height, full: false, actions: [{ wait: 1800 }, toTask(4), { clickSel: `${task(4)} [data-testid=task-show-answer]` }, { wait: 500 }, { fill: [`${task(4)} [data-testid=task-answer-input]`, '2'] }, { clickSel: `${task(4)} [data-testid=task-answer-submit]` }, { wait: 700 }, toTask(4)] },
      { persona: 's256', name: 'd256-rewards', url: topic, width, height, full: false, actions: [{ wait: 1800 }, { clickSel: '[data-testid=catalog-rewards-toggle]' }, { wait: 300 }, { eval: 'document.querySelector("[data-testid=catalog-rewards-table]").scrollIntoView({ block: "center" })' }, { wait: 200 }] },
      { persona: 's256', name: 'd256-section', url: '/catalog/d000000-0000-4000-8000-000000002566?subject=math&exam=ege', width, height, actions: [{ wait: 1600 }] },
      { persona: 's256', name: 'd256-home-after', url: '/student', width, height, actions: [{ wait: 1600 }] },
      { persona: 'o256', name: 'd256-teacher', url: `/students/${S.otherStudent(0)}`, width, height, full: false, actions: [{ wait: 1400 }, { eval: 'document.querySelector("[data-testid=student-catalog-week]").scrollIntoView({ block: "center" })' }, { wait: 200 }] },
    ]
  }),

  // §257: «Достижения» вместо «Мой прогресс» — все / полученные / ближайшие / одна категория,
  // подсказка «как получить», подробная статистика; главная с последними наградами и
  // счётчиком в меню, тост новой награды (s257new — один раз на процесс), учитель.
  // Сцены пишут (seen) — каждую ширину своим процессом: node e2e/harness/tour.mjs d257 1280 ; … d257 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 's257', name: 'd257-home', url: '/student', width, height, full: false, actions: [{ wait: 1800 }, { eval: 'document.querySelector("[data-testid=points-card]").scrollIntoView({ block: "center" })' }, { wait: 200 }] },
    ...(width === 390 ? [{ persona: 's257', name: 'd257-menu', url: '/student', width, height, full: false, actions: [{ wait: 1500 }, { clickSel: '[aria-label="Открыть меню"]' }, { wait: 500 }, { eval: 'document.querySelector("aside nav").scrollTop = 400' }, { wait: 200 }] }] : []),
    { persona: 's257', name: 'd257-ach', url: '/achievements', width, height, actions: [{ wait: 1800 }] },
    { persona: 's257', name: 'd257-ach-done', url: '/achievements', width, height, actions: [{ wait: 1500 }, { clickSel: '[data-filter=done]' }, { wait: 300 }] },
    { persona: 's257', name: 'd257-ach-near', url: '/achievements', width, height, actions: [{ wait: 1500 }, { clickSel: '[data-filter=near]' }, { wait: 300 }] },
    { persona: 's257', name: 'd257-ach-cat', url: '/achievements', width, height, actions: [{ wait: 1500 }, { clickSel: '[data-filter=streak]' }, { wait: 300 }] },
    { persona: 's257', name: 'd257-ach-tip', url: '/achievements', width, height, full: false, actions: [{ wait: 1500 }, { eval: 'document.querySelector("[data-key=\'catalog:50\']").scrollIntoView({ block: "center" })' }, { focus: '[data-key="catalog:50"]' }, { wait: 300 }] },
    { persona: 's257', name: 'd257-ach-details', url: '/achievements', width, height, full: false, actions: [{ wait: 1500 }, { clickSel: '[data-testid=ach-details] summary' }, { wait: 300 }, { eval: 'window.scrollTo(0, document.body.scrollHeight)' }, { wait: 300 }] },
    { persona: 's257new', name: 'd257-home-toast', url: '/student', width, height, full: false, actions: [{ wait: 1800 }] },
    { persona: 's257', name: 'd257-journal', url: '/my-journal', width, height, actions: [{ wait: 1500 }] },
    { persona: 'o257', name: 'd257-teacher', url: `/students/${S.otherStudent(0)}`, width, height, full: false, actions: [{ wait: 1400 }, { eval: 'document.querySelector("[data-testid=student-achievements-line]").scrollIntoView({ block: "center" })' }, { wait: 200 }] },
  ]),

  // §258: честные замки. Учитель во вкладке «Курс» смотрит проверочную до окна «как ученик»: вкладки с замками,
  // заглушки «Условие откроется …» и «Ответы и критерии пока закрыты», строка-пояснение под полосой учителя;
  // окно «Редактировать тему» с полем «Название темы» (сохранение — PATCH topics, пустое — ошибка). Ученик (контрольная §240): до начала — «Условие» с замком,
  // сдал и ждёт — критерии закрыты, после «Принято» — открыты. Пишет только `-title-saved` (PATCH; фикстуры
  // PATCH не применяют, следующая сцена видит прежнее название). Каждую ширину своим процессом:
  //   node e2e/harness/tour.mjs d258 1280 ; node e2e/harness/tour.mjs d258 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const kurs = `/course-program?courseId=${D258.course}&module=${D258.module}&topic=${D258.topic}`
    const kr = `/my-course/${S.group}/topic/${KR.topic}`
    // Плашка предпросмотра (или ряд вкладок у ученика) — под шапку приложения.
    const toTabs = { eval: "(() => { (document.querySelector('[data-testid=\"topic-preview-locks\"]') ?? document.querySelector('[role=\"tablist\"][aria-label=\"Разделы темы\"]'))?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -84) })()" }
    // Окно «Привяжи Telegram» у ученика закрывает экран на 390 — «Позже».
    const later = { click: 'Позже', exact: true }
    const tab = (name) => ({ clickSel: `[role="tab"]:has-text("${name}")` })
    return [
      { persona: 'o258', name: 'd258-preview', url: kurs, width, height, actions: [{ wait: 2500 }, toTabs, { wait: 300 }] },
      { persona: 'o258', name: 'd258-preview-condition', url: kurs, width, height, actions: [{ wait: 2500 }, tab('Условие'), { wait: 500 }, toTabs, { wait: 300 }] },
      { persona: 'o258', name: 'd258-preview-criteria', url: kurs, width, height, actions: [{ wait: 2500 }, tab('Ответы и критерии'), { wait: 500 }, toTabs, { wait: 300 }] },
      { persona: 'o258', name: 'd258-modal-title', url: kurs, width, height, full: false, actions: [{ wait: 2500 }, { clickSel: '[data-testid="kurs-teacher-edit"]' }, { wait: 1500 }] },
      // Переименование: новое название уходит PATCH'ем в topics, заголовок окна берёт его сразу.
      { persona: 'o258', name: 'd258-modal-title-saved', url: kurs, width, height, full: false, actions: [
        { wait: 2500 }, { clickSel: '[data-testid="kurs-teacher-edit"]' }, { wait: 1500 },
        { fill: ['[data-testid="topic-title-input"]', '  Проверочная работа. Производная и касательная  '] },
        { eval: "document.querySelector('[data-testid=\"topic-title-input\"]').blur()" }, { wait: 800 },
      ] },
      { persona: 'o258', name: 'd258-modal-title-empty', url: kurs, width, height, full: false, actions: [
        { wait: 2500 }, { clickSel: '[data-testid="kurs-teacher-edit"]' }, { wait: 1500 },
        { fill: ['[data-testid="topic-title-input"]', '   '] },
        { eval: "document.querySelector('[data-testid=\"topic-title-input\"]').blur()" }, { wait: 500 },
      ] },
      { persona: 's258before', name: 'd258-student-before', url: kr, width, height, actions: [{ wait: 2500 }, later, { wait: 300 }, tab('Условие'), { wait: 500 }, toTabs, { wait: 300 }] },
      { persona: 's258sent', name: 'd258-student-sent', url: kr, width, height, actions: [{ wait: 2500 }, later, { wait: 300 }, tab('Ответы и критерии'), { wait: 500 }, toTabs, { wait: 300 }] },
      { persona: 's258done', name: 'd258-student-done', url: kr, width, height, actions: [{ wait: 2500 }, later, { wait: 300 }, tab('Ответы и критерии'), { wait: 500 }, toTabs, { wait: 300 }] },
    ]
  }),

  // §259. Ученик (курс §241): в разделе сверху — только ожидающие (пробник №5, КР «Кинематика», проверочная «Статика»);
  // модуль «Контрольные работы» снова карточкой (только работы и когда, без оценок), внутри — списком и карточками;
  // всё прошло — раздела нет, модуль работ на месте. Учитель (курс §250, «По темам»): срок «до …» и «изменить»,
  // сводка, колонка «Срок» со всеми статусами; без срока — «Срок не задан · задать»; «ещё 3 дн.» / «сегодня срок»;
  // «изменить» открывает окно темы на блоке ДЗ. В базу сцены не пишут; вид списка/карточек каждая сцена ставит сама.
  //   node e2e/harness/tour.mjs d259 1280 ; node e2e/harness/tour.mjs d259 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const course = `/my-course/${S.group}`
    const hw = `/course-program?courseId=d000000-0000-4000-8000-000000002500&tab=homework`
    const byTopics = { clickSel: '[data-testid="hw-view"] button[data-key="topics"]' }
    const openTopic = (id) => ({ eval: `document.querySelector('[data-hw-topic="${id}"] button')?.click()` })
    const toTopic = (id) => ({ eval: `(() => { document.querySelector('[data-hw-topic="${id}"]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -90) })()` })
    const toModules = { eval: "(() => { document.querySelector('[data-testid=\"module-works-card\"]')?.scrollIntoView({ block: 'center' }) })()" }
    return [
      { persona: 's259', name: 'd259-student', url: course, width, height, actions: [{ wait: 2500 }] },
      { persona: 's259', name: 'd259-student-modules', url: course, width, height, full: false, actions: [{ wait: 2500 }, toModules, { wait: 300 }] },
      { persona: 's259', name: 'd259-student-works-list', url: course, width, height, actions: [
        { ls: ['student-course-view', 'list'] }, { goto: course }, { wait: 2500 }, { clickSel: '[data-testid="module-works-card"]' }, { wait: 600 },
      ] },
      { persona: 's259', name: 'd259-student-works-cards', url: course, width, height, actions: [
        { ls: ['student-course-view', 'cards'] }, { goto: course }, { wait: 2500 }, { clickSel: '[data-testid="module-works-card"]' }, { wait: 600 },
      ] },
      { persona: 's259none', name: 'd259-student-none', url: course, width, height, actions: [{ wait: 2500 }] },
      { persona: 'o259', name: 'd259-teacher', url: hw, width, height, full: false, actions: [
        { wait: 2500 }, byTopics, { wait: 1500 }, openTopic(D259.past), { wait: 300 }, toTopic(D259.past), { wait: 300 },
      ] },
      { persona: 'o259', name: 'd259-teacher-full', url: hw, width, height, actions: [
        { wait: 2500 }, byTopics, { wait: 1500 }, openTopic(D259.past), openTopic(D259.nodue), openTopic(D259.soon), openTopic(D259.today), { wait: 300 },
      ] },
      { persona: 'o259', name: 'd259-teacher-nodue', url: hw, width, height, full: false, actions: [
        { wait: 2500 }, byTopics, { wait: 1500 }, openTopic(D259.nodue), { wait: 300 }, toTopic(D259.nodue), { wait: 300 },
      ] },
      { persona: 'o259', name: 'd259-teacher-soon', url: hw, width, height, full: false, actions: [
        { wait: 2500 }, byTopics, { wait: 1500 }, openTopic(D259.soon), { wait: 300 }, toTopic(D259.soon), { wait: 300 },
      ] },
      ...(width === 390 ? [{ persona: 'o259', name: 'd259-teacher-scrolled', url: hw, width, height, full: false, actions: [
        { wait: 2500 }, byTopics, { wait: 1500 }, openTopic(D259.past), { wait: 300 }, toTopic(D259.past),
        { eval: `document.querySelector('[data-hw-topic="${D259.past}"] [data-testid="hw-section-scroll"]').scrollLeft = 400` }, { wait: 300 },
      ] }] : []),
      { persona: 'o259', name: 'd259-teacher-edit', url: hw, width, height, full: false, actions: [
        { wait: 2500 }, byTopics, { wait: 1500 }, { eval: `document.querySelector('[data-hw-topic="${D259.past}"] [data-testid="hw-due-edit"]')?.click()` }, { wait: 2000 },
      ] },
    ]
  }),

  // §260. ИИ ставит баллы по критериям учителя; сумму и оценку считает сайт. Очередь учителя:
  // проверочная «Движение по окружности» — работа на 9 из 12 (спокойный экран и полная таблица с
  // таблицей перевода), правка ± (№1 и №7: 11 из 12 → «5»), «критерии прочитаны не полностью»,
  // проверка до §260 («Перепроверить по критериям») и обычное ДЗ без критериев. Правки ± только
  // на экране (харнесс PATCH не хранит), вердиктов сцены не ставят.
  //   node e2e/harness/tour.mjs d260 1280 ; node e2e/harness/tour.mjs d260 390
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => {
    const open = id => [{ goto: `/homework-queue?attempt=${id}` }, { wait: 3000 }]
    const table = [{ clickSel: '[data-testid="attempt-more-menu"]' }, { wait: 300 }, { clickSel: '[data-testid="review-open-table"]' }, { wait: 800 }]
    const plus = no => [{ clickSel: `[data-testid="review-table-sheet"] [data-testid="review-task-row"][data-no="${no}"] [data-testid="review-task-points-plus"]` }, { wait: 300 }]
    const pick = no => [{ clickSel: `[data-testid="review-focus-cell"][data-no="${no}"]` }, { wait: 500 }]
    const toPanel = { eval: "document.querySelector('[data-testid=\"review-side-column\"]')?.scrollIntoView({ block: 'start' })" }
    const toBar = { eval: "document.querySelector('[data-testid=\"review-actions\"]')?.scrollIntoView({ block: 'end' })" }
    return [
      { persona: 'o260', name: 'd260-queue', url: '/homework-queue', width, height, full: false, actions: [{ wait: 2500 }] },
      { persona: 'o260', name: 'd260-points', url: '/homework-queue', width, height, full: false, actions: [...open(D260.a), ...pick('7'), toPanel, { wait: 300 }] },
      { persona: 'o260', name: 'd260-points-bar', url: '/homework-queue', width, height, full: false, actions: [...open(D260.a), toBar, { wait: 300 }] },
      { persona: 'o260', name: 'd260-points-table', url: '/homework-queue', width, height, full: false, actions: [...open(D260.a), ...table] },
      { persona: 'o260', name: 'd260-points-plus', url: '/homework-queue', width, height, full: false, actions: [...open(D260.a), ...table, ...plus('1'), ...plus('7')] },
      { persona: 'o260', name: 'd260-mismatch', url: '/homework-queue', width, height, full: false, actions: [...open(D260.b), ...table] },
      { persona: 'o260', name: 'd260-mismatch-calm', url: '/homework-queue', width, height, full: false, actions: [...open(D260.b), toPanel, { wait: 300 }] },
      { persona: 'o260', name: 'd260-recheck', url: '/homework-queue', width, height, full: false, actions: [...open(D260.c), toPanel, { wait: 300 }] },
      { persona: 'o260', name: 'd260-plain', url: '/homework-queue', width, height, full: false, actions: [...open(S.attempt(38)), ...table] },
    ]
  }),

  // ── 360 narrow check on the densest screens ──
  { persona: 'student', name: 's01-dashboard', url: '/student', width: 360, height: 740 },
  { persona: 'student', name: 's04-topic', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 360, height: 740 },
  { persona: 'student', name: 's07-variant-work', url: `/student/variants/${S.myAssignment(1)}`, width: 360, height: 740 },
  { persona: 'owner', name: 'o01-admin-now', url: '/admin', width: 360, height: 740, actions: [{ clickRole: ['button', 'Сейчас'] }, { wait: 1200 }] },
  { persona: 'owner', name: 'o04-catalog-section', url: `/catalog/${S.section(1)}?subject=physics&exam=ege`, width: 360, height: 740 },
  { persona: 'owner', name: 'o06-queue', url: '/homework-queue', width: 360, height: 740 },
  { persona: 'owner', name: 'o07-students', url: '/students', width: 360, height: 740 },
]
