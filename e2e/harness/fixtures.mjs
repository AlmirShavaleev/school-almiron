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
  collection6: U('c', 105), collection7: U('c', 106),
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
// §216. Номера заданий ЕГЭ у темы. Нарочно РАЗНОЙ полноты: у одной темы
// список из двух номеров, у одной — один, у остальных пусто. Пустые нужны не
// меньше заполненных: владельцу предстоит проставлять номера руками, и на
// снимке должно быть видно, как выглядит непроставленная тема.
const TOPIC_EGE_NUMBERS = [[1, 2], [1], [2], [], [], [], [], []]
export const topics = [
  ...TOPIC_TITLES.map((title, i) => ({
    id: IDS.topic(i + 1), module_id: i < 6 ? IDS.module : IDS.module2, title, order_index: i + 1, max_score: 100,
    is_open: i < 5, available_from: i < 5 ? ago(24 * (30 - i * 5)) : '2026-10-20T06:00:00Z', source_template_id: null, created_at: ago(24 * 80),
    ege_task_numbers: TOPIC_EGE_NUMBERS[i] ?? [],
    modules: i < 6 ? modules[0] : modules[1],
  })),
  // темы каркаса (§174) — три первые темы механики
  ...TOPIC_TITLES.slice(0, 3).map((title, i) => ({
    id: IDS.topic(20 + i + 1), module_id: IDS.moduleTemplate, title, order_index: i + 1, max_score: 100,
    is_open: null, available_from: null, source_template_id: null, created_at: ago(24 * 80),
    ege_task_numbers: [], modules: modules[2],
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
  // §216. Тот же ученик учится и физике, и математике — иначе блок целей по
  // предметам нечем показать: смысл раздела ровно в том, что предметов два и
  // цели у них разные.
  { id: U('f', 121), group_id: IDS.group2, student_id: IDS.otherStudent(0), joined_at: ago(24 * 12) },
].map(gs => ({ ...gs, groups: groups.find(g => g.id === gs.group_id), students: studentById(gs.student_id) }))
groups[0].group_students = group_students.filter(g => g.group_id === IDS.group).map(g => ({ student_id: g.student_id, students: g.students, count: undefined }))
groups[1].group_students = group_students.filter(g => g.group_id === IDS.group2).map(g => ({ student_id: g.student_id, students: g.students }))

// ── пробники (§215, board/067) ───────────────────────────────────────────────
// Два пробника одной группы: у первого половина группы уже внесена — на нём и
// снимается «сохранение частями подхватывается». Выдумка целиком: и названия,
// и баллы. Максимум 100, чтобы «101» на снимке ошибки читался сразу.
export const mock_exams = [
  {
    id: U('c', 700), title: 'Пробник ЕГЭ №3 · механика', subject: 'physics', exam_type: 'ege',
    group_id: IDS.group, date: ago(24 * 6), max_score: 100, created_by: IDS.teacherRow, created_at: ago(24 * 7),
  },
  {
    id: U('c', 701), title: 'Пробник ЕГЭ №2 · кинематика', subject: 'physics', exam_type: 'ege',
    group_id: IDS.group, date: ago(24 * 34), max_score: 100, created_by: IDS.teacherRow, created_at: ago(24 * 35),
  },
].map(e => ({ ...e, groups: groups.find(g => g.id === e.group_id) }))

/** Половина группы первого пробника: четыре строки из восьми. */
export const mock_exam_results = [
  { student_id: IDS.studentRow,     score: 78, part1_score: 40, part2_score: 38, notes: 'вторая часть слабее, разобрать задачу на графики' },
  { student_id: IDS.otherStudent(0), score: 64, part1_score: 38, part2_score: 26, notes: null },
  { student_id: IDS.otherStudent(1), score: 91, part1_score: 45, part2_score: 46, notes: 'лучший результат группы' },
  { student_id: IDS.otherStudent(2), score: 52, part1_score: 34, part2_score: 18, notes: null },
].map((r, i) => ({
  id: U('c', 710 + i), mock_exam_id: U('c', 700), created_at: ago(24 * 5),
  ...r,
  students: studentById(r.student_id),
}))
mock_exams[0].mock_exam_results = mock_exam_results
mock_exams[1].mock_exam_results = []

// ── §218: пробник по номерам заданий ─────────────────────────────────────────
// Ростер и баллы — из утверждённого макета (МАКЕТ-ПРОБНИКА.html), выдумка
// целиком. Отдельная группа «11А профиль» со своими двенадцатью учениками:
// в общие `students`/`profiles` они НЕ добавлены, чтобы не сдвинуть счётчики
// на чужих снимках, — экран пробника берёт их через embed `group_students`.
// Половина группы уже внесена (шесть строк из двенадцати), как в макете.
export const MOCK_GROUP = U('f', 300)
export const MOCK_EXAM = U('c', 720)
const MOCK_ROSTER = [
  'Абрамова Дарья', 'Белов Артём', 'Гарипов Тимур', 'Ёлкина Мария', 'Иванов Иван', 'Иванов Кирилл',
  'Каримова Алсу', 'Лебедев Максим', 'Мухаметзянов Ренат', 'Никитина Полина', 'Сафин Амир', 'Шарипова Лейла',
]
const mockStudent = (k) => U('b', 300 + k)
export const mock_exam_templates = [{
  id: U('c', 730), title: 'ЕГЭ математика, профиль', subject: 'math', exam_type: 'ege', year: 2027,
  max_points: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 2, 3, 4, 4], part1_last: 12, score_scale: null,
}]
const mockGroupStudents = MOCK_ROSTER.map((name, k) => ({
  id: U('f', 310 + k), group_id: MOCK_GROUP, student_id: mockStudent(k), joined_at: ago(24 * 30),
  students: { id: mockStudent(k), profile_id: U('a', 300 + k), profiles: { id: U('a', 300 + k), full_name: name, avatar_url: null } },
}))
group_students.push(...mockGroupStudents)
const MOCK_SEED = {
  'Каримова Алсу':      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 2, 1],
  'Лебедев Максим':     [1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 2, 0, 0, 0],
  'Мухаметзянов Ренат': [1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 2, 1, 0, 1, 0, 0, 0],
  'Никитина Полина':    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 2, 2, 3, 2],
  'Шарипова Лейла':     [1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0],
  'Гарипов Тимур':      [1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 2, 1, 1, 2, 1, 1, 0],
}
export const mock_exam_task_scores = Object.entries(MOCK_SEED).flatMap(([name, pts]) =>
  pts.map((points, t) => ({ mock_exam_id: MOCK_EXAM, student_id: mockStudent(MOCK_ROSTER.indexOf(name)), task_number: t + 1, points })))
const mockTotals = Object.entries(MOCK_SEED).map(([name, pts]) => {
  const p1 = pts.slice(0, 12).reduce((a, b) => a + b, 0), p2 = pts.slice(12).reduce((a, b) => a + b, 0)
  // §219. Отметка «что отправлено»: Каримовой отправлен этот же итог,
  // Никитиной — отправлялся другой (итог потом поправили), остальным — нет.
  const notified = name === 'Каримова Алсу'
    ? { notified_at: '2026-09-25T17:40:00Z', notified_score: p1 + p2, notified_part1_score: p1, notified_part2_score: p2 }
    : name === 'Никитина Полина'
      ? { notified_at: '2026-09-24T15:05:00Z', notified_score: p1 + p2 - 2, notified_part1_score: p1, notified_part2_score: p2 - 2 }
      : { notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null }
  return { id: U('c', 740 + MOCK_ROSTER.indexOf(name)), mock_exam_id: MOCK_EXAM, student_id: mockStudent(MOCK_ROSTER.indexOf(name)), score: p1 + p2, primary_score: p1 + p2, part1_score: p1, part2_score: p2, notes: null, created_at: ago(24), ...notified, students: mockGroupStudents[MOCK_ROSTER.indexOf(name)].students }
})
// Отдельным массивом: общий `mock_exam_results` висит embed-ом на физическом
// пробнике, и строки математики иначе показались бы и там.
mock_exams.unshift({
  id: MOCK_EXAM, title: 'Пробник №3', subject: 'math', exam_type: 'ege', group_id: MOCK_GROUP, template_id: mock_exam_templates[0].id,
  date: '2026-10-18T09:00:00Z', max_score: 32, created_by: IDS.teacherRow, created_at: ago(24 * 2),
  groups: { name: '11А профиль' }, mock_exam_templates: mock_exam_templates[0],
  mock_exam_results: mockTotals, mock_exam_task_scores,
})
// Один из девяти образцов прода: без группы — таблица не открывается, и
// список обязан сказать это словами.
mock_exams.push({
  id: U('c', 721), title: 'Образец: пробник без группы', subject: 'math', exam_type: 'ege', group_id: null, template_id: null,
  date: ago(24 * 90), max_score: 100, created_by: null, created_at: ago(24 * 90), groups: null, mock_exam_results: [],
})
/** Имитация `save_mock_exam_grid`: итог = сумма клеток, old_score — из «базы». */
function saveMockExamGrid(body) {
  const rows = (body.p_rows ?? []).map(r => {
    const filled = r.points.filter(p => p != null)
    const score = filled.length ? filled.reduce((a, b) => a + b, 0) : null
    const prev = mockTotals.find(x => x.mock_exam_id === body.p_mock_exam_id && x.student_id === r.student_id)
    return { student_id: r.student_id, old_score: prev ? prev.score : null, score }
  })
  return { rows }
}
/**
 * §219. Имитация `notify_mock_exam_results`: тот же итог второй раз не
 * уходит; отметка ставится в «базе», чтобы экран после отправки показал
 * «отправлено». Telegram «подключён» у каждого второго — для текста статуса.
 */
