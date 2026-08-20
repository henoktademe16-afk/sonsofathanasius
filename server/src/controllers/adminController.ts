import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { db } from '../db/index.js';
import { content, contentTranslations, contentMedia, contentTags, categories, tags } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { sendSuccess } from '../utils/response.js';
import { BadRequestError, NotFoundError } from '../middleware/errorHandler.js';
import { processArticleContent } from '../services/sanitizerService.js';
import { generateSlug } from '../utils/slug.js';
import { config } from '../config/index.js';
import {
  invalidateArticleCaches,
  invalidateCategoryCaches,
  invalidateTagCaches,
  invalidateAllCaches,
} from '../cache/invalidation.js';
import { refreshSearchIndex } from '../services/searchService.js';
import { enqueuePdfJob, cancelJob, cancelJobsForArticle, listJobs, retryJob } from '../pdf/pdfJobs.js';
import { sweepOldPdfs } from '../pdf/pdfStorage.js';

// ==========================================
// ZOD VALIDATION SCHEMAS
// ==========================================

export const CreateTranslationSchema = z.object({
  langCode: z.enum(['am', 'en', 'om', 'ti'], {
    error: 'Language code must be one of: am, en, om, ti',
  }),
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(255),
  slug: z.string().trim().max(240).optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  body: z.string().trim().min(10, 'Article body must be at least 10 characters').max(500_000, 'Article body cannot exceed 500KB'),
  status: z.enum(['draft', 'published', 'archived']).default('draft').optional(),
  pdfEnabled: z
    .union([z.boolean(), z.number()])
    .transform((val) => (val ? 1 : 0))
    .default(0)
    .optional(),
  publishedAt: z
    .union([
      z.string().refine((val) => !isNaN(Date.parse(val)), {
        error: 'publishedAt must be a valid ISO date string',
      }),
      z.date(),
    ])
    .nullable()
    .optional(),
});

export const UpdateTranslationSchema = CreateTranslationSchema.partial().extend({
  langCode: z.enum(['am', 'en', 'om', 'ti']),
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(255),
  body: z.string().trim().min(10, 'Article body must be at least 10 characters').max(500_000, 'Article body cannot exceed 500KB'),
});

export const CreateArticleSchema = z.object({
  categoryId: z.number({ error: 'Category ID is required and must be an integer' }).int().positive(),
  authorName: z.string().trim().max(150).nullable().optional(),
  coverImage: z.string().trim().max(500).nullable().optional(),
  translations: z
    .array(CreateTranslationSchema)
    .min(1, 'At least one language translation is required')
    .refine((translations) => {
      const codes = translations.map((t) => t.langCode);
      return new Set(codes).size === codes.length;
    }, 'Duplicate language translations in payload'),
  tagIds: z.array(z.number().int().positive()).optional(),
});

export const UpdateArticleSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  authorName: z.string().trim().max(150).nullable().optional(),
  coverImage: z.string().trim().max(500).nullable().optional(),
  translations: z
    .array(UpdateTranslationSchema)
    .optional()
    .refine((translations) => {
      if (!translations) return true;
      const codes = translations.map((t) => t.langCode);
      return new Set(codes).size === codes.length;
    }, 'Duplicate language translations in payload'),
  tagIds: z.array(z.number().int().positive()).optional(),
});

export const UpsertTranslationSchema = CreateTranslationSchema.extend({
  body: z.string().trim().min(10, 'Article body must be at least 10 characters').max(500_000, 'Article body cannot exceed 500KB'),
});

// ==========================================
// DEADLOCK RESILIENCE HELPER
// ==========================================

