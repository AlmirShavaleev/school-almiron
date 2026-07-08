import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const ANON_KEY = fs.readFileSync(path.resolve(dir, '../../.env'), 'utf8')
  .match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()

const LESSON_ID = process.env.E2E_MATERIALS_LESSON_ID
const TEACHER_PROFILE_ID = '43396c60-0c26-4c7d-a944-1dfa727353be'
const BUCKET = 'lesson-materials'

async function main() {
  const supabase = createClient(SUPABASE_URL, ANON_KEY)
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: 'physics@demo.ru', password: 'demo123' })
  if (authErr) throw authErr

  const results = {}

  async function tryUpload(label, filename, bytes, contentType) {
    const path_ = `${LESSON_ID}/${TEACHER_PROFILE_ID}/mime-test-${Date.now()}-${filename}`
    const { data, error } = await supabase.storage.from(BUCKET).upload(path_, bytes, { contentType, cacheControl: '0' })
    results[label] = error ? { ok: false, message: error.message } : { ok: true, path: data.path }
    if (data?.path) await supabase.storage.from(BUCKET).remove([data.path]) // cleanup immediately on success
  }

  // 1. Valid PDF — must succeed
  const pdf = fs.readFileSync(path.join(dir, 'test-material.pdf'))
  await tryUpload('pdf_allowed', 'test.pdf', pdf, 'application/pdf')

  // 2. Valid PNG — must succeed
  const png = fs.readFileSync(path.join(dir, 'test-image.png'))
  await tryUpload('png_allowed', 'test.png', png, 'image/png')

  // 3. Executable — must be rejected (not in allowed_mime_types)
  const exe = fs.readFileSync(path.join(dir, 'malicious.exe'))
  await tryUpload('exe_rejected', 'malicious.exe', exe, 'application/x-msdownload')

  // 4. MIME spoofing: executable bytes, claiming to be application/pdf — must still be rejected
  //    (Supabase Storage validates the actual detected content type server-side, not the
  //    client-supplied Content-Type header alone, for buckets with allowed_mime_types set)
  await tryUpload('mime_spoof_exe_as_pdf', 'spoofed.pdf', exe, 'application/pdf')

  // 5. Oversized file (21MB > 20MB limit) — must be rejected
  const big = fs.readFileSync(path.join(dir, 'oversized.pdf'))
  await tryUpload('oversized_rejected', 'oversized.pdf', big, 'application/pdf')

  // 6. Path traversal attempt via ../ — must be rejected or normalized (never escape own folder)
  const traversalPath = `${LESSON_ID}/${TEACHER_PROFILE_ID}/../../../etc/passwd.pdf`
  const { data: travData, error: travErr } = await supabase.storage.from(BUCKET)
    .upload(traversalPath, pdf, { contentType: 'application/pdf', cacheControl: '0' })
  results.path_traversal = travErr
    ? { ok: false, message: travErr.message }
    : { ok: true, path: travData.path, note: 'check path below — must still be scoped, not literally /etc/' }
  if (travData?.path) await supabase.storage.from(BUCKET).remove([travData.path])

  console.log(JSON.stringify(results, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
