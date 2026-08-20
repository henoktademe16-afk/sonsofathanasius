import { Worker } from 'node:worker_threads';
import { claimNextJob, completeJob, failJob, reapStaleJobs, cleanupOldJobRecords, listJobs } from './pdfJobs.js';
import { sweepTmpOrphans } from './pdfStorage.js';

export interface PdfSchedulerMetrics {
  isRunning: boolean;
  completed: number;
  failed: number;
  skipped: number;
  totalRenderMs: number;
  avgRenderMs: number;
  lastError: string | null;
  lastRunAt: string | null;
}

const metrics: PdfSchedulerMetrics = {
  isRunning: false,
  completed: 0,
  failed: 0,
  skipped: 0,
  totalRenderMs: 0,
  avgRenderMs: 0,
  lastError: null,
  lastRunAt: null,
};

export function getPdfSchedulerMetrics(): PdfSchedulerMetrics {
  return { ...metrics };
}

let workerInstance: Worker | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let tickCount = 0;
let consecutiveFailures = 0;
let circuitBreakerUntil = 0;

const POLL_INTERVAL_MS = 3000;
const RENDER_TIMEOUT_MS = 60_000;
const RSS_LIMIT_BYTES = 700 * 1024 * 1024; // 700MB RSS guard

/**
 * Spawn a dedicated persistent PDF worker
 */
function createWorker(): Worker {
  const isTs = import.meta.url.endsWith('.ts');
  const workerUrl = new URL(isTs ? './pdfWorker.ts' : './pdfWorker.js', import.meta.url);

  const worker = new Worker(workerUrl, {
    resourceLimits: {
      maxOldGenerationSizeMb: 512,
    },
    execArgv: isTs ? ['--import', 'tsx'] : [],
  });

  worker.on('error', (err) => {
    console.error('⚠️ [PDFScheduler] Worker encountered unhandled error:', err);
    metrics.lastError = err.message;
    respawnWorker();
  });

  worker.on('exit', (code) => {
    if (!isShuttingDown && code !== 0) {
      console.warn(`⚠️ [PDFScheduler] Worker exited with code ${code}. Respawning...`);
      respawnWorker();
    }
  });

  return worker;
}

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = createWorker();
  }
  return workerInstance;
}

function respawnWorker(): void {
  if (workerInstance) {
    try {
      workerInstance.terminate().catch(() => {});
    } catch {}
    workerInstance = null;
  }
  if (!isShuttingDown) {
    workerInstance = createWorker();
  }
}

/**
 * Dispatch job to worker with 60s timeout
 */
function executeJobInWorker(job: {
  id: number;
  contentId: number;
  langCode: string;
  version: number;
}): Promise<{ ok?: boolean; skip?: boolean; pdfFilePath?: string; error?: string; durationMs?: number }> {
  return new Promise((resolve, reject) => {
    const worker = getWorker();

    let timer: NodeJS.Timeout | null = null;

    const messageHandler = (msg: any) => {
      if (msg && msg.jobId === job.id) {
        if (timer) clearTimeout(timer);
        worker.off('message', messageHandler);
        worker.off('error', errorHandler);
        resolve(msg);
      }
    };

    const errorHandler = (err: Error) => {
      if (timer) clearTimeout(timer);
      worker.off('message', messageHandler);
      worker.off('error', errorHandler);
      console.error(`💥 [PDFScheduler] Worker crashed for job #${job.id}: ${err?.message || err}`);
      respawnWorker();
      resolve({ ok: false, error: `Worker crashed: ${err?.message || 'unknown worker error'}` });
    };

    timer = setTimeout(() => {
      worker.off('message', messageHandler);
      worker.off('error', errorHandler);
      console.error(`⏱️ [PDFScheduler] Render timed out for job #${job.id} after ${RENDER_TIMEOUT_MS / 1000}s`);
      respawnWorker();
      resolve({ ok: false, error: `Render timed out after ${RENDER_TIMEOUT_MS / 1000}s` });
    }, RENDER_TIMEOUT_MS);

    worker.on('message', messageHandler);
    worker.on('error', errorHandler);

    worker.postMessage({
      jobId: job.id,
      contentId: job.contentId,
      langCode: job.langCode,
      version: job.version,
    });
  });
}

/**
 * Single scheduler tick executed with recursive setTimeout
 */
