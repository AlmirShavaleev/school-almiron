// Fixture data for the harness. Everything invented; no real people.
const U = (p, n) => `${p}000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const IDS = {
  student: U('a', 1), owner: U('a', 2),
  studentRow: U('b', 1), teacherRow: U('c', 2),
  course: U('d', 1), course2: U('d', 2), module: U('e', 1), module2: U('e', 2),
  // §174: каркас и его классы-копии + модуль каркаса
  courseTemplate: U('d', 3), courseCopy: (i) => U('d', 10 + i), moduleTemplate: U('e', 3),
  group: U('f', 1), group2: U('f', 2),
  topic: (i) => U('1', i), hw: (i) => U('2', i), attempt: (i) => U('3', i), file: (i) => U('4', i),
  review: (i) => U('5', i), material: (i) => U('6', i), otherStudent: (i) => U("b", 10 + i), profile: (i) => U('a', 10 + i),
  section: (i) => U('7', i), task: (i) => U('8', i), ctopic: (i) => U('9', i),
  collection: U('c', 100), collection2: U('c', 101), collection3: U('c', 102), collection4: U('c', 103), collection5: U('c', 104),
  variant: (i) => U('c', 200 + i),
  test: (i) => U('c', 300 + i), assignment: (i) => U('c', 400 + i), myAssignment: (i) => U('c', 600 + i), notif: (i) => U('c', 500 + i),
}
const NOW = '2026-09-12T09:30:00.000Z'
const ago = (h) => new Date(Date.parse(NOW) - h * 3600e3).toISOString()

const NAMES = [
  'Константинопольская Анна Владимировна', 'Иванов Пётр', 'Абдурахманова-Синицына Екатерина Александровна',
  'Ли Ян', 'Преображенский Всеволод Аристархович', 'Смирнова Мария Сергеевна', 'Оганесян Давид Арменович',
  'Кузнецова Виктория Константиновна', 'Ж', 'Хабибуллина Динара Рустемовна',
]
export const profiles = [
  { id: IDS.student, email: 'uchenik@harness.invalid', full_name: NAMES[0], role: 'student', phone: '+7 900 000-00-01', avatar_url: null, created_at: '2025-09-01T10:00:00Z', updated_at: '2025-09-01T10:00:00Z' },
  { id: IDS.owner, email: 'vladelets@harness.invalid', full_name: NAMES[4], role: 'owner', phone: null, avatar_url: null, created_at: '2025-09-01T10:00:00Z', updated_at: '2025-09-01T10:00:00Z' },
  ...[1, 2, 3, 5, 6, 7, 8, 9].map((i, k) => ({ id: IDS.profile(k), email: `student${k}@harness.invalid`, full_name: NAMES[i], role: 'student', phone: null, avatar_url: null, created_at: ago(24 * 30 * (k + 1)), updated_at: ago(24) })),
]
const byId = (id) => profiles.find(p => p.id === id)

export const personas = {
  student: { user: { id: IDS.student, email: 'uchenik@harness.invalid', user_metadata: { full_name: NAMES[0] } } },
  owner: { user: { id: IDS.owner, email: 'vladelets@harness.invalid', user_metadata: { full_name: NAMES[4] } }, staffProfileId: IDS.owner },
  // §178: тот же владелец, но переключатель в шапке стоит на «Ученик» —
  // предпросмотр ученических экранов. Отдельная персона, а не действие в
  // сцене: контекст (и localStorage с режимом) один на персону и ширину.
  ownerPreview: { user: { id: IDS.owner, email: 'vladelets@harness.invalid', user_metadata: { full_name: NAMES[4] } }, staffProfileId: IDS.owner, staffMode: 'student' },
  // §181: тот же владелец с включённым «Мобильным видом» — вместо кабинета
  // рамка-«телефон» 390×844 с тем же приложением во вложенном окне. Режим
  // роли под ним любой: `ownerMobile` — администратор, `ownerPreviewMobile` —
  // «Ученик + телефон» (жёлтая полоса §178 внутри телефона).
  ownerMobile: { user: { id: IDS.owner, email: 'vladelets@harness.invalid', user_metadata: { full_name: NAMES[4] } }, staffProfileId: IDS.owner, staffMode: 'admin', mobilePreview: true },
  ownerPreviewMobile: { user: { id: IDS.owner, email: 'vladelets@harness.invalid', user_metadata: { full_name: NAMES[4] } }, staffProfileId: IDS.owner, staffMode: 'student', mobilePreview: true },
  guest: { user: null },
}

// ── course structure ─────────────────────────────────────────────────────────
const course = { id: IDS.course, title: 'Физика ЕГЭ 2027 · Полный годовой курс подготовки с нуля до 90+ баллов', subject: 'physics', exam_type: 'ege', duration_weeks: 36, price: 4900, description: 'Годовой курс: механика, МКТ и термодинамика, электродинамика, оптика, квантовая физика.', start_date: '2026-09-01', end_date: '2027-05-31', enrollment_open_until: '2026-10-01', is_active: true, is_default_for_direction: true, is_draft: false, is_template: false, owner_id: IDS.owner, copied_from_course_id: null, created_at: ago(24 * 90) }
const course2 = { id: IDS.course2, title: 'Математика ОГЭ', subject: 'math', exam_type: 'oge', duration_weeks: 30, price: 3900, description: null, start_date: '2026-09-01', end_date: '2027-05-31', enrollment_open_until: null, is_active: true, is_default_for_direction: false, is_draft: false, is_template: false, owner_id: IDS.owner, copied_from_course_id: null, created_at: ago(24 * 90) }
// §174: каркас «Физика ЕГЭ Шаблон» и два активных класса-копии (10А, 11А) плюс
// архивная копия — она в строке классов на каркасе показываться не должна.
const courseTemplate = { ...course2, id: IDS.courseTemplate, title: 'Физика ЕГЭ Шаблон', subject: 'physics', exam_type: 'ege', duration_weeks: 36, price: 4900, description: 'Каркас: материалы и задачи задаются здесь, ученики — в классах.', is_template: true, is_default_for_direction: false }
const courseCopies = [['Физика ЕГЭ 10А', true], ['Физика ЕГЭ 11А', true], ['Физика ЕГЭ 2025 (архив)', false]].map(([title, active], i) => ({
  ...courseTemplate, id: IDS.courseCopy(i + 1), title, is_template: false, is_active: active, copied_from_course_id: IDS.courseTemplate, description: null,
}))
export const courses = [course, course2, courseTemplate, ...courseCopies]
const modules = [
  { id: IDS.module, course_id: IDS.course, title: 'Механика: кинематика, динамика, статика, законы сохранения энергии и импульса', order_index: 1, created_at: ago(24 * 80), courses: course },
  { id: IDS.module2, course_id: IDS.course, title: 'Молекулярная физика и термодинамика', order_index: 2, created_at: ago(24 * 80), courses: course },
  { id: IDS.moduleTemplate, course_id: IDS.courseTemplate, title: 'Механика', order_index: 1, created_at: ago(24 * 80), courses: courseTemplate },
]
const TOPIC_TITLES = [
  'Равноускоренное прямолинейное движение: уравнения, графики зависимости координаты и скорости от времени',
  'Движение по окружности',
  'Законы Ньютона. Силы упругости, трения и тяготения; движение тела по наклонной плоскости с учётом трения',
  'Закон сохранения импульса',
  'Работа, мощность, энергия',
  'Статика. Момент силы',
  'Основы МКТ. Уравнение Менделеева—Клапейрона и изопроцессы',
  'Первый закон термодинамики',
]
export const topics = [
  ...TOPIC_TITLES.map((title, i) => ({
    id: IDS.topic(i + 1), module_id: i < 6 ? IDS.module : IDS.module2, title, order_index: i + 1, max_score: 100,
    is_open: i < 5, available_from: i < 5 ? ago(24 * (30 - i * 5)) : '2026-10-20T06:00:00Z', source_template_id: null, created_at: ago(24 * 80),
    modules: i < 6 ? modules[0] : modules[1],
  })),
  // темы каркаса (§174) — три первые темы механики
  ...TOPIC_TITLES.slice(0, 3).map((title, i) => ({
    id: IDS.topic(20 + i + 1), module_id: IDS.moduleTemplate, title, order_index: i + 1, max_score: 100,
    is_open: null, available_from: null, source_template_id: null, created_at: ago(24 * 80), modules: modules[2],
  })),
]

for (const m of modules) m.topics = topics.filter(t => t.module_id === m.id).map(({ modules: _m, ...t }) => t)
export const groups = [
  { id: IDS.group, name: 'ЕГЭ Физика · Поток вторник/пятница 18:00 (основная группа)', course_id: IDS.course, teacher_id: IDS.teacherRow, curator_id: null, is_active: true, max_students: 12, schedule_days: ['tuesday', 'friday'], schedule_time: '18:00', type: 'group', created_at: ago(24 * 80) },
  { id: IDS.group2, name: 'ОГЭ Математика', course_id: IDS.course2, teacher_id: IDS.teacherRow, curator_id: null, is_active: true, max_students: 10, schedule_days: ['wednesday'], schedule_time: '17:00', type: 'group', created_at: ago(24 * 80) },
]
export const teachers = [{ id: IDS.teacherRow, profile_id: IDS.owner, subjects: ['physics'], is_active: true, bio: null, hourly_rate: null, rating: 4.9, created_at: ago(24 * 90), profiles: byId(IDS.owner), profile: byId(IDS.owner) }]
export const students = [
  { id: IDS.studentRow, profile_id: IDS.student, grade: 11, target_exam: 'ege', target_subject: 'physics', target_score: 85, xp_points: 2450, league: 'silver', is_active: true, notes: null, created_at: '2025-09-01T10:00:00Z' },
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(k => ({ id: IDS.otherStudent(k), profile_id: IDS.profile(k), grade: 10 + (k % 2), target_exam: 'ege', target_subject: 'physics', target_score: 70 + k * 3, xp_points: 300 * k, league: 'bronze', is_active: k !== 7, notes: null, created_at: ago(24 * 30 * (k + 1)) })),
].map(s => ({ ...s, profiles: byId(s.profile_id), profile: byId(s.profile_id) }))
const studentById = (id) => students.find(s => s.id === id)
groups[0].teachers = teachers[0]; groups[1].teachers = teachers[0]
groups[0].curators = null; groups[1].curators = null
groups[0].courses = course; groups[1].courses = course2
export const group_students = [
  { id: U('f', 100), group_id: IDS.group, student_id: IDS.studentRow, joined_at: ago(24 * 20) },
  ...[0, 1, 2, 3, 4, 5, 6].map(k => ({ id: U('f', 101 + k), group_id: IDS.group, student_id: IDS.otherStudent(k), joined_at: ago(24 * (20 - k)) })),
  { id: U('f', 120), group_id: IDS.group2, student_id: IDS.otherStudent(7), joined_at: ago(24 * 5) },
].map(gs => ({ ...gs, groups: groups.find(g => g.id === gs.group_id), students: studentById(gs.student_id) }))
groups[0].group_students = group_students.filter(g => g.group_id === IDS.group).map(g => ({ student_id: g.student_id, students: g.students, count: undefined }))
groups[1].group_students = group_students.filter(g => g.group_id === IDS.group2).map(g => ({ student_id: g.student_id, students: g.students }))

// ── materials ────────────────────────────────────────────────────────────────
const LONG_TEXT = `Равноускоренное движение — движение, при котором ускорение постоянно по модулю и направлению.

