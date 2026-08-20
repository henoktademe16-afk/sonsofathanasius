import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { selectArticlePdfDataBySlug } from '../pdf/pdfQueries.js';
import { enqueuePdfJob } from '../pdf/pdfJobs.js';
import { BadRequestError, NotFoundError } from '../middleware/errorHandler.js';
import { ValidatedRequest } from '../validators/queryValidator.js';
import { PdfQueryParams, ArticleSlugParams } from '../validators/publicQueryValidator.js';

/**
 * Stream static article PDF if cached, or enqueue generation and respond 202 Accepted
 * GET /api/v1/articles/:slug/pdf?lang={am|en|om|ti}
 */
export async function downloadArticlePdfController(req: Request, res: Response, next: NextFunction) {
  const params = (req as ValidatedRequest<any, ArticleSlugParams>).validatedParams || req.params;
  const query = (req as ValidatedRequest<PdfQueryParams>).validatedQuery || { lang: 'am' };

  const slug = String(params.slug || req.params.slug || '').trim();
  const lang = query.lang || 'am';

  if (!slug) {
    throw new BadRequestError('Article slug is required');
  }

  try {
    // 1. Resolve translation via slug and langCode (published-only with am-fallback)
    const article = await selectArticlePdfDataBySlug(slug, lang);

    if (!article) {
      throw new NotFoundError('Article not found or not published');
    }

    if (!article.pdfEnabled) {
      throw new NotFoundError('PDF export is disabled for this article');
    }

    // 2. Check if static PDF exists on disk
    if (article.pdfFilePath) {
      const savedFileName = path.basename(article.pdfFilePath);
      const savedAbsolutePath = path.join(config.storage.pdfDir, savedFileName);

      if (fs.existsSync(savedAbsolutePath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(`SOA_${article.slug}.pdf`)}"`);
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

        const stream = fs.createReadStream(savedAbsolutePath);
        stream.on('error', (err) => {
          console.error('PDF stream error:', err);
          if (!res.headersSent) {
            next(err);
          }
        });

        return stream.pipe(res);
      }
    }

    // 3. File not ready: enqueue background job and return HTTP 202 Accepted
    void enqueuePdfJob(article.contentId, article.langCode);

    res.set('Retry-After', '5');
    return res.status(202).json({
      success: true,
      data: {
        status: 'generating',
        retryAfter: 5,
        message: 'PDF generation in progress. Please retry in 5 seconds.',
      },
    });
  } catch (err) {
    next(err);
  }
}
