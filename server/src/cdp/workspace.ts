/**
 * CDP Workspace — Get workspace path from IDE
 */
import { findEditorTarget, connectToTarget } from './core.js';

/**
 * Get the current workspace path from Antigravity IDE
 * Extracts the workspace folder from open file paths in the IDE
 * Cross-platform: supports Windows, Mac, and Linux
 */
export async function getWorkspacePath(): Promise<string | null> {
    const target = await findEditorTarget();
    if (!target) {
        console.log('[CDP getWorkspacePath] No editor target found');
        return null;
    }

    console.log(`[CDP getWorkspacePath] Target title: "${target.title}"`);

    // Extract project name from title: "ProjectName — filename" or "ProjectName - Antigravity - file"
    const projectName = target.title.split(/\s+[—–]\s+|\s+\-\s+/)[0]?.trim() || null;
    console.log(`[CDP getWorkspacePath] Extracted project name: "${projectName}"`);

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    try {
                        var tabs = document.querySelectorAll('[role="tab"], [class*="tab-label"], .tab');
                        for (var i = 0; i < tabs.length; i++) {
                            var tab = tabs[i];
                            var ariaLabel = tab.getAttribute('aria-label') || '';
                            var title = tab.getAttribute('title') || '';
                            var sources = [ariaLabel, title];
                            
                            for (var j = 0; j < sources.length; j++) {
                                var src = sources[j];
                                if (!src || src.length < 5) continue;
                                
                                // Windows: look for C: or D: pattern
                                for (var k = 0; k < src.length - 1; k++) {
                                    var ch = src.charAt(k);
                                    var next = src.charAt(k + 1);
                                    if (((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) && next === ':') {
                                        var pathPart = src.substring(k);
                                        var delims = [',', ';', ' - '];
                                        var endIdx = pathPart.length;
                                        for (var d = 0; d < delims.length; d++) {
                                            var idx = pathPart.indexOf(delims[d]);
                                            if (idx > 0 && idx < endIdx) endIdx = idx;
                                        }
                                        return { path: pathPart.substring(0, endIdx).trim(), source: 'tab', isWindows: true };
                                    }
                                }
                                
                                // Unix: /home, /Users, etc.
                                var unixRoots = ['/home/', '/Users/', '/var/', '/opt/'];
                                for (var u = 0; u < unixRoots.length; u++) {
                                    var idx = src.indexOf(unixRoots[u]);
                                    if (idx >= 0) {
                                        var pathPart = src.substring(idx);
                                        var endIdx = pathPart.length;
                                        var delims = [',', ';', ' - ', "'", '"'];
                                        for (var d = 0; d < delims.length; d++) {
                                            var di = pathPart.indexOf(delims[d]);
                                            if (di > 0 && di < endIdx) endIdx = di;
                                        }
                                        return { path: pathPart.substring(0, endIdx).trim(), source: 'tab', isWindows: false };
                                    }
                                }
                            }
                        }
                        
                        // Method 2: data-uri
                        var uris = document.querySelectorAll('[data-uri]');
                        for (var i = 0; i < uris.length; i++) {
                            var uri = uris[i].getAttribute('data-uri');
                            if (uri && uri.indexOf('file:///') === 0) {
                                try {
                                    var decoded = decodeURIComponent(uri.substring(8));
                                    var isWin = decoded.length > 1 && decoded.charAt(1) === ':';
                                    if (isWin) decoded = decoded.split('/').join(String.fromCharCode(92));
                                    return { path: decoded, source: 'data-uri', isWindows: isWin };
                                } catch(e) {}
                            }
                        }
                        
                        return { path: null, error: 'No path found' };
                    } catch (err) {
                        return { path: null, error: err.message };
                    }
                })()
            `,
            returnByValue: true
        });

        const data = (result as Record<string, Record<string, Record<string, unknown>>>).result?.value as { path: string | null; isWindows?: boolean; error?: string } | undefined;
        console.log(`[CDP getWorkspacePath] DOM result:`, JSON.stringify(data));

        if (!data?.path) {
            console.log(`[CDP getWorkspacePath] No path: ${data?.error || 'unknown'}`);
            return null;
        }

        const filePath = data.path;
        const isWindows = data.isWindows;
        const sep = isWindows ? /[\\/]+/ : /\/+/;
        const pathParts = filePath.split(sep).filter(Boolean);

        if (projectName) {
            for (let i = 0; i < pathParts.length; i++) {
                if (pathParts[i].toLowerCase() === projectName.toLowerCase()) {
                    const ws = isWindows
                        ? pathParts[0] + '\\' + pathParts.slice(1, i + 1).join('\\')
                        : '/' + pathParts.slice(0, i + 1).join('/');
                    console.log(`[CDP getWorkspacePath] Found: "${ws}"`);
                    return ws;
                }
            }
        }

        // Fallback
        const parentParts = pathParts.slice(0, -1);
        const fallback = isWindows
            ? parentParts[0] + '\\' + parentParts.slice(1).join('\\')
            : '/' + parentParts.join('/');
        console.log(`[CDP getWorkspacePath] Fallback: "${fallback}"`);
        return fallback;

    } finally {
        client.close();
    }
}
