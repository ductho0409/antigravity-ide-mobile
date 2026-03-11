/**
 * CDP Model & Mode — Get/set AI model and conversation mode
 */
import { findEditorTarget, connectToTarget, withContexts } from './core.js';

interface ModelAndMode {
    model: string | null;
    mode: string | null;
}

interface SetResult {
    found?: boolean;
    success: boolean;
    selected?: string;
    error?: string;
    debug?: Record<string, unknown>;
    candidatesFound?: string[];
    allTexts?: string[];
}

/**
 * [ACTION/DATA] GET_MODEL_AND_MODE
 * Retrieves the currently active AI Model (e.g., "Claude Sonnet 4.6") and Conversation Mode (e.g., "Planning")
 * by analyzing the text content of elements in the IDE's input area.
 * 
 * @returns {Promise<ModelAndMode>} An object containing the detected `model` and `mode` strings, or null if not found.
 */
export async function getModelAndMode(): Promise<ModelAndMode> {
    const fallback: ModelAndMode = { model: 'Unknown', mode: 'Planning' };

    return withContexts<ModelAndMode>(3000, async (call, contexts) => {
        const SCRIPT = `
            (function() {
                let model = null;
                let mode = null;
                
                const allElements = document.querySelectorAll('p, span, div, button');
                
                for (const el of allElements) {
                    const text = (el.innerText || el.textContent || '').trim();
                    
                    if (text.length < 4 || text.length > 50) continue;
                    
                    if (!model && /^(claude|gemini|gpt)/i.test(text) && 
                        /(opus|sonnet|flash|pro|thinking|high|low|medium)/i.test(text)) {
                        model = text;
                    }
                    
                    if (!mode && /^(planning|fast)$/i.test(text)) {
                        mode = text;
                    }
                    
                    if (model && mode) break;
                }
                
                return { 
                    model: model || null,
                    mode: mode || null
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

                const value = (result as Record<string, Record<string, unknown>>).result?.value as ModelAndMode | undefined;
                if (value?.model) {
                    return value;
                }
            } catch (_) { }
        }

        return fallback;
    }, fallback, 500);
}

/**
 * [DATA] GET_AVAILABLE_MODELS
 * Returns a static list of known supported AI models and identifies the currently active one.
 * 
 * @returns {Promise<{models: string[], current: string}>} An object containing the array of `models` and the `current` active model.
 */
export async function getAvailableModels(): Promise<{ models: string[]; current: string }> {
    const knownModels = [
        'Gemini 3.1 Pro (High)',
        'Gemini 3.1 Pro (Low)',
        'Gemini 3 Flash',
        'Claude Sonnet 4.6',
        'Claude Sonnet 4.6 (Thinking)',
        'Claude Opus 4.6 (Thinking)',
        'GPT-OSS 120B (Medium)'
    ];

    try {
        const current = await getModelAndMode();
        return {
            models: knownModels,
            current: current.model || 'Unknown'
        };
    } catch (_) {
        return {
            models: knownModels,
            current: 'Unknown'
        };
    }
}

/**
 * [ACTION] SET_MODEL
 * Changes the active AI model in the Antigravity IDE.
 * It simulates a user opening the model selector dropdown and clicking on the target model option.
 * It uses string matching to find the best candidate in the dropdown list.
 * 
 * @param {string} modelName The target model name to select (e.g., "Gemini 3 Flash").
 * @returns {Promise<SetResult>} The result of the operation, indicating success or failure.
 */
export async function setModel(modelName: string): Promise<SetResult> {
    const fallback: SetResult = { success: false, error: 'Webview context not found' };

    return withContexts<SetResult>(5000, async (call, contexts) => {
        const SCRIPT = `
            (async function() {
                const targetModel = ${JSON.stringify(modelName)}.toLowerCase();
                
                let modelButton = null;
                const allElements = document.querySelectorAll('button, div[role="button"], p, span');
                const modelKeywords = ['gemini', 'claude', 'gpt', 'opus', 'sonnet', 'flash', 'model'];
                
                for (const el of allElements) {
                    const text = (el.innerText || '').trim().toLowerCase();
                    if (text.length < 3 || text.length > 60) continue;
                    
                    if (modelKeywords.some(k => text.includes(k))) {
                        const clickable = el.closest('button') || el.closest('[role="button"]') || el;
                        modelButton = clickable;
                        break;
                    }
                }
                
                if (!modelButton) {
                    return { found: true, success: false, error: 'Model button not found' };
                }
                
                modelButton.click();
                await new Promise(r => setTimeout(r, 600));
                
                let candidates = [];
                const getNorm = (el) => (el.innerText || el.textContent || '').trim().toLowerCase();
                
                const cursorPointerItems = document.querySelectorAll('[class*="cursor-pointer"]');
                
                for (const item of cursorPointerItems) {
                    const text = getNorm(item);
                    if (text.length > 3 && text.length < 100 && 
                        modelKeywords.some(k => text.includes(k))) {
                        candidates.push({ el: item, text });
                    }
                }
                
                if (candidates.length === 0) {
                    const menuSelectors = [
                        '[role="listbox"] [role="option"]',
                        '[role="menu"] [role="menuitem"]',
                        '.monaco-list-row',
                        '.action-item'
                    ];
                    
                    for (const sel of menuSelectors) {
                        const items = document.querySelectorAll(sel);
                        for (const item of items) {
                            const text = getNorm(item);
                            if (text.length > 3 && text.length < 80) {
                                if (!candidates.some(c => c.el === item)) {
                                    candidates.push({ el: item, text });
                                }
                            }
                        }
                        if (candidates.length > 0) break;
                    }
                }

                let bestMatch = null;
                const targetParts = targetModel.split(/[^a-z0-9]+/i).filter(p => p.length > 1);
                
                for (const cand of candidates) {
                    const candText = cand.text;
                    
                    if (candText === targetModel) { bestMatch = cand.el; break; }
                    
                    const allPartsMatch = targetParts.every(part => candText.includes(part));
                    if (allPartsMatch) { bestMatch = cand.el; break; }
                    
                    if (targetParts.length >= 2 && candText.includes(targetParts[0])) {
                        let matchCount = 0;
                        for (let i = 1; i < targetParts.length; i++) {
                            if (candText.includes(targetParts[i])) matchCount++;
                        }
                        if (matchCount >= (targetParts.length - 1) / 2) {
                            bestMatch = cand.el;
                        }
                    }
                }
                
                if (bestMatch) {
                    bestMatch.scrollIntoView({block: 'center', inline: 'center'});
                    await new Promise(r => setTimeout(r, 100));
                    bestMatch.click();
                    return { found: true, success: true, selected: bestMatch.innerText };
                }
                
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                return { found: true, success: false, error: 'Model option not found' };
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

                const value = (result as Record<string, Record<string, unknown>>).result?.value as SetResult | undefined;
                if (value?.found) {
                    return value;
                }
            } catch (_) { }
        }

        return fallback;
    }, fallback, 500);
}

