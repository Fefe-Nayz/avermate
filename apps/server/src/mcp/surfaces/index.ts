import { adminSurface } from "./admin";
import { destructiveSurface } from "./destructive";
import { documentsSurface } from "./documents";
import { materialsSurface } from "./materials";
import { plannerSurface } from "./planner";
import { promptsSurface } from "./prompts";
import { readSurface } from "./read";
import { resourcesSurface } from "./resources";
import { socialManageSurface } from "./social-manage";
import { socialModerationSurface } from "./social-moderation";
import { socialReadSurface } from "./social-read";
import { writeSurface } from "./write";
import type { McpSurface } from "../shared";

/** Registration order is part of the deterministic MCP catalog contract. */
export const SURFACES: readonly McpSurface[] = [
  readSurface,
  resourcesSurface,
  promptsSurface,
  writeSurface,
  socialReadSurface,
  socialManageSurface,
  destructiveSurface,
  adminSurface,
  socialModerationSurface,
  plannerSurface,
  materialsSurface,
  documentsSurface,
];
