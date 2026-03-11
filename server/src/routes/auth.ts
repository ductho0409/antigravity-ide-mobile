/**
 * Auth Routes — Login, logout, status, internal PIN setting
 * 1:1 migration from routes/auth.mjs
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AuthRouteDeps, AuthState } from '../types.js';

export function createAuthRoutes(deps: AuthRouteDeps): Router {
    const router = Router();
    const {
        localhostOnly, authState, hashPin, generateSessionToken, validateSession,
        checkLoginRateLimit, recordFailedLogin, clearLoginAttempts, emitEvent
    } = deps;

    // Check if auth is enabled
    router.get('/api/auth/status', (_req: Request, res: Response) => {
        res.json({ authEnabled: authState.authEnabled });
    });

    // Login with PIN
    router.post('/api/auth/login', (req: Request, res: Response) => {
        if (!authState.authEnabled) {
            return res.json({ success: true, token: 'no-auth-required' });
        }

        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const rateLimit = checkLoginRateLimit(ip);
        if (!rateLimit.allowed) {
            return res.status(429).json({
                error: 'Too many login attempts',
                retryAfter: rateLimit.retryAfter
            });
        }

        const { pin } = req.body;
        const hashedInput = hashPin(pin || '');

        if (hashedInput === authState.authPinHash) {
            const token = generateSessionToken();
            authState.validSessions.add(token);
            clearLoginAttempts(ip);
            emitEvent('success', `Login successful from ${ip}`);
            res.json({ success: true, token });
        } else {
            recordFailedLogin(ip);
            const remaining = rateLimit.remaining !== undefined ? rateLimit.remaining - 1 : 4;
            emitEvent('warning', `Failed login attempt from ${ip} (${remaining} attempts left)`);
            res.status(401).json({ error: 'Invalid PIN', attemptsRemaining: remaining });
        }
    });

    // Logout
    router.post('/api/auth/logout', (req: Request, res: Response) => {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            authState.validSessions.delete(token);
        }
        res.json({ success: true });
    });

    // Internal: set PIN from launcher script
    router.post('/api/internal/set-pin', localhostOnly, (req: Request, res: Response) => {
        const { pin } = req.body;
        if (!pin) {
            authState.authEnabled = false;
            authState.authPinHash = null;
            authState.validSessions.clear();
            console.log('🔓 PIN authentication disabled via launcher');
            emitEvent('config', 'PIN authentication disabled via launcher');
            return res.json({ success: true, authEnabled: false });
        }
        if (pin.length >= 4 && pin.length <= 6 && /^\d+$/.test(pin)) {
            authState.authEnabled = true;
            authState.authPinHash = hashPin(pin);
            authState.validSessions.clear();
            console.log('🔐 PIN authentication updated via launcher');
            emitEvent('config', 'PIN authentication enabled via launcher');
            return res.json({ success: true, authEnabled: true });
        }
        res.status(400).json({ error: 'Invalid PIN (must be 4-6 digits)' });
    });

    // Health check (before auth middleware)
    router.get('/api/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            authEnabled: authState.authEnabled,
            uptime: process.uptime()
        });
    });

    return router;
}

/**
 * Create the auth middleware (applied to all /api/* routes after auth routes)
 */
export function createApiAuthMiddleware(
    authState: AuthState,
    validateSession: (token: string | undefined) => boolean
): (req: Request, res: Response, next: () => void) => void {
    return (req: Request, res: Response, next: () => void): void => {
        // Skip auth check for auth and admin endpoints
        if (req.path.startsWith('/auth/') || req.path.startsWith('/admin/')) {
            return next();
        }
        // Skip internal endpoints
        if (req.path.startsWith('/internal/')) {
            return next();
        }
        // Skip health check and status
        if (req.path === '/health' || req.path === '/status') {
            return next();
        }

        if (!authState.authEnabled) {
            return next();
        }

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (validateSession(token)) {
            next();
        } else {
            res.status(401).json({ error: 'Unauthorized', needsAuth: true });
        }
    };
}
