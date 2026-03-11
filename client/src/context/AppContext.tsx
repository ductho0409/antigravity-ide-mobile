/**
 * AppContext — Centralized app state
 * Replaces module-scoped globals from old MJS client
 */
import { createContext } from 'preact';
import { useState, useCallback, useContext, useRef } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { checkAuthStatus, loginWithPin, clearToken, authFetch } from '../hooks/useApi';
import type { WsSendFn } from '../hooks/useWebSocket';

// ─── Types ──────────────────────────────────────────────────────────
export interface Toast {
    id: number;
    message: string;
    type: 'info' | 'success' | 'error';
}

interface MobileUISettings {
    navigationMode: 'topbar' | 'sidebar' | 'bottombar';
    showQuickActions: boolean;
    showAssistTab: boolean;
    showTerminalTab: boolean;
    showStreamTab: boolean;
    showGitTab: boolean;
    showChatTab?: boolean;
    showFilesTab?: boolean;
}

// Ref-based callbacks for file events (no re-renders)
export interface FileEventCallbacks {
    onFileChanged?: (data: Record<string, unknown>) => void;
    onWorkspaceChanged?: (data: Record<string, unknown>) => void;
}

export type ViewFileDiffFn = (path: string, ext: string) => void;
export type DiffViewMode = 'stream' | 'native';

interface AppState {
    authenticated: boolean;
    authEnabled: boolean;
    authLoading: boolean;
    connected: boolean;
    activePanel: string;
    toasts: Toast[];
    mobileUI: MobileUISettings;
}

