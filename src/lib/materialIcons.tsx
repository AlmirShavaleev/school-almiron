import type { ReactNode } from 'react'
import { FileArchive, FileCode2, FileImage, FileSpreadsheet, FileText, FileType2, Presentation } from 'lucide-react'

const EXT_ICON: Record<string, ReactNode> = {
  pdf: <FileText size={18} className="text-red-500 shrink-0" />,
  doc: <FileText size={18} className="text-blue-500 shrink-0" />,
  docx: <FileText size={18} className="text-blue-500 shrink-0" />,
  txt: <FileText size={18} className="text-slate-500 shrink-0" />,
  rtf: <FileText size={18} className="text-slate-500 shrink-0" />,
  xls: <FileSpreadsheet size={18} className="text-green-600 shrink-0" />,
  xlsx: <FileSpreadsheet size={18} className="text-green-600 shrink-0" />,
  csv: <FileSpreadsheet size={18} className="text-green-600 shrink-0" />,
  ppt: <Presentation size={18} className="text-orange-500 shrink-0" />,
  pptx: <Presentation size={18} className="text-orange-500 shrink-0" />,
  jpg: <FileImage size={18} className="text-fuchsia-500 shrink-0" />,
  jpeg: <FileImage size={18} className="text-fuchsia-500 shrink-0" />,
  png: <FileImage size={18} className="text-fuchsia-500 shrink-0" />,
  gif: <FileImage size={18} className="text-fuchsia-500 shrink-0" />,
  webp: <FileImage size={18} className="text-fuchsia-500 shrink-0" />,
  zip: <FileArchive size={18} className="text-amber-600 shrink-0" />,
  rar: <FileArchive size={18} className="text-amber-600 shrink-0" />,
  '7z': <FileArchive size={18} className="text-amber-600 shrink-0" />,
  json: <FileCode2 size={18} className="text-cyan-600 shrink-0" />,
  md: <FileType2 size={18} className="text-slate-500 shrink-0" />,
}

export function getMaterialFileExtension(path: string | null | undefined) {
  if (!path) return ''
  const clean = path.split('?')[0] || ''
  const fileName = clean.split('/').pop() || ''
  const match = /\.([a-z0-9]+)$/i.exec(fileName)
  return match?.[1]?.toLowerCase() || ''
}

export function getMaterialFileIcon(path: string | null | undefined) {
  return EXT_ICON[getMaterialFileExtension(path)] || <FileText size={18} className="text-gray-300 shrink-0" />
}
