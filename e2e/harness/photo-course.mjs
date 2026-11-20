import fs from 'node:fs/promises'
import { createServer } from 'vite'
import { registerHooks } from 'node:module'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSession, makeHandler, SB } from './lib.mjs'
import { IDS as harnessIds, personas as harnessPersonas, baseFixtures } from './fixtures.mjs'
import { COURSE_TITLE, TOPIC_TITLE, tasks } from './photo-course-lesson.mjs'

// Открывается только на loopback. Состояние тестового курса живёт до остановки стенда.
const port = Number(process.env.ALMIRON_PHOTO_COURSE_PORT ?? 5243)
const origin = 'http://127.0.0.1:' + port
const fixId = value => value.replace(/\b([\da-f]{7}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\b/gi, '0$1')
const fixJson = value => JSON.parse(fixId(JSON.stringify(value)))
const IDS = Object.fromEntries(Object.entries(harnessIds).map(([name, value]) => [
  name, typeof value === 'function' ? (...args) => fixId(value(...args)) : fixId(value),
]))
const personas = fixJson(harnessPersonas)
const topicId = IDS.topic(1)
const homeworkId = IDS.hw(1)
const bucket = 'topic-homework-attempts'
const manifest = process.env.ALMIRON_EGE14_MANIFEST
const geometryLessons = manifest ? JSON.parse(await fs.readFile(manifest, 'utf8')) : []
const lessons = [
  {
    topicId, homeworkId, title: TOPIC_TITLE, order: 1, moduleId: IDS.module,
    homeworkTitle: 'Тригонометрические уравнения',
    numbers: tasks.map(task => task.number),
  },
  ...geometryLessons.map(({ index, title, count, materials }) => ({
    topicId: IDS.topic(100 + index), homeworkId: IDS.hw(100 + index), title, order: index,
    moduleId: IDS.module2, homeworkTitle: 'ДЗ · ' + title,
    numbers: Array.from({ length: count }, (_, i) => String(i + 1)),
    materials,
  })),
]
const homeworkIds = new Set(lessons.map(lesson => lesson.homeworkId))
const storageMaterials = new Map()
const migration = await fs.readFile(new URL('../../supabase/migrations/20261120103324_topic_homework_photos_by_number.sql', import.meta.url), 'utf8')
const sessions = Object.fromEntries(['student', 'owner'].map(role => [role, makeSession(personas[role].user)]))
const serviceKey = 'local-demo-service'
const anonKey = 'local-demo-anon'
const files = new Map()
const jobs = []
const findings = []
const reviewTasks = []
const environment = {
  AI_API_KEY: 'local-demo-model', AI_MODEL: 'almiron/demo-vision', AI_BASE_URL: origin + '/__photo_course/model',
  SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: serviceKey, SUPABASE_ANON_KEY: anonKey,
}

const db = new PGlite()
await db.exec([
  'create role anon;',
  'create role authenticated;',
  'create schema auth;',
  'create schema storage;',
  "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('fixture.actor',true),'')::uuid $$;",
  "create function public.auth_student_id() returns uuid language sql stable as $$ select case when auth.uid() = '" + IDS.student + "' then '" + IDS.studentRow + "'::uuid end $$;",
  'create table public.topics(id uuid primary key, kind text);',
  'create table public.topic_homework(id uuid primary key, topic_id uuid references public.topics, autocheck boolean not null default false);',
  "create table public.topic_homework_attempts(id uuid primary key default gen_random_uuid(), homework_id uuid not null references public.topic_homework, student_id uuid not null, status text not null default 'draft', attempt_number int not null default 1, created_at timestamptz default now(), updated_at timestamptz default now(), submitted_at timestamptz);",
  'create table public.topic_homework_attempt_files(id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.topic_homework_attempts, storage_path text not null, file_name text not null, mime_type text, position int not null, size_bytes int, created_at timestamptz default now());',
  'create table storage.objects(bucket_id text not null, name text not null, metadata jsonb not null, primary key(bucket_id,name));',
  'create function public.topic_homework_attempt_is_own(uuid) returns boolean language sql stable as $$ select exists(select 1 from public.topic_homework_attempts a where a.id=$1 and a.student_id=public.auth_student_id()) $$;',
  "create function public.topic_homework_submit_attempt(uuid) returns void language plpgsql as $$ begin update public.topic_homework_attempts set status='submitted',submitted_at=now() where id=$1 and student_id=public.auth_student_id() and status='draft'; if not found then raise exception 'No draft'; end if; end $$;",
  'grant usage on schema public,auth,storage to authenticated;',
  'grant select,insert,update,delete on all tables in schema public,storage to authenticated;',
  'alter table public.topic_homework_attempt_files enable row level security;',
  'alter table storage.objects enable row level security;',
  'create policy fixture_original_files on public.topic_homework_attempt_files to authenticated using(true) with check(true);',
  'create policy fixture_original_storage on storage.objects to authenticated using(true) with check(true);',
].join('\n'))
await db.transaction(tx => tx.exec(migration))
for (const lesson of lessons) {
  await db.query("insert into public.topics values($1,'lesson')", [lesson.topicId])
  await db.query('insert into public.topic_homework(id,topic_id,photo_task_numbers) values($1,$2,$3::text[])',
    [lesson.homeworkId, lesson.topicId, lesson.numbers])
}

const aiModule = new URL('../../supabase/functions/check-homework-ai/index.ts', import.meta.url)
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './pdf.ts' && context.parentURL === aiModule.href) {
      return { url: new URL('./photo-course-pdf.mjs', import.meta.url).href, shortCircuit: true }
    }
    if (specifier === 'jsr:@supabase/supabase-js@2') return { url: import.meta.resolve('@supabase/supabase-js'), shortCircuit: true }
    return next(specifier, context)
  },
})
let aiCheck
globalThis.Deno = { env: { get: name => environment[name] }, serve: handler => { aiCheck = handler } }
await import(aiModule.href)