async function runWithTransactionRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;
      const isDeadlock =
        error?.code === 'ER_LOCK_DEADLOCK' ||
        error?.errno === 1213 ||
        (error instanceof DrizzleQueryError && error.message.includes('Deadlock found'));

      if (isDeadlock && attempt < maxRetries) {
        const backoffMs = Math.min(50 * Math.pow(2, attempt), 500) + Math.floor(Math.random() * 50);
        console.warn(`⚠️ [DB] Deadlock detected during admin mutation. Retrying (attempt ${attempt}/${maxRetries}) in ${backoffMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Transaction failed after maximum retry attempts');
}

// ==========================================
// HELPER: UPSERT TRANSLATION TRANSACTION
// ==========================================

export async function upsertTranslationTx(
  tx: any,
  contentId: number,
  input: z.infer<typeof CreateTranslationSchema> | z.infer<typeof UpdateTranslationSchema>
) {
  const processed = processArticleContent(input.body);

  const existingRows = await tx
    .select()
    .from(contentTranslations)
    .where(
      and(
        eq(contentTranslations.contentId, contentId),
        eq(contentTranslations.langCode, input.langCode)
      )
    )
    .limit(1);

  const isUpdate = existingRows.length > 0;
  let slug: string;
  let targetStatus: 'draft' | 'published' | 'archived';
  let targetPdfEnabled: number;
  let targetPublishedAt: Date | null;
  let translationId: number;

  if (isUpdate) {
    const existing = existingRows[0];
    translationId = existing.id;

    if (input.slug && input.slug.trim() && input.slug.trim() !== existing.slug) {
      slug = generateSlug(input.slug).slice(0, 240);
      const existingOtherSlug = await tx
        .select({ id: contentTranslations.id, contentId: contentTranslations.contentId })
        .from(contentTranslations)
        .where(and(eq(contentTranslations.slug, slug), eq(contentTranslations.langCode, input.langCode)))
        .limit(1);

      if (existingOtherSlug.length > 0 && existingOtherSlug[0].contentId !== contentId) {
        slug = `${slug.slice(0, 230)}-${contentId}`;
      }
    } else {
      slug = existing.slug;
    }

    targetStatus = input.status ?? existing.status;
    targetPdfEnabled = input.pdfEnabled !== undefined ? input.pdfEnabled : existing.pdfEnabled;

    // Resolve publishedAt
    if (targetStatus === 'published') {
      if (input.publishedAt) {
        targetPublishedAt = new Date(input.publishedAt);
      } else if (existing.publishedAt) {
        targetPublishedAt = existing.publishedAt;
      } else {
        targetPublishedAt = new Date();
      }
    } else if (input.publishedAt !== undefined) {
      targetPublishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
    } else {
      targetPublishedAt = existing.publishedAt;
    }

    await tx
      .update(contentTranslations)
      .set({
        title: input.title,
        slug,
        summary: input.summary || null,
        body: processed.sanitizedHtml,
        bodySearchable: processed.bodySearchable,
        status: targetStatus,
        pdfEnabled: targetPdfEnabled,
        publishedAt: targetPublishedAt,
        pdfFilePath: null,
        pdfGeneratedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(contentTranslations.id, translationId));
  } else {
    slug = generateSlug(input.slug || input.title).slice(0, 240);
    const existingOtherSlug = await tx
      .select({ id: contentTranslations.id, contentId: contentTranslations.contentId })
      .from(contentTranslations)
      .where(and(eq(contentTranslations.slug, slug), eq(contentTranslations.langCode, input.langCode)))
      .limit(1);

    if (existingOtherSlug.length > 0 && existingOtherSlug[0].contentId !== contentId) {
      slug = `${slug.slice(0, 230)}-${contentId}`;
    }

    targetStatus = input.status || 'draft';
    targetPdfEnabled = input.pdfEnabled ?? 0;

    if (targetStatus === 'published') {
      targetPublishedAt = input.publishedAt ? new Date(input.publishedAt) : new Date();
    } else if (input.publishedAt) {
      targetPublishedAt = new Date(input.publishedAt);
    } else {
      targetPublishedAt = null;
    }

    const [insertRes] = await tx.insert(contentTranslations).values({
      contentId,
      langCode: input.langCode,
      title: input.title,
      slug,
      summary: input.summary || null,
      body: processed.sanitizedHtml,
      bodySearchable: processed.bodySearchable,
      status: targetStatus,
      pdfEnabled: targetPdfEnabled,
      publishedAt: targetPublishedAt,
      viewCount: 0,
      pdfFilePath: null,
      pdfGeneratedAt: null,
    });
    translationId = insertRes.insertId;
  }

  return {
    id: translationId,
    contentId,
    langCode: input.langCode,
    title: input.title,
    slug,
    summary: input.summary || null,
    status: targetStatus,
    pdfEnabled: targetPdfEnabled,
    publishedAt: targetPublishedAt,
    isUpdate,
  };
}

// ==========================================
// CONTROLLERS
// ==========================================

/**
 * POST /api/v1/admin/articles
 * Atomic creation of master article container, translations, media, and tag associations.
 */
export async function createArticleController(req: Request, res: Response): Promise<void> {
  const parseResult = CreateArticleSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new BadRequestError(errorMsg || 'Invalid article payload');
  }

  const data = parseResult.data;

  // 1. Verify Category Exists
  const categoryRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, data.categoryId))
    .limit(1);

  if (categoryRows.length === 0) {
    throw new BadRequestError(`Category with ID ${data.categoryId} does not exist`);
  }

  // 2. Validate Tag IDs
  if (data.tagIds && data.tagIds.length > 0) {
    const validTags = await db
      .select({ id: tags.id })
      .from(tags)
      .where(inArray(tags.id, data.tagIds));

    if (validTags.length !== data.tagIds.length) {
      throw new BadRequestError('One or more specified tag IDs do not exist');
    }
  }

  // 3. Process Cover Image
  let finalCoverImage = data.coverImage || null;
  if (req.file) {
    finalCoverImage = `/uploads/covers/${req.file.filename}`;
  }

  // 4. Atomic Database Transaction with Deadlock Retries
  const transactionResult = await runWithTransactionRetry(() =>
    db.transaction(async (tx) => {
      // 4a. Create Parent Container Row
      const [insertContentResult] = await tx.insert(content).values({
        categoryId: data.categoryId,
        authorName: data.authorName || null,
        coverImage: finalCoverImage,
      });

      const contentId = insertContentResult.insertId;

      // 4b. Insert Translations
      const insertedTranslations = [];
      for (const tInput of data.translations) {
        const transRes = await upsertTranslationTx(tx, contentId, tInput);
        insertedTranslations.push(transRes);
      }

      // 4c. Associate Tags
      if (data.tagIds && data.tagIds.length > 0) {
        for (const tagId of data.tagIds) {
          await tx.insert(contentTags).values({
            contentId,
            tagId,
          });
        }
      }

      return {
        contentId,
        translations: insertedTranslations,
      };
    })
  );

  // 5. Post-Transaction Side Effects
  invalidateArticleCaches();
  invalidateCategoryCaches();
  invalidateTagCaches();
  void refreshSearchIndex();

  // Enqueue background PDF generation for each published & PDF-enabled translation
  for (const t of transactionResult.translations) {
    if (t.status === 'published' && t.pdfEnabled) {
      await enqueuePdfJob(transactionResult.contentId, t.langCode);
    }
  }

  sendSuccess(
    res,
    {
      id: transactionResult.contentId,
      categoryId: data.categoryId,
      authorName: data.authorName || null,
      coverImage: data.coverImage || null,
      translations: transactionResult.translations,
    },
    undefined,
    201
  );
}

/**
 * PUT /api/v1/admin/articles/:id
 * Update article container metadata, tags, media, and translations.
 * Preserves omitted fields.
 * Sweeps orphaned translation PDFs and replaced cover images from disk.
 */
export async function updateArticleController(req: Request, res: Response): Promise<void> {
  const articleId = Number(req.params.id);
  if (!articleId || isNaN(articleId) || articleId <= 0) {
    throw new BadRequestError('Invalid or missing article ID in request parameters');
  }

  const parseResult = UpdateArticleSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new BadRequestError(errorMsg || 'Invalid article payload');
  }

  const data = parseResult.data;

  // 1. Verify Category Exists if provided
  if (data.categoryId) {
    const categoryRows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, data.categoryId))
      .limit(1);

    if (categoryRows.length === 0) {
      throw new BadRequestError(`Category with ID ${data.categoryId} does not exist`);
    }
  }

  // 2. Validate Tag IDs if provided
  if (data.tagIds && data.tagIds.length > 0) {
    const validTags = await db
      .select({ id: tags.id })
      .from(tags)
      .where(inArray(tags.id, data.tagIds));

    if (validTags.length !== data.tagIds.length) {
      throw new BadRequestError('One or more specified tag IDs do not exist');
    }
  }

  // 3. Process Cover Image
  let newCoverImage: string | undefined | null = data.coverImage;
  if (req.file) {
    newCoverImage = `/uploads/covers/${req.file.filename}`;
  }

  // 4. Atomic Database Transaction with Deadlock Retries
  const transactionResult = await runWithTransactionRetry(() =>
    db.transaction(async (tx) => {
      // 4a. Verify Parent Exists
      const existingContentRows = await tx
        .select()
        .from(content)
        .where(eq(content.id, articleId))
        .limit(1);

      if (existingContentRows.length === 0) {
        throw new NotFoundError(`Article #${articleId} not found`);
      }

      const existingContent = existingContentRows[0];
      const targetCategoryId = data.categoryId ?? existingContent.categoryId;
      const targetAuthorName = data.authorName !== undefined ? data.authorName : existingContent.authorName;
      const targetCoverImage = newCoverImage !== undefined ? newCoverImage : existingContent.coverImage;

      let oldCoverToUnlink: string | null = null;
      if (newCoverImage && existingContent.coverImage && newCoverImage !== existingContent.coverImage) {
        oldCoverToUnlink = existingContent.coverImage;
      }

      // Update parent container fields
      await tx
        .update(content)
        .set({
          categoryId: targetCategoryId,
          authorName: targetAuthorName,
          coverImage: targetCoverImage,
        })
        .where(eq(content.id, articleId));

      // 4b. Sync Tags if provided
      if (data.tagIds !== undefined) {
        await tx.delete(contentTags).where(eq(contentTags.contentId, articleId));
        if (data.tagIds.length > 0) {
          for (const tagId of data.tagIds) {
            await tx.insert(contentTags).values({
              contentId: articleId,
              tagId,
            });
          }
        }
      }

      // 4d. Sync / Upsert Translations
      const updatedTranslations = [];
      const deletedTranslationLangs: string[] = [];

      if (data.translations && data.translations.length > 0) {
        const payloadLangs = new Set(data.translations.map((t) => t.langCode));
        const currentTranslations = await tx
          .select({ id: contentTranslations.id, langCode: contentTranslations.langCode })
          .from(contentTranslations)
          .where(eq(contentTranslations.contentId, articleId));

        for (const existingTrans of currentTranslations) {
          if (!payloadLangs.has(existingTrans.langCode as any)) {
            await tx.delete(contentTranslations).where(eq(contentTranslations.id, existingTrans.id));
            deletedTranslationLangs.push(existingTrans.langCode);
          }
        }

        for (const tInput of data.translations) {
          const transRes = await upsertTranslationTx(tx, articleId, tInput);
          updatedTranslations.push(transRes);
        }
      } else {
        const currentTranslations = await tx
          .select()
          .from(contentTranslations)
          .where(eq(contentTranslations.contentId, articleId));

        updatedTranslations.push(...currentTranslations.map((t) => ({
          id: t.id,
          contentId: t.contentId,
          langCode: t.langCode,
          title: t.title,
          slug: t.slug,
          summary: t.summary,
          status: t.status,
          pdfEnabled: t.pdfEnabled,
          publishedAt: t.publishedAt,
          isUpdate: true,
        })));
      }

      return {
        contentId: articleId,
        categoryId: targetCategoryId,
        authorName: targetAuthorName,
        coverImage: targetCoverImage,
        translations: updatedTranslations,
        deletedTranslationLangs,
        oldCoverToUnlink,
      };
    })
  );

  // 5. Post-Transaction Side Effects
  // 5a. Clean up orphaned static PDFs of deleted translation languages and cancel queue jobs
  if (transactionResult.deletedTranslationLangs.length > 0) {
    for (const lang of transactionResult.deletedTranslationLangs) {
      await cancelJob(articleId, lang);
      await sweepOldPdfs(articleId, lang);
    }
  }

  // 5b. Clean up previous cover image file if replaced with a new upload
  if (transactionResult.oldCoverToUnlink) {
    try {
      const baseCoverName = path.basename(transactionResult.oldCoverToUnlink);
      if (baseCoverName.startsWith('cover_')) {
        const coverAbsPath = path.join(config.storage.coversDir, baseCoverName);
        await fs.promises.unlink(coverAbsPath).catch(() => {});
      }
    } catch {
      // Ignore cover deletion error
    }
  }

  // 5c. Evict caches
  invalidateArticleCaches();
  invalidateCategoryCaches();
  invalidateTagCaches();
  void refreshSearchIndex();

  // 5d. Handle PDF status transitions and queue enqueues
  for (const t of transactionResult.translations) {
    if (t.status === 'published' && t.pdfEnabled) {
      await enqueuePdfJob(articleId, t.langCode);
    } else {
      // Status left 'published' or pdfEnabled dropped to 0
      await cancelJob(articleId, t.langCode);
      await sweepOldPdfs(articleId, t.langCode);
    }
  }

  sendSuccess(
    res,
    {
      id: transactionResult.contentId,
      categoryId: transactionResult.categoryId,
      authorName: transactionResult.authorName,
      coverImage: transactionResult.coverImage,
      translations: transactionResult.translations,
    },
    undefined,
    200
  );
}

