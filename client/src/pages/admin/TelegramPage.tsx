import type { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { FlaskConical } from 'lucide-preact';
import { showToast, PageHeader, TechCard, TechToggle } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';
export const TelegramPage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState(false);
    const [token, setToken] = useState('');
    const [chatId, setChatId] = useState('');
    const [topicId, setTopicId] = useState('');
    const [onComplete, setOnComplete] = useState(true);
    const [onError, setOnError] = useState(true);
    const [onInputNeeded, setOnInputNeeded] = useState(true);

    const loadConfig = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/config');
            const data = await res.json() as { config?: Record<string, unknown> };
            const c = (data.config || data) as Record<string, unknown>;
            const tg = c.telegram as {
                enabled?: boolean; botToken?: string; chatId?: string; topicId?: string;
                notifications?: { onComplete?: boolean; onError?: boolean; onInputNeeded?: boolean };
            } | undefined;
            if (tg) {
                setEnabled(!!tg.enabled);
                setToken(tg.botToken || '');
                setChatId(tg.chatId || '');
                setTopicId(tg.topicId || '');
                const n = tg.notifications || {};
                setOnComplete(n.onComplete !== false);
                setOnError(n.onError !== false);
                setOnInputNeeded(n.onInputNeeded !== false);
            }
        } catch { showToast(t('toast.error.load'), 'error'); }
    };

    useEffect(() => { loadConfig(); }, []);

    const toggleEnabled = async (): Promise<void> => {
        try {
            const next = !enabled;
            setEnabled(next);
            await authFetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegram: { enabled: next } }),
            });
            showToast(next ? t('telegram.toast.botOn') : t('telegram.toast.botOff'));
        } catch { showToast(t('telegram.toast.updateError'), 'error'); }
    };

    const saveAll = async (): Promise<void> => {
        try {
            await authFetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram: {
                        enabled, botToken: token, chatId, topicId,
                        notifications: { onComplete, onError, onInputNeeded },
                    },
                }),
            });
            showToast(t('telegram.toast.saved'));
        } catch { showToast(t('toast.error.save'), 'error'); }
    };

    const testMessage = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/telegram/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId, topicId }),
            });
            const result = await res.json() as { success?: boolean; error?: string };
            showToast(result.success ? t('telegram.toast.testSuccess') : (result.error || t('telegram.toast.testError')), result.success ? 'success' : 'error');
        } catch { showToast(t('toast.error.network'), 'error'); }
    };


    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('telegram.label')} title={t('telegram.title')} description={t('telegram.description')} />
                <div class="flex gap-2">
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={loadConfig}>{t('common.restore')}</button>
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer" onClick={saveAll}>{t('common.save')}</button>
                </div>
            </div>

            <TechCard class="mb-5">
                <TechToggle label={t('telegram.toggle.enable')} desc={t('telegram.toggle.enableDesc')} checked={enabled} onChange={() => toggleEnabled()} />

                <div class={`mt-4 transition-opacity ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                    <div class="mb-4">
                        <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('telegram.field.tokenLabel')}</label>
                        <input class="w-full px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                            type="password" placeholder="123456:ABC-DEF..." value={token}
                            onInput={(e) => setToken((e.target as HTMLInputElement).value)} />
                        <div class="text-[11px] text-[var(--text-muted)] mt-1">{t('telegram.field.tokenHint')}</div>
                    </div>
                    <div class="mb-4">
                        <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('telegram.field.chatIdLabel')}</label>
                        <input class="w-full px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                            placeholder={t('telegram.field.chatIdPlaceholder')} value={chatId}
                            onInput={(e) => setChatId((e.target as HTMLInputElement).value)} />
                        <div class="text-[11px] text-[var(--text-muted)] mt-1">{t('telegram.field.chatIdHint')}</div>
                    </div>
                    <div class="mb-4">
                        <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('telegram.field.topicIdLabel')}</label>
                        <input class="w-full px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                            placeholder={t('telegram.field.topicIdPlaceholder')} value={topicId}
                            onInput={(e) => setTopicId((e.target as HTMLInputElement).value)} />
                        <div class="text-[11px] text-[var(--text-muted)] mt-1">{t('telegram.field.topicIdHint')}</div>
                    </div>

                    <TechToggle label={t('telegram.notify.complete')} desc={t('telegram.notify.completeDesc')} checked={onComplete} onChange={setOnComplete} />
                    <TechToggle label={t('telegram.notify.error')} desc={t('telegram.notify.errorDesc')} checked={onError} onChange={setOnError} />
                    <TechToggle label={t('telegram.notify.input')} desc={t('telegram.notify.inputDesc')} checked={onInputNeeded} onChange={() => setOnInputNeeded(!onInputNeeded)} />
                </div>
            </TechCard>

            <button class={`inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer ${!enabled ? 'opacity-50 pointer-events-none' : ''}`} onClick={testMessage}>
                <FlaskConical size={14} /> {t('telegram.btn.testMessage')}
            </button>
        </div>
    );
};