const materials = [
  ...tasks.map((task, index) => ({
    section: 'worksheet_homework', title: 'Задание №' + task.number, content: task.problem, position: index,
  })),
  { section: 'solution', title: 'Эталоны для преподавателя', content: tasks.map(task => task.number + '. ' + task.solution).join('\n\n'), position: 0 },
].map((row, index) => ({
  ...row, id: IDS.material(700 + index), topic_id: topicId, kind: 'text', is_visible: true, track: 'ege',
}))

for (const lesson of lessons.slice(1)) {
  for (const [position, material] of lesson.materials.entries()) {
    const mimeType = material.path.endsWith('.png') ? 'image/png' : 'application/pdf'
    const name = 'local-ege14/' + lesson.order + '/' + position + (mimeType === 'image/png' ? '.png' : '.pdf')
    const stat = await fs.stat(material.path)
    storageMaterials.set(name, { ...material, mimeType, token: randomUUID() })
    materials.push({
      id: IDS.material(1000 + materials.length), topic_id: lesson.topicId, kind: 'file',
      is_visible: true, track: 'ege', section: material.section, title: material.title, position,
      content: null, url: null, storage_path: name, file_name: material.name, size_bytes: stat.size, mime_type: mimeType,
    })
  }
}

function fixtures(role) {
  const fx = baseFixtures(role === 'owner' ? 'ownerTeacher' : 'student')
  fx.tables = fixJson(fx.tables)
  const course = fx.tables.courses.find(row => row.id === IDS.course)
  Object.assign(course, { title: COURSE_TITLE, subject: 'math', exam_type: 'ege' })
  fx.tables.courses = [course]
  fx.tables.groups = fx.tables.groups.filter(group => group.id === IDS.group)
  const group = fx.tables.groups[0]
  group.name = 'Тестовая группа'
  group.courses = course
  fx.tables.group_students = fx.tables.group_students
    .filter(row => row.group_id === group.id && row.student_id === IDS.studentRow)
    .map(row => ({ ...row, groups: group }))
  const exampleTopic = fx.tables.topics.find(row => row.id === topicId)
  const exampleHomework = fx.tables.topic_homework.find(row => row.id === homeworkId)
  fx.tables.modules = fx.tables.modules.filter(module =>
    module.id === IDS.module || (geometryLessons.length && module.id === IDS.module2))
  for (const module of fx.tables.modules) {
    module.title = module.id === IDS.module ? 'Демонстрационный урок' : '№14 · Стереометрия'
    module.order_index = module.id === IDS.module ? 2 : 1
    module.courses = course
    delete module.topics
  }
  fx.tables.topics = lessons.map(lesson => ({
    ...exampleTopic, id: lesson.topicId, title: lesson.title, order_index: lesson.order,
    module_id: lesson.moduleId, modules: fx.tables.modules.find(module => module.id === lesson.moduleId),
    kind: 'lesson', lesson_format: 'training', is_open: true, available_from: null,
    ege_task_numbers: lesson.moduleId === IDS.module2 ? [14] : [],
  }))
  for (const module of fx.tables.modules) {
    module.topics = fx.tables.topics.filter(topic => topic.module_id === module.id)
      .map(({ modules: _modules, ...topic }) => topic)
  }
  fx.tables.topic_homework = lessons.map((lesson, index) => {
    const topic = fx.tables.topics[index]
    return {
      ...exampleHomework, id: lesson.homeworkId, topic_id: lesson.topicId,
      title: lesson.homeworkTitle, instructions: 'Откройте номер и приложите решение. Отправьте работу после того, как закончите.',
      photo_task_numbers: lesson.numbers, due_at: null, is_published: true, autocheck: false, topic, topics: topic,
    }
  })
  const homeworkById = new Map(fx.tables.topic_homework.map(homework => [homework.id, homework]))
  fx.tables.topic_material_items = role === 'student' ? materials.filter(row => row.section !== 'solution') : materials
  Object.assign(fx.tables, {
    topic_homework_reviews: [], topic_homework_ai_jobs: role === 'student' ? [] : jobs,
    topic_homework_ai_findings: role === 'student' ? [] : findings, topic_homework_review_tasks: role === 'owner' ? reviewTasks : [],
    annotation_sets: [], topic_test_assignments: [],
  })
  Object.assign(fx.rpc, {
    topic_student_variants: [],
    topic_autocheck_state: { tasks: [], total: 0, solved: 0, closed: 0, finished: false },
    topic_solution_state: { has_solution: true, has_homework: true, has_condition: true, unlocked: role !== 'student' },
  })
  fx.onWrite = (table, method, rows, filters) => {
    if (role === 'owner' && table === 'topic_homework_review_tasks') {
      if (method === 'POST') reviewTasks.push(...rows)
      const id = filters.find(([field]) => field === 'id')?.[1].slice(3)
      const attemptId = filters.find(([field]) => field === 'attempt_id')?.[1].slice(3)
      if (method === 'PATCH') {
        const item = reviewTasks.find(row => row.id === id)
        if (item) {
          const { id: ignored, created_at: ignoredTime, ...patch } = rows[0]
          Object.assign(item, patch)
        }
      }
      if (method === 'DELETE') {
        for (let i = reviewTasks.length - 1; i >= 0; i--) {
          if (reviewTasks[i].id === id || reviewTasks[i].attempt_id === attemptId) reviewTasks.splice(i, 1)
        }
      }
    }
    if (role !== 'service') return
    if (table === 'topic_homework_ai_jobs' && method === 'PATCH') {
      const id = filters.find(([field]) => field === 'id')?.[1].slice(3)
      const job = jobs.find(row => row.id === id)
      if (job) {
        const { id: ignored, created_at: ignoredTime, ...patch } = rows[0]
        Object.assign(job, patch)
      }
    }
    if (table === 'topic_homework_ai_findings' && method === 'POST') findings.push(...rows)
  }
  return { fx, homeworkById }
}

