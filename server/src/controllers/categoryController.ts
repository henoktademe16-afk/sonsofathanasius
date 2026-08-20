import { Request, Response } from 'express';
import { db } from '../db/index.js';
import { categories, content, contentTranslations } from '../db/schema.js';
import { eq, asc, sql } from 'drizzle-orm';
import { ValidatedRequest } from '../validators/queryValidator.js';
import { CategoryQueryParams } from '../validators/publicQueryValidator.js';

export interface LocalizedCategory {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  articleCount: number;
  sortOrder: number;
}

/**
 * Helper to pick localized name and description for a category
 */
function getLocalizedCategoryFields(
  cat: typeof categories.$inferSelect,
  lang: string
): { name: string; description: string | null } {
  switch (lang.toLowerCase()) {
    case 'en':
      return {
        name: cat.nameEn || cat.nameAm || cat.slug,
        description: cat.descriptionEn || cat.descriptionAm || null,
      };
    case 'om':
      return {
        name: cat.nameOm || cat.nameEn || cat.nameAm || cat.slug,
        description: cat.descriptionOm || cat.descriptionEn || cat.descriptionAm || null,
      };
    case 'ti':
      return {
        name: cat.nameTi || cat.nameAm || cat.nameEn || cat.slug,
        description: cat.descriptionTi || cat.descriptionAm || cat.descriptionEn || null,
      };
    case 'am':
    default:
      return {
        name: cat.nameAm || cat.nameEn || cat.slug,
        description: cat.descriptionAm || cat.descriptionEn || null,
      };
  }
}

/**
 * List all active categories with localized metadata & article counts
 * GET /api/v1/categories?lang=am
 */
export async function getCategories(req: Request, _res: Response) {
  const query = (req as ValidatedRequest<CategoryQueryParams>).validatedQuery || { lang: 'am' };
  const lang = query.lang || 'am';

  // Fetch active categories and published article counts in parallel
  const [activeCategories, articleCounts] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(eq(categories.isActive, 1))
      .orderBy(asc(categories.sortOrder), asc(categories.id)),
    db
      .select({
        categoryId: content.categoryId,
        count: sql<number>`count(distinct ${content.id})`,
      })
      .from(content)
      .innerJoin(contentTranslations, eq(contentTranslations.contentId, content.id))
      .where(eq(contentTranslations.status, 'published'))
      .groupBy(content.categoryId),
  ]);

  const countMap = new Map<number, number>();
  for (const item of articleCounts) {
    countMap.set(item.categoryId, Number(item.count));
  }

  // Format localized response
  const result: LocalizedCategory[] = activeCategories.map((cat) => {
    const { name, description } = getLocalizedCategoryFields(cat, lang);
    return {
      id: cat.id,
      slug: cat.slug,
      name,
      description,
      articleCount: countMap.get(cat.id) || 0,
      sortOrder: cat.sortOrder ?? 0,
    };
  });

  return {
    success: true,
    data: result,
    meta: {
      count: result.length,
      timestamp: new Date().toISOString(),
      lang,
    },
  };
}