function notifyMockExamResults(body) {
  const at = new Date().toISOString()
  const ids = body.p_student_ids ?? [...mockTotals, ...d227Totals].filter(r => r.mock_exam_id === body.p_mock_exam_id).map(r => r.student_id)
  let sent = 0, already = 0, telegram = 0
  const rows = []
  for (const id of ids) {
    const r = [...mockTotals, ...d227Totals].find(x => x.mock_exam_id === body.p_mock_exam_id && x.student_id === id)
    if (!r) continue
    if (r.notified_at && r.notified_score === r.score && r.notified_part1_score === r.part1_score && r.notified_part2_score === r.part2_score) { already++; continue }
    Object.assign(r, { notified_at: at, notified_score: r.score, notified_part1_score: r.part1_score, notified_part2_score: r.part2_score })
    sent++
    if (sent % 2) telegram++
    rows.push({ student_id: id, notified_at: at })
  }
  return { sent, telegram, already, no_result: 0, no_profile: 0, rows }
}

// ── §221: пробник как урок в курсе ───────────────────────────────────────────
// Отдельный курс математики со своей группой: ученик-персона учится и в нём.
// Четыре пробника одного раздела в четырёх состояниях — до начала, идёт,
// сдан, с результатом. Время — от НАСТОЯЩЕГО «сейчас» прогона (а не NOW
// фикстур): страница считает таймер от server_now, и «идёт, осталось 2:47»
// должно быть правдой в момент снимка. Выдумка целиком.
export const LESSON = {
  course: U('d', 50), module: U('e', 50), group: U('f', 50),
  up: U('c', 761), open: U('c', 762), sub: U('c', 763), res: U('c', 764),
  // §224: пробник со временем, но без раздела (видим только в my_mock_exams).
  stray: U('c', 765),
}
const mathCourse = { ...course2, id: LESSON.course, title: 'Математика ЕГЭ, профиль · 11А', subject: 'math', exam_type: 'ege', is_default_for_direction: false }
const lessonGroup = { id: LESSON.group, name: '11А · профиль', course_id: LESSON.course, teacher_id: IDS.teacherRow, curator_id: null, is_active: true, max_students: 12, schedule_days: ['saturday'], schedule_time: '10:00', type: 'group', created_at: ago(24 * 40), teachers: teachers[0], curators: null, courses: mathCourse }
const lessonTopics = ['Планиметрия: треугольники и окружности', 'Производная и исследование функции', 'Текстовые задачи на движение и работу'].map((title, i) => ({
  id: U('1', 50 + i), module_id: LESSON.module, title, order_index: i + 1, max_score: 100, is_open: true, available_from: ago(24 * (20 - i * 5)), source_template_id: null, created_at: ago(24 * 40), ege_task_numbers: [],
}))
modules.push({ id: LESSON.module, course_id: LESSON.course, title: 'Первый блок: планиметрия, производная, текстовые задачи', order_index: 1, created_at: ago(24 * 40), courses: mathCourse, topics: lessonTopics })
const LESSON_ROSTER = [IDS.studentRow, IDS.otherStudent(0), IDS.otherStudent(1), IDS.otherStudent(2), IDS.otherStudent(3)]
group_students.push(...LESSON_ROSTER.map((sid, k) => ({ id: U('f', 500 + k), group_id: LESSON.group, student_id: sid, joined_at: ago(24 * 30), groups: lessonGroup, students: studentById(sid) })))
const MIN = 60e3
// Число — минуты от «сейчас»; строка — точный момент (10:00 по Москве в
// нужный день, чтобы подпись «откроется 29.09 в 10:00» была круглой).
const mskTen = (days) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, 7, 0)).toISOString() }
const lessonWindow = (startOffsetMin) => {
  const s = typeof startOffsetMin === 'string' ? Date.parse(startOffsetMin) : Date.now() + startOffsetMin * MIN
  return { starts_at: new Date(s).toISOString(), ends_at: new Date(s + 240 * MIN).toISOString(), photos_until: new Date(s + 255 * MIN).toISOString() }
}
const LESSON_EXAMS = [
  // [id, название, место (после темы с этим order_index), начало от «сейчас», мин]
  [LESSON.res, 'Пробник №1', 0, mskTen(-8)],
  [LESSON.sub, 'Пробник №2', 1, -120],
  [LESSON.open, 'Пробник №3', 2, -73],
  [LESSON.up, 'Пробник №4', 3, mskTen(3)],
]
const tpl = mock_exam_templates[0]
for (const [id, title, pos, off] of LESSON_EXAMS) {
  const w = lessonWindow(off)
  mock_exams.push({
    id, title, subject: 'math', exam_type: 'ege', group_id: LESSON.group, template_id: tpl.id,
    date: w.starts_at, max_score: 32, created_by: IDS.teacherRow, created_at: ago(24 * 10),
    module_id: LESSON.module, module_position: pos, starts_at: w.starts_at, duration_minutes: 240, photo_grace_minutes: 15,
    condition_path: `${id}/condition/1_variant.pdf`, solution_path: `${id}/solution/1_variant-reshenie.pdf`,
    groups: { name: lessonGroup.name, course_id: LESSON.course }, mock_exam_templates: tpl,
    mock_exam_results: [], mock_exam_task_scores: [],
  })
}
// Ключ и ответы — из утверждённого макета.
const LESSON_KEY = ['12', '0,75', '-3', '49', '0,2', '6', '27', '5', '3', '144', '0,25', '4']
const MY_ANSWERS = ['12', '0,75', '-3', '49', '0,2', '6', '27', '5', '', '144', '0,35', '4']
export const mock_exam_answer_keys = [LESSON.up, LESSON.res].map(id => ({ mock_exam_id: id, answers: LESSON_KEY, updated_by: IDS.owner, updated_at: ago(24) }))
// Таблица §218 проверенного пробника: первая часть — по ключу (auto_points =
// points), вторая — руками. У второго ученика №11 ключ дал 0, преподаватель
// исправил на 1 — клетка ручная.
const LESSON_P2 = [[2, 1, 2, 2, 1, 0, 0], [2, 2, 1, 1, 1, 1, 0], [1, 0, 2, 0, 0, 0, 0], [2, 3, 2, 2, 2, 2, 1], null]
const LESSON_P1 = [
  MY_ANSWERS.map((a, i) => (a && a === LESSON_KEY[i] ? 1 : 0)),
  [1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  null,
]
const lessonScores = LESSON_ROSTER.flatMap((sid, k) => {
  if (!LESSON_P1[k]) return []
  return [
    ...LESSON_P1[k].map((p, t) => ({ mock_exam_id: LESSON.res, student_id: sid, task_number: t + 1, points: k === 1 && t === 10 ? 1 : p, auto_points: p })),
    ...LESSON_P2[k].map((p, t) => ({ mock_exam_id: LESSON.res, student_id: sid, task_number: 13 + t, points: p, auto_points: null })),
  ]
})
mock_exam_task_scores.push(...lessonScores)
const lessonTotals = LESSON_ROSTER.flatMap((sid, k) => {
  const rows = lessonScores.filter(r => r.student_id === sid)
  if (!rows.length) return []
  const p1 = rows.filter(r => r.task_number <= 12).reduce((a, r) => a + r.points, 0)
  const p2 = rows.filter(r => r.task_number > 12).reduce((a, r) => a + r.points, 0)
  const sent = k === 0 ? { notified_at: ago(-24 * 12), notified_score: p1 + p2, notified_part1_score: p1, notified_part2_score: p2 } : { notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null }
  return [{ id: U('c', 770 + k), mock_exam_id: LESSON.res, student_id: sid, score: p1 + p2, primary_score: p1 + p2, part1_score: p1, part2_score: p2, notes: null, created_at: ago(24), ...sent, students: studentById(sid) }]
})
const resWindow = lessonWindow(mskTen(-8))
export const mock_exam_sheets = LESSON_ROSTER.slice(0, 4).map((sid, k) => ({
  mock_exam_id: LESSON.res, student_id: sid, answers: k === 0 ? MY_ANSWERS : LESSON_KEY,
  submitted_at: k === 2 ? null : new Date(Date.parse(resWindow.starts_at) + (150 + k * 20) * MIN).toISOString(),
}))
export const mock_exam_photos = LESSON_ROSTER.slice(0, 4).flatMap((sid, k) => Array.from({ length: [3, 2, 1, 4][k] }, (_, i) => ({
  id: U('c', 780 + k * 10 + i), mock_exam_id: LESSON.res, student_id: sid,
  storage_path: `${LESSON.res}/photos/${sid}/${i}_stranica-${i + 1}.webp`, file_name: `стр ${i + 1}.webp`, position: i,
})))
const myPhotos = (id, n) => Array.from({ length: n }, (_, i) => ({
  id: U('c', 800 + i), storage_path: `${id}/photos/${IDS.studentRow}/${i}_stranica-${i + 1}.webp`, file_name: `стр ${i + 1}.webp`, mime_type: 'image/webp', size_bytes: 410000, position: i, created_at: ago(1),
}))
function lessonState(id) {
  const e = mock_exams.find(x => x.id === id)
  if (!e || e.group_id !== LESSON.group) return null
  const off = LESSON_EXAMS.find(x => x[0] === id)[3]
  const w = lessonWindow(off)
  const started = Date.now() >= Date.parse(w.starts_at)
  const sub = id === LESSON.sub ? new Date(Date.now() - 40 * MIN).toISOString() : id === LESSON.res ? mock_exam_sheets[0].submitted_at : null
  return {
    id, title: e.title, group_id: LESSON.group, student_id: IDS.studentRow, template_title: tpl.title,
    task_count: 19, part1_last: 12, part2_max: tpl.max_points.slice(12),
    ...w, server_now: new Date().toISOString(),
    condition_path: started ? e.condition_path : null,
    answers: id === LESSON.up ? [] : id === LESSON.sub ? MY_ANSWERS.map(a => a || '8') : MY_ANSWERS,
    submitted_at: sub, updated_at: started ? new Date(Date.now() - 2 * MIN).toISOString() : null,
    notified: id === LESSON.res,
    photos: id === LESSON.open ? myPhotos(id, 3) : id === LESSON.sub ? myPhotos(id, 2) : id === LESSON.res ? myPhotos(id, 3) : [],
  }
}
function lessonList(body) {
  // §224.2: песочница владельца — своя группа, свой список.
  const sandbox = sandboxMockList(body)
  if (sandbox) return sandbox
  if (body.p_group_id !== LESSON.group) return []
  const rows = LESSON_EXAMS.map(([id, , pos]) => {
    const s = lessonState(id)
    const res = id === LESSON.res ? lessonTotals[0] : null
    return { id, title: s.title, module_id: LESSON.module, module_position: pos, starts_at: s.starts_at, ends_at: s.ends_at, photos_until: s.photos_until, duration_minutes: 240, submitted_at: s.submitted_at, has_work: id !== LESSON.up, notified: s.notified, score: res ? res.score : null, max_score: res ? 32 : null, server_now: s.server_now }
  })
  // §224. Опасность из карточки 073: пробник со временем, но без раздела
  // (на проде — «Тест» 11А, 26.09 в 06:05). До §224 ученик его не видел, с
  // §224 он в разделе «Пробники» — прошедшим и «не сданным». На снимке он
  // есть намеренно: так он будет выглядеть, если его не убрать до слияния.
  const t = lessonWindow(mskTen(-1))
  rows.push({ id: LESSON.stray, title: 'Тест', module_id: null, module_position: 0, ...t, duration_minutes: 240, submitted_at: null, has_work: false, notified: false, score: null, max_score: null, server_now: new Date().toISOString() })
  return rows
}
function lessonResult(body) {
  if (body.p_mock_exam_id !== LESSON.res) return { status: 'pending' }
  const mine = lessonScores.filter(r => r.student_id === IDS.studentRow)
  const tot = lessonTotals[0]
  return {
    status: 'ready', title: 'Пробник №1', notified_at: tot.notified_at, score: tot.score, max_score: 32,
    primary_score: tot.primary_score, part1_score: tot.part1_score, part2_score: tot.part2_score, part1_last: 12,
    solution_path: `${LESSON.res}/solution/1_variant-reshenie.pdf`,
    tasks: tpl.max_points.map((m, t) => ({ n: t + 1, max: m, points: mine.find(r => r.task_number === t + 1)?.points ?? null, answer: t < 12 ? (MY_ANSWERS[t] || null) : null, correct: t < 12 ? LESSON_KEY[t] : null })),
  }
}
export const lessonRpcs = {
  my_mock_exams: lessonList,
  my_mock_exam: (body) => lessonState(body.p_mock_exam_id),
  my_mock_exam_result: lessonResult,
  save_mock_exam_answer: (body) => ({ task: body.p_task, answer: body.p_answer, saved_at: new Date().toISOString() }),
  submit_mock_exam: () => ({ submitted_at: new Date().toISOString() }),
  add_mock_exam_photo: (body) => ({ id: U('c', 899), storage_path: body.p_storage_path, file_name: body.p_file_name, mime_type: body.p_mime_type, size_bytes: body.p_size_bytes, position: 9, created_at: new Date().toISOString() }),
  grade_mock_exam_part1: { graded_students: 4, changed_cells: 0 },
  save_mock_exam_key: { not_checkable: [], grade: { graded_students: 4, changed_cells: 0 } },
}
export { lessonTotals }

// ── §224: монитор идущего пробника ───────────────────────────────────────────
// Отдельная группа «11Б · профиль» из шестнадцати выдуманных учеников, как у
// «11А профиль» (§218): в общие `students`/`profiles` они НЕ добавлены, экран
// берёт их через embed `group_students`, а монитор — из `mock_exam_live`.
// Два пробника: идёт (начался 47 минут назад) и закончился 5 минут назад
// (идёт догрузка фото). Время — от настоящего «сейчас» прогона.
export const LIVE = { group: U('f', 600), course: U('d', 60), run: U('c', 1650), grace: U('c', 1651) }
const LIVE_ROSTER = [
  'Алексеева Ксения', 'Бондарев Глеб', 'Валиева Диана', 'Гусев Матвей', 'Данилова Софья', 'Егоров Никита',
  'Жукова Вероника', 'Зайцев Роман', 'Исаева Амина', 'Королёв Даниил', 'Литвинова Ева', 'Морозов Лев',
  'Нуриева Камила', 'Орлов Семён', 'Павлова Алиса', 'Рахимов Артур',
]
const liveStudent = (k) => U('b', 600 + k)
const liveGroupStudents = LIVE_ROSTER.map((name, k) => ({
  id: U('f', 610 + k), group_id: LIVE.group, student_id: liveStudent(k), joined_at: ago(24 * 30),
  students: { id: liveStudent(k), profile_id: U('a', 600 + k), profiles: { id: U('a', 600 + k), full_name: name, avatar_url: null } },
}))
group_students.push(...liveGroupStudents)
const LIVE_EXAMS = [[LIVE.run, 'Пробник №5', -47], [LIVE.grace, 'Пробник №4', -245]]
for (const [id, title, off] of LIVE_EXAMS) {
  const w = lessonWindow(off)
  mock_exams.push({
    id, title, subject: 'math', exam_type: 'ege', group_id: LIVE.group, template_id: tpl.id,
    date: w.starts_at, max_score: 32, created_by: IDS.teacherRow, created_at: ago(24 * 5),
    module_id: null, module_position: 0, starts_at: w.starts_at, duration_minutes: 240, photo_grace_minutes: 15,
    condition_path: `${id}/condition/1_variant.pdf`, solution_path: null,
    groups: { name: '11Б · профиль', course_id: LIVE.course }, mock_exam_templates: tpl,
    mock_exam_results: [], mock_exam_task_scores: [],
  })
}
// Состояния учеников: [имя, вид, минут назад последний пинг / сдал, заполнено полей, фото].
// Идёт: 9 пишут, 4 сдали, 1 был и ушёл, 2 не заходили.
const LIVE_RUN = {
  'Алексеева Ксения': ['online', 0.3, 9, 0], 'Бондарев Глеб': ['online', 0.5, 7, 0], 'Валиева Диана': ['submitted', 6, 12, 3],
  'Гусев Матвей': ['online', 0.2, 11, 1], 'Данилова Софья': ['online', 0.6, 4, 0], 'Егоров Никита': ['online', 0.4, 8, 0],
  'Жукова Вероника': ['away', 19, 5, 0], 'Зайцев Роман': ['absent'], 'Исаева Амина': ['submitted', 14, 12, 4],
  'Королёв Даниил': ['online', 0.9, 6, 0], 'Литвинова Ева': ['submitted', 2, 11, 2], 'Морозов Лев': ['absent'],
  'Нуриева Камила': ['online', 0.2, 10, 2], 'Орлов Семён': ['online', 1, 3, 0], 'Павлова Алиса': ['submitted', 22, 12, 3],
  'Рахимов Артур': ['online', 0.7, 12, 0],
}
// Закончился 5 минут назад: 12 сдали, 2 открывали и не нажали «Сдать», 2 не заходили.
const LIVE_GRACE = Object.fromEntries(LIVE_ROSTER.map((name, k) => [name,
  k === 7 || k === 11 ? ['absent'] : k === 6 || k === 13 ? ['away', 40 + k, 7, 1] : ['submitted', 10 + k * 7, 12 - (k % 3), 2 + (k % 3)]]))
const liveState = (id) => (id === LIVE.run ? LIVE_RUN : id === LIVE.grace ? LIVE_GRACE : null)
function liveRows(id) {
  const st = liveState(id)
  const off = LIVE_EXAMS.find(x => x[0] === id)[2]
  const w = lessonWindow(off)
  return LIVE_ROSTER.map((name, k) => {
    const [kind, agoMin, answered, photos] = st[name]
    const t = (m) => new Date(Date.now() - m * MIN).toISOString()
    return {
      student_id: liveStudent(k), name, kind,
      has_sheet: kind !== 'absent',
      opened_at: kind === 'absent' ? null : new Date(Date.parse(w.starts_at) + (2 + k) * MIN).toISOString(),
      last_seen_at: kind === 'absent' ? null : t(agoMin),
      online: kind === 'online',
      answered: kind === 'absent' ? 0 : answered,
      submitted_at: kind === 'submitted' ? t(agoMin) : null,
      photos: photos ?? 0,
    }
  })
}
// Бланки и фото — для ссылок «стр. N» (их экран берёт из таблиц, как в §221).
export const liveSheets = LIVE_EXAMS.flatMap(([id]) => liveRows(id).filter(r => r.has_sheet).map(r => ({ mock_exam_id: id, student_id: r.student_id, submitted_at: r.submitted_at })))
export const livePhotos = LIVE_EXAMS.flatMap(([id]) => liveRows(id).flatMap(r => Array.from({ length: r.photos }, (_, i) => ({
  id: U('c', 60000 + (id === LIVE.run ? 0 : 1000) + LIVE_ROSTER.indexOf(r.name) * 10 + i), mock_exam_id: id, student_id: r.student_id,
  storage_path: `${id}/photos/${r.student_id}/${i}_stranica-${i + 1}.webp`, file_name: `стр ${i + 1}.webp`, position: i,
}))))
export const liveRpcs = {
  mock_exam_live: (body) => {
    if (!liveState(body.p_mock_exam_id)) return null
    const [id, title, off] = LIVE_EXAMS.find(x => x[0] === body.p_mock_exam_id)
    return {
      id, title, group_id: LIVE.group, ...lessonWindow(off), server_now: new Date().toISOString(), part1_last: 12,
      students: liveRows(id).map(({ kind: _k, ...r }) => r),
    }
  },
  mock_exam_ping: { pinged: true },
}

// ── §224.2: сценарий владельца 26.09 — «ученик ничего не видит» ──────────────
// Курс «Песочница — пробник (тест)»: ОДИН раздел «Основной», в нём ОДНА пустая
// тема, и онлайн-пробник «№1» без раздела (module_id = null), который идёт
// прямо сейчас — осталось 7 минут. Ученик-персона записан в группу. Группа
// лежит и в общей `groups` — иначе владелец в предпросмотре «Ученик» курса не
// увидит (предпросмотр читает группы под RLS персонала). Выдумка целиком.
export const SANDBOX = { course: U('d', 70), module: U('e', 70), group: U('f', 70), topic: U('1', 70), exam: U('c', 1670) }
const sandboxCourse = { ...course2, id: SANDBOX.course, title: 'Песочница — пробник (тест)', subject: 'math', exam_type: 'ege', start_date: null, end_date: null, is_default_for_direction: false }
const sandboxTopic = { id: SANDBOX.topic, module_id: SANDBOX.module, title: 'Урок перед пробником (пустой)', order_index: 1, max_score: 100, is_open: true, available_from: ago(24), source_template_id: null, created_at: ago(24), ege_task_numbers: [] }
const sandboxModule = { id: SANDBOX.module, course_id: SANDBOX.course, title: 'Основной', order_index: 1, created_at: ago(24), courses: sandboxCourse }
modules.push({ ...sandboxModule, topics: [sandboxTopic] })
topics.push({ ...sandboxTopic, modules: sandboxModule })
const sandboxGroup = { id: SANDBOX.group, name: 'Песочница', course_id: SANDBOX.course, teacher_id: IDS.teacherRow, curator_id: null, is_active: true, max_students: 5, schedule_days: [], schedule_time: null, type: 'group', created_at: ago(24), teachers: teachers[0], curators: null, courses: sandboxCourse }
groups.push(sandboxGroup)
group_students.push({ id: U('f', 700), group_id: SANDBOX.group, student_id: IDS.studentRow, joined_at: ago(24), groups: sandboxGroup, students: studentById(IDS.studentRow) })
// Осталось 7 минут: начало — 233 минуты назад от настоящего «сейчас» прогона.
const SANDBOX_START_MIN = -233
{
  const w = lessonWindow(SANDBOX_START_MIN)
  mock_exams.push({
    id: SANDBOX.exam, title: '№1', subject: 'math', exam_type: 'ege', group_id: SANDBOX.group, template_id: tpl.id,
    date: w.starts_at, max_score: 32, created_by: IDS.teacherRow, created_at: ago(2),
    module_id: null, module_position: 0, starts_at: w.starts_at, duration_minutes: 240, photo_grace_minutes: 15,
    condition_path: null, solution_path: null,
    groups: { name: sandboxGroup.name, course_id: SANDBOX.course }, mock_exam_templates: tpl,
    mock_exam_results: [], mock_exam_task_scores: [],
  })
}
/** `my_mock_exams` песочницы: бланка нет — ученик страницу пробника не открывал. */
export function sandboxMockList(body) {
  if (body.p_group_id !== SANDBOX.group) return null
  const w = lessonWindow(SANDBOX_START_MIN)
  return [{ id: SANDBOX.exam, title: '№1', module_id: null, module_position: 0, ...w, duration_minutes: 240, submitted_at: null, has_work: false, notified: false, score: null, max_score: null, server_now: new Date().toISOString() }]
}

// ── §227: таблица пробника в новом дизайне ───────────────────────────────────
// Группа «11А профиль» (двенадцать учеников §218). Два пробника:
//  * `grid` — онлайн, закончился шесть дней назад: одиннадцать строк внесены,
//    двенадцатой нет; первая часть — по ключу («авто»), у Ёлкиной два ответа
//    ключ не проверил (пустые клетки первой части сданного бланка — «не
//    сверено»); у Белова авто-клетку №5 преподаватель исправил (ручная);
//    вторая часть — руками, с частичными, нулями и нерешёнными. Есть таблица
//    перевода — вывод говорит о тестовых баллах. Баллы — генератор макета
//    (`ДИЗАЙН-V2/design-v2.html`, тот же посев), выдумка целиком.
//  * `empty` — без окна и без баллов: пустая таблица.
export const D227 = { grid: U('c', 1680), empty: U('c', 1681), tpl: U('c', 732) }
const D227_TPL = {
  ...mock_exam_templates[0], id: D227.tpl,
  score_scale: [0, 6, 11, 17, 22, 27, 34, 40, 46, 52, 58, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 100, 100, 100],
}
const d227Points = (() => {
  let s = 11
  const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  const max = D227_TPL.max_points
  const diff = [.97, .93, .92, .88, .88, .82, .8, .76, .72, .7, .62, .55, .5, .3, .45, .18, .35, .14, .1]
  const abil = [.9, 1.1, .8, 1.05, .7, 1.2, .85, .95, .6, 1.0, .75, 1]
  return MOCK_ROSTER.map((_, i) => {
    if (i === 11) return null
    return max.map((mx, j) => {
      const p = Math.min(.98, diff[j] * abil[i]); const r = rnd()
      if (j < 12) return r < p ? 1 : (rnd(), 0)
      // Не решал — у каждого третьего пусто («—»), у остальных 0: иначе пустые
      // клетки не входят в «набрано по номеру», и слабых номеров не видно.
      if (r > p * 1.6) return (i + j) % 3 ? 0 : null
      return r < p ? mx : Math.max(0, Math.round(mx * rnd() * .7))
    })
  })
})()
const d227Start = lessonWindow(mskTen(-6)).starts_at
mock_exams.push(
  {
    id: D227.grid, title: 'Пробник №2', subject: 'math', exam_type: 'ege', group_id: MOCK_GROUP, template_id: D227.tpl,
    date: d227Start, max_score: 100, created_by: IDS.teacherRow, created_at: ago(24 * 9),
    module_id: null, module_position: 0, starts_at: d227Start, duration_minutes: 240, photo_grace_minutes: 15,
    condition_path: `${D227.grid}/condition/1_variant.pdf`, solution_path: null,
    groups: { name: '11А профиль' }, mock_exam_templates: D227_TPL, mock_exam_results: [], mock_exam_task_scores: [],
  },
  {
    id: D227.empty, title: 'Пробник №4', subject: 'math', exam_type: 'ege', group_id: MOCK_GROUP, template_id: mock_exam_templates[0].id,
    date: '2026-10-25T09:00:00Z', max_score: 32, created_by: IDS.teacherRow, created_at: ago(3),
    groups: { name: '11А профиль' }, mock_exam_templates: mock_exam_templates[0], mock_exam_results: [], mock_exam_task_scores: [],
  },
)
const d227Scores = d227Points.flatMap((pts, i) => (pts ?? []).flatMap((v, t) => {
  // Ёлкина: №9 и №11 ключ не проверил — клетки пустые, ждут преподавателя.
  if (i === 3 && (t === 8 || t === 10)) return []
  if (v == null) return []
  const auto = t < 12 ? v : null
  const points = i === 1 && t === 4 ? 1 - v : v
  return [{ mock_exam_id: D227.grid, student_id: mockStudent(i), task_number: t + 1, points, auto_points: auto }]
}))
mock_exam_task_scores.push(...d227Scores)
export const d227Totals = d227Points.flatMap((pts, i) => {
  const rows = d227Scores.filter(r => r.student_id === mockStudent(i))
  if (!rows.length) return []
  const p1 = rows.filter(r => r.task_number <= 12).reduce((a, r) => a + r.points, 0)
  const p2 = rows.filter(r => r.task_number > 12).reduce((a, r) => a + r.points, 0)
  const score = D227_TPL.score_scale[p1 + p2]
  // Трём первым итог уже отправлен, четвёртой — отправлялся другой.
  const sent = i < 3 ? { notified_at: '2026-09-21T15:05:00Z', notified_score: score, notified_part1_score: p1, notified_part2_score: p2 }
    : i === 3 ? { notified_at: '2026-09-20T15:05:00Z', notified_score: score - 4, notified_part1_score: p1, notified_part2_score: p2 - 1 }
    : { notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null }
  return [{ id: U('c', 1690 + i), mock_exam_id: D227.grid, student_id: mockStudent(i), score, primary_score: p1 + p2, part1_score: p1, part2_score: p2, notes: null, created_at: ago(24 * 5), ...sent }]
})
const d227End = Date.parse(d227Start) + 240 * MIN
export const d227Sheets = d227Points.flatMap((pts, i) => (pts ? [{ mock_exam_id: D227.grid, student_id: mockStudent(i), submitted_at: new Date(d227End - (20 + i * 9) * MIN).toISOString() }] : []))
export const d227Photos = d227Points.flatMap((pts, i) => (pts ? Array.from({ length: 1 + (i % 3) }, (_, k) => ({
  id: U('c', 61000 + i * 10 + k), mock_exam_id: D227.grid, student_id: mockStudent(i),
  storage_path: `${D227.grid}/photos/${mockStudent(i)}/${k}_stranica-${k + 1}.webp`, file_name: `стр ${k + 1}.webp`, position: k,
})) : []))

// ── materials ────────────────────────────────────────────────────────────────
const LONG_TEXT = `Равноускоренное движение — движение, при котором ускорение постоянно по модулю и направлению.

Уравнения: v = v₀ + a·t;  x = x₀ + v₀·t + a·t²/2;  v² − v₀² = 2·a·(x − x₀).

Длинная формула без переносов: F₁·cos(α₁)+F₂·cos(α₂)+F₃·cos(α₃)−μ·(m₁+m₂+m₃)·g·cos(β)=(m₁+m₂+m₃)·a

Таблица значений: t, с | 0 | 1 | 2 | 3 | 4 | 5 | 6
x, м | 0 | 2 | 8 | 18 | 32 | 50 | 72

Ссылка на демоверсию: https://example.invalid/very/long/link/that/does/not/break/anywhere/at/all/0123456789012345678901234567890123456789`
export const topic_material_items = [
  { id: IDS.material(1), topic_id: IDS.topic(1), kind: 'text', title: 'Конспект: уравнения равноускоренного движения и разбор графиков', content: LONG_TEXT, position: 1, is_visible: true, section: 'theory', url: null, storage_path: null, file_name: null, mime_type: null, size_bytes: null, lesson_id: null, source_topic_material_id: null, created_by: IDS.owner, created_at: ago(200), updated_at: ago(200) },
  { id: IDS.material(2), topic_id: IDS.topic(1), kind: 'video', title: 'Видеоразбор: как читать графики v(t) и x(t), типовые ошибки на ЕГЭ', content: null, position: 2, is_visible: true, section: 'theory', url: 'https://iframe.mediadelivery.net/embed/726880/00000000-0000-4000-8000-00000000abcd', storage_path: null, file_name: null, mime_type: null, size_bytes: null, lesson_id: null, source_topic_material_id: null, created_by: IDS.owner, created_at: ago(200), updated_at: ago(200) },
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
    section, url: kind === 'video' ? 'https://iframe.mediadelivery.net/embed/726880/00000000-0000-4000-8000-00000000ef11' : null,
    storage_path: kind === 'file' ? `course-materials/topic-${n}/list-${i}.pdf` : null,
    file_name: kind === 'file' ? `list-${i}.pdf` : null, mime_type: kind === 'file' ? 'application/pdf' : null,
    size_bytes: kind === 'file' ? 120000 : null, lesson_id: null, source_topic_material_id: null,
    created_by: IDS.owner, created_at: ago(200), updated_at: ago(200),
  })),
  // §208 (board/059): авторское решение темы 3 — той самой, чью работу
  // проверяют в очереди. Без него панель «Решение задания» на экране проверки
  // не появляется вовсе, а вместе с ней не появляется и граница между
  // колонками — то есть главную правку §208 нечем показать на снимке.
  // Картинка, а не PDF: pdfjs на харнессе не рисует (§206.1), и панель была бы
  // пустой. Скрытый материал — так решение и лежит на проде до разбора.
  {
    id: IDS.material(40), topic_id: IDS.topic(3), kind: 'file', title: 'Авторское решение',
    content: null, position: 30, is_visible: false, section: 'solution', url: null,
    storage_path: 'course-materials/topic-3/figure.png', file_name: 'figure.png',
    mime_type: 'image/png', size_bytes: 82000, lesson_id: null, source_topic_material_id: null,
    created_by: IDS.owner, created_at: ago(200), updated_at: ago(200),
  },
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
// §211 (board/062): вторая страница той работы, которую открывает «Проверить»
// в очереди, снята БОКОМ — именно так половина работ и приезжает. Поворот
// снимается ровно на ней, а первая страница остаётся прямой: на одном экране
// видно и выправленную страницу, и нетронутую соседку. Остальные работы не
// трогаем — на них стоят снимки прежних разделов.
const sidewaysPage = (attemptId, n) => attemptId === IDS.attempt(15) && n === 2
export const topic_homework_attempt_files = topic_homework_attempts.flatMap((a, i) => [1, 2].map(n => ({
  id: IDS.file(i * 2 + n), attempt_id: a.id,
  storage_path: `homeworks/${a.student_id}/${a.id}/photo-${n}${sidewaysPage(a.id, n) ? '-sideways' : ''}.jpg`,
  file_name: `IMG_2026091${n}_очень_длинное_имя_файла_с_телефона_${n}.jpg`,
  mime_type: 'image/jpeg', size_bytes: 2400000,
  width: sidewaysPage(a.id, n) ? 1600 : 1200, height: sidewaysPage(a.id, n) ? 1200 : 1600,
  page_number: n, position: n, rotation: 0, sha256: null, metadata: {}, created_at: a.created_at,
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
//
// §207 (board/058): работа в очереди — из 21 задания, ровно та, на которую
// жаловался владелец: «верно 13 · неверно 2 · частично 1 · не сверено 5».
// Меньший набор не показывал ни одной из трёх проблем экрана — ни каши из
// одинаковых «не сверено», ни того, что верные строки оттесняют ошибки вниз.
const CORRECT_21 = [
  ['1', '12 м/с'], ['2', '0,4'], ['3', '25 м'], ['4', '8 Н'], ['5', '1,5 кг'],
  ['6', '144 р.'], ['7', '2 30/49'], ['8', '0,25'], ['9', '2,5 c'], ['10', '36 км/ч'],
  ['11', '9,8 м/с²'], ['12', '600 Дж'], ['13', '4 Ом'],
]
export const topic_homework_review_tasks = [
  ...CORRECT_21.map(([no, answer], i) => reviewTaskRow(i + 1, IDS.attempt(15), {
    no, verdict: 'correct', student_answer: answer, expected_answer: answer,
  })),
  reviewTaskRow(14, IDS.attempt(15), { no: '14', verdict: 'wrong', student_answer: '−2 м/с²', expected_answer: '2 м/с²', note: 'Ошибка в решении: при торможении знак ускорения противоположен скорости — в выражении должен стоять минус, иначе модуль сходится, а направление нет.' }),
  reviewTaskRow(15, IDS.attempt(15), { no: '15', verdict: 'wrong', student_answer: 'в 144 рубля', expected_answer: 'в 160 рублей', note: 'Правильный ход, но потерян процент во втором шаге' }),
  reviewTaskRow(16, IDS.attempt(15), { no: '16', verdict: 'partial', student_answer: '30 Н', expected_answer: '30 Н', note: 'Ответ верный, хода решения нет' }),
  // §214 (board/066). Пятёрка «не разобранных» разошлась на два состояния, и
  // это ровно тот случай, из-за которого карточка и заведена: 17–19 ИИ не
  // смогла сверить (страница снята не полностью — надо смотреть глазами),
  // а 20 и 21 ученик не делал вовсе. До §214 и те и другие были «не сверено».
  ...['17', '18', '19'].map((no, i) => reviewTaskRow(17 + i, IDS.attempt(15), {
    no, verdict: 'unchecked', note: 'нет на фото',
  })),
  ...['20', '21'].map((no, i) => reviewTaskRow(20 + i, IDS.attempt(15), {
    no, verdict: 'unsolved', note: 'задание не начато',
  })),
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
      // §209. Рамка с номером задания — замечание к заданию 3. Пометка
      // источника показывает, что находку ИИ уже «взяли»: второй раз
      // предлагать её нечего.
      { id: 'a1', type: 'region', category: 'error', task: '3', source: { kind: 'ai', finding: U('c', 1301), job: U('c', 1300) }, text: 'В задаче 3 знак ускорения: при торможении a направлено против скорости, значит a < 0.', rect: { x: 0.12, y: 0.45, w: 0.6, h: 0.08 } },
      { id: 'a2', type: 'region', category: 'praise', text: 'Отлично!', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 } },
      { id: 'a3', type: 'region', category: 'logic', text: 'Задание 4: ответ верный, но выкладок нет — условие просит развёрнутое решение.', rect: { x: 0.1, y: 0.62, w: 0.62, h: 0.1 } },
      { id: 'a4', type: 'region', category: 'praise', text: 'Верное решение', rect: { x: 0.14, y: 0.3, w: 0.32, h: 0.05 } },
      // §209. Замечание на задании, у которого стоит «верно», — тот самый
      // спор вердикта и замечания, ради которого таблицу и открывают.
      { id: 'a5', type: 'region', category: 'error', task: '7', text: 'В отборе корней потерян второй случай — ответ угадан.', rect: { x: 0.16, y: 0.1, w: 0.44, h: 0.06 } },
      // §207 (board/058): два накопленных дубля первой рамки — след прежних
      // переносов, когда «Перенести рамки» дописывал находки заново при каждом
      // нажатии. Пометки источника у них нет (её тогда не было), поэтому на
      // экране они и лежат ради кнопки «Убрать повторы»: молча их не чистит
      // никто — отличить такой дубль от ручной рамки нечем.
      { id: 'a1-dup1', type: 'region', category: 'calc', text: 'В задаче 3 знак ускорения: при торможении a направлено против скорости, значит a < 0.', rect: { x: 0.121, y: 0.452, w: 0.6, h: 0.08 } },
      { id: 'a1-dup2', type: 'region', category: 'calc', text: 'В задаче 3 знак ускорения: при торможении a направлено против скорости, значит a < 0.', rect: { x: 0.12, y: 0.45, w: 0.601, h: 0.08 } },
    ],
  },
},
// §211 (board/062). Пометки на ВТОРОЙ странице той же работы очереди — той
// самой, что снята боком. Без них поворот не на чем проверить глазами: вся
// цена вопроса в том, едут ли рамки вместе со страницей или остаются лежать
// там, где были, уводя работу преподавателя.
{
  id: U('d', 205), attempt_id: IDS.attempt(15), submission_id: null,
  file_path: topic_homework_attempt_files.filter(f => f.attempt_id === IDS.attempt(15))[1].storage_path,
  page: 1, status: 'draft', author_id: IDS.owner, created_at: ago(1), updated_at: ago(1),
  data: {
    version: 2,
    objects: [
      // Координаты — доли ИСХОДНОЙ (лежащей набок) страницы: рамки
      // накрывают строки решения и блок «Дано». На повёрнутой странице они
      // обязаны оказаться на тех же строках — это и видно на паре снимков.
      { id: 'b1', type: 'region', category: 'error', task: '15', text: 'Потерян процент во втором шаге — пересчитай от новой цены.', rect: { x: 0.30, y: 0.45, w: 0.15, h: 0.45 } },
      { id: 'b2', type: 'region', category: 'good', text: 'Верно выписано «Дано»', rect: { x: 0.045, y: 0.42, w: 0.085, h: 0.28 } },
    ],
  },
},
// §206. Опубликованные пометки на СВОЕЙ работе ученика (попытка 1, две
// страницы) — без них у ученика нет ни кнопки «Пометки учителя», ни разбора,
// который скачивается в PDF. Две страницы здесь не для красоты: скачанный
// файл обязан сохранить порядок страниц, и на одной это не проверить.
...[1, 2].map(page => ({
  id: U('d', 210 + page), attempt_id: IDS.attempt(1), submission_id: null,
  file_path: topic_homework_attempt_files.filter(f => f.attempt_id === IDS.attempt(1))[page - 1].storage_path,
  page: 1, status: 'published', author_id: IDS.owner, created_at: ago(21), updated_at: ago(21),
  data: {
    version: 2,
    objects: page === 1
      ? [
          // §209. Замечание ученику привязано к заданию: в его разборе оно
          // стоит под строкой задания 3, а не отдельным списком.
          { id: `p${page}-1`, type: 'region', category: 'error', task: '3', text: 'Задача 3: знак ускорения при торможении отрицательный — пересчитай проекцию на ось движения.', rect: { x: 0.1, y: 0.18, w: 0.62, h: 0.09 } },
          { id: `p${page}-2`, type: 'region', category: 'praise', text: 'Аккуратное оформление «Дано»', rect: { x: 0.12, y: 0.42, w: 0.34, h: 0.06 } },
        ]
      : [
          { id: `p${page}-1`, type: 'region', category: 'inaccuracy', task: '7', text: 'Задача 7: ответ верный, но график v(t) не построен — условие просит развёрнутое решение с рисунком.', rect: { x: 0.11, y: 0.3, w: 0.66, h: 0.1 } },
          { id: `p${page}-2`, type: 'region', category: 'format', text: 'Нет единиц измерения', rect: { x: 0.14, y: 0.66, w: 0.4, h: 0.06 } },
        ],
  },
}))]

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
  // §202: задача с МЕЛКИМ сканом (150 px) — в каталоге такие есть, и в печати
  // они стояли рядом с чертежом на пол-страницы. Без неё разброс размеров на
  // снимке не виден: все остальные заглушки крупные (600–900 px).
  `<p>На рисунке приведён график зависимости координаты тела от времени при прямолинейном движении по оси Ox.</p><img src="figure-small.png" alt="мелкий график"><p>Чему равна проекция скорости тела на ось Ox? Ответ дайте в м/с.</p>`,
]
export const catalog_tasks = Array.from({ length: 14 }, (_, k) => ({
  id: IDS.task(k + 1), section_id: IDS.section(1 + (k % 2 === 0 ? 0 : 0)), subject: 'Физика', exam_type: 'ЕГЭ', external_id: 124600 + k, position: k + 1, is_published: true,
  statement_html: STATEMENTS[k % STATEMENTS.length], has_answer: true, has_solution: k % 3 === 0, answer_html: `<p>${(k + 1) * 2}</p>`, solution_html: k % 3 === 0 ? '<p>v_ср = Δx / Δt = (50 − 2) / 4 = 12 м/с.</p>' : null, solution_plan_html: null, grade_criteria_html: null,
  difficulty: ['base', 'advanced', 'high'][k % 3], exam_part: k < 10 ? 1 : 2, max_points: k < 10 ? 1 : 3, partial_type: k % 4 === 3 ? 'matching' : null, source_url: null, created_at: ago(9000), updated_at: ago(900),
}))
// §201: задачи части 2 — собственного ответа у них нет по природе (ответ живёт
// внутри решения), зато есть критерии оценивания и максимум баллов. Ровно на
// таких задачах печать раньше писала «Ответ не указан». Вторая задача — без
// критериев: у неё эта надпись обязана остаться, и на снимке видно, что случаи
// различаются, а не подгоняются под красивую картинку. Текст без картинок —
// размеры иллюстраций в печати чинит отдельная карточка (§202), мешать её
// снимки с этими не нужно.
export const part2_catalog_tasks = [
  {
    id: IDS.task(15), section_id: IDS.section(25), subject: 'Математика', exam_type: 'ЕГЭ', external_id: 130001, position: 1, is_published: true,
    statement_html: '<p>Найдите все значения параметра a, при каждом из которых уравнение имеет ровно два различных корня.</p>',
    has_answer: false, answer_html: null, has_solution: true,
    solution_html: '<p>Рассмотрим два случая…</p><p>Отсюда a ∈ (−1; 0) ∪ {2}.</p>',
    solution_plan_html: null,
    grade_criteria_html: '<p>Обоснованно получен верный ответ — <b>2 балла</b>.</p><p>С помощью верного рассуждения получен ответ, отличающийся от верного только конечным числом точек, — <b>1 балл</b>.</p><p>Решение не соответствует ни одному из критериев выше — <b>0 баллов</b>.</p>',
    difficulty: 'high', exam_part: 2, max_points: 2, partial_type: null, source_url: null, created_at: ago(9000), updated_at: ago(900),
  },
  {
    id: IDS.task(16), section_id: IDS.section(25), subject: 'Математика', exam_type: 'ЕГЭ', external_id: 130002, position: 2, is_published: true,
    statement_html: '<p>Решите неравенство и укажите все целые значения параметра, при которых решений нет.</p>',
    has_answer: false, answer_html: null, has_solution: true,
    solution_html: '<p>Разбор задачи есть, а критериев в каталоге нет.</p>',
    solution_plan_html: null, grade_criteria_html: null,
    difficulty: 'high', exam_part: 2, max_points: 3, partial_type: null, source_url: null, created_at: ago(9000), updated_at: ago(900),
  },
]
// §202 (board/054): задачи по математике. Нужны именно они: класс
// `print-figures-boost` VariantDocument вешает только на физику ЕГЭ, поэтому
// печатную подборку по БАЗОВОМУ правилу ширины иллюстраций видно лишь на
// другом предмете. Чередуются крупный чертёж (600 px) и мелкий скан (150 px) —
// разброс, на который жаловался владелец.
export const catalog_tasks_math = Array.from({ length: 4 }, (_, k) => ({
  id: IDS.task(40 + k), section_id: IDS.section(21), subject: 'Математика', exam_type: 'ЕГЭ', external_id: 331200 + k, position: k + 1, is_published: true,
  statement_html: k % 2 === 0
    ? `<p>На рисунке изображён график функции y = f(x) и касательная к нему в точке x₀.</p><img src="figure.png" alt="график функции"><p>Найдите значение производной функции f(x) в точке x₀.</p>`
    : `<p>На клетчатой бумаге с клеткой размером 1×1 изображён треугольник ABC.</p><img src="figure-small.png" alt="мелкий чертёж"><p>Найдите длину его средней линии, параллельной стороне AC.</p>`,
  has_answer: true, has_solution: false, answer_html: `<p>${k + 2}</p>`, solution_html: null, solution_plan_html: null, grade_criteria_html: null,
  difficulty: 'base', exam_part: 1, max_points: 1, partial_type: null, source_url: null, created_at: ago(9000), updated_at: ago(900),
}))
/*
 * §205 (board/056): задачи по математике, у которых ВСЁ содержимое — формулы
 * картинками SVG (`class="math"` в тексте, `class="math-display"` отдельным
 * блоком). Именно такие подборки печатает владелец: растровых иллюстраций там
 * нет вовсе, поэтому правило §202 на них не действует.
 *
 * Натуральные размеры заглушек сняты с его экспорта от 18.09 (см. `assets.mjs`):
 *   formula-inline.svg   186×25   простая строчная
 *   formula-frac.svg     146×49   строчная с дробью и корнем
 *   formula-eq.svg       120×55   короткое равенство блоком
 *   formula-sys-short.svg 516×645  короткая система в «гигантском» разрешении
 *   formula-sys-long.svg  640×1835 длинная цепочка систем — одна картинка
 *
 * Порядок задач фиксирован: 1 — длинный гигант, 2 — короткий гигант,
 * 3 — обычная формула, 4 — только строчные. На одном листе видны все четыре.
 */
