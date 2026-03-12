/**
 * useApi — Server URL, auth token, fetch helpers
 * Ported from public/js/mobile/api.js
 */

const SERVER_URL = window.location.origin;

function getToken(): string | null {
    return localStorage.getItem('authToken');
}

function setToken(token: string): void {
    localStorage.setItem('authToken', token);
}

export function clearToken(): void {
    localStorage.removeItem('authToken');
}

export function getServerUrl(): string {
    return SERVER_URL;
}

/**
 * Fetch wrapper that attaches auth token + 15s timeout
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
        ...(options.headers as Record<string, string> || {}),
    };

    const token = getToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Antigravity Mobile Tracking
    headers['X-Antigravity-Mobile-Tracking'] = 'Antigravitymobile';

    // Timeout: 15s (CDP retry can take up to 6s, plus network latency)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(url, {
            ...options,
            headers,
            signal: options.signal || controller.signal,
        });

        // Handle 401 — clear token if server says auth is required
        if (res.status === 401) {
            try {
                const cloned = res.clone();
                const data = await cloned.json();
                if (data.needsAuth) {
                    clearToken();
                    // Force page reload to show login screen
                    window.location.reload();
                }
            } catch (_e) {
                // Ignore JSON parse errors
            }
        }

        return res;
    } catch (e) {
        if ((e as Error).name === 'AbortError') {
            throw new Error('Request timed out — server not responding');
        }
        throw e;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Check auth status from server
 */
export async function checkAuthStatus(): Promise<{ authEnabled: boolean; authenticated: boolean }> {
    try {
        const res = await fetch(`${SERVER_URL}/api/auth/status`);
        const data = await res.json();

        if (!data.authEnabled) {
            return { authEnabled: false, authenticated: true };
        }

        // Auth enabled — check if current token is valid
        const token = getToken();
        if (token) {
            const testRes = await authFetch(`${SERVER_URL}/api/status`);
            if (testRes.ok) {
                return { authEnabled: true, authenticated: true };
            }
        }

        return { authEnabled: true, authenticated: false };
    } catch (_e) {
        console.error('Auth check failed:', _e);
        return { authEnabled: false, authenticated: false };
    }
}

/**
 * Submit PIN to authenticate
 */
export async function loginWithPin(pin: string): Promise<{ success: boolean; error?: string }> {
    try {
        const res = await fetch(`${SERVER_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin }),
        });

        const data = await res.json();

        if (data.success) {
            setToken(data.token);
            return { success: true };
        }

        return { success: false, error: data.error || 'Invalid PIN' };
    } catch (_e) {
        return { success: false, error: 'Connection error' };
    }
}

/**
 * Basic tracking utility
 */
export function track(event: string, data?: any): void {
    console.log(`[Tracking] ${event}`, data);
    // Future: send to server analytics endpoint if needed
}
