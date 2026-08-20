import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { config } from '../config/index.js';
import { ArticlePdfData } from './pdfQueries.js';
import { LOCALIZED_LABELS } from './pdfLabels.js';
import { normalizeNfc, sanitizeForFont } from '../utils/text.js';
import { parseHtmlToBlocks } from '../utils/htmlBlocks.js';

/**
 * Register fonts once per PDFDocument instance
 */
export function registerFontsForDoc(doc: typeof PDFDocument.prototype, isEthiopic: boolean): void {
  const fontsDir = config.storage.fontsDir;

  const fontRegularPath = isEthiopic
    ? path.join(fontsDir, 'NotoSerifEthiopic-Regular.ttf')
    : path.join(fontsDir, 'PlusJakartaSans-Regular.ttf');

  const fontBoldPath = isEthiopic
    ? path.join(fontsDir, 'NotoSerifEthiopic-Bold.ttf')
    : path.join(fontsDir, 'PlusJakartaSans-Bold.ttf');

  const fontHeadingPath = isEthiopic
    ? path.join(fontsDir, 'NotoSerifEthiopic-Bold.ttf')
    : path.join(fontsDir, 'Cinzel-Bold.ttf');

  doc.registerFont('AppRegular', fontRegularPath);
  doc.registerFont('AppBold', fontBoldPath);
  doc.registerFont('AppHeading', fontHeadingPath);
}

/**
 * Populate standard layout into an active PDFDocument instance
 */
const MAX_RENDER_CHUNK_LEN = 10_000;