Уравнения: v = v₀ + a·t;  x = x₀ + v₀·t + a·t²/2;  v² − v₀² = 2·a·(x − x₀).

Длинная формула без переносов: F₁·cos(α₁)+F₂·cos(α₂)+F₃·cos(α₃)−μ·(m₁+m₂+m₃)·g·cos(β)=(m₁+m₂+m₃)·a

Таблица значений: t, с | 0 | 1 | 2 | 3 | 4 | 5 | 6
x, м | 0 | 2 | 8 | 18 | 32 | 50 | 72

Ссылка на демоверсию: https://example.invalid/very/long/link/that/does/not/break/anywhere/at/all/0123456789012345678901234567890123456789`
export const topic_material_items = [
  { id: IDS.material(1), topic_id: IDS.topic(1), kind: 'text', title: 'Конспект: уравнения равноускоренного движения и разбор графиков', content: LONG_TEXT, position: 1, is_visible: true, section: 'theory', url: null, storage_path: null, file_name: null, mime_type: null, size_bytes: null, lesson_id: null, source_topic_material_id: null, created_by: IDS.owner, created_at: ago(200), updated_at: ago(200) },
  { id: IDS.material(2), topic_id: IDS.topic(1), kind: 'video', title: 'Видеоразбор: как читать графики v(t) и x(t), типовые ошибки на ЕГЭ', content: null, position: 2, is_visible: true, section: 'theory', url: 'https://iframe.mediadelivery.invalid/embed/1/abcd', storage_path: null, file_name: null, mime_type: null, size_bytes: null, lesson_id: null, source_topic_material_id: null, created_by: IDS.owner, created_at: ago(200), updated_at: ago(200) },
  { id: IDS.material(3), topic_id: IDS.topic(1), kind: 'file', title: 'Задачи для самостоятельного решения (PDF, 3 страницы)', content: null, position: 3, is_visible: true, section: 'practice', url: null, storage_path: 'course-materials/topic-1/zadachi-dlya-samostoyatelnogo-resheniya-ochen-dlinnoe-imya-fayla.pdf', file_name: 'zadachi-dlya-samostoyatelnogo-resheniya-ochen-dlinnoe-imya-fayla.pdf', mime_type: 'application/pdf', size_bytes: 1240000, lesson_id: null, source_topic_material_id: null, created_by: IDS.owner, created_at: ago(200), updated_at: ago(200) },
  { id: IDS.material(4), topic_id: IDS.topic(1), kind: 'link', title: 'Демоверсия ЕГЭ-2027 на сайте ФИПИ', content: null, position: 4, is_visible: true, section: 'practice', url: 'https://fipi.invalid/ege/demoversii-specifikacii-kodifikatory', storage_path: null, file_name: null, mime_type: null, size_bytes: null, lesson_id: null, source_topic_material_id: null, created_by: IDS.owner, created_at: ago(200), updated_at: ago(200) },
  { id: IDS.material(5), topic_id: IDS.topic(1), kind: 'file', title: 'Рисунок к задаче 4', content: null, position: 5, is_visible: true, section: 'practice', url: null, storage_path: 'course-materials/topic-1/figure.png', file_name: 'figure.png', mime_type: 'image/png', size_bytes: 82000, lesson_id: null, source_topic_material_id: null, created_by: IDS.owner, created_at: ago(200), updated_at: ago(200) },
  { id: IDS.material(6), topic_id: IDS.topic(2), kind: 'text', title: 'Конспект', content: '<p>Центростремительное ускорение a = v²/R.</p>', position: 1, is_visible: true, section: 'theory', url: null, storage_path: null, file_name: null, mime_type: null, size_bytes: null, lesson_id: null, source_topic_material_id: null, created_by: IDS.owner, created_at: ago(200), updated_at: ago(200) },
  // §182: у тем 2–5 заполнены РАЗНЫЕ рубрики — иначе в списке раздела строка
  // «ещё N материалов» у всех одна и та же, и по снимку не видно, что счёт
  // считается. Рубрика `practice` выше в перечень §100 не входит и в сигналы
  // не попадает намеренно — это старые строки, оставлены как есть.
  ...[
    [2, 'notes', 'text'], [2, 'worksheet_tasks', 'file'],
    [3, 'theory', 'text'], [3, 'notes', 'text'], [3, 'tasks', 'file'], [3, null, 'video'],
    [4, 'theory', 'text'], [4, 'solution', 'file'], [4, 'worksheet_homework', 'file'],
    [5, 'notes', 'text'], [5, 'tasks', 'file'], [5, 'task_solution', 'file'], [5, null, 'video'],
  ].map(([n, section, kind], i) => ({
    id: IDS.material(20 + i), topic_id: IDS.topic(n), kind,
    title: kind === 'video' ? 'Видеоразбор темы' : `Материал темы ${n}`,
    content: kind === 'text' ? '<p>Короткий конспект.</p>' : null, position: 10 + i, is_visible: true,
    section, url: kind === 'video' ? 'https://iframe.mediadelivery.invalid/embed/1/efgh' : null,
    storage_path: kind === 'file' ? `course-materials/topic-${n}/list-${i}.pdf` : null,
    file_name: kind === 'file' ? `list-${i}.pdf` : null, mime_type: kind === 'file' ? 'application/pdf' : null,
    size_bytes: kind === 'file' ? 120000 : null, lesson_id: null, source_topic_material_id: null,
    created_by: IDS.owner, created_at: ago(200), updated_at: ago(200),
  })),
]

