import { db } from '../db/index.js';
import { content, contentTranslations, categories } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export interface ArticlePdfData {
  translationId?: number;
  contentId: number;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  bodySearchable?: string;
  authorName: string | null;
  categoryName: string;
  langCode: string;
  status?: string;
  pdfEnabled?: number;
  pdfFilePath?: string | null;
  publishedAt: Date | string | null;
  updatedAt?: Date | string | null;
}

/**
 * Helper to resolve localized category name
 */
export function resolveCategoryName(row: {
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
 * Single shared projection helper for PDF queries
 */
export async function selectArticlePdfData(
  contentId: number,
  langCode?: string
): Promise<ArticlePdfData[]> {
  const conditions = [
    eq(content.id, contentId),
    eq(contentTranslations.status, 'published'),
    eq(contentTranslations.pdfEnabled, 1),
  ];

  if (langCode) {
    conditions.push(eq(contentTranslations.langCode, langCode));
  }

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
    .where(and(...conditions));

  return rows.map((r) => ({
    translationId: r.translationId,
    contentId: r.contentId,
    title: r.title,
    slug: r.slug,
    summary: r.summary,
    body: r.body,
    authorName: r.authorName,
    categoryName: resolveCategoryName(r),
    langCode: r.langCode,
    status: r.status,
    pdfEnabled: r.pdfEnabled,
    pdfFilePath: r.pdfFilePath,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Query article translation by slug with published-only filter and am-fallback
 */
export async function selectArticlePdfDataBySlug(
  slug: string,
  langCode: string = 'am'
): Promise<ArticlePdfData | null> {
  // 1. Direct match on requested language and slug
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

  // 2. Fallback to published Amharic translation if specific language translation not found
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

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    translationId: r.translationId,
    contentId: r.contentId,
    title: r.title,
    slug: r.slug,
    summary: r.summary,
    body: r.body,
    authorName: r.authorName,
    categoryName: resolveCategoryName(r),
    langCode: r.langCode,
    status: r.status,
    pdfEnabled: r.pdfEnabled,
    pdfFilePath: r.pdfFilePath,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
  };
}
