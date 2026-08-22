export const MAX_EPUB_BYTES = 100 * 1024 * 1024
export const MAX_EPUB_ENTRIES = 5_000
export const MAX_EPUB_ENTRY_BYTES = 64 * 1024 * 1024
export const MAX_EPUB_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
export const MAX_EPUB_COMPRESSION_RATIO = 100

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const MINIMUM_END_SIZE = 22
const MAXIMUM_ZIP_COMMENT = 0xffff

function zipPathIsUnsafe(bytes: Uint8Array): boolean {
  const path = new TextDecoder().decode(bytes).replace(/\\/g, "/")
  return (
    path.startsWith("/") ||
    /^[a-z]:\//i.test(path) ||
    path.split("/").some((part) => part === "..")
  )
}

/**
 * Inspect ZIP central-directory metadata without inflating the archive.
 *
 * epub.js otherwise starts expanding manifest assets while opening the book;
 * checking these sizes first is what turns the compressed-size cap into a real
 * zip-bomb boundary.
 */
export function epubArchiveIssue(input: ArrayBuffer): string | null {
  if (input.byteLength > MAX_EPUB_BYTES) {
    return "This EPUB is too large to open safely."
  }
  if (input.byteLength < MINIMUM_END_SIZE) {
    return "This EPUB archive is incomplete."
  }

  const bytes = new Uint8Array(input)
  const view = new DataView(input)
  const earliest = Math.max(
    0,
    bytes.byteLength - MINIMUM_END_SIZE - MAXIMUM_ZIP_COMMENT
  )
  let endOffset = -1
  for (
    let offset = bytes.byteLength - MINIMUM_END_SIZE;
    offset >= earliest;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) return "This file is not a valid EPUB archive."

  const disk = view.getUint16(endOffset + 4, true)
  const centralDisk = view.getUint16(endOffset + 6, true)
  const diskEntries = view.getUint16(endOffset + 8, true)
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralSize = view.getUint32(endOffset + 12, true)
  const centralOffset = view.getUint32(endOffset + 16, true)
  const commentLength = view.getUint16(endOffset + 20, true)
  if (endOffset + MINIMUM_END_SIZE + commentLength > bytes.byteLength) {
    return "This EPUB archive has an invalid directory."
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    return "Multi-part EPUB archives are not supported."
  }
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    return "ZIP64 EPUB archives are not supported."
  }
  if (entryCount === 0 || entryCount > MAX_EPUB_ENTRIES) {
    return `An EPUB can contain at most ${MAX_EPUB_ENTRIES} files.`
  }
  const centralEnd = centralOffset + centralSize
  if (
    !Number.isSafeInteger(centralEnd) ||
    centralEnd > endOffset ||
    centralOffset < 0
  ) {
    return "This EPUB archive has an invalid directory."
  }

  let cursor = centralOffset
  let uncompressedTotal = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > centralEnd ||
      view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY
    ) {
      return "This EPUB archive has an invalid directory."
    }
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const fileCommentLength = view.getUint16(cursor + 32, true)
    const next = cursor + 46 + nameLength + extraLength + fileCommentLength
    if (next > centralEnd || nameLength === 0 || nameLength > 1_024) {
      return "This EPUB archive has an invalid file entry."
    }
    if (flags & 1) return "Encrypted EPUB archives are not supported."
    if (method !== 0 && method !== 8) {
      return "This EPUB uses an unsupported compression method."
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      return "ZIP64 EPUB archives are not supported."
    }
    if (uncompressedSize > MAX_EPUB_ENTRY_BYTES) {
      return "This EPUB contains a file that is too large to open safely."
    }
    uncompressedTotal += uncompressedSize
    if (
      uncompressedTotal > MAX_EPUB_UNCOMPRESSED_BYTES ||
      uncompressedTotal > input.byteLength * MAX_EPUB_COMPRESSION_RATIO
    ) {
      return "This EPUB expands beyond the safe preview limit."
    }
    if (
      zipPathIsUnsafe(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    ) {
      return "This EPUB contains an unsafe file path."
    }
    cursor = next
  }
  if (cursor > centralEnd) return "This EPUB archive has an invalid directory."
  return null
}