// ── homework ─────────────────────────────────────────────────────────────────
export const topic_homework = [1, 2, 3, 4, 5].map(i => ({
  id: IDS.hw(i), topic_id: IDS.topic(i), title: i === 1 ? 'Домашняя работа №1: графики равноускоренного движения, задачи 1–12 из сборника (обязательно оформить решение с рисунком)' : `Домашняя работа №${i}`,
  instructions: i === 1 ? 'Решить задачи 1–12. Сфотографировать каждую страницу отдельно, при хорошем свете. Ответы оформить по образцу: «Дано», «Решение», «Ответ». Формулы писать в системе СИ: v = v₀ + a·t.' : 'Решить задачи из конспекта.',
  grade_scale: i % 2 ? 'five' : 'hundred', due_at: i <= 2 ? ago(-24 * (3 - i)) : ago(24 * i), is_published: true, created_by: IDS.owner, created_at: ago(24 * 20), updated_at: ago(24 * 20),
  topics: topics[i - 1], topic: topics[i - 1],
}))
const hwById = (id) => topic_homework.find(h => h.id === id)
// student's own attempts: hw1 returned, hw2 submitted, hw3 accepted, hw4 draft
const attemptRows = [
  { id: IDS.attempt(1), homework_id: IDS.hw(1), student_id: IDS.studentRow, attempt_number: 2, status: 'returned_for_revision', submitted_at: ago(30), created_at: ago(40), updated_at: ago(20) },
  { id: IDS.attempt(2), homework_id: IDS.hw(2), student_id: IDS.studentRow, attempt_number: 1, status: 'submitted', submitted_at: ago(5), created_at: ago(6), updated_at: ago(5) },
  { id: IDS.attempt(3), homework_id: IDS.hw(3), student_id: IDS.studentRow, attempt_number: 1, status: 'accepted', submitted_at: ago(100), created_at: ago(101), updated_at: ago(90) },
  // other students → queue
  ...[0, 1, 2, 3, 4, 5].map(k => ({ id: IDS.attempt(10 + k), homework_id: IDS.hw(1 + (k % 3)), student_id: IDS.otherStudent(k), attempt_number: 1 + (k % 2), status: ['submitted', 'submitted', 'returned_for_revision', 'submitted', 'accepted', 'submitted'][k], submitted_at: ago(2 + k * 9), created_at: ago(3 + k * 9), updated_at: ago(1 + k * 9) })),
]
export const topic_homework_attempts = attemptRows.map(a => ({
  ...a, homework: hwById(a.homework_id), topic_homework: hwById(a.homework_id), students: studentById(a.student_id),
  topic_homework_reviews: [],
}))
export const topic_homework_reviews = [
  { id: IDS.review(1), attempt_id: IDS.attempt(1), reviewer_id: IDS.owner, decision: 'returned_for_revision', score: null, comment: 'Задачи 3 и 7 — ошибка в знаке ускорения: при торможении a направлено против скорости. Перерисуй график v(t) для задачи 9: наклон должен быть отрицательным. Остальное хорошо, оформление аккуратное. Пересдай до пятницы.', created_at: ago(20) },
  { id: IDS.review(3), attempt_id: IDS.attempt(3), reviewer_id: IDS.owner, decision: 'accepted', score: 5, comment: 'Отлично.', created_at: ago(90) },
  { id: IDS.review(12), attempt_id: IDS.attempt(12), reviewer_id: IDS.owner, decision: 'returned_for_revision', score: null, comment: 'Переделать задачу 2.', created_at: ago(15) },
  { id: IDS.review(14), attempt_id: IDS.attempt(14), reviewer_id: IDS.owner, decision: 'accepted', score: 87, comment: null, created_at: ago(30) },
]
for (const r of topic_homework_reviews) topic_homework_attempts.find(a => a.id === r.attempt_id).topic_homework_reviews.push(r)
export const topic_homework_attempt_files = topic_homework_attempts.flatMap((a, i) => [1, 2].map(n => ({
  id: IDS.file(i * 2 + n), attempt_id: a.id, storage_path: `homeworks/${a.student_id}/${a.id}/photo-${n}.jpg`, file_name: `IMG_2026091${n}_очень_длинное_имя_файла_с_телефона_${n}.jpg`,
  mime_type: 'image/jpeg', size_bytes: 2400000, width: 1200, height: 1600, page_number: n, position: n, rotation: 0, sha256: null, metadata: {}, created_at: a.created_at,
})))

// ── ИИ-проверка ДЗ (§180 v17 + §186) ─────────────────────────────────────────
// Две проверки рядом, потому что панель обязана уметь обе: свежая с таблицей
// по заданиям (`tasks`) и старая, где столбца ещё не было (в проде таких три
// десятка). Номера заданий в тексте находок не для красоты: столбца `task` у
// находки в базе нет, и панель связывает строку с находкой по тексту.
const aiFileOf = (attemptId) => topic_homework_attempt_files.find(f => f.attempt_id === attemptId).id
const aiJobBase = {
  provider: 'openrouter', model: 'qwen/qwen3-vl-235b-a22b-instruct', readable: true, requested_by: IDS.owner,
  attempts: 1, accepted_at: null, last_error: null, input_tokens: 9800, output_tokens: 1400,
  worksheet_state: 'used', worksheet_chars: 1800,
}
export const aiJobs = [
  {
    // accepted_at выставлен: рамки этой проверки уже перенесены в разбор
    // (страница делает это сама при открытии). Иначе каждый заход по сцене
    // переносил бы их заново, и в «Комментариях» копились бы копии.
    ...aiJobBase, id: U('c', 1300), attempt_id: IDS.attempt(15), status: 'done', accepted_at: ago(1),
    suggested_score: 4, confidence: 'medium', reference_state: 'used', reference_chars: 7647,
    started_at: ago(1), created_at: ago(1), completed_at: ago(1),
    summary: 'Задания 1, 2 и 5 решены верно. В задании 3 потерян знак ускорения при торможении, в задании 4 ответ верный, но развёрнутого решения нет — условие его требует.\n\nНе сверены задания (в балл не вошли): 6.',
    tasks: [
      { no: '1', verdict: 'correct', student_answer: '12 м/с', expected_answer: '12 м/с', note: '' },
      { no: '2', verdict: 'correct', student_answer: '0,4', expected_answer: '0,4', note: '' },
      { no: '3', verdict: 'wrong', student_answer: '−2 м/с²', expected_answer: '2 м/с²', note: 'При торможении знак ускорения противоположен скорости' },
      { no: '4', verdict: 'partial', student_answer: '30 Н', expected_answer: '30 Н', note: 'Ответ верный, хода решения нет' },
      { no: '5', verdict: 'correct', student_answer: '25 м', expected_answer: '25 м', note: '' },
      { no: '6', verdict: 'unchecked', student_answer: '', expected_answer: '18 c', note: 'Страница снята не полностью, ответ не виден' },
    ],
    dropped_findings: 2,
  },
  {
    ...aiJobBase, id: U('c', 1302), attempt_id: IDS.attempt(13), status: 'done', accepted_at: ago(26),
    suggested_score: 4, confidence: 'medium', reference_state: 'used', reference_chars: 14000,
    started_at: ago(26), created_at: ago(26), completed_at: ago(26),
    summary: 'Часть задач решена верно, в задачах 16–19 расхождения с эталоном. Проверьте вручную: почерк местами читается плохо.',
    tasks: null, dropped_findings: null,
  },
]
export const aiFindings = [
  { id: U('c', 1301), job_id: U('c', 1300), file_id: aiFileOf(IDS.attempt(15)), page: 1, position: 0, rect_x: 0.12, rect_y: 0.45, rect_w: 0.6, rect_h: 0.08, category: 'calc', text: 'В задаче 3 знак ускорения: при торможении a направлено против скорости, значит a < 0.' },
  { id: U('c', 1303), job_id: U('c', 1300), file_id: aiFileOf(IDS.attempt(15)), page: 1, position: 1, rect_x: 0.1, rect_y: 0.62, rect_w: 0.62, rect_h: 0.1, category: 'logic', text: 'Задание 4: ответ верный, но выкладок нет — условие просит развёрнутое решение.' },
  { id: U('c', 1304), job_id: U('c', 1300), file_id: aiFileOf(IDS.attempt(15)), page: 1, position: 2, rect_x: 0.14, rect_y: 0.8, rect_w: 0.5, rect_h: 0.06, category: 'format', text: 'Нет единиц измерения в ответах.' },
  { id: U('c', 1305), job_id: U('c', 1302), file_id: aiFileOf(IDS.attempt(13)), page: 1, position: 0, rect_x: 0.12, rect_y: 0.3, rect_w: 0.55, rect_h: 0.09, category: 'calc', text: 'Проверьте вычисления в задаче 17.' },
]

