import { db } from '../src/db/index.js';
import { content, contentTranslations } from '../src/db/schema.js';
import { eq, sql, and, isNull } from 'drizzle-orm';

async function main() {
  console.log('🔍 [Verify] Verifying Per-Translation Content Independence...');

  // 1. Assert: every published translation has published_at NOT NULL
  const missingPublishedAt = await db
    .select({
      id: contentTranslations.id,
      contentId: contentTranslations.contentId,
      langCode: contentTranslations.langCode,
      title: contentTranslations.title,
    })
    .from(contentTranslations)
    .where(
      and(
        eq(contentTranslations.status, 'published'),
        isNull(contentTranslations.publishedAt)
      )
    );

  if (missingPublishedAt.length > 0) {
    console.error('❌ Assertion failed: Found published translations with NULL published_at:', missingPublishedAt);
    process.exit(1);
  }
  console.log('✓ Assertion passed: All published translations have valid published_at timestamps.');

  // 2. Count rows per (status, langCode)
  const breakdown = await db
    .select({
      status: contentTranslations.status,
      langCode: contentTranslations.langCode,
      count: sql<number>`count(*)`,
    })
    .from(contentTranslations)
    .groupBy(contentTranslations.status, contentTranslations.langCode);

  console.log('\n📊 [Verify] Translation Status & Language Breakdown:');
  console.table(breakdown);

  // 3. Count total containers vs total translations
  const [containerCount] = await db.select({ count: sql<number>`count(*)` }).from(content);
  const [translationCount] = await db.select({ count: sql<number>`count(*)` }).from(contentTranslations);

  console.log(`\n📦 Total Article Containers: ${containerCount?.count || 0}`);
  console.log(`📄 Total Language Translations: ${translationCount?.count || 0}`);

  console.log('\n✅ [Verify] Phase 1 database verification complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Verification script failed:', err);
  process.exit(1);
});