const FORMULA_TASKS = [
  {
    name: 'длинная цепочка систем',
    statement: `<p>Найдите корень уравнения <img class="math" src="formula-inline.svg" alt="2^(-4-x) = 16">. Если уравнение имеет больше одного корня, в ответе запишите больший из корней.</p>`,
    solution: `<p>Возведём обе части уравнения в квадрат. Тогда уравнение равносильно системе:</p><img class="math-display" src="formula-sys-long.svg" alt="цепочка равносильных систем"><p>Таким образом, больший корень равен <img class="math" src="formula-frac.svg" alt="x = 27/5 = 5,4">.</p>`,
  },
  {
    name: 'короткая система того же разрешения',
    statement: `<p>Найдите корень уравнения <img class="math" src="formula-frac.svg" alt="√15x = 1 2/3">. Если уравнение имеет больше одного корня, в ответе запишите меньший из корней.</p>`,
    solution: `<p>Перейдём к равенству подлогарифмических выражений, с учётом ограничений логарифма:</p><img class="math-display" src="formula-sys-short.svg" alt="система и три равенства"><p>Значит, меньший из корней равен <img class="math" src="formula-inline.svg" alt="x = -5">.</p>`,
  },
  {
    name: 'обычное равенство блоком',
    statement: `<p>Найдите корень уравнения <img class="math" src="formula-inline.svg" alt="5^(2-x) = 125">.</p>`,
    solution: `<p>Перейдём к равенству показателей степеней:</p><img class="math-display" src="formula-eq.svg" alt="2 - x = 3, x = -1"><p>Проверка подстановкой даёт верное равенство.</p>`,
  },
  {
    name: 'только строчные формулы',
    statement: `<p>Уравнение в общем виде выглядит как <img class="math" src="formula-inline.svg" alt="√A = B"> и равносильно системе. Условие <img class="math" src="formula-frac.svg" alt="A ⩾ 0"> излишне, так как <img class="math" src="formula-inline.svg" alt="A = B²"> как любое выражение в квадрате.</p>`,
    solution: `<p>Извлечём кубический корень из обеих частей уравнения: <img class="math" src="formula-frac.svg" alt="x + 4 = -5">.</p>`,
  },
]
export const catalog_tasks_formula = FORMULA_TASKS.map((f, k) => ({
  id: IDS.task(50 + k), section_id: IDS.section(21), subject: 'Математика', exam_type: 'ЕГЭ', external_id: 441700 + k, position: k + 1, is_published: true,
  statement_html: f.statement,
  has_answer: true, has_solution: true, answer_html: `<p>${k - 5}</p>`, solution_html: f.solution, solution_plan_html: null, grade_criteria_html: null,
  difficulty: 'base', exam_part: 1, max_points: 1, partial_type: null, source_url: null, created_at: ago(9000), updated_at: ago(900),
}))
// Активы формул: resolveTaskHtml подставит URL только если актив найден по имени
// файла. Класса иллюстрации формулам он НЕ вешает (у них есть `math`) — это и
// проверяем: размер на бумаге им задаёт только CSS печати.
export const catalog_task_assets_formula = catalog_tasks_formula.flatMap((t, k) =>
  ['formula-inline.svg', 'formula-frac.svg', 'formula-eq.svg', 'formula-sys-short.svg', 'formula-sys-long.svg'].map((name, j) => ({
    id: U('9', 940 + k * 5 + j), task_id: t.id, kind: 'condition', storage_path: `math/ege/1/${name}`, alt: name, position: j + 1, size_bytes: 4000, source_url: null, tex_session_id: null,
  })),
)
export const catalog_task_assets = [...catalog_tasks, ...catalog_tasks_math].flatMap((t, k) => [
  { id: U('9', 500 + k * 3), task_id: t.id, kind: 'condition', storage_path: 'physics/ege/1/table.png', alt: 'таблица', position: 1, size_bytes: 12000, source_url: null, tex_session_id: null },
  { id: U('9', 501 + k * 3), task_id: t.id, kind: 'condition', storage_path: 'physics/ege/1/formula-wide.png', alt: 'формула', position: 2, size_bytes: 12000, source_url: null, tex_session_id: null },
  { id: U('9', 502 + k * 3), task_id: t.id, kind: 'condition', storage_path: 'physics/ege/1/figure.png', alt: 'график', position: 3, size_bytes: 12000, source_url: null, tex_session_id: null },
  // §202: мелкий скан — отдельной строкой, иначе resolveTaskHtml не найдёт актив
  // для src="figure-small.png" и оставит картинку без класса иллюстрации.
  { id: U('9', 900 + k), task_id: t.id, kind: 'condition', storage_path: 'physics/ege/1/figure-small.png', alt: 'мелкий график', position: 4, size_bytes: 3000, source_url: null, tex_session_id: null },
])
export const catalog_topics = [
  { id: IDS.ctopic(1), title: 'Кинематика', parent_id: null, position: 1, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 1, is_published: true, slug: 'kinematika', created_at: ago(9000), updated_at: ago(900) },
  { id: IDS.ctopic(2), title: 'Равноускоренное движение: графики зависимости координаты, скорости и ускорения от времени', parent_id: IDS.ctopic(1), position: 1, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 2, is_published: true, slug: 'ravnouskorennoe', created_at: ago(9000), updated_at: ago(900) },
  { id: IDS.ctopic(3), title: 'Движение по окружности', parent_id: IDS.ctopic(1), position: 2, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 3, is_published: true, slug: 'okruzhnost', created_at: ago(9000), updated_at: ago(900) },
  { id: IDS.ctopic(4), title: 'Динамика', parent_id: null, position: 2, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 4, is_published: true, slug: 'dinamika', created_at: ago(9000), updated_at: ago(900) },
  { id: IDS.ctopic(5), title: 'Законы Ньютона', parent_id: IDS.ctopic(4), position: 1, subject: 'Физика', exam_type: 'ЕГЭ', external_id: 5, is_published: true, slug: 'newton', created_at: ago(9000), updated_at: ago(900) },
]
export const catalog_task_topics = catalog_tasks.map((t, k) => ({ task_id: t.id, topic_id: IDS.ctopic(k % 2 ? 2 : 3), is_primary: true, source: 'import', catalog_tasks: t, catalog_topics: catalog_topics[k % 2 ? 1 : 2] }))
// Задачи части 2 добавляются в общий список уже после картинок и тем: они из
// другого предмета (математика, раздел «Параметры») и в физических темах
// каталога появляться не должны, иначе испортят чужие сцены.
catalog_tasks.push(...part2_catalog_tasks)
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
  { id: IDS.collection2, title: 'Производная и планиметрия: 8 заданий с чертежами', description: null, subject: 'Математика', work_type: 'homework', is_archived: false, pdf_config: {}, created_by: IDS.owner, created_at: ago(60), updated_at: realAgo(20) },
  { id: IDS.collection3, title: 'Контрольная по динамике', description: null, subject: 'Физика', work_type: 'control', is_archived: false, pdf_config: {}, created_by: IDS.owner, created_at: ago(24 * 20), updated_at: ago(24 * 14) },
  { id: IDS.collection4, title: 'Убрана в архив: пробник сентября', description: null, subject: 'Физика', work_type: 'ege_variant', is_archived: true, pdf_config: {}, created_by: IDS.owner, created_at: ago(24 * 40), updated_at: ago(24 * 30) },
  { id: IDS.collection5, title: 'Чужая подборка коллеги', description: null, subject: 'Математика', work_type: 'worksheet', is_archived: false, pdf_config: {}, created_by: IDS.profile(1), created_at: ago(24), updated_at: ago(1) },
  // §201: подборка для снимка печати — задача части 2 с критериями, задача
  // части 2 без критериев и обычная задача части 1 в одном документе.
  { id: IDS.collection6, title: 'Часть 2: критерии и баллы', description: null, subject: 'Математика', work_type: 'custom', is_archived: false, pdf_config: {}, created_by: IDS.owner, created_at: ago(12), updated_at: ago(2) },
  // §205: подборка по математике целиком из формул — как у владельца.
  { id: IDS.collection7, title: 'Показательные и иррациональные уравнения: 4 задания', description: null, subject: 'Математика', work_type: 'homework', is_archived: false, pdf_config: {}, created_by: IDS.owner, created_at: ago(11), updated_at: ago(1) },
]
const collectionItems = (collectionId, n, from) => Array.from({ length: n }, (_, k) => ({ id: U('c', from + k), collection_id: collectionId, catalog_task_id: IDS.task(1 + (k % 14)), position: k + 1, custom_number: null, created_at: ago(30), catalog_tasks: catalog_tasks[k % 14] }))
export const task_collection_items = [
  ...collectionItems(IDS.collection, 30, 700),
  // §202: математическая подборка собрана из математических задач — печать
  // такой подборки идёт по базовому правилу ширины иллюстраций.
  ...Array.from({ length: 8 }, (_, k) => ({ id: U('c', 730 + k), collection_id: IDS.collection2, catalog_task_id: catalog_tasks_math[k % 4].id, position: k + 1, custom_number: null, created_at: ago(30), catalog_tasks: catalog_tasks_math[k % 4] })),
  ...collectionItems(IDS.collection3, 4, 745),
  ...collectionItems(IDS.collection4, 26, 750),
  ...collectionItems(IDS.collection5, 8, 780),
  // §201: порядок задач в подборке фиксированный — так снимок печати всегда
  // показывает все три случая подряд.
  ...[part2_catalog_tasks[0], part2_catalog_tasks[1], catalog_tasks[0]].map((t, k) => ({
    id: U('c', 790 + k), collection_id: IDS.collection6, catalog_task_id: t.id,
    position: k + 1, custom_number: null, created_at: ago(12), catalog_tasks: t,
  })),
  // §205: четыре задачи-формулы подряд — на печатном листе видны все четыре случая.
  ...catalog_tasks_formula.map((t, k) => ({
    id: U('c', 795 + k), collection_id: IDS.collection7, catalog_task_id: t.id,
    position: k + 1, custom_number: null, created_at: ago(11), catalog_tasks: t,
  })),
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

// ── просмотр видео (§204, board/055) ────────────────────────────────────────
// Дни считаются от РЕАЛЬНОГО «сегодня» по Москве, а не от NOW фикстур: строка
// в карточке ученика показывает «за неделю», и с прибитой датой это число на
// снимке было бы нулём в любой прогон позже недели после правки.
//
// Две стороны одной таблицы: у ученика (IDS.student) видео темы 1 досмотрено
// до 840 из 900 — 93 %, отметка «Просмотрено» обязана появиться; у видео темы
// 3 строки нет вовсе — отметки быть не должно. У ученика карточки
// (IDS.profile(0)) три дня, два из них внутри недели, самый ранний — 25 дней
// назад: по нему рисуется подпись «записи с …».
const moscowDay = (deltaDays) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}
export const video_watch_daily = [
  { student_id: IDS.student, item_id: IDS.material(2), day: moscowDay(-1), seconds: 520, max_position: 840, duration_seconds: 900, updated_at: ago(24) },
  { student_id: IDS.student, item_id: IDS.material(2), day: moscowDay(0), seconds: 180, max_position: 840, duration_seconds: 900, updated_at: ago(1) },
  { student_id: IDS.profile(0), item_id: IDS.material(2), day: moscowDay(-25), seconds: 1500, max_position: 620, duration_seconds: 900, updated_at: ago(24 * 25) },
  { student_id: IDS.profile(0), item_id: IDS.material(2), day: moscowDay(-3), seconds: 900, max_position: 880, duration_seconds: 900, updated_at: ago(24 * 3) },
  { student_id: IDS.profile(0), item_id: IDS.material(25), day: moscowDay(0), seconds: 420, max_position: 300, duration_seconds: 1200, updated_at: ago(2) },
]

