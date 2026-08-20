import MiniSearch, { SearchResult } from 'minisearch';
import { db } from '../db/index.js';
import { content, contentTranslations, categories } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { processSearchTerm, normalizeAmharic } from './amharicNormalizer.js';

export interface SearchDocument {
  id: number; // Unique translation ID
  contentId: number; // Container ID
  title: string;
  slug: string;
  summary: string | null;
  bodySearchable: string;
  coverImage: string | null;
  authorName: string | null;
  categorySlug: string;
  categoryName: string;
  langCode: string;
  publishedAt: string | null;
}

export interface EnrichedSearchResult {
  id: number; // Translation ID
  contentId: number; // Container ID
  title: string;
  slug: string;
  summary: string | null;
  coverImage: string | null;
  authorName: string | null;
  categorySlug: string;
  categoryName: string;
  langCode: string;
  publishedAt: string | null;
  score: number;
  match: Record<string, string[]>;
}

// 1. Global In-Memory Index Instance
let searchEngine: MiniSearch<SearchDocument> | null = null;
let isIndexing = false;
let pendingReindex = false;

/**
 * Configure a new MiniSearch engine instance
 */
function createSearchEngine(): MiniSearch<SearchDocument> {
  return new MiniSearch<SearchDocument>({
    idField: 'id',
    fields: ['title', 'summary', 'bodySearchable'],
    storeFields: [
      'id',
      'contentId',
      'title',
      'slug',
      'summary',
      'coverImage',
      'authorName',
      'categorySlug',
      'categoryName',
      'langCode',
      'publishedAt',
    ],
    processTerm: (term) => processSearchTerm(term),
    searchOptions: {
      boost: { title: 4, summary: 2, bodySearchable: 1 },
      prefix: true, // "አትና" matches "አትናቴዎስ" (applied to trailing token)
      fuzzy: 0.2, // Typo tolerance (only triggers on >= 5 chars, protecting 1-3 char fidel words)
      combineWith: 'AND', // Precision-first: all terms must match
    },
  });
}

/**
 * Fetch all published article translations from MariaDB
 */
async function fetchAllSearchDocuments(): Promise<SearchDocument[]> {
  const rows = await db
    .select({
      id: contentTranslations.id,
      contentId: content.id,
      coverImage: content.coverImage,
      authorName: content.authorName,
      publishedAt: contentTranslations.publishedAt,
      categorySlug: categories.slug,
      categoryNameEn: categories.nameEn,
      categoryNameAm: categories.nameAm,
      categoryNameOm: categories.nameOm,
      categoryNameTi: categories.nameTi,
      title: contentTranslations.title,
      slug: contentTranslations.slug,
      summary: contentTranslations.summary,
      bodySearchable: contentTranslations.bodySearchable,
      langCode: contentTranslations.langCode,
    })
    .from(contentTranslations)
    .innerJoin(content, eq(contentTranslations.contentId, content.id))
    .innerJoin(categories, eq(content.categoryId, categories.id))
    .where(eq(contentTranslations.status, 'published'));

  return rows.map((row) => {
    // Pick localized category name based on translation langCode
    let categoryName = row.categoryNameAm || row.categoryNameEn;
    if (row.langCode === 'en' && row.categoryNameEn) categoryName = row.categoryNameEn;
    if (row.langCode === 'om' && row.categoryNameOm) categoryName = row.categoryNameOm;
    if (row.langCode === 'ti' && row.categoryNameTi) categoryName = row.categoryNameTi;

    return {
      id: row.id,
      contentId: row.contentId,
      title: row.title,
      slug: row.slug,
      summary: row.summary,
      bodySearchable: row.bodySearchable,
      coverImage: row.coverImage,
      authorName: row.authorName,
      categorySlug: row.categorySlug,
      categoryName,
      langCode: row.langCode,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    };
  });
}

/**
 * Initialize the In-Memory MiniSearch Index on server boot or reload
 */
export async function initializeSearchIndex(): Promise<void> {
  if (isIndexing) {
    pendingReindex = true;
    return;
  }
  isIndexing = true;

  try {
    const engine = createSearchEngine();
    const documents = await fetchAllSearchDocuments();

    if (documents.length > 0) {
      engine.addAll(documents);
    }

    searchEngine = engine;
    console.log(`🔍 [SearchEngine] In-memory index initialized with ${documents.length} document translations.`);
  } catch (err) {
    console.error('❌ [SearchEngine] Failed to initialize in-memory search index:', err);
  } finally {
    isIndexing = false;
    if (pendingReindex) {
      pendingReindex = false;
      void initializeSearchIndex();
    }
  }
}

/**
 * Search the in-memory MiniSearch index with Amharic normalization and fallback
 */
export function searchArticles(
  query: string,
  lang: string = 'am',
  limit: number = 20,
  categorySlug?: string
): EnrichedSearchResult[] {
  if (!searchEngine || !query || !query.trim()) {
    return [];
  }

  const normalizedQuery = normalizeAmharic(query.trim());
  if (!normalizedQuery) {
    return [];
  }

  // 1. Primary Precision Search: combineWith 'AND'
  let rawResults: SearchResult[] = searchEngine.search(normalizedQuery, {
    combineWith: 'AND',
    filter: (doc) => {
      const matchesLang = doc.langCode === lang;
      const matchesCategory = categorySlug ? doc.categorySlug === categorySlug : true;
      return matchesLang && matchesCategory;
    },
  });

  // 2. Recall Fallback: If strict 'AND' returns 0 results for a multi-word query, fall back to 'OR'
  if (rawResults.length === 0 && normalizedQuery.includes(' ')) {
    rawResults = searchEngine.search(normalizedQuery, {
      combineWith: 'OR',
      filter: (doc) => {
        const matchesLang = doc.langCode === lang;
        const matchesCategory = categorySlug ? doc.categorySlug === categorySlug : true;
        return matchesLang && matchesCategory;
      },
    });
  }

  const cappedResults = rawResults.slice(0, limit);

  return cappedResults.map((result) => {
    const doc = result as unknown as SearchDocument & SearchResult;
    return {
      id: doc.id,
      contentId: doc.contentId,
      title: doc.title,
      slug: doc.slug,
      summary: doc.summary,
      coverImage: doc.coverImage,
      authorName: doc.authorName,
      categorySlug: doc.categorySlug,
      categoryName: doc.categoryName,
      langCode: doc.langCode,
      publishedAt: doc.publishedAt,
      score: Number(result.score.toFixed(3)),
      match: result.match,
    };
  });
}

/**
 * Refresh the in-memory search index asynchronously
 */
export async function refreshSearchIndex(): Promise<void> {
  await initializeSearchIndex();
}

/**
 * Get count of indexed documents in memory
 */
export function getIndexedDocumentsCount(): number {
  return searchEngine ? searchEngine.documentCount : 0;
}
