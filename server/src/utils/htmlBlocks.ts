export type ContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list-item'; ordered: boolean; index: number; text: string }
  | { type: 'pre'; text: string };

const SUPPORTED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'pre',
  'table',
]);

/**
 * Linear-scan HTML parser without regex backreferences (removes super-linear backtracking risk on adversarial input)
 */
export function parseHtmlToBlocks(html: string): ContentBlock[] {
  if (!html) return [];

  // 1. Replace scripture span tags with clean bracketed citation
  let clean = html.replace(/<span\s+data-ref="([^"]+)"[^>]*>([\s\S]*?)<\/span>/gi, '[$1]');

  // 2. Replace break tags with newline
  clean = clean.replace(/<br\s*\/?>/gi, '\n');

  const blocks: ContentBlock[] = [];
  let cursor = 0;
  const len = clean.length;

  while (cursor < len) {
    // Find next tag opening '<'
    const openIndex = clean.indexOf('<', cursor);
    if (openIndex === -1) {
      break;
    }

    // Find the end of the opening tag '>'
    const openTagEnd = clean.indexOf('>', openIndex);
    if (openTagEnd === -1) {
      break;
    }

    // Extract tag name
    const tagContent = clean.slice(openIndex + 1, openTagEnd).trim();
    if (tagContent.startsWith('/') || tagContent.startsWith('!')) {
      // Closing tag or comment at top level; advance past it
      cursor = openTagEnd + 1;
      continue;
    }

    const spaceIndex = tagContent.search(/[\s/]/);
    const tagName = (spaceIndex === -1 ? tagContent : tagContent.slice(0, spaceIndex)).toLowerCase();

    if (!SUPPORTED_TAGS.has(tagName)) {
      cursor = openTagEnd + 1;
      continue;
    }

    // Find corresponding closing tag `</tagName>`
    const closeTagStr = `</${tagName}>`;
    const closeTagIndex = clean.toLowerCase().indexOf(closeTagStr, openTagEnd + 1);

    let rawContent: string;
    if (closeTagIndex !== -1) {
      rawContent = clean.slice(openTagEnd + 1, closeTagIndex);
      cursor = closeTagIndex + closeTagStr.length;
    } else {
      // Unclosed tag: scan to next '<' or end of string
      const nextOpen = clean.indexOf('<', openTagEnd + 1);
      if (nextOpen !== -1) {
        rawContent = clean.slice(openTagEnd + 1, nextOpen);
        cursor = nextOpen;
      } else {
        rawContent = clean.slice(openTagEnd + 1);
        cursor = len;
      }
    }

    // Process tag content based on tagName
    if (tagName === 'ul' || tagName === 'ol') {
      const isOrdered = tagName === 'ol';
      let liCursor = 0;
      let itemIndex = 1;
      const liLen = rawContent.length;

      while (liCursor < liLen) {
        const liOpen = rawContent.toLowerCase().indexOf('<li', liCursor);
        if (liOpen === -1) break;

        const liOpenEnd = rawContent.indexOf('>', liOpen);
        if (liOpenEnd === -1) break;

        const liClose = rawContent.toLowerCase().indexOf('</li>', liOpenEnd);
        let liText: string;

        if (liClose !== -1) {
          liText = rawContent.slice(liOpenEnd + 1, liClose);
          liCursor = liClose + 5;
        } else {
          const nextLi = rawContent.toLowerCase().indexOf('<li', liOpenEnd);
          if (nextLi !== -1) {
            liText = rawContent.slice(liOpenEnd + 1, nextLi);
            liCursor = nextLi;
          } else {
            liText = rawContent.slice(liOpenEnd + 1);
            liCursor = liLen;
          }
        }

        const textContent = liText.replace(/<[^>]+>/g, '').trim();
        if (textContent) {
          blocks.push({
            type: 'list-item',
            ordered: isOrdered,
            index: itemIndex++,
            text: textContent,
          });
        }
      }
    } else if (tagName.startsWith('h')) {
      const level = parseInt(tagName.charAt(1), 10) || 2;
      const textContent = rawContent.replace(/<[^>]+>/g, '').trim();
      if (textContent) {
        blocks.push({ type: 'heading', level, text: textContent });
      }
    } else if (tagName === 'blockquote') {
      const textContent = rawContent.replace(/<[^>]+>/g, '').trim();
      if (textContent) {
        blocks.push({ type: 'quote', text: textContent });
      }
    } else if (tagName === 'pre') {
      const textContent = rawContent.replace(/<[^>]+>/g, '').trim();
      if (textContent) {
        blocks.push({ type: 'pre', text: textContent });
      }
    } else if (tagName === 'table') {
      let trCursor = 0;
      const tableLen = rawContent.length;
      while (trCursor < tableLen) {
        const trOpen = rawContent.toLowerCase().indexOf('<tr', trCursor);
        if (trOpen === -1) break;

        const trOpenEnd = rawContent.indexOf('>', trOpen);
        if (trOpenEnd === -1) break;

        const trClose = rawContent.toLowerCase().indexOf('</tr>', trOpenEnd);
        let trContent: string;

        if (trClose !== -1) {
          trContent = rawContent.slice(trOpenEnd + 1, trClose);
          trCursor = trClose + 5;
        } else {
          const nextTr = rawContent.toLowerCase().indexOf('<tr', trOpenEnd);
          if (nextTr !== -1) {
            trContent = rawContent.slice(trOpenEnd + 1, nextTr);
            trCursor = nextTr;
          } else {
            trContent = rawContent.slice(trOpenEnd + 1);
            trCursor = tableLen;
          }
        }

        const cellText = trContent.replace(/<[^>]+>/g, '  |  ').trim();
        if (cellText) {
          blocks.push({ type: 'paragraph', text: cellText });
        }
      }
    } else {
      const textContent = rawContent.replace(/<[^>]+>/g, '').trim();
      if (textContent) {
        blocks.push({ type: 'paragraph', text: textContent });
      }
    }
  }

  // Fallback: if no supported HTML tags matched, split by newlines
  if (blocks.length === 0) {
    const plain = clean.replace(/<[^>]+>/g, '').trim();
    const lines = plain.split(/\n\s*\n/);
    for (const line of lines) {
      if (line.trim()) {
        blocks.push({ type: 'paragraph', text: line.trim() });
      }
    }
  }

  return blocks;
}