// §216. Цели по баллу — по строке на ПРЕДМЕТ. У ученика карточки
// (`o07-student-profile`) физика задана, а математика нет: на снимке должно
// быть видно и заполненное поле, и пустое («цель не задана» — прочерк, а не
// ноль).
export const student_subject_targets = [
  { id: U('f', 216), student_id: IDS.otherStudent(0), subject: 'physics', exam_type: 'ege', target_score: 82, updated_by: IDS.owner, created_at: ago(24 * 10), updated_at: ago(24 * 2) },
  { id: U('f', 217), student_id: IDS.studentRow, subject: 'physics', exam_type: 'ege', target_score: 85, updated_by: IDS.owner, created_at: ago(24 * 10), updated_at: ago(24 * 2) },
]

// §217. Отчёт об успеваемости. Считает его база одной функцией
// (`student_progress_report`), поэтому в харнессе это ГОТОВЫЙ ответ, а не
// набор таблиц: собирать его здесь заново значило бы завести вторую
// реализацию расчёта, которая разойдётся с настоящей и покажет на снимке то,
// чего на экране не будет.
//
// Набор подобран так, чтобы на снимке были видны ВСЕ правила сразу:
//   * физика — группа из девяти человек, среднее по группе печатается;
//   * математика — группа из четырёх, среднее ПРОЧЕРК с пояснением;
//   * цель по математике не задана — тоже прочерк, а не ноль;
//   * тема «Кинематика» без номера ЕГЭ, тема «Оптика» сразу на два номера;
//   * средний балл везде стоит рядом с числом проверенных работ.
export const student_report_next_steps = [
  {
    id: U('f', 218), student_id: IDS.otherStudent(0),
    period_from: '2026-09-01', period_to: '2026-09-25',
    steps: [
      'Физика, термодинамика (№24): разобрать восемь задач — это самая слабая тема, 41 % верных.',
      'Математика, тригонометрические уравнения (№13): дело не в формулах, а в отборе корней.',
      'Две работы по физике сданы позже срока. Договориться о постоянном дне сдачи.',
    ],
    updated_by: IDS.owner, created_at: ago(24 * 2), updated_at: ago(24 * 2),
  },
]

