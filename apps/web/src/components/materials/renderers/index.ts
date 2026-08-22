import { codeRenderer } from "./code-renderer"
import { csvRenderer } from "./csv-renderer"
import { epubRenderer } from "./epub-renderer"
import { imageRenderer } from "./image-renderer"
import { latexRenderer } from "./latex-renderer"
import { mediaRenderer } from "./media-renderer"
import { notebookRenderer } from "./notebook-renderer"
import { officeRenderer } from "./office-renderer"
import { pdfRenderer } from "./pdf-renderer"
import { recordingRenderer, studyRenderer } from "./study-renderer"
import { subtitleRenderer } from "./subtitle-renderer"
import {
  inlineNoteRenderer,
  linkRenderer,
  textFileRenderer,
} from "./text-renderer"
import type { MaterialRenderer } from "./registry"

/**
 * Every reader the browser knows about.
 *
 * Adding a file type is one new file beside this one and one line in this
 * list. Nothing else changes — not the pane, not the table, not the viewer —
 * which is the whole point of the registry: the cost of supporting a format
 * used to be editing the component that displayed all the others.
 *
 * The order here does not decide anything; `priority` does. It is written
 * loosely most-specific-first so the list reads the way it resolves.
 */
export const MATERIAL_RENDERERS: readonly MaterialRenderer[] = [
  latexRenderer,
  studyRenderer,
  recordingRenderer,
  inlineNoteRenderer,
  linkRenderer,
  notebookRenderer,
  epubRenderer,
  officeRenderer,
  mediaRenderer,
  pdfRenderer,
  imageRenderer,
  subtitleRenderer,
  codeRenderer,
  csvRenderer,
  textFileRenderer,
]

export {
  pickMaterialRenderer,
  rendererCanEdit,
  type MaterialRenderMode,
  type MaterialRenderProps,
  type MaterialRenderer,
} from "./registry"
