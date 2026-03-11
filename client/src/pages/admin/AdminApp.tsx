/**
 * AdminApp — Admin panel entry point with sidebar + hash routing
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import {
    LayoutDashboard, Server, MessageSquare, Monitor, Terminal, Smartphone,
    Palette, Globe, FileText, Camera, BarChart3, Brain, Menu, X, Sun
} from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { restoreTheme, toggleTheme } from './utils';
import { I18nProvider, useTranslation } from '../../i18n';
import { DashboardPage } from './DashboardPage';
import { ServerPage } from './ServerPage';
import { TelegramPage } from './TelegramPage';
import { DevicesPage } from './DevicesPage';
import { CommandsPage } from './CommandsPage';
import { MobilePage } from './MobilePage';
import { CustomizePage } from './CustomizePage';
import { RemotePage } from './RemotePage';
import { LogsPage } from './LogsPage';
import { ScreenshotsPage } from './ScreenshotsPage';
import { AnalyticsPage } from './AnalyticsPage';
import { SupervisorPage } from './SupervisorPage';
import { authFetch } from '../../hooks/useApi';
import { AppProvider, useApp } from '../../context/AppContext';
import { LoginScreen } from '../../components/LoginScreen';

// ─── Types ──────────────────────────────────────────────────────────
type PageId = 'dashboard' | 'server' | 'telegram' | 'devices' | 'commands'
    | 'mobile' | 'customize' | 'remote' | 'logs' | 'screenshots' | 'analytics' | 'supervisor';

interface NavItem {
    id: PageId;
    labelKey: string;
    icon: LucideIcon;
    sectionKey?: string;
}

const NAV_ITEMS: NavItem[] = [
    { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, sectionKey: 'nav.section.core' },
    { id: 'server', labelKey: 'nav.server', icon: Server },
    { id: 'telegram', labelKey: 'nav.telegram', icon: MessageSquare },
    { id: 'devices', labelKey: 'nav.devices', icon: Monitor },
    { id: 'commands', labelKey: 'nav.commands', icon: Terminal, sectionKey: 'nav.section.modules' },
    { id: 'mobile', labelKey: 'nav.mobile', icon: Smartphone },
    { id: 'customize', labelKey: 'nav.customize', icon: Palette },
    { id: 'remote', labelKey: 'nav.remote', icon: Globe },
    { id: 'logs', labelKey: 'nav.logs', icon: FileText },
    { id: 'screenshots', labelKey: 'nav.screenshots', icon: Camera },
    { id: 'analytics', labelKey: 'nav.analytics', icon: BarChart3 },
    { id: 'supervisor', labelKey: 'nav.supervisor', icon: Brain },
];

const PAGE_COMPONENTS: Record<PageId, () => ReturnType<typeof DashboardPage>> = {
    dashboard: () => <DashboardPage />,
    server: () => <ServerPage />,
    telegram: () => <TelegramPage />,
    devices: () => <DevicesPage />,
    commands: () => <CommandsPage />,
    mobile: () => <MobilePage />,
    customize: () => <CustomizePage />,
    remote: () => <RemotePage />,
    logs: () => <LogsPage />,
    screenshots: () => <ScreenshotsPage />,
    analytics: () => <AnalyticsPage />,
    supervisor: () => <SupervisorPage />,
};

// ─── Sidebar ────────────────────────────────────────────────────────
function AdminSidebar({ activePage, onNavigate, status, isOpen, onClose }: {
    activePage: PageId;
    onNavigate: (page: PageId) => void;
    status: { connected: boolean; text: string };
    isOpen: boolean;
    onClose: () => void;
}) {
    const { t, lang, toggleLang } = useTranslation();
    let lastSectionKey = '';

    const handleNav = (page: PageId): void => {
        onNavigate(page);
        onClose();
    };

    return (
        <>
            {/* Overlay — visible on mobile when sidebar is open */}
            {isOpen && (
                <div
                    class="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-[99] md:hidden"
                    onClick={onClose}
                />
            )}
            <aside class={`
                w-[260px] min-w-[260px] bg-transparent flex flex-col border-r border-[var(--border-color)] h-screen sticky top-0
                max-md:fixed max-md:left-0 max-md:z-[100] max-md:bg-[var(--surface-color)]
                max-md:transition-transform max-md:duration-[400ms] max-md:ease-[cubic-bezier(0.16,1,0.3,1)]
                ${isOpen ? 'max-md:translate-x-0 max-md:shadow-[20px_0_50px_rgba(0,0,0,0.5)]' : 'max-md:-translate-x-full max-md:shadow-none'}
            `}>
                <div class="h-24 flex items-center px-6 border-b border-[var(--border-color)] relative">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2.5" class="mr-3 shrink-0">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                    <div class="font-display font-bold text-xl tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ANTIGRAVITY</div>
                    <button
                        class="absolute right-4 w-7 h-7 rounded-md border-none bg-transparent text-[var(--text-secondary)] cursor-pointer items-center justify-center hidden max-md:flex hover:bg-white/[0.08]"
                        onClick={onClose}
                        title={t('sidebar.closeMenu')}
                    >
                        <X size={18} />
                    </button>
                </div>
                <div class="flex-1 py-6 overflow-y-auto overscroll-contain space-y-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {NAV_ITEMS.map(item => {
                        const showSection = item.sectionKey && item.sectionKey !== lastSectionKey;
                        if (item.sectionKey) lastSectionKey = item.sectionKey;
                        const IconComp = item.icon;
                        const isActive = activePage === item.id;
                        return (
                            <div key={item.id}>
                                {showSection && (
                                    <div class={`px-6 mb-4 ${lastSectionKey && item.sectionKey !== NAV_ITEMS[0].sectionKey ? 'mt-8' : ''}`}>
                                        <span class="text-[10px] font-mono text-[var(--text-secondary)] uppercase tracking-[0.2em]">{t(item.sectionKey!)}</span>
                                    </div>
                                )}
                                <a
                                    class={`nav-item ${isActive ? 'active' : ''}`}
                                    onClick={() => handleNav(item.id)}
                                >
                                    <IconComp size={18} class="shrink-0" />
                                    {t(item.labelKey)}
                                </a>
                            </div>
                        );
                    })}
                </div>
                <div class="p-6 max-md:p-4 border-t border-[var(--border-color)]">
                    <div class="flex items-center justify-between mb-4">
                        {/* Language toggle */}
                        <div
                            class="flex items-center gap-2 border border-[var(--border-color)] rounded-full px-3 py-1.5 cursor-pointer hover:border-[var(--brand)] transition-colors"
                            onClick={toggleLang}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                            </svg>
                            <span class="text-xs font-bold">{lang.toUpperCase()}</span>
                        </div>
                        {/* Theme toggle button */}
                        <button class="w-9 h-9 rounded-full border border-[var(--border-color)] flex items-center justify-center text-[var(--text-secondary)] cursor-pointer hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors" onClick={toggleTheme}>
                            <Sun size={16} />
                        </button>
                    </div>
                    <a
                        href="/"
                        target="_blank"
                        class="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand)] text-sm font-semibold cursor-pointer hover:bg-[var(--brand)]/20 transition-colors no-underline mb-4"
                    >
                        <Smartphone size={16} />
                        {t('sidebar.mobileDashboard')}
                    </a>
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <div class={`w-2 h-2 rounded-full ${status.connected ? 'bg-[var(--brand)] animate-pulse shadow-[0_0_8px_var(--brand)]' : 'bg-[#ef4444]'}`} />
                            <span class="text-[10px] font-mono text-[var(--brand)] uppercase tracking-widest font-bold">
                                {status.connected ? t('status.connected') : t('status.disconnected')}
                            </span>
                        </div>
                        
                        <span class="text-[10px] font-mono text-[var(--text-secondary)]">v2.0</span>
                    </div>
                    <div class="mt-4 pt-4 border-t border-[var(--border-color)] text-center">
                        <a href="https://xcloudphone.com?utm_source=AntigravityMobile" target="_blank" rel="noopener noreferrer" class="text-[10px] text-[var(--text-secondary)] opacity-50 hover:opacity-100 transition-opacity no-underline flex flex-col items-center justify-center gap-1.5">
                            <span>{t('common.sponsoredBy')}</span>
                            <img
                                src="https://xcloudphone.com/logo-light.svg"
                                alt="xCloudPhone"
                                class="sponsor-logo-dark h-5 w-auto"
                            />
                            <img
                                src="https://xcloudphone.com/logo-dark.svg"
                                alt="xCloudPhone"
                                class="sponsor-logo-light h-5 w-auto"
                            />
                            <span class="font-bold text-[var(--brand)]">xCloudPhone.com</span>
                        </a>
                    </div>
                </div>
            </aside >
        </>
    );
}

