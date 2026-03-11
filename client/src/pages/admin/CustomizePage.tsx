import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { showToast, PageHeader, TechCard, TechToggle } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';

export const CustomizePage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [showQuickActions, setShowQuickActions] = useState(true);
    const [navMode, setNavMode] = useState('sidebar');
    const [showAssist, setShowAssist] = useState(true);
    const [showTerminal, setShowTerminal] = useState(true);
    const [showStream, setShowStream] = useState(true);
    const [showGit, setShowGit] = useState(true);

    const [loaded, setLoaded] = useState(false);
    const isLoaded = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadConfig = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/config');
            const data = await res.json() as { config?: Record<string, unknown> };
            const c = (data.config || data) as Record<string, unknown>;
            const ui = c.mobileUI as Record<string, unknown> | undefined;
            if (ui) {
                setShowQuickActions(ui.showQuickActions !== false);
                setNavMode(ui.navigationMode as string || 'sidebar');
                setShowAssist(ui.showAssistTab !== false);
                setShowTerminal(ui.showTerminalTab !== false);
                setShowStream(ui.showStreamTab !== false);
                setShowGit(ui.showGitTab !== false);
            }

            setLoaded(true);
            isLoaded.current = true;
        } catch { showToast(t('toast.error.load'), 'error'); setLoaded(true); }
    };

    useEffect(() => { loadConfig(); }, []);

    const autoSave = (updates: Record<string, unknown>): void => {
        if (!isLoaded.current) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            try {
                await authFetch('/api/admin/mobile-ui', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updates),
                });
                showToast(t('toast.savedAuto'));
            } catch { showToast(t('toast.error.save'), 'error'); }
        }, 800);
    };



    const NavModeCard = ({ label, desc, active, onClick }: { label: string; desc: string; active: boolean; onClick: () => void }) => (
        <div
            class={`p-4 border cursor-pointer transition-all ${active ? 'border-[var(--brand)] bg-[var(--brand-glow)]' : 'border-[var(--border-color)] bg-[var(--surface-color)] hover:border-[var(--brand)]'}`}
            onClick={onClick}
        >
            <div class={`text-[13px] font-bold mb-1 ${active ? 'text-[var(--brand)]' : 'text-[var(--text-primary)]'}`}>{label}</div>
            <div class="text-[11px] text-[var(--text-secondary)]">{desc}</div>
        </div>
    );

    if (!loaded) return <div class="text-[var(--text-muted)]">{t('common.loading')}</div>;

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('customize.label')} title={t('customize.title')} description={t('customize.description')} />
                <div class="flex gap-2 shrink-0">
                    <span class="inline-flex items-center gap-1 px-3 py-1 border border-[var(--brand)] text-[11px] font-mono font-bold uppercase tracking-widest bg-[var(--brand-glow)] text-[var(--brand)]">
                        {t('common.autoSave')}
                    </span>
                </div>
            </div>

            <TechCard class="mb-5">
                <div class="section-label mb-5">{t('customize.section.options')}</div>
                
                <TechToggle 
                    label={t('customize.toggle.quickActions')} 
                    desc={t('customize.toggle.quickActionsDesc')} 
                    checked={showQuickActions} 
                    onChange={(v) => {
                        setShowQuickActions(v);
                        autoSave({ showQuickActions: v, navigationMode: navMode, showAssistTab: showAssist, showTerminalTab: showTerminal, showStreamTab: showStream, showGitTab: showGit });
                    }} 
                />
                
                <TechToggle 
                    label={t('customize.toggle.assistTab')} 
                    desc={t('customize.toggle.assistTabDesc')} 
                    checked={showAssist} 
                    onChange={(v) => {
                        setShowAssist(v);
                        autoSave({ showQuickActions, navigationMode: navMode, showAssistTab: v, showTerminalTab: showTerminal, showStreamTab: showStream, showGitTab: showGit });
                    }} 
                />
                <TechToggle 
                    label={t('customize.toggle.terminalTab')} 
                    desc={t('customize.toggle.terminalTabDesc')} 
                    checked={showTerminal} 
                    onChange={(v) => {
                        setShowTerminal(v);
                        autoSave({ showQuickActions, navigationMode: navMode, showAssistTab: showAssist, showTerminalTab: v, showStreamTab: showStream, showGitTab: showGit });
                    }} 
                />
                <TechToggle 
                    label={t('customize.toggle.streamTab')} 
                    desc={t('customize.toggle.streamTabDesc')} 
                    checked={showStream} 
                    onChange={(v) => {
                        setShowStream(v);
                        autoSave({ showQuickActions, navigationMode: navMode, showAssistTab: showAssist, showTerminalTab: showTerminal, showStreamTab: v, showGitTab: showGit });
                    }} 
                />
                <TechToggle 
                    label={t('customize.toggle.gitTab')} 
                    desc={t('customize.toggle.gitTabDesc')} 
                    checked={showGit} 
                    onChange={(v) => {
                        setShowGit(v);
                        autoSave({ showQuickActions, navigationMode: navMode, showAssistTab: showAssist, showTerminalTab: showTerminal, showStreamTab: showStream, showGitTab: v });
                    }} 
                />
            </TechCard>

            <TechCard>
                <div class="section-label mb-5">{t('customize.section.navMode')}</div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <NavModeCard label={t('customize.nav.sidebar')} desc={t('customize.nav.sidebarDesc')} active={navMode === 'sidebar'} onClick={() => {
                        setNavMode('sidebar');
                        autoSave({ showQuickActions, navigationMode: 'sidebar', showAssistTab: showAssist, showTerminalTab: showTerminal, showStreamTab: showStream, showGitTab: showGit });
                    }} />
                    <NavModeCard label={t('customize.nav.topbar')} desc={t('customize.nav.topbarDesc')} active={navMode === 'topbar'} onClick={() => {
                        setNavMode('topbar');
                        autoSave({ showQuickActions, navigationMode: 'topbar', showAssistTab: showAssist, showTerminalTab: showTerminal, showStreamTab: showStream, showGitTab: showGit });
                    }} />
                    <NavModeCard label={t('customize.nav.bottombar')} desc={t('customize.nav.bottombarDesc')} active={navMode === 'bottombar'} onClick={() => {
                        setNavMode('bottombar');
                        autoSave({ showQuickActions, navigationMode: 'bottombar', showAssistTab: showAssist, showTerminalTab: showTerminal, showStreamTab: showStream, showGitTab: showGit });
                    }} />
                </div>
            </TechCard>
        </div>
    );
};
