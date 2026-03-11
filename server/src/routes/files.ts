/**
 * File Routes — Browser, viewer, editor, upload, workspace
 * 1:1 migration from routes/files.mjs
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { join, extname, basename, resolve, dirname } from 'path';
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
}

export function createFileRoutes(deps: FileRouteDeps): Router {
    const router = Router();
    const {
        pathStartsWith, isWindows,
        startWatching, stopWatching,
        getWorkspacePath, setWorkspacePath,
        upload, UPLOADS_DIR
    } = deps;

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
            if (stats.size > 1024 * 1024) return res.status(400).json({ error: 'File too large (max 1MB)' });

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
        try {
            const filePath = req.query.path as string;
            if (!filePath) return res.status(400).json({ error: 'Path required' });

            const workspacePath = getWorkspacePath();
            const resolvedPath = resolve(filePath);
            const workspaceRoot = resolve(workspacePath);
            if (!pathStartsWith(resolvedPath, workspaceRoot)) {
                return res.status(403).json({ error: 'Access denied - outside workspace' });
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
            res.sendFile(resolvedPath);
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    return router;
}