interface AppContextValue extends AppState {
    checkAuth: () => Promise<void>;
    login: (pin: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    setActivePanel: (panel: string) => void;
    setConnected: (connected: boolean) => void;
    showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
    loadMobileSettings: () => Promise<void>;
    diffViewMode: DiffViewMode;
    setDiffViewMode: (mode: DiffViewMode) => void;
    // Refs for cross-component communication (zero re-renders)
    fileEventRef: MutableRef<FileEventCallbacks>;
    viewFileDiffRef: MutableRef<ViewFileDiffFn | null>;
    wsSendRef: MutableRef<WsSendFn>;
    streamFrameRef: MutableRef<((dataUrl: string, meta?: { width?: number; height?: number }) => void) | null>;
    streamStartedRef: MutableRef<((data?: { cssViewport?: { width: number; height: number } }) => void) | null>;
    chatUpdateRef: MutableRef<((data: Record<string, unknown>) => void) | null>;
    terminalUpdateRef: MutableRef<((data: Record<string, unknown>) => void) | null>;
    scrollSyncRef: MutableRef<boolean>;
    toggleScrollSync: (enabled?: boolean) => void;
    updateMobileSettings: (settings: Partial<MobileUISettings>) => Promise<void>;
}

// ─── Context ────────────────────────────────────────────────────────
const AppContext = createContext<AppContextValue>({} as AppContextValue);

export function useApp(): AppContextValue {
    return useContext(AppContext);
}

// ─── Provider ───────────────────────────────────────────────────────
let toastId = 0;

export function AppProvider({ children }: { children: ComponentChildren }) {
    const [authenticated, setAuthenticated] = useState(false);
    const [authEnabled, setAuthEnabled] = useState(false);
    const [authLoading, setAuthLoading] = useState(true);
    const [connected, setConnected] = useState(false);
    const [activePanel, setActivePanel] = useState('chat');
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [mobileUI, setMobileUI] = useState<MobileUISettings>({
        navigationMode: 'topbar',
        showQuickActions: true,
        showAssistTab: false,
        showTerminalTab: true,
        showStreamTab: true,
        showGitTab: true,
        showChatTab: true,
        showFilesTab: true,
    });
    const [diffViewMode, setDiffViewModeState] = useState<DiffViewMode>(
        () => (localStorage.getItem('diffViewMode') as DiffViewMode) || 'stream'
    );
    const setDiffViewMode = useCallback((mode: DiffViewMode) => {
        setDiffViewModeState(mode);
        localStorage.setItem('diffViewMode', mode);
    }, []);

    // Ref-based event bridges (FilesPanel registers callbacks, app.tsx dispatches)
    const fileEventRef = useRef<FileEventCallbacks>({});
    const viewFileDiffRef = useRef<ViewFileDiffFn | null>(null);
    const wsSendRef = useRef<WsSendFn>(() => { });
    const streamFrameRef = useRef<((dataUrl: string, meta?: { width?: number; height?: number }) => void) | null>(null);
    const streamStartedRef = useRef<((data?: { cssViewport?: { width: number; height: number } }) => void) | null>(null);
    const chatUpdateRef = useRef<((data: Record<string, unknown>) => void) | null>(null);
    const terminalUpdateRef = useRef<((data: Record<string, unknown>) => void) | null>(null);
    const scrollSyncRef = useRef(localStorage.getItem('scrollSyncEnabled') === 'true');

    const toggleScrollSync = useCallback((enabled?: boolean) => {
        const next = typeof enabled === 'boolean' ? enabled : !scrollSyncRef.current;
        scrollSyncRef.current = next;
        localStorage.setItem('scrollSyncEnabled', next ? 'true' : 'false');
    }, []);

    const checkAuth = useCallback(async () => {
        setAuthLoading(true);
        const status = await checkAuthStatus();
        setAuthEnabled(status.authEnabled);
        setAuthenticated(status.authenticated);
        setAuthLoading(false);
    }, []);

    const login = useCallback(async (pin: string) => {
        const result = await loginWithPin(pin);
        if (result.success) {
            setAuthenticated(true);
        }
        return result;
    }, []);

    const logout = useCallback(() => {
        clearToken();
        setAuthenticated(false);
    }, []);

    const loadMobileSettings = useCallback(async () => {
        try {
            const res = await authFetch('/api/admin/mobile-ui');
            const settings = await res.json();
            const validModes = ['sidebar', 'topbar', 'bottombar'] as const;
            const navMode = validModes.includes(settings.navigationMode) ? settings.navigationMode : 'topbar';
            setMobileUI({
                navigationMode: navMode as 'topbar' | 'sidebar' | 'bottombar',
                showQuickActions: settings.showQuickActions !== false,
                showAssistTab: settings.showAssistTab || false,
                showTerminalTab: settings.showTerminalTab !== false,
                showStreamTab: settings.showStreamTab !== false,
                showGitTab: settings.showGitTab !== false,
                showChatTab: settings.showChatTab !== false,
                showFilesTab: settings.showFilesTab !== false,
            });
            // Apply nav mode to body
            document.body.classList.remove('topbar-mode', 'sidebar-mode', 'bottombar-mode');
            document.body.classList.add(`${navMode}-mode`);
            // Quick actions
            if (settings.showQuickActions === false) {
                document.body.classList.add('hide-quick-actions');
            } else {
                document.body.classList.remove('hide-quick-actions');
            }
        } catch (_e) { /* silent */ }
    }, []);

    const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
        const id = ++toastId;
        // Replace mode: only 1 toast at a time (matches admin behavior)
        setToasts([{ id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 2500);
    }, []);

    const updateMobileSettings = useCallback(async (updates: Partial<MobileUISettings>) => {
        const next = { ...mobileUI, ...updates };
        setMobileUI(next);
        
        try {
            await authFetch('/api/admin/mobile-ui', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(next),
            });
        } catch (err) {
            console.error('Failed to save mobile settings:', err);
            showToast('Failed to save settings', 'error');
        }
    }, [mobileUI, showToast]);

    const value: AppContextValue = {
        authenticated, authEnabled, authLoading, connected, activePanel, toasts, mobileUI,
        checkAuth, login, logout, setActivePanel, setConnected, showToast, loadMobileSettings,
        diffViewMode, setDiffViewMode,
        fileEventRef, viewFileDiffRef, wsSendRef, streamFrameRef, streamStartedRef, chatUpdateRef, terminalUpdateRef,
        scrollSyncRef, toggleScrollSync, updateMobileSettings,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