async function schedulerTick(): Promise<void> {
  if (isShuttingDown) return;

  const now = Date.now();
  if (now < circuitBreakerUntil) {
    // Circuit breaker active; skip tick
    scheduleNextTick(POLL_INTERVAL_MS);
    return;
  }

  tickCount++;
  metrics.lastRunAt = new Date().toISOString();

  try {
    // 1. Run stale lease reaper every 3rd tick (~9s)
    if (tickCount % 3 === 0) {
      await reapStaleJobs();
    }

    // 1b. Run 30-day retention cleanup and tmp orphan sweep once every 24 hours (~28800 ticks)
    if (tickCount % 28800 === 1) {
      await cleanupOldJobRecords(30).catch(() => {});
      await sweepTmpOrphans().catch(() => {});
    }

    // 2. Claim next available queued job
    const job = await claimNextJob();
    if (job) {
      console.log(`📄 [PDFQueue] Claimed job #${job.id} for article #${job.contentId} [${job.langCode}] (v${job.version})`);

      const result = await executeJobInWorker({
        id: job.id,
        contentId: job.contentId,
        langCode: job.langCode,
        version: job.version,
      });

      if (result.ok) {
        const completed = await completeJob(job.id, job.version, result.pdfFilePath);
        if (completed) {
          metrics.completed++;
          consecutiveFailures = 0;
          if (result.durationMs) {
            metrics.totalRenderMs += result.durationMs;
            metrics.avgRenderMs = Math.round(metrics.totalRenderMs / metrics.completed);
          }
          console.log(`✅ [PDFQueue] Completed job #${job.id} in ${result.durationMs ?? 0}ms -> ${result.pdfFilePath}`);
        } else {
          console.log(`🔄 [PDFQueue] Job #${job.id} version bumped mid-render; requeued for fresh render.`);
        }
      } else if (result.skip) {
        metrics.skipped++;
        consecutiveFailures = 0;
        await completeJob(job.id, job.version, null);
        console.log(`⏭️ [PDFQueue] Skipped job #${job.id}: ${result.error || 'validation mismatch'}`);
      } else {
        metrics.failed++;
        metrics.lastError = result.error || 'Render failure';
        consecutiveFailures++;
        await failJob(job.id, result.error || 'Render failure');
        console.error(`❌ [PDFQueue] Failed job #${job.id}: ${result.error}`);

        if (consecutiveFailures >= 3) {
          console.warn('⚠️ [PDFScheduler] Circuit breaker tripped (3 consecutive failures). Pausing queue for 60s.');
          circuitBreakerUntil = Date.now() + 60_000;
          consecutiveFailures = 0;
        }
      }

      // Check worker memory and respawn if RSS threshold exceeded
      try {
        const mem = process.memoryUsage();
        if (mem.rss > RSS_LIMIT_BYTES) {
          console.log(`🧹 [PDFScheduler] Worker RSS (${Math.round(mem.rss / 1024 / 1024)}MB) exceeded guard threshold. Recycling worker.`);
          respawnWorker();
        }
      } catch {}
    }
  } catch (err: any) {
    console.error('⚠️ [PDFScheduler] Error in scheduler tick:', err);
    metrics.lastError = err?.message || 'Scheduler tick error';
  } finally {
    if (!isShuttingDown) {
      scheduleNextTick(POLL_INTERVAL_MS);
    }
  }
}

function scheduleNextTick(delayMs: number): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
  pollTimer = setTimeout(() => {
    schedulerTick().catch((err) => {
      console.error('⚠️ [PDFScheduler] Uncaught error in scheduled tick:', err);
      scheduleNextTick(POLL_INTERVAL_MS);
    });
  }, delayMs);
}

/**
 * Start the background PDF queue scheduler
 */
export function startPdfScheduler(): void {
  if (metrics.isRunning) return;
  metrics.isRunning = true;
  isShuttingDown = false;

  // Clean orphaned tmp files older than 1hr at startup
  sweepTmpOrphans().catch(() => {});

  // Initialize worker and schedule first tick immediately
  getWorker();
  console.log('🚀 [PDFScheduler] Background PDF worker scheduler started.');
  scheduleNextTick(500);
}

/**
 * Gracefully stop the background PDF queue scheduler
 */
export async function stopPdfScheduler(): Promise<void> {
  metrics.isRunning = false;
  isShuttingDown = true;

  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  if (workerInstance) {
    try {
      await workerInstance.terminate();
    } catch {}
    workerInstance = null;
  }

  console.log('🛑 [PDFScheduler] PDF worker scheduler stopped.');
}
