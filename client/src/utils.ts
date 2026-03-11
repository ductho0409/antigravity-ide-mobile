/**
 * Utils — Shared utility functions
 * Ported from public/js/mobile/utils.js
 */

/** Escape HTML special characters (XSS prevention) */
export function escapeHtml(text: string): string {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** Format timestamp to locale time string */
export function formatTime(ts: string | number | undefined): string {
    return ts ? new Date(ts).toLocaleTimeString() : '';
}

/** Format file size in human-readable form (B, KB, MB, GB) */
export function formatSize(bytes: number | undefined): string {
    if (bytes === undefined || bytes === null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}
