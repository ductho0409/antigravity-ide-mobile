/**
 * useWindows — Multi-window management hook
 * Ported from public/js/mobile/windows.js
 *
 * Features:
 *   - Discover multiple Antigravity IDE instances
 *   - Switch between windows
 *   - Start new chat / browse chat history
 *   - Scroll sync (phone → desktop)
 *   - Background polling (30s) with retry backoff
 */
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { authFetch, getServerUrl } from './useApi';
import { useApp } from '../context/AppContext';

// ─── Types ──────────────────────────────────────────────────────────
export interface WindowTarget {
    id: string;
    title: string;
    port: number;
    url?: string;
}

export interface ChatHistoryItem {
    title: string;
    date?: string;
}

export interface Workspace {
    name: string;
    path: string;
}

// ─── Constants ──────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 30_000;
const RETRY_DELAYS = [500, 4000, 8000, 16000, 30000];

// ─── Hook ───────────────────────────────────────────────────────────
interface UseWindowsOptions {
    showToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
    restartPolling?: () => void;
}

export function useWindows(opts: UseWindowsOptions = {}) {
    const { showToast, restartPolling } = opts;
    const [windows, setWindows] = useState<WindowTarget[]>([]);
    const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
    const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
    const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
    const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const { scrollSyncRef } = useApp();

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Timestamp of last manual window switch (prevents polling from overwriting active target) */
    const lastSwitchRef = useRef(0);
    /** Timestamp until which we respect user scroll and suppress auto-scroll-to-bottom */
    const userScrollLockRef = useRef(0);
    /** True while programmatic scroll is happening (suppress scroll sync back to desktop) */
    const isAutoScrollingRef = useRef(false);

    // ─── Discover windows ───────────────────────────────────────
    const discoverWindows = useCallback(async (): Promise<WindowTarget[]> => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/cdp/windows`);
            const data = await res.json();
            const targets: WindowTarget[] = data.targets || [];
            setWindows(targets);
            // Only update activeTargetId from server if user hasn't manually switched recently
            // (prevents server's cached/stale activeTarget from overwriting user's choice)
            const recentSwitch = Date.now() - lastSwitchRef.current < 10_000;
            if (!recentSwitch) {
                setActiveTargetId(data.activeTarget ?? null);
            }
            return targets;
        } catch (e) {
            console.error('[Windows] Discovery failed:', e);
            return [];
        }
    }, []);

    // ─── Switch window ──────────────────────────────────────────
    const switchWindow = useCallback(async (targetId: string): Promise<boolean> => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/cdp/windows/switch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetId }),
            });
            const data = await res.json();
            if (data.success) {
                // Mark this as a manual switch — prevents discoverWindows from overwriting
                lastSwitchRef.current = Date.now();
                setActiveTargetId(targetId);
                showToast?.(`Switched to ${data.title || 'window'}`, 'success');
                // Clear server-side message cache so next poll gets fresh content
                authFetch(`${getServerUrl()}/api/chat/clear-cache`, { method: 'POST' }).catch(() => { });
                // Reset FE polling hash so next poll renders fresh content
                restartPolling?.();
                // Don't call discoverWindows() here — it would re-fetch activeTarget
                // from server which may not have updated yet, overwriting our switch
                return true;
            }
            showToast?.(data.error || 'Switch failed', 'error');
            return false;
        } catch (e) {
            showToast?.('Switch failed: ' + (e instanceof Error ? e.message : 'unknown'), 'error');
            return false;
        }
    }, [showToast, restartPolling]);

    // ─── Start new chat ─────────────────────────────────────────
    const startNewChat = useCallback(async (): Promise<boolean> => {
        try {
            showToast?.('Starting new chat...', 'info');
            const res = await authFetch(`${getServerUrl()}/api/cdp/new-chat`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                showToast?.('✅ New chat started!', 'success');
                authFetch(`${getServerUrl()}/api/chat/clear-cache`, { method: 'POST' }).catch(() => { });
                restartPolling?.();
                return true;
            }
            showToast?.(data.error || 'Could not start new chat', 'error');
            return false;
        } catch (e) {
            showToast?.('New chat failed: ' + (e instanceof Error ? e.message : 'unknown'), 'error');
            return false;
        }
    }, [showToast, restartPolling]);

    // ─── Load chat history ──────────────────────────────────────
    const loadChatHistory = useCallback(async () => {
        setChatHistoryLoading(true);
        setChatHistoryOpen(true);
        try {
            const res = await authFetch(`${getServerUrl()}/api/cdp/chat-history`);
            const data = await res.json();
            if (data.success) {
                setChatHistory(data.chats || []);
            }
        } catch (e) {
            console.error('[Windows] Chat history failed:', e);
        } finally {
            setChatHistoryLoading(false);
        }
    }, []);

    // ─── Select chat from history ───────────────────────────────
    const selectChat = useCallback(async (title: string): Promise<boolean> => {
        try {
            showToast?.('Switching chat...', 'info');
            const res = await authFetch(`${getServerUrl()}/api/cdp/select-chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title }),
            });
            const data = await res.json();
            if (data.success) {
                showToast?.('✅ Chat switched!', 'success');
                authFetch(`${getServerUrl()}/api/chat/clear-cache`, { method: 'POST' }).catch(() => { });
                restartPolling?.();
                setChatHistoryOpen(false);
                return true;
            }
            showToast?.(data.error || 'Could not switch chat', 'error');
            return false;
        } catch (e) {
            showToast?.('Select chat failed: ' + (e instanceof Error ? e.message : 'unknown'), 'error');
            return false;
        }
    }, [showToast, restartPolling]);

    // ─── Close chat history ─────────────────────────────────────
    const closeChatHistory = useCallback(() => {
        setChatHistoryOpen(false);
        // Also close the history panel in IDE
        authFetch(`${getServerUrl()}/api/cdp/close-history-panel`, { method: 'POST' }).catch(() => { });
    }, []);

    // ─── Launch new window ──────────────────────────────────────
    const launchNewWindow = useCallback(async (folder?: string): Promise<boolean> => {
        try {
            showToast?.(folder ? `🚀 Opening ${folder.split('/').pop()}...` : '🚀 Opening new window...', 'info');
            const body = folder ? JSON.stringify({ folder }) : undefined;
            const headers: Record<string, string> = folder ? { 'Content-Type': 'application/json' } : {};
            const res = await authFetch(`${getServerUrl()}/api/cdp/windows/launch`, {
                method: 'POST',
                headers,
                body,
            });
            const data = await res.json();
            if (data.success) {
                showToast?.('✅ Window opened!', 'success');
                // Refresh after delay for new window to initialize
                setTimeout(() => discoverWindows(), 2000);
                return true;
            }
            showToast?.(data.error || 'Failed to launch', 'error');
            return false;
        } catch (e) {
            showToast?.('Launch failed: ' + (e instanceof Error ? e.message : 'unknown'), 'error');
            return false;
        }
    }, [discoverWindows, showToast]);

    // ─── Close window ───────────────────────────────────────────
    const closeWindow = useCallback(async (targetId: string): Promise<boolean> => {
        try {
            showToast?.('Closing window...', 'info');
            const res = await authFetch(`${getServerUrl()}/api/cdp/windows/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetId }),
            });
            const data = await res.json();
            if (data.success) {
                showToast?.('✅ Window closed', 'success');
                await discoverWindows();
                return true;
            }
            showToast?.(data.error || 'Failed to close', 'error');
            return false;
        } catch (e) {
            showToast?.('Close failed: ' + (e instanceof Error ? e.message : 'unknown'), 'error');
            return false;
        }
    }, [discoverWindows, showToast]);

    // ─── Load workspaces (for "New Window" picker) ──────────────
    const loadWorkspaces = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/cdp/workspaces`);
            const data = await res.json();
            setWorkspaces(data.workspaces || []);
        } catch {
            setWorkspaces([]);
        }
    }, []);

    // ─── Scroll sync ────────────────────────────────────────────
    const USER_SCROLL_LOCK_MS = 3000;

    const syncScroll = useCallback((scrollPercent: number) => {
        if (!scrollSyncRef.current) return;
        if (isAutoScrollingRef.current) return; // Don't sync programmatic scrolls back
        // User is actively scrolling — engage the lock
        userScrollLockRef.current = Date.now() + USER_SCROLL_LOCK_MS;
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(async () => {
            try {
                await authFetch(`${getServerUrl()}/api/cdp/scroll`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scrollPercent }),
                });
            } catch {
                // Silently fail for scroll sync
            }
        }, 150);
    }, [scrollSyncRef]);

    // ─── Active window info helper ──────────────────────────────
    const activeWindow = windows.find(w => w.id === activeTargetId) ?? null;
    const activeWindowName = activeWindow
        ? (activeWindow.title.split('—')[0].trim() || 'Antigravity')
        : (windows.length === 0 ? 'No window' : 'Select window');

    // ─── Background polling + retry ─────────────────────────────
    useEffect(() => {
        // Initial discovery
        discoverWindows().then(found => {
            if (found.length === 0) {
                // Retry with backoff
                const retry = (attempt: number) => {
                    if (attempt >= RETRY_DELAYS.length) return;
                    setTimeout(async () => {
                        const result = await discoverWindows();
                        if (result.length === 0) retry(attempt + 1);
                    }, RETRY_DELAYS[attempt]);
                };
                retry(0);
            }
        });

        // Background poll every 30s (only when tab is visible)
        pollRef.current = setInterval(() => {
            if (!document.hidden) discoverWindows();
        }, POLL_INTERVAL_MS);

        // Also refresh when tab becomes visible
        const handleVisibility = () => {
            if (!document.hidden) discoverWindows();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [discoverWindows]);

    return {
        // State
        windows,
        activeTargetId,
        activeWindowName,
        chatHistory,
        chatHistoryLoading,
        chatHistoryOpen,
        workspaces,

        // Scroll sync refs (for ChatPanel / useChatPolling)
        userScrollLockRef,
        isAutoScrollingRef,

        // Actions
        discoverWindows,
        switchWindow,
        startNewChat,
        loadChatHistory,
        selectChat,
        closeChatHistory,
        closeWindow,
        launchNewWindow,
        loadWorkspaces,
        syncScroll,
    };
}
