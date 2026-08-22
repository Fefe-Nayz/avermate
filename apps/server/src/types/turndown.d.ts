declare module "turndown" {
  export interface TurndownOptions {
    headingStyle?: "setext" | "atx";
    hr?: string;
    bulletListMarker?: "-" | "+" | "*";
    codeBlockStyle?: "indented" | "fenced";
    fence?: string;
    emDelimiter?: "_" | "*";
    strongDelimiter?: "**" | "__";
    linkStyle?: "inlined" | "referenced";
  }

  export type TurndownPlugin = (service: TurndownService) => void;

  export default class TurndownService {
    constructor(options?: TurndownOptions);
    use(plugin: TurndownPlugin | readonly TurndownPlugin[]): this;
    turndown(input: string | Node): string;
  }
}

declare module "turndown-plugin-gfm" {
  import type { TurndownPlugin } from "turndown";
  export const gfm: TurndownPlugin;
}
