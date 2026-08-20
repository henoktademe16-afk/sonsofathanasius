import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { content, contentTranslations, categories } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { NotFoundError } from '../middleware/errorHandler.js';

export interface ArticlePdfData {
  contentId: number;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  bodySearchable?: string;
  authorName: string | null;
  categoryName: string;
  langCode: string;
  publishedAt: Date | string | null;
  updatedAt?: Date | string | null;
}

// Single-Flight Request Coalescing Map for concurrent PDF generations
const inflightPdfGenerations = new Map<string, Promise<{ filePath: string; fileName: string }>>();

// Ensure Unicode NFC Normalization
export function normalizeNfc(text: string): string {
  if (!text) return '';
  return text.normalize('NFC');
}

export type ContentBlock = 
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list-item'; ordered: boolean; index: number; text: string }
  | { type: 'pre'; text: string };

/**
 * Robust HTML parser converting rich text (paragraphs, headings, blockquotes, lists, tables) into structured PDF blocks
 */
export function parseHtmlToBlocks(html: string): ContentBlock[] {
  if (!html) return [];

  // 1. Replace scripture span tags with clean bracketed citation
  let clean = html.replace(/<span\s+data-ref="([^"]+)"[^>]*>([\s\S]*?)<\/span>/gi, '[$1]');
  
  // 2. Replace break tags with newline
  clean = clean.replace(/<br\s*\/?>/gi, '\n');

  const blocks: ContentBlock[] = [];

  // Match all top-level / block-level HTML tags
  const blockRegex = /<(p|h1|h2|h3|h4|h5|h6|blockquote|ul|ol|pre|table)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(clean)) !== null) {
    const tag = match[1].toLowerCase();
    const rawContent = match[2];

    if (tag === 'ul' || tag === 'ol') {
      const isOrdered = tag === 'ol';
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      let itemIndex = 1;

      while ((liMatch = liRegex.exec(rawContent)) !== null) {
        const textContent = liMatch[1].replace(/<[^>]+>/g, '').trim();
        if (textContent) {
          blocks.push({
            type: 'list-item',
            ordered: isOrdered,
            index: itemIndex++,
            text: textContent,
          });
        }
      }
    } else if (tag.startsWith('h')) {
      const level = parseInt(tag.charAt(1), 10) || 2;
      const textContent = rawContent.replace(/<[^>]+>/g, '').trim();
      if (textContent) {
        blocks.push({ type: 'heading', level, text: textContent });
      }
    } else if (tag === 'blockquote') {
      const textContent = rawContent.replace(/<[^>]+>/g, '').trim();
      if (textContent) {
        blocks.push({ type: 'quote', text: textContent });
      }
    } else if (tag === 'pre') {
      const textContent = rawContent.replace(/<[^>]+>/g, '').trim();
      if (textContent) {
        blocks.push({ type: 'pre', text: textContent });
      }
    } else if (tag === 'table') {
      // Extract cell texts from table rows
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(rawContent)) !== null) {
        const cellText = rowMatch[1].replace(/<[^>]+>/g, '  |  ').trim();
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

  // Fallback: if no standard HTML tags matched, split by newlines
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

interface LocalizedPdfLabels {
  headerTitle: string;
  headerSubtitle: string;
  authorLabel: string;
  dateLabel: string;
  defaultAuthor: string;
  footerQuote: string;
  pageLabel: (current: number, total: number) => string;
}

const LOCALIZED_LABELS: Record<string, LocalizedPdfLabels> = {
  am: {
    headerTitle: 'ደቂቀ አትናቴዎስ  |  SONS OF ATHANASIUS',
    headerSubtitle: 'www.sonsofathanasius.com  •  ክርስቲያናዊ ዕቅበተ እምነት ማሕበር',
    authorLabel: 'ጸሐፊ',
    dateLabel: 'ቀን',
    defaultAuthor: 'ዘአትናቴዎስ',
    footerQuote: '«ኢየሱስ ክርስቶስ ትላንትናም ዛሬም ለዘላለምም ያው ነው» (ዕብራውያን ፲፫:፰)  •  ደቂቀ አትናቴዎስ  •  www.sonsofathanasius.com',
    pageLabel: (current, total) => `ገጽ ${current} / ${total}`,
  },
  ti: {
    headerTitle: 'ደቂቀ አትናቴዎስ  |  SONS OF ATHANASIUS',
    headerSubtitle: 'www.sonsofathanasius.com  •  ክርስቲያናዊ ናይ ዕቅበተ እምነት ማሕበር',
    authorLabel: 'ጸሓፊ',
    dateLabel: 'ዕለት',
    defaultAuthor: 'ዘአትናቴዎስ',
    footerQuote: '«ኢየሱስ ክርስቶስ ትማልን ሎምን ንዘለኣለምን ንሱ እዩ» (ዕብራውያን ፲፫:፰)  •  ደቂቀ አትናቴዎስ  •  www.sonsofathanasius.com',
    pageLabel: (current, total) => `ገጽ ${current} / ${total}`,
  },
  en: {
    headerTitle: 'SONS OF ATHANASIUS',
    headerSubtitle: 'www.sonsofathanasius.com  •  Christian Apologetics',
    authorLabel: 'Author',
    dateLabel: 'Date',
    defaultAuthor: 'Ze-Athanasius',
    footerQuote: '“Jesus Christ is the same yesterday and today and forever.” (Hebrews 13:8)  •  Sons of Athanasius  •  www.sonsofathanasius.com',
    pageLabel: (current, total) => `Page ${current} of ${total}`,
  },
  om: {
    headerTitle: 'ILMAAN ATNAATEWOOS  |  SONS OF ATHANASIUS',
    headerSubtitle: 'www.sonsofathanasius.com  •  Waldaa Ittisa Amantii Kiristaanaa',
    authorLabel: 'Barreessaa',
    dateLabel: 'Guyyaa',
    defaultAuthor: 'Ze-Atnaatewoos',
    footerQuote: '«Yesuus Kiristoos kaleessas, har\'as, bara baraanis akkuma jirutti jiraata.» (Ibroota 13:8)  •  Ilmaan Atnaatewoos  •  www.sonsofathanasius.com',
    pageLabel: (current, total) => `Fuula ${current} / ${total}`,
  },
};

/**
 * Strips unsupported characters when rendering Latin fonts to prevent empty glyph rectangles
 */
function sanitizeForFont(text: string, isEthiopic: boolean, fallback: string = ''): string {
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

/**
 * Generate a high-resolution PDF document using PDFKit with static font registration
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

      const fontsDir = config.storage.fontsDir;

      // Register Fonts
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
          .rect(leftMargin, summaryStartY, 3, summaryHeight)
          .fill(gold);

        doc.text(summaryText, leftMargin + 14, summaryStartY + 7, {
          width: contentWidth - 28,
          lineGap: 3.5,
        });

        doc.y = summaryStartY + summaryHeight + 14;
      }

      // ── 5. Body Blocks ───────────────────────────────────
      const blocks = parseHtmlToBlocks(data.body);

      for (const block of blocks) {
        if (doc.y > 720) {
          doc.addPage();
        }

        if (block.type === 'heading') {
          doc.moveDown(0.5);
          const headingSize = block.level <= 2 ? 12.5 : 11.5;
          doc
            .font('AppHeading')
            .fontSize(headingSize)
            .fillColor(crimson)
            .text(normalizeNfc(block.text), leftMargin, doc.y, {
              width: contentWidth,
              lineGap: 3,
            });
          doc.moveDown(0.35);
        } else if (block.type === 'quote') {
          doc.moveDown(0.4);
          const quoteText = normalizeNfc(block.text);
          const quoteStartY = doc.y;
          const quoteContentHeight = doc.heightOfString(quoteText, {
            width: contentWidth - 32,
            lineGap: 3.5,
          }) + 16;

          doc
            .rect(leftMargin, quoteStartY, contentWidth, quoteContentHeight)
            .fill('#F9F7F2');

          doc
            .rect(leftMargin, quoteStartY, 3, quoteContentHeight)
            .fill(crimson);

          doc
            .font('AppRegular')
            .fontSize(9.5)
            .fillColor('#2C241D')
            .text(quoteText, leftMargin + 16, quoteStartY + 8, {
              width: contentWidth - 32,
              lineGap: 3.5,
            });

          doc.y = quoteStartY + quoteContentHeight + 10;
        } else if (block.type === 'list-item') {
          const prefix = block.ordered ? `${block.index}. ` : '• ';
          doc
            .font('AppBold')
            .fontSize(9.5)
            .fillColor(crimson)
            .text(prefix, leftMargin + 10, doc.y, { continued: true });

          doc
            .font('AppRegular')
            .fontSize(9.5)
            .fillColor(textDark)
            .text(normalizeNfc(block.text), {
              lineGap: 3,
              paragraphGap: 4,
            });
        } else if (block.type === 'pre') {
          doc.moveDown(0.3);
          const preY = doc.y;
          doc.rect(leftMargin, preY, contentWidth, 30).fill('#F4F4F4');
          doc
            .font('AppRegular')
            .fontSize(9)
            .fillColor('#222222')
            .text(normalizeNfc(block.text), leftMargin + 8, preY + 6, { width: contentWidth - 16 });
          doc.y = preY + 36;
          doc.moveDown(0.4);
        } else {
          doc
            .font('AppRegular')
            .fontSize(10)
            .fillColor(textDark)
            .text(normalizeNfc(block.text), leftMargin, doc.y, {
              width: contentWidth,
              align: 'justify',
              lineGap: 4.5,
              paragraphGap: 6,
            });
        }
      }

      // ── 6. Running Header (Pages 2+) & Footer (All Pages) ───
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);

        const oldBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        // Running header for subsequent pages (2+)
        if (i > 0) {
          const runY = 32;
          doc
            .font('AppRegular')
            .fontSize(7.5)
            .fillColor(textMuted)
            .text(labels.headerTitle, leftMargin, runY, { continued: true })
            .text(`  •  ${safeTitle.length > 50 ? safeTitle.slice(0, 50) + '…' : safeTitle}`, {
              align: 'left',
              width: contentWidth - 40,
            });

          doc.rect(leftMargin, runY + 12, contentWidth, 0.5).fill(borderLight);
        }

        // Footer divider & accents
        const footerY = 788;
        doc.rect(leftMargin, footerY, contentWidth, 0.75).fill(borderLight);
        doc.rect(leftMargin, footerY, 40, 1.5).fill(gold);
        doc.rect(rightMargin - 40, footerY, 40, 1.5).fill(crimson);

        // Footer scripture quote
        doc
          .font('AppRegular')
          .fontSize(7.5)
          .fillColor(textMuted)
          .text(
            labels.footerQuote,
            leftMargin,
            footerY + 7,
            { width: contentWidth - 65, lineBreak: false }
          );

        // Page Number
        doc
          .font('AppBold')
          .fontSize(8)
          .fillColor(crimson)
          .text(labels.pageLabel(i + 1, range.count), rightMargin - 60, footerY + 7, {
            align: 'right',
            width: 60,
            lineBreak: false,
          });

        doc.page.margins.bottom = oldBottomMargin;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate and write a static PDF file to disk with atomic write and cache bust timestamp
 */
export async function generateAndSaveArticlePdf(data: ArticlePdfData): Promise<string> {
  const versionTimestamp = data.updatedAt ? new Date(data.updatedAt).getTime() : Date.now();
  const fileName = `article_${data.contentId}_${versionTimestamp}_${data.langCode}.pdf`;
  const relativePath = `/uploads/pdf/${fileName}`;
  const absolutePath = path.join(config.storage.pdfDir, fileName);

  // Ensure pdf directory exists
  if (!fs.existsSync(config.storage.pdfDir)) {
    fs.mkdirSync(config.storage.pdfDir, { recursive: true });
  }

  // Generate buffer
  const buffer = await generateArticlePdf(data);

  // Atomic write: write to temp file then rename
  const tmpPath = `${absolutePath}.tmp.${Date.now()}`;
  await fs.promises.writeFile(tmpPath, buffer);
  await fs.promises.rename(tmpPath, absolutePath);

  // Clean up any existing older static PDFs for this (articleId, langCode) on disk
  try {
    const files = await fs.promises.readdir(config.storage.pdfDir);
    const prefix = `article_${data.contentId}_`;
    const suffix = `_${data.langCode}.pdf`;
    const currentFileName = path.basename(absolutePath);

    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith(suffix) && file !== currentFileName) {
        const oldPath = path.join(config.storage.pdfDir, file);
        await fs.promises.unlink(oldPath).catch(() => {});
      }
    }
  } catch (cleanErr) {
    console.warn(`⚠️ [PDFService] Failed to clean older PDFs for article #${data.contentId} [${data.langCode}]:`, cleanErr);
  }

  // Update translation row in MariaDB
  try {
    await db
      .update(contentTranslations)
      .set({
        pdfFilePath: relativePath,
        pdfGeneratedAt: new Date(),
      })
      .where(
        and(
          eq(contentTranslations.contentId, data.contentId),
          eq(contentTranslations.langCode, data.langCode)
        )
      );
  } catch (dbErr) {
    console.warn(`⚠️ [PDFService] Could not update pdfFilePath for article #${data.contentId} [${data.langCode}]:`, dbErr);
  }

  return relativePath;
}