function AdminMain() {
    const { t } = useTranslation();
    const [activePage, setActivePage] = useState<PageId>(() => {
        const hash = window.location.hash.replace('#', '') as PageId;
        return NAV_ITEMS.some(n => n.id === hash) ? hash : 'dashboard';
    });
    const [status, setStatus] = useState({ connected: false, text: '' });
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const navigate = useCallback((page: PageId) => {
        setActivePage(page);
        window.history.pushState(null, '', `#${page}`);
    }, []);

    // Hash change listener
    useEffect(() => {
        const handler = () => {
            const hash = window.location.hash.replace('#', '') as PageId;
            if (NAV_ITEMS.some(n => n.id === hash)) setActivePage(hash);
        };
        window.addEventListener('hashchange', handler);
        return () => window.removeEventListener('hashchange', handler);
    }, []);

    // Restore saved theme
    useEffect(() => { restoreTheme(); }, []);

    // Poll status
    useEffect(() => {
        const poll = async () => {
            try {
                const res = await authFetch('/api/admin/status');
                if (res.ok) {
                    const s = await res.json();
                    setStatus({
                        connected: s.cdpConnected,
                        text: s.cdpConnected ? t('status.textConnected') : t('status.textDisconnected'),
                    });
                }
            } catch { /* ignore */ }
        };
        poll();
        const interval = setInterval(poll, 10000);
        return () => clearInterval(interval);
    }, [t]);

    return (
        <>
            <div class="bg-grid" />
            <div class="bg-glow" />
            <div class="flex h-screen relative z-10">
                <AdminSidebar
                    activePage={activePage}
                    onNavigate={navigate}
                    status={status}
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                />
                <main class="flex-1 overflow-y-auto">
                    {/* Mobile topbar */}
                    <div class="lg:hidden flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-color)]/90 backdrop-blur sticky top-0 z-40">
                        <div style={{ fontFamily: "'Space Grotesk', sans-serif" }} class="font-bold text-lg">ANTIGRAVITY</div>
                        <button onClick={() => setSidebarOpen(true)} class="p-2 border border-[var(--border-color)] rounded">
                            <Menu size={20} />
                        </button>
                    </div>
                    <div class="p-10 lg:px-8 max-md:px-5 max-md:pt-6 w-full">
                        {PAGE_COMPONENTS[activePage]?.() ?? <div>{t('app.pageNotFound')}</div>}
                    </div>
                </main>
            </div>
        </>
    );
}