function chunkText(text: string, maxLen: number = MAX_RENDER_CHUNK_LEN): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(' ', maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

export function layoutArticlePdf(doc: typeof PDFDocument.prototype, data: ArticlePdfData): void {
  const isEthiopic = data.langCode === 'am' || data.langCode === 'ti';
  const labels = LOCALIZED_LABELS[data.langCode] || LOCALIZED_LABELS.am;

  registerFontsForDoc(doc, isEthiopic);

  const safeTitle = sanitizeForFont(normalizeNfc(data.title), isEthiopic, data.title);
  const safeAuthor = sanitizeForFont(
    data.authorName ? normalizeNfc(data.authorName) : '',
    isEthiopic,
    labels.defaultAuthor
  );

  // Color Palette
  const crimson = '#7A0C0C';
  const crimsonDark = '#5C0808';
  const gold = '#A37A17';
  const textDark = '#1C1917';
  const textMuted = '#78716C';
  const borderLight = '#E7E5E4';

  const contentWidth = 499.28;
  const leftMargin = 48;
  const rightMargin = 547.28;

  // ── 1. Top Header Masthead ───────────────────────────
  const headerTopY = 36;

  doc
    .font('AppBold')
    .fontSize(8.5)
    .fillColor(crimson)
    .text(labels.headerBrandLeft, leftMargin, headerTopY, {
      continued: labels.headerBrandRight.length > 0,
    });

  if (labels.headerBrandRight.length > 0) {
    doc
      .font('AppRegular')
      .fontSize(8)
      .fillColor(textMuted)
      .text(labels.headerBrandRight, { continued: true });
  }

  doc
    .font('AppRegular')
    .fontSize(8)
    .fillColor(gold)
    .text(`  •  ${labels.headerSubtitle}`, { align: 'left' });

  doc
    .font('AppRegular')
    .fontSize(7.5)
    .fillColor(textMuted)
    .text('www.sonsofathanasius.com', leftMargin, headerTopY, { align: 'right' });

  // Top Rule (Hairline Gold with Crimson left bar)
  const ruleY = headerTopY + 15;
  doc.rect(leftMargin, ruleY, contentWidth, 0.75).fill(borderLight);
  doc.rect(leftMargin, ruleY, 50, 1.5).fill(crimson);
  doc.rect(leftMargin + 50, ruleY, 30, 1.5).fill(gold);

  doc.y = ruleY + 18;

  // ── 2. Article Main Title ────────────────────────────
  doc
    .font('AppHeading')
    .fontSize(19.5)
    .fillColor(crimsonDark)
    .text(safeTitle, leftMargin, doc.y, {
      width: contentWidth,
      lineGap: 4,
    });

  doc.moveDown(0.4);

  // ── 3. Classical Metadata Row ────────────────────────
  const metaY = doc.y;
  const colon = isEthiopic ? '፡ ' : ': ';

  const rawDate = data.publishedAt ? new Date(data.publishedAt) : new Date();
  const day = String(rawDate.getDate()).padStart(2, '0');
  const month = String(rawDate.getMonth() + 1).padStart(2, '0');
  const year = rawDate.getFullYear();
  const pubDate = `${day}/${month}/${year}`;

  doc
    .font('AppBold')
    .fontSize(9)
    .fillColor(crimson)
    .text(`${labels.authorLabel}${colon}`, leftMargin, metaY, { continued: true })
    .font('AppBold')
    .fontSize(9)
    .fillColor(textDark)
    .text(safeAuthor);

  doc
    .font('AppRegular')
    .fontSize(8.5)
    .fillColor(textMuted)
    .text(`${labels.dateLabel}${colon}${pubDate}`, leftMargin, metaY, {
      align: 'right',
      width: contentWidth,
    });

  const metaDividerY = metaY + 18;
  doc.rect(leftMargin, metaDividerY, contentWidth, 0.5).fill('#EDEBE8');

  doc.y = metaDividerY + 14;

  // ── 4. Abstract / Summary Box ────────────────────────
  if (data.summary && data.summary.trim()) {
    const summaryText = sanitizeForFont(normalizeNfc(data.summary.trim()), isEthiopic);
    const summaryStartY = doc.y;

    doc
      .font('AppRegular')
      .fontSize(9.5)
      .fillColor('#3A332C');

    const summaryHeight = doc.heightOfString(summaryText, {
      width: contentWidth - 28,
      lineGap: 3.5,
    }) + 14;

    doc
      .rect(leftMargin, summaryStartY, contentWidth, summaryHeight)
      .fillAndStroke('#FAF8F5', '#EADFC7');

    doc
      .rect(leftMargin, summaryStartY, 3.5, summaryHeight)
      .fill(crimson);

    doc
      .font('AppRegular')
      .fontSize(9.5)
      .fillColor('#3A332C')
      .text(summaryText, leftMargin + 14, summaryStartY + 7, {
        width: contentWidth - 28,
        lineGap: 3.5,
      });

    doc.y = summaryStartY + summaryHeight + 16;
  }

  // ── 5. Parse and Render HTML Content Blocks ───────────
  const rawHtml = data.body || '';
  const blocks = parseHtmlToBlocks(rawHtml);

  for (const block of blocks) {
    if (block.type === 'heading') {
      doc.moveDown(0.6);
      const headingFontSize = block.level === 1 ? 14 : block.level === 2 ? 12.5 : 11;
      const headingText = sanitizeForFont(normalizeNfc(block.text), isEthiopic);

      doc
        .font('AppBold')
        .fontSize(headingFontSize)
        .fillColor(crimson)
        .text(headingText, leftMargin, doc.y, {
          width: contentWidth,
          lineGap: 3,
        });

      const underlineY = doc.y + 2;
      doc.rect(leftMargin, underlineY, 28, 1).fill(gold);
      doc.y = underlineY + 8;
    } else if (block.type === 'quote') {
      doc.moveDown(0.4);
      const quoteStartY = doc.y;
      const quoteText = sanitizeForFont(normalizeNfc(block.text), isEthiopic);

      doc
        .font('AppRegular')
        .fontSize(9.5)
        .fillColor('#292524');

      const quoteChunks = chunkText(quoteText);
      const quoteHeight = quoteChunks.reduce(
        (h, c) => h + doc.heightOfString(c, { width: contentWidth - 28, lineGap: 3.5 }),
        0,
      ) + 12;

      doc
        .rect(leftMargin, quoteStartY, contentWidth, quoteHeight)
        .fillAndStroke('#FDFBF7', '#EAE6DF');

      doc
        .rect(leftMargin, quoteStartY, 3, quoteHeight)
        .fill(gold);

      let quoteY = quoteStartY + 6;
      for (const chunk of quoteChunks) {
        doc
          .font('AppRegular')
          .fontSize(9.5)
          .fillColor('#292524')
          .text(chunk, leftMargin + 14, quoteY, {
            width: contentWidth - 28,
            lineGap: 3.5,
          });
        quoteY += doc.heightOfString(chunk, { width: contentWidth - 28, lineGap: 3.5 });
      }

      doc.y = quoteStartY + quoteHeight + 10;
    } else if (block.type === 'list-item') {
      const bullet = block.ordered ? `${block.index}. ` : '• ';
      const itemText = sanitizeForFont(normalizeNfc(block.text), isEthiopic);

      const itemChunks = chunkText(itemText);
      doc
        .font('AppBold')
        .fontSize(10)
        .fillColor(crimson)
        .text(bullet, leftMargin + 8, doc.y, { continued: true });
      for (let ci = 0; ci < itemChunks.length; ci++) {
        doc
          .font('AppRegular')
          .fontSize(10)
          .fillColor(textDark)
          .text(itemChunks[ci], leftMargin + 18, ci === 0 ? doc.y : undefined, {
            width: contentWidth - 20,
            align: 'justify',
            lineGap: 3,
          });
      }
      doc.moveDown(0.2);
    } else if (block.type === 'pre') {
      doc.moveDown(0.4);
      const preStartY = doc.y;
      const preText = sanitizeForFont(normalizeNfc(block.text), isEthiopic);

      doc
        .font('AppRegular')
        .fontSize(8.5)
        .fillColor('#334155');

      const preChunks = chunkText(preText);
      const preHeight = preChunks.reduce(
        (h, c) => h + doc.heightOfString(c, { width: contentWidth - 20, lineGap: 2 }),
        0,
      ) + 10;

      doc
        .rect(leftMargin, preStartY, contentWidth, preHeight)
        .fill('#F8FAFC');

      let preY = preStartY + 5;
      for (const chunk of preChunks) {
        doc
          .font('AppRegular')
          .fontSize(8.5)
          .fillColor('#334155')
          .text(chunk, leftMargin + 10, preY, {
            width: contentWidth - 20,
            lineGap: 2,
          });
        preY += doc.heightOfString(chunk, { width: contentWidth - 20, lineGap: 2 });
      }

      doc.y = preStartY + preHeight + 8;
    } else {
      // Standard Paragraph
      const paragraphText = sanitizeForFont(normalizeNfc(block.text), isEthiopic);
      if (paragraphText) {
        const paragraphChunks = chunkText(paragraphText);
        for (let ci = 0; ci < paragraphChunks.length; ci++) {
          doc
            .font('AppRegular')
            .fontSize(10)
            .fillColor(textDark)
            .text(paragraphChunks[ci], leftMargin, doc.y, {
              width: contentWidth,
              align: 'justify',
              lineGap: 3.5,
              paragraphGap: ci === paragraphChunks.length - 1 ? 6 : 0,
            });
        }
      }
    }
  }

  // ── 6. Classical Ornamental Divider on Last Page ──────
  doc.moveDown(1.2);
  const sealY = doc.y;
  if (sealY < 720) {
    const dividerWidth = 80;
    const dividerX = leftMargin + (contentWidth - dividerWidth) / 2;
    doc.rect(dividerX, sealY, dividerWidth, 0.5).fill(gold);
    doc
      .font('AppRegular')
      .fontSize(8)
      .fillColor(crimson)
      .text('•   •   •', leftMargin, sealY + 4, {
        width: contentWidth,
        align: 'center',
      });
  }

  // ── 7. Two-Pass Dynamic Header & Footer on Every Page ──
  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  // CRITICAL: Disable bottom margin during header/footer drawing
  // so PDFKit never triggers an automatic page-break when drawing footer text
  const savedBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  try {
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      const pageNum = i + 1;

      // Running Header on subsequent pages
      if (pageNum > 1) {
        doc
          .font('AppRegular')
          .fontSize(7.5)
          .fillColor(textMuted)
          .text(safeTitle, leftMargin, 24, {
            width: contentWidth - 120,
            ellipsis: true,
            lineBreak: false,
          });

        doc
          .font('AppBold')
          .fontSize(7.5)
          .fillColor(crimson)
          .text(labels.runningHeaderBrand, rightMargin - 110, 24, {
            width: 110,
            align: 'right',
            lineBreak: false,
          });

        doc.rect(leftMargin, 34, contentWidth, 0.5).fill(borderLight);
      }

      // Running Footer on every page
      const footerY = 800;
      doc.rect(leftMargin, footerY - 10, contentWidth, 0.5).fill(borderLight);
      doc.rect(leftMargin, footerY - 10, 30, 1).fill(gold);

      doc
        .font('AppRegular')
        .fontSize(7.5)
        .fillColor(textMuted)
        .text(labels.footerQuote, leftMargin, footerY, {
          width: contentWidth - 75,
          lineGap: 1.5,
          lineBreak: false,
          ellipsis: true,
        });

      doc
        .font('AppRegular')
        .fontSize(7.5)
        .fillColor(crimson)
        .text(labels.pageLabel(pageNum, totalPages), rightMargin - 70, footerY, {
          width: 70,
          align: 'right',
          lineBreak: false,
        });
    }
  } finally {
    doc.page.margins.bottom = savedBottomMargin;
  }
}