/**
 * Helper to resolve localized category name
 */
function resolveCategoryName(row: {
  langCode: string;
  categoryNameAm?: string | null;
  categoryNameEn?: string | null;
  categoryNameOm?: string | null;
  categoryNameTi?: string | null;
}): string {
  if (row.langCode === 'en' && row.categoryNameEn) return row.categoryNameEn;
  if (row.langCode === 'om' && row.categoryNameOm) return row.categoryNameOm;
  if (row.langCode === 'ti' && row.categoryNameTi) return row.categoryNameTi;
  return row.categoryNameAm || 'ኦርቶዶክሳዊ ትምህርት';
}

/**
 * Eagerly pre-generate static PDFs for all published, PDF-enabled translations of an article container
 */
export async function eagerGenerateArticlePdfs(contentId: number, force: boolean = false): Promise<void> {
  try {
    const rows = await db
      .select({
        translationId: contentTranslations.id,
        contentId: content.id,
        pdfEnabled: contentTranslations.pdfEnabled,
        status: contentTranslations.status,
        authorName: content.authorName,
        publishedAt: contentTranslations.publishedAt,
        updatedAt: contentTranslations.updatedAt,
        categoryNameAm: categories.nameAm,
        categoryNameEn: categories.nameEn,
        categoryNameOm: categories.nameOm,
        categoryNameTi: categories.nameTi,
        title: contentTranslations.title,
        slug: contentTranslations.slug,
        summary: contentTranslations.summary,
        body: contentTranslations.body,
        langCode: contentTranslations.langCode,
        pdfFilePath: contentTranslations.pdfFilePath,
      })
      .from(content)
      .innerJoin(categories, eq(content.categoryId, categories.id))
      .innerJoin(contentTranslations, eq(contentTranslations.contentId, content.id))
      .where(
        and(
          eq(content.id, contentId),
          eq(contentTranslations.status, 'published'),
          eq(contentTranslations.pdfEnabled, 1)
        )
      );

    if (rows.length === 0) return;

    let generatedCount = 0;

    for (const row of rows) {
      // Skip generation if file already exists on disk and force is false
      if (!force && row.pdfFilePath) {
        const existingDiskPath = path.join(config.storage.pdfDir, path.basename(row.pdfFilePath));
        if (fs.existsSync(existingDiskPath)) {
          continue;
        }
      }

      const categoryName = resolveCategoryName(row);

      await generateAndSaveArticlePdf({
        contentId: row.contentId,
        title: row.title,
        slug: row.slug,
        summary: row.summary,
        body: row.body,
        authorName: row.authorName,
        categoryName,
        langCode: row.langCode,
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
      });

      generatedCount++;
    }

    if (generatedCount > 0) {
      console.log(`📄 [PDFService] Eagerly generated ${generatedCount} multilingual PDFs for article #${contentId}`);
    }
  } catch (err) {
    console.error(`⚠️ [PDFService] Failed to eager-generate PDFs for article #${contentId}:`, err);
  }
}

