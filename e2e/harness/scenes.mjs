import { IDS } from './fixtures.mjs'
const S = IDS
const cart = JSON.stringify({ state: { items: Array.from({ length: 7 }, (_, k) => ({ catalog_task_id: S.task(k + 1), added_at: '2026-09-12T08:00:00.000Z' })) }, version: 0 })
// §195: папка, в которую сцены каталожных картинок льют файлы. Ровно тот
// формат, что ждёт импортёр задач, — он же стоит подсказкой в самом поле.
const CATALOG_ASSETS_FOLDER = 'physics-ege/author-kinematics'

// §186: панель ИИ живёт в футере под работой — до неё надо доскроллить, иначе
// на снимке будут только страницы работы.
const toAiPanel = `document.querySelector('[data-testid="ai-check-panel"]')?.scrollIntoView({ block: 'start' })`
// Нижний край панели — там строка про находки, отброшенные кодом (§180).
const toAiDropped = `document.querySelector('[data-testid="ai-check-dropped"]')?.scrollIntoView({ block: 'center' })`
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
// §202 (board/054): печатный лист прокручивается к МЕЛКОЙ иллюстрации — рядом с
// ней на листе стоит задача с крупным чертежом, на этой паре и видно полосу
// ширин. Прокрутка по элементу, а не по пикселю: высота листа зависит как раз
// от правила, которое проверяем.
const toSmallFigure = `document.querySelector('.print-document img[alt*="мелкий"]')?.scrollIntoView({ block: 'center' })`
// §205 (board/056): печатный лист с формулами. Прокрутка по элементу, а не по
// пикселю — высота листа зависит ровно от правила, которое проверяем.
const toPrintTop = `document.querySelector('.print-document img.math-display')?.scrollIntoView({ block: 'center' })`
const toShortSystem = `document.querySelector('.print-document img[alt*="система и три"]')?.scrollIntoView({ block: 'center' })`

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
  // живо: счётчик отброшенных находок и проверка старее v17, у которой
  // таблицы нет вовсе, — панель ей обязана выглядеть как до §186.
  ...[[1280, 800], [390, 844]].flatMap(([width, height]) => [
    { persona: 'owner', name: 'o06-review-ai-dropped', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: toAiDropped }, { wait: 600 }], full: false },
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
    // Раскрытое резюме ИИ — оно же проверка, что «Вставить в комментарий» на месте.
    { persona: 'owner', name: 'o06-review-summary-open', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { clickSel: '[data-testid="ai-check-summary-toggle"]' }, { wait: 400 }, { eval: `document.querySelector('[data-testid="ai-check-summary"]')?.scrollIntoView({ block: 'center' })` }, { wait: 400 }], full: false },
    // Правая колонка «Комментарии»: похвалы спрятаны, переключатель виден.
    { persona: 'owner', name: 'o06-review-praise-off', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { eval: `document.querySelector('[data-testid="comment-list"]')?.scrollIntoView({ block: 'start' })` }, { wait: 400 }], full: false },
    { persona: 'owner', name: 'o06-review-praise-on', url: '/homework-queue', width, height, actions: [{ clickSel: 'button:has-text("Проверить")' }, { wait: 2500 }, { clickSel: '[data-testid="comment-list-praise-toggle"] input' }, { wait: 400 }, { eval: `document.querySelector('[data-testid="comment-list"]')?.scrollIntoView({ block: 'start' })` }, { wait: 400 }], full: false },
  ]),

  { persona: 'owner', name: 'o07-students', url: '/students' },
  { persona: 'owner', name: 'o07-students-invites', url: '/students', actions: [{ clickRole: ['button', 'Приглашения'] }, { wait: 600 }] },
  { persona: 'owner', name: 'o07-students-distribute', url: '/students', actions: [{ clickRole: ['button', 'Новые ученики'] }, { wait: 600 }, { clickRole: ['button', 'Распределить'] }, { wait: 800 }] },
  { persona: 'owner', name: 'o07-student-profile', url: `/students/${S.otherStudent(0)}` },
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

  // ── 360 narrow check on the densest screens ──
  { persona: 'student', name: 's01-dashboard', url: '/student', width: 360, height: 740 },
  { persona: 'student', name: 's04-topic', url: `/my-course/${S.group}/topic/${S.topic(1)}`, width: 360, height: 740 },
  { persona: 'student', name: 's07-variant-work', url: `/student/variants/${S.myAssignment(1)}`, width: 360, height: 740 },
  { persona: 'owner', name: 'o01-admin-now', url: '/admin', width: 360, height: 740, actions: [{ clickRole: ['button', 'Сейчас'] }, { wait: 1200 }] },
  { persona: 'owner', name: 'o04-catalog-section', url: `/catalog/${S.section(1)}?subject=physics&exam=ege`, width: 360, height: 740 },
  { persona: 'owner', name: 'o06-queue', url: '/homework-queue', width: 360, height: 740 },
  { persona: 'owner', name: 'o07-students', url: '/students', width: 360, height: 740 },
]