// ── таблица проверки по заданиям (§199, board/051) ───────────────────────────
// Своя сущность, а не слепок ИИ: её правит преподаватель, и именно её видит
// ученик после вердикта. Две таблицы в фикстурах: у работы в очереди
// (attempt 15 — та же, у которой есть проверка v17) и у собственной работы
// ученика (attempt 1, вердикт по ней уже есть — иначе RLS строк не отдала бы,
// и снимать в ученическом разборе было бы нечего).
//
// Строки нарочно РАСХОДЯТСЯ со слепком ИИ по заданию 3: преподаватель
// исправил прочитанный ответ и понизил вердикт. На снимке видно, что таблица
// живёт сама, а не повторяет модель.
const reviewTaskRow = (n, attemptId, over) => ({
  id: U('d', 100 + n), attempt_id: attemptId, position: n * 10,
  verdict: 'unchecked', student_answer: null, expected_answer: null, note: null,
  updated_by: IDS.owner, updated_at: ago(1), ...over,
})
export const topic_homework_review_tasks = [
  reviewTaskRow(1, IDS.attempt(15), { no: '1', verdict: 'correct', student_answer: '12 м/с', expected_answer: '12 м/с' }),
  reviewTaskRow(2, IDS.attempt(15), { no: '2', verdict: 'correct', student_answer: '0,4', expected_answer: '0,4' }),
  reviewTaskRow(3, IDS.attempt(15), { no: '3', verdict: 'wrong', student_answer: '−2 м/с²', expected_answer: '2 м/с²', note: 'При торможении знак ускорения противоположен скорости — в выражении должен стоять минус, иначе модуль сходится, а направление нет.' }),
  reviewTaskRow(4, IDS.attempt(15), { no: '4', verdict: 'partial', student_answer: '30 Н', expected_answer: '30 Н', note: 'Ответ верный, хода решения нет' }),
  reviewTaskRow(5, IDS.attempt(15), { no: '5', verdict: 'correct', student_answer: '25 м', expected_answer: '25 м' }),
  reviewTaskRow(6, IDS.attempt(15), { no: '6', verdict: 'unchecked', expected_answer: '18 c', note: 'Страница снята не полностью, ответ не виден' }),
  // ── работа ученика, уже проверенная ──
  reviewTaskRow(11, IDS.attempt(1), { no: '1', verdict: 'correct', student_answer: '4 м/с²', expected_answer: '4 м/с²' }),
  reviewTaskRow(12, IDS.attempt(1), { no: '3', verdict: 'wrong', student_answer: '−5 м/с²', expected_answer: '5 м/с²', note: 'Знак ускорения при торможении: a направлено против скорости, значит в проекции на ось движения оно отрицательное.' }),
  reviewTaskRow(13, IDS.attempt(1), { no: '7', verdict: 'partial', student_answer: '18 м', expected_answer: '18 м', note: 'Ответ верный, но график v(t) не построен' }),
  reviewTaskRow(14, IDS.attempt(1), { no: '9', verdict: 'correct', student_answer: '2,5 c', expected_answer: '2,5 c' }),
]

// ── пометки на работе (§199, для сцены с переключателем похвал) ─────────────
// Разметка ровно той работы очереди, у которой есть проверка v17: две ошибки
// и две похвалы. Без похвал в списке переключатель не появляется вовсе — его
// нечего прятать, — и снять сцену было бы нечем. Статус `draft`: опубликованные
// пометки ученик видит кнопкой «Пометки учителя», а тут проверка идёт.
export const annotationSets = [{
  id: U('d', 200), attempt_id: IDS.attempt(15), submission_id: null,
  file_path: topic_homework_attempt_files.find(f => f.attempt_id === IDS.attempt(15)).storage_path,
  page: 1, status: 'draft', author_id: IDS.owner, created_at: ago(1), updated_at: ago(1),
  data: {
    version: 2,
    objects: [
      { id: 'a1', type: 'region', category: 'calc', text: 'В задаче 3 знак ускорения: при торможении a направлено против скорости, значит a < 0.', rect: { x: 0.12, y: 0.45, w: 0.6, h: 0.08 } },
      { id: 'a2', type: 'region', category: 'praise', text: 'Отлично!', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 } },
      { id: 'a3', type: 'region', category: 'logic', text: 'Задание 4: ответ верный, но выкладок нет — условие просит развёрнутое решение.', rect: { x: 0.1, y: 0.62, w: 0.62, h: 0.1 } },
      { id: 'a4', type: 'region', category: 'praise', text: 'Верное решение', rect: { x: 0.14, y: 0.3, w: 0.32, h: 0.05 } },
    ],
  },
}]

// ── tests / variants ─────────────────────────────────────────────────────────
export const topic_tests = [1, 2].map(i => ({ id: IDS.test(i), title: i === 1 ? 'Тест по кинематике: 12 заданий с кратким ответом и таблицей соответствия' : 'Тест: динамика', description: null, is_published: true, created_by: IDS.owner, created_at: ago(300), updated_at: ago(300), topic_test_items: [{ count: 12 }], topic_test_assignments: [{ count: 1 }] }))
export const topic_test_assignments = [{ id: IDS.assignment(1), test_id: IDS.test(1), topic_id: IDS.topic(1), assigned_by: IDS.owner, created_at: ago(200), topic_tests: topic_tests[0] }]
export const topic_test_attempts = [
  { id: U('c', 450), assignment_id: IDS.assignment(1), test_id: IDS.test(1), student_id: IDS.studentRow, status: 'completed', started_at: ago(50), completed_at: ago(49), total_points: 9, max_points: 12, topic_tests: topic_tests[0], students: studentById(IDS.studentRow) },
  ...[0, 1, 2].map(k => ({ id: U('c', 451 + k), assignment_id: IDS.assignment(1), test_id: IDS.test(1), student_id: IDS.otherStudent(k), status: 'completed', started_at: ago(60 + k), completed_at: ago(59 + k), total_points: 6 + k, max_points: 12, topic_tests: topic_tests[0], students: studentById(IDS.otherStudent(k)) })),
]
export const test_variants = [1, 2, 3, 4].map(i => ({
  id: IDS.variant(i), title: i === 1 ? 'Тренировочный вариант №1 (ЕГЭ физика, полный, 26 заданий, по демоверсии 2027)' : `Вариант №${i}`, description: i === 1 ? 'Собран автоматически из каталога по темам 1–8' : null,
  subject: 'physics', exam_type: 'ege', source_type: i % 2 ? 'auto' : 'manual', status: i === 4 ? 'draft' : 'published', tasks_count: 26, settings: {}, created_by: IDS.owner, created_at: ago(24 * i * 3), updated_at: ago(24 * i),
  topic_id: null,
  created_by_profile: { full_name: NAMES[4], email: 'vladelets@harness.invalid' }, profiles: { full_name: NAMES[4], email: 'vladelets@harness.invalid' },
}))
const myAssignments = [1, 2, 3].map(i => ({
  id: U('c', 600 + i), assignment_id: U('c', 610 + i), student_id: IDS.studentRow, variant_id: IDS.variant(i), variant_title: test_variants[i - 1].title, variant_description: test_variants[i - 1].description,
  variant_subject: 'Физика', variant_exam_type: 'ЕГЭ', variant_source_type: 'auto', variant_status: 'published', variant_tasks_count: 26,
  status: ['in_progress', 'not_started', 'completed'][i - 1], assignment_status: 'active', grading_status: ['not_submitted', 'not_submitted', 'graded'][i - 1],
  available_from: ago(48), due_at: ago(-24 * i), max_attempts: 1, attempts_used: i === 3 ? 1 : 0, started_at: i !== 2 ? ago(3) : null, submitted_at: i === 3 ? ago(20) : null, completed_at: i === 3 ? ago(19) : null,
  answered_count: i === 3 ? 26 : i === 1 ? 7 : 0, correct_count: i === 3 ? 19 : 0, manual_review_count: 0, score: i === 3 ? 41 : 0, max_score: 54, percentage: i === 3 ? 76 : 0,
  group_name: groups[0].name, teacher_name: NAMES[4], created_at: ago(48), updated_at: ago(3),
}))

