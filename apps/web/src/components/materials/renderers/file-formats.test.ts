import { describe, expect, test } from "bun:test"
import {
  codeLanguage,
  fileExtension,
  isEpubFile,
  isNotebookFile,
  isSubtitleFile,
  isTranscribableMimeType,
  mediaKind,
} from "./file-formats"

describe("material file format detection", () => {
  test("normalises extensions and MIME parameters", () => {
    expect(fileExtension("Analyse.PY")).toBe("py")
    expect(
      codeLanguage("sans-extension", "application/json; charset=utf-8")
    ).toBe("json")
    expect(codeLanguage("cours.cpp", "text/plain")).toBe("cpp")
  })

  test("separates media, notebooks, subtitles and EPUBs", () => {
    expect(mediaKind("podcast.bin", "audio/mpeg")).toBe("audio")
    expect(mediaKind("cours.webm", null)).toBe("video")
    expect(isNotebookFile("calcul.ipynb", "application/json")).toBe(true)
    expect(isSubtitleFile("captions.vtt", "text/plain")).toBe(true)
    expect(isEpubFile("manuel", "application/epub+zip")).toBe(true)
    expect(isTranscribableMimeType("audio/flac")).toBe(true)
    expect(isTranscribableMimeType("video/quicktime; codecs=h264")).toBe(true)
    expect(isTranscribableMimeType("application/pdf")).toBe(true)
  })

  test("does not mistake prose or archives for source code", () => {
    expect(codeLanguage("notes.md", "text/markdown")).toBeNull()
    expect(codeLanguage("archive.zip", "application/zip")).toBeNull()
    expect(mediaKind("image.png", "image/png")).toBeNull()
    expect(isTranscribableMimeType("text/plain")).toBe(false)
  })
})
