/**
 * CDP Approvals — Pending approvals and element clicking
 */
import { withContexts } from './core.js';

interface ApprovalResult {
    pending: boolean;
    count: number;
    found?: boolean;
    approveButton?: { text: string; found: boolean } | null;
    rejectButton?: { text: string; found: boolean } | null;
    error?: string;
    debug?: Record<string, unknown>;
}

interface ApprovalResponse {
    found?: boolean;
    success: boolean;
    action?: string;
    buttonText?: string;
    error?: string;
}

interface ClickResult {
    success: boolean;
    tag?: string;
    text?: string;
    error?: string;
}

/**
 * Get pending command approvals from the IDE
 */
export async function getPendingApprovals(): Promise<ApprovalResult> {
    const fallback: ApprovalResult = { pending: false, count: 0 };

    return withContexts<ApprovalResult>(5000, async (call, contexts) => {
        const SCRIPT = `
            (function() {
                const allText = document.body.innerText || '';
                
                const hasStepRequiresInput = /\\d+\\s*step.*requires.*input/i.test(allText);
                const hasSendingInput = /suggested.*sending.*input.*command/i.test(allText);
                const hasSendCommandInput = /send.*command.*input/i.test(allText);
                
                const hasPendingApproval = hasStepRequiresInput || hasSendingInput || hasSendCommandInput;
                
                if (!hasPendingApproval) {
                    return { found: true, pending: false, count: 0 };
                }
                
                const match = allText.match(/(\\d+)\\s*step.*requires.*input/i);
                const count = match ? parseInt(match[1]) : 1;
                
                const buttons = document.querySelectorAll('button, [role="button"], [class*="cursor-pointer"]');
                let approveBtn = null;
                let rejectBtn = null;
                
                const approveKeywords = ['run', 'accept', 'approve', 'yes', 'confirm', 'allow'];
                const rejectKeywords = ['cancel', 'reject', 'no', 'deny', 'skip'];
                
                for (const btn of buttons) {
                    const text = (btn.innerText || btn.textContent || '').toLowerCase().trim();
                    if (text.length < 20) {
                        if (approveKeywords.some(k => text === k || text.includes(k))) {
                            approveBtn = { text, found: true };
                        }
                        if (rejectKeywords.some(k => text === k || text.includes(k))) {
                            rejectBtn = { text, found: true };
                        }
                    }
                }
                
                return {
                    found: true,
                    pending: true,
                    count: count,
                    approveButton: approveBtn,
                    rejectButton: rejectBtn
                };
            })()
        `;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    contextId: ctx.id
                });
                const value = (result as Record<string, Record<string, unknown>>).result?.value as ApprovalResult | undefined;
                if (value?.found && value.pending) {
                    return value;
                }
            } catch (_) { }
        }

        return fallback;
    }, fallback, 500);
}

/**
 * Respond to a pending approval (approve or reject)
 */
export async function respondToApproval(action: string): Promise<ApprovalResponse> {
    const isApprove = action === 'approve';
    const keywords = isApprove
        ? ['run', 'accept', 'approve', 'yes', 'confirm', 'allow']
        : ['cancel', 'reject', 'no', 'deny', 'skip'];

    const fallback: ApprovalResponse = { success: false, error: 'Could not find approval button' };

    return withContexts<ApprovalResponse>(5000, async (call, contexts) => {
        const SCRIPT = `
            (async function() {
                const keywords = ${JSON.stringify(keywords)};
                const isApprove = ${isApprove};
                
                const buttons = document.querySelectorAll('button, [role="button"], [class*="cursor-pointer"]');
                let targetBtn = null;
                
                for (const btn of buttons) {
                    const text = (btn.innerText || btn.textContent || '').toLowerCase().trim();
                    if (text.length < 20 && keywords.some(k => text === k || text.includes(k))) {
                        targetBtn = btn;
                        break;
                    }
                }
                
                if (targetBtn) {
                    targetBtn.scrollIntoView({ block: 'center' });
                    await new Promise(r => setTimeout(r, 100));
                    targetBtn.click();
                    return { 
                        found: true, 
                        success: true, 
                        action: isApprove ? 'approved' : 'rejected',
                        buttonText: targetBtn.innerText 
                    };
                }
                
                return { found: true, success: false, error: 'Button not found' };
            })()
        `;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });
                const value = (result as Record<string, Record<string, unknown>>).result?.value as ApprovalResponse | undefined;
                if (value?.found && value.success) {
                    return value;
                }
            } catch (_) { }
        }

        return fallback;
    }, fallback, 500);
}

/**
 * Click an element in the Antigravity chat by XPath
 */
export async function clickElementByXPath(xpath: string): Promise<ClickResult> {
    const fallback: ClickResult = { success: false, error: 'Cascade context not found' };

    return withContexts<ClickResult>(4000, async (call, contexts) => {
        const SCRIPT = `(() => {
            const cascade = document.getElementById('cascade') || document.getElementById('conversation');
            if (!cascade) return { found: false };
            try {
                const el = document.evaluate(
                    ${JSON.stringify(xpath)},
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                ).singleNodeValue;
                if (!el) return { found: true, clicked: false, error: 'XPath not found' };

                el.scrollIntoView({ block: 'center', behavior: 'instant' });
                const evtInit = { bubbles: true, cancelable: true, view: window };
                el.dispatchEvent(new PointerEvent('pointerdown', evtInit));
                el.dispatchEvent(new MouseEvent('mousedown', evtInit));
                el.dispatchEvent(new PointerEvent('pointerup', evtInit));
                el.dispatchEvent(new MouseEvent('mouseup', evtInit));
                el.dispatchEvent(new MouseEvent('click', evtInit));

                return { found: true, clicked: true, tag: el.tagName, text: (el.innerText || '').slice(0, 60) };
            } catch(e) {
                return { found: true, clicked: false, error: e.message };
            }
        })()`;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    contextId: ctx.id
                });
                const val = (result as Record<string, Record<string, unknown>>).result?.value as { found: boolean; clicked?: boolean; tag?: string; text?: string; error?: string } | undefined;
                if (val?.found) {
                    return val.clicked
                        ? { success: true, tag: val.tag, text: val.text }
                        : { success: false, error: val.error };
                }
            } catch (_) { }
        }

        return fallback;
    }, fallback, 500);
}
