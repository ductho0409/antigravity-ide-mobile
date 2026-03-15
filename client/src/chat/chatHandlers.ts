/**
 * chatHandlers — Interactive button/file/copy handlers for IDE snapshot
 * Ported from public/js/mobile/chat-live.js (attachInteractiveHandlers, attachFilePathHandlers, hookIdeCopyButtons)
 */
import { authFetch, getServerUrl } from '../hooks/useApi';

// File types that can be rendered in the view endpoint
const VIEW_EXTS = /\.(md|markdown|mdx|pdf|png|jpg|jpeg|gif|webp|svg|bmp|ico|ts|tsx|js|mjs|jsx|json|html|css|py|sh|yml|yaml|xml|txt|log|toml|rs|go|java|rb|php|swift|kt|c|h|cpp|sql)$/i;

// Helper: get auth token from localStorage
function getToken(): string {
    try { return localStorage.getItem('authToken') || ''; } catch { return ''; }
}

// Helper: build a /api/files/view URL for a file
function buildViewUrl(filePath: string): string {
    const serverUrl = getServerUrl();
    const token = getToken();
    // Use `path` for absolute, `name` for relative (server auto-resolves)
    const params = filePath.startsWith('/')
        ? new URLSearchParams({ path: filePath })
        : new URLSearchParams({ name: filePath });
    if (token) params.set('token', token);
    return `${serverUrl}/api/files/view?${params.toString()}`;
}

// Helper: open a URL in a new tab using a temp <a> element (works on iOS Safari)
// Must be called synchronously within user gesture context!
function openInNewTab(url: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ─── Types ──────────────────────────────────────────────────────────
type ShowToastFn = (msg: string, type?: 'info' | 'success' | 'error') => void;
type ViewFileDiffFn = (path: string, ext: string) => void;

interface HandlerDeps {
    showToast: ShowToastFn;
    viewFileDiff?: ViewFileDiffFn;
}

// ─── Button Classification (from chat-live.js) ─────────────────────
const IGNORED = /^(always run|cancel|relocate|review changes|planning|claude|model)/i;
const ACCEPT = /^(run|accept|allow once|allow this conversation|yes|continue|approve|confirm|ok|proceed|good|expand|collapse|dismiss)/i;
const FILE_OPEN = /^open$/i;
const REJECT = /^(reject|deny|bad|no\b)/i;
const NEUTRAL_DYNAMIC = /^(thought for|expand all|collapse all)/i;
const FILE_EXT = /\.(mjs|js|ts|tsx|jsx|json|html|css|py|sh|md|yml|yaml|xml|sql|txt|log|env|toml|mts|vue|svelte|prisma|graphql|rs|go|java|rb|php|swift|kt|c|h|cpp|hpp)$/i;

// ─── Workspace Cache ────────────────────────────────────────────────
let cachedWorkspace: string | null = null;

async function getWorkspace(): Promise<string | null> {
    if (cachedWorkspace) return cachedWorkspace;
    try {
        const res = await authFetch(`${getServerUrl()}/api/workspace`);
        const data = await res.json();
        cachedWorkspace = data.workspace;
        return cachedWorkspace;
    } catch (_) { return null; }
}

// Code-only extensions that should open in editor, not in view tab
const CODE_ONLY = /\.(ts|tsx|js|mjs|jsx|py|sh|rb|php|swift|kt|c|h|cpp|hpp|rs|go|java|vue|svelte|prisma|graphql)$/i;

/**
 * Bidirectional file open (SYNCHRONOUS for new tab — no async before tab open)
 * ALL files open in new tab via /api/files/view (server resolves name)
 * Code files additionally trigger CDP open-file in IDE (fire-and-forget)
 */
function openFileBidirectional(filePath: string, deps: HandlerDeps): void {
    if (!filePath) return;

    // ALWAYS open in new tab first (synchronous — works on iOS Safari)
    const url = buildViewUrl(filePath);
    openInNewTab(url);

    // For code files, also open in IDE via CDP (async, fire-and-forget)
    if (CODE_ONLY.test(filePath)) {
        (async () => {
            let resolvedPath = filePath;
            if (!filePath.startsWith('/')) {
                const ws = await getWorkspace();
                if (ws) {
                    if (filePath.includes('/')) {
                        resolvedPath = ws + '/' + filePath;
                    } else {
                        try {
                            const res = await authFetch(`${getServerUrl()}/api/files/find?name=${encodeURIComponent(filePath)}`);
                            const data = await res.json();
                            resolvedPath = data.results?.[0] || ws + '/' + filePath;
                        } catch { resolvedPath = ws + '/' + filePath; }
                    }
                }
            }
            const ext = '.' + (resolvedPath.split('.').pop()?.toLowerCase() || '');
            authFetch('/api/cdp/open-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: resolvedPath, diff: true }),
            }).catch(() => { /* silent */ });
            deps.viewFileDiff?.(resolvedPath, ext);
        })();
    }
}


