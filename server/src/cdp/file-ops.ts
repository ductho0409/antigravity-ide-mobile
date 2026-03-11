/**
 * CDP File Operations — Open files and trigger diff view in IDE
 */
import { findEditorTarget, connectToTarget } from './core.js';
import { execFileSync } from 'child_process';
import { basename } from 'path';

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

interface FileOpResult {
    success: boolean;
    method?: string;
    file?: string;
    relPath?: string;
    path?: string;
    error?: string;
    attempts?: FileOpResult[];
}

// ─── Strategy 1: Click "Files Edited" row in chat ───────────────────────────

async function clickChatFileRow(client: { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>; close: () => void }, filePath: string): Promise<FileOpResult> {
    const fileName = basename(filePath);
    const safeFileName = JSON.stringify(fileName);

    const result = await client.send('Runtime.evaluate', {
        expression: `(function() {
            try {
                var name = ${safeFileName};
                var rows = document.querySelectorAll('.flex.cursor-pointer.select-none');
                for (var i = 0; i < rows.length; i++) {
                    var pathSpan = rows[i].querySelector('span[data-tooltip-id], span.break-all, [class*="break-all"]');
                    var spanText = pathSpan ? pathSpan.textContent.trim() : '';
                    var rowText = rows[i].textContent || '';
                    var matchTarget = spanText || rowText;
                    if (matchTarget === name || matchTarget.endsWith('/' + name) || matchTarget.endsWith('\\\\' + name)) {
                        rows[i].click();
                        var relPath = pathSpan ? pathSpan.textContent.trim() : name;
                        return { success: true, method: 'chat_file_click', file: name, relPath: relPath };
                    }
                }
                return { success: false, error: 'File not found in chat Files Edited block' };
            } catch (err) {
                return { success: false, error: err.message };
            }
        })()`,
        returnByValue: true
    });

    return (result as Record<string, Record<string, unknown>>).result?.value as FileOpResult || { success: false, error: 'No result' };
}

// ─── Strategy 2: Click existing tab ─────────────────────────────────────────

async function clickTab(client: { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>; close: () => void }, filePath: string): Promise<FileOpResult> {
    const fileName = basename(filePath);
    const safeFileName = JSON.stringify(fileName);

    const result = await client.send('Runtime.evaluate', {
        expression: `(function() {
            try {
                var name = ${safeFileName};
                var tabs = document.querySelectorAll('[role="tab"]');
                for (var i = 0; i < tabs.length; i++) {
                    var label = tabs[i].getAttribute('aria-label') || '';
                    if (label.indexOf(name) >= 0 && label.indexOf('(Working Tree)') < 0) {
                        tabs[i].click();
                        return { success: true, method: 'tab_click', file: name };
                    }
                }
                return { success: false, error: 'Tab not found for ' + name };
            } catch (err) {
                return { success: false, error: err.message };
            }
        })()`,
        returnByValue: true
    });

    return (result as Record<string, Record<string, unknown>>).result?.value as FileOpResult || { success: false, error: 'No result' };
}

// ─── Strategy 3: CLI — open AND navigate to file tab ────────────────────────

function openViaCLI(filePath: string): FileOpResult {
    // Try 'antigravity' CLI first (--reuse-window --goto opens AND activates the tab)
    try {
        execFileSync('antigravity', ['--reuse-window', '--goto', `${filePath}:1:1`], { timeout: 5000 });
        return { success: true, method: 'antigravity_goto', path: filePath };
    } catch {
        // Fallback to macOS 'open' command
        try {
            execFileSync('open', [filePath], { timeout: 5000 });
            return { success: true, method: 'cli_open', path: filePath };
        } catch (e) {
            return { success: false, method: 'cli_open', error: (e as Error).message };
        }
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Open a file in the IDE — tries multiple strategies with fallback
 */
export async function openFileInIDE(filePath: string, strategy?: string): Promise<FileOpResult> {
    const results: FileOpResult[] = [];
    console.log(`[file-ops] openFileInIDE: "${filePath}" strategy=${strategy || 'auto'}`);

    // Strategy 1: CLI — most reliable for navigating + activating tab
    if (!strategy || strategy === 'cli') {
        const cliResult = openViaCLI(filePath);
        console.log(`[file-ops] CLI:`, JSON.stringify(cliResult));
        if (cliResult.success) return cliResult;
        results.push(cliResult);
    }

    // Strategy 2+3: CDP fallbacks (click chat row, click tab)
    try {
        const target = await findEditorTarget();
        if (!target) throw new Error('No editor target');

        const client = await connectToTarget(target);
        try {
            if (!strategy || strategy === 'chat') {
                const chatResult = await clickChatFileRow(client, filePath);
                console.log(`[file-ops] Chat click:`, JSON.stringify(chatResult));
                if (chatResult.success) return chatResult;
                results.push(chatResult);
            }

            if (!strategy || strategy === 'tab') {
                const tabResult = await clickTab(client, filePath);
                console.log(`[file-ops] Tab click:`, JSON.stringify(tabResult));
                if (tabResult.success) return tabResult;
                results.push(tabResult);
            }
        } finally {
            client.close();
        }
    } catch (e) {
        results.push({ success: false, method: 'cdp', error: (e as Error).message });
    }

    return { success: false, error: 'All strategies failed', attempts: results };
}

/**
 * Open a file's diff/changes view in the IDE
 * Step 1: Open file (navigate + activate tab)
 * Step 2: Trigger diff view via CDP git.openChange command
 */
export async function openFileDiffInIDE(filePath: string, strategy?: string): Promise<FileOpResult> {
    // Step 1: Open file first
    const openResult = await openFileInIDE(filePath, strategy);
    if (!openResult.success) return openResult;

    // Step 2: Wait for tab to activate, then trigger diff
    await new Promise(r => setTimeout(r, 600));

    try {
        const target = await findEditorTarget();
        if (!target) {
            return { success: true, method: 'opened_no_diff', path: filePath };
        }

        const client = await connectToTarget(target);
        try {
            // Try VS Code / Antigravity command API to open git diff
            await client.send('Runtime.evaluate', {
                expression: `
                    (async () => {
                        // Method 1: Try executeCommand via VS Code API
                        try {
                            const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
                            if (vscode) {
                                vscode.postMessage({ command: 'git.openChange' });
                                return 'vscode_api';
                            }
                        } catch {}
                        
                        // Method 2: Simulate Cmd+Shift+P → type command
                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'P', code: 'KeyP',
                            metaKey: true, shiftKey: true,
                            bubbles: true, cancelable: true
                        }));
                        
                        // Wait for command palette to open
                        await new Promise(r => setTimeout(r, 300));
                        
                        // Type the command
                        const input = document.querySelector('.quick-input-box input, [class*="quickInput"] input');
                        if (input) {
                            const nativeSet = Object.getOwnPropertyDescriptor(
                                HTMLInputElement.prototype, 'value'
                            )?.set;
                            if (nativeSet) {
                                nativeSet.call(input, 'Git: Open Changes');
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                            await new Promise(r => setTimeout(r, 300));
                            input.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter', code: 'Enter', bubbles: true
                            }));
                            return 'command_palette';
                        }
                        return 'no_input_found';
                    })()
                `,
                awaitPromise: true,
                returnByValue: true
            });

            console.log(`[file-ops] Diff view triggered for: ${filePath}`);
            return { success: true, method: 'diff_view', path: filePath };
        } finally {
            client.close();
        }
    } catch (e) {
        console.log(`[file-ops] Diff trigger failed (file still opened): ${(e as Error).message}`);
        return { success: true, method: 'opened_no_diff', path: filePath };
    }
}
