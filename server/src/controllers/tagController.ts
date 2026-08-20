import { Request, Response } from 'express';
import { db } from '../db/index.js';
import { tags, contentTags, contentTranslations } from '../db/schema.js';
import { eq, asc, sql } from 'drizzle-orm';
import { ValidatedRequest } from '../validators/queryValidator.js';
import { TagQueryParams } from '../validators/publicQueryValidator.js';

export interface TagWithCount {
  id: number;
  slug: string;
  name: string;
  articleCount: number;
}

/**
 * List all available tags with active article counts
 * GET /api/v1/tags
 */
export async function getTags(req: Request, _res: Response) {
  const query = (req as ValidatedRequest<TagQueryParams>).validatedQuery || { lang: 'am' };
  const lang = query.lang || 'am';

  // Fetch all tags and published article counts per tag in parallel
  const [allTags, tagArticleCounts] = await Promise.all([
    db.select().from(tags).orderBy(asc(tags.name)),
    db
      .select({
        tagId: contentTags.tagId,
        count: sql<number>`count(distinct ${contentTags.contentId})`,
      })
      .from(contentTags)
      .innerJoin(contentTranslations, eq(contentTags.contentId, contentTranslations.contentId))
      .where(eq(contentTranslations.status, 'published'))
      .groupBy(contentTags.tagId),
  ]);

  const countMap = new Map<number, number>();
  for (const item of tagArticleCounts) {
    countMap.set(item.tagId, Number(item.count));
  }

  // Format response and sort by articleCount DESC, then name ASC
  const result: TagWithCount[] = allTags.map((tag) => ({
    id: tag.id,
    slug: tag.slug,
    name: tag.name,
    articleCount: countMap.get(tag.id) || 0,
  }));

  result.sort((a, b) => {
    if (b.articleCount !== a.articleCount) {
      return b.articleCount - a.articleCount;
    }
    return a.name.localeCompare(b.name);
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
