import { db } from '../db/index.js';
import { pdfJobs } from '../db/schema.js';
import { sql, eq, and, desc } from 'drizzle-orm';

export const PDF_JOB_MAX_ATTEMPTS = 3;
export const PDF_JOB_LEASE_SECONDS = 120;

export interface PdfJob {
  id: number;
  contentId: number;
  langCode: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  version: number;
  leaseExpiresAt: Date | string | null;
  lastError: string | null;
  pdfFilePath: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Enqueue a PDF generation job with coalescing upsert (UNIQUE content_id, lang_code).
 * If the job is currently 'processing', preserve 'processing' status and bump version
 * so the completion version guard detects the mid-render mutation and triggers a re-render.
 */
export async function enqueuePdfJob(contentId: number, langCode: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${pdfJobs} (
      ${pdfJobs.contentId},
      ${pdfJobs.langCode},
      ${pdfJobs.status},
      ${pdfJobs.leaseExpiresAt},
      ${pdfJobs.lastError},
      ${pdfJobs.version}
    )
    VALUES (${contentId}, ${langCode}, 'queued', NULL, NULL, 1)
    ON DUPLICATE KEY UPDATE
      ${pdfJobs.status} = IF(${pdfJobs.status} = 'processing', 'processing', 'queued'),
      ${pdfJobs.lastError} = NULL,
      ${pdfJobs.version} = ${pdfJobs.version} + 1
  `);
}

/**
 * Transactional exactly-once job claim using SELECT ... FOR UPDATE SKIP LOCKED
 */
export async function claimNextJob(): Promise<PdfJob | null> {
  return await db.transaction(async (tx) => {
    // 1. Lock and select earliest queued job
    const [rows] = (await tx.execute(sql`
      SELECT 
        id, 
        content_id as contentId, 
        lang_code as langCode, 
        status, 
        attempts, 
        version, 
        lease_expires_at as leaseExpiresAt, 
        last_error as lastError, 
        pdf_file_path as pdfFilePath, 
        created_at as createdAt, 
        updated_at as updatedAt
      FROM ${pdfJobs}
      WHERE ${pdfJobs.status} = 'queued'
      ORDER BY ${pdfJobs.id} ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `)) as any;

    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const job = rows[0] as PdfJob;

    // 2. Mark job as processing with lease expiration and increment attempts
    await tx.execute(sql`
      UPDATE ${pdfJobs}
      SET 
        ${pdfJobs.status} = 'processing',
        ${pdfJobs.leaseExpiresAt} = DATE_ADD(NOW(), INTERVAL ${sql.raw(String(PDF_JOB_LEASE_SECONDS))} SECOND),
        ${pdfJobs.attempts} = ${pdfJobs.attempts} + 1
      WHERE ${pdfJobs.id} = ${job.id}
    `);

    job.status = 'processing';
    job.attempts += 1;
    return job;
  });
}

/**
 * Mark a job as successfully completed with optimistic version check.
 * If version was bumped mid-render, immediately requeues the job to render the latest content.
 */
export async function completeJob(
  jobId: number,
  expectedVersion: number,
  pdfFilePath?: string | null
): Promise<boolean> {
  const [result] = (await db.execute(sql`
    UPDATE ${pdfJobs}
    SET 
      ${pdfJobs.status} = 'completed',
      ${pdfJobs.pdfFilePath} = ${pdfFilePath ?? null},
      ${pdfJobs.leaseExpiresAt} = NULL,
      ${pdfJobs.lastError} = NULL
    WHERE ${pdfJobs.id} = ${jobId} AND ${pdfJobs.version} = ${expectedVersion}
  `)) as any;

  const completed = (result?.affectedRows ?? 0) > 0;

  if (!completed) {
    // Version bumped while processing! Requeue immediately for fresh render
    await db.execute(sql`
      UPDATE ${pdfJobs}
      SET 
        ${pdfJobs.status} = 'queued',
        ${pdfJobs.leaseExpiresAt} = NULL
      WHERE ${pdfJobs.id} = ${jobId}
    `);
  }

  return completed;
}

/**
 * Handle job failure: retry if attempts < MAX_ATTEMPTS, otherwise mark permanently failed
 */
export async function failJob(jobId: number, error: string): Promise<void> {
  const [rows] = (await db.execute(sql`
    SELECT attempts FROM ${pdfJobs} WHERE ${pdfJobs.id} = ${jobId}
  `)) as any;

  const currentAttempts = Array.isArray(rows) && rows.length > 0 ? Number(rows[0].attempts) : PDF_JOB_MAX_ATTEMPTS;

  if (currentAttempts >= PDF_JOB_MAX_ATTEMPTS) {
    await db.execute(sql`
      UPDATE ${pdfJobs}
      SET 
        ${pdfJobs.status} = 'failed',
        ${pdfJobs.lastError} = ${error.slice(0, 1000)},
        ${pdfJobs.leaseExpiresAt} = NULL
      WHERE ${pdfJobs.id} = ${jobId}
    `);
  } else {
    // Requeue for retry
    await db.execute(sql`
      UPDATE ${pdfJobs}
      SET 
        ${pdfJobs.status} = 'queued',
        ${pdfJobs.lastError} = ${error.slice(0, 1000)},
        ${pdfJobs.leaseExpiresAt} = NULL
      WHERE ${pdfJobs.id} = ${jobId}
    `);
  }
}

/**
 * Cancel and remove a PDF job for a specific language translation
 */
export async function cancelJob(contentId: number, langCode: string): Promise<void> {
  await db.delete(pdfJobs).where(
    and(
      eq(pdfJobs.contentId, contentId),
      eq(pdfJobs.langCode, langCode)
    )
  );
}

/**
 * Cancel and remove all PDF jobs for an entire article container
 */
export async function cancelJobsForArticle(contentId: number): Promise<void> {
  await db.delete(pdfJobs).where(eq(pdfJobs.contentId, contentId));
}

/**
 * Stale Lease Reaper: Reclaims hung or crashed 'processing' jobs back to 'queued'
 */
export async function reapStaleJobs(): Promise<number> {
  const [result] = (await db.execute(sql`
    UPDATE ${pdfJobs}
    SET 
      ${pdfJobs.status} = 'queued',
      ${pdfJobs.leaseExpiresAt} = NULL
    WHERE 
      ${pdfJobs.status} = 'processing' 
      AND ${pdfJobs.leaseExpiresAt} < NOW()
  `)) as any;

  return result?.affectedRows ?? 0;
}

/**
 * Check if a job is currently pending (queued or processing) for a target translation
 */
export async function isJobPending(contentId: number, langCode: string): Promise<boolean> {
  const [rows] = (await db.execute(sql`
    SELECT id FROM ${pdfJobs}
    WHERE 
      ${pdfJobs.contentId} = ${contentId} 
      AND ${pdfJobs.langCode} = ${langCode}
      AND ${pdfJobs.status} IN ('queued', 'processing')
    LIMIT 1
  `)) as any;

  return Array.isArray(rows) && rows.length > 0;
}

/**
 * List recent PDF jobs (for admin observability)
 */
export async function listJobs(limit: number = 50, status?: string): Promise<PdfJob[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));

  let query = db.select().from(pdfJobs);
  if (status) {
    query = query.where(eq(pdfJobs.status, status as any)) as any;
  }

  const rows = await query.orderBy(desc(pdfJobs.id)).limit(safeLimit);

  return rows as unknown as PdfJob[];
}

/**
 * Manual retry for a failed PDF job
 */
export async function retryJob(jobId: number): Promise<boolean> {
  const [result] = (await db.execute(sql`
    UPDATE ${pdfJobs}
    SET 
      ${pdfJobs.status} = 'queued',
      ${pdfJobs.attempts} = 0,
      ${pdfJobs.lastError} = NULL,
      ${pdfJobs.leaseExpiresAt} = NULL
    WHERE ${pdfJobs.id} = ${jobId} AND ${pdfJobs.status} = 'failed'
  `)) as any;

  return (result?.affectedRows ?? 0) > 0;
}

/**
 * 30-Day Retention Cleanup: Purges completed and failed job records older than maxAgeDays
 */
export async function cleanupOldJobRecords(maxAgeDays: number = 30): Promise<number> {
  const [result] = (await db.execute(sql`
    DELETE FROM ${pdfJobs}
    WHERE ${pdfJobs.status} IN ('completed', 'failed')
      AND ${pdfJobs.updatedAt} < DATE_SUB(NOW(), INTERVAL ${maxAgeDays} DAY)
  `)) as any;

  return (result?.affectedRows ?? 0);
}
