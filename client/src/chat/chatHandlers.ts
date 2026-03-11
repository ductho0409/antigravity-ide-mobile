/**
 * chatHandlers — Interactive button/file/copy handlers for IDE snapshot
 * Ported from public/js/mobile/chat-live.js (attachInteractiveHandlers, attachFilePathHandlers, hookIdeCopyButtons)
 */
import { authFetch, getServerUrl } from '../hooks/useApi';

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

/**
 * Bidirectional file open — opens on BOTH mobile viewer AND IDE
 */
async function openFileBidirectional(filePath: string, deps: HandlerDeps): Promise<void> {
    if (!filePath) return;
    const ext = '.' + filePath.split('.').pop();
    let resolvedPath = filePath;

    // Resolve non-absolute paths
    if (!filePath.startsWith('/')) {
        const ws = await getWorkspace();
        if (ws) {
            if (filePath.includes('/')) {
                resolvedPath = ws + '/' + filePath;
            } else {
                try {
                    const res = await authFetch(`${getServerUrl()}/api/files/find?name=${encodeURIComponent(filePath)}`);
                    const data = await res.json();
                    if (data.results?.length > 0) {
                        resolvedPath = data.results[0];
                    } else {
                        resolvedPath = ws + '/' + filePath;
                    }
                } catch (_) {
                    resolvedPath = ws + '/' + filePath;
                }
            }
        }
    }

    // Open on IDE (fire-and-forget)
    authFetch('/api/cdp/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: resolvedPath, diff: true }),
    }).catch(() => { /* silent */ });

    // Open on mobile
    deps.viewFileDiff?.(resolvedPath, ext);
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
}
