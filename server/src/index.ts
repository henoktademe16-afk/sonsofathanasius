import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { config } from './config/index.js';
import { securityHeaders, corsMiddleware, methodAllowlist } from './middleware/security.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import apiRouter from './routes/index.js';
import { initializeSearchIndex } from './services/searchService.js';
import { sweepExpiredSessions } from './middleware/auth.js';
import { startPdfScheduler, stopPdfScheduler } from './pdf/pdfScheduler.js';
import { enqueuePdfJob } from './pdf/pdfJobs.js';
import { db } from './db/index.js';
import { content, contentTranslations } from './db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

const app = express();

// 0. Trust only loopback reverse proxies (cPanel LiteSpeed + Passenger).
//    NOT `true`: that would let clients spoof X-Forwarded-For and bypass rate limits.
app.set('trust proxy', 'loopback');

// 1. Security & Method Allowlist Middleware
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(methodAllowlist);

// 2. Cookie & Body Parsing Middleware
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 3. Static Uploads File Serving (Local dev parity with production Apache web root)
app.use('/uploads', express.static(config.storage.uploadsDir));

// 4. Global Rate Limiter for API
app.use('/api/', generalLimiter);

// 5. API Documentation Alias & API v1 Master Router
app.get('/api/docs', (_req: Request, res: Response) => res.redirect('/api/v1/docs'));
app.use('/api/v1', apiRouter);

// 6. Root route
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'ደቂቀ አትናቴዎስ (Sons of Athanasius) API',
    version: '2.0.0',
    documentation: '/api/v1/docs',
    openApiSpec: '/api/v1/docs.json',
    health: '/api/v1/health',
  });
});

// 7. Global 404 Handler
app.use(notFoundHandler);

// 8. Centralized Error Handler (Express 5 native async support)
app.use(errorHandler);

/**
 * Ensure storage directories exist on disk
 */
export function ensureStorageDirs(): void {
  if (!fs.existsSync(config.storage.coversDir)) {
    fs.mkdirSync(config.storage.coversDir, { recursive: true });
  }
  if (!fs.existsSync(config.storage.pdfDir)) {
    fs.mkdirSync(config.storage.pdfDir, { recursive: true });
  }
}

// 9. Server Boot
ensureStorageDirs();

if (config.nodeEnv !== 'test') {
  const server = app.listen(config.port, async () => {
    console.log(`☦ [Sons of Athanasius API] Server running on http://localhost:${config.port} (${config.nodeEnv})`);

    // Warm up in-memory full-text search index
    await initializeSearchIndex();

    // Start background PDF queue worker scheduler (non-blocking)
    startPdfScheduler();

    // Boot Enqueue Sweep (INSERT-only, no render on main thread)
    void (async () => {
      try {
        const publishedRows = await db
          .select({
            contentId: content.id,
            langCode: contentTranslations.langCode,
            pdfFilePath: contentTranslations.pdfFilePath,
          })
          .from(contentTranslations)
          .innerJoin(content, eq(contentTranslations.contentId, content.id))
          .where(
            and(
              eq(contentTranslations.status, 'published'),
              eq(contentTranslations.pdfEnabled, 1)
            )
          );

        let enqueuedCount = 0;
        for (const row of publishedRows) {
          const isMissingOnDisk =
            !row.pdfFilePath ||
            !fs.existsSync(path.join(config.storage.pdfDir, path.basename(row.pdfFilePath)));

          if (isMissingOnDisk) {
            await enqueuePdfJob(row.contentId, row.langCode);
            enqueuedCount++;
          }
        }

        if (enqueuedCount > 0) {
          console.log(`📄 [PDFQueue] Boot sweep enqueued ${enqueuedCount} missing PDF jobs for background generation.`);
        }
      } catch (err) {
        console.error('⚠️ [PDFQueue] Error during boot enqueue sweep:', err);
      }
    })();

    // Clean up any stale expired sessions on startup
    await sweepExpiredSessions();

    // Check for legacy articles exceeding 500KB cap
    void (async () => {
      try {
        const [row] = (await db.execute(sql`SELECT MAX(LENGTH(body)) as maxLen FROM content_translations`)) as any;
        const maxLen = Number(row?.[0]?.maxLen || 0);
        if (maxLen > 500_000) {
          console.warn(`⚠️ [DB] Warning: Found legacy translations exceeding 500KB cap (max size: ${(maxLen / 1024).toFixed(1)} KB).`);
        }
      } catch {}
    })();
  });

  // Graceful Shutdown
  const shutdown = async () => {
    console.log('Shutdown signal received. Shutting down gracefully...');
    await stopPdfScheduler();
    server.close(() => {
      console.log('Server closed. Process terminated.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export default app;
