/**
 * App — Main application shell
 * Ported from public/index.html + navigation.js + main.js
 * Layout: topbar-mode with BottomNav + PanelRouter
 */
import { useEffect } from 'preact/hooks';
import { AppProvider, useApp } from './context/AppContext';
import { I18nProvider, useTranslation } from './i18n';
import { useWebSocket } from './hooks/useWebSocket';
import { useTheme } from './hooks/useTheme';
import { LoginScreen } from './components/LoginScreen';
import { ToastContainer } from './components/Toast';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { ChatPanel } from './components/ChatPanel';
import { FilesPanel } from './components/FilesPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { AssistPanel } from './components/AssistPanel';
import { StreamPanel } from './components/StreamPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { GitPanel } from './components/GitPanel';
import { Sidebar } from './components/Sidebar';
import { BottomTabBar } from './components/BottomTabBar';
import { BackgroundVFX } from './components/BackgroundVFX';
import { MessageCircle, FolderOpen, Monitor, Bot, Settings, GitBranch, Terminal } from 'lucide-preact';
import './styles/index.css';

// Icon map for BottomNav panels
const PANEL_ICONS: Record<string, typeof MessageCircle> = {
    chat: MessageCircle,
    files: FolderOpen,
    git: GitBranch,
    stream: Monitor,
    assist: Bot,
    settings: Settings,
    terminal: Terminal,
};

// ─── Bottom Navigation ──────────────────────────────────────────────
function BottomNav() {
    const { activePanel, setActivePanel, mobileUI } = useApp();
    const { t } = useTranslation();

    const panels = [
        { id: 'chat', label: t('mobile.nav.chat'), hidden: mobileUI.showChatTab === false },
        { id: 'files', label: t('mobile.nav.files'), hidden: mobileUI.showFilesTab === false },
        { id: 'git', label: t('mobile.nav.git'), hidden: !mobileUI.showGitTab },
        { id: 'stream', label: t('mobile.nav.stream'), hidden: !mobileUI.showStreamTab },
        { id: 'assist', label: t('mobile.nav.assist'), hidden: !mobileUI.showAssistTab },
        { id: 'terminal', label: t('mobile.nav.terminal'), hidden: !mobileUI.showTerminalTab },
        { id: 'settings', label: t('mobile.nav.settings'), hidden: false },
    ];

    return (
        <nav id="topbar" class="topbar-nav">
            {panels.filter(p => !p.hidden).map(p => {
                const Icon = PANEL_ICONS[p.id];
                return (
                    <button
                        key={p.id}
                        class={`topbar-btn${activePanel === p.id ? ' active' : ''}`}
                        data-panel={p.id}
                        onClick={() => {
                            setActivePanel(p.id);
                            if (window.location.hash !== `#${p.id}`) {
                                window.history.pushState(null, '', `#${p.id}`);
                            }
                        }}
                    >
                        {Icon && <Icon size={18} />}
                        {p.label}
                    </button>
                );
            })}
        </nav>
    );
}

// ─── Panel Router ───────────────────────────────────────────────────
function PanelRouter() {
    const { activePanel } = useApp();

    return (
        <>
            <div id="chat-container" className={`${activePanel === 'chat' ? 'flex' : 'hidden'} flex-col h-full min-h-0 overflow-hidden`}>
                <ChatPanel />
            </div>
            <div id="filesPanel" className={`${activePanel === 'files' ? 'flex' : 'hidden'} flex-col h-full min-h-0 overflow-hidden`}>
                <FilesPanel />
            </div>
            <div id="gitPanel" className={`${activePanel === 'git' ? 'flex' : 'hidden'} flex-col h-full min-h-0 overflow-hidden`}>
                <GitPanel />
            </div>
            <div id="settingsPanel" className={`${activePanel === 'settings' ? 'flex' : 'hidden'} flex-col h-full min-h-0 overflow-hidden`}>
                <SettingsPanel />
            </div>
            <div id="assistPanel" className={`${activePanel === 'assist' ? 'flex' : 'hidden'} flex-col h-full min-h-0 overflow-hidden`}>
                <AssistPanel />
            </div>
            <div id="streamPanel" className={`${activePanel === 'stream' ? 'flex' : 'hidden'} flex-col h-full min-h-0 overflow-hidden`}>
                <StreamPanel />
            </div>
            <div id="terminal-container" className={`${activePanel === 'terminal' ? 'flex' : 'hidden'} flex-col h-full min-h-0 overflow-hidden`}>
                <TerminalPanel />
            </div>
        </>
    );
}

