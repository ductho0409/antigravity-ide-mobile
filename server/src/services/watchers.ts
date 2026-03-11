/**
 * Watchers - File system watchers & screenshot scheduler
 * 
 * Features:
 * - Screenshot scheduler (periodic captures via CDP)
 * - Auto-rotation (max files cleanup)
 * - File watcher foundation for change tracking
 */

import { watch, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// Types
// ============================================================================

type ScreenshotCaptureFn = (opts: { format: string; quality: number }) => Promise<string>;
type ScreenshotSaveFn = (base64: string, dir: string, format: string) => string;
type FileChangeCallback = (eventType: string, filename: string | null) => void;

export interface ScreenshotSchedulerConfig {
    format: 'webp' | 'jpeg';
    quality: number;
    intervalMs: number;
    maxFiles: number;
}

export interface ScreenshotScheduler {
    start: () => void;
    stop: () => void;
    isRunning: () => boolean;
    setInterval: (ms: number) => void;
    updateConfig: (config: Partial<ScreenshotSchedulerConfig>) => void;
    getConfig: () => ScreenshotSchedulerConfig;
    getFileCount: () => number;
}

// ============================================================================
// Constants
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INTERVAL = 30000; // 30 seconds

// ============================================================================
// Screenshot Scheduler
// ============================================================================

let screenshotTimer: ReturnType<typeof setInterval> | null = null;
let schedulerConfig: ScreenshotSchedulerConfig = {
    format: 'webp',
    quality: 70,
    intervalMs: DEFAULT_INTERVAL,
    maxFiles: 200
};
let captureFn: ScreenshotCaptureFn | null = null;
let saveFn: ScreenshotSaveFn | null = null;
let screenshotsDir = '';

/**
 * Create and return a screenshot scheduler
 */
export function createScreenshotScheduler(
    captureScreenshot: ScreenshotCaptureFn,
    saveScreenshot: ScreenshotSaveFn,
    outputDir: string,
    config: Partial<ScreenshotSchedulerConfig> = {}
): ScreenshotScheduler {
    captureFn = captureScreenshot;
    saveFn = saveScreenshot;
    screenshotsDir = outputDir;
    schedulerConfig = { ...schedulerConfig, ...config };

    // Ensure output directory exists
    if (!existsSync(screenshotsDir)) {
        mkdirSync(screenshotsDir, { recursive: true });
    }

    return {
        start: startScreenshotScheduler,
        stop: stopScreenshotScheduler,
        isRunning: () => screenshotTimer !== null,
        setInterval: (ms: number) => {
            schedulerConfig.intervalMs = ms;
            if (screenshotTimer) {
                stopScreenshotScheduler();
                startScreenshotScheduler();
            }
        },
        updateConfig: (newConfig: Partial<ScreenshotSchedulerConfig>) => {
            const wasRunning = screenshotTimer !== null;
            const intervalChanged = newConfig.intervalMs && newConfig.intervalMs !== schedulerConfig.intervalMs;
            schedulerConfig = { ...schedulerConfig, ...newConfig };
            // Restart if interval changed while running
            if (wasRunning && intervalChanged) {
                stopScreenshotScheduler();
                startScreenshotScheduler();
            }
        },
        getConfig: () => ({ ...schedulerConfig }),
        getFileCount: () => {
            try {
                return readdirSync(screenshotsDir).filter(f => f.startsWith('screenshot-')).length;
            } catch { return 0; }
        }
    };
}

function startScreenshotScheduler(): void {
    if (screenshotTimer) return;
    if (!captureFn || !saveFn) {
        console.error('⚠️ Screenshot scheduler: capture/save functions not set');
        return;
    }

    console.log(`📸 Screenshot scheduler started (every ${schedulerConfig.intervalMs / 1000}s, ${schedulerConfig.format}, q${schedulerConfig.quality})`);

    screenshotTimer = setInterval(async () => {
        try {
            const base64 = await captureFn!({ format: schedulerConfig.format, quality: schedulerConfig.quality });
            if (base64 && saveFn) {
                saveFn(base64, screenshotsDir, schedulerConfig.format);
                // Auto-rotation: remove oldest files if over limit
                enforceMaxFiles(screenshotsDir, schedulerConfig.maxFiles);
            }
        } catch (e) {
            console.error('📸 Screenshot capture error:', (e as Error).message);
        }
    }, schedulerConfig.intervalMs);
}

function stopScreenshotScheduler(): void {
    if (screenshotTimer) {
        clearInterval(screenshotTimer);
        screenshotTimer = null;
        console.log('📸 Screenshot scheduler stopped');
    }
}

/**
 * Remove oldest screenshot files when count exceeds maxFiles
 */
function enforceMaxFiles(dir: string, maxFiles: number): void {
    if (maxFiles <= 0) return;
    try {
        const files = readdirSync(dir)
            .filter(f => f.startsWith('screenshot-'))
            .sort(); // ascending = oldest first
        
        const excess = files.length - maxFiles;
        if (excess > 0) {
            for (let i = 0; i < excess; i++) {
                try {
                    unlinkSync(join(dir, files[i]));
                } catch { /* ignore individual file errors */ }
            }
            console.log(`📸 Auto-rotation: removed ${excess} old screenshot(s)`);
        }
    } catch { /* ignore */ }
}

// ============================================================================
// File Watcher (generic utility)
// ============================================================================

const activeWatchers: Map<string, ReturnType<typeof watch>> = new Map();

/**
 * Watch a directory for changes
 */
export function watchDirectory(
    dirPath: string,
    callback: FileChangeCallback,
    recursive: boolean = true
): { stop: () => void } {
    if (activeWatchers.has(dirPath)) {
        // Already watching
        return { stop: () => stopWatching(dirPath) };
    }

    try {
        const watcher = watch(dirPath, { recursive }, (eventType, filename) => {
            callback(eventType, filename);
        });

        watcher.on('error', (err) => {
            console.error(`👁️ Watcher error on ${dirPath}:`, err.message);
        });

        activeWatchers.set(dirPath, watcher);
        console.log(`👁️ Watching: ${dirPath}`);
    } catch (e) {
        console.error(`👁️ Failed to watch ${dirPath}:`, (e as Error).message);
    }

    return { stop: () => stopWatching(dirPath) };
}

/**
 * Stop watching a directory
 */
export function stopWatching(dirPath: string): void {
    const watcher = activeWatchers.get(dirPath);
    if (watcher) {
        watcher.close();
        activeWatchers.delete(dirPath);
        console.log(`👁️ Stopped watching: ${dirPath}`);
    }
}

/**
 * Stop all active watchers
 */
export function stopAllWatchers(): void {
    for (const [dirPath, watcher] of activeWatchers) {
        watcher.close();
        console.log(`👁️ Stopped watching: ${dirPath}`);
    }
    activeWatchers.clear();
    stopScreenshotScheduler();
}
