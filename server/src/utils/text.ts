/**
 * Ensure Unicode NFC Normalization
 */
export function normalizeNfc(text: string): string {
  if (!text) return '';
  return text.normalize('NFC');
}

/**
 * Strips unsupported characters when rendering Latin fonts to prevent empty glyph rectangles
 */
export function sanitizeForFont(text: string, isEthiopic: boolean, fallback: string = ''): string {
  if (!text) return fallback;
  if (!isEthiopic) {
    // Remove Ethiopic Unicode block (U+1200 - U+139F, U+2D80 - U+2DDF, U+AB00 - U+AB2F)
    const cleaned = text
      .replace(/[\u1200-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]+/g, '')
      .replace(/[()]/g, '')
      .trim();
    return cleaned || fallback;
  }
  return text.trim() || fallback;
}
