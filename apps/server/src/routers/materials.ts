import { materialDocumentsRouter } from "./materials/documents";
import { materialFoldersRouter } from "./materials/folders";
import { materialsOperationsRouter } from "./materials/operations";
import { materialTagsRouter } from "./materials/tags";
import { materialPreviewRouter } from "./materials/previews";

export const materialsRouter = {
  ...materialsOperationsRouter,
  folders: materialFoldersRouter,
  documents: {
    ...materialDocumentsRouter,
    ...materialPreviewRouter,
  },
  tags: materialTagsRouter,
};
