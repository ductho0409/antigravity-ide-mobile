/**
 * CDP Screenshot — Capture screenshots and page metrics
 */
import { findEditorTarget, connectToTarget } from './core.js';

interface ScreenshotOptions {
    format?: string;
    quality?: number;
}

/**
 * Capture screenshot of the current page
 * Returns base64-encoded PNG
 */
export async function captureScreenshot(options: ScreenshotOptions = {}): Promise<string> {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Page.captureScreenshot', {
            format: options.format || 'png',
            quality: options.quality || 80,
            captureBeyondViewport: false
        });

        return result.data as string; // base64 string
    } finally {
        client.close();
    }
}

/**
 * Get page dimensions
 */
export async function getPageMetrics(): Promise<Record<string, unknown>> {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const metrics = await client.send('Page.getLayoutMetrics');
        return metrics;
    } finally {
        client.close();
    }
}