// ─── App Content ────────────────────────────────────────────────────
function AppContent() {
    const { authenticated, authEnabled, authLoading, checkAuth, setConnected, loadMobileSettings, setActivePanel, mobileUI } = useApp();
    const { loadTheme } = useTheme();
    const { t } = useTranslation();

    useEffect(() => { checkAuth(); }, [checkAuth]);

    // Load mobile UI settings from admin config (nav mode, quick actions, etc.)
    useEffect(() => { loadMobileSettings(); }, [loadMobileSettings]);

    // Load saved theme
    useEffect(() => { loadTheme(); }, [loadTheme]);

    // Request browser notification permission for push alerts
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    // Mobile keyboard viewport fix — robust iOS Safari support
    useEffect(() => {
        const root = document.documentElement;
        
        if (window.visualViewport) {
            let pendingRAF: number | null = null;
            
            const handleViewport = () => {
                if (pendingRAF) cancelAnimationFrame(pendingRAF);
                pendingRAF = requestAnimationFrame(() => {
                    const vv = window.visualViewport!;
                    const keyboardHeight = window.innerHeight - vv.height;
                    const isKeyboardOpen = keyboardHeight > 100; // threshold for real keyboard
                    
                    // Set CSS custom property for keyboard offset
                    root.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
                    root.style.setProperty('--visual-viewport-height', `${vv.height}px`);
                    document.body.style.height = vv.height + 'px';

                    if (isKeyboardOpen) {
                        document.body.classList.add('keyboard-open');
                        // Scroll active input into view
                        const active = document.activeElement as HTMLElement;
                        if (active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT') {
                            setTimeout(() => {
                                active.scrollIntoView({ block: 'center', behavior: 'smooth' });
                            }, 50);
                        }
                    } else {
                        document.body.classList.remove('keyboard-open');
                    }
                    pendingRAF = null;
                });
            };
            
            window.visualViewport.addEventListener('resize', handleViewport);
            window.visualViewport.addEventListener('scroll', handleViewport);
            handleViewport();
            return () => {
                window.visualViewport!.removeEventListener('resize', handleViewport);
                window.visualViewport!.removeEventListener('scroll', handleViewport);
                if (pendingRAF) cancelAnimationFrame(pendingRAF);
            };
        } else {
            const handleResize = () => {
                document.body.style.height = window.innerHeight + 'px';
                root.style.setProperty('--visual-viewport-height', `${window.innerHeight}px`);
            };
            window.addEventListener('resize', handleResize);
            handleResize();
            return () => window.removeEventListener('resize', handleResize);
        }
    }, []);

    // Hash-based routing (from navigation.js)
    useEffect(() => {
        const validPanels = ['chat', 'files', 'git', 'settings', 'assist', 'stream', 'terminal'];
        // Load initial hash
        const hash = window.location.hash.replace('#', '');
        if (hash && validPanels.includes(hash)) {
            setActivePanel(hash);
        }
        // Listen for hash changes
        const handleHash = () => {
            const h = window.location.hash.replace('#', '') || 'chat';
            if (validPanels.includes(h)) setActivePanel(h);
        };
        window.addEventListener('hashchange', handleHash);
        return () => window.removeEventListener('hashchange', handleHash);
    }, [setActivePanel]);

    // WebSocket — wire file/workspace events through AppContext refs
    const { fileEventRef, wsSendRef, streamFrameRef, streamStartedRef, chatUpdateRef, terminalUpdateRef } = useApp();
    const wsSend = useWebSocket({
        onConnect: () => setConnected(true),
        onDisconnect: () => setConnected(false),
        onFileChanged: (data) => fileEventRef.current.onFileChanged?.(data),
        onWorkspaceChanged: (data) => fileEventRef.current.onWorkspaceChanged?.(data),
        onStreamFrame: (dataUrl, meta) => streamFrameRef.current?.(dataUrl, meta),
        onStreamStarted: (data) => streamStartedRef.current?.(data),
        onChatUpdate: (data) => chatUpdateRef.current?.(data),
        onTerminalUpdate: (data) => terminalUpdateRef.current?.(data),
        onTerminalListResult: (data) => terminalUpdateRef.current?.(data),
        onTerminalContentResult: (data) => terminalUpdateRef.current?.({ activeContent: data }),

    });
    wsSendRef.current = wsSend;

    if (authLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4 text-[var(--text-muted)]">
                <div class="spinner" />
                <div>{t('mobile.common.loading')}</div>
            </div>
        );
    }

    if (authEnabled && !authenticated) {
        return <LoginScreen />;
    }

    const navMode = mobileUI.navigationMode;

    return (
        <>
            <BackgroundVFX />
            {navMode === 'sidebar' && <Sidebar onPanelSwitch={setActivePanel} />}
            <main class="content">
                <PanelRouter />
            </main>
            {navMode === 'topbar' && <BottomNav />}
            {navMode === 'bottombar' && <BottomTabBar />}
            <ToastContainer />
            <PWAInstallPrompt />
        </>
    );
}

// ─── Root ───────────────────────────────────────────────────────────
export function App() {
    return (
        <AppProvider>
            <I18nProvider>
                <AppContent />
            </I18nProvider>
        </AppProvider>
    );
}