/**
 * DELETE /api/v1/admin/articles/:id
 * Delete article container and cascade delete translations, media, and tags in DB.
 * Deletes all static translation PDFs and cover image from disk and evicts caches.
 */
export async function deleteArticleController(req: Request, res: Response): Promise<void> {
  const articleId = Number(req.params.id);
  if (!articleId || isNaN(articleId) || articleId <= 0) {
    throw new BadRequestError('Invalid or missing article ID in request parameters');
  }

  let deletedCoverImage: string | null = null;

  // 1. Atomic Database Deletion
  await runWithTransactionRetry(() =>
    db.transaction(async (tx) => {
      const parentRows = await tx
        .select({ id: content.id, coverImage: content.coverImage })
        .from(content)
        .where(eq(content.id, articleId))
        .limit(1);

      if (parentRows.length === 0) {
        throw new NotFoundError(`Article #${articleId} not found`);
      }

      deletedCoverImage = parentRows[0].coverImage;

      // Delete master container row (cascades content_translations, content_media, content_tags via DB FKs)
      await tx.delete(content).where(eq(content.id, articleId));
    })
  );

  // 2. Post-Transaction Side Effects
  // 2a. Cancel all queued/processing PDF jobs for this article
  await cancelJobsForArticle(articleId);

  // 2b. Delete all static PDFs for this article on disk (all languages)
  try {
    const files = await fs.promises.readdir(config.storage.pdfDir);
    const prefix = `article_${articleId}_`;
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.pdf')) {
        await fs.promises.unlink(path.join(config.storage.pdfDir, file)).catch(() => {});
      }
    }
  } catch (pdfErr) {
    console.warn(`⚠️ [PDFStorage] Error sweeping PDFs for deleted article #${articleId}:`, pdfErr);
  }

  // 2c. Clean up uploaded cover image if self-hosted
  if (deletedCoverImage) {
    try {
      const baseCoverName = path.basename(deletedCoverImage);
      if (baseCoverName.startsWith('cover_')) {
        const coverAbsPath = path.join(config.storage.coversDir, baseCoverName);
        await fs.promises.unlink(coverAbsPath).catch(() => {});
      }
    } catch {
      // Ignore cover deletion error
    }
  }

  // 2d. Evict all caches across all namespaces
  invalidateAllCaches();

  // 2e. Refresh search engine index
  void refreshSearchIndex();

  sendSuccess(res, { deleted: true, id: articleId }, undefined, 200);
}