// ── catalog ──────────────────────────────────────────────────────────────────
const SECTION_TITLES = ['Механика: кинематика, динамика, статика, законы сохранения (задания с кратким ответом)', 'МКТ и термодинамика', 'Электродинамика', 'Оптика', 'Квантовая физика', 'Механика (расчётная задача с развёрнутым ответом)']
export const catalog_sections = [
  ...SECTION_TITLES.map((title, i) => ({ id: IDS.section(i + 1), title, subject: 'Физика', exam_type: 'ЕГЭ', exam_number: i + 1, external_id: 100 + i, is_published: true, position: i + 1, created_at: ago(9000), updated_at: ago(900) })),
  ...['Простейшие уравнения', 'Планиметрия: треугольники, четырёхугольники, окружности, вписанные и описанные фигуры', 'Производная и первообразная', 'Стереометрия', 'Текстовые задачи', 'Параметры'].map((title, i) => ({ id: IDS.section(20 + i), title, subject: 'Математика', exam_type: 'ЕГЭ', exam_number: i + 1, external_id: 200 + i, is_published: true, position: i + 1, created_at: ago(9000), updated_at: ago(900) })),
]
const STATEMENTS = [
  `<p>Тело движется вдоль оси Ox. В таблице приведена зависимость координаты тела от времени.</p><img src="table.png" alt="таблица"><p>Определите среднюю скорость тела на интервале от 1 до 5 с. Ответ дайте в м/с.</p>`,
  `<p>Материальная точка движется по закону x(t) = 3 + 2t − t². Найдите проекцию скорости через 4 с после начала движения.</p><p><img src="formula-wide.png" alt="формула"></p>`,
  `<p>Автомобиль массой 1500 кг разгоняется с места равноускоренно и за 10 с проходит 100 м. Определите силу тяги, если коэффициент сопротивления 0,05. Ускорение свободного падения принять равным 10 м/с².</p><table border="1"><tr><th>№</th><th>m, кг</th><th>t, с</th><th>S, м</th><th>μ</th><th>g, м/с²</th><th>F, Н</th></tr><tr><td>1</td><td>1500</td><td>10</td><td>100</td><td>0,05</td><td>10</td><td>?</td></tr></table>`,
  `<p>На рисунке представлен график зависимости проекции скорости от времени.</p><img src="figure.png" alt="график"><p>Установите соответствие между интервалами и характером движения.</p><table><tr><th>ИНТЕРВАЛЫ</th><th>ХАРАКТЕР ДВИЖЕНИЯ</th></tr><tr><td>А) 0–2 с</td><td>1) равноускоренное с положительным ускорением</td></tr><tr><td>Б) 2–4 с</td><td>2) равнозамедленное</td></tr><tr><td></td><td>3) равномерное</td></tr><tr><td></td><td>4) покой</td></tr></table>`,
]
export const catalog_tasks = Array.from({ length: 14 }, (_, k) => ({
  id: IDS.task(k + 1), section_id: IDS.section(1 + (k % 2 === 0 ? 0 : 0)), subject: 'Физика', exam_type: 'ЕГЭ', external_id: 124600 + k, position: k + 1, is_published: true,
  statement_html: STATEMENTS[k % STATEMENTS.length], has_answer: true, has_solution: k % 3 === 0, answer_html: `<p>${(k + 1) * 2}</p>`, solution_html: k % 3 === 0 ? '<p>v_ср = Δx / Δt = (50 − 2) / 4 = 12 м/с.</p>' : null, solution_plan_html: null, grade_criteria_html: null,
  difficulty: ['base', 'advanced', 'high'][k % 3], exam_part: k < 10 ? 1 : 2, max_points: k < 10 ? 1 : 3, partial_type: k % 4 === 3 ? 'matching' : null, source_url: null, created_at: ago(9000), updated_at: ago(900),
}))
export const catalog_task_assets = catalog_tasks.flatMap((t, k) => [
  { id: U('9', 500 + k * 3), task_id: t.id, kind: 'condition', storage_path: 'physics/ege/1/table.png', alt: 'таблица', position: 1, size_bytes: 12000, source_url: null, tex_session_id: null },
  { id: U('9', 501 + k * 3), task_id: t.id, kind: 'condition', storage_path: 'physics/ege/1/formula-wide.png', alt: 'формула', position: 2, size_bytes: 12000, source_url: null, tex_session_id: null },
  { id: U('9', 502 + k * 3), task_id: t.id, kind: 'condition', storage_path: 'physics/ege/1/figure.png', alt: 'график', position: 3, size_bytes: 12000, source_url: null, tex_session_id: null },
])
export const catalog_topics = [
  { id: IDS.ctopic(1), title: 'Кинематика', parent_id: null, position: 1, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 1, is_published: true, slug: 'kinematika', created_at: ago(9000), updated_at: ago(900) },
  { id: IDS.ctopic(2), title: 'Равноускоренное движение: графики зависимости координаты, скорости и ускорения от времени', parent_id: IDS.ctopic(1), position: 1, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 2, is_published: true, slug: 'ravnouskorennoe', created_at: ago(9000), updated_at: ago(900) },
  { id: IDS.ctopic(3), title: 'Движение по окружности', parent_id: IDS.ctopic(1), position: 2, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 3, is_published: true, slug: 'okruzhnost', created_at: ago(9000), updated_at: ago(900) },
  { id: IDS.ctopic(4), title: 'Динамика', parent_id: null, position: 2, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 4, is_published: true, slug: 'dinamika', created_at: ago(9000), updated_at: ago(900) },
  { id: IDS.ctopic(5), title: 'Законы Ньютона', parent_id: IDS.ctopic(4), position: 1, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 5, is_published: true, slug: 'newton', created_at: ago(9000), updated_at: ago(900) },
]
export const catalog_task_topics = catalog_tasks.map((t, k) => ({ task_id: t.id, topic_id: IDS.ctopic(k % 2 ? 2 : 3), is_primary: true, source: 'import', catalog_tasks: t, catalog_topics: catalog_topics[k % 2 ? 1 : 2] }))
// §188: список «Мои подборки». Три своих неархивных (список показывает их),
// одна архивная и одна чужая — они в списке появиться НЕ должны, и стоят здесь
// именно для того, чтобы это было видно на снимке, а не только в тестах.
//
// Даты у первых двух — от РЕАЛЬНОГО времени прогона, а не от фиксированного
// `NOW` фикстур: формат строки списка («сегодня в 10:16», «вчера в 18:40»)
// иначе на снимке не покажется никогда — `NOW` навсегда в прошлом.
const realAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString()
export const task_collections = [
  { id: IDS.collection, title: 'Подборка: кинематика, 30 заданий для отработки перед контрольной 18 сентября', description: 'Для группы вторник/пятница', subject: 'Физика', work_type: 'custom', is_archived: false, pdf_config: {}, created_by: IDS.owner, created_at: ago(30), updated_at: realAgo(3) },
  { id: IDS.collection2, title: 'Производная: 10 заданий на касательную', description: null, subject: 'Математика', work_type: 'homework', is_archived: false, pdf_config: {}, created_by: IDS.owner, created_at: ago(60), updated_at: realAgo(20) },
  { id: IDS.collection3, title: 'Контрольная по динамике', description: null, subject: 'Физика', work_type: 'control', is_archived: false, pdf_config: {}, created_by: IDS.owner, created_at: ago(24 * 20), updated_at: ago(24 * 14) },
  { id: IDS.collection4, title: 'Убрана в архив: пробник сентября', description: null, subject: 'Физика', work_type: 'ege_variant', is_archived: true, pdf_config: {}, created_by: IDS.owner, created_at: ago(24 * 40), updated_at: ago(24 * 30) },
  { id: IDS.collection5, title: 'Чужая подборка коллеги', description: null, subject: 'Математика', work_type: 'worksheet', is_archived: false, pdf_config: {}, created_by: IDS.profile(1), created_at: ago(24), updated_at: ago(1) },
]
const collectionItems = (collectionId, n, from) => Array.from({ length: n }, (_, k) => ({ id: U('c', from + k), collection_id: collectionId, catalog_task_id: IDS.task(1 + (k % 14)), position: k + 1, custom_number: null, created_at: ago(30), catalog_tasks: catalog_tasks[k % 14] }))
export const task_collection_items = [
  ...collectionItems(IDS.collection, 30, 700),
  ...collectionItems(IDS.collection2, 10, 730),
  ...collectionItems(IDS.collection3, 4, 745),
  ...collectionItems(IDS.collection4, 26, 750),
  ...collectionItems(IDS.collection5, 8, 780),
]