/**
 * Stream-based PDF render writing directly to file (halves peak RAM usage vs Buffer.concat)
 */
export function renderArticlePdfToFile(data: ArticlePdfData, targetFilePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const isEthiopic = data.langCode === 'am' || data.langCode === 'ti';
      const labels = LOCALIZED_LABELS[data.langCode] || LOCALIZED_LABELS.am;

      const safeTitle = sanitizeForFont(normalizeNfc(data.title), isEthiopic, data.title);
      const safeAuthor = sanitizeForFont(
        data.authorName ? normalizeNfc(data.authorName) : '',
        isEthiopic,
        labels.defaultAuthor
      );

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 44, bottom: 58, left: 48, right: 48 },
        bufferPages: true,
        info: {
          Title: safeTitle,
          Author: safeAuthor,
          Subject: 'Orthodox Christian Apologetics',
          Keywords: 'Orthodox, Apologetics, EOTC, Theology, Patristics',
          Creator: isEthiopic ? 'ደቂቀ አትናቴዎስ (Sons of Athanasius)' : 'Sons of Athanasius',
        },
      });

      const writeStream = fs.createWriteStream(targetFilePath);
      doc.pipe(writeStream);

      writeStream.on('finish', () => resolve());
      writeStream.on('error', (err) => reject(err));
      doc.on('error', (err) => reject(err));

      layoutArticlePdf(doc, data);
      doc.end();
    } catch (err) {
      // The write stream opens asynchronously (lazy fs open) and can still
      // create the tmp file after this rejection — remove it late.
      setTimeout(() => fs.promises.unlink(targetFilePath).catch(() => {}), 250);
      reject(err);
    }
  });
}

/**
 * In-memory Buffer PDF render (pure: data in, Buffer out)
 */
export function generateArticlePdf(data: ArticlePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const isEthiopic = data.langCode === 'am' || data.langCode === 'ti';
      const labels = LOCALIZED_LABELS[data.langCode] || LOCALIZED_LABELS.am;

      const safeTitle = sanitizeForFont(normalizeNfc(data.title), isEthiopic, data.title);
      const safeAuthor = sanitizeForFont(
        data.authorName ? normalizeNfc(data.authorName) : '',
        isEthiopic,
        labels.defaultAuthor
      );

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 44, bottom: 58, left: 48, right: 48 },
        bufferPages: true,
        info: {
          Title: safeTitle,
          Author: safeAuthor,
          Subject: 'Orthodox Christian Apologetics',
          Keywords: 'Orthodox, Apologetics, EOTC, Theology, Patristics',
          Creator: isEthiopic ? 'ደቂቀ አትናቴዎስ (Sons of Athanasius)' : 'Sons of Athanasius',
        },
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      layoutArticlePdf(doc, data);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
