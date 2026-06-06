import type { FileCategory } from '../../shared/types'

// Map file extensions (without dot, lowercase) to a coarse category. Used both
// for treemap coloring and per-directory breakdown stats.
const TABLE: Record<string, FileCategory> = {
  // video
  mp4: 'video', mov: 'video', mkv: 'video', avi: 'video', webm: 'video',
  m4v: 'video', wmv: 'video', flv: 'video', mpg: 'video', mpeg: 'video',
  // image
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image',
  tiff: 'image', tif: 'image', webp: 'image', heic: 'image', heif: 'image',
  raw: 'image', svg: 'image', ico: 'image', psd: 'image',
  // audio
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', m4a: 'audio',
  ogg: 'audio', opus: 'audio', aiff: 'audio',
  // archive
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive',
  xz: 'archive', '7z': 'archive', rar: 'archive', dmg: 'archive',
  // code
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code', py: 'code', rb: 'code',
  go: 'code', rs: 'code', c: 'code', cc: 'code', cpp: 'code', h: 'code',
  hpp: 'code', java: 'code', kt: 'code', swift: 'code', m: 'code', mm: 'code',
  cs: 'code', php: 'code', sh: 'code', zsh: 'code', json: 'code', yaml: 'code',
  yml: 'code', toml: 'code', xml: 'code', html: 'code', css: 'code', scss: 'code',
  // document
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document',
  xlsx: 'document', ppt: 'document', pptx: 'document', pages: 'document',
  numbers: 'document', key: 'document', txt: 'document', md: 'document',
  rtf: 'document', epub: 'document', mobi: 'document',
  // cache (extensions seen in browser/IDE caches)
  cache: 'cache', tmp: 'cache', log: 'cache', bak: 'cache',
  // binary
  so: 'binary', dylib: 'binary', a: 'binary', o: 'binary', exe: 'binary',
  dll: 'binary', wasm: 'binary', deb: 'binary', pkg: 'binary', rpm: 'binary'
}

// Path-segment heuristics layered on top of extension lookup. A file living
// under any of these is treated as cache, regardless of extension.
const CACHE_PATH_HINTS = [
  '/Caches/',
  '/Cache/',
  '/Library/Logs/',
  '/.Trash/',
  '/node_modules/.cache/',
  '/.cache/',
  '/DerivedData/'
]

export function categorize(name: string, parentPath: string): FileCategory {
  // Trailing-dot directories (.app bundles, .framework) — treat as 'app' / binary
  if (name.endsWith('.app')) return 'app'
  if (name.endsWith('.framework') || name.endsWith('.bundle')) return 'binary'

  for (const hint of CACHE_PATH_HINTS) {
    if (parentPath.includes(hint)) return 'cache'
  }
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'other'
  const ext = name.slice(dot + 1).toLowerCase()
  return TABLE[ext] ?? 'other'
}

export function emptyBreakdown(): Record<FileCategory, number> {
  return {
    video: 0, image: 0, audio: 0, archive: 0, code: 0,
    document: 0, cache: 0, binary: 0, app: 0, other: 0
  }
}

export const CATEGORY_ORDER: FileCategory[] = [
  'video', 'image', 'audio', 'archive', 'code',
  'document', 'cache', 'binary', 'app', 'other'
]

export const CATEGORY_COLOR: Record<FileCategory, string> = {
  video: '#ef4444',
  image: '#f59e0b',
  audio: '#a855f7',
  archive: '#84cc16',
  code: '#22d3ee',
  document: '#6366f1',
  cache: '#94a3b8',
  binary: '#64748b',
  app: '#10b981',
  other: '#2563eb'
}