// ── notifications ────────────────────────────────────────────────────────────
const NOTIF = [
  ['homework_returned', 'Работа возвращена на доработку', 'Преподаватель вернул «Домашняя работа №1: графики равноускоренного движения» — посмотри комментарии и пересдай до пятницы.', '/my-homework'],
  ['homework_accepted', 'Домашняя работа принята', 'Оценка 5 за «Домашняя работа №3». Молодец!', '/my-homework'],
  ['variant_assigned', 'Назначен вариант', 'Тренировочный вариант №1 (ЕГЭ физика, полный, 26 заданий, по демоверсии 2027) — до 15 сентября.', '/student/variants'],
  ['variant_graded', 'Вариант проверен', 'Вариант №3: 41 из 54 баллов (76 %).', '/student/variants'],
  ['topic_opened', 'Открыта новая тема', 'Работа, мощность, энергия — материалы и домашнее задание уже доступны.', '/my-course'],
  ['lesson_moved', 'Занятие перенесено', 'Занятие в пятницу 18:00 перенесено на субботу 12:00 по просьбе группы.', null],
  ['system', 'Привяжите Telegram', 'Чтобы получать уведомления о проверке работ в Telegram, привяжите аккаунт в настройках.', '/settings'],
]
export const notifications = [IDS.student, IDS.owner].flatMap(uid => Array.from({ length: 12 }, (_, k) => {
  const n = NOTIF[k % NOTIF.length]
  return { id: U('c', uid === IDS.student ? 800 + k : 900 + k), user_id: uid, type: n[0], title: n[1], message: n[2], link: n[3], read: k > 3, dedup_key: null, created_at: ago(k * 7 + 1) }
}))
export const notification_queue = Array.from({ length: 9 }, (_, k) => ({
  id: U('c', 1000 + k), profile_id: [IDS.student, IDS.profile(0), IDS.profile(2)][k % 3], channel: 'telegram', event_type: ['homework_returned', 'variant_graded', 'homework_submitted'][k % 3], deduplication_key: `hw:${k}:returned:${k}`,
  status: ['sent', 'sent', 'failed', 'pending', 'sent', 'cancelled', 'processing', 'sent', 'failed'][k], attempts: k % 3, retry_count: k % 2, scheduled_for: ago(k), sent_at: k % 3 === 2 ? null : ago(k), processing_at: null,
  last_error: k % 3 === 2 ? 'Telegram API: 403 Forbidden: bot was blocked by the user (chat_id 123456789)' : null, entity_id: null, entity_type: null, payload: {}, created_at: ago(k + 1),
  profiles: { full_name: byId([IDS.student, IDS.profile(0), IDS.profile(2)][k % 3]).full_name, email: byId([IDS.student, IDS.profile(0), IDS.profile(2)][k % 3]).email },
}))
export const telegram_connections = [{ id: U('c', 1100), profile_id: IDS.owner, telegram_chat_id: 123456789, telegram_username: 'vladelets_almiron', is_enabled: true, connected_at: ago(900), disconnected_at: null, disconnect_reason: null, created_at: ago(900), updated_at: ago(900) }]

// ── RPC payloads ─────────────────────────────────────────────────────────────
const journal = {
  homework: topic_homework.map((h, i) => {
    const att = topic_homework_attempts.find(a => a.homework_id === h.id && a.student_id === IDS.studentRow)
    const rev = att?.topic_homework_reviews?.[0]
    const status = !att ? 'not_started' : att.status === 'returned_for_revision' ? 'returned' : att.status
    return { homework_id: h.id, title: h.title, topic_id: h.topic_id, topic_title: h.topics.title, module_title: h.topics.modules.title, course_id: IDS.course, course_title: course.title, due_at: h.due_at, grade_scale: h.grade_scale, status, score: rev?.score ?? null, comment: rev?.comment ?? null, submitted_at: att?.submitted_at ?? null, reviewed_at: rev?.created_at ?? null, attempts_count: att?.attempt_number ?? 0, is_overdue: !att && i >= 2 }
  }),
  tests: [{ assignment_id: IDS.assignment(1), test_id: IDS.test(1), test_title: topic_tests[0].title, topic_id: IDS.topic(1), topic_title: topics[0].title, course_id: IDS.course, course_title: course.title, status: 'completed', total_points: 9, max_points: 12, percent: 75, started_at: ago(50), completed_at: ago(49) }],
  summary: { hw_total: 5, hw_accepted: 1, hw_submitted: 1, hw_returned: 1, hw_pending: 2, hw_overdue: 2, avg_score_five: 5, avg_score_hundred: 87, tests_total: 1, tests_completed: 1, tests_avg_percent: 75 },
}
const variantItems = Array.from({ length: 12 }, (_, k) => {
  const t = catalog_tasks[k]
  return { item_id: U('c', 1200 + k), variant_id: IDS.variant(1), task_id: t.id, item_position: k + 1, points: 1, max_points: 1, grading_type: k % 4 === 3 ? 'manual' : 'auto', task_ext_id: t.external_id, section_id: t.section_id, subject: 'Физика', exam_type: 'ЕГЭ', partial_type: t.partial_type, statement_html: t.statement_html, has_answer: true, has_solution: t.has_solution, exam_part: t.exam_part, source_type: 'catalog', solution_html: t.solution_html, solution_plan_html: null, grade_criteria_html: null, answer_html: t.answer_html, assets: catalog_task_assets.filter(a => a.task_id === t.id) }
})
const myStudents = students.slice(1).map((s, k) => ({ student_id: s.id, profile_id: s.profile_id, full_name: s.profiles.full_name, class_grade: String(s.grade), relation_status: k === 7 ? 'archived' : 'active', added_at: s.created_at,
  courses: [{ course_id: k === 7 ? IDS.course2 : IDS.course, id: k === 7 ? IDS.course2 : IDS.course, title: k === 7 ? course2.title : course.title, group_id: k === 7 ? IDS.group2 : IDS.group, group_name: k === 7 ? groups[1].name : groups[0].name }],
  groups: [{ id: k === 7 ? IDS.group2 : IDS.group, group_id: k === 7 ? IDS.group2 : IDS.group, name: k === 7 ? groups[1].name : groups[0].name, course_id: k === 7 ? IDS.course2 : IDS.course, course_title: k === 7 ? course2.title : course.title }] }))
const days30 = Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.parse(NOW) - (29 - i) * 864e5).toISOString().slice(0, 10), people: 3 + ((i * 7) % 9) }))

