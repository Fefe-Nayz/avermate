const AUDIO_EXTENSIONS = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
])

const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "ogv", "webm"])

const DOCUMENT_TRANSCRIPT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
])

const CODE_LANGUAGES: Readonly<Record<string, string>> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  clj: "clojure",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  csv: "csv",
  cxx: "cpp",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  lua: "lua",
  m: "objective-c",
  mjs: "javascript",
  php: "php",
  pl: "perl",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  sh: "shellscript",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
}

const CODE_MIME_LANGUAGES: Readonly<Record<string, string>> = {
  "application/javascript": "javascript",
  "application/json": "json",
  "application/sql": "sql",
  "application/typescript": "typescript",
  "application/x-httpd-php": "php",
  "application/x-javascript": "javascript",
  "application/x-python-code": "python",
  "application/x-ruby": "ruby",
  "application/xml": "xml",
  "text/css": "css",
  "text/html": "html",
  "text/javascript": "javascript",
  "text/x-c": "c",
  "text/x-c++": "cpp",
  "text/x-java-source": "java",
  "text/x-python": "python",
  "text/x-r-source": "r",
  "text/x-sql": "sql",
  "text/xml": "xml",
}

export type MediaKind = "audio" | "video"

export function fileExtension(title: string): string | null {
  const cleanTitle = title.split(/[?#]/, 1)[0] ?? title
  const match = /\.([a-z0-9][a-z0-9+-]*)$/i.exec(cleanTitle)
  return match?.[1]?.toLowerCase() ?? null
}

function normalizedMime(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";", 1)[0]!.trim().toLowerCase()
}

export function mediaKind(
  title: string,
  mimeType: string | null | undefined
): MediaKind | null {
  const mime = normalizedMime(mimeType)
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  const extension = fileExtension(title)
  if (extension && AUDIO_EXTENSIONS.has(extension)) return "audio"
  if (extension && VIDEO_EXTENSIONS.has(extension)) return "video"
  return null
}

export function isTranscribableMimeType(
  mimeType: string | null | undefined
): boolean {
  const mime = normalizedMime(mimeType)
  return (
    DOCUMENT_TRANSCRIPT_MIME_TYPES.has(mime) ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/")
  )
}

export function isSubtitleFile(
  title: string,
  mimeType: string | null | undefined
): boolean {
  const mime = normalizedMime(mimeType)
  const extension = fileExtension(title)
  return (
    extension === "srt" ||
    extension === "vtt" ||
    mime === "application/x-subrip" ||
    mime === "text/vtt"
  )
}

export function isNotebookFile(
  title: string,
  mimeType: string | null | undefined
): boolean {
  const mime = normalizedMime(mimeType)
  return (
    fileExtension(title) === "ipynb" ||
    mime === "application/x-ipynb+json" ||
    mime === "application/vnd.jupyter"
  )
}

export function isEpubFile(
  title: string,
  mimeType: string | null | undefined
): boolean {
  return (
    fileExtension(title) === "epub" ||
    normalizedMime(mimeType) === "application/epub+zip"
  )
}

export function codeLanguage(
  title: string,
  mimeType: string | null | undefined
): string | null {
  const extension = fileExtension(title)
  if (extension && CODE_LANGUAGES[extension]) return CODE_LANGUAGES[extension]
  return CODE_MIME_LANGUAGES[normalizedMime(mimeType)] ?? null
}