const byRole = Object.fromEntries(['student', 'owner', 'service'].map(role => [role, fixtures(role)]))
const standard = Object.fromEntries(Object.entries(byRole).map(([role, { fx }]) => [
  role, makeHandler({ fixtures: fx, session: sessions[role], log: () => {}, assetsDir: 'screenshots/harness/assets' }),
]))

function asUser(role, callback) {
  if (role === 'service') return db.transaction(callback)
  return db.transaction(async tx => {
    await tx.exec('set local role authenticated')
    await tx.query("select set_config('fixture.actor',$1,true)", [sessions[role].user.id])
    return callback(tx)
  })
}

function demoModel(body) {
  const content = body.messages?.[0]?.content ?? []
  const seen = new Set(content.flatMap((part, index) => {
    const match = part.type === 'text' && part.text.match(/^Страница #\d+: Задание №([\d.]+) · /)
    return match && content[index + 1]?.type === 'image_url' ? [match[1]] : []
  }))
  const result = {
    readable: true, confidence: 'low', findings: [],
    summary: 'Демонстрационный разбор. Файлы получены с номерами заданий.',
    tasks: [...seen].map(number => ({
      no: number, verdict: 'unchecked', student_answer: '', expected_answer: tasks.find(task => task.number === number)?.answer ?? '',
      note: 'Тестовый ответ модели. На реальном провайдере здесь появится разбор решения.',
    })),
  }
  return { choices: [{ message: { content: JSON.stringify(result) } }] }
}

function send(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

const coursePage = '/my-course/' + IDS.group

function launch(res, role, host, page) {
  const key = 'sb-' + host.split(':')[0].split('.')[0] + '-auth-token'
  const script = [
    'localStorage.setItem(' + JSON.stringify(key) + ',' + JSON.stringify(JSON.stringify(sessions[role])) + ')',
    ...(role === 'owner' ? [
      'localStorage.setItem("almiron:staff-mode:' + IDS.owner + '","teacher")',
      'sessionStorage.setItem("almiron:staff-mode-chosen:' + IDS.owner + '","1")',
    ] : []),
    'location.replace(' + JSON.stringify(page) + ')',
  ].join('\n')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><title>ЕГЭ 2 ч ТЕСТ</title><script>' + script + '</script>')
}

async function middleware(req, res, next) {
  const url = new URL(req.url, origin)
  const pathname = url.pathname
  if (pathname === '/__photo_course/teacher') return launch(res, 'owner', req.headers.host, '/homework-queue')
  if (pathname === '/__photo_course/student' || pathname === '/__photo_course/section-14') {
    const lesson = pathname.endsWith('/section-14') ? lessons[1] : lessons[0]
    const page = lesson ? coursePage + '/topic/' + lesson.topicId + '?tab=homework' : coursePage
    return launch(res, 'student', req.headers.host, page)
  }
  if (pathname === '/__photo_course/course') return launch(res, 'student', req.headers.host, coursePage)
  if (!/^\/(auth|rest|storage|functions)\/v1\//.test(pathname) && !pathname.startsWith('/__photo_course/model/')) return next()

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const buffer = Buffer.concat(chunks)
  const parse = () => JSON.parse(buffer.toString() || '{}')
  const bearer = req.headers.authorization?.slice(7)
  const role = bearer === serviceKey ? 'service' : bearer === sessions.owner.access_token ? 'owner' : 'student'
  const { fx, homeworkById } = byRole[role]
  try {
    if (pathname === '/__photo_course/model/chat/completions') return send(res, demoModel(parse()))
    if (pathname === '/functions/v1/check-homework-ai') {
      const result = await aiCheck(new Request(url, { method: 'POST', headers: req.headers, body: buffer }))
      res.writeHead(result.status, Object.fromEntries(result.headers))
      return res.end(Buffer.from(await result.arrayBuffer()))
    }
    if (pathname.startsWith('/rest/v1/rpc/')) {
      const procedure = pathname.split('/').pop()
      if (procedure === 'rpc_batch') return send(res, null, 404)
      if (procedure === 'topic_homework_start_attempt') {
        const homeworkId = parse().p_homework_id
        if (role !== 'student' || !homeworkIds.has(homeworkId)) return send(res, { message: 'Тема не найдена' }, 404)
        const id = await asUser(role, async tx => {
          const existing = await tx.query("select id from public.topic_homework_attempts where homework_id=$1 and status in ('draft','submitted')", [homeworkId])
          if (existing.rows.length) return existing.rows[0].id
          const made = await tx.query('insert into public.topic_homework_attempts(homework_id,student_id) values($1,public.auth_student_id()) returning id', [homeworkId])
          return made.rows[0].id
        })
        return send(res, id)
      }
      const { p_attempt_id } = parse()
      if (['topic_homework_submit_attempt', 'topic_homework_submit_incomplete_photos'].includes(procedure)) {
        await asUser(role, tx => tx.query('select public.' + procedure + '($1)', [p_attempt_id]))
        return send(res, null)
      }
      if (procedure === 'topic_homework_review_tasks_seed') {
        if (role !== 'owner') return send(res, { message: 'Только преподаватель может открыть разбор' }, 403)
        if (reviewTasks.some(task => task.attempt_id === p_attempt_id)) return send(res, 0)
        const job = jobs.findLast(row => row.attempt_id === p_attempt_id && row.status === 'done')
        const rows = (job?.tasks ?? []).map((task, position) => ({
          ...task, id: randomUUID(), attempt_id: p_attempt_id, position, created_at: new Date().toISOString(),
        }))
        reviewTasks.push(...rows)
        return send(res, rows.length)
      }
      if (procedure === 'topic_homework_ai_request_check') {
        const { rows } = await db.query("select id from public.topic_homework_attempts where id=$1 and status='submitted'", [p_attempt_id])
        if (role !== 'owner' || !rows.length) return send(res, { message: 'Сначала сдайте работу' }, 403)
        const id = randomUUID()
        jobs.push({ id, attempt_id: p_attempt_id, status: 'pending', created_at: new Date().toISOString() })
        return send(res, id)
      }
    }
    if (pathname === '/rest/v1/topic_homework_attempts') {
      const result = await asUser(role, tx => tx.query('select * from public.topic_homework_attempts'))
      fx.tables.topic_homework_attempts = result.rows.map(row => ({ ...row, homework: homeworkById.get(row.homework_id) }))
    }
    if (pathname === '/rest/v1/topic_homework_attempt_files') {
      if (req.method === 'POST') {
        const f = parse()
        const { rows } = await asUser(role, tx => tx.query(
          'insert into public.topic_homework_attempt_files(attempt_id,storage_path,file_name,mime_type,position,size_bytes,photo_task_number) values($1,$2,$3,$4,$5,$6,$7) returning *',
          [f.attempt_id, f.storage_path, f.file_name, f.mime_type, f.position, f.size_bytes, f.photo_task_number],
        ))
        return send(res, rows[0], 201)
      }
      if (req.method === 'DELETE') {
        await asUser(role, tx => tx.query('delete from public.topic_homework_attempt_files where id=$1', [url.searchParams.get('id').slice(3)]))
        res.writeHead(204)
        return res.end()
      }
      fx.tables.topic_homework_attempt_files = (await asUser(role, tx => tx.query('select * from public.topic_homework_attempt_files'))).rows
    }
    const material = pathname.match(/^\/storage\/v1\/object\/(?:(sign|authenticated)\/)?topic-materials\/(local-ege14\/.+)$/)
    if (material) {
      const [, mode, encoded] = material
      const asset = storageMaterials.get(decodeURIComponent(encoded))
      const signed = mode === 'sign' && url.searchParams.get('token') === asset?.token
      const allowed = role === 'owner' || role === 'service' || asset?.section !== 'solution'
      if (!asset || (!signed && !allowed)) return send(res, { message: 'Файл не найден' }, 404)
      if (mode === 'sign' && req.method === 'POST') {
        return send(res, { signedURL: '/object/sign/topic-materials/' + encoded + '?token=' + asset.token })
      }
      if (req.method !== 'GET' || (mode === 'sign' && !signed)) return send(res, { message: 'Файл не найден' }, 404)
      res.writeHead(200, { 'Content-Type': asset.mimeType, 'Cache-Control': 'private, max-age=300' })
      return res.end(await fs.readFile(asset.path))
    }
    const object = pathname.match(/^\/storage\/v1\/object\/(?:(upload\/sign|sign|authenticated)\/)?topic-homework-attempts\/(.+)$/)
    if (object) {
      const [, mode, encoded] = object
      const name = decodeURIComponent(encoded)
      if (mode === 'upload/sign') {
        if (req.method === 'POST') return send(res, { url: '/object/upload/sign/' + bucket + '/' + encoded + '?token=student' })
        await asUser(role, tx => tx.query('insert into storage.objects values($1,$2,$3::jsonb)', [
          bucket, name, JSON.stringify({ mimetype: req.headers['content-type'] }),
        ]))
        files.set(name, { mime: req.headers['content-type'], buffer })
        return send(res, { Key: bucket + '/' + name })
      }
      const reader = url.searchParams.get('token') === 'owner' ? 'owner' : role
      const { rows } = await asUser(reader, tx => tx.query('select name from storage.objects where bucket_id=$1 and name=$2', [bucket, name]))
      if (!rows.length || !files.has(name)) return send(res, { message: 'Фото не найдено' }, 404)
      if (req.method === 'POST') return send(res, { signedURL: '/object/sign/' + bucket + '/' + encoded + '?token=' + role })
      const uploaded = files.get(name)
      res.writeHead(200, { 'Content-Type': uploaded.mime })
      return res.end(uploaded.buffer)
    }
    if (pathname === '/storage/v1/object/' + bucket && req.method === 'DELETE') {
      for (const name of parse().prefixes ?? []) {
        const result = await asUser(role, tx => tx.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name', [bucket, name]))
        if (result.rows.length) files.delete(name)
      }
      return send(res, [])
    }
    return await standard[role]({
      fulfill({ status = 200, headers = {}, contentType, body }) {
        res.writeHead(status, { ...headers, ...(contentType ? { 'Content-Type': contentType } : {}) })
        res.end(body)
      },
      abort() { res.writeHead(404); res.end() },
    }, {
      url: () => SB + pathname + url.search,
      method: () => req.method,
      postData: () => buffer.toString(),
      headers: () => req.headers,
    })
  } catch (error) {
    console.error(req.method, pathname, error.message)
    return send(res, { code: error.code ?? 'P0001', message: error.message }, 400)
  }
}

const server = await createServer({
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'almiron-local-photo-course',
    enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/cloudProject.ts')) {
        return 'export const CLOUD_SUPABASE_URL = window.location.origin'
      }
      if (id.replaceAll('\\', '/').endsWith('/src/lib/supabase.ts')) {
        return code.replace('const supabaseAnonKey = CLOUD_FALLBACK.anonKey', 'const supabaseAnonKey = ' + JSON.stringify(anonKey))
      }
    },
    configureServer(vite) { vite.middlewares.use(middleware) },
  }],
})
await server.listen()
console.log('Ученик  ' + origin + '/__photo_course/student')
if (geometryLessons.length) {
  console.log('Курс    ' + origin + '/__photo_course/course')
  console.log('№14     ' + origin + '/__photo_course/section-14')
}
console.log('Учитель http://localhost:' + port + '/__photo_course/teacher')