/**
 * Find file path from nearby DOM context for "Open" button handlers
 */
function openFileFromNearbyContext(btnEl: HTMLElement, container: HTMLElement, deps: HandlerDeps): void {
    let fileName = '';
    let node: HTMLElement | null = btnEl.parentElement;

    for (let d = 0; d < 10 && node && node !== container; d++) {
        const fp = node.getAttribute('data-file-path');
        if (fp) { fileName = fp; break; }

        const breakAlls = node.querySelectorAll('span.break-all, [class*="break-all"]');
        for (const ba of breakAlls) {
            const text = (ba.textContent || '').trim().replace(/#L.*$/, '');
            if (text && !text.includes(' ') && FILE_EXT.test(text)) {
                fileName = text;
                break;
            }
        }
        if (fileName) break;
        node = node.parentElement as HTMLElement;
    }

    if (fileName) openFileBidirectional(fileName, deps);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Attach click handlers for interactive approval buttons (Accept/Reject/Open)
 */
export function attachInteractiveHandlers(container: HTMLElement, deps: HandlerDeps): void {
    container.querySelectorAll('[data-xpath]').forEach((el) => {
        const htmlEl = el as HTMLElement;
        const xpath = htmlEl.getAttribute('data-xpath');
        const label = (htmlEl.innerText || htmlEl.getAttribute('aria-label') || '').trim().slice(0, 60);
        if (!xpath || !label) return;
        if (IGNORED.test(label)) return;

        let action: string | null = null;
        if (FILE_OPEN.test(label)) action = 'file-open';
        else if (ACCEPT.test(label)) action = 'accept';
        else if (REJECT.test(label)) action = 'reject';
        else if (NEUTRAL_DYNAMIC.test(label)) action = 'neutral';
        else return;

        htmlEl.setAttribute('data-mobile-action', action);

        // Prevent duplicate handler bindings when using morphdom
        if (htmlEl.getAttribute('data-handler-attached')) return;
        htmlEl.setAttribute('data-handler-attached', 'true');

        htmlEl.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();

            if (action === 'file-open') {
                openFileFromNearbyContext(htmlEl, container, deps);
                return;
            }

            // Calculate occurrence index
            const firstLine = label.split('\n')[0].trim();
            const allWithXpath = container.querySelectorAll('[data-xpath]');
            let tapIndex = 0;
            for (const other of allWithXpath) {
                if (other === el) break;
                const otherLabel = ((other as HTMLElement).innerText || '').trim().split('\n')[0].trim();
                if (otherLabel === firstLine) tapIndex++;
            }

            const prev = htmlEl.style.opacity;
            htmlEl.style.opacity = '0.5';

            if (htmlEl.hasAttribute('aria-expanded')) {
                const cur = htmlEl.getAttribute('aria-expanded');
                htmlEl.setAttribute('aria-expanded', cur === 'true' ? 'false' : 'true');
            }

            // CDP click on IDE
            try {
                const res = await authFetch('/api/cdp/click', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ xpath, text: label, index: tapIndex }),
                });
                const result = await res.json();
                if (result.success) {
                    deps.showToast(`✓ ${label}`, 'success');
                } else {
                    deps.showToast(result.error || 'Click failed', 'error');
                    htmlEl.style.opacity = prev;
                }
            } catch (_err) {
                deps.showToast('Network error', 'error');
                htmlEl.style.opacity = prev;
            } finally {
                setTimeout(() => { htmlEl.style.opacity = prev; }, 500);
            }
        });
    });
}

/**
 * Attach click handlers for file path references
 */
