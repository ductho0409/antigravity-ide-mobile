/**
 * Sidebar — Collapsible side navigation
 * Topbar-mode and body-level layout offsets remain in layout.css
 */
import { useState } from 'preact/hooks';
import { useApp } from '../context/AppContext';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../i18n';
import { MessageCircle, FolderOpen, Settings, Monitor, Bot, Zap, GitBranch, Terminal } from 'lucide-preact';

// Icon map for sidebar nav
const PANEL_ICONS: Record<string, typeof MessageCircle> = {
    chat: MessageCircle,
    files: FolderOpen,
    git: GitBranch,
    settings: Settings,
    stream: Monitor,
    assist: Bot,
    terminal: Terminal,
};
interface SidebarProps {
    onPanelSwitch: (panel: string) => void;
}

export function Sidebar({ onPanelSwitch }: SidebarProps) {
    const { activePanel, connected, mobileUI } = useApp();
    const { setTheme, cycleTheme, getThemeIcon, THEMES } = useTheme();
    const currentTheme = typeof window !== 'undefined' ? (localStorage.getItem('theme') || 'command') : 'command';
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    const toggleSidebar = () => {
        setExpanded(prev => !prev);
        document.body.classList.toggle('sidebar-expanded', !expanded);
    };

    const handleNav = (panel: string) => {
        onPanelSwitch(panel);
        // Sync URL hash
        if (window.location.hash !== `#${panel}`) {
            window.history.pushState(null, '', `#${panel}`);
        }
    };

    const panels = [
        { id: 'chat', label: t('mobile.nav.chat'), hidden: mobileUI.showChatTab === false },
        { id: 'files', label: t('mobile.nav.files'), hidden: mobileUI.showFilesTab === false },
        { id: 'git', label: t('mobile.nav.git'), hidden: !mobileUI.showGitTab },
        { id: 'settings', label: t('mobile.nav.settings'), hidden: false },
        { id: 'stream', label: t('mobile.nav.stream'), hidden: !mobileUI.showStreamTab },
        { id: 'assist', label: t('mobile.nav.assist'), hidden: !mobileUI.showAssistTab },
        { id: 'terminal', label: t('mobile.nav.terminal'), hidden: !mobileUI.showTerminalTab },
    ];
    return (
        <nav
            className={`sidebar fixed top-0 left-0 bottom-0 bg-[var(--bg-card)] border-r border-[var(--border)] z-[200] flex flex-col transition-[width] duration-[250ms] ease ${expanded ? 'expanded w-[var(--sidebar-width)]' : 'w-[var(--sidebar-collapsed)]'}`}
            id="sidebar"
        >
            {/* ─── Header ─── */}
            <div className="flex items-center gap-3 p-4 border-b border-[var(--border)] min-h-[64px]">
                <button
                    className="w-8 h-8 bg-[var(--bg-glass)] border border-[var(--border)] rounded-lg text-[var(--text-secondary)] cursor-pointer flex items-center justify-center transition-all duration-200 shrink-0 hover:bg-[var(--accent-primary)] hover:text-white hover:border-[var(--accent-primary)]"
                    onClick={toggleSidebar}
                    title="Toggle sidebar"
                >
                    <Zap size={18} />
                </button>
                <div className={`flex items-center gap-2.5 overflow-hidden transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>
                    <span className="logo-text">Antigravity</span>
                </div>
            </div>

            {/* ─── Nav Items ─── */}
            <div className="flex-1 px-2 py-3 flex flex-col gap-1">
                {panels.filter(p => !p.hidden).map(p => {
                    const Icon = PANEL_ICONS[p.id];
                    return (
                        <button
                            key={p.id}
                            className={`flex items-center gap-3 p-3 border-none rounded-[10px] cursor-pointer transition-all duration-200 text-left w-full overflow-hidden ${activePanel === p.id
                                    ? 'bg-[var(--accent-primary)] text-white'
                                    : 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-glass)] hover:text-[var(--text-primary)]'
                                }`}
                            data-panel={p.id}
                            onClick={() => handleNav(p.id)}
                        >
                            {Icon && <Icon size={20} className="shrink-0" />}
                            <span className={`whitespace-nowrap transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>{p.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* ─── Footer ─── */}
            <div className="px-2 py-3 border-t border-[var(--border)]">
                <div id="statusPill" class={`status-pill ${connected ? 'connected' : 'disconnected'}`}>
                    <div class="status-dot" />
                    <span class="status-text">{connected ? t('mobile.common.connected') : t('mobile.common.connecting')}</span>
                </div>
                <button
                    id="themeIconBtn"
                    className={`w-full h-10 bg-[var(--bg-glass)] border border-[var(--border)] rounded-lg cursor-pointer flex items-center justify-center text-lg transition-all duration-200 hover:bg-[rgba(139,92,246,0.2)] hover:border-[var(--accent-primary)] ${expanded ? 'hidden' : ''}`}
                    onClick={cycleTheme}
                    title="Change theme"
                >
                    {getThemeIcon()}
                </button>
                <select
                    id="sidebarThemeSelect"
                    className={`w-full py-2.5 px-3 bg-[var(--bg-glass)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] text-[13px] cursor-pointer appearance-none ${expanded ? '' : 'hidden'}`}
                    value={currentTheme}
                    onChange={(e) => setTheme((e.target as HTMLSelectElement).value)}
                >
                    {THEMES.map(th => (
                        <option key={th} value={th}>
                            {th.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                        </option>
                    ))}
                </select>
            </div>
        </nav>
    );
}