function AdminAppInner() {
    const { t } = useTranslation();
    const { authenticated } = useApp();
    const [adminCheckDone, setAdminCheckDone] = useState(false);
    const [needsAdminLogin, setNeedsAdminLogin] = useState(false);

    // Dynamic Admin Auth Guard
    useEffect(() => {
        let mounted = true;
        async function checkAdminAuth() {
            try {
                const token = localStorage.getItem('authToken');
                const headers: Record<string, string> = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;
                
                // Use raw fetch to prevent authFetch from triggering an infinite reload loop on 401
                const res = await fetch('/api/admin/status', { headers });
                
                if (!mounted) return;

                if (res.status === 401) {
                    setNeedsAdminLogin(true);
                } else {
                    setNeedsAdminLogin(false);
                }
            } catch {
                if (mounted) setNeedsAdminLogin(false);
            } finally {
                if (mounted) setAdminCheckDone(true);
            }
        }
        checkAdminAuth();
        return () => { mounted = false; };
    }, [authenticated]);

    if (!adminCheckDone) {
        return (
            <div className="app-loading flex flex-col items-center justify-center h-screen gap-4 text-[var(--text-muted)]">
                <div class="spinner border-4 border-[var(--text-muted)] border-t-[var(--brand)] rounded-full w-8 h-8 animate-spin" />
                <div>{t('mobile.common.loading')}</div>
            </div>
        );
    }

    if (needsAdminLogin && !authenticated) {
        return <LoginScreen />;
    }

    return <AdminMain />;
}

export function AdminApp() {
    return (
        <AppProvider>
            <I18nProvider>
                <AdminAppInner />
            </I18nProvider>
        </AppProvider>
    );
}