// ── задачи к уроку (§162/§164, board/016; лента шагов §175) ─────────────────
// 7 задач темы 1: пять первой части (автопроверка), две второй (только
// «Посмотреть решение» → «Разобрал»). Часть уже решена — ровно то, что
// просила задача 016 для сцены «тема ученика с вкладкой Задачи». У задачи 4
// есть неверные попытки без решения — третье состояние ленты (янтарный
// контур, §175), иначе его не увидеть на снимке.
const topicTaskDefs = Array.from({ length: 7 }, (_, k) => {
  const t = catalog_tasks[k]
  const isPart2 = k >= 5 // задачи 6 и 7 — вторая часть
  const solved = k < 2 || k === 5 // 1, 2 решены ответом; 6 (часть 2) разобрана
  const tried = k === 3 // 4: отвечал дважды, оба раза мимо
  return {
    student_assignment_id: U('c', 1700 + k),
    item_id: U('c', 1700 + k),
    item_position: k + 1,
    task_id: t.id,
    statement_html: t.statement_html,
    assets: catalog_task_assets.filter(a => a.task_id === t.id),
    max_points: isPart2 ? 3 : 1,
    auto_checkable: !isPart2,
    answer_raw: !isPart2 && solved ? String((k + 1) * 2) : tried ? '17' : null,
    is_correct: !isPart2 && solved ? true : tried ? false : null,
    attempts_count: solved ? (k === 0 ? 2 : 1) : tried ? 2 : 0,
    closed_by: solved ? (isPart2 ? 'self' : 'auto') : null,
    solution_shown_at: isPart2 && solved ? ago(2) : null,
    solution_html: solved ? (t.solution_html || '<p>Разбор задачи.</p>') : null,
    answer_html: solved ? t.answer_html : null,
  }
})
// Ответ/разбор/«Разобрал» на харнессе: правят СВОЮ копию строк (каждый
// контекст тура получает `baseFixtures` заново), как это сделала бы база, —
// сцена «после верного ответа» показывает зелёный квадрат при карточке на месте.
function topicTaskRpcs(rowsFor) {
  const find = (body) => rowsFor(body).find(r => r.item_id === body.p_item_id)
  const solutionOf = (r) => catalog_tasks.find(t => t.id === r.task_id) ?? {}
  return {
    topic_tasks_for_student: (body) => rowsFor(body),
    // Правила те же, что у RPC в базе (§162 + §176): ответ после открытого
    // решения не засчитывается, разбор задачи с коротким ответом — после
    // хотя бы одной попытки, «Разобрал» — только после показа решения.
    answer_topic_task: (body) => {
      const r = find(body)
      if (!r) return new Error('ACCESS_DENIED: task not found for this student')
      if (!r.auto_checkable) return new Error('NOT_AUTO_CHECKABLE: this task is closed by self-check after the solution is shown')
      if (r.closed_by) return new Error('ALREADY_SOLVED: task is already closed')
      if (r.solution_shown_at) return new Error('SOLUTION_SHOWN: answer after solution is self-check')
      const ok = String(body.p_answer_raw).trim() === String(r.item_position * 2)
      r.attempts_count += 1
      r.answer_raw = body.p_answer_raw
      r.is_correct = ok
      if (ok) { r.closed_by = 'auto' }
      return { is_correct: ok, attempts_count: r.attempts_count }
    },
    reveal_topic_task_solution: (body) => {
      const r = find(body)
      if (!r) return new Error('ACCESS_DENIED: task not found for this student')
      if (r.auto_checkable && !r.is_correct && r.attempts_count < 1) return new Error('NOT_ATTEMPTED_YET: solution opens after the first attempt')
      const t = solutionOf(r)
      r.solution_shown_at = r.solution_shown_at ?? NOW
      r.solution_html = t.solution_html || '<p>Разбор задачи.</p>'
      r.answer_html = t.answer_html ?? null
      return { solution_html: r.solution_html, solution_plan_html: null, answer_html: r.answer_html }
    },
    close_topic_task_self: (body) => {
      const r = find(body)
      if (!r) return new Error('ACCESS_DENIED: task not found for this student')
      if (r.closed_by) return new Error('ALREADY_SOLVED: task is already closed')
      if (!r.solution_shown_at) return new Error('SOLUTION_NOT_SHOWN: open the solution first')
      r.closed_by = 'self'
      return { closed_by: 'self' }
    },
  }
}
// §179: чистый вердикт для предпросмотра «глазами ученика». Как база: эталон —
// `catalog_tasks.answer_html` без тегов, сравнение после нормализации (здесь —
// trim), для задачи второй части `null`, не персоналу — отказ STAFF_ONLY.
// Ничего не пишет: строки `myTopicTasks` не трогает — память только у вкладки.
function previewTaskVerdict(persona) {
  return (body) => {
    if (persona === 'student' || persona === 'guest') return new Error('STAFF_ONLY: preview verdict is available to platform staff only')
    const t = catalog_tasks.find(t => t.id === body.p_task_id)
    if (!t) return new Error('ACCESS_DENIED: task not found')
    if (t.exam_part === 2) return null
    const reference = String(t.answer_html ?? '').replace(/<[^>]+>/g, '').trim()
    return String(body.p_answer_raw ?? '').trim() === reference
  }
}
const topicTasksStaff = topicTaskDefs.map(r => ({
  item_id: r.item_id, item_position: r.item_position, task_id: r.task_id,
  external_id: catalog_tasks.find(t => t.id === r.task_id)?.external_id ?? null,
  statement_html: r.statement_html, exam_part: r.max_points === 3 ? 2 : 1, max_points: r.max_points,
  auto_checkable: r.auto_checkable, answers_count: r.closed_by ? 12 : 0, closed_count: r.closed_by ? 7 : 0,
}))
const TOPIC_TASK_PROGRESS = [{ tasks_total: 7, students_total: 16, students_started: 12, students_done: 5, closed_auto: 9, closed_self: 2 }]

// ── матрица «ученик × тема с задачами» (§174) ───────────────────────────────
// Ответ `course_topic_tasks_matrix` для курса 1: восемь учеников группы × четыре
// темы с задачами (1, 2, 3, 5). Состояния разложены «по диагонали», чтобы на
// одном экране были все четыре: закрыто всё, часть, ноль при ответах, не
// открывал. Тема 1 согласована с TOPIC_TASK_PROGRESS: 7 задач.
// Тема 3 — 12 задач: двузначное число в кружке столбца «Задачи» матрицы
// «Материалы» (§177) должно поместиться в те же 24 px.
const MATRIX_TOPICS = [[1, 7], [2, 5], [3, 12], [5, 4]] // [номер темы, задач]
const matrixStudents = group_students.filter(g => g.group_id === IDS.group).map(g => ({ id: g.student_id, name: g.students.profiles.full_name }))
const courseTasksMatrix = matrixStudents.flatMap((s, si) => MATRIX_TOPICS.map(([n, total], ti) => {
  const t = topics[n - 1]
  const k = (si + ti) % 5
  // k: 0 — всё ответом; 1 — часть; 2 — отвечал, не закрыл; 3 — всё, две по разбору; 4 — не открывал
  const closedSelf = k === 3 ? 2 : 0
  const closedAuto = k === 0 ? total : k === 1 ? Math.ceil(total / 2) : k === 3 ? total - 2 : 0
  const touched = k === 4 ? 0 : k === 2 ? 2 : total
  return { student_id: s.id, full_name: s.name, topic_id: t.id, topic_title: t.title, module_order: t.modules.order_index, topic_order: t.order_index, tasks_total: total, touched, closed_auto: closedAuto, closed_self: closedSelf }
}))

// ── задачи к уроку в списке курса (§182) ────────────────────────────────────
// Ответ `course_topic_tasks_progress_for_student` — «мои» числа по темам курса.
// Те же темы и те же «всего», что у MATRIX_TOPICS и topicVariants: список курса
// и матрица преподавателя обязаны показывать одно и то же число. «Закрыто» у
// темы 1 — три: столько решено в `topicTaskDefs`, то есть во вкладке «Задачи».
// Состояния разные нарочно: 3 из 7, всё решено, ни одной, одна из четырёх.
const MY_TASKS_CLOSED = { 1: 3, 2: 5, 3: 0, 5: 1 }
const myTasksProgress = MATRIX_TOPICS.map(([n, total]) => ({
  topic_id: IDS.topic(n), tasks_total: total, closed: MY_TASKS_CLOSED[n] ?? 0,
}))

// ── варианты-носители задач к уроку (§164, §177) ────────────────────────────
// Одна строка `test_variants` с `topic_id` на тему с задачами — то, откуда
// матрица «Материалы» берёт число в столбце «Задачи». Темы и числа — те же,
// что в MATRIX_TOPICS, чтобы «Материалы» и «Результаты тестов» не спорили.
// Тема 1 при этом ещё и с тестом из банка (topic_test_assignments): в матрице
// число главнее галочки.
export const topicVariants = MATRIX_TOPICS.map(([n, total]) => ({
  id: IDS.variant(10 + n), title: `Задачи к уроку: ${TOPIC_TITLES[n - 1]}`, description: null,
  subject: 'physics', exam_type: 'ege', source_type: 'teacher_assigned', status: 'published', tasks_count: total, settings: {},
  created_by: IDS.owner, created_at: ago(24 * 10), updated_at: ago(24 * 2), topic_id: IDS.topic(n),
  created_by_profile: { full_name: NAMES[4], email: 'vladelets@harness.invalid' }, profiles: { full_name: NAMES[4], email: 'vladelets@harness.invalid' },
}))

