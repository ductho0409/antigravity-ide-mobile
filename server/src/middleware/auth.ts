/**
 * Middleware — Auth & access control
 * 1:1 migration from middleware/auth.mjs
 */
import type { Request, Response, NextFunction } from 'express';
import type { AuthState, RateLimitResult } from '../types.js';

/**
 * Restrict access to localhost-only requests
 */
export function localhostOnly(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLocal) return next();
    res.status(403).json({ error: 'Admin access is localhost only' });
}

/**
 * Create auth middleware that checks session tokens
 */
export function createAuthMiddleware(authState: AuthState): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!authState.authEnabled) return next();

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token && authState.validSessions.has(token)) {
            return next();
        }

        res.status(401).json({ error: 'Unauthorized', needsAuth: true });
    };
}

// ============================================================================
// Login Rate Limiting — per-IP cooldown
// ============================================================================
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface LoginAttemptEntry {
    count: number;
    firstAttempt: number;
}

const loginAttempts = new Map<string, LoginAttemptEntry>();

export function checkLoginRateLimit(ip: string): RateLimitResult {
    const entry = loginAttempts.get(ip);
    if (!entry) return { allowed: true };

    const elapsed = Date.now() - entry.firstAttempt;
    if (elapsed > LOGIN_LOCKOUT_MS) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }

    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        const retryAfter = Math.ceil((LOGIN_LOCKOUT_MS - elapsed) / 1000);
        return { allowed: false, remaining: 0, retryAfter };
    }

    return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS - entry.count };
}

export function recordFailedLogin(ip: string): void {
    const entry = loginAttempts.get(ip) || { count: 0, firstAttempt: Date.now() };
    entry.count++;
    loginAttempts.set(ip, entry);
}

export function clearLoginAttempts(ip: string): void {
    loginAttempts.delete(ip);
}

// Clean up stale rate-limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of loginAttempts) {
        if (now - entry.firstAttempt > LOGIN_LOCKOUT_MS * 2) {
            loginAttempts.delete(ip);
        }
    }
}, 5 * 60 * 1000);

/**
 * Create admin guard that blocks tunnel-proxied requests without valid auth.
 * When cloudflared proxies a request, it arrives from 127.0.0.1 but includes
 * Cf-Connecting-Ip and Cf-Ray headers — we detect these to require PIN auth.
 */
export function createAdminGuard(authState: AuthState): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
        const ip = req.ip || req.socket?.remoteAddress || '';
        const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

        if (!isLocal) {
            res.status(403).json({ error: 'Admin access is localhost only' });
            return;
        }

        const isTunnelProxied = !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);

        if (!isTunnelProxied) return next();

        // Tunnel-proxied request — require valid session token
        if (!authState.authEnabled) {
            res.status(403).json({ error: 'PIN required for remote access' });
            return;
        }

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token && authState.validSessions.has(token)) {
            return next();
        }

        res.status(401).json({ error: 'Unauthorized', needsAuth: true });
    };
}
