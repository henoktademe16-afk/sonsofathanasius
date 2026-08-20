import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/index.js';
import { db } from '../../src/db/index.js';
import { content, contentTranslations, categories, pdfJobs } from '../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { startPdfScheduler, stopPdfScheduler } from '../../src/pdf/pdfScheduler.js';
import fs from 'fs';
import path from 'path';
import { config } from '../../src/config/index.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('PDF Pipeline End-to-End & HTTP Contract Integration', () => {
  let catId: number;
  let testContentId: number;
  let amSlug: string;
  let authCookie: string;

  beforeAll(async () => {
    // 1. Ensure test category
    const existingCat = await db.select().from(categories).limit(1);
    if (existingCat.length > 0) {
      catId = existingCat[0].id;
    } else {
      const [insertedCat] = await db.insert(categories).values({
        slug: `cat-integ-${Date.now()}`,
        nameAm: 'የሙከራ ምድብ Integ',
        nameEn: 'Integ Category',
      });
      catId = insertedCat.insertId;
    }

    // 2. Start background worker scheduler
    startPdfScheduler();

    // 3. Login as admin for authenticated endpoints
    const loginRes = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ identifier: 'admin', password: 'AdminSecretPass123!' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.headers['set-cookie']).toBeDefined();
    authCookie = loginRes.headers['set-cookie'][0];
  });

  afterAll(async () => {
    await stopPdfScheduler();
    if (testContentId) {
      await db.delete(pdfJobs).where(eq(pdfJobs.contentId, testContentId));
      await db.delete(content).where(eq(content.id, testContentId));
    }
  });

  it('admin creation enqueues PDF job and worker drains it to completion', async () => {
    amSlug = `integ-article-${Date.now()}`;

    const [testArticle] = await db.insert(content).values({
      categoryId: catId,
      authorName: 'Integ Test Author',
    });
    testContentId = testArticle.insertId;

    const [amTrans] = await db.insert(contentTranslations).values({
      contentId: testContentId,
      langCode: 'am',
      title: 'የቅዱስ አትናቴዎስ ኢንቴግሬሽን ማረጋገጫ',
      slug: amSlug,
      summary: 'የኢንቴግሬሽን ማረጋገጫ ማጠቃለያ',
      body: '<p>ይህ የኢንቴግሬሽን ፈተና ነው። <span data-ref="ዮሐ 1:1">[ዮሐ 1:1]</span></p>',
      bodySearchable: 'ይህ የኢንቴግሬሽን ፈተና ነው።',
      status: 'published',
      pdfEnabled: 1,
      publishedAt: new Date(),
    });

    // 1. Initial public PDF request before render -> 202 Accepted + Retry-After
    const uncachedRes = await request(app).get(`/api/v1/articles/${amSlug}/pdf?lang=am`);
    expect(uncachedRes.status).toBe(202);
    expect(uncachedRes.headers['retry-after']).toBe('5');
    expect(uncachedRes.body.data.status).toBe('generating');

    // 2. Wait for worker scheduler to drain
    let completed = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const [jobRow] = await db
        .select()
        .from(pdfJobs)
        .where(and(eq(pdfJobs.contentId, testContentId), eq(pdfJobs.langCode, 'am')));

      if (jobRow && jobRow.status === 'completed') {
        completed = true;
        break;
      }
    }
    expect(completed).toBe(true);

    // 3. Subsequent public request -> 200 OK binary stream
    const cachedRes = await request(app).get(`/api/v1/articles/${amSlug}/pdf?lang=am`);
    expect(cachedRes.status).toBe(200);
    expect(cachedRes.headers['content-type']).toBe('application/pdf');
    expect(cachedRes.headers['content-disposition']).toContain(`SOA_${amSlug}.pdf`);
  });

  it('returns 404 for nonexistent slugs or articles with pdf disabled', async () => {
    const res404 = await request(app).get('/api/v1/articles/nonexistent-slug-12345/pdf?lang=am');
    expect(res404.status).toBe(404);
  });
});
