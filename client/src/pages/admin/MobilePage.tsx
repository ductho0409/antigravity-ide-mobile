import type { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Smartphone } from 'lucide-preact';
import { showToast, PageHeader, TechCard } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';
import { useTheme } from '../../hooks/useTheme';

export const MobilePage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const { THEMES } = useTheme();
    const [refreshInterval, setRefreshInterval] = useState('2000');
    const [dashTheme, setDashTheme] = useState('command');
    const [qrImgUrl, setQrImgUrl] = useState('');
    const [hostUrl, setHostUrl] = useState('');

    const loadConfig = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/config');
            const data = await res.json() as { config?: Record<string, unknown> };
            const c = (data.config || data) as Record<string, unknown>;
            const dash = c.dashboard as { refreshInterval?: number; theme?: string } | undefined;
            setRefreshInterval(String(dash?.refreshInterval || 2000));
            setDashTheme(dash?.theme || 'dark');
        } catch { showToast(t('toast.error.load'), 'error'); }
    };

    const generateQR = async (): Promise<void> => {
        const port = location.port || '3333';
        let host = location.hostname;
        try {
            const res = await authFetch('/api/admin/status');
            const data = await res.json() as { lanIP?: string };
            if (data.lanIP) host = data.lanIP;
        } catch { /* fallback */ }
        const url = `http://${host}:${port}`;
        setHostUrl(url);
        setQrImgUrl(`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`);
    };

    useEffect(() => { loadConfig(); generateQR(); }, []);

    const saveAll = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dashboard: { refreshInterval: parseInt(refreshInterval), theme: dashTheme },
                }),
            });
            const result = await res.json() as { success?: boolean; error?: string };
            if (result.success) showToast(t('mobile.toast.saved'));
            else showToast(result.error || t('toast.error.save'), 'error');
        } catch { showToast(t('toast.error.save'), 'error'); }
    };

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('mobile.label')} title={t('mobile.title')} description={t('mobile.description')} />
                <div class="flex gap-2 shrink-0">
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={loadConfig}>{t('common.restore')}</button>
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer" onClick={saveAll}>{t('common.save')}</button>
                </div>
            </div>
            <TechCard class="mb-5">
                <div class="mb-4">
                    <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('mobile.field.refreshInterval')}</label>
                    <input class="w-[120px] px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                        type="number" min={500} max={10000} step={100}
                        value={refreshInterval}
                        onInput={(e) => setRefreshInterval((e.target as HTMLInputElement).value)} />
                </div>
                <div>
                    <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('mobile.field.defaultTheme')}</label>
                    <select class="w-[160px] px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none appearance-none cursor-pointer focus:border-[var(--brand)] transition-colors"
                        value={dashTheme}
                        onChange={(e) => setDashTheme((e.target as HTMLSelectElement).value)}>
                        {THEMES.map(th => (
                            <option key={th} value={th}>
                                {th.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                            </option>
                        ))}
                    </select>
                </div>
            </TechCard>

            {/* QR Code Pairing */}
            <TechCard class="text-center">
                <div class="section-label mb-5 flex items-center justify-center gap-2">
                    <Smartphone size={16} />
                    {t('mobile.qr.section')}
                </div>
                <div class="text-[var(--text-muted)] text-[13px] mb-3">
                    {t('mobile.qr.hint')}
                </div>
                <div class="inline-block p-4 bg-white">
                    {qrImgUrl && <img src={qrImgUrl} width={160} height={160} alt="QR Code" class="block" />}
                </div>
                {hostUrl && (
                    <div class="mt-2 text-xs text-[var(--text-muted)]">{hostUrl}</div>
                )}
            </TechCard>
        </div>
    );
};
