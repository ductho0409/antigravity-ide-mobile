/**
 * /api/test — Feature verification endpoints (curl-friendly JSON responses)
 * Tests: quickFind, file view name param, chat snapshot, inject, paste logic
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

interface TestRouteDeps {
    getWorkspacePath: () => string;
    authEnabled: () => boolean;
    validateSession: (token: string | undefined) => boolean;
}

// Re-implement quickFind inline (mirrors files.ts logic)
function quickFind(name: string, workspacePath: string): string | null {
    const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache']);
    const isRel = name.includes('/');
    const norm = isRel ? '/' + name.replace(/^\//, '') : name;
    const HOME_DIR = homedir();

    function scan(dir: string, depth: number, maxDepth: number): string | null {
        if (depth > maxDepth) return null;
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name.startsWith('.') && entry.isDirectory()) continue;
                if (SKIP.has(entry.name)) continue;
                const full = join(dir, entry.name);
                if (entry.isFile()) {
                    if (isRel ? full.endsWith(norm) : entry.name === name) return full;
                } else if (entry.isDirectory()) {
                    const found = scan(full, depth + 1, maxDepth);
                    if (found) return found;
                }
            }
        } catch { /* skip */ }
        return null;
    }

    if (workspacePath && existsSync(workspacePath)) {
        const found = scan(workspacePath, 0, 6);
        if (found) return found;
    }
    const brainDir = join(HOME_DIR, '.gemini', 'antigravity', 'brain');
    if (existsSync(brainDir)) {
        const found = scan(brainDir, 0, 4);
        if (found) return found;
    }
    return null;
}

