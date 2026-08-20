import { Router } from 'express';
import {
  loginController,
  logoutController,
  getMeController,
  logoutAllController,
} from '../controllers/authController.js';
import { verifyAdminSession } from '../middleware/auth.js';
import { authLimiter, authIpLimiter } from '../middleware/rateLimiter.js';

const router = Router();

/**
 * @openapi
 * /api/v1/admin/auth/login:
 *   post:
 *     summary: Admin login
 *     description: Authenticate admin with username/email and password, establish DB-backed session, and set host-only httpOnly cookie.
 *     tags:
 *       - Admin Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - password
 *             properties:
 *               identifier:
 *                 type: string
 *                 example: admin
 *               password:
 *                 type: string
 *                 format: password
 *                 example: AdminSecretPass123!
 *     responses:
 *       200:
 *         description: Login successful, returns admin profile and sets soa_admin_session cookie
 *       401:
 *         description: Invalid credentials or deactivated account
 *       429:
 *         description: Too many login attempts
 */
router.post('/login', authLimiter, authIpLimiter, loginController);

/**
 * @openapi
 * /api/v1/admin/auth/logout:
 *   post:
 *     summary: Admin logout
 *     description: Terminate current session in database, evict cache, and clear soa_admin_session cookie.
 *     tags:
 *       - Admin Auth
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post('/logout', verifyAdminSession, logoutController);

/**
 * @openapi
 * /api/v1/admin/auth/me:
 *   get:
 *     summary: Get current admin profile
 *     description: Returns the authenticated admin profile and role from the current valid session.
 *     tags:
 *       - Admin Auth
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Authenticated admin profile
 *       401:
 *         description: Unauthorized / invalid session
 */
router.get('/me', verifyAdminSession, getMeController);

/**
 * @openapi
 * /api/v1/admin/auth/logout-all:
 *   post:
 *     summary: Revoke all active sessions
 *     description: Remote session kill-switch. Deletes all active sessions for the current admin across all devices.
 *     tags:
 *       - Admin Auth
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: All sessions terminated successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/logout-all', verifyAdminSession, logoutAllController);

export default router;
