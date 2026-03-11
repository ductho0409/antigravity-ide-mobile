/**
 * CDP Scroll Sync — Phone scroll → Desktop Antigravity scroll
 */
import { withContexts } from './core.js';

interface ScrollResult {
    success: boolean;
    scrollTop?: number;
    maxScroll?: number;
    error?: string;
}

interface ScrollOptions {
    scrollTop?: number;
    scrollPercent?: number;
}

/**
 * Remote scroll the desktop Antigravity chat to match phone position
 */
export async function remoteScroll(opts: ScrollOptions = {}): Promise<ScrollResult> {
    const fallback: ScrollResult = { success: false, error: 'No context could execute' };
    const scrollPercent = opts.scrollPercent ?? 1;

    return withContexts<ScrollResult>(3000, async (call, contexts) => {
        const SCRIPT = `(() => {
            try {
                const CONTAINER_IDS = ['cascade', 'conversation', 'chat'];
                let container = null;
                for (const id of CONTAINER_IDS) {
                    container = document.getElementById(id);
                    if (container) break;
                }
                if (!container) {
                    container = document.querySelector('.overflow-y-auto, [data-scroll-area]');
                }
                if (!container) return { success: false, error: 'Scroll container not found' };

                const scrollable = container.querySelector('.overflow-y-auto') || container;
                const maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
                scrollable.scrollTop = maxScroll * ${scrollPercent};
                return { success: true, scrollTop: scrollable.scrollTop, maxScroll };
            } catch(e) { return { success: false, error: e.toString() }; }
        })()`;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    contextId: ctx.id
                });
                const value = (result as Record<string, Record<string, unknown>>).result?.value as ScrollResult | undefined;
                if (value?.success) {
                    return value;
                }
            } catch (_) { }
        }

        return fallback;
    }, fallback, 300);
}
