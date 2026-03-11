/**
 * CDP Terminal — Remote terminal control via Chrome DevTools Protocol
 */
import { withContexts, findEditorTarget, connectToTarget } from './core.js';

export interface TerminalInfo {
    index: number;
    name: string;        // "Terminal 6, zsh"
    isActive: boolean;
    rows: number;
    cols: number;
    cursorX: number;
    cursorY: number;
    totalLines: number;
}

export interface TerminalContent {
    index: number;
    name: string;
    lines: string[];      // raw text lines
    contentHtml: string;  // with CSS color spans (heuristic)
    totalLines: number;
    rows: number;
    cols: number;
}

// ── Heuristic HTML coloring (server-side) ──────────────────────────

function colorizeLines(lines: string[]): string {
    return lines.map(line => {
        const trimmed = line.trimStart();

        // Prompt lines
        if (/^[$%>#]/.test(trimmed)) {
            return `<span class="term-prompt">${escapeHtml(line)}</span>`;
        }
        // Error lines
        if (/error|ERR|FAIL/i.test(line)) {
            return `<span class="term-error">${escapeHtml(line)}</span>`;
        }
        // Warning lines
        if (/warning|WARN/i.test(line)) {
            return `<span class="term-warn">${escapeHtml(line)}</span>`;
        }
        // Success lines
        if (/[✓✔]|success|passed/i.test(line)) {
            return `<span class="term-success">${escapeHtml(line)}</span>`;
        }
        // File path lines
        if (/^(\/|\.\/|~\/)/.test(trimmed)) {
            return `<span class="term-path">${escapeHtml(line)}</span>`;
        }
        return `<span class="term-line">${escapeHtml(line)}</span>`;
    }).join('\n');
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 1. listTerminals ───────────────────────────────────────────────

export async function listTerminals(): Promise<TerminalInfo[]> {
    return withContexts<TerminalInfo[]>(5000, async (call, contexts) => {
        const SCRIPT = `(() => {
            const wrappers = document.querySelectorAll('.terminal-wrapper');
            const tabs = document.querySelectorAll('.terminal-tabs-entry');
            const results = [];
            for (let i = 0; i < wrappers.length; i++) {
                const w = wrappers[i];
                const term = w.xterm;
                let name = 'Terminal ' + (i + 1);
                let rows = 0, cols = 0, cursorX = 0, cursorY = 0, totalLines = 0;
                let isActive = false;

                try {
                    const textarea = w.querySelector('.xterm-helper-textarea, .xterm .xterm-helper-textarea, textarea');
                    if (textarea) {
                        const label = textarea.getAttribute('aria-label') || '';
                        const firstLine = label.split('\\n')[0].trim();
                        if (firstLine) name = firstLine;
                    }
                } catch(_) {}

                if (term && term.buffer && term.buffer.active) {
                    const buf = term.buffer.active;
                    rows = buf.baseY + buf.cursorY + 1;
                    cols = term.cols || 0;
                    cursorX = buf.cursorX || 0;
                    cursorY = buf.cursorY || 0;
                    totalLines = buf.length || 0;
                    rows = term.rows || 0;
                }

                   // 1. Panel Terminal active check
                // Nếu terminal này nằm trong chuẩn Panel và có class active -> nó được hiển thị
                if (w.closest('#workbench\\\\.parts\\\\.panel') && w.classList.contains('active')) {
                    isActive = true;
                } 
                // 2. Chat/Sidebar terminal (hoặc panel terminal bị lỗi mảng tab) 
                // Nếu nó không bị display none, offsetParent có tồn tại và diện tích > 0 
                else {
                    const rect = w.getBoundingClientRect();
                    const style = window.getComputedStyle(w);
                    if (w.offsetParent !== null && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
                        isActive = true;
                    }
                }

                results.push({ index: i, name, isActive, rows, cols, cursorX, cursorY, totalLines });
            }
            return results;
        })()`;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    contextId: ctx.id
                });
                const resObj = result as Record<string, any>;
                const value = resObj.result?.value as TerminalInfo[] | undefined;
                if (Array.isArray(value)) return value;
            } catch (_) {}
        }
        return [];
    }, []);
}

// ── 2. getTerminalContent ──────────────────────────────────────────

