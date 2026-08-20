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
    .text('ደቂቀ አትናቴዎስ', leftMargin, headerTopY, { continued: true })
    .font('AppRegular')
    .fontSize(8)
    .fillColor(textMuted)
    .text('  |  SONS OF ATHANASIUS', { continued: true })
    .fillColor(gold)
    .text(`  •  ${labels.headerSubtitle.replace(/^www\.sonsofathanasius\.com\s*•\s*/, '')}`, { align: 'left' });

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

  const rawDate = data.publishedAt ? new Date(data.publishedAt) : new Date();
  const day = String(rawDate.getDate()).padStart(2, '0');
  const month = String(rawDate.getMonth() + 1).padStart(2, '0');
  const year = rawDate.getFullYear();
  const pubDate = `${day}/${month}/${year}`;

  doc
    .font('AppBold')
    .fontSize(9)
    .fillColor(crimson)
    .text(`${labels.authorLabel}፡ `, leftMargin, metaY, { continued: true })
    .font('AppBold')
    .fontSize(9)
    .fillColor(textDark)
    .text(safeAuthor);

  doc
    .font('AppRegular')
    .fontSize(8.5)
    .fillColor(textMuted)
    .text(`${labels.dateLabel}፡ ${pubDate}`, leftMargin, metaY, {
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

      const quoteHeight = doc.heightOfString(quoteText, {
        width: contentWidth - 28,
        lineGap: 3.5,
      }) + 12;

      doc
        .rect(leftMargin, quoteStartY, contentWidth, quoteHeight)
        .fillAndStroke('#FDFBF7', '#EAE6DF');

      doc
        .rect(leftMargin, quoteStartY, 3, quoteHeight)
        .fill(gold);

      doc
        .font('AppRegular')
        .fontSize(9.5)
        .fillColor('#292524')
        .text(quoteText, leftMargin + 14, quoteStartY + 6, {
          width: contentWidth - 28,
          lineGap: 3.5,
        });

      doc.y = quoteStartY + quoteHeight + 10;
    } else if (block.type === 'list-item') {
      const bullet = block.ordered ? `${block.index}. ` : '• ';
      const itemText = sanitizeForFont(normalizeNfc(block.text), isEthiopic);

      doc
        .font('AppBold')
        .fontSize(10)
        .fillColor(crimson)
        .text(bullet, leftMargin + 8, doc.y, { continued: true })
        .font('AppRegular')
        .fontSize(10)
        .fillColor(textDark)
        .text(itemText, {
          width: contentWidth - 20,
          lineGap: 3,
        });

      doc.moveDown(0.2);
    } else if (block.type === 'pre') {
      doc.moveDown(0.4);
      const preStartY = doc.y;
      const preText = sanitizeForFont(normalizeNfc(block.text), isEthiopic);

      doc
        .font('AppRegular')
        .fontSize(8.5)
        .fillColor('#334155');

      const preHeight = doc.heightOfString(preText, {
        width: contentWidth - 20,
        lineGap: 2,
      }) + 10;

      doc
        .rect(leftMargin, preStartY, contentWidth, preHeight)
        .fill('#F8FAFC');

      doc
        .font('AppRegular')
        .fontSize(8.5)
        .fillColor('#334155')
        .text(preText, leftMargin + 10, preStartY + 5, {
          width: contentWidth - 20,
          lineGap: 2,
        });

      doc.y = preStartY + preHeight + 8;
    } else {
      // Standard Paragraph
      const paragraphText = sanitizeForFont(normalizeNfc(block.text), isEthiopic);
      if (paragraphText) {
        doc
          .font('AppRegular')
          .fontSize(10)
          .fillColor(textDark)
          .text(paragraphText, leftMargin, doc.y, {
            width: contentWidth,
            align: 'justify',
            lineGap: 3.5,
            paragraphGap: 6,
          });
      }
    }
  }

  // ── 6. Classical Ornamental Seal on Last Page ─────────
  doc.moveDown(1.2);
  const sealY = doc.y;
  if (sealY < 720) {
    doc.rect(leftMargin + contentWidth / 2 - 40, sealY, 80, 0.5).fill(gold);
    doc
      .font('AppRegular')
      .fontSize(8)
      .fillColor(crimson)
      .text('❖  ❖  ❖', leftMargin, sealY + 4, {
        width: contentWidth,
        align: 'center',
      });
  }

  // ── 7. Two-Pass Dynamic Header & Footer on Every Page ──
  const range = doc.bufferedPageRange();
  const totalPages = range.count;

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
          width: contentWidth - 100,
          ellipsis: true,
        });

      doc
        .font('AppBold')
        .fontSize(7.5)
        .fillColor(crimson)
        .text('ደቂቀ አትናቴዎስ', rightMargin - 90, 24, {
          align: 'right',
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
        width: contentWidth - 70,
        lineGap: 1.5,
      });

    doc
      .font('AppRegular')
      .fontSize(7.5)
      .fillColor(crimson)
      .text(labels.pageLabel(pageNum, totalPages), rightMargin - 65, footerY, {
        align: 'right',
      });
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
        margins: { top: 44, bottom: 44, left: 48, right: 48 },
        bufferPages: true,
        info: {
          Title: safeTitle,
          Author: safeAuthor,
          Subject: 'Orthodox Christian Apologetics',
          Keywords: 'Orthodox, Apologetics, EOTC, Theology, Patristics',
          Creator: 'ደቂቀ አትናቴዎስ (Sons of Athanasius)',
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
        margins: { top: 44, bottom: 44, left: 48, right: 48 },
        bufferPages: true,
        info: {
          Title: safeTitle,
          Author: safeAuthor,
          Subject: 'Orthodox Christian Apologetics',
          Keywords: 'Orthodox, Apologetics, EOTC, Theology, Patristics',
          Creator: 'ደቂቀ አትናቴዎስ (Sons of Athanasius)',
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
