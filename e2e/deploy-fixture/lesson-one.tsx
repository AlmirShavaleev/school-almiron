import { useState } from 'react'
import { readStudentDraft, saveStudentDraft, studentDraftKey, useDraftFiles } from '@/lib/studentDrafts'
import { BUILD_ID } from '@/lib/buildVersion'

export function BuildFixtureLesson({ owner = 'fake-student' }: { owner?: string }) {
  const scope = [owner, 'fixture-course', 'fixture-lesson', 'fake-attempt']
  const answerKey = studentDraftKey('assignment-answer', ...scope)
  const filesKey = studentDraftKey('assignment-files', ...scope)
  const [answer, setAnswer] = useState(() => readStudentDraft(answerKey, ''))
  const [files, setFiles, { phase }] = useDraftFiles(filesKey)
  const [readFile, setReadFile] = useState('')
  const [submittedFiles, setSubmittedFiles] = useState<string | null>(null)
  return (
    <>
      <h2>Урок 1 · {BUILD_ID}</h2>
      <label>Ответ<textarea value={answer} onChange={event => {
        setAnswer(event.target.value)
        saveStudentDraft(answerKey, event.target.value)
      }} /></label>
      <label>Вложение<input type="file" disabled={phase !== 'ready'} onChange={event => setFiles(Array.from(event.target.files ?? []))} /></label>
      {files[0] && <button onClick={async () => setReadFile(await files[0].text())}>{files[0].name}</button>}
      <output>{readFile}</output>
      <button type="button" disabled={phase !== 'ready'} onClick={() => {
        if (phase === 'ready') setSubmittedFiles(files.map(file => file.name).join(', '))
      }}>Submit fixture</button>
      {submittedFiles !== null && <output data-testid="submitted-files">{submittedFiles}</output>}
    </>
  )
}
