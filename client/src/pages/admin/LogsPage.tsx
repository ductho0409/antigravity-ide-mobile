import type { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Download, Pause, Play, Trash2 } from 'lucide-preact';
import { showToast, PageHeader, TechCard, ConfirmModal } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';

interface LogSession {
    filename: string;
    date: string;
    events: number;
    size: number;
}

interface LogEvent {
    type: string;
    message: string;
    timestamp: string;
    icon?: string;
}

export const LogsPage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [sessions, setSessions] = useState<LogSession[]>([]);
    const [events, setEvents] = useState<LogEvent[]>([]);
    const [activeSession, setActiveSession] = useState('');
    const [paused, setPaused] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const loadSessions = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/logs');
            const data = await res.json() as { sessions?: LogSession[] };
            setSessions(data.sessions || []);
        } catch { showToast(t('logs.toast.loadError'), 'error'); }
    };

    const loadPauseStatus = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/logs/pause');
            const data = await res.json() as { paused: boolean };
            setPaused(data.paused);
        } catch { /* ignore */ }
    };

    useEffect(() => { loadSessions(); loadPauseStatus(); }, []);

    const viewSession = async (filename: string): Promise<void> => {
        setActiveSession(filename);
        try {
            const res = await authFetch(`/api/admin/logs/${filename}`);
            const data = await res.json() as { events: LogEvent[] };
            setEvents(data.events || []);
        } catch { showToast(t('logs.toast.sessionError'), 'error'); }
    };

    const togglePause = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/logs/pause', { method: 'POST' });
            const data = await res.json() as { paused: boolean };
            setPaused(data.paused);
            showToast(data.paused ? t('logs.toast.paused') : t('logs.toast.resumed'));
        } catch { showToast(t('toast.error'), 'error'); }
    };

    const clearAll = async (): Promise<void> => {
        try {
            await authFetch('/api/admin/logs', { method: 'DELETE' });
            showToast(t('logs.toast.cleared'));
            loadSessions();
            setEvents([]);
            setActiveSession('');
        } catch { showToast(t('toast.error'), 'error'); }
    };

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('logs.label')} title={t('logs.title')} description={t('logs.description')} />
                <div class="flex gap-2 shrink-0">
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={togglePause}>
                        {paused ? <Play size={14} /> : <Pause size={14} />}
                        {paused ? ' ' + t('logs.btn.resume') : ' ' + t('logs.btn.pause')}
                    </button>
                    <button class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--error)] hover:border-[var(--error)] hover:bg-[var(--error-muted)] transition-colors cursor-pointer" onClick={() => setConfirmOpen(true)}>
                        <Trash2 size={14} /> {t('logs.btn.clearAll')}
                    </button>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Session list */}
                <TechCard>
                    <div class="section-label mb-5">{t('logs.section.sessions')}</div>
                    {sessions.length === 0 ? (
                        <div class="text-[var(--text-muted)]">{t('logs.sessions.empty')}</div>
                    ) : (
                        sessions.map(s => (
                            <div key={s.filename} class={`terminal-row cursor-pointer ${activeSession === s.filename ? 'bg-[var(--brand-glow)] border-l-2 border-l-[var(--brand)]' : ''}`}
                                onClick={() => viewSession(s.filename)}>
                                <div>
                                    <div class="text-[13px] font-medium">{new Date(s.date).toLocaleDateString()}</div>
                                    <div class="text-[11px] text-[var(--text-muted)]">{s.events} {t('logs.sessions.events')} · {(s.size / 1024).toFixed(1)}KB</div>
                                </div>
                                <a class="text-[var(--brand)] hover:text-[#000] hover:bg-[var(--brand)] p-1 transition-colors" href={`/api/admin/logs/${s.filename}/download`} target="_blank" onClick={(e) => e.stopPropagation()}>
                                    <Download size={14} />
                                </a>
                            </div>
                        ))
                    )}
                </TechCard>

                {/* Event viewer */}
                <TechCard>
                    <div class="section-label mb-5">
                        {activeSession ? t('logs.section.sessionPrefix') + ' ' + activeSession : t('logs.section.selectSession')}
                    </div>
                    <div class="max-h-[400px] overflow-y-auto">
                        {events.length === 0 ? (
                            <div class="text-[var(--text-muted)]">{activeSession ? t('logs.events.empty') : t('logs.events.selectHint')}</div>
                        ) : (
                            events.map((ev, i) => (
                                <div key={i} class="terminal-row flex-col items-start gap-1">
                                    <div class="flex items-center gap-2">
                                        <span class="text-[11px] text-[var(--text-muted)]">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                        <span class={`text-xs font-semibold px-1.5 py-0.5 border ${ev.type === 'error' ? 'bg-[var(--error-muted)] text-[var(--error)] border-[rgba(244,63,94,0.3)]' : 'bg-[var(--brand-glow)] text-[var(--brand)] border-[rgba(0,229,153,0.3)]'}`}>
                                            {ev.type}
                                        </span>
                                    </div>
                                    <div class="text-[13px] mt-1 text-[var(--text-secondary)]">{ev.message}</div>
                                </div>
                            ))
                        )}
                    </div>
                </TechCard>
            </div>
            <ConfirmModal
                open={confirmOpen}
                title={t('logs.confirm.clearAll')}
                message={t('logs.confirm.clearAll')}
                confirmLabel={t('common.confirmDelete')}
                cancelLabel={t('common.cancel')}
                variant="danger"
                onConfirm={() => { setConfirmOpen(false); clearAll(); }}
                onCancel={() => setConfirmOpen(false)}
            />
        </div>
    );
};
