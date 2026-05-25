export const THEME_FONT_STACKS = {
  avermate:
    "var(--font-gabarito), var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  geist: "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
  inter: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  roboto: "var(--font-roboto), ui-sans-serif, system-ui, sans-serif",
  poppins: "var(--font-poppins), ui-sans-serif, system-ui, sans-serif",
  montserrat: "var(--font-montserrat), ui-sans-serif, system-ui, sans-serif",
  outfit: "var(--font-outfit), ui-sans-serif, system-ui, sans-serif",
  plusJakarta:
    "var(--font-plus-jakarta), ui-sans-serif, system-ui, sans-serif",
  dmSans: "var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif",
  nunito: "var(--font-nunito), ui-sans-serif, system-ui, sans-serif",
  lora: "var(--font-lora), ui-serif, Georgia, Cambria, serif",
  merriweather: "var(--font-merriweather), ui-serif, Georgia, Cambria, serif",
  playfair:
    "var(--font-playfair), ui-serif, Georgia, Cambria, serif",
  jetbrains:
    "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  firaCode:
    "var(--font-fira-code), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  sourceCode:
    "var(--font-source-code-pro), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
} as const;

export const defaultThemeFontStack = THEME_FONT_STACKS.avermate;

export const themeFontOptions = [
  { label: "Avermate", value: THEME_FONT_STACKS.avermate },
  { label: "Geist", value: THEME_FONT_STACKS.geist },
  { label: "Inter", value: THEME_FONT_STACKS.inter },
  { label: "Roboto", value: THEME_FONT_STACKS.roboto },
  { label: "Poppins", value: THEME_FONT_STACKS.poppins },
  { label: "Montserrat", value: THEME_FONT_STACKS.montserrat },
  { label: "Outfit", value: THEME_FONT_STACKS.outfit },
  { label: "Plus Jakarta Sans", value: THEME_FONT_STACKS.plusJakarta },
  { label: "DM Sans", value: THEME_FONT_STACKS.dmSans },
  { label: "Nunito", value: THEME_FONT_STACKS.nunito },
  { label: "Lora", value: THEME_FONT_STACKS.lora },
  { label: "Merriweather", value: THEME_FONT_STACKS.merriweather },
  { label: "Playfair Display", value: THEME_FONT_STACKS.playfair },
  { label: "JetBrains Mono", value: THEME_FONT_STACKS.jetbrains },
  { label: "Fira Code", value: THEME_FONT_STACKS.firaCode },
  { label: "Source Code Pro", value: THEME_FONT_STACKS.sourceCode },
] as const;

export function normalizeThemeFontStack(fontStack: string) {
  const directMatch = themeFontOptions.find(
    (option) => option.value === fontStack
  );

  if (directMatch) {
    return directMatch.value;
  }

  const normalized = fontStack.toLowerCase();
  const legacyMatch = themeFontOptions.find((option) =>
    normalized.includes(option.label.toLowerCase().replace(" sans", ""))
  );

  return legacyMatch?.value ?? fontStack;
}

export function getThemeFontLabel(fontStack: string) {
  const normalizedStack = normalizeThemeFontStack(fontStack);
  return (
    themeFontOptions.find((option) => option.value === normalizedStack)?.label ??
    "Personnalisée"
  );
}
