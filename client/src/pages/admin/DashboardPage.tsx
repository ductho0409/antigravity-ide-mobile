import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { Sun, Moon, BarChart3 } from 'lucide-preact';
import { showToast, toggleTheme } from './utils';
import type { AdminStatus } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';

export const DashboardPage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [status, setStatus] = useState<AdminStatus | null>(null);
    const [events, setEvents] = useState<Array<{ icon?: string; type: string; message: string; timestamp: string; ts?: number }>>([]);
    const [autoRefresh, setAutoRefresh] = useState(() => localStorage.getItem('admin-auto-refresh') !== 'off');
    const [autoAccept, setAutoAccept] = useState(false);

    const loadStatus = useCallback(async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/status');
            const data = await res.json() as AdminStatus;
            setStatus(data);
        } catch { /* ignore */ }
    }, []);

    const loadEvents = useCallback(async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/events');
            const data = await res.json() as { events: Array<{ icon?: string; type: string; message: string; timestamp: string; ts?: number }> };
            setEvents(data.events || []);
        } catch { /* ignore */ }
    }, []);

    const loadAutoAccept = useCallback(async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/config');
            const data = await res.json() as { config?: Record<string, unknown> };
            const c = (data.config || data) as Record<string, unknown>;
            setAutoAccept(!!c.autoAcceptCommands);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        loadStatus();
        loadEvents();
        loadAutoAccept();
    }, [loadStatus, loadEvents, loadAutoAccept]);

    useEffect(() => {
        if (!autoRefresh) return;
        const iv = setInterval(() => { loadStatus(); loadEvents(); }, 10000);
        return () => clearInterval(iv);
    }, [autoRefresh, loadStatus, loadEvents]);

    const toggleAutoRefresh = (): void => {
        const next = !autoRefresh;
        setAutoRefresh(next);
        localStorage.setItem('admin-auto-refresh', next ? 'on' : 'off');
    };

    const toggleAutoAccept = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/auto-accept/toggle', { method: 'POST' });
            const data = await res.json() as { enabled: boolean };
            setAutoAccept(data.enabled);
            showToast(data.enabled ? t('dashboard.toast.autoAcceptOn') : t('dashboard.toast.autoAcceptOff'));
        } catch { showToast(t('toast.error'), 'error'); }
    };

    const Toggle = ({ checked, onChange, label, description }: { checked: boolean; onChange: () => void; label: string; description?: string }) => (
        <div class="flex items-center justify-between pb-6 border-b border-[var(--border-color)] last:border-b-0 last:pb-0">
            <div>
                <div class="font-bold text-lg mb-1">{label}</div>
                {description && <div class="text-[13px] text-[var(--text-secondary)]">{description}</div>}
            </div>
            <div class={`tech-toggle ${checked ? 'on' : ''}`} onClick={onChange}></div>
        </div>
    );

    const formatUptime = (uptime?: string | number): string => {
        if (!uptime) return '—';
        if (typeof uptime === 'string') return uptime;
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    return (
        <div class="content-wrapper">
            <div style={{ display: 'none' }}>
                <Sun size={16} />
                <Moon size={16} />
                <BarChart3 size={16} />
                <button onClick={toggleTheme}>Theme</button>
            </div>

            {/* HEADER TITLE */}
            <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-8 mb-12">
                <div>
                    <div class="font-mono text-[10px] font-bold tracking-[0.2em] text-[var(--brand)] mb-6 flex items-center gap-2 uppercase">
                        <span class="w-1.5 h-1.5 bg-[var(--brand)] inline-block"></span> {t('dashboard.label')}
                    </div>
                    <h1 class="heading-title mb-4">
                        COMMAND <br />
                        <span class="heading-brand">CENTER_</span>
                    </h1>
                    <p class="text-lg text-[var(--text-secondary)] max-w-2xl font-light">
                        {t('dashboard.description')}
                    </p>
                </div>

                <div class="font-mono text-[10px] text-[var(--text-secondary)] text-left lg:text-right hidden sm:block">
                    UPTIME <span class="text-[var(--brand)] ml-2">99.9%</span><br />
                    ENCRYPTION <span class="text-[var(--text-primary)] ml-2">AES-256</span>
                </div>
            </div>

            {/* STATS GRID */}
            <div class="grid grid-cols-2 lg:grid-cols-4 border border-[var(--border-color)] mb-12 relative bg-[var(--surface-color)]/60 backdrop-blur">
                <div class="crosshair -top-1 -left-1"></div>
                <div class="crosshair -bottom-1 -right-1"></div>

                {/* Stat 1 */}
                <div class="p-6 md:p-8 border-b lg:border-b-0 border-r border-[var(--border-color)] group hover:bg-[var(--brand-glow)] transition-colors">
                    <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-4">{t('dashboard.stat.cdpStatus')}</div>
                    <div class="stat-number text-[var(--brand)] mb-2" style={status?.cdpConnected ? { textShadow: '0 0 20px var(--brand-glow)' } : { color: 'var(--text-secondary)' }}>
                        {status?.cdpConnected ? 'ONLINE' : 'OFFLINE'}
                    </div>
                    <div class="flex items-center gap-2 font-mono text-[10px] text-[var(--text-secondary)]">
                        <div class={`w-1.5 h-1.5 ${status?.cdpConnected ? 'bg-[var(--brand)]' : 'bg-[var(--text-secondary)]'}`}></div> {t('dashboard.stat.cdpConnected')}
                    </div>
                </div>

                {/* Stat 2 */}
                <div class="p-6 md:p-8 border-b lg:border-b-0 lg:border-r border-[var(--border-color)] group hover:bg-[var(--brand-glow)] transition-colors">
                    <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-4">{t('dashboard.stat.uptime')}</div>
                    <div class="stat-number mb-2">{formatUptime(status?.uptime)}</div>
                    <div class="font-mono text-[10px] text-[var(--text-secondary)] mt-2">{t('dashboard.stat.uptimeSince')}</div>
                </div>

                {/* Stat 3 */}
                <div class="p-6 md:p-8 border-r border-[var(--border-color)] group hover:bg-[var(--brand-glow)] transition-colors">
                    <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-4">{t('dashboard.stat.clients')}</div>
                    <div class="stat-number mb-2">{status?.activeClients ?? 0}</div>
                    <div class="flex gap-1 mt-4 w-16">
                        <div class="h-[2px] flex-1 bg-[var(--brand)]"></div>
                        <div class="h-[2px] flex-1 bg-[var(--brand)]"></div>
                        <div class="h-[2px] flex-1 bg-[var(--brand)]"></div>
                        <div class="h-[2px] flex-1 bg-[var(--border-color)]"></div>
                    </div>
                </div>

                {/* Stat 4 */}
                <div class="p-6 md:p-8 group hover:bg-[var(--brand-glow)] transition-colors">
                    <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-4">{t('dashboard.stat.memory')}</div>
                    <div class="stat-number mb-2">{status?.memory || '—'}</div>
                    <div class="w-full h-[2px] bg-[var(--border-color)] mt-4">
                        <div class="h-full bg-[var(--brand)] w-[45%] shadow-[0_0_8px_var(--brand)]"></div>
                    </div>
                </div>
            </div>

            {/* MAIN BENTO PANELS */}
            <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8 mb-12">

                {/* COLUMN 1: UPLINK */}
                <div class="tech-card p-8">
                    <div class="bracket bracket-tl"></div>
                    <div class="bracket bracket-tr"></div>
                    <div class="bracket bracket-bl"></div>
                    <div class="bracket bracket-br"></div>

                    <h2 class="font-display text-2xl mb-8">{t('dashboard.protocol.title')}</h2>
                    <div class="space-y-6">
                        <div class="flex items-center justify-between pb-6 border-b border-[var(--border-color)]">
                            <div>
                                <div class="font-bold text-lg mb-1">{t('dashboard.protocol.cdpBridge')}</div>
                                <div class="text-[13px] text-[var(--text-secondary)]">{t('dashboard.protocol.cdpDesc')}</div>
                            </div>
                            <div class={`tech-toggle ${status?.cdpConnected ? 'on' : ''}`}></div>
                        </div>
                        <div class="flex items-center justify-between pb-6 border-b border-[var(--border-color)]">
                            <div>
                                <div class="font-bold text-lg mb-1">{t('dashboard.protocol.telegramBot')}</div>
                                <div class="text-[13px] text-[var(--text-secondary)]">{t('dashboard.protocol.telegramDesc')}</div>
                            </div>
                            <div class={`tech-toggle ${status?.telegramActive ? 'on' : ''}`}></div>
                        </div>
                        <Toggle 
                            label={t('dashboard.toggle.autoAccept')} 
                            description={t('dashboard.toggle.autoAcceptDesc')}
                            checked={autoAccept} 
                            onChange={toggleAutoAccept} 
                        />
                        <Toggle 
                            label={t('dashboard.toggle.autoRefresh')} 
                            description={t('dashboard.toggle.autoRefreshDesc')}
                            checked={autoRefresh} 
                            onChange={toggleAutoRefresh} 
                        />
                    </div>
                </div>

                {/* COLUMN 2: ENV */}
                <div class="tech-card p-8">
                    <h2 class="font-display text-2xl mb-8">{t('dashboard.env.title')}</h2>
                    <div class="grid grid-cols-2 gap-y-10 gap-x-6">
                        <div>
                            <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.1em] mb-2">{t('dashboard.env.platform')}</div>
                            <div class="text-xl font-bold">Node.js</div>
                            <div class="text-[13px] text-[var(--text-secondary)] mt-1">{status?.node || '—'}</div>
                        </div>
                        <div>
                            <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.1em] mb-2">{t('dashboard.env.localPort')}</div>
                            <div class="text-xl font-bold text-[var(--brand)]">{status?.port || '—'}</div>
                            <div class="text-[13px] text-[var(--text-secondary)] mt-1">{t('dashboard.env.listening')}</div>
                        </div>
                        <div>
                            <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.1em] mb-2">{t('dashboard.env.auth')}</div>
                            <div class="text-xl font-bold flex items-center gap-2">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg> {status?.authEnabled ? 'PIN' : t('dashboard.env.authOff')}
                            </div>
                        </div>
                        <div>
                            <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.1em] mb-2">{t('dashboard.env.protocol')}</div>
                            <div class="text-xl font-bold">0.0.0.0</div>
                            <div class="text-[13px] text-[var(--text-secondary)] mt-1">{t('dashboard.env.allInterfaces')}</div>
                        </div>
                        <div>
                            <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.1em] mb-2">{t('dashboard.env.lanIP')}</div>
                            <div class="text-xl font-bold">{status?.lanIP || '—'}</div>
                            <div class="text-[13px] text-[var(--text-secondary)] mt-1">{t('dashboard.env.lanNetwork')}</div>
                        </div>
                        <div>
                            <div class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.1em] mb-2">{t('dashboard.env.appVersion')}</div>
                            <div class="text-xl font-bold">{status?.version || '—'}</div>
                        </div>
                    </div>
                </div>

                {/* COLUMN 3: TERMINAL LOGS */}
                <div class="tech-card flex flex-col lg:col-span-2 xl:col-span-1">
                    <div class="p-6 border-b border-[var(--border-color)] flex justify-between items-center">
                        <h2 class="font-display text-2xl">{t('dashboard.logs.title')}</h2>
                        <button
                            onClick={() => { loadStatus(); loadEvents(); }}
                            class="flex items-center gap-2 font-mono text-[10px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] px-3 py-1.5 hover:bg-[var(--brand)] hover:text-[#000] transition-colors">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                                <path d="M21 3v5h-5" />
                            </svg>
                            {t('dashboard.logs.refresh')}
                        </button>
                    </div>

                    <div class="font-mono text-[12px] h-[360px] overflow-y-auto bg-[var(--surface-color)]">
                        {events.length === 0 ? (
                            <div class="p-4 text-[var(--text-secondary)] italic opacity-60">{t('dashboard.logs.empty')}</div>
                        ) : (
                            events.map((ev, i) => {
                                const d = new Date(ev.timestamp);
                                const ts = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                const isError = ev.type === 'error';
                                
                                return (
                                    <div key={i} class={`terminal-row ${isError ? 'bg-red-500/10 border-l-2 border-l-red-500 pl-[22px]' : ''}`}>
                                        <span class={`${isError ? 'text-red-400' : 'text-[var(--text-secondary)]'} shrink-0 w-[60px]`}>{ts}</span>
                                        <div class={`flex-1 break-words ${isError ? 'text-red-400' : ''}`}>
                                            <span class={`${isError ? 'text-red-500 font-bold' : 'text-[var(--brand)]'} mr-2`}>
                                                [{ev.type.toUpperCase()}]
                                            </span>
                                            {ev.message}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
