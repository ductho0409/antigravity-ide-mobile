import type { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Pause, Play, Trash2, RefreshCw, Settings, ChevronDown, ChevronUp } from 'lucide-preact';
import { showToast, PageHeader, TechCard, ConfirmModal } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';

interface Screenshot { filename: string; timestamp: string; size: number; }
interface SchedulerStatus {
    enabled: boolean;
    running: boolean;
    format: string;
    quality: number;
    intervalMs: number;
    maxFiles: number;
    fileCount: number;
}

export const ScreenshotsPage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
    const [fullViewSrc, setFullViewSrc] = useState<string | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settings, setSettings] = useState({ intervalMs: 30000, quality: 70, maxFiles: 200, format: 'webp' });
    const [saving, setSaving] = useState(false);

    const loadStatus = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/screenshots/status');
            const data = await res.json() as SchedulerStatus;
            setEnabled(data.enabled);
            setSettings({
                intervalMs: data.intervalMs,
                quality: data.quality,
                maxFiles: data.maxFiles,
                format: data.format
            });
        } catch { /* ignore */ }
    };

    const loadGallery = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/screenshots');
            const data = await res.json() as { screenshots?: Screenshot[] };
            setScreenshots(data.screenshots || []);
            setLoaded(true);
        } catch { showToast(t('toast.error'), 'error'); setLoaded(true); }
    };

    useEffect(() => { loadStatus(); loadGallery(); }, []);

    const toggleScreenshots = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/screenshots/toggle', { method: 'POST' });
            const data = await res.json() as { enabled: boolean };
            setEnabled(data.enabled);
            showToast(data.enabled ? t('screenshots.toast.enabled') : t('screenshots.toast.disabled'));
        } catch { showToast(t('toast.error'), 'error'); }
    };

    const saveSettings = async (): Promise<void> => {
        setSaving(true);
        try {
            await authFetch('/api/admin/screenshots/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            showToast(t('screenshots.toast.settingsSaved'));
        } catch { showToast(t('toast.error'), 'error'); }
        setSaving(false);
    };

    const clearScreenshots = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/screenshots', { method: 'DELETE' });
            const data = await res.json() as { deleted?: number };
            showToast(t('screenshots.toast.deleted') + ' ' + data.deleted + ' ' + t('screenshots.toast.deletedSuffix'));
            loadGallery();
        } catch { showToast(t('toast.error'), 'error'); }
    };

    const formatTimestamp = (ts: string): string => {
        try {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return ts;
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hour = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return `${month}/${day} ${hour}:${min}`;
        } catch { return ts; }
    };

    const inputClass = 'w-full px-3 py-2 text-[13px] bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:border-[var(--brand)] outline-none transition-colors';
    const labelClass = 'text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1';

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('screenshots.label')} title={t('screenshots.title')} description={t('screenshots.description')} />
                <div class="flex gap-2 shrink-0">
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={toggleScreenshots}>
                        {enabled ? <Pause size={14} /> : <Play size={14} />}
                        {enabled ? ' ' + t('common.disable') : ' ' + t('common.enable')}
                    </button>
                    <button class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={() => setSettingsOpen(!settingsOpen)}>
                        <Settings size={14} />
                        {settingsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    <button class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--error)] hover:border-[var(--error)] hover:bg-[var(--error-muted)] transition-colors cursor-pointer" onClick={() => setConfirmOpen(true)}>
                        <Trash2 size={14} /> {t('screenshots.btn.clearAll')}
                    </button>
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={() => { loadGallery(); loadStatus(); }}>
                        <RefreshCw size={14} /> {t('common.refresh')}
                    </button>
                </div>
            </div>

            {/* Settings Panel (collapsible) */}
            {settingsOpen && (
                <TechCard class="mb-6">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <div class={labelClass}>{t('screenshots.settings.interval')}</div>
                            <select class={inputClass} value={settings.intervalMs}
                                onChange={(e) => setSettings({ ...settings, intervalMs: Number((e.target as HTMLSelectElement).value) })}>
                                <option value={5000}>5s</option>
                                <option value={10000}>10s</option>
                                <option value={15000}>15s</option>
                                <option value={30000}>30s</option>
                                <option value={60000}>1m</option>
                                <option value={120000}>2m</option>
                                <option value={300000}>5m</option>
                            </select>
                        </div>
                        <div>
                            <div class={labelClass}>{t('screenshots.settings.quality')}</div>
                            <div class="flex items-center gap-2">
                                <input type="range" min="10" max="100" step="5" class="flex-1 accent-[var(--brand)]"
                                    value={settings.quality}
                                    onInput={(e) => setSettings({ ...settings, quality: Number((e.target as HTMLInputElement).value) })} />
                                <span class="text-[12px] text-[var(--text-secondary)] w-8 text-right font-mono">{settings.quality}</span>
                            </div>
                        </div>
                        <div>
                            <div class={labelClass}>{t('screenshots.settings.maxFiles')}</div>
                            <input type="number" min="10" max="1000" class={inputClass}
                                value={settings.maxFiles}
                                onInput={(e) => setSettings({ ...settings, maxFiles: Number((e.target as HTMLInputElement).value) })} />
                        </div>
                        <div>
                            <div class={labelClass}>{t('screenshots.settings.format')}</div>
                            <select class={inputClass} value={settings.format}
                                onChange={(e) => setSettings({ ...settings, format: (e.target as HTMLSelectElement).value })}>
                                <option value="webp">WebP</option>
                                <option value="jpeg">JPEG</option>
                            </select>
                        </div>
                    </div>
                    <div class="mt-4 flex justify-end">
                        <button class="px-6 py-2 font-mono text-[12px] font-bold tracking-widest uppercase bg-[var(--brand)] text-[var(--bg-primary)] border border-[var(--brand)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                            onClick={saveSettings} disabled={saving}>
                            {saving ? t('common.saving') : t('common.save')}
                        </button>
                    </div>
                </TechCard>
            )}

            <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                {!loaded ? (
                    <div class="text-[var(--text-secondary)]">{t('common.loading')}</div>
                ) : screenshots.length === 0 ? (
                    <TechCard class="col-span-full text-[var(--text-secondary)]">
                        {t('screenshots.empty')}
                    </TechCard>
                ) : (
                    screenshots.map(s => (
                        <div key={s.filename} class="cursor-pointer overflow-hidden border border-[var(--border-color)] hover:border-[var(--brand)] transition-colors"
                            onClick={() => setFullViewSrc(`/api/admin/screenshots/${s.filename}`)}>
                            <img src={`/api/admin/screenshots/${s.filename}`} loading="lazy"
                                class="w-full aspect-video object-cover block" />
                            <div class="py-1.5 px-2 text-[11px] text-[var(--text-secondary)] text-center">
                                {formatTimestamp(s.timestamp)} · {(s.size / 1024).toFixed(0)}KB
                            </div>
                        </div>
                    ))
                )}
            </div>

            {fullViewSrc && (
                <div
                    class="fixed inset-0 bg-black/85 z-[1000] cursor-pointer p-5 flex items-center justify-center"
                    onClick={() => setFullViewSrc(null)}>
                    <img src={fullViewSrc} class="max-w-full max-h-full block m-auto" />
                </div>
            )}
            <ConfirmModal
                open={confirmOpen}
                title={t('screenshots.confirm.clearAll')}
                message={t('screenshots.confirm.clearAll')}
                confirmLabel={t('common.confirmDelete')}
                cancelLabel={t('common.cancel')}
                variant="danger"
                onConfirm={() => { setConfirmOpen(false); clearScreenshots(); }}
                onCancel={() => setConfirmOpen(false)}
            />
        </div>
    );
};
