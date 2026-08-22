import { describe, expect, test } from "bun:test";
import { extractNativePdfText } from "./adapters";

function syntheticPdf(pageTexts: readonly string[]) {
  const objects: string[] = [];
  const pageIds = pageTexts.map((_text, index) => 3 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
  );
  pageTexts.forEach((text, index) => {
    const pageId = 3 + index * 2;
    const streamId = pageId + 1;
    const escaped = text
      .replaceAll("\\", "\\\\")
      .replaceAll("(", "\\(")
      .replaceAll(")", "\\)");
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pageTexts.length * 2} 0 R >> >> /Contents ${streamId} 0 R >>`,
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("native PDF text-layer extraction", () => {
  test("preserves exact one-based page boundaries before OCR fallback", async () => {
    const result = await extractNativePdfText(
      syntheticPdf(["Pythagore page one", "Thales page two"]),
    );
    expect(result.totalPages).toBe(2);
    expect(result.pages).toEqual([
      { page: 1, text: "Pythagore page one" },
      { page: 2, text: "Thales page two" },
    ]);
  });
});
