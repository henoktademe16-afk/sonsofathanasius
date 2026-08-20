import { parentPort } from 'node:worker_threads';
import path from 'path';
import fs from 'fs';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { contentTranslations } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { selectArticlePdfData } from './pdfQueries.js';
import { renderArticlePdfToFile } from './pdfRenderer.js';
import { buildPdfFileName, writePdfAtomic, sweepOldPdfs } from './pdfStorage.js';

if (parentPort) {
  parentPort.on('message', async (msg) => {
    if (!msg) return;

    if (msg.type === 'terminate') {
      process.exit(0);
    }

    const { jobId, contentId, langCode, version } = msg;
    const startTime = Date.now();

    try {
      // 1. Fetch fresh claim-time data
      const rows = await selectArticlePdfData(contentId, langCode);

      if (rows.length === 0 || rows[0].status !== 'published' || !rows[0].pdfEnabled) {
        parentPort?.postMessage({
          jobId,
          version,
          skip: true,
          reason: 'Translation not found, not published, or PDF export disabled',
        });
        return;
      }

      const row = rows[0];
      const fileName = buildPdfFileName(row);
      const absolutePath = path.join(config.storage.pdfDir, fileName);
      const relativePath = `/uploads/pdf/${fileName}`;

      // 2. Render stream to temporary file and atomically rename
      await writePdfAtomic(async (tmpPath) => {
        await renderArticlePdfToFile(row, tmpPath);
      }, absolutePath);

      // 3. Post-render revalidation (Edge case: unpublished or disabled mid-render)
      const freshRows = await selectArticlePdfData(contentId, langCode);
      if (freshRows.length === 0 || freshRows[0].status !== 'published' || !freshRows[0].pdfEnabled) {
        await fs.promises.unlink(absolutePath).catch(() => {});
        parentPort?.postMessage({
          jobId,
          version,
          skip: true,
          reason: 'Translation was unpublished, disabled, or deleted during render',
        });
        return;
      }

      // 4. Update translation record with newly generated PDF path
      const [updateResult] = await db
        .update(contentTranslations)
        .set({
          pdfFilePath: relativePath,
          pdfGeneratedAt: new Date(),
        })
        .where(
          and(
            eq(contentTranslations.contentId, row.contentId),
            eq(contentTranslations.langCode, row.langCode)
          )
        );

      if (updateResult && (updateResult as any).affectedRows === 0) {
        // Translation was deleted mid-render
        await fs.promises.unlink(absolutePath).catch(() => {});
        parentPort?.postMessage({
          jobId,
          version,
          skip: true,
          reason: 'Translation record was deleted mid-render',
        });
        return;
      }

      // 5. Clean up older versioned files for this translation
      await sweepOldPdfs(row.contentId, row.langCode, fileName);

      const durationMs = Date.now() - startTime;

      parentPort?.postMessage({
        jobId,
        version,
        ok: true,
        pdfFilePath: relativePath,
        durationMs,
      });
    } catch (err: any) {
      parentPort?.postMessage({
        jobId,
        version,
        ok: false,
        error: err?.message || 'Unknown render error',
      });
    }
  });
}