/**
 * Eagerly pre-generate static PDF for a single translation of an article container
 */
export async function eagerGenerateSingleTranslationPdf(
  contentId: number,
  langCode: string,
  force: boolean = true
): Promise<void> {
  try {
    const rows = await db
      .select({
        translationId: contentTranslations.id,
        contentId: content.id,
        pdfEnabled: contentTranslations.pdfEnabled,
        status: contentTranslations.status,
        authorName: content.authorName,
        publishedAt: contentTranslations.publishedAt,
        updatedAt: contentTranslations.updatedAt,
        categoryNameAm: categories.nameAm,
        categoryNameEn: categories.nameEn,
        categoryNameOm: categories.nameOm,
        categoryNameTi: categories.nameTi,
        title: contentTranslations.title,
        slug: contentTranslations.slug,
        summary: contentTranslations.summary,
        body: contentTranslations.body,
        langCode: contentTranslations.langCode,
        pdfFilePath: contentTranslations.pdfFilePath,
      })
      .from(content)
      .innerJoin(categories, eq(content.categoryId, categories.id))
      .innerJoin(contentTranslations, eq(contentTranslations.contentId, content.id))
      .where(
        and(
          eq(content.id, contentId),
          eq(contentTranslations.langCode, langCode),
          eq(contentTranslations.status, 'published'),
          eq(contentTranslations.pdfEnabled, 1)
        )
      );

    if (rows.length === 0) return;
    const row = rows[0];

    if (!force && row.pdfFilePath) {
      const existingDiskPath = path.join(config.storage.pdfDir, path.basename(row.pdfFilePath));
      if (fs.existsSync(existingDiskPath)) {
        return;
      }
    }

    const categoryName = resolveCategoryName(row);

    await generateAndSaveArticlePdf({
      contentId: row.contentId,
      title: row.title,
      slug: row.slug,
      summary: row.summary,
      body: row.body,
      authorName: row.authorName,
      categoryName,
      langCode: row.langCode,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
    });

    console.log(`📄 [PDFService] Eagerly generated single translation PDF (${langCode}) for article #${contentId}`);
  } catch (err) {
    console.error(`⚠️ [PDFService] Failed to eager-generate PDF for article #${contentId} [${langCode}]:`, err);
  }
}

