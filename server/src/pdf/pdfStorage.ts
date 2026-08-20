import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config/index.js';

/**
 * Generate versioned PDF filename based on translation updatedAt epoch (Constraint: never Date.now())
 */
export function buildPdfFileName(data: {
  contentId: number;
  updatedAt?: Date | string | null;
  langCode: string;
}): string {
  const versionTimestamp = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
  return `article_${data.contentId}_${versionTimestamp}_${data.langCode}.pdf`;
}

/**
 * Atomic write via random tmp file with guaranteed cleanup in finally block
 */
export async function writePdfAtomic(
  renderFn: (tmpPath: string) => Promise<void>,
  absolutePath: string
): Promise<void> {
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const tmpPath = `${absolutePath}.tmp.${randomSuffix}`;

  try {
    await renderFn(tmpPath);
    await fs.promises.rename(tmpPath, absolutePath);
  } finally {
    // Unlink tmp unconditionally: the renderer's write stream opens
    // asynchronously and may create the file after this finally runs,
    // so a second delayed attempt catches the late async open.
    await fs.promises.unlink(tmpPath).catch(() => {});
    setTimeout(() => fs.promises.unlink(tmpPath).catch(() => {}), 250);
  }
}

/**
 * Clean up older versioned PDFs for a specific translation on disk
 */
export async function sweepOldPdfs(
  contentId: number,
  langCode: string,
  keepFileName?: string
): Promise<void> {
  const pdfDir = config.storage.pdfDir;
  if (!fs.existsSync(pdfDir)) return;

  try {
    const files = await fs.promises.readdir(pdfDir);
    const prefix = `article_${contentId}_`;
    const suffix = `_${langCode}.pdf`;

    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith(suffix) && file !== keepFileName) {
        const oldFilePath = path.join(pdfDir, file);
        await fs.promises.unlink(oldFilePath).catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`⚠️ [PDFStorage] Failed to sweep old PDFs for article #${contentId} [${langCode}]:`, err);
  }
}

/**
 * Sweep orphaned temporary files (*.tmp.*) older than 1 hour
 */
export async function sweepTmpOrphans(maxAgeMs: number = 3600_000): Promise<number> {
  const pdfDir = config.storage.pdfDir;
  if (!fs.existsSync(pdfDir)) return 0;

  let sweptCount = 0;
  const now = Date.now();

  try {
    const files = await fs.promises.readdir(pdfDir);
    for (const file of files) {
      if (file.includes('.tmp.')) {
        const filePath = path.join(pdfDir, file);
        try {
          const stats = await fs.promises.stat(filePath);
          if (now - stats.mtimeMs > maxAgeMs) {
            await fs.promises.unlink(filePath).catch(() => {});
            sweptCount++;
          }
        } catch {
          // File may have been removed concurrently
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ [PDFStorage] Failed to sweep orphaned tmp files:', err);
  }

  return sweptCount;
}
