/**
 * CDP Commands — Inject text, submit, focus input
 */
import { findEditorTarget, connectToTarget } from './core.js';

/**
 * Inject text into the chat input field (without submitting)
 */
export async function injectCommand(text: string): Promise<{ success: boolean; injected?: string }> {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        // Focus the chat contenteditable input (NOT textarea — those are Monaco!)
        await client.send('Runtime.evaluate', {
            expression: `(function() {
                var ce = document.querySelector('div[contenteditable="true"][role="textbox"]');
                if (ce) { ce.focus(); ce.click(); return 'contenteditable-textbox'; }
                ce = document.querySelector('[contenteditable="true"].cursor-text');
                if (ce) { ce.focus(); ce.click(); return 'contenteditable-cursor'; }
                ce = document.querySelector('[contenteditable="true"]');
                if (ce) { ce.focus(); ce.click(); return 'contenteditable-generic'; }
                return 'none';
            })()`,
            returnByValue: true
        });

        await new Promise(r => setTimeout(r, 50));

        // Insert text via CDP (no character-by-character typing needed)
        await client.send('Input.insertText', { text });

        return { success: true, injected: text };
    } finally {
        client.close();
    }
}

/**
 * Inject text and press Enter to submit
 */
export async function injectAndSubmit(text: string): Promise<{ success: boolean; submitted?: string }> {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        // Focus the chat contenteditable input
        await client.send('Runtime.evaluate', {
            expression: `(function() {
                var ce = document.querySelector('div[contenteditable="true"][role="textbox"]');
                if (ce) { ce.focus(); ce.click(); return 'contenteditable-textbox'; }
                ce = document.querySelector('[contenteditable="true"].cursor-text');
                if (ce) { ce.focus(); ce.click(); return 'contenteditable-cursor'; }
                ce = document.querySelector('[contenteditable="true"]');
                if (ce) { ce.focus(); ce.click(); return 'contenteditable-generic'; }
                return 'none';
            })()`,
            returnByValue: true
        });

        await new Promise(r => setTimeout(r, 50));

        // Insert text
        await client.send('Input.insertText', { text });

        await new Promise(r => setTimeout(r, 50));

        // Press Enter to submit
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

        return { success: true, submitted: text };
    } finally {
        client.close();
    }
}

/**
 * Focus the input area (click to activate)
 */
export async function focusInput(): Promise<{ success: boolean; method?: string }> {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    var ce = document.querySelector('div[contenteditable="true"][role="textbox"]');
                    if (ce) { ce.focus(); ce.click(); return { method: 'contenteditable-textbox', success: true }; }
                    ce = document.querySelector('[contenteditable="true"].cursor-text');
                    if (ce) { ce.focus(); ce.click(); return { method: 'contenteditable-cursor', success: true }; }
                    ce = document.querySelector('[contenteditable="true"]');
                    if (ce) { ce.focus(); ce.click(); return { method: 'contenteditable', success: true }; }
                    document.body.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'l',
                        code: 'KeyL',
                        ctrlKey: true,
                        bubbles: true
                    }));
                    return { method: 'keyboard_shortcut', success: true };
                })()
            `,
            returnByValue: true
        });

        return (result as Record<string, Record<string, unknown>>).result?.value as { success: boolean; method?: string } || { success: false };
    } finally {
        client.close();
    }
}