/**
 * POST /api/v1/admin/articles/:id/translations
 * Add or update a translation for an existing article container.
 */
export async function upsertTranslationController(req: Request, res: Response): Promise<void> {
  const articleId = Number(req.params.id);
  if (!articleId || isNaN(articleId) || articleId <= 0) {
    throw new BadRequestError('Invalid or missing article ID in request parameters');
  }

  const parseResult = UpsertTranslationSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new BadRequestError(errorMsg || 'Invalid translation payload');
  }

  const data = parseResult.data;

  // Atomic Database Transaction
  const result = await runWithTransactionRetry(() =>
    db.transaction(async (tx) => {
      // 1. Verify parent article container exists
      const parentRows = await tx.select().from(content).where(eq(content.id, articleId)).limit(1);
      if (parentRows.length === 0) {
        throw new NotFoundError(`Article #${articleId} not found`);
      }
      const parent = parentRows[0];

      // 2. Upsert translation
      const translationResult = await upsertTranslationTx(tx, articleId, data);

      return {
        parent,
        translation: translationResult,
      };
    })
  );

  // Post-Transaction Side Effects
  invalidateArticleCaches();
  void refreshSearchIndex();

  // Handle PDF queue enqueue vs cancel/sweep
  if (result.translation.status === 'published' && result.translation.pdfEnabled) {
    await enqueuePdfJob(articleId, result.translation.langCode);
  } else {
    await cancelJob(articleId, result.translation.langCode);
    await sweepOldPdfs(articleId, result.translation.langCode);
  }

  sendSuccess(res, result.translation, undefined, result.translation.isUpdate ? 200 : 201);
}

