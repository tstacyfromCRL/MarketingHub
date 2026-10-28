/** Loaded by name so the typecheck does not depend on the parser package being present. */
function loadParser(name: string): Promise<Record<string, unknown>> {
  return import(name);
}

/** Reads reference documents into plain text. md and txt are used as written. */
export async function extractText(buffer: Buffer, mimeOrName: string): Promise<string> {
  const hint = mimeOrName.toLowerCase();
  if (hint.includes('pdf') || hint.endsWith('.pdf')) {
    const loaded = await loadParser('pdf-parse');
    const pdfParse = (loaded.default ?? loaded) as (data: Buffer) => Promise<{ text: string }>;
    const result = await pdfParse(buffer);
    return result.text.trim();
  }
  if (hint.includes('wordprocessingml') || hint.endsWith('.docx')) {
    const mammoth = (await loadParser('mammoth')) as { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }
  if (hint.includes('markdown') || hint.endsWith('.md') || hint.includes('text/plain') || hint.endsWith('.txt') || hint === '') {
    return buffer.toString('utf8').trim();
  }
  throw new Error(`Can't extract text from ${mimeOrName}`);
}