export function baseFixtures(persona) {
  const myTopicTasks = topicTaskDefs.map(r => ({ ...r }))
  const fx = {
    tables: {
      profiles, students, teachers, curators: [], courses, modules, topics, groups, group_students,
      topic_material_items, topic_homework, topic_homework_attempts, topic_homework_reviews, topic_homework_attempt_files,
      topic_tests, topic_test_assignments, topic_test_attempts, topic_test_items: [], test_variants: [...test_variants, ...topicVariants], test_variant_items: Array.from({ length: 26 }, (_, k) => ({ id: U('c', 1600 + k), variant_id: IDS.variant(1), task_id: IDS.task(1 + (k % 14)), position: k + 1, points: k < 20 ? 1 : 3, grading_type: k < 20 ? 'auto' : 'manual', section_id: IDS.section(1), topic_id: null, created_at: ago(100) })),
      catalog_sections, catalog_tasks, catalog_task_assets, catalog_topics, catalog_task_topics, catalog_task_progress: [{ user_id: persona === 'student' ? IDS.student : IDS.owner, task_id: IDS.task(2), is_completed: true, completed_at: ago(10), updated_at: ago(10), catalog_tasks: catalog_tasks[1] }],
      task_collections, task_collection_items, notifications, notification_queue, telegram_connections, course_curators: [], demo_users: [],
      lesson_templates: [], topic_section_marks: [{ topic_id: IDS.topic(3), student_id: IDS.studentRow, group_key: 'theory', marked_at: ago(100) }],
      topic_homework_ai_jobs: aiJobs,
      topic_homework_ai_findings: aiFindings,
      topic_homework_review_tasks,
      annotation_sets: annotationSets, mock_exam_results: [], lesson_materials: [], school_presence: [],
    },
    rpc: {
      record_app_visit: null, school_presence_touch: null,
      topic_solution_state: { has_solution: true, has_homework: true, unlocked: true },
      topic_student_variants: [{ student_assignment_id: U('c', 601), variant_id: IDS.variant(1), title: test_variants[0].title, subject: 'Физика', exam_type: 'ЕГЭ', tasks_count: 26, status: 'in_progress', grading_status: 'not_submitted', due_at: ago(-24), score: null, max_score: 54, percentage: null }],
      get_student_topic_journal: journal,
      get_my_variant_assignments: myAssignments,
      get_variant_items_for_student: variantItems,
      get_catalog_section_counts: catalog_sections.map((s, i) => ({ section_id: s.id, task_count: i === 0 ? 14 : 20 + i * 7, part1_count: 10, part2_count: 4 })),
      get_catalog_section_topic_tree: catalog_topics.map(t => ({ id: t.id, title: t.title, parent_id: t.parent_id, position: t.position, slug: t.slug, external_id: t.external_id, task_count: t.parent_id ? 7 : 14, completed_count: t.parent_id ? 1 : 1 })),
      get_catalog_topic_counts_by_source: catalog_topics.map(t => ({ topic_id: t.id, task_count: 7, completed_count: 1 })),
      get_catalog_section_task_counts_by_source: catalog_sections.map(s => ({ section_id: s.id, task_count: 14, completed_count: 1 })),
      variant_section_available_counts: catalog_sections.map(s => ({ section_id: s.id, available: 14, task_count: 14 })),
      get_my_students: myStudents,
      get_my_student_invites: [{ id: U('c', 1400), full_name: 'Приглашённая Ученица Без Аккаунта', email: 'ochen.dlinnyi.adres.elektronnoy.pochty@example-domain.invalid', phone: '+7 900 000-00-99', status: 'pending', group_id: IDS.group, batch_id: null, client_row_id: null, invited_by: IDS.owner, accepted_at: null, accepted_by: null, revoked_at: null, class_grade: '11', expires_at: ago(-240), created_at: ago(24), updated_at: ago(24) }],
      get_my_join_requests: [{ id: U('c', 1401), full_name: 'Запросов Заявкин Заявкович', email: 'zayavka@example.invalid', status: 'pending', student_id: IDS.otherStudent(6), teacher_id: IDS.teacherRow, created_at: ago(3), reviewed_at: null }],
      students_telegram_flags: students.map((s, i) => ({ student_id: s.id, telegram_linked: i % 2 === 0 })),
      admin_school_stats: { teachers: 2, students: 9, courses: 2, homework_submitted_total: 148, homework_submitted_7d: 23, homework_submitted_today: 4, homework_reviewed: 131, homework_pending: 6, homework_oldest_pending_days: 3, variants_completed: 37, telegram_connected: 5, visits_today: 7, visits_7d: 9 },
      school_dormant_students: [{ student_id: IDS.otherStudent(5), profile_id: IDS.profile(5), full_name: NAMES[7], days_silent: 9, last_active: ago(24 * 9), never_active: false, course_titles: course.title }, { student_id: IDS.otherStudent(6), profile_id: IDS.profile(6), full_name: NAMES[8], days_silent: 0, last_active: null, never_active: true, course_titles: course.title }],
      school_activity_daily: days30,
      school_unopened_materials: topics.slice(0, 4).map((t, i) => ({ topic_id: t.id, topic_title: t.title, course_title: course.title, total_items: 5, unopened: 4 - i, has_data: true })),
      school_homework_funnel: [{ course_id: IDS.course, course_title: course.title, expected: 40, submitted: 31, accepted: 24 }, { course_id: IDS.course2, course_title: course2.title, expected: 5, submitted: 1, accepted: 0 }],
      school_material_view_health: [{ first_day: ago(24 * 60).slice(0, 10), views_7d: 84, views_total: 1203 }],
      get_student_journal: { student: { id: IDS.studentRow, full_name: NAMES[0], grade: 11, target_exam: 'ege', target_subject: 'physics', target_score: 85, groups: [{ group_id: IDS.group, group_name: groups[0].name }] },
        summary: { lessons_completed: 14, present_count: 11, late_count: 2, absent_count: 1, excused_count: 0, attended: 13, missed: 1, attendance_pct: 93, hw_assigned: 5, hw_submitted_ever: 3, hw_accepted: 1, hw_returned: 1, hw_rejected: 0, hw_overdue: 2, hw_on_time: 2, hw_with_due_date: 5, avg_score: 4.5, scored_count: 2 },
        lessons: Array.from({ length: 6 }, (_, i) => ({ id: U('c', 1500 + i), title: i % 2 ? 'Занятие: динамика, наклонная плоскость, трение — разбор домашней работы и контрольная' : 'Занятие', scheduled_at: ago(24 * (2 + i * 3)), duration_minutes: 90, status: i === 0 ? 'scheduled' : 'completed', format: 'online', group_name: groups[0].name, planned_topic: TOPIC_TITLES[i], actual_topic: i ? TOPIC_TITLES[i] : null, lesson_summary: i === 2 ? 'Разобрали задачи 1–8, домашнее задание выдано.' : null, recommendations: null, attendance_status: i === 0 ? null : ['present', 'late', 'absent', 'present', 'present', 'present'][i], attendance_note: null })),
        assignments: [], trend: Array.from({ length: 8 }, (_, i) => ({ week_start: ago(24 * 7 * (8 - i)).slice(0, 10), lessons_completed: 2, submitted: i % 3, accepted: i % 2 })) },
      get_student_number_stats: [],
      topic_homework_ai_expire_stale_jobs: null,
      // §199: строки уже есть — настоящая RPC в этом случае возвращает 0 и
      // ничего не трогает, чтобы правки преподавателя не затирались слепком.
      topic_homework_review_tasks_seed: 0,
      get_variant_results: [], variant_pass_counts: [], variant_topic_availability: [], variant_selection_availability: [],
      ...topicTaskRpcs((body) => body.p_topic_id === IDS.topic(1) ? myTopicTasks : []),
      topic_tasks_for_staff: (body) => body.p_topic_id === IDS.topic(1) ? topicTasksStaff : [],
      preview_task_verdict: previewTaskVerdict(persona),
      topic_task_progress_for_staff: (body) => body.p_topic_id === IDS.topic(1) ? TOPIC_TASK_PROGRESS : [],
      course_topic_tasks_matrix: (body) => body.p_course_id === IDS.course ? courseTasksMatrix : [],
      // §182: как настоящая RPC — строки только ученику курса, персоналу ноль.
      course_topic_tasks_progress_for_student: (body) =>
        persona === 'student' && body.p_course_id === IDS.course ? myTasksProgress : [],
      topic_attached_variants: [], variant_topic_groups: [],
    },
    functions: {},
  }
  fx.rpc.topic_homework_start_attempt = (body) => {
    const id = U('3', 990 + fx.tables.topic_homework_attempts.length)
    fx.tables.topic_homework_attempts.push({ id, homework_id: body.p_homework_id, student_id: IDS.studentRow, attempt_number: 1, status: 'draft', submitted_at: null, created_at: NOW, updated_at: NOW, homework: hwById(body.p_homework_id), topic_homework: hwById(body.p_homework_id), topic_homework_reviews: [] })
    return id
  }
  fx.onWrite = (table, method, rows) => { if (method === 'POST' && Array.isArray(fx.tables[table])) fx.tables[table].push(...rows) }
  return fx
}
