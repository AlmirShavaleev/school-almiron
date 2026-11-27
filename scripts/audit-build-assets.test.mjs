import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { auditBuild } from './audit-build-assets.mjs'

test('audits module imports, preloads and CSS dependencies, including inactive chunks', t => {
  const root = mkdtempSync(join(tmpdir(), 'almiron-audit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'assets'))
  const write = (path, data) => writeFileSync(join(root, path), data)
  write('index.html', '<script src="/assets/index-AA.js"></script>')
  write('assets/index-AA.js', 'const deps=["assets/lesson-AA.css"]; const next=()=>import("./lesson-AA.js")')
  write('assets/lesson-AA.js', 'import "./useStudentTopicJournal-DTw7_tVx.js"')
  write('assets/lesson-AA.css', 'a{src:url("./font-AA.woff2?v=2");background:url(data:image/png;base64,abc)}')
  write('assets/inactive-AA.js', 'export { x } from "./other-AA.js";')
  assert.deepEqual(auditBuild(root).missing, [
    { file: 'assets/inactive-AA.js', dependency: 'assets/other-AA.js' },
    { file: 'assets/lesson-AA.css', dependency: 'assets/font-AA.woff2' },
    { file: 'assets/lesson-AA.js', dependency: 'assets/useStudentTopicJournal-DTw7_tVx.js' },
  ])
  write('assets/useStudentTopicJournal-DTw7_tVx.js', 'export {}')
  write('assets/other-AA.js', 'export const x = 1')
  write('assets/font-AA.woff2', 'fixture')
  assert.equal(auditBuild(root).missing.length, 0)
})