export function attachFilePathHandlers(container: HTMLElement, deps: HandlerDeps): void {
    // 1. data-file-path elements
    container.querySelectorAll('[data-file-path]').forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.getAttribute('data-file-handler')) return;
        if (htmlEl.getAttribute('data-handler-attached')) return;
        htmlEl.setAttribute('data-file-handler', 'true');

        let filePath = htmlEl.getAttribute('data-file-path')!;
        filePath = filePath.replace(/#L.*$/, '');
        if (!filePath || filePath.includes('(') || filePath.includes(')') || filePath.length > 200) return;

        htmlEl.style.cursor = 'pointer';
        htmlEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            openFileBidirectional(filePath, deps);
        });
    });

    // 2. Inline code/span references
    container.querySelectorAll('span.break-all, code').forEach((el) => {
        const htmlEl = el as HTMLElement;
        const text = (htmlEl.textContent || '').trim();
        if (!text || text.length > 200) return;
        if (htmlEl.getAttribute('data-file-handler')) return;
        if (htmlEl.closest('[data-file-handler]')) return;
        if (htmlEl.getAttribute('data-mobile-action')) return;
        // Skip elements inside <a> tags — the anchor itself handles navigation
        if (htmlEl.closest('a[href]')) return;

        const isFilePath = (text.includes('/') || text.includes('\\')) && FILE_EXT.test(text);
        const isFileName = !text.includes(' ') && FILE_EXT.test(text) && text.length < 80;
        if (!isFilePath && !isFileName) return;

        if (htmlEl.getAttribute('data-handler-attached')) return;
        htmlEl.setAttribute('data-handler-attached', 'true');

        htmlEl.setAttribute('data-file-handler', 'true');
        htmlEl.style.cursor = 'pointer';
        htmlEl.style.textDecoration = 'underline';
        htmlEl.style.textDecorationStyle = 'dotted';

        htmlEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            openFileBidirectional(text.trim(), deps);
        });
    });

    // 3. Draggable tool result blocks (Analyzed/Edited/Created)
    container.querySelectorAll('span[draggable="true"]').forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.getAttribute('data-file-handler')) return;
        const fileSpan = htmlEl.querySelector('span.opacity-70, [class*="opacity-70"]');
        if (!fileSpan) return;

        let fileName = (fileSpan.textContent || '').trim().replace(/:$/, '');
        if (!fileName || !FILE_EXT.test(fileName)) return;

        if (htmlEl.getAttribute('data-handler-attached')) return;
        htmlEl.setAttribute('data-handler-attached', 'true');

        htmlEl.setAttribute('data-file-handler', 'true');
        htmlEl.style.cursor = 'pointer';
        htmlEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openFileBidirectional(fileName, deps);
        });
    });

    // 4. context-scope-mention without data-file-path
    container.querySelectorAll('.context-scope-mention, [class*="context-scope"]').forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.getAttribute('data-file-handler')) return;
        if (htmlEl.getAttribute('data-file-path')) return;

        const breakAll = htmlEl.querySelector('span.break-all, [class*="break-all"]');
        const text = breakAll ? (breakAll.textContent || '').trim() : (htmlEl.textContent || '').trim();
        if (!text || text.length > 200) return;

        const fileName = text.replace(/#L.*$/, '');
        if (!FILE_EXT.test(fileName)) return;

        if (htmlEl.getAttribute('data-handler-attached')) return;
        htmlEl.setAttribute('data-handler-attached', 'true');

        htmlEl.setAttribute('data-file-handler', 'true');
        htmlEl.style.cursor = 'pointer';
        htmlEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openFileBidirectional(fileName, deps);
        });
    });
}

/**
 * Intercept file:// links and viewable file paths in chat — open via /api/files/view tab
 * This handles:
 *  1. <a href="file:///path/to/file"> links (IDE renders these as clickable links)
 *  2. Artifact paths mentioned as plain text (.md, .pdf, images)
 *  3. PathsToReview artifact links from notify_user responses
 */
