/**
 * FilesPanel — File browser, viewer, diff, image zoom, editor
 * Ported from public/js/mobile/files.js (669 lines)
 */
import { useState, useRef, useCallback, useEffect } from 'preact/hooks';
import { authFetch, getServerUrl } from '../hooks/useApi';
import { escapeHtml, formatSize } from '../utils';
import { useApp } from '../context/AppContext';
import { useTranslation } from '../i18n';
import { FolderOpen, Folder, FileText, FileCode, Image, Settings, ArrowUp, RefreshCw, ArrowLeft, X, Pencil, Monitor, Save, Search, Archive, Download, ExternalLink } from 'lucide-preact';
import { CodeEditor } from './CodeEditor';
import { OrnamentWrapper } from './OrnamentWrapper';

// ─── Types ──────────────────────────────────────────────────────────
interface FileItem {
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
    extension?: string;
}

interface FilesResponse {
    path: string;
    parent?: string;
    items: FileItem[];
    error?: string;
}

interface FileContentResponse {
    name: string;
    content: string;
    extension: string;
    error?: string;
}

interface SearchResult {
    file: string;
    line: string;
    lineNumber: number;
    column: number;
    context: string;
}

interface DiffInsert {
    beforeLine: number;
    content: string;
}

interface DiffResponse {
    diff?: {
        name: string;
        stats: { added: number; deleted: number };
        addedLines: number[];
        deletedInserts: DiffInsert[];
    };
    reason?: string;
    error?: string;
}

type ViewMode = 'browser' | 'viewer' | 'editor' | 'image';

// ─── Constants ──────────────────────────────────────────────────────
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];

// Extensions that should be viewed via /api/files/view tab (rendered HTML/PDF)
const VIEW_TAB_EXTENSIONS = ['.pdf', '.html', '.htm'];

const LANG_MAP: Record<string, string> = {
    '.js': 'javascript', '.mjs': 'javascript', '.ts': 'typescript',
    '.jsx': 'jsx', '.tsx': 'tsx',
    '.json': 'json', '.html': 'html', '.css': 'css',
    '.py': 'python', '.sh': 'bash', '.bat': 'dos',
    '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml',
    '.c': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.h': 'cpp',
    '.cs': 'csharp', '.java': 'java', '.php': 'php', '.rs': 'rust',
    '.go': 'go', '.rb': 'ruby', '.swift': 'swift', '.kt': 'kotlin',
    '.xml': 'xml', '.sql': 'sql',
    '.txt': 'plaintext', '.log': 'plaintext', '.env': 'plaintext',
};

// ─── Helpers ────────────────────────────────────────────────────────
function isImageFile(ext: string): boolean {
    return IMAGE_EXTENSIONS.includes((ext || '').toLowerCase());
}

function getLanguage(ext: string): string {
    return LANG_MAP[ext] || 'plaintext';
}

function getFileIcon(item: FileItem) {
    if (item.isDirectory) return <Folder size={16} />;
    const ext = (item.extension || '').toLowerCase();
    const codeExts = ['.js', '.mjs', '.ts', '.jsx', '.tsx', '.html', '.css', '.py'];
    const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const configExts = ['.sh', '.bat', '.yml', '.yaml', '.toml'];
    if (codeExts.includes(ext)) return <FileCode size={16} />;
    if (imgExts.includes(ext)) return <Image size={16} />;
    if (configExts.includes(ext)) return <Settings size={16} />;
    return <FileText size={16} />;
}

