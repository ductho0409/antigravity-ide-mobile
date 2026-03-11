import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { showToast, PageHeader, TechCard } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';
export const ServerPage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [port, setPort] = useState('3333');
    const [pin, setPin] = useState('');
    const [authEnabled, setAuthEnabled] = useState(false);
    const [hasSavedPin, setHasSavedPin] = useState(false);
    const pinTouched = useRef(false);
    const loaded = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadConfig = async (): Promise<void> => {
        try {
            const [configRes, statusRes] = await Promise.all([
                authFetch('/api/admin/config'),
                authFetch('/api/admin/status'),
            ]);
            const config = await configRes.json() as { config?: Record<string, unknown> };
            const status = await statusRes.json() as { authEnabled?: boolean };
            const c = (config.config || config) as Record<string, unknown>;
            const server = c.server as { port?: number; pin?: string } | undefined;
            setPort(String(server?.port || 3333));
            setHasSavedPin(!!server?.pin);
            setAuthEnabled(!!status.authEnabled);
            pinTouched.current = false;
            setPin('');
            setTimeout(() => { loaded.current = true; }, 100);
        } catch { showToast(t('toast.error.load'), 'error'); }
    };

    useEffect(() => { loadConfig(); }, []);

    const doAutoSave = useCallback(async (portVal: string, pinVal: string): Promise<void> => {
        const body: Record<string, unknown> = {
            server: { port: parseInt(portVal) || 3333 },
        };
        if (pinTouched.current && pinVal.trim()) {
            (body.server as Record<string, unknown>).pin = pinVal.trim();
        } else if (pinTouched.current && !pinVal.trim()) {
            (body.server as Record<string, unknown>).pin = '';
        }
        try {
            const res = await authFetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const result = await res.json() as { success?: boolean; error?: string };
            if (result.success) showToast(t('toast.saved'));
            else showToast(result.error || t('toast.error.save'), 'error');
        } catch { showToast(t('toast.error.save'), 'error'); }
    }, []);

    useEffect(() => {
        if (!loaded.current) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { doAutoSave(port, pin); }, 800);
        return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    }, [port, pin, doAutoSave]);

    const saveAll = async (): Promise<void> => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        doAutoSave(port, pin);
    };

    const clearPin = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/pin', { method: 'DELETE' });
            const result = await res.json() as { success?: boolean };
            if (result.success) {
                showToast(t('server.toast.pinCleared'));
                setPin('');
                pinTouched.current = false;
                setAuthEnabled(false);
                setHasSavedPin(false);
            }
        } catch { showToast(t('server.toast.pinClearError'), 'error'); }
    };

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('server.label')} title={t('server.title')} description={t('server.description')} />
                <div class="flex gap-2">
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={loadConfig}>{t('common.restore')}</button>
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer" onClick={saveAll}>{t('common.save')}</button>
                </div>
            </div>

            <TechCard class="mb-5">
                <div class="section-label mb-5">{t('server.http.section')}</div>
                <div class="mb-4">
                    <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('server.http.portLabel')}</label>
                    <input class="w-[120px] px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                        type="number" value={port} min={1000} max={65535}
                        onInput={(e) => setPort((e.target as HTMLInputElement).value)} />
                    <div class="text-[11px] text-[var(--text-muted)] mt-1">{t('server.http.portHint')}</div>
                </div>
            </TechCard>

            <TechCard>
                <div class="section-label mb-5">{t('server.pin.section')}</div>
                <div class="mb-4">
                    <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('server.pin.label')}</label>
                    <div class="flex items-center gap-2">
                        <input class="w-[160px] px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors tracking-[0.3em] text-center"
                            type="password" maxLength={6} placeholder={authEnabled ? '••••••' : t('server.pin.placeholder')} value={pin}
                            onInput={(e) => {
                                const val = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
                                setPin(val);
                                pinTouched.current = true;
                            }} />
                        {authEnabled && (
                            <button class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--error)] hover:border-[var(--error)] hover:bg-red-500/10 transition-colors cursor-pointer" onClick={clearPin}>{t('server.pin.clear')}</button>
                        )}
                    </div>
                </div>
                <div class="text-[13px]">
                    {authEnabled ? (
                        <span class="text-[var(--success)] font-semibold">{t('server.pin.active')}</span>
                    ) : hasSavedPin ? (
                        <span class="text-[var(--text-muted)]">{t('server.pin.savedInactive')}</span>
                    ) : (
                        <span class="text-[var(--text-muted)]">{t('server.pin.notSet')}</span>
                    )}
                </div>
            </TechCard>
        </div>
    );
};