export function patchFileLinks(container: HTMLElement): void {
    // 1. <a href="file://..."> links — convert to server view endpoint
    container.querySelectorAll('a[href]').forEach((el) => {
        const anchor = el as HTMLAnchorElement;
        if (anchor.getAttribute('data-view-patched')) return;
        const href = anchor.getAttribute('href') || '';

        let filePath: string | null = null;
        if (href.startsWith('file:///')) {
            filePath = decodeURIComponent(href.replace('file://', ''));
        } else if (href.startsWith('file://')) {
            filePath = decodeURIComponent(href.replace('file://localhost', '').replace('file://', ''));
        }

        if (!filePath) return;
        if (!VIEW_EXTS.test(filePath)) return;

        anchor.setAttribute('data-view-patched', 'true');
        anchor.setAttribute('data-original-href', href);
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener');
        anchor.style.cursor = 'pointer';
        anchor.style.color = 'var(--brand, #a78bfa)';

        // Replace href with server view URL
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openInNewTab(buildViewUrl(filePath!));
        });
    });

    // 2. Artifact paths in tool result blocks (Analyzed / Edited / Created file:\/\/ paths)
    container.querySelectorAll('span[draggable="true"]').forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.getAttribute('data-view-patched')) return;

        // Look for file path text in child spans
        const pathSpan = htmlEl.querySelector('span.opacity-70, [class*="opacity-70"], span.break-all');
        const rawText = (pathSpan?.textContent || htmlEl.textContent || '').trim().replace(/:$/, '');
        if (!rawText || rawText.length > 300) return;

        // Check if it looks like an absolute path to a viewable file
        if (!rawText.startsWith('/') && !rawText.startsWith('~')) return;
        if (!VIEW_EXTS.test(rawText)) return;

        const filePath = rawText.replace(/^~/, /* home */ '/Users/' + (window as unknown as { __USERNAME__?: string }).__USERNAME__ || '~');

        // Add a small "↗" view button next to the element
        if (!htmlEl.querySelector('.mobile-view-btn')) {
            const btn = document.createElement('button');
            btn.className = 'mobile-view-btn';
            btn.textContent = '↗';
            btn.title = 'View in tab';
            btn.style.cssText = 'margin-left:6px;padding:1px 5px;font-size:11px;background:rgba(167,139,250,0.2);color:#a78bfa;border:1px solid rgba(167,139,250,0.4);border-radius:4px;cursor:pointer;vertical-align:middle;line-height:1.4';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openInNewTab(buildViewUrl(filePath));
            });
            htmlEl.appendChild(btn);
        }

        htmlEl.setAttribute('data-view-patched', 'true');
    });

    // 3. /api/files/view?path=... links (relative OR absolute with any host)
    //    IDE markdown renderer may resolve relative URLs to absolute using wrong host.
    //    Fix: set the href directly to the correct URL, let native Safari handle the click.
    container.querySelectorAll('a[href]').forEach((el) => {
        const anchor = el as HTMLAnchorElement;
        if (anchor.getAttribute('data-view-patched')) return;
        const href = anchor.getAttribute('href') || '';
        if (!href.includes('/api/files/view')) return;

        // Extract path param and rebuild with correct server URL
        let correctedUrl: string;
        try {
            const parsed = new URL(href, window.location.origin);
            const pathParam = parsed.searchParams.get('path') || '';
            const token = getToken() || '';
            const p = new URLSearchParams({ path: pathParam });
            if (token) p.set('token', token);
            correctedUrl = `${getServerUrl()}/api/files/view?${p.toString()}`;
        } catch {
            correctedUrl = getServerUrl() + '/api/files/view' + (href.split('/api/files/view')[1] || '');
        }

        // Set href to correct server URL, open in new tab
        anchor.href = correctedUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        anchor.style.color = 'var(--brand, #a78bfa)';
        anchor.style.cursor = 'pointer';
        anchor.style.fontWeight = 'bold'; // Visual indicator: link is active
        anchor.setAttribute('data-view-patched', 'true');
        console.warn('[AG] Section3 patched link:', correctedUrl);
        anchor.addEventListener('click', () => {
            console.warn('[AG] Section3 link clicked, navigating to:', correctedUrl);
        });
    });
}

/**
 * Hook into IDE's existing copy buttons for mobile clipboard
 */
export function hookIdeCopyButtons(container: HTMLElement, showToast: ShowToastFn): void {
    container.querySelectorAll('svg.lucide-copy, svg[class*="lucide-copy"]').forEach((svg) => {
        const btn = (svg.closest('button') || svg.parentElement) as HTMLElement | null;
        if (!btn || (btn as HTMLElement & { _mobileCopyHooked?: boolean })._mobileCopyHooked) return;
        (btn as HTMLElement & { _mobileCopyHooked?: boolean })._mobileCopyHooked = true;

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Walk up to find the code block
            let codeBlock: HTMLElement | null = null;
            let walker: HTMLElement | null = btn.parentElement;
            for (let i = 0; i < 8 && walker; i++) {
                codeBlock = walker.querySelector('pre');
                if (codeBlock) break;
                if (walker.nextElementSibling) {
                    codeBlock = walker.nextElementSibling.querySelector('pre') ||
                        (walker.nextElementSibling.tagName === 'PRE' ? walker.nextElementSibling as HTMLElement : null);
                    if (codeBlock) break;
                }
                walker = walker.parentElement;
            }

            const code = codeBlock
                ? (codeBlock.querySelector('code')?.textContent || codeBlock.textContent || '')
                : '';

            if (!code) {
                showToast('No code found', 'error');
                return;
            }

            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(code);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = code;
                    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
                showToast('Copied', 'success');
            } catch (_err) {
                showToast('Copy failed', 'error');
            }
        });
    });
}

/**
 * Attach all handlers to a rendered cascade container
 */
export function attachAllHandlers(container: HTMLElement, deps: HandlerDeps): void {
    attachInteractiveHandlers(container, deps);
    hookIdeCopyButtons(container, deps.showToast);
    attachFilePathHandlers(container, deps);
    // Must run on document.body, not just the cascade container,
    // because file links in AI text responses live outside the cascade
    patchFileLinks(document.body);
}
