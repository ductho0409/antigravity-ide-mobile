/**
 * CDP Snapshot — Clean chat snapshot with image conversion
 */
import { withContexts } from './core.js';

interface SnapshotResult {
    html: string;
    css: string;
    backgroundColor?: string;
    color?: string;
    fontFamily?: string;
    scrollInfo: {
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
        scrollPercent: number;
    };
    stats: {
        nodes: number;
        htmlSize: number;
        cssSize: number;
    };
    messages: Array<{ fingerprint: string; html: string }>;
    error?: string;
}

/**
 * Capture a CLEAN chat snapshot: removes Review Changes bars,
 * Linked Objects, desktop input areas, empty placeholders.
 * Converts local/SVG images to base64 data URIs.
 */
let lastFullSnapshot: SnapshotResult | null = null;

/** Clear the cached snapshot — must be called on window switch */
export function clearLastSnapshot(): void {
    lastFullSnapshot = null;
}

export async function getChatSnapshotClean(): Promise<SnapshotResult | null> {
    return withContexts<SnapshotResult | null>(8000, async (call, contexts) => {
        const SCRIPT = `(() => {
            const CONTAINER_IDS = ['cascade', 'conversation', 'chat'];
            let cascade = null;
            for (const id of CONTAINER_IDS) {
                cascade = document.getElementById(id);
                if (cascade) break;
            }
            if (!cascade) return { error: 'chat container not found' };

            const cascadeStyles = window.getComputedStyle(cascade);
            const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
            
            // Caching mechanism setup
            window._cdpCache = window._cdpCache || { css: null, images: {}, lastChecksum: '' };
            const currentChecksum = cascade.children.length + '_' + (cascade.textContent || '').length + '_' + scrollContainer.scrollHeight;
            if (window._cdpCache.lastChecksum === currentChecksum) {
                return { not_changed: true };
            }
            window._cdpCache.lastChecksum = currentChecksum;
            const scrollInfo = {
                scrollTop: scrollContainer.scrollTop,
                scrollHeight: scrollContainer.scrollHeight,
                clientHeight: scrollContainer.clientHeight,
                scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
            };

            // === INJECT FILE PATHS before cloning ===
            const FILE_EXT_RE = /\\.(mjs|js|ts|tsx|jsx|json|html|css|py|sh|md|yml|yaml|xml|sql|txt|log|env|toml|mts|vue|svelte|prisma|graphql|rs|go|java|rb|php|swift|kt|c|h|cpp|hpp)$/i;
            try {
                cascade.querySelectorAll('span[draggable="true"]').forEach(chip => {
                    const breakAll = chip.querySelector('span.break-all, [class*="break-all"]');
                    if (!breakAll) return;
                    let name = (breakAll.textContent || '').trim();
                    if (!name || name.includes(' ') || name.length > 150) return;
                    name = name.replace(/#L.*$/, '');
                    if (!FILE_EXT_RE.test(name)) return;
                    chip.setAttribute('data-file-path', name);
                    const mention = chip.closest('.context-scope-mention, [class*="context-scope"]');
                    if (mention) mention.setAttribute('data-file-path', name);
                });

                cascade.querySelectorAll('.cursor-pointer, [class*="cursor-pointer"]').forEach(row => {
                    if (row.getAttribute('data-file-path')) return;
                    const text = (row.textContent || '').trim();
                    if (text.length > 200) return;
                    const match = text.match(/([^\\s/\\\\]+\\.(mjs|js|ts|tsx|jsx|json|html|css|py|md|yml|yaml|sh))/i);
                    if (match) row.setAttribute('data-file-path', match[1]);
                });

                cascade.querySelectorAll('span[data-tooltip-id^="changes-overview"]').forEach(span => {
                    const relPath = (span.textContent || '').trim();
                    if (!relPath) return;
                    const row = span.closest('.cursor-pointer, [class*="cursor-pointer"]') || span.closest('[class*="flex"]');
                    if (row && !row.getAttribute('data-file-path')) {
                        row.setAttribute('data-file-path', relPath);
                    }
                });

                cascade.querySelectorAll('span.break-all, [class*="break-all"]').forEach(span => {
                    const name = (span.textContent || '').trim().replace(/#L.*$/, '');
                    if (!name || name.includes(' ') || !FILE_EXT_RE.test(name)) return;
                    if (span.closest('[data-file-path]')) return;
                    const row = span.closest('[class*="border"], [class*="rounded"], [class*="flex"]');
                    if (row && !row.getAttribute('data-file-path')) {
                        row.setAttribute('data-file-path', name);
                    }
                });
            } catch(_) {}

            // Annotate interactive elements with XPath so mobile can forward clicks via CDP
            function getXPath(el) {
                if (!el || el === document.body) return '/html/body';
                const parts = [];
                let node = el;
                while (node && node.nodeType === 1) {
                    let idx = 1;
                    let sib = node.previousElementSibling;
                    while (sib) { if (sib.tagName === node.tagName) idx++; sib = sib.previousElementSibling; }
                    parts.unshift(node.tagName.toLowerCase() + '[' + idx + ']');
                    node = node.parentElement;
                }
                return '/' + parts.join('/');
            }
            let mobileIdCounter = 0;
            cascade.querySelectorAll('button, [role="button"], [aria-expanded], [data-collapsed], summary').forEach(el => {
                const mid = 'mid_' + (mobileIdCounter++);
                el.setAttribute('data-mid', mid);
                el.setAttribute('data-xpath', getXPath(el));
            });

            const clone = cascade.cloneNode(true);


            try {
                clone.querySelectorAll('span[draggable="true"]').forEach(chip => {
                    chip.className = chip.className
                        .replace(/(?:^|\\s)flex(?=\\s|$)/g, '')
                        .replace(/\\s{2,}/g, ' ')
                        .trim();
                });
            } catch(_) {}

            // Fix: convert <div> inside file chips → <span> to prevent <p> auto-close
            // Block <div> inside <p> causes browser to force-close the <p>, making
            // the file icon and filename render on new lines instead of staying inline.
            try {
                clone.querySelectorAll('span[draggable="true"] div, .context-scope-mention div').forEach(divEl => {
                    const span = document.createElement('span');
                    if (divEl.className) span.className = divEl.className;
                    const existingStyle = divEl.getAttribute('style') || '';
                    const sep = existingStyle && !existingStyle.endsWith(';') ? ';' : '';
                    span.setAttribute('style', existingStyle + sep + 'display:inline-block;vertical-align:middle;');
                    while (divEl.firstChild) span.appendChild(divEl.firstChild);
                    if (divEl.parentElement) divEl.parentElement.replaceChild(span, divEl);
                });
            } catch(_) {}


            try {
                const removeSelectors = [
                    '.relative.flex.flex-col.gap-8',
                    '.outline-solid.justify-between',
                    '[contenteditable="true"]',
                    '.p-1.bg-gray-500\\\\/10',
                    '[data-testid="add-context"]',
                    'button[aria-label*="Add Context"]',
                    '[class*="linked-object"]',
                    '[class*="chip-container"]',
                    '.flex.items-center.justify-between.px-2.py-1',
                    '.bg-gray-500\\\\/10:empty',
                    '[class*="bg-gray-500"]:empty',
                ];

                removeSelectors.forEach(selector => {
                    clone.querySelectorAll(selector).forEach(el => {
                        try {
                            if (selector === '[contenteditable="true"]') {
                                const area = el.closest('.relative.flex.flex-col.gap-8') ||
                                             el.closest('.flex.grow.flex-col.justify-start.gap-8') ||
                                             el.parentElement?.parentElement;
                                if (area && area !== clone) area.remove();
                                else el.remove();
                            } else {
                                el.remove();
                            }
                        } catch(_) {}
                    });
                });

                clone.querySelectorAll('*').forEach(el => {
                    try {
                        const text = (el.innerText || '').toLowerCase().trim();
                        if (text.length > 80 || el.children.length > 5) return;
                        const shouldRemove = 
                            text === 'review changes' ||
                            text === 'files with changes' ||
                            text === 'context found' ||
                            text === 'add context' ||
                            text === 'linked objects' ||
                            text === 'no file is open';
                        if (shouldRemove) {
                            el.remove();
                        }
                    } catch(_) {}
                });

                clone.querySelectorAll('div').forEach(el => {
                    try {
                        if (!el.children.length && !(el.textContent || '').trim() && !el.querySelector('img,svg,canvas')) {
                            const h = el.offsetHeight || parseInt(el.style.height) || parseInt(el.style.minHeight) || 0;
                            if (h > 50) el.remove();
                        }
                    } catch(_) {}
                });

            clone.querySelectorAll('img[src], svg').forEach(el => {
                try {
                    let cacheKey = '';
                    if (el.tagName === 'SVG') {
                        const raw = el.outerHTML;
                        let fp = 0;
                        for (let j = 0; j < raw.length; j++) { fp = ((fp << 5) - fp) + raw.charCodeAt(j); fp = fp & fp; }
                        cacheKey = 'svg_' + fp;
                    } else {
                        if (el.src && (el.src.startsWith('data:') || el.src.startsWith('http'))) return;
                        cacheKey = 'img_' + el.src;
                    }

                    if (window._cdpCache.images[cacheKey]) {
                        const img = document.createElement('img');
                        img.src = window._cdpCache.images[cacheKey];
                        img.style.cssText = el.style.cssText || '';
                        img.width = el.getAttribute('width') || el.clientWidth || 16;
                        img.height = el.getAttribute('height') || el.clientHeight || 16;
                        el.replaceWith(img);
                        return;
                    }

                    if (el.tagName === 'SVG') {
                        const svgData = new XMLSerializer().serializeToString(el);
                        const img = document.createElement('img');
                        const b64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                        window._cdpCache.images[cacheKey] = b64;
                        img.src = b64;
                        img.style.cssText = el.style.cssText || '';
                        img.width = el.getAttribute('width') || el.clientWidth || 16;
                        img.height = el.getAttribute('height') || el.clientHeight || 16;
                        el.replaceWith(img);
                    } else if (el.src && !el.src.startsWith('data:') && !el.src.startsWith('http')) {
                        try {
                            const canvas = document.createElement('canvas');
                            canvas.width = el.naturalWidth || el.width || 16;
                            canvas.height = el.naturalHeight || el.height || 16;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(el, 0, 0);
                            const b64 = canvas.toDataURL('image/png');
                            window._cdpCache.images[cacheKey] = b64;
                            el.src = b64;
                        } catch(_) {}
                    }
                } catch(_) {}
            });
            } catch(_) {}

            // Fix 3: strip touch-action:none and overflow:hidden from inline styles
            let html = clone.outerHTML;
            html = html.replace(/touch-action:\s*none;?\s*/gi, '');
            html = html.replace(/overflow:\s*hidden;?\s*/gi, '');

            // Extract per-child messages for scroll accumulation cache
            const messages = [];
            for (let i = 0; i < clone.children.length; i++) {
                const child = clone.children[i];
                const text = (child.textContent || '').trim().substring(0, 200);
                let fp = 0;
                for (let j = 0; j < text.length; j++) {
                    fp = ((fp << 5) - fp) + text.charCodeAt(j);
                    fp = fp & fp;
                }
                messages.push({ fingerprint: fp.toString(36), html: child.outerHTML });
            }


            let allCSS = window._cdpCache?.css;
            if (!allCSS) {
                // Fix 2: extract CSS custom properties (--vscode-*, --ide-*, etc.) from body
                const computed = window.getComputedStyle(document.body);
                let variables = ':root {';
                for (let i = 0; i < computed.length; i++) {
                    const prop = computed[i];
                    if (prop.startsWith('--')) {
                        variables += prop + ': ' + computed.getPropertyValue(prop) + ';';
                    }
                }
                variables += '}';

                // Fix 1: collect CSS and remap body/html → #cascade-container
                const rules = [];
                for (const sheet of document.styleSheets) {
                    try {
                        for (const rule of sheet.cssRules) {
                            let text = rule.cssText;
                            text = text.replace(/(^|[\s,}])body(?=[\s,{])/gi, '$1#cascade-container');
                            text = text.replace(/(^|[\s,}])html(?=[\s,{])/gi, '$1#cascade-container');
                            text = text.replace(/touch-action:\s*none;?/gi, '');
                            text = text.replace(/overscroll-behavior:\s*none;?/gi, '');
                            rules.push(text);
                        }
                    } catch(_) {}
                }
                allCSS = variables + rules.join('\\n');
                window._cdpCache.css = allCSS;
            }

            return {
                html,
                css: allCSS,
                backgroundColor: cascadeStyles.backgroundColor,
                color: cascadeStyles.color,
                fontFamily: cascadeStyles.fontFamily,
                scrollInfo,
                messages,
                stats: {
                    nodes: clone.getElementsByTagName('*').length,
                    htmlSize: html.length,
                    cssSize: allCSS.length
                }
            };
        })()`;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    contextId: ctx.id
                });

                const resObj = result as Record<string, any>;
                if (resObj.exceptionDetails) {
                    console.error('[snapshot] Runtime.evaluate exception:', JSON.stringify(resObj.exceptionDetails, null, 2));
                }

                const value = resObj.result?.value as Record<string, any> | undefined;
                if (value && value.not_changed) {
                    if (lastFullSnapshot) return lastFullSnapshot;
                    // Server restarted but browser cache still has old checksum — clear it and retry
                    await call('Runtime.evaluate', {
                        expression: `(() => { if (window._cdpCache) window._cdpCache.lastChecksum = ''; })()`,
                        returnByValue: true,
                        contextId: ctx.id
                    });
                    const retry = await call('Runtime.evaluate', {
                        expression: SCRIPT,
                        returnByValue: true,
                        contextId: ctx.id
                    });
                    const retryVal = (retry as Record<string, any>).result?.value as Record<string, any> | undefined;
                    if (retryVal && !retryVal.error && !retryVal.not_changed) {
                        lastFullSnapshot = retryVal as SnapshotResult;
                        return lastFullSnapshot;
                    }
                    return null;
                }
                if (value && !value.error) {
                    lastFullSnapshot = value as SnapshotResult;
                    return lastFullSnapshot;
                }
            } catch (e) {
                console.error('[snapshot] CDP call error:', e);
            }
        }

        return null;
    }, null, 100);
}