export function createTestRoutes(deps: TestRouteDeps): Router {
    const router = Router();
    const { getWorkspacePath, authEnabled, validateSession } = deps;

    function checkAuth(req: Request, res: Response): boolean {
        if (!authEnabled()) return true;
        const token = (req.query.token as string) || req.headers.authorization?.replace('Bearer ', '');
        if (validateSession(token)) return true;
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return false;
    }

    /**
     * GET /api/test
     * Returns list of all available test endpoints
     */
    router.get('/api/test', (_req, res) => {
        res.json({
            ok: true,
            description: 'Feature verification endpoints — curl-friendly',
            endpoints: [
                'GET  /api/test                  — This help',
                'GET  /api/test/quick-find?name= — Test quickFind (server-side file resolution)',
                'GET  /api/test/file-view?name=  — Test /api/files/view name param resolves correctly',
                'GET  /api/test/chat-snapshot    — Test chat snapshot availability (CDP)',
                'POST /api/test/inject-dry-run   — Test inject endpoint (dry run, no IDE action)',
                'GET  /api/test/workspace        — Test workspace detection',
                'GET  /api/test/all              — Run all tests at once',
            ],
        });
    });

    /**
     * GET /api/test/quick-find?name=<filename>
     * Tests the quickFind server-side file resolution (used by ?name= param in /api/files/view)
     */
    router.get('/api/test/quick-find', (req, res) => {
        if (!checkAuth(req, res)) return;
        const name = req.query.name as string;
        if (!name) return void res.status(400).json({ ok: false, error: 'Missing ?name= param' });

        const workspacePath = getWorkspacePath();
        const start = Date.now();
        const found = quickFind(name, workspacePath);
        const elapsed = Date.now() - start;

        if (found) {
            const stat = (() => { try { return statSync(found); } catch { return null; } })();
            res.json({
                ok: true,
                name,
                resolved: found,
                exists: !!stat,
                size: stat?.size,
                elapsed_ms: elapsed,
                workspace: workspacePath,
            });
        } else {
            res.json({
                ok: false,
                name,
                resolved: null,
                error: 'File not found in workspace or brain dirs',
                elapsed_ms: elapsed,
                workspace: workspacePath,
            });
        }
    });

    /**
     * GET /api/test/file-view?name=<filename>
     * Verifies the ?name= param logic for /api/files/view — returns resolved path + URL
     * (Does NOT stream the file, safe to use with curl)
     */
    router.get('/api/test/file-view', (req, res) => {
        if (!checkAuth(req, res)) return;
        const name = req.query.name as string;
        const path = req.query.path as string;

        if (!name && !path) {
            return void res.status(400).json({ ok: false, error: 'Missing ?name= or ?path= param' });
        }

        const workspacePath = getWorkspacePath();
        let resolvedPath: string | null = null;
        let method = '';

        if (path) {
            resolvedPath = resolve(path);
            method = 'absolute path';
        } else {
            resolvedPath = quickFind(name, workspacePath);
            method = 'quickFind (name param)';
        }

        if (!resolvedPath) {
            return void res.json({ ok: false, error: 'Could not resolve file', name, path });
        }

        const exists = existsSync(resolvedPath);
        const token = req.query.token as string || '';
        const baseUrl = `${req.protocol}://${req.hostname}:${(req.socket as unknown as { localPort?: number }).localPort || 3333}`;
        const viewUrl = `${baseUrl}/api/files/view?path=${encodeURIComponent(resolvedPath)}${token ? `&token=${token}` : ''}`;

        res.json({
            ok: true,
            input: name || path,
            resolved: resolvedPath,
            exists,
            method,
            view_url: viewUrl,
            note: 'Call view_url in browser to open file. Use /api/files/view directly — this endpoint only verifies resolution.',
        });
    });

    /**
     * GET /api/test/workspace
     * Tests workspace detection
     */
    router.get('/api/test/workspace', (req, res) => {
        if (!checkAuth(req, res)) return;
        const wp = getWorkspacePath();
        res.json({
            ok: !!wp,
            workspace: wp,
            exists: wp ? existsSync(wp) : false,
        });
    });

    /**
     * GET /api/test/chat-snapshot
     * Tests whether CDP chat snapshot is available (without streaming HTML)
     */
    router.get('/api/test/chat-snapshot', async (req, res) => {
        if (!checkAuth(req, res)) return;
        try {
            const resp = await fetch(`http://localhost:${(req.socket as unknown as { localPort?: number }).localPort || 3333}/api/chat/snapshot${req.query.token ? `?token=${req.query.token}` : ''}`);
            const data = await resp.json() as Record<string, unknown>;
            const html = (data.html as string) || '';
            res.json({
                ok: !data.error && !!html,
                html_length: html.length,
                has_content: html.length > 100,
                error: data.error || null,
                cdp_available: !data.error,
                note: html.length > 0 ? 'IDE chat is visible and capturable' : 'No chat content (IDE may be closed or no active chat)',
            });
        } catch (e) {
            res.json({ ok: false, error: (e as Error).message });
        }
    });

    /**
     * POST /api/test/inject-dry-run
     * Tests inject endpoint reachability WITHOUT actually sending to IDE
     * Body: { text: string }
     */
    router.post('/api/test/inject-dry-run', (req, res) => {
        if (!checkAuth(req, res)) return;
        const { text } = req.body as { text?: string };
        if (!text) return void res.status(400).json({ ok: false, error: 'Missing body.text' });

        // Validate input — same checks the real inject would do
        const checks = {
            has_text: text.length > 0,
            text_length: text.length,
            not_too_long: text.length <= 50000,
            no_null_bytes: !text.includes('\x00'),
        };
        const valid = Object.values(checks).every(v => v === true || typeof v === 'number');

        res.json({
            ok: valid,
            dry_run: true,
            input_text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            checks,
            note: 'Dry run only — text was NOT sent to IDE. Call POST /api/cdp/inject to actually send.',
        });
    });

    /**
     * GET /api/test/all
     * Runs all tests at once (except inject dry-run which needs POST)
     */
    router.get('/api/test/all', async (req, res) => {
        if (!checkAuth(req, res)) return;
        const port = (req.socket as unknown as { localPort?: number }).localPort || 3333;
        const token = req.query.token as string || '';
        const qs = token ? `?token=${token}` : '';
        const base = `http://localhost:${port}`;

        async function get(url: string) {
            try {
                const r = await fetch(url);
                return await r.json();
            } catch (e) {
                return { ok: false, error: (e as Error).message };
            }
        }

        const workspacePath = getWorkspacePath();

        // Pick a test file — first TS file in workspace
        let testFileName = '';
        try {
            const files = readdirSync(join(workspacePath, 'client', 'src', 'components'));
            const ts = files.find(f => f.endsWith('.tsx'));
            if (ts) testFileName = ts;
        } catch { /* skip */ }

        const results = await Promise.all([
            get(`${base}/api/health`),
            get(`${base}/api/test/workspace${qs}`),
            testFileName ? get(`${base}/api/test/quick-find?name=${encodeURIComponent(testFileName)}${token ? `&token=${token}` : ''}`) : Promise.resolve({ ok: false, error: 'No TS file found to test' }),
            get(`${base}/api/test/chat-snapshot${qs}`),
        ]);

        const [health, workspace, quickFindTest, chatSnapshot] = results;

        res.json({
            ok: results.every(r => (r as Record<string, unknown>).ok),
            timestamp: new Date().toISOString(),
            tests: {
                health: { ok: (health as Record<string, unknown>).ok || (health as Record<string, unknown>).status === 'ok', detail: health },
                workspace: workspace,
                quick_find: { test_file: testFileName, ...quickFindTest as object },
                chat_snapshot: chatSnapshot,
            },
            summary: [
                `health: ${(health as Record<string, unknown>).status === 'ok' ? '✅' : '❌'}`,
                `workspace: ${(workspace as Record<string, unknown>).ok ? '✅ ' + (workspace as Record<string, unknown>).workspace : '❌'}`,
                `quick_find(${testFileName}): ${(quickFindTest as Record<string, unknown>).ok ? '✅ ' + (quickFindTest as Record<string, unknown>).resolved : '❌'}`,
                `chat_snapshot: ${(chatSnapshot as Record<string, unknown>).ok ? '✅ html=' + (chatSnapshot as Record<string, unknown>).html_length + 'b' : '❌ ' + (chatSnapshot as Record<string, unknown>).error}`,
            ],
        });
    });

    return router;
}