/**
 * Reconcile / Backfill Missing PDFs for all published, PDF-enabled translations on boot
 */
export async function reconcileMissingPdfs(): Promise<void> {
  try {
    const publishedRows = await db
      .select({
        translationId: contentTranslations.id,
        contentId: content.id,
        langCode: contentTranslations.langCode,
        pdfFilePath: contentTranslations.pdfFilePath,
      })
      .from(contentTranslations)
      .innerJoin(content, eq(contentTranslations.contentId, content.id))
      .where(
        and(
          eq(contentTranslations.status, 'published'),
          eq(contentTranslations.pdfEnabled, 1)
        )
      );

    let backfilledCount = 0;

    for (const row of publishedRows) {
      const isMissingOnDisk =
        !row.pdfFilePath ||
        !fs.existsSync(path.join(config.storage.pdfDir, path.basename(row.pdfFilePath)));

      if (isMissingOnDisk) {
        await eagerGenerateSingleTranslationPdf(row.contentId, row.langCode, false);
        backfilledCount++;
      }
    }

    if (backfilledCount > 0) {
      console.log(`📄 [PDFService] Boot sweep reconciled and backfilled PDFs for ${backfilledCount} translations.`);
    }
  } catch (err) {
    console.error('⚠️ [PDFService] Error in reconcileMissingPdfs sweep:', err);
  }
}

