import { Request, Response, NextFunction } from 'express';
import { LRUCache } from 'lru-cache';
import { db } from '../db/index.js';
import { contentTranslations } from '../db/schema.js';
import { sql, eq } from 'drizzle-orm';

// 1. In-memory view count buffer (holds increments keyed by translation ID)
const viewCounters = new LRUCache<number, number>({
  max: 5000,
  ttl: 120_000, // 2 minutes
});

// 2. In-memory Slug -> TranslationId resolution cache (avoids DB queries on cache HITs)
const slugToTranslationIdMap = new LRUCache<string, number>({
  max: 5000,
  ttl: 86400_000, // 24 hours
});

/**
 * Prime or update the in-memory slug to translation ID mapping
 */
export function recordSlugIdMapping(slug: string, translationId: number): void {
  if (slug && translationId) {
    slugToTranslationIdMap.set(slug.trim(), translationId);
  }
}

/**
 * Record an article read view in memory by numeric translation ID
 */
export function trackArticleView(translationId: number): void {
  if (!translationId || isNaN(translationId)) return;
  const current = viewCounters.get(translationId) ?? 0;
  viewCounters.set(translationId, current + 1);
}

/**
 * Record an article read view in memory by slug or ID string.
 * Resolves synchronously via in-memory map for cache HITs, or asynchronously on cold slug.
 */
export function trackArticleViewBySlug(slug: string): void {
  if (!slug) return;
  const cleanSlug = slug.trim();

  // Check if slug is already a numeric translation ID
  if (/^\d+$/.test(cleanSlug)) {
    trackArticleView(parseInt(cleanSlug, 10));
    return;
  }

  // Fast path: In-memory cache hit
  const cachedId = slugToTranslationIdMap.get(cleanSlug);
  if (cachedId) {
    trackArticleView(cachedId);
    return;
  }

  // Cold path: Asynchronously resolve translation ID from DB and record
  void (async () => {
    try {
      const rows = await db
        .select({ id: contentTranslations.id })
        .from(contentTranslations)
        .where(eq(contentTranslations.slug, cleanSlug))
        .limit(1);

      if (rows.length > 0 && rows[0].id) {
        const id = rows[0].id;
        slugToTranslationIdMap.set(cleanSlug, id);
        trackArticleView(id);
      }
    } catch {
      // Non-critical background metric tracking
    }
  })();
}

/**
 * Express middleware that records article views on EVERY request (both cache HIT and MISS)
 * before cachedRoute sends the cached response payload.
 */
export function trackViewMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const rawSlug = req.params.slug;
  const slug = (Array.isArray(rawSlug) ? rawSlug[0] : rawSlug)?.trim();
  if (slug) {
    trackArticleViewBySlug(slug);
  }
  next();
}

/**
 * Flush accumulated view counts to MariaDB atomically in a transaction.
 * Only deletes from memory on successful DB commit to prevent data loss.
 */
export async function flushViewCounts(): Promise<void> {
  const snapshot: Array<{ translationId: number; count: number }> = [];

  for (const [translationId, count] of viewCounters.entries()) {
    if (count && count > 0) {
      snapshot.push({ translationId, count });
    }
  }

  if (snapshot.length === 0) return;

  try {
    // Atomic batch update within a transaction keyed by translation ID
    await db.transaction(async (tx) => {
      for (const { translationId, count } of snapshot) {
        await tx
          .update(contentTranslations)
          .set({ viewCount: sql`${contentTranslations.viewCount} + ${count}` })
          .where(eq(contentTranslations.id, translationId));
      }
    });

    // Delete from in-memory map ONLY after the transaction commits successfully
    for (const { translationId, count } of snapshot) {
      const remaining = (viewCounters.get(translationId) ?? 0) - count;
      if (remaining <= 0) {
        viewCounters.delete(translationId);
      } else {
        viewCounters.set(translationId, remaining);
      }
    }
  } catch (err) {
    console.error('⚠️ [ViewCounter] Batch flush failed, retaining counts in memory for next cycle:', err);
  }
}

// Flush view counts every 60 seconds
const flushInterval = setInterval(() => {
  void flushViewCounts();
}, 60_000);

// Ensure timer does not prevent clean process shutdown
if (flushInterval.unref) {
  flushInterval.unref();
}