export const progressReport = {
  student: { id: IDS.otherStudent(0), full_name: NAMES[1], grade: 11, groups: ['11А физика', 'Матгруппа'] },
  period: { from: '2026-09-01', to: '2026-09-25' },
  generated_at: '2026-09-25T09:00:00+00:00',
  min_group_for_avg: 6,
  min_tasks_for_topic: 3,
  subjects: [
    {
      subject: 'physics', exam_type: 'ege', course_titles: 'Физика ЕГЭ',
      target: 75, avg_percent: 62, graded_works: 7,
      group_size: 9, group_avg_percent: 58,
      works: { submitted: 9, accepted: 7, revision: 1, pending: 1, with_due: 9, on_time: 7, late: 2 },
      weeks: [
        { week_start: '2026-08-31', avg_percent: 55, works: 2 },
        { week_start: '2026-09-07', avg_percent: 60, works: 2 },
        { week_start: '2026-09-14', avg_percent: 66, works: 2 },
        { week_start: '2026-09-21', avg_percent: 62, works: 1 },
      ],
      last_mock: { date: '2026-06-12', title: 'Пробник №3', score: 61, part1: 38, part2: 23, group_avg: 54, group_size: 9, delta: 6 },
    },
    {
      subject: 'math', exam_type: 'ege', course_titles: 'Математика профиль',
      target: null, avg_percent: 74, graded_works: 4,
      group_size: 4, group_avg_percent: null,
      works: { submitted: 5, accepted: 4, revision: 0, pending: 1, with_due: 5, on_time: 5, late: 0 },
      weeks: [
        { week_start: '2026-09-07', avg_percent: 70, works: 2 },
        { week_start: '2026-09-14', avg_percent: 74, works: 2 },
      ],
      last_mock: { date: '2026-06-10', title: 'Пробник профиль', score: 71, part1: 52, part2: 19, group_avg: null, group_size: 4, delta: 13 },
    },
  ],
  mocks: [
    { date: '2026-04-25', title: 'Пробник №1', subject: 'physics', exam_type: 'ege', score: 48, part1: 32, part2: 16, group_avg: 45, group_size: 9, delta: null },
    { date: '2026-05-23', title: 'Пробник №2', subject: 'physics', exam_type: 'ege', score: 55, part1: 35, part2: 20, group_avg: 51, group_size: 9, delta: 7 },
    { date: '2026-06-10', title: 'Пробник профиль', subject: 'math', exam_type: 'ege', score: 71, part1: 52, part2: 19, group_avg: null, group_size: 4, delta: 13 },
    { date: '2026-06-12', title: 'Пробник №3', subject: 'physics', exam_type: 'ege', score: 61, part1: 38, part2: 23, group_avg: 54, group_size: 9, delta: 6 },
  ],
  topics: {
    weak: [
      { topic_id: IDS.topic(1), title: 'Термодинамика', subject: 'physics', ege_numbers: [24], tasks_counted: 9, correct_percent: 41 },
      { topic_id: IDS.topic(2), title: 'Тригонометрические уравнения, отбор корней', subject: 'math', ege_numbers: [13], tasks_counted: 18, correct_percent: 54 },
      { topic_id: IDS.topic(3), title: 'Кинематика. Баллистика', subject: 'physics', ege_numbers: [], tasks_counted: 12, correct_percent: 52 },
    ],
    strong: [
      { topic_id: IDS.topic(4), title: 'Оптика: геометрическая и волновая', subject: 'physics', ege_numbers: [6, 7], tasks_counted: 16, correct_percent: 95 },
      { topic_id: IDS.topic(5), title: 'Верные и неверные утверждения', subject: 'physics', ege_numbers: [18], tasks_counted: 13, correct_percent: 92 },
    ],
    without_number: 1,
  },
  ege_numbers: [
    { number: 6, tasks_counted: 16, correct_percent: 95 },
    { number: 7, tasks_counted: 16, correct_percent: 95 },
    { number: 13, tasks_counted: 18, correct_percent: 54 },
    { number: 18, tasks_counted: 13, correct_percent: 92 },
    { number: 24, tasks_counted: 9, correct_percent: 41 },
  ],
  activity: {
    video_seconds: 12000, video_seconds_last_week: 2880,
    materials: 34, catalog_tasks: 12,
    with_due: 14, on_time: 12, late: 2,
  },
  next_steps: student_report_next_steps[0].steps,
  // Внутренняя заметка. На ЛИСТЕ её быть не должно — ради этого она здесь и
  // лежит: на снимке печатного вида её отсутствие видно глазом.
  teacher_note: {
    body: 'Считает быстро, но бросает задачу на середине, если не выходит с первого подхода. На занятии давать по одной длинной задаче и не подсказывать первые пять минут.',
    created_at: ago(24 * 3),
  },
}

