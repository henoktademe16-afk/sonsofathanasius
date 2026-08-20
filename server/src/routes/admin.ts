import { Router } from 'express';
import { adminLimiter } from '../middleware/rateLimiter.js';
import { verifyAdminSession, requireRole } from '../middleware/auth.js';
import {
  createArticleController,
  updateArticleController,
  deleteArticleController,
  upsertTranslationController,
  deleteTranslationController,
} from '../controllers/adminController.js';
import { uploadCoverController } from '../controllers/uploadController.js';

const router = Router();

// ==========================================
// 1. ADMIN ARTICLE MUTATIONS
// ==========================================

/**
 * Create new article container, translations, media, and tags atomically
 * POST /api/v1/admin/articles
 */
router.post(
  '/articles',
  adminLimiter,
  verifyAdminSession,
  requireRole('superadmin', 'editor'),
  createArticleController
);

/**
 * Update existing article container, translations, media, and tags
 * PUT /api/v1/admin/articles/:id
 */
router.put(
  '/articles/:id',
  adminLimiter,
  verifyAdminSession,
  requireRole('superadmin', 'editor'),
  updateArticleController
);

/**
 * Delete article container and cascade delete translations, media, tags, and static PDFs
 * DELETE /api/v1/admin/articles/:id (Superadmin only)
 */
router.delete(
  '/articles/:id',
  adminLimiter,
  verifyAdminSession,
  requireRole('superadmin'),
  deleteArticleController
);

/**
 * Add or update translation for an existing article
 * POST /api/v1/admin/articles/:id/translations
 */
router.post(
  '/articles/:id/translations',
  adminLimiter,
  verifyAdminSession,
  requireRole('superadmin', 'editor', 'translator'),
  upsertTranslationController
);

/**
 * Delete a specific language translation for an existing article
 * DELETE /api/v1/admin/articles/:id/translations/:langCode
 */
router.delete(
  '/articles/:id/translations/:langCode',
  adminLimiter,
  verifyAdminSession,
  requireRole('superadmin', 'editor'),
  deleteTranslationController
);

// ==========================================
// 2. ADMIN MEDIA UPLOADS
// ==========================================

/**
 * Upload cover image
 * POST /api/v1/admin/covers/upload
 */
router.post(
  '/covers/upload',
  adminLimiter,
  verifyAdminSession,
  requireRole('superadmin', 'editor'),
  uploadCoverController
);

export default router;