/**
 * DELETE /api/v1/admin/articles/:id/translations/:langCode
 * Delete a specific language translation row, sweep its static PDFs from disk, cancel pending jobs, and evict caches.
 */
export async function deleteTranslationController(req: Request, res: Response): Promise<void> {
  const articleId = Number(req.params.id);
  const langCode = req.params.langCode as 'am' | 'en' | 'om' | 'ti';

  if (!articleId || isNaN(articleId) || articleId <= 0) {
    throw new BadRequestError('Invalid or missing article ID in request parameters');
  }

  if (!['am', 'en', 'om', 'ti'].includes(langCode)) {
    throw new BadRequestError(`Invalid language code '${langCode}'. Must be one of: am, en, om, ti`);
  }

  // 1. Atomic Database Deletion
  await runWithTransactionRetry(() =>
    db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: contentTranslations.id })
        .from(contentTranslations)
        .where(
          and(
            eq(contentTranslations.contentId, articleId),
            eq(contentTranslations.langCode, langCode)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError(`Translation '${langCode}' for article #${articleId} not found`);
      }

      await tx.delete(contentTranslations).where(eq(contentTranslations.id, existing[0].id));
    })
  );

  // 2. Post-Transaction Side Effects
  // 2a. Cancel any pending queue job
  await cancelJob(articleId, langCode);

  // 2b. Delete static PDFs for this translation on disk
  await sweepOldPdfs(articleId, langCode);

  // 2c. Evict caches
  invalidateArticleCaches();
  void refreshSearchIndex();

  sendSuccess(res, { deleted: true, contentId: articleId, langCode }, undefined, 200);
}

/**
 * GET /api/v1/admin/pdf-jobs
 * List recent background PDF generation jobs with status and error details
 */
export async function listPdfJobsController(req: Request, res: Response): Promise<void> {
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  const status = req.query.status ? String(req.query.status) : undefined;

  const jobs = await listJobs(limit, status);
  sendSuccess(res, jobs, undefined, 200);
}

/**
 * POST /api/v1/admin/pdf-jobs/:id/retry
 * Requeue a failed PDF job
 */
export async function retryPdfJobController(req: Request, res: Response): Promise<void> {
  const jobId = Number(req.params.id);
  if (!jobId || isNaN(jobId) || jobId <= 0) {
    throw new BadRequestError('Invalid or missing PDF job ID');
  }

  const retried = await retryJob(jobId);
  if (!retried) {
    throw new BadRequestError(`Job #${jobId} could not be retried (either not found or status is not 'failed')`);
  }

  sendSuccess(res, { retried: true, id: jobId }, undefined, 200);
}
