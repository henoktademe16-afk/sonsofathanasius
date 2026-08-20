import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { db } from '../db/index.js';
import { content, contentTranslations, contentMedia, contentTags, categories, tags } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
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
import {
  eagerGenerateArticlePdfs,
  eagerGenerateSingleTranslationPdf,
} from '../services/pdfService.js';

// ==========================================
// ZOD VALIDATION SCHEMAS
// ==========================================

export const CreateTranslationSchema = z.object({
  langCode: z.enum(['am', 'en', 'om', 'ti'], {
    message: 'Language code must be one of: am, en, om, ti',
  }),
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(255),
  slug: z.string().trim().max(240).optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  body: z.string().trim().min(10, 'Article body must be at least 10 characters'),
});

export const MediaItemSchema = z.object({
  mediaKind: z.enum(['video', 'audio']),
  platform: z.enum(['youtube', 'vimeo', 'soundcloud', 'self-hosted', 'custom']),
  embedId: z.string().trim().min(1).max(255),
  caption: z.string().trim().max(255).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const CreateArticleSchema = z.object({
  categoryId: z.number().int().positive('Category ID must be a positive integer'),
  authorName: z.string().trim().max(150).nullable().optional(),
  coverImage: z.string().trim().max(255).nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft').optional(),
  pdfEnabled: z
    .union([z.boolean(), z.number()])
    .transform((val) => (val ? 1 : 0))
    .default(0)
    .optional(),
  publishedAt: z
    .union([
      z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: 'publishedAt must be a valid ISO date string',
      }),
      z.date(),
    ])
    .nullable()
    .optional(),
  tagIds: z.array(z.number().int().positive()).optional().default([]),
  media: z.array(MediaItemSchema).optional().default([]),
  translations: z.array(CreateTranslationSchema).min(1, 'At least one translation is required'),
});

export const UpdateArticleSchema = z.object({
  categoryId: z.number().int().positive('Category ID must be a positive integer').optional(),
  authorName: z.string().trim().max(150).nullable().optional(),
  coverImage: z.string().trim().max(255).nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  pdfEnabled: z
    .union([z.boolean(), z.number()])
    .transform((val) => (val ? 1 : 0))
    .optional(),
  publishedAt: z
    .union([
      z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: 'publishedAt must be a valid ISO date string',
      }),
      z.date(),
    ])
    .nullable()
    .optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  media: z.array(MediaItemSchema).optional(),
  translations: z.array(CreateTranslationSchema).min(1, 'At least one translation is required').optional(),
});

export const UpsertTranslationSchema = CreateTranslationSchema;

export type CreateArticleInput = z.infer<typeof CreateArticleSchema>;
export type UpdateArticleInput = z.infer<typeof UpdateArticleSchema>;
export type UpsertTranslationInput = z.infer<typeof UpsertTranslationSchema>;

/**
 * Execute a database operation with automatic retry on transient concurrency collisions
 */
