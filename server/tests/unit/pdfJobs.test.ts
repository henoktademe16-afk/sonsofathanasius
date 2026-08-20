import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/index.js';
import { content, categories, pdfJobs } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  enqueuePdfJob,
  claimNextJob,
  completeJob,
  failJob,
  retryJob,
  cancelJob,
  reapStaleJobs,
  cleanupOldJobRecords,
  isJobPending,
} from '../../src/pdf/pdfJobs.js';

describe('PDF Database Queue Storage Client', () => {
  let testContentId: number;

  beforeEach(async () => {
    let catId: number;
    const existingCat = await db.select().from(categories).limit(1);
    if (existingCat.length > 0) {
      catId = existingCat[0].id;
    } else {
      const [insertedCat] = await db.insert(categories).values({
        slug: `cat-jobtest-${Date.now()}`,
        nameAm: 'የሙከራ ምድብ',
        nameEn: 'Test Cat',
      });
      catId = insertedCat.insertId;
    }

    const [testArticle] = await db.insert(content).values({
      categoryId: catId,
      authorName: 'Queue Unit Test',
    });
    testContentId = testArticle.insertId;
  });

  afterEach(async () => {
    if (testContentId) {
      await db.delete(pdfJobs).where(eq(pdfJobs.contentId, testContentId));
      await db.delete(content).where(eq(content.id, testContentId));
    }
  });

  it('enqueues and claims jobs with transactional locking', async () => {
    await enqueuePdfJob(testContentId, 'am');

    const isPending = await isJobPending(testContentId, 'am');
    expect(isPending).toBe(true);

    const claimed = await claimNextJob();
    expect(claimed).not.toBeNull();
    expect(claimed?.contentId).toBe(testContentId);
    expect(claimed?.langCode).toBe('am');
    expect(claimed?.status).toBe('processing');

    const completed = await completeJob(claimed!.id, claimed!.version, '/uploads/pdf/test.pdf');
    expect(completed).toBe(true);

    const [row] = await db.select().from(pdfJobs).where(eq(pdfJobs.id, claimed!.id));
    expect(row.status).toBe('completed');
    expect(row.pdfFilePath).toBe('/uploads/pdf/test.pdf');
  });

  it('guarantees optimistic version concurrency when article is updated mid-render', async () => {
    await enqueuePdfJob(testContentId, 'am');
    const claimed = await claimNextJob();
    expect(claimed?.version).toBe(1);

    // Mid-render edit bumps version to 2
    await enqueuePdfJob(testContentId, 'am');

    // Attempting to complete with version 1 fails optimistic guard
    const completed = await completeJob(claimed!.id, 1, '/uploads/pdf/stale.pdf');
    expect(completed).toBe(false);

    // Assert the job was automatically requeued for a fresh render
    const [requeuedRow] = await db.select().from(pdfJobs).where(eq(pdfJobs.id, claimed!.id));
    expect(requeuedRow.status).toBe('queued');
    expect(requeuedRow.version).toBe(2);
  });

  it('handles retry escalation and manual retry resets', async () => {
    await enqueuePdfJob(testContentId, 'ti');
    const claimed = await claimNextJob();

    // 1st failure -> requeues
    await failJob(claimed!.id, 'Error 1');
    let [row] = await db.select().from(pdfJobs).where(eq(pdfJobs.id, claimed!.id));
    expect(row.status).toBe('queued');

    // Claim again and fail 2 more times to trigger max attempts
    const claim2 = await claimNextJob();
    await failJob(claim2!.id, 'Error 2');
    const claim3 = await claimNextJob();
    await failJob(claim3!.id, 'Error 3');

    [row] = await db.select().from(pdfJobs).where(eq(pdfJobs.id, claimed!.id));
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(3);

    // Manual retry resets to queued with attempts = 0
    const retried = await retryJob(claimed!.id);
    expect(retried).toBe(true);

    [row] = await db.select().from(pdfJobs).where(eq(pdfJobs.id, claimed!.id));
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(0);
  });
});