// ─── FilesPanel Component ───────────────────────────────────────────
export function FilesPanel() {
    const { showToast, activePanel, setActivePanel, fileEventRef, viewFileDiffRef } = useApp();
    const { t } = useTranslation();

    // File browser state
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [items, setItems] = useState<FileItem[]>([]);
    const [parentPath, setParentPath] = useState<string | null>(null);
    const [breadcrumb, setBreadcrumb] = useState('Files');
    const [loading, setLoading] = useState(false);

    // Viewer state
    const [viewMode, setViewMode] = useState<ViewMode>('browser');
    const [viewerTitle, setViewerTitle] = useState('');
    const [viewerContent, setViewerContent] = useState('');
    const [viewerLang, setViewerLang] = useState('plaintext');
    const [currentViewingFile, setCurrentViewingFile] = useState<string | null>(null);

    // Diff state
    const [diffHtml, setDiffHtml] = useState('');

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
    const [searchTotalMatches, setSearchTotalMatches] = useState(0);
    const [searchTruncated, setSearchTruncated] = useState(false);

    // Image state
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageLoading, setImageLoading] = useState(false);
    const imageZoomRef = useRef(1);
    const imageTranslateRef = useRef({ x: 0, y: 0 });
    const [zoomLevel, setZoomLevel] = useState('100%');
    const imageRef = useRef<HTMLImageElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Editor state
    const [editorContent, setEditorContent] = useState('');
    const [isEditing, setIsEditing] = useState(false);

    // Track which panel the user came from (for "Back" navigation)
    const cameFromRef = useRef<string | null>(null);



    // ─── Load files ─────────────────────────────────────────────────
    const loadFiles = useCallback(async (path: string | null = null) => {
        setLoading(true);
        try {
            const url = path
                ? `${getServerUrl()}/api/files?path=${encodeURIComponent(path)}`
                : `${getServerUrl()}/api/files`;
            const res = await authFetch(url);
            const data: FilesResponse = await res.json();

            if (data.error) {
                showToast(data.error, 'error');
                setLoading(false);
                return;
            }

            setCurrentPath(data.path);
            setItems(data.items);
            setParentPath(data.parent && data.parent !== data.path ? data.parent : null);
            const bc = data.path.length > 40 ? '...' + data.path.slice(-37) : data.path;
            setBreadcrumb(bc);
        } catch (e) {
            showToast(t('mobile.files.errorLoadingFiles') + ' ' + (e as Error).message, 'error');
        }
        setLoading(false);
    }, [showToast]);

    // ─── Search files ───────────────────────────────────────────────────
    const doSearch = useCallback(async () => {
        if (!searchQuery.trim()) return;
        setSearchLoading(true);
        try {
            const params = new URLSearchParams({
                query: searchQuery.trim(),
                caseSensitive: String(searchCaseSensitive),
                maxResults: '50'
            });
            const res = await authFetch(`${getServerUrl()}/api/files/search?${params}`);
            const data = await res.json();
            setSearchResults(data.results || []);
            setSearchTotalMatches(data.totalMatches || 0);
            setSearchTruncated(data.truncated || false);
        } catch (e) {
            showToast(t('mobile.files.searchError') + ' ' + (e as Error).message, 'error');
        }
        setSearchLoading(false);
    }, [searchQuery, searchCaseSensitive, showToast, t]);

    // Load files when switching to Files panel (not just on mount)
    const hasLoadedRef = useRef(false);
    useEffect(() => {
        if (activePanel === 'files' && !hasLoadedRef.current) {
            hasLoadedRef.current = true;
            loadFiles();
        }
    }, [activePanel, loadFiles]);

    // ─── Subscribe to WebSocket events via AppContext refs ───────
    // Gap 2+3+4: handleFileChanged + handleWorkspaceChanged
    useEffect(() => {
        fileEventRef.current.onFileChanged = (data: Record<string, unknown>) => {
            // Auto-reload file list if Files panel is active
            if (activePanel === 'files') {
                loadFiles(currentPath);
            }
            // If viewing the changed file, auto-reload its content
            if (currentViewingFile && data.filename) {
                const viewingFilename = currentViewingFile.split(/[/\\]/).pop();
                if (viewingFilename === data.filename) {
                    // Silently handled — user can manually refresh if needed
                }
            }
        };
        fileEventRef.current.onWorkspaceChanged = (data: Record<string, unknown>) => {
            // Reset to root so next load starts from new workspace
            setCurrentPath(null);
            hasLoadedRef.current = false; // Force reload on next panel visit
            if (activePanel === 'files') {
                hasLoadedRef.current = true;
                loadFiles();
                const projectName = (data.projectName as string) || 'workspace';
                showToast(`📂 Switched to: ${projectName}`, 'info');
            }
        };
        return () => {
            fileEventRef.current.onFileChanged = undefined;
            fileEventRef.current.onWorkspaceChanged = undefined;
        };
    }, [activePanel, currentPath, currentViewingFile, loadFiles, showToast, fileEventRef]);

    // ─── Gap 5: Unwatch when leaving Files panel ────────────────
    const prevPanelRef = useRef(activePanel);
    useEffect(() => {
        if (prevPanelRef.current === 'files' && activePanel !== 'files') {
            authFetch(`${getServerUrl()}/api/files/unwatch`, { method: 'POST' }).catch(() => { /* silent */ });
        }
        prevPanelRef.current = activePanel;
    }, [activePanel]);

    // ─── View file (text) ───────────────────────────────────────────
    const viewFile = useCallback(async (path: string, ext: string) => {
        const lext = (ext || '').toLowerCase();

        if (isImageFile(lext)) {
            await viewImageFile(path);
            return;
        }

        // PDF / HTML: open in new browser tab via view endpoint
        if (VIEW_TAB_EXTENSIONS.includes(lext)) {
            const token = (window as unknown as Record<string, string>).__AG_TOKEN__ || '';
            const url = `${getServerUrl()}/api/files/view?path=${encodeURIComponent(path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
            window.open(url, '_blank', 'noopener');
            return;
        }

        try {
            const res = await authFetch(`${getServerUrl()}/api/files/content?path=${encodeURIComponent(path)}`);
            const data: FileContentResponse = await res.json();

            if (data.error) {
                showToast(data.error, 'error');
                return;
            }

            setCurrentViewingFile(path);
            const lang = getLanguage(data.extension);
            setViewerTitle(data.name);
            setViewerContent(data.content);
            setViewerLang(lang);
            setViewMode('viewer');
            setIsEditing(false);

        } catch (_e) {
            showToast(t('mobile.files.loadFileFailed'), 'error');
        }
    }, [showToast]);

    // ─── View file diff ─────────────────────────────────────────────
    // viewFileDiff is available for external callers (e.g. WebSocket file-change handlers)
    const viewFileDiff = useCallback(async (path: string, ext: string) => {
        // Remember which panel the user was on so Back returns there
        cameFromRef.current = activePanel !== 'files' ? activePanel : null;
        setActivePanel('files');

        const lext = (ext || '').toLowerCase();

        if (isImageFile(lext)) {
            await viewImageFile(path);
            return;
        }

        // PDF / HTML: open in new browser tab via view endpoint
        if (VIEW_TAB_EXTENSIONS.includes(lext)) {
            const token = (window as unknown as Record<string, string>).__AG_TOKEN__ || '';
            const url = `${getServerUrl()}/api/files/view?path=${encodeURIComponent(path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
            window.open(url, '_blank', 'noopener');
            return;
        }

        try {
            const [contentRes, diffRes] = await Promise.all([
                authFetch(`${getServerUrl()}/api/files/content?path=${encodeURIComponent(path)}`),
                authFetch(`${getServerUrl()}/api/files/diff?path=${encodeURIComponent(path)}`),
            ]);

            const contentData: FileContentResponse = await contentRes.json();
            const diffData: DiffResponse = await diffRes.json();

            if (contentData.error) {
                showToast(contentData.error, 'error');
                return;
            }

            if (!diffData.diff) {
                showToast(diffData.reason || t('mobile.files.noChanges'), 'info');
                await viewFile(path, ext);
                return;
            }

            setCurrentViewingFile(path);
            const { name, stats, addedLines, deletedInserts } = diffData.diff;
            const addedSet = new Set(addedLines);
            const lang = getLanguage(contentData.extension);
            const fileLines = contentData.content.split('\n');

            // Group deleted lines
            const deletedMap: Record<number, string[]> = {};
            for (const d of deletedInserts) {
                if (!deletedMap[d.beforeLine]) deletedMap[d.beforeLine] = [];
                deletedMap[d.beforeLine].push(d.content);
            }

            // Syntax highlight
            let highlightedCode = '';
            const w = window as unknown as Record<string, unknown>;
            const hljsLib = w.hljs as { highlight: (code: string, opts: { language: string }) => { value: string } } | undefined;
            if (hljsLib && lang !== 'plaintext') {
                try {
                    const result = hljsLib.highlight(contentData.content, { language: lang });
                    highlightedCode = result.value;
                } catch (_) {
                    highlightedCode = escapeHtml(contentData.content);
                }
            } else {
                highlightedCode = escapeHtml(contentData.content);
            }

            const rawLines = highlightedCode.split('\n');
            const lineStyle = 'padding:0 8px;white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:12px;line-height:1.6';
            const lineNumStyle = 'min-width:32px;display:inline-block;text-align:right;opacity:0.4;padding-right:8px;user-select:none';

            let html = '';
            for (let i = 0; i < rawLines.length; i++) {
                const lineNum = i + 1;
                if (deletedMap[lineNum]) {
                    for (const delContent of deletedMap[lineNum]) {
                        html += `<div style="${lineStyle};background:rgba(248,81,73,0.3);border-left:3px solid #f85149;opacity:0.7"><span style="${lineNumStyle}">-</span><span style="color:#f85149;width:16px;display:inline-block;text-align:center">-</span>${escapeHtml(delContent)}</div>`;
                    }
                }
                const isAdded = addedSet.has(lineNum);
                const bg = isAdded ? 'background:rgba(46,160,67,0.3);border-left:3px solid #3fb950' : 'border-left:3px solid transparent';
                html += `<div style="${lineStyle};${bg}"><span style="${lineNumStyle}">${lineNum}</span>${rawLines[i]}</div>`;
            }

            const afterLast = fileLines.length + 1;
            if (deletedMap[afterLast]) {
                for (const delContent of deletedMap[afterLast]) {
                    html += `<div style="${lineStyle};background:rgba(248,81,73,0.15);border-left:3px solid #f85149;opacity:0.7"><span style="${lineNumStyle}">-</span><span style="color:#f85149;width:16px;display:inline-block;text-align:center">-</span>${escapeHtml(delContent)}</div>`;
                }
            }

            setViewerTitle(`${name} +${stats.added} -${stats.deleted}`);
            setDiffHtml(html);
            setViewMode('viewer');
            setIsEditing(false);
        } catch (_e) {
            showToast(t('mobile.files.loadDiffFailed'), 'error');
            await viewFile(path, ext);
        }
    }, [showToast, viewFile]);

    // ─── Gap 1: Expose viewFileDiff via AppContext ref ───────────
    useEffect(() => {
        viewFileDiffRef.current = viewFileDiff;
        return () => { viewFileDiffRef.current = null; };
    }, [viewFileDiff, viewFileDiffRef]);

    // ─── View image ─────────────────────────────────────────────────
    const viewImageFile = useCallback(async (path: string) => {
        const filename = path.split(/[/\\]/).pop() || '';
        setViewerTitle(filename);
        setViewMode('image');
        setImageLoading(true);
        setImageUrl(null);
        imageZoomRef.current = 1;
        imageTranslateRef.current = { x: 0, y: 0 };
        setZoomLevel('100%');

        try {
            const imgUrl = `${getServerUrl()}/api/files/raw?path=${encodeURIComponent(path)}`;
            const res = await authFetch(imgUrl);
            if (!res.ok) {
                showToast(t('mobile.files.loadImageFailed'), 'error');
                setViewMode('browser');
                return;
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            setImageUrl(objectUrl);
            setImageLoading(false);
        } catch (_e) {
            showToast(t('mobile.files.imageError'), 'error');
            setViewMode('browser');
        }
    }, [showToast]);

    // ─── Image zoom helpers ─────────────────────────────────────────
    const updateZoom = useCallback(() => {
        const img = imageRef.current;
        if (img) {
            img.style.transform = `scale(${imageZoomRef.current}) translate(${imageTranslateRef.current.x}px, ${imageTranslateRef.current.y}px)`;
        }
        setZoomLevel(Math.round(imageZoomRef.current * 100) + '%');
    }, []);

    const zoomImage = useCallback((direction: number) => {
        imageZoomRef.current = Math.min(Math.max(imageZoomRef.current + direction * 0.25, 0.5), 5);
        updateZoom();
    }, [updateZoom]);

    const resetZoom = useCallback(() => {
        imageZoomRef.current = 1;
        imageTranslateRef.current = { x: 0, y: 0 };
        updateZoom();
    }, [updateZoom]);

    // Image touch/wheel zoom
    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper || viewMode !== 'image' || !imageUrl) return;

        let lastTouchEnd = 0;
        let initialDistance = 0;
        let initialZoom = 1;

        const getDistance = (t1: Touch, t2: Touch) => {
            const dx = t1.clientX - t2.clientX;
            const dy = t1.clientY - t2.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        const onTouchEnd = (e: TouchEvent) => {
            const now = Date.now();
            if (now - lastTouchEnd < 300 && e.changedTouches.length === 1) {
                e.preventDefault();
                if (imageZoomRef.current === 1) {
                    const img = imageRef.current;
                    if (img) {
                        const containerWidth = wrapper.clientWidth;
                        imageZoomRef.current = Math.min(containerWidth / img.naturalWidth, 3);
                    }
                } else {
                    imageZoomRef.current = 1;
                    imageTranslateRef.current = { x: 0, y: 0 };
                }
                updateZoom();
            }
            lastTouchEnd = now;
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                initialDistance = getDistance(e.touches[0], e.touches[1]);
                initialZoom = imageZoomRef.current;
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const distance = getDistance(e.touches[0], e.touches[1]);
                const scale = distance / initialDistance;
                imageZoomRef.current = Math.min(Math.max(initialZoom * scale, 0.5), 5);
                updateZoom();
            }
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.2 : 0.2;
            imageZoomRef.current = Math.min(Math.max(imageZoomRef.current + delta, 0.5), 5);
            updateZoom();
        };

        wrapper.addEventListener('touchend', onTouchEnd);
        wrapper.addEventListener('touchstart', onTouchStart);
        wrapper.addEventListener('touchmove', onTouchMove, { passive: false });
        wrapper.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            wrapper.removeEventListener('touchend', onTouchEnd);
            wrapper.removeEventListener('touchstart', onTouchStart);
            wrapper.removeEventListener('touchmove', onTouchMove);
            wrapper.removeEventListener('wheel', onWheel);
        };
    }, [viewMode, imageUrl, updateZoom]);

    // ─── Open file on desktop IDE ───────────────────────────────────
    const openOnDesktop = useCallback(async (filePath: string) => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/cdp/open-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, diff: true }),
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.error || 'Failed to open in IDE', 'error');
            }
        } catch (err) {
            showToast('CDP error: ' + (err as Error).message, 'error');
        }
    }, [showToast]);

    // ─── Download file ────────────────────────────────────────
    const downloadFile = useCallback((filePath: string) => {
        const token = (window as unknown as Record<string, unknown>).__authToken as string | undefined
            || localStorage.getItem('authToken')
            || '';
        const url = `${getServerUrl()}/api/files/download?path=${encodeURIComponent(filePath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
        const a = document.createElement('a');
        a.href = url;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('Downloading...', 'info');
    }, [showToast]);

    // ─── Open file in browser tab ─────────────────────────────
    const openInBrowserTab = useCallback((filePath: string) => {
        const token = (window as unknown as Record<string, unknown>).__authToken as string | undefined
            || localStorage.getItem('authToken')
            || '';
        const url = `${getServerUrl()}/api/files/view?path=${encodeURIComponent(filePath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
        window.open(url, '_blank', 'noopener');
    }, []);

    // ─── Editing ────────────────────────────────────────────────────
    const startEditing = useCallback(() => {
        if (!currentViewingFile) return;
        setEditorContent(viewerContent);
        setIsEditing(true);
    }, [currentViewingFile, viewerContent]);

    const cancelEditing = useCallback(() => {
        setIsEditing(false);
    }, []);

    const saveFile = useCallback(async () => {
        if (!currentViewingFile) return;
        try {
            const res = await authFetch(`${getServerUrl()}/api/files/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: currentViewingFile, content: editorContent }),
            });
            const data = await res.json();
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            showToast(t('mobile.files.fileSaved'), 'success');
            setViewerContent(editorContent);
            setIsEditing(false);
        } catch (_e) {
            showToast(t('mobile.files.saveFailed'), 'error');
        }
    }, [currentViewingFile, editorContent, showToast]);

    // ─── Close viewer → back to origin panel or browser ──────────────
    const closeViewer = useCallback(() => {
        setIsEditing(false);
        setCurrentViewingFile(null);
        setDiffHtml('');
        if (imageUrl) {
            URL.revokeObjectURL(imageUrl);
            setImageUrl(null);
        }
        // If opened from another panel (e.g. chat), go back there
        if (cameFromRef.current) {
            const returnTo = cameFromRef.current;
            cameFromRef.current = null;
            setViewMode('browser');
            setActivePanel(returnTo);
        } else {
            setViewMode('browser');
        }
    }, [imageUrl, setActivePanel]);

    // ─── Render ─────────────────────────────────────────────────────
    // Shared class for image zoom buttons
    const zoomBtnCls = 'bg-white/10 border-none text-[var(--text)] rounded-md px-3 py-1 cursor-pointer';

    return (
        <OrnamentWrapper 
            title={viewMode === 'browser' ? t('mobile.nav.files') : viewerTitle}
            icon={<Archive size={16} />}
            containerClass="files-panel"
        >
            <div className="flex-1 min-h-0 flex flex-col overscroll-contain">


            {viewMode === 'browser' && (
                <>
                    {/* Breadcrumb header - Subtle secondary header */}
                    <div className="flex items-center gap-2 px-4 py-2 bg-[rgba(255,255,255,0.03)] border-b border-[var(--border)]">
                        <FolderOpen size={14} className="text-[var(--accent-primary)] opacity-70" />
                        <span className="flex-1 text-[11px] text-[var(--text-muted)] font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                            {breadcrumb}
                        </span>
                        <button
                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            onClick={() => loadFiles(currentPath)}
                        >
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    {/* Search Bar */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[rgba(0,0,0,0.2)] shrink-0">
                        <div className="flex-1 flex items-center bg-[var(--bg-dark)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 focus-within:border-[var(--accent-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--accent-primary)]/20 transition-all">
                            <Search size={14} className="text-[var(--text-muted)] shrink-0" />
                            <input
                                type="text"
                                className="flex-1 bg-transparent border-none text-[13px] text-[var(--text-primary)] px-2 outline-none w-full min-w-0 placeholder-[var(--text-muted)]"
                                placeholder={t('mobile.files.searchPlaceholder')}
                                value={searchQuery}
                                onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        doSearch();
                                    }
                                }}
                            />
                            {searchQuery && (
                                <button
                                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                    onClick={() => {
                                        setSearchQuery('');
                                        setSearchResults(null);
                                    }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        <button
                            className={`w-9 h-9 border rounded-lg text-xs font-mono font-bold shrink-0 flex items-center justify-center transition-all ${
                                searchCaseSensitive 
                                    ? 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/50 text-[var(--accent-primary)] shadow-[0_0_10px_rgba(14,165,233,0.15)]' 
                                    : 'bg-[var(--bg-dark)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]'
                            }`}
                            onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
                            title="Match Case"
                        >
                            Aa
                        </button>
                    </div>

                    {/* File list or Search Results */}
                    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 overscroll-contain touch-pan-y">
                        {searchLoading ? (
                            <div className="text-center p-8 text-[var(--text-muted)] flex flex-col items-center justify-center gap-2">
                                <div class="spinner" />
                                <span className="text-sm">{t('mobile.common.loading')}</span>
                            </div>
                        ) : searchResults !== null ? (
                            <>
                                {searchResults.length === 0 ? (
                                    <div className="text-center p-8 text-[var(--text-muted)] text-sm">{t('mobile.files.searchNoResults')}</div>
                                ) : (
                                    <div className="flex flex-col gap-1.5">
                                        {searchResults.map((result, idx) => {
                                            const filename = result.file.split(/[/\\]/).pop() || result.file;
                                            const ext = filename.substring(filename.lastIndexOf('.'));
                                            return (
                                                <div
                                                    key={idx}
                                                    className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 hover:bg-[rgba(14,165,233,0.05)] border border-[var(--border)] bg-[rgba(0,0,0,0.2)] group"
                                                    onClick={() => viewFile(result.file, ext)}
                                                >
                                                    <div className="flex items-start gap-2">
                                                        <FileText size={14} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-semibold truncate text-[var(--text)]">{filename}</div>
                                                            <div className="text-[10px] text-[var(--text-muted)] truncate opacity-70">{result.file}</div>
                                                        </div>
                                                        <div className="text-xs font-mono text-[var(--text-muted)] bg-white/10 px-1.5 rounded shrink-0">
                                                            {result.lineNumber}
                                                        </div>
                                                    </div>
                                                    <div className="text-[11px] font-mono text-[var(--text)] bg-black/40 p-1.5 rounded overflow-x-auto whitespace-pre">
                                                        {result.line.trim().length > 100 ? result.line.trim().substring(0, 100) + '...' : result.line.trim()}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        <div className="text-center p-3 text-xs text-[var(--text-muted)] mt-2">
                                            {searchTruncated ? searchTotalMatches + ' ' + t('mobile.files.searchTruncated') : searchTotalMatches + ' ' + t('mobile.files.searchResults')}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : loading ? (
                            <div className="text-center p-8 text-[var(--text-muted)]">{t('mobile.common.loading')}</div>
                        ) : (
                            <>
                                {parentPath && (
                                    <div
                                        className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200 hover:bg-[rgba(14,165,233,0.05)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                        onClick={() => loadFiles(parentPath)}
                                    >
                                        <div className="w-8 h-8 flex items-center justify-center bg-[var(--bg-dark)] border border-[var(--border)] rounded-lg text-[var(--accent-primary)]">
                                            <ArrowUp size={16} />
                                        </div>
                                        <span className="flex-1 text-[13px] font-medium uppercase tracking-widest opacity-80">Return to Parent</span>
                                    </div>
                                )}
                                {items.length === 0 && !parentPath ? (
                                    <div className="text-center p-8 text-[var(--text-muted)] text-sm">{t('mobile.files.emptyFolder')}</div>
                                ) : (
                                    items.map(item => (
                                        <div
                                            key={item.path}
                                            className="group flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200 hover:bg-[rgba(14,165,233,0.05)] active:scale-[0.98]"
                                            onClick={() => {
                                                if (item.isDirectory) {
                                                    loadFiles(item.path);
                                                } else {
                                                    viewFile(item.path, item.extension || '');
                                                }
                                            }}
                                        >
                                            <div className={`w-8 h-8 flex items-center justify-center shrink-0 rounded-lg border border-[var(--border)] transition-all ${item.isDirectory ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] group-hover:border-[var(--accent-primary)]/50' : 'bg-[var(--bg-dark)] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] group-hover:border-[var(--text-secondary)]'}`}>
                                                {getFileIcon(item)}
                                            </div>
                                            <span className={`flex-1 text-[13px] whitespace-nowrap overflow-hidden text-ellipsis transition-colors ${item.isDirectory ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'}`}>
                                                {item.name}
                                            </span>
                                            {!item.isDirectory && (
                                                <span className="text-[10px] text-[var(--text-muted)] font-mono opacity-50 group-hover:opacity-80">{formatSize(item.size)}</span>
                                            )}
                                        </div>
                                    ))
                                )}
                            </>
                        )}
                    </div>
                </>
            )}

            {(viewMode === 'viewer' || viewMode === 'editor') && (
                <div className="flex flex-col h-full bg-[var(--bg-dark)] text-[var(--text-primary)]">
                    {/* Viewer header - Integrated with Ornament TitleBar but providing extra controls */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[rgba(255,255,255,0.03)] shrink-0">
                        <button
                            className="bg-[var(--bg-glass)] border border-[var(--border)] text-[var(--text-primary)] cursor-pointer text-[12px] px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all hover:border-[var(--text-secondary)]"
                            onClick={isEditing ? cancelEditing : closeViewer}
                        >
                            <ArrowLeft size={14} /> 
                            {isEditing ? t('mobile.common.cancel') : t('mobile.common.back')}
                        </button>
                        <div className="flex-1 min-w-0">
                            {/* Path is already in the main Ornament title but showing here for context if very deep */}
                        </div>
                        <div className="flex gap-1.5 shrink-0 items-center">
                            {isEditing && (
                                <button
                                    className="bg-[rgba(34,197,94,0.15)] border border-[rgba(34,197,94,0.3)] text-[var(--success)] rounded-lg px-3 py-1.5 text-[11px] cursor-pointer font-bold flex items-center gap-1.5 transition-all hover:bg-[rgba(34,197,94,0.25)]"
                                    onClick={saveFile}
                                >
                                    <Save size={14} /> 
                                    {t('mobile.common.save')}
                                </button>
                            )}
                            {!isEditing && !diffHtml && currentViewingFile && (
                                <button
                                    className="bg-[rgba(14,165,233,0.15)] border border-[rgba(14,165,233,0.3)] text-[var(--accent-primary)] rounded-lg px-3 py-1.5 text-[11px] cursor-pointer font-bold flex items-center gap-1.5 transition-all hover:bg-[rgba(14,165,233,0.25)]"
                                    onClick={startEditing}
                                >
                                    <Pencil size={14} /> 
                                    {t('mobile.common.edit')}
                                </button>
                            )}
                            {currentViewingFile && (
                                <button
                                    className="bg-[rgba(16,185,129,0.15)] border border-[rgba(16,185,129,0.3)] text-[#10b981] rounded-lg px-3 py-1.5 text-[11px] cursor-pointer font-bold flex items-center gap-1.5 transition-all hover:bg-[rgba(16,185,129,0.25)]"
                                    onClick={() => openOnDesktop(currentViewingFile!)}
                                >
                                    <Monitor size={14} /> 
                                    {t('mobile.files.ide')}
                                </button>
                            )}
                            {currentViewingFile && (
                                <button
                                    className="bg-[rgba(139,92,246,0.15)] border border-[rgba(139,92,246,0.3)] text-[#a78bfa] rounded-lg px-3 py-1.5 text-[11px] cursor-pointer font-bold flex items-center gap-1.5 transition-all hover:bg-[rgba(139,92,246,0.25)]"
                                    title="Open in browser tab"
                                    onClick={() => openInBrowserTab(currentViewingFile!)}
                                >
                                    <ExternalLink size={14} />
                                    View
                                </button>
                            )}
                            {currentViewingFile && (
                                <button
                                    className="bg-[rgba(234,179,8,0.15)] border border-[rgba(234,179,8,0.3)] text-[#fbbf24] rounded-lg px-3 py-1.5 text-[11px] cursor-pointer font-bold flex items-center gap-1.5 transition-all hover:bg-[rgba(234,179,8,0.25)]"
                                    title="Download file"
                                    onClick={() => downloadFile(currentViewingFile!)}
                                >
                                    <Download size={14} />
                                    Save
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Content area */}
                    <div className={`flex-1 min-h-0 ${isEditing ? 'flex flex-col overflow-hidden' : diffHtml ? 'overflow-auto' : 'overflow-hidden'}`}>
                        {isEditing ? (
                            <CodeEditor
                                value={editorContent}
                                lang={viewerLang}
                                onChange={setEditorContent}
                            />
                        ) : diffHtml ? (
                            <pre className="m-0 text-xs overflow-auto font-mono leading-relaxed whitespace-pre-wrap break-words">
                                <code dangerouslySetInnerHTML={{ __html: diffHtml }} />
                            </pre>
                        ) : (
                            <CodeEditor
                                value={viewerContent}
                                lang={viewerLang}
                                readOnly
                            />
                        )}
                    </div>
                </div>
            )}

            {viewMode === 'image' && (
                <div className="flex flex-col h-full bg-[var(--bg-dark,#11111b)]">
                    {/* Image header */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
                        <button
                            className="bg-transparent border-none text-[var(--text-muted)] cursor-pointer text-base p-1"
                            onClick={closeViewer}
                        ><ArrowLeft size={16} /></button>
                        <span className="flex-1 text-center text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                            {viewerTitle}
                        </span>
                        <button
                            className="bg-transparent border-none text-[var(--text-muted)] cursor-pointer text-lg"
                            onClick={closeViewer}
                        ><X size={16} /></button>
                    </div>

                    {imageLoading ? (
                        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
                            <div class="spinner mr-2" />
                            {t('mobile.files.loadingImage')}
                        </div>
                    ) : (
                        <>
                            {/* Zoom controls */}
                            <div className="flex items-center justify-center gap-3 p-2">
                                <button className={zoomBtnCls} onClick={() => zoomImage(-1)}>−</button>
                                <span className="text-[13px] text-[var(--text-muted)] min-w-[50px] text-center">{zoomLevel}</span>
                                <button className={zoomBtnCls} onClick={() => zoomImage(1)}>+</button>
                                <button className={zoomBtnCls} onClick={resetZoom}>↺</button>
                            </div>

                            {/* Image */}
                            <div ref={wrapperRef} className="flex-1 overflow-hidden flex items-center justify-center">
                                {imageUrl && (
                                    <img
                                        ref={imageRef}
                                        src={imageUrl}
                                        alt="Preview"
                                        className="max-w-full max-h-full transition-transform duration-100 ease-linear origin-center"
                                    />
                                )}
                            </div>

                            <div className="text-center p-2 text-xs text-[var(--text-muted)] opacity-60">
                                {t('mobile.files.pinchToZoom')}
                            </div>
                        </>
                    )}
                </div>
            )}
            </div>
        </OrnamentWrapper>
    );
}