export async function getTerminalContent(index: number): Promise<TerminalContent | null> {
    return withContexts<TerminalContent | null>(8000, async (call, contexts) => {
        const SCRIPT = `(() => {
            const wrappers = document.querySelectorAll('.terminal-wrapper');
            if (!wrappers[${index}]) return null;
            const w = wrappers[${index}];
            const term = w.xterm;
            if (!term || !term.buffer || !term.buffer.active) return null;

            const buf = term.buffer.active;
            let name = 'Terminal ' + (${index} + 1);
            try {
                const textarea = w.querySelector('.xterm-helper-textarea, .xterm .xterm-helper-textarea, textarea');
                if (textarea) {
                    const label = textarea.getAttribute('aria-label') || '';
                    const firstLine = label.split('\\n')[0].trim();
                    if (firstLine) name = firstLine;
                }
            } catch(_) {}

            const lines = [];
            const totalLinesCount = buf.length || 0;
            for (let i = 0; i < totalLinesCount; i++) {
                const line = buf.getLine(i);
                if (!line) { lines.push(''); continue; }
                const text = line.translateToString(true);
                if (line.isWrapped && lines.length > 0) {
                    lines[lines.length - 1] += text;
                } else {
                    lines.push(text);
                }
            }

            return {
                index: ${index},
                name,
                lines,
                totalLines: lines.length,
                rows: term.rows || 0,
                cols: term.cols || 0
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
                const value = resObj.result?.value as { index: number; name: string; lines: string[]; totalLines: number; rows: number; cols: number } | null | undefined;
                if (value && Array.isArray(value.lines)) {
                    return {
                        index: value.index,
                        name: value.name,
                        lines: value.lines,
                        contentHtml: colorizeLines(value.lines),
                        totalLines: value.totalLines,
                        rows: value.rows,
                        cols: value.cols,
                    };
                }
            } catch (_) {}
        }
        return null;
    }, null);
}

// ── 3. sendTerminalInput ───────────────────────────────────────────

export async function sendTerminalInput(index: number, text: string): Promise<{ success: boolean; error?: string }> {
    const target = await findEditorTarget();
    if (!target) return { success: false, error: 'No editor target found' };

    const client = await connectToTarget(target);

    try {
        // Focus the correct terminal's textarea
        const focusResult = await client.send('Runtime.evaluate', {
            expression: `(() => {
                const wrappers = document.querySelectorAll('.terminal-wrapper');
                if (!wrappers[${index}]) return { error: 'Terminal not found' };
                const textarea = wrappers[${index}].querySelector('.xterm-helper-textarea, .xterm .xterm-helper-textarea, textarea');
                if (!textarea) return { error: 'Textarea not found' };
                textarea.focus();
                return { ok: true };
            })()`,
            returnByValue: true
        });

        const focusVal = (focusResult as Record<string, any>).result?.value;
        if (focusVal?.error) return { success: false, error: focusVal.error };

        await new Promise(r => setTimeout(r, 50));

        // Insert text
        await client.send('Input.insertText', { text });

        await new Promise(r => setTimeout(r, 50));

        // Press Enter
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13
        });

        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    } finally {
        client.close();
    }
}

// ── 4. switchTerminal ──────────────────────────────────────────────

export async function switchTerminal(index: number): Promise<{ success: boolean; error?: string }> {
    return withContexts<{ success: boolean; error?: string }>(5000, async (call, contexts) => {
        const SCRIPT = `(() => {
            const tabs = document.querySelectorAll('.terminal-tabs-entry');
            if (tabs.length > 0 && tabs[${index}]) { 
                tabs[${index}].click(); 
                return { success: true }; 
            }
            
            // Fallback: focus the terminal's textarea if tabs are collapsed/hidden
            const wrappers = document.querySelectorAll('.terminal-wrapper');
            if (wrappers[${index}]) {
                const textarea = wrappers[${index}].querySelector('.xterm-helper-textarea, .xterm .xterm-helper-textarea, textarea');
                if (textarea) {
                    textarea.focus();
                    return { success: true };
                }
            }
            
            return { success: false, error: 'Tab not found and fallback failed' };
        })()`;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    contextId: ctx.id
                });
                const resObj = result as Record<string, any>;
                const value = resObj.result?.value as { success: boolean; error?: string } | undefined;
                if (value) return value;
            } catch (_) {}
        }
        return { success: false, error: 'No context responded' };
    }, { success: false, error: 'CDP connection failed' });
}

// ── 5. createTerminal ──────────────────────────────────────────────

export async function createTerminal(): Promise<{ success: boolean; error?: string }> {
    return withContexts<{ success: boolean; error?: string }>(5000, async (call, contexts) => {
        const SCRIPT = `(() => {
            const btn = document.querySelector('[aria-label*="New Terminal"]') || document.querySelector('.codicon-plus');
            if (btn) { btn.click(); return { success: true }; }
            return { success: false, error: 'New Terminal button not found' };
        })()`;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    contextId: ctx.id
                });
                const resObj = result as Record<string, any>;
                const value = resObj.result?.value as { success: boolean; error?: string } | undefined;
                if (value) return value;
            } catch (_) {}
        }
        return { success: false, error: 'No context responded' };
    }, { success: false, error: 'CDP connection failed' });
}

// ── 6. closeTerminal ───────────────────────────────────────────────

export async function closeTerminal(index: number): Promise<{ success: boolean; error?: string }> {
    const target = await findEditorTarget();
    if (!target) return { success: false, error: 'No editor target found' };

    const client = await connectToTarget(target);

    try {
        // Focus the terminal's textarea first
        const focusResult = await client.send('Runtime.evaluate', {
            expression: `(() => {
                const wrappers = document.querySelectorAll('.terminal-wrapper');
                if (!wrappers[${index}]) return { error: 'Terminal not found' };
                const textarea = wrappers[${index}].querySelector('.xterm-helper-textarea, .xterm .xterm-helper-textarea, textarea');
                if (!textarea) return { error: 'Textarea not found' };
                textarea.focus();
                return { ok: true };
            })()`,
            returnByValue: true
        });

        const focusVal = (focusResult as Record<string, any>).result?.value;
        if (focusVal?.error) return { success: false, error: focusVal.error };

        await new Promise(r => setTimeout(r, 50));

        // Send "exit" command
        await client.send('Input.insertText', { text: 'exit' });

        await new Promise(r => setTimeout(r, 50));

        // Press Enter
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13
        });

        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    } finally {
        client.close();
    }
}

/**
 * Send a raw key event to a terminal (e.g. Tab, Escape, Arrows)
 */
export async function sendTerminalRawKey(
    index: number,
    key: string,
    code: string,
    keyCode: number
): Promise<{ success: boolean; error?: string }> {
    const target = await findEditorTarget();
    if (!target) return { success: false, error: 'No editor target found' };

    const client = await connectToTarget(target);

    try {
        // Focus the correct terminal's textarea
        const focusResult = await client.send('Runtime.evaluate', {
            expression: `(() => {
                const wrappers = document.querySelectorAll('.terminal-wrapper');
                if (!wrappers[${index}]) return { error: 'Terminal not found' };
                const textarea = wrappers[${index}].querySelector('.xterm-helper-textarea, .xterm .xterm-helper-textarea, textarea');
                if (!textarea) return { error: 'Textarea not found' };
                textarea.focus();
                return { ok: true };
            })()`,
            returnByValue: true
        });

        const focusVal = (focusResult as Record<string, any>).result?.value;
        if (focusVal?.error) return { success: false, error: focusVal.error };

        await new Promise(r => setTimeout(r, 50));

        // Send keyDown + keyUp
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key,
            code,
            windowsVirtualKeyCode: keyCode,
            nativeVirtualKeyCode: keyCode
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key,
            code,
            windowsVirtualKeyCode: keyCode,
            nativeVirtualKeyCode: keyCode
        });

        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    } finally {
        client.close();
    }
}

/**
 * Send a special key combo to a terminal (e.g. Ctrl+C, Ctrl+L)
 */
export async function sendTerminalSpecialKey(
    index: number,
    char: string,
    ctrl: boolean
): Promise<{ success: boolean; error?: string }> {
    const target = await findEditorTarget();
    if (!target) return { success: false, error: 'No editor target found' };

    const client = await connectToTarget(target);

    try {
        // Focus the correct terminal's textarea
        const focusResult = await client.send('Runtime.evaluate', {
            expression: `(() => {
                const wrappers = document.querySelectorAll('.terminal-wrapper');
                if (!wrappers[${index}]) return { error: 'Terminal not found' };
                const textarea = wrappers[${index}].querySelector('.xterm-helper-textarea, .xterm .xterm-helper-textarea, textarea');
                if (!textarea) return { error: 'Textarea not found' };
                textarea.focus();
                return { ok: true };
            })()`,
            returnByValue: true
        });

        const focusVal = (focusResult as Record<string, any>).result?.value;
        if (focusVal?.error) return { success: false, error: focusVal.error };

        await new Promise(r => setTimeout(r, 50));

        const modifiers = ctrl ? 2 : 0; // CDP: 2 = Ctrl

        await client.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: char,
            code: `Key${char.toUpperCase()}`,
            modifiers,
            windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0),
            nativeVirtualKeyCode: char.toUpperCase().charCodeAt(0)
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: char,
            code: `Key${char.toUpperCase()}`,
            modifiers,
            windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0),
            nativeVirtualKeyCode: char.toUpperCase().charCodeAt(0)
        });

        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    } finally {
        client.close();
    }
}