export function baseFixtures(persona) {
  const myTopicTasks = topicTaskDefs.map(r => ({ ...r }))
  const fx = {
    tables: {
      profiles, students, teachers, curators: [], courses, modules, topics, groups, group_students,
      topic_material_items, topic_homework, topic_homework_attempts, topic_homework_reviews, topic_homework_attempt_files,
      topic_tests, topic_test_assignments, topic_test_attempts, topic_test_items: [], test_variants: [...test_variants, ...topicVariants], test_variant_items: [
        ...Array.from({ length: 26 }, (_, k) => ({ id: U('c', 1600 + k), variant_id: IDS.variant(1), task_id: IDS.task(1 + (k % 14)), position: k + 1, points: k < 20 ? 1 : 3, grading_type: k < 20 ? 'auto' : 'manual', section_id: IDS.section(1), topic_id: null, created_at: ago(100) })),
        // §201: две задачи части 2 в конце варианта — на них видно, что
        // кнопки «Ответ» нет не по ошибке: рядом стоит подпись про критерии.
        ...part2_catalog_tasks.map((t, k) => ({ id: U('c', 1630 + k), variant_id: IDS.variant(1), task_id: t.id, position: 27 + k, points: t.max_points, grading_type: 'manual', section_id: IDS.section(25), topic_id: null, created_at: ago(100) })),
      ],
      catalog_sections, catalog_tasks: [...catalog_tasks, ...catalog_tasks_math, ...catalog_tasks_formula], catalog_task_assets: [...catalog_task_assets, ...catalog_task_assets_formula], catalog_topics, catalog_task_topics, catalog_task_progress: [{ user_id: persona === 'student' ? IDS.student : IDS.owner, task_id: IDS.task(2), is_completed: true, completed_at: ago(10), updated_at: ago(10), catalog_tasks: catalog_tasks[1] }],
      task_collections, task_collection_items, notifications, notification_queue, telegram_connections, course_curators: [], demo_users: [],
      student_subject_targets, student_report_next_steps,
      lesson_templates: [], topic_section_marks: [{ topic_id: IDS.topic(3), student_id: IDS.studentRow, group_key: 'theory', marked_at: ago(100) }],
      topic_homework_ai_jobs: aiJobs,
      topic_homework_ai_findings: aiFindings,
      topic_homework_review_tasks,
      annotation_sets: annotationSets, mock_exams, mock_exam_results: [...mock_exam_results, ...mockTotals, ...lessonTotals, ...d227Totals], mock_exam_templates, mock_exam_task_scores, mock_exam_answer_keys, mock_exam_sheets: [...mock_exam_sheets, ...liveSheets, ...d227Sheets], mock_exam_photos: [...mock_exam_photos, ...livePhotos, ...d227Photos], lesson_materials: [], school_presence: [],
      video_watch_daily,
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
      // §217. Отчёт приходит ОДНИМ вызовом — ровно так же, как на проде.
      // Отчёт отдаётся только по ученику карточки: чужой ученик получает
      // пустоту, а не чужие числа.
      save_mock_exam_grid: saveMockExamGrid,
      notify_mock_exam_results: notifyMockExamResults,
      // §221: пробник-урок — ученические функции и проверка по ключу.
      ...lessonRpcs,
      // §224: монитор идущего пробника и пинг ученика.
      ...liveRpcs,
      student_progress_report: (body) =>
        body.p_student_id === IDS.otherStudent(0) ? progressReport : null,
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
      // §204: единственный вход на запись просмотра. В логе прогона его быть
      // НЕ должно: внешний плеер харнесс обрывает, событий нет — значит, и
      // секунд нет. Заглушка стоит именно для того, чтобы это было видно.
      video_watch_add: null,
    },
    functions: {
      // §213 (board/064). Заглушка «Переписать по таблице». Это НЕ ответ
      // модели: харнесс её не вызывает и вызывать не должен — сцене нужно
      // показать, как результат приходит предложением над полем. Текст
      // намеренно согласован с таблицей этой работы (13 верных, задания 14 и
      // 15 неверные, 16 частично, пять не сверено) и намеренно НЕ называет ни
      // одного ответа ученика — ровно как запрещает промпт.
      'rewrite-homework-comment': {
        text: 'Большая часть работы сделана верно: тринадцать заданий сошлись с эталоном. '
          + 'В задании 14 ответ не совпал, а в задании 15 потерян процент во втором шаге — '
          + 'пересчитайте от новой цены. Задание 16 засчитано частично: ответ верный, но хода '
          + 'решения нет, а условие просит развёрнутую запись. Пять заданий пока не сверены. '
          + 'Начните с задания 15: разберите его заново по шагам и запишите решение полностью.',
        model: 'qwen/qwen3-30b-a3b-instruct',
        usage: { prompt_tokens: 1089, completion_tokens: 142, total_tokens: 1231 },
      },
    },
  }
  fx.rpc.topic_homework_start_attempt = (body) => {
    const id = U('3', 990 + fx.tables.topic_homework_attempts.length)
    fx.tables.topic_homework_attempts.push({ id, homework_id: body.p_homework_id, student_id: IDS.studentRow, attempt_number: 1, status: 'draft', submitted_at: null, created_at: NOW, updated_at: NOW, homework: hwById(body.p_homework_id), topic_homework: hwById(body.p_homework_id), topic_homework_reviews: [] })
    return id
  }
  fx.onWrite = (table, method, rows) => { if (method === 'POST' && Array.isArray(fx.tables[table])) fx.tables[table].push(...rows) }
  return fx
}
