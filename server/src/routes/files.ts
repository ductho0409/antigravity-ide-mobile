/**
 * File Routes — Browser, viewer, editor, upload, workspace
 * 1:1 migration from routes/files.mjs
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { join, extname, basename, resolve, dirname } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import type multer from 'multer';

interface FileRouteDeps {
    pathStartsWith: (path: string, prefix: string) => boolean;
    pathEquals: (path1: string, path2: string) => boolean;
    isWindows: boolean;
    startWatching: (folderPath: string) => void;
    stopWatching: () => void;
    getWorkspacePath: () => string;
    setWorkspacePath: (p: string) => void;
    upload: multer.Multer;
    UPLOADS_DIR: string;
    // For token-based auth in download/view (browser tabs can't set headers)
    authEnabled: () => boolean;
    validateSession: (token: string | undefined) => boolean;
}

export function createFileRoutes(deps: FileRouteDeps): Router {
    const router = Router();
    const {
        pathStartsWith, isWindows,
        startWatching, stopWatching,
        getWorkspacePath, setWorkspacePath,
        upload, UPLOADS_DIR,
        authEnabled, validateSession
    } = deps;

    // Helper: validate token from query param OR Authorization header
    function checkQueryAuth(req: import('express').Request, res: import('express').Response): boolean {
        if (!authEnabled()) return true;
        const token = (req.query.token as string) || req.headers.authorization?.replace('Bearer ', '');
        if (validateSession(token)) return true;
        res.status(401).send('<!DOCTYPE html><html><body style="background:#0d1117;color:#f85149;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:1rem"><h2>\uD83D\uDD12 Unauthorized</h2><p>Your session has expired. Please login again.</p></body></html>');
        return false;
    }

    // Helper: allow read access to files within user home dir (for view/download/raw endpoints)
    // This supports artifact files like ~/.gemini/brain/... that are outside the project workspace.
    const HOME_DIR = homedir();
    function isReadAllowed(resolvedPath: string): boolean {
        const workspacePath = getWorkspacePath();
        // Primary: within workspace
        if (workspacePath && pathStartsWith(resolvedPath, resolve(workspacePath))) return true;
        // Fallback: anywhere within user home directory (read-only endpoints only)
        if (pathStartsWith(resolvedPath, HOME_DIR)) return true;
        return false;
    }

    // ── Upload ────────────────────────────────────────────────────────
    router.post('/api/upload', upload.single('image'), async (req: Request, res: Response) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
            const filePath = join(UPLOADS_DIR, req.file.filename);
            const fileUrl = `/uploads/${req.file.filename}`;
            res.json({
                success: true,
                filename: req.file.filename,
                originalName: req.file.originalname,
                path: filePath,
                url: fileUrl,
                size: req.file.size
            });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Workspace ─────────────────────────────────────────────────────
    router.post('/api/workspace', (req: Request, res: Response) => {
        const { path } = req.body;
        if (path && existsSync(path)) {
            setWorkspacePath(path);
            res.json({ success: true, workspace: path });
        } else {
            res.status(400).json({ error: 'Invalid path' });
        }
    });

    router.get('/api/workspace', (_req: Request, res: Response) => {
        res.json({ workspace: getWorkspacePath() });
    });

    // ── File Browser ──────────────────────────────────────────────────
    router.get('/api/files', (req: Request, res: Response) => {
        try {
            const workspacePath = getWorkspacePath();
            const requestedPath = (req.query.path as string) || workspacePath;
            const fullPath = resolve(requestedPath);

            if (!existsSync(fullPath)) return res.status(404).json({ error: 'Path not found' });

            const stats = statSync(fullPath);
            if (!stats.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

            const items = readdirSync(fullPath).map(name => {
                const itemPath = join(fullPath, name);
                try {
                    const itemStats = statSync(itemPath);
                    return {
                        name, path: itemPath,
                        isDirectory: itemStats.isDirectory(),
                        size: itemStats.size,
                        modified: itemStats.mtime,
                        extension: itemStats.isDirectory() ? null : extname(name).toLowerCase()
                    };
                } catch {
                    return { name, error: 'Access denied', isDirectory: false, size: 0, modified: null, extension: null, path: itemPath };
                }
            }).filter(item => !item.name.startsWith('.') && item.name !== 'node_modules');

            items.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });

            const parent = dirname(fullPath);
            const isAtFilesystemRoot = parent === fullPath || (isWindows && /^[A-Z]:\\?$/i.test(fullPath));

            startWatching(fullPath);

            res.json({
                path: fullPath,
                parent: isAtFilesystemRoot ? null : parent,
                items,
                isRoot: isAtFilesystemRoot,
                workspaceRoot: resolve(workspacePath)
            });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── File Search ───────────────────────────────────────────────────
    router.get('/api/files/find', (req: Request, res: Response) => {
        try {
            const name = req.query.name as string;
            if (!name) return res.status(400).json({ error: 'name required' });

            const workspacePath = getWorkspacePath();
            const results: string[] = [];
            const searched = new Set<string>();
            const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache']);

            const isRelativePath = name.includes('/');
            const normalizedName = isRelativePath ? '/' + name.replace(/^\//, '') : name;

            function search(dir: string, depth = 0): void {
                if (depth > 8 || results.length >= 5) return;
                const resolved = resolve(dir);
                if (searched.has(resolved)) return;
                searched.add(resolved);
                try {
                    const entries = readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.name.startsWith('.') && entry.isDirectory()) continue;
                        if (SKIP_DIRS.has(entry.name)) continue;

                        const fullPath = join(dir, entry.name);
                        if (entry.isFile()) {
                            if (isRelativePath) {
                                if (fullPath.endsWith(normalizedName)) {
                                    results.push(fullPath);
                                }
                            } else {
                                if (entry.name === name) {
                                    results.push(fullPath);
                                }
                            }
                        } else if (entry.isDirectory()) {
                            search(fullPath, depth + 1);
                        }
                    }
                } catch { /* skip permission errors */ }
            }

            search(workspacePath);
            const projectRoot = resolve(process.cwd());
            if (resolve(workspacePath) !== projectRoot) {
                search(projectRoot);
            }

            // If still no results, search the AI brain/artifact directory
            // (hidden dirs like .gemini are skipped in workspace search)
            if (results.length === 0) {
                const brainDir = join(HOME_DIR, '.gemini', 'antigravity', 'brain');
                function searchBrain(dir: string, depth = 0): void {
                    if (depth > 4 || results.length >= 5) return;
                    try {
                        const entries = readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.name.startsWith('.')) continue;
                            const fullPath = join(dir, entry.name);
                            if (entry.isFile()) {
                                if (isRelativePath ? fullPath.endsWith(normalizedName) : entry.name === name) {
                                    results.push(fullPath);
                                }
                            } else if (entry.isDirectory()) {
                                searchBrain(fullPath, depth + 1);
                            }
                        }
                    } catch { /* skip */ }
                }
                searchBrain(brainDir);
            }

            res.json({ results, query: name });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Content Search (grep) ─────────────────────────────────────────
    router.get('/api/files/search', (req: Request, res: Response) => {
        try {
            const query = req.query.query as string;
            if (!query) return res.status(400).json({ error: 'query required' });

            const caseSensitive = req.query.caseSensitive === 'true';
            const maxResults = Math.min(Math.max(parseInt(req.query.maxResults as string) || 50, 1), 200);

            const workspacePath = getWorkspacePath();
            if (!existsSync(workspacePath)) return res.json({ results: [], query, totalMatches: 0, truncated: false });

            const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache']);
            const textExtensions = ['.txt', '.md', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.html', '.css', '.py', '.sh', '.bat', '.yml', '.yaml', '.xml', '.csv', '.log', '.env', '.gitignore', '.rs', '.go', '.java', '.rb', '.php', '.swift', '.kt', '.c', '.h', '.cpp', '.hpp', '.vue', '.svelte', '.prisma', '.graphql', '.toml', '.mts'];
            const MAX_FILE_SIZE = 1024 * 1024;

            interface SearchResult { file: string; line: string; lineNumber: number; column: number; context: string }
            const results: SearchResult[] = [];
            let totalMatches = 0;
            const searched = new Set<string>();

            const searchQuery = caseSensitive ? query : query.toLowerCase();

            function searchDir(dir: string, depth = 0): void {
                if (depth > 8 || results.length >= maxResults) return;
                const resolved = resolve(dir);
                if (searched.has(resolved)) return;
                searched.add(resolved);
                try {
                    const entries = readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (results.length >= maxResults) return;
                        if (entry.name.startsWith('.') && entry.isDirectory()) continue;
                        if (SKIP_DIRS.has(entry.name)) continue;

                        const fullPath = join(dir, entry.name);
                        if (entry.isFile()) {
                            const ext = extname(entry.name).toLowerCase();
                            if (!textExtensions.includes(ext)) continue;
                            try {
                                const stats = statSync(fullPath);
                                if (stats.size > MAX_FILE_SIZE) continue;
                            } catch { continue; }

                            let content: string;
                            try { content = readFileSync(fullPath, 'utf-8'); } catch { continue; }

                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                if (results.length >= maxResults) break;
                                const lineText = lines[i];
                                const compareLine = caseSensitive ? lineText : lineText.toLowerCase();
                                const col = compareLine.indexOf(searchQuery);
                                if (col === -1) continue;

                                totalMatches++;
                                const prev = i > 0 ? lines[i - 1] : '';
                                const next = i < lines.length - 1 ? lines[i + 1] : '';
                                const contextLines: string[] = [];
                                if (i > 0) contextLines.push(prev);
                                contextLines.push(lineText);
                                if (i < lines.length - 1) contextLines.push(next);
                                const context = contextLines.join('\n');

                                results.push({
                                    file: fullPath,
                                    line: lineText.trim(),
                                    lineNumber: i + 1,
                                    column: col,
                                    context
                                });
                            }
                        } else if (entry.isDirectory()) {
                            searchDir(fullPath, depth + 1);
                        }
                    }
                } catch { /* skip permission errors */ }
            }

            searchDir(workspacePath);
            res.json({ results, query, totalMatches, truncated: results.length >= maxResults });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Git Diff ──────────────────────────────────────────────────────
    router.get('/api/files/diff', (req: Request, res: Response) => {
        try {
            const filePath = req.query.path as string;
            if (!filePath) return res.status(400).json({ error: 'path required' });

            const fullPath = resolve(filePath);
            if (!existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

            let gitRoot: string;
            try {
                gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
                    cwd: dirname(fullPath), encoding: 'utf8'
                }).trim();
            } catch {
                return res.json({ diff: null, reason: 'Not a git repository' });
            }

            let diffOutput = '';
            try {
                diffOutput = execFileSync('git', ['diff', 'HEAD', '--', fullPath], {
                    cwd: gitRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024
                });
                if (!diffOutput.trim()) {
                    diffOutput = execFileSync('git', ['diff', 'HEAD~1', '--', fullPath], {
                        cwd: gitRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024
                    });
                }
            } catch { /* may fail on first commit */ }

            if (!diffOutput.trim()) {
                return res.json({ diff: null, reason: 'No changes found' });
            }

            interface DiffLine { type: 'add' | 'del' | 'ctx'; content: string }
            interface HunkData { header: string; oldStart: number; newStart: number; context: string; lines: DiffLine[] }

            const lines = diffOutput.split('\n');
            const hunks: HunkData[] = [];
            let currentHunk: HunkData | null = null;

            for (const line of lines) {
                if (line.startsWith('@@')) {
                    const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@(.*)/);
                    if (match) {
                        currentHunk = {
                            header: line,
                            oldStart: parseInt(match[1]),
                            newStart: parseInt(match[2]),
                            context: match[3]?.trim() || '',
                            lines: []
                        };
                        hunks.push(currentHunk);
                    }
                } else if (currentHunk) {
                    if (line.startsWith('+')) {
                        currentHunk.lines.push({ type: 'add', content: line.slice(1) });
                    } else if (line.startsWith('-')) {
                        currentHunk.lines.push({ type: 'del', content: line.slice(1) });
                    } else if (line.startsWith(' ') || line === '') {
                        currentHunk.lines.push({ type: 'ctx', content: line.slice(1) });
                    }
                }
            }

            const diffName = basename(fullPath);
            const ext = extname(fullPath).toLowerCase();
            const diffStats = { added: 0, deleted: 0 };
            const addedLines: number[] = [];
            const deletedInserts: { beforeLine: number; content: string }[] = [];

            hunks.forEach(h => {
                let newLine = h.newStart;
                let oldLine = h.oldStart;
                h.lines.forEach(l => {
                    if (l.type === 'add') { diffStats.added++; addedLines.push(newLine); newLine++; }
                    else if (l.type === 'del') { diffStats.deleted++; deletedInserts.push({ beforeLine: newLine, content: l.content }); oldLine++; }
                    else { oldLine++; newLine++; }
                });
            });

            res.json({ diff: { hunks, name: diffName, ext, path: fullPath, stats: diffStats, addedLines, deletedInserts } });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    router.post('/api/files/unwatch', (_req: Request, res: Response) => {
        stopWatching();
        res.json({ success: true });
    });

    // ── File Content ──────────────────────────────────────────────────
    router.get('/api/files/content', (req: Request, res: Response) => {
        try {
            const filePath = req.query.path as string;
            if (!filePath) return res.status(400).json({ error: 'Path required' });
            if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

            const workspacePath = getWorkspacePath();
            const resolvedPath = resolve(filePath);
            const workspaceRoot = resolve(workspacePath);
            if (!pathStartsWith(resolvedPath, workspaceRoot)) {
                return res.status(403).json({ error: 'Access denied - outside workspace' });
            }

            const stats = statSync(filePath);
            if (stats.isDirectory()) return res.status(400).json({ error: 'Cannot read directory' });
            // No file size limit for raw read

            const ext = extname(filePath).toLowerCase();
            const textExtensions = ['.txt', '.md', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.html', '.css', '.py', '.sh', '.bat', '.yml', '.yaml', '.xml', '.csv', '.log', '.env', '.gitignore', '.rs', '.go', '.java', '.rb', '.php', '.swift', '.kt', '.c', '.h', '.cpp', '.hpp', '.vue', '.svelte', '.prisma', '.graphql', '.toml', '.mts'];
            if (!textExtensions.includes(ext)) {
                return res.status(400).json({ error: 'Binary file - cannot display', extension: ext });
            }

            const content = readFileSync(filePath, 'utf-8');
            res.json({ path: filePath, name: basename(filePath), extension: ext, size: stats.size, content });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── File Save ─────────────────────────────────────────────────────
    router.post('/api/files/save', (req: Request, res: Response) => {
        try {
            const { path: filePath, content } = req.body;
            if (!filePath) return res.status(400).json({ error: 'Path required' });
            if (content === undefined) return res.status(400).json({ error: 'Content required' });

            const workspacePath = getWorkspacePath();
            const resolvedPath = resolve(filePath);
            const workspaceRoot = resolve(workspacePath);
            if (!pathStartsWith(resolvedPath, workspaceRoot)) {
                return res.status(403).json({ error: 'Access denied - outside workspace' });
            }
            if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

            const ext = extname(filePath).toLowerCase();
            const textExtensions = ['.txt', '.md', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.html', '.css', '.py', '.sh', '.bat', '.yml', '.yaml', '.xml', '.csv', '.log', '.env', '.gitignore', '.rs', '.go', '.java', '.rb', '.php', '.swift', '.kt', '.c', '.h', '.cpp', '.hpp', '.vue', '.svelte', '.prisma', '.graphql', '.toml', '.mts'];
            if (!textExtensions.includes(ext)) {
                return res.status(400).json({ error: 'Cannot edit binary files' });
            }

            writeFileSync(filePath, content, 'utf-8');
            res.json({ success: true, path: filePath });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Raw File (images) ─────────────────────────────────────────────
    router.get('/api/files/raw', (req: Request, res: Response) => {
        if (!checkQueryAuth(req, res)) return;
        try {
            const filePath = req.query.path as string;
            if (!filePath) return res.status(400).json({ error: 'Path required' });

            const resolvedPath = resolve(filePath);
            if (!isReadAllowed(resolvedPath)) {
                return res.status(403).json({ error: 'Access denied - outside allowed paths' });
            }
            if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

            const ext = extname(filePath).toLowerCase();
            const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];
            if (!imageExtensions.includes(ext)) {
                return res.status(400).json({ error: 'Only image files supported' });
            }

            const stats = statSync(filePath);
            if (stats.size > 10 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 10MB)' });

            const mimeTypes: Record<string, string> = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon', '.bmp': 'image/bmp'
            };
            res.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            res.set('Cache-Control', 'no-cache');
            res.sendFile(resolvedPath);
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Download File ─────────────────────────────────────────────────
    router.get('/api/files/download', (req: Request, res: Response) => {
        if (!checkQueryAuth(req, res)) return;
        try {
            const filePath = req.query.path as string;
            if (!filePath) return res.status(400).json({ error: 'Path required' });

            const resolvedPath = resolve(filePath);
            if (!isReadAllowed(resolvedPath)) {
                return res.status(403).json({ error: 'Access denied - outside allowed paths' });
            }
            if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

            const stats = statSync(filePath);
            if (stats.isDirectory()) return res.status(400).json({ error: 'Cannot download directory' });
            if (stats.size > 50 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 50MB)' });

            const filename = basename(filePath);
            res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            res.sendFile(resolvedPath);
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── View File in Browser (HTML renderer) ──────────────────────────
    router.get('/api/files/view', (req: Request, res: Response) => {
        if (!checkQueryAuth(req, res)) return;
        try {
            const filePath = req.query.path as string;
            if (!filePath) return res.status(400).send('Path required');

            const resolvedPath = resolve(filePath);
            if (!isReadAllowed(resolvedPath)) {
                return res.status(403).send('Access denied - file is outside allowed paths');
            }
            if (!existsSync(filePath)) return res.status(404).send('File not found');

            const stats = statSync(filePath);
            if (stats.isDirectory()) return res.status(400).send('Cannot view directory');

            const ext = extname(filePath).toLowerCase();
            const filename = basename(filePath);
            const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];

            // PDF: serve natively — browser renders it
            if (ext === '.pdf') {
                if (stats.size > 200 * 1024 * 1024) return res.status(400).send('PDF too large (max 200MB)');
                res.set('Content-Type', 'application/pdf');
                res.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
                return res.sendFile(resolvedPath);
            }

            if (imageExts.includes(ext)) {
                const token = req.query.token as string || '';
                const rawUrl = `/api/files/raw?path=${encodeURIComponent(filePath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
                res.set('Content-Type', 'text/html; charset=utf-8');
                return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${filename}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d1117;display:flex;flex-direction:column;min-height:100vh;font-family:system-ui,sans-serif}header{background:#161b22;border-bottom:1px solid #30363d;padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10}.fn{color:#f0f6fc;font-size:14px;font-weight:600}.badge{background:rgba(56,189,248,.15);color:#38bdf8;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid rgba(56,189,248,.3);font-family:monospace}main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px}img{max-width:100%;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 25px 60px rgba(0,0,0,.6)}</style></head><body><header><span class="fn">\uD83D\uDDBC ${filename}</span><span class="badge">${ext}</span></header><main><img src="${rawUrl}" alt="${filename}"></main></body></html>`);
            }

            // No file size limit for text/code view
            let content: string;
            try { content = readFileSync(filePath, 'utf-8'); } catch { return res.status(500).send('Cannot read file'); }

            const isMarkdown = ['.md', '.markdown', '.mdx'].includes(ext);
            res.set('Content-Type', 'text/html; charset=utf-8');

            if (isMarkdown) {
                return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${filename}</title>
<script src="https://cdn.jsdelivr.net/npm/marked@9/marked.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.7}
header{background:#161b22;border-bottom:1px solid #30363d;padding:14px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10}
.fn{color:#f0f6fc;font-size:14px;font-weight:600}.badge{background:rgba(56,189,248,.15);color:#38bdf8;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid rgba(56,189,248,.3)}
.content{max-width:860px;margin:0 auto;padding:32px 20px 60px}
h1,h2,h3,h4,h5,h6{color:#f0f6fc;margin:1.5em 0 .5em;font-weight:600}
h1{font-size:2em;border-bottom:1px solid #30363d;padding-bottom:.3em}
h2{font-size:1.5em;border-bottom:1px solid #21262d;padding-bottom:.3em}
h3{font-size:1.25em} h4{font-size:1.1em}
p{margin:.8em 0;color:#c9d1d9}
a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
code{background:rgba(110,118,129,.15);border:1px solid rgba(110,118,129,.25);border-radius:6px;padding:.2em .4em;font-size:.875em;font-family:'SFMono-Regular',Consolas,monospace;color:#ff7b72}
pre{background:#161b22;border:1px solid #30363d;border-radius:8px;overflow-x:auto;padding:16px;margin:1em 0}
pre code{background:none;border:none;padding:0;color:inherit;font-size:13px}
blockquote{border-left:3px solid #388bfd;padding:4px 16px;color:#8b949e;margin:1em 0;background:rgba(56,139,253,.05);border-radius:0 8px 8px 0}
table{border-collapse:collapse;width:100%;margin:1em 0}
th{background:#161b22;color:#f0f6fc;font-weight:600}
th,td{border:1px solid #30363d;padding:8px 13px;text-align:left}
tr:nth-child(even){background:rgba(255,255,255,.02)}
ul,ol{padding-left:1.5em;margin:.5em 0;color:#c9d1d9}
li{margin:.3em 0}
hr{border:none;border-top:1px solid #30363d;margin:2em 0}
img{max-width:100%;border-radius:8px}
.task-list-item{list-style:none;margin-left:-1.5em;padding-left:1.5em}
</style>
</head>
<body>
<header><span class="fn">📄 ${filename}</span><span class="badge">Markdown</span></header>
<div class="content" id="c"></div>
<script>
document.getElementById('c').innerHTML=marked.parse(${JSON.stringify(content)},{breaks:true,gfm:true});
document.querySelectorAll('pre code').forEach(el=>hljs.highlightElement(el));
</script>
</body></html>`);
            }

            // HTML: render in a sandboxed iframe (not show raw source)
            if (ext === '.html' || ext === '.htm') {
                const b64 = Buffer.from(content).toString('base64');
                return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${filename}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;display:flex;flex-direction:column;height:100vh;font-family:system-ui,sans-serif}
header{background:#161b22;border-bottom:1px solid #30363d;padding:12px 20px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.fn{color:#f0f6fc;font-size:14px;font-weight:600}
.badge{background:rgba(56,189,248,.15);color:#38bdf8;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid rgba(56,189,248,.3);font-family:monospace}
.src-btn{margin-left:auto;background:rgba(110,118,129,.15);color:#8b949e;border:1px solid #30363d;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px}
.src-btn:hover{background:rgba(110,118,129,.3);color:#e6edf3}
iframe{flex:1;border:none;background:#fff}
</style>
</head>
<body>
<header>
  <span class="fn">🌐 ${filename}</span>
  <span class="badge">HTML</span>
  <button class="src-btn" onclick="toggleView()">View Source</button>
</header>
<iframe id="preview" sandbox="allow-same-origin allow-scripts" src="data:text/html;base64,${b64}"></iframe>
<script>
function toggleView(){
  const f=document.getElementById('preview');
  const btn=document.querySelector('.src-btn');
  if(f.style.display==='none'){f.style.display='';btn.textContent='View Source'}else{f.style.display='none';btn.textContent='Show Preview';const pre=document.getElementById('src');if(!pre){const p=document.createElement('pre');p.id='src';p.style='flex:1;overflow:auto;padding:20px;background:#0d1117;color:#e6edf3;font-size:13px;line-height:1.5;font-family:monospace;white-space:pre-wrap;word-break:break-all';p.textContent=atob('${b64}');document.body.appendChild(p)}else{p.style.display=''}}}
</script>
</body></html>`);
            }

            // Code / plain text viewer
            const LANG_MAP: Record<string,string> = {
                '.js':'javascript','.mjs':'javascript','.ts':'typescript','.tsx':'typescript','.jsx':'javascript',
                '.json':'json','.html':'html','.css':'css','.py':'python','.sh':'bash',
                '.yml':'yaml','.yaml':'yaml','.rs':'rust','.go':'go','.java':'java',
                '.rb':'ruby','.php':'php','.swift':'swift','.kt':'kotlin',
                '.c':'c','.cpp':'cpp','.h':'c','.sql':'sql','.xml':'xml',
            };
            const lang = LANG_MAP[ext] || 'plaintext';
            const lineCount = content.split('\n').length;
            const escaped = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${filename}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:'SFMono-Regular',Consolas,monospace}
header{background:#161b22;border-bottom:1px solid #30363d;padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10}
.fn{color:#f0f6fc;font-size:14px;font-weight:600}.badge{background:rgba(56,189,248,.15);color:#38bdf8;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid rgba(56,189,248,.3);font-family:monospace}
.lc{margin-left:auto;font-size:11px;color:#6e7681}
.code-wrap{overflow-x:auto}
pre{padding:20px;margin:0;font-size:13px;line-height:1.6;min-height:100vh}
pre code{font-family:inherit}
</style>
</head>
<body>
<header><span class="fn">📄 ${filename}</span><span class="badge">${ext||'text'}</span><span class="lc">${lineCount} lines</span></header>
<div class="code-wrap"><pre><code class="language-${lang}">${escaped}</code></pre></div>
<script>hljs.highlightAll();</script>
</body></html>`);
        } catch (e) {
            res.status(500).send((e as Error).message);
        }
    });

    return router;
}