async function runWithTransactionRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;
      const driverErr = (err as any).cause || err;
      const isTransient =
        driverErr &&
        typeof driverErr === 'object' &&
        (('code' in driverErr && (driverErr.code === 'ER_CHECKREAD' || driverErr.code === 'ER_LOCK_DEADLOCK' || driverErr.code === 'ER_DUP_ENTRY')) ||
         ('errno' in driverErr && (driverErr.errno === 1020 || driverErr.errno === 1213 || driverErr.errno === 1062)));

      if (isTransient && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Shared transaction helper to insert or update a translation row within a MariaDB transaction.
 * Preserves the existing slug if not explicitly provided in payload; otherwise validates and collision-checks the new slug.
 */
export async function upsertTranslationTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  contentId: number,
  input: z.infer<typeof CreateTranslationSchema>
): Promise<{
  id: number;
  contentId: number;
  langCode: 'am' | 'en' | 'om' | 'ti';
  title: string;
  slug: string;
  summary: string | null;
  isUpdate: boolean;
}> {
  const processed = processArticleContent(input.body);

  const existingTranslation = await tx
    .select()
    .from(contentTranslations)
    .where(and(eq(contentTranslations.contentId, contentId), eq(contentTranslations.langCode, input.langCode)))
    .limit(1);

  let isUpdate = false;
  let translationId: number;
  let slug: string;

  if (existingTranslation.length > 0) {
    isUpdate = true;
    translationId = existingTranslation[0].id;

    // Preserve existing slug unless a new explicit slug is provided in the request payload
    if (input.slug && input.slug.trim()) {
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
      slug = existingTranslation[0].slug;
    }

    await tx
      .update(contentTranslations)
      .set({
        title: input.title,
        slug,
        summary: input.summary || null,
        body: processed.sanitizedHtml,
        bodySearchable: processed.bodySearchable,
        pdfFilePath: null,
        pdfGeneratedAt: null,
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

    const [insertRes] = await tx.insert(contentTranslations).values({
      contentId,
      langCode: input.langCode,
      title: input.title,
      slug,
      summary: input.summary || null,
      body: processed.sanitizedHtml,
      bodySearchable: processed.bodySearchable,
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
    throw new BadRequestError(`Category #${data.categoryId} does not exist`);
  }

  // 2. Verify Tag IDs (if provided)
  if (data.tagIds.length > 0) {
    const validTags = await db
      .select({ id: tags.id })
      .from(tags)
      .where(inArray(tags.id, data.tagIds));

    if (validTags.length !== data.tagIds.length) {
      throw new BadRequestError('One or more specified tag IDs do not exist');
    }
  }

  // 3. Verify No Duplicate Languages within Payload
  const seenLangs = new Set<string>();
  for (const t of data.translations) {
    if (seenLangs.has(t.langCode)) {
      throw new BadRequestError(`Duplicate translation for language '${t.langCode}' in request payload`);
    }
    seenLangs.add(t.langCode);
  }

  // Determine publishedAt timestamp
  let publishedAt: Date | null = null;
  if (data.status === 'published') {
    publishedAt = data.publishedAt ? new Date(data.publishedAt) : new Date();
  } else if (data.publishedAt) {
    publishedAt = new Date(data.publishedAt);
  }

  // 4. Atomic Database Transaction
  const transactionResult = await runWithTransactionRetry(() =>
    db.transaction(async (tx) => {
      // 4a. Insert Master Content Container
      const [contentInsert] = await tx.insert(content).values({
        categoryId: data.categoryId,
        authorName: data.authorName || null,
        coverImage: data.coverImage || null,
        status: data.status || 'draft',
        pdfEnabled: data.pdfEnabled ?? 0,
        publishedAt,
        viewCount: 0,
      });
      const contentId = contentInsert.insertId;

      // 4b. Process and Insert Translations
      const insertedTranslations = [];
      for (const t of data.translations) {
        const transResult = await upsertTranslationTx(tx, contentId, t);
        insertedTranslations.push(transResult);
      }

      // 4c. Insert Attached Media
      if (data.media && data.media.length > 0) {
        for (let i = 0; i < data.media.length; i++) {
          const m = data.media[i];
          await tx.insert(contentMedia).values({
            contentId,
            mediaKind: m.mediaKind,
            platform: m.platform,
            embedId: m.embedId,
            caption: m.caption || null,
            sortOrder: m.sortOrder ?? i,
          });
        }
      }

      // 4d. Insert Attached Content Tags
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

  if (data.status === 'published' && data.pdfEnabled) {
    void eagerGenerateArticlePdfs(transactionResult.contentId, true);
  }

  sendSuccess(
    res,
    {
      id: transactionResult.contentId,
      categoryId: data.categoryId,
      authorName: data.authorName || null,
      coverImage: data.coverImage || null,
      status: data.status || 'draft',
      pdfEnabled: data.pdfEnabled ?? 0,
      publishedAt,
      translations: transactionResult.translations,
    },
    undefined,
    201
  );
}

/**
 * PUT /api/v1/admin/articles/:id
 * Update article metadata, tags, media, and translations.
 * Preserves omitted fields (status, pdfEnabled, authorName, etc.).
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

  // 1. Verify Category Exists (if provided)
  if (data.categoryId !== undefined) {
    const categoryRows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, data.categoryId))
      .limit(1);

    if (categoryRows.length === 0) {
      throw new BadRequestError(`Category #${data.categoryId} does not exist`);
    }
  }

  // 2. Verify Tag IDs (if provided)
  if (data.tagIds && data.tagIds.length > 0) {
    const validTags = await db
      .select({ id: tags.id })
      .from(tags)
      .where(inArray(tags.id, data.tagIds));

    if (validTags.length !== data.tagIds.length) {
      throw new BadRequestError('One or more specified tag IDs do not exist');
    }
  }

  // 3. Verify No Duplicate Languages within Payload (if translations provided)
  if (data.translations && data.translations.length > 0) {
    const seenLangs = new Set<string>();
    for (const t of data.translations) {
      if (seenLangs.has(t.langCode)) {
        throw new BadRequestError(`Duplicate translation for language '${t.langCode}' in request payload`);
      }
      seenLangs.add(t.langCode);
    }
  }

  // 4. Atomic Database Transaction
  const transactionResult = await runWithTransactionRetry(() =>
    db.transaction(async (tx) => {
      // 4a. Verify parent container exists
      const parentRows = await tx.select().from(content).where(eq(content.id, articleId)).limit(1);
      if (parentRows.length === 0) {
        throw new NotFoundError(`Article #${articleId} not found`);
      }
      const existingContent = parentRows[0];

      // Merge metadata fields safely (preserving existing values when omitted)
      const targetCategoryId = data.categoryId ?? existingContent.categoryId;
      const targetAuthorName = data.authorName !== undefined ? (data.authorName || null) : existingContent.authorName;
      const targetCoverImage = data.coverImage !== undefined ? (data.coverImage || null) : existingContent.coverImage;
      const targetStatus = data.status ?? (existingContent.status || 'draft');
      const targetPdfEnabled = data.pdfEnabled !== undefined ? data.pdfEnabled : (existingContent.pdfEnabled ?? 0);

      // Track replaced cover image for post-transaction unlink
      let oldCoverToUnlink: string | null = null;
      if (data.coverImage !== undefined && existingContent.coverImage && existingContent.coverImage !== data.coverImage) {
        oldCoverToUnlink = existingContent.coverImage;
      }

      // Determine publishedAt timestamp
      let targetPublishedAt: Date | null = existingContent.publishedAt;
      if (targetStatus === 'published') {
        if (data.publishedAt) {
          targetPublishedAt = new Date(data.publishedAt);
        } else if (!targetPublishedAt) {
          // Transition from draft/archived -> published without explicit date: set to now
          targetPublishedAt = new Date();
        }
      } else if (data.publishedAt !== undefined) {
        targetPublishedAt = data.publishedAt ? new Date(data.publishedAt) : null;
      }

      // 4b. Update Master Content Container
      await tx
        .update(content)
        .set({
          categoryId: targetCategoryId,
          authorName: targetAuthorName,
          coverImage: targetCoverImage,
          status: targetStatus,
          pdfEnabled: targetPdfEnabled,
          publishedAt: targetPublishedAt,
          updatedAt: new Date(),
        })
        .where(eq(content.id, articleId));

      // 4c. Update Tags (if explicitly provided)
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

      // 4d. Update Media (if explicitly provided)
      if (data.media !== undefined) {
        await tx.delete(contentMedia).where(eq(contentMedia.contentId, articleId));
        if (data.media.length > 0) {
          for (let i = 0; i < data.media.length; i++) {
            const m = data.media[i];
            await tx.insert(contentMedia).values({
              contentId: articleId,
              mediaKind: m.mediaKind,
              platform: m.platform,
              embedId: m.embedId,
              caption: m.caption || null,
              sortOrder: m.sortOrder ?? i,
            });
          }
        }
      }

      // 4e. Translations (Full-Replace Semantics if provided)
      const deletedTranslationLangs: string[] = [];
      let updatedTranslations: Array<{
        id: number;
        contentId: number;
        langCode: 'am' | 'en' | 'om' | 'ti';
        title: string;
        slug: string;
        summary: string | null;
        isUpdate: boolean;
      }> = [];

      if (data.translations !== undefined) {
        const existingTransRows = await tx
          .select({ id: contentTranslations.id, langCode: contentTranslations.langCode })
          .from(contentTranslations)
          .where(eq(contentTranslations.contentId, articleId));

        const payloadLangs = new Set(data.translations.map((t) => t.langCode));
        for (const oldTrans of existingTransRows) {
          if (!payloadLangs.has(oldTrans.langCode as any)) {
            await tx.delete(contentTranslations).where(eq(contentTranslations.id, oldTrans.id));
            deletedTranslationLangs.push(oldTrans.langCode);
          }
        }

        // Upsert all payload translations
        for (const t of data.translations) {
          const transResult = await upsertTranslationTx(tx, articleId, t);
          updatedTranslations.push(transResult);
        }
      } else {
        const existingTransRows = await tx
          .select()
          .from(contentTranslations)
          .where(eq(contentTranslations.contentId, articleId));
        updatedTranslations = existingTransRows.map((t) => ({
          id: t.id,
          contentId: t.contentId,
          langCode: t.langCode as any,
          title: t.title,
          slug: t.slug,
          summary: t.summary,
          isUpdate: true,
        }));
      }

      return {
        contentId: articleId,
        categoryId: targetCategoryId,
        authorName: targetAuthorName,
        coverImage: targetCoverImage,
        status: targetStatus,
        pdfEnabled: targetPdfEnabled,
        publishedAt: targetPublishedAt,
        translations: updatedTranslations,
        deletedTranslationLangs,
        oldCoverToUnlink,
      };
    })
  );

  // 5. Post-Transaction Side Effects
  // 5a. Clean up orphaned static PDFs of deleted translation languages
  if (transactionResult.deletedTranslationLangs.length > 0) {
    try {
      const files = await fs.promises.readdir(config.storage.pdfDir);
      for (const lang of transactionResult.deletedTranslationLangs) {
        const prefix = `article_${articleId}_`;
        const suffix = `_${lang}.pdf`;
        for (const file of files) {
          if (file.startsWith(prefix) && file.endsWith(suffix)) {
            await fs.promises.unlink(path.join(config.storage.pdfDir, file)).catch(() => {});
          }
        }
      }
    } catch (pdfErr) {
      console.warn(`⚠️ [PDFService] Error sweeping removed translation PDFs for article #${articleId}:`, pdfErr);
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

  if (transactionResult.status === 'published' && transactionResult.pdfEnabled) {
    void eagerGenerateArticlePdfs(articleId, true);
  }

  sendSuccess(
    res,
    {
      id: transactionResult.contentId,
      categoryId: transactionResult.categoryId,
      authorName: transactionResult.authorName,
      coverImage: transactionResult.coverImage,
      status: transactionResult.status,
      pdfEnabled: transactionResult.pdfEnabled,
      publishedAt: transactionResult.publishedAt,
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
  // 2a. Delete all static PDFs for this article on disk (all languages)
  try {
    const files = await fs.promises.readdir(config.storage.pdfDir);
    const prefix = `article_${articleId}_`;
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.pdf')) {
        await fs.promises.unlink(path.join(config.storage.pdfDir, file)).catch(() => {});
      }
    }
  } catch (pdfErr) {
    console.warn(`⚠️ [PDFService] Error sweeping PDFs for deleted article #${articleId}:`, pdfErr);
  }

  // 2b. Clean up uploaded cover image if self-hosted
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

  // 2c. Evict all caches across all namespaces
  invalidateAllCaches();

  // 2d. Refresh search engine index
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

      // 3. Update parent container updatedAt timestamp
      await tx.update(content).set({ updatedAt: new Date() }).where(eq(content.id, articleId));

      return {
        parent,
        translation: translationResult,
      };
    })
  );

  // Post-Transaction Side Effects
  invalidateArticleCaches();
  void refreshSearchIndex();

  // If article is published and pdfEnabled, trigger eager single-translation PDF generation
  if (result.parent.status === 'published' && result.parent.pdfEnabled) {
    void eagerGenerateSingleTranslationPdf(articleId, result.translation.langCode, true);
  }

  sendSuccess(res, result.translation, undefined, result.translation.isUpdate ? 200 : 201);
}
