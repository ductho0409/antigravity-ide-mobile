/**
 * BottomTabBar — Native-style bottom tab navigation for mobile
 * Fixed at bottom of screen with icon + label layout (iOS/Android pattern)
 */
import { useApp } from '../context/AppContext';
import { MessageCircle, FolderOpen, Monitor, Bot, Settings, GitBranch, Terminal } from 'lucide-preact';
import { useTranslation } from '../i18n';

const PANEL_ICONS: Record<string, typeof MessageCircle> = {
    chat: MessageCircle,
    files: FolderOpen,
    git: GitBranch,
    stream: Monitor,
    assist: Bot,
    settings: Settings,
    terminal: Terminal,
};

export function BottomTabBar() {
    const { activePanel, setActivePanel, mobileUI } = useApp();
    const { t } = useTranslation();

    const panels = [
        { id: 'chat', label: t('mobile.nav.chat'), hidden: mobileUI.showChatTab === false },
        { id: 'files', label: t('mobile.nav.files'), hidden: mobileUI.showFilesTab === false },
        { id: 'git', label: t('mobile.nav.git'), hidden: !mobileUI.showGitTab },
        { id: 'stream', label: t('mobile.nav.stream'), hidden: !mobileUI.showStreamTab },
        { id: 'assist', label: t('mobile.nav.assist'), hidden: !mobileUI.showAssistTab },
        { id: 'terminal', label: t('mobile.nav.terminal'), hidden: !mobileUI.showTerminalTab },
        { id: 'settings', label: t('mobile.nav.settings') },
    ];

    const handleNav = (panelId: string): void => {
        setActivePanel(panelId);
        if (window.location.hash !== `#${panelId}`) {
            window.history.pushState(null, '', `#${panelId}`);
        }
    };

    return (
        <nav className="bottom-tab-bar" id="bottomTabBar">
            {panels.filter(p => !p.hidden).map(p => {
                const Icon = PANEL_ICONS[p.id];
                const isActive = activePanel === p.id;
                return (
                    <button
                        key={p.id}
                        className={`bottom-tab-item${isActive ? ' active' : ''}`}
                        data-panel={p.id}
                        onClick={() => handleNav(p.id)}
                    >
                        {isActive && <span className="bottom-tab-indicator" />}
                        {Icon && <Icon size={22} className="bottom-tab-icon" />}
                        <span className="bottom-tab-label">{p.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