/**
 * [DATA] GET_AVAILABLE_MODES
 * Retrieves the list of known conversation modes (e.g., "Planning", "Fast") and identifies
 * which mode is currently active by inspecting the UI buttons.
 * 
 * @returns {Promise<{modes: Array<{name: string, description: string}>, current: string}>} The available modes and the currently active mode string.
 */
export async function getAvailableModes(): Promise<{ modes: Array<{ name: string; description: string }>; current: string }> {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                    (function () {
                        const knownModes = [
                            { name: 'Planning', description: 'Agent can plan before executing. Use for deep research, complex tasks.' },
                            { name: 'Fast', description: 'Agent will execute tasks directly. Use for simple tasks.' }
                        ];

                        let currentMode = null;
                        const modeKeywords = ['planning', 'fast'];

                        const buttons = document.querySelectorAll('button, [role="button"]');
                        for (const btn of buttons) {
                            const text = (btn.innerText || btn.textContent || '').toLowerCase();
                            if (modeKeywords.some(k => text.includes(k))) {
                                currentMode = btn.innerText || btn.textContent;
                                break;
                            }
                        }

                        return {
                            modes: knownModes,
                            current: currentMode ? currentMode.trim() : 'Planning'
                        };
                    })()
                    `,
            returnByValue: true
        });

        return (result as Record<string, Record<string, unknown>>).result?.value as { modes: Array<{ name: string; description: string }>; current: string } || { modes: [], current: 'Unknown' };
    } finally {
        client.close();
    }
}

/**
 * [ACTION] SET_MODE
 * Changes the active conversation mode (e.g., switching from "Planning" to "Fast").
 * It simulates a user opening the mode selector dropdown and clicking on the target option.
 * 
 * @param {string} modeName The target mode to select (e.g., "Fast").
 * @returns {Promise<SetResult>} The result of the operation, indicating success or failure.
 */
export async function setMode(modeName: string): Promise<SetResult> {
    const fallback: SetResult = { success: false, error: 'Webview context not found' };

    return withContexts<SetResult>(5000, async (call, contexts) => {
        const SCRIPT = `
            (async function() {
                const targetMode = ${JSON.stringify(modeName)}.toLowerCase();
                
                const modeKeywords = ['planning', 'fast'];
                let modeButton = null;
                const allElements = document.querySelectorAll('button, div[role="button"], p, span');
                
                for (const el of allElements) {
                    const text = (el.innerText || '').trim().toLowerCase();
                    if (text.length < 2 || text.length > 30) continue;
                    
                    if (modeKeywords.some(k => text === k || text.startsWith(k))) {
                        const clickable = el.closest('button') || el.closest('[role="button"]') || el;
                        modeButton = clickable;
                        break;
                    }
                }
                
                if (!modeButton) {
                    return { found: true, success: false, error: 'Mode button not found' };
                }
                
                modeButton.click();
                await new Promise(r => setTimeout(r, 600));
                
                let candidates = [];
                const getNorm = (el) => (el.innerText || el.textContent || '').trim().toLowerCase();
                
                const cursorPointerItems = document.querySelectorAll('[class*="cursor-pointer"]');
                
                for (const item of cursorPointerItems) {
                    const text = getNorm(item);
                    if (text.length > 1 && text.length < 150) {
                        if (modeKeywords.some(k => text.includes(k)) || text.length < 30) {
                            candidates.push({ el: item, text });
                        }
                    }
                }
                
                let bestMatch = null;
                for (const cand of candidates) {
                    if (cand.text.includes(targetMode)) {
                        bestMatch = cand.el;
                        break;
                    }
                }
                
                if (bestMatch) {
                    bestMatch.scrollIntoView({block: 'center', inline: 'center'});
                    await new Promise(r => setTimeout(r, 100));
                    bestMatch.click();
                    return { found: true, success: true, selected: bestMatch.innerText };
                }
                
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                return { found: true, success: false, error: 'Mode option not found' };
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

                const value = (result as Record<string, Record<string, unknown>>).result?.value as SetResult | undefined;
                if (value?.found) {
                    return value;
                }
            } catch (_) { }
        }

        return fallback;
    }, fallback, 500);
}