/**
 * Get cached PDF from disk, or generate on-the-fly with single-flight request coalescing
 */
export async function getOrGenerateArticlePdf(
  slug: string,
  langCode: string = 'am'
): Promise<{ filePath: string; fileName: string }> {
  const coalescingKey = `${slug}:${langCode}`;

  // Check if this exact PDF is already currently generating
  const inflight = inflightPdfGenerations.get(coalescingKey);
  if (inflight) {
    return inflight;
  }

  const executionPromise = (async () => {
    // 1. Query article translation by slug and langCode (requires translation status = 'published')
    let rows = await db
      .select({
        translationId: contentTranslations.id,
        contentId: content.id,
        pdfEnabled: contentTranslations.pdfEnabled,
        status: contentTranslations.status,
        authorName: content.authorName,
        publishedAt: contentTranslations.publishedAt,
        updatedAt: contentTranslations.updatedAt,
        categoryNameAm: categories.nameAm,
        categoryNameEn: categories.nameEn,
        categoryNameOm: categories.nameOm,
        categoryNameTi: categories.nameTi,
        title: contentTranslations.title,
        slug: contentTranslations.slug,
        summary: contentTranslations.summary,
        body: contentTranslations.body,
        langCode: contentTranslations.langCode,
        pdfFilePath: contentTranslations.pdfFilePath,
      })
      .from(contentTranslations)
      .innerJoin(content, eq(contentTranslations.contentId, content.id))
      .innerJoin(categories, eq(content.categoryId, categories.id))
      .where(
        and(
          eq(contentTranslations.slug, slug),
          eq(contentTranslations.langCode, langCode),
          eq(contentTranslations.status, 'published')
        )
      );

    // Fallback to published Amharic translation if specific language translation slug not found
    if (rows.length === 0 && langCode !== 'am') {
      rows = await db
        .select({
          translationId: contentTranslations.id,
          contentId: content.id,
          pdfEnabled: contentTranslations.pdfEnabled,
          status: contentTranslations.status,
          authorName: content.authorName,
          publishedAt: contentTranslations.publishedAt,
          updatedAt: contentTranslations.updatedAt,
          categoryNameAm: categories.nameAm,
          categoryNameEn: categories.nameEn,
          categoryNameOm: categories.nameOm,
          categoryNameTi: categories.nameTi,
          title: contentTranslations.title,
          slug: contentTranslations.slug,
          summary: contentTranslations.summary,
          body: contentTranslations.body,
          langCode: contentTranslations.langCode,
          pdfFilePath: contentTranslations.pdfFilePath,
        })
        .from(contentTranslations)
        .innerJoin(content, eq(contentTranslations.contentId, content.id))
        .innerJoin(categories, eq(content.categoryId, categories.id))
        .where(
          and(
            eq(contentTranslations.slug, slug),
            eq(contentTranslations.langCode, 'am'),
            eq(contentTranslations.status, 'published')
          )
        );
    }

    if (rows.length === 0) {
      throw new NotFoundError('Article not found or not published');
    }

    const article = rows[0];

    if (!article.pdfEnabled) {
      throw new NotFoundError('PDF export is disabled for this article');
    }

    // 2. Check if static PDF exists on disk according to DB recorded path
    if (article.pdfFilePath) {
      const savedFileName = path.basename(article.pdfFilePath);
      const savedAbsolutePath = path.join(config.storage.pdfDir, savedFileName);

      if (fs.existsSync(savedAbsolutePath)) {
        return { filePath: savedAbsolutePath, fileName: `SOA_${article.slug}.pdf` };
      }
    }

    // 3. Lazy-on-miss fallback: Generate, atomically write to disk, update DB, and return
    const categoryName = resolveCategoryName(article);

    const relativePath = await generateAndSaveArticlePdf({
      contentId: article.contentId,
      title: article.title,
      slug: article.slug,
      summary: article.summary,
      body: article.body,
      authorName: article.authorName,
      categoryName,
      langCode: article.langCode,
      publishedAt: article.publishedAt,
      updatedAt: article.updatedAt,
    });

    const newAbsolutePath = path.join(config.storage.pdfDir, path.basename(relativePath));
    return { filePath: newAbsolutePath, fileName: `SOA_${article.slug}.pdf` };
  })();

  // Store in single-flight map and ensure cleanup upon resolution or rejection
  inflightPdfGenerations.set(coalescingKey, executionPromise);
  try {
    return await executionPromise;
  } finally {
    inflightPdfGenerations.delete(coalescingKey);
  }
}
