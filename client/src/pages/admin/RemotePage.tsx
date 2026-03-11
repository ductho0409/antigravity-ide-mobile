import type { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Globe, Shield, Copy, ExternalLink, AlertTriangle, Lock, Key, Monitor } from 'lucide-preact';
import { showToast, copyToClipboard, PageHeader, TechCard, TechToggle } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';

interface TunnelStatus {
    mode: string | null;
    status: string;
    url: string | null;
    error: string | null;
    pid: number | null;
    startedAt: number | null;
    running?: boolean;
    starting?: boolean;
    autoStart?: boolean;
    configMode?: string;
    namedTunnel?: { available: boolean; hostname?: string; reason?: string };
}

export const RemotePage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
    const [mode, setMode] = useState<'quick' | 'named'>('quick');
    const [hasPin, setHasPin] = useState(false);
    const [loading, setLoading] = useState(false);

    // Preview tunnel state
    interface PreviewTunnel {
        tunnelId: string;
        url: string | null;
        status: string;
        port: number | null;
        startedAt: number | null;
    }
    const [previews, setPreviews] = useState<PreviewTunnel[]>([]);
    const [previewPort, setPreviewPort] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const loadTunnel = async (): Promise<void> => {
        try {
            const [tunnelRes, statusRes, previewRes] = await Promise.all([
                authFetch('/api/admin/tunnel'),
                authFetch('/api/admin/status'),
                authFetch('/api/admin/preview'),
            ]);
            const td = await tunnelRes.json() as TunnelStatus;
            const sd = await statusRes.json() as { authEnabled?: boolean };
            const pd = await previewRes.json() as { previews: PreviewTunnel[]; lastPort?: number; autoStart?: boolean };
            setTunnel(td);
            setMode((td.configMode as 'quick' | 'named') || (td.mode as 'quick' | 'named') || 'quick');
            setHasPin(!!sd.authEnabled);
            setPreviews(pd.previews || []);
            if (pd.lastPort && !previewPort) setPreviewPort(String(pd.lastPort));
        } catch { showToast(t('remote.toast.loadError'), 'error'); }
    };

    useEffect(() => { loadTunnel(); }, []);

    const startTunnel = async (): Promise<void> => {
        setLoading(true);
        try {
            const res = await authFetch('/api/admin/tunnel/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode }),
            });
            const data = await res.json() as { success?: boolean; url?: string; error?: string };
            if (data.success) {
                showToast(t('remote.toast.tunnelOn'));
                setTimeout(loadTunnel, 2000);
            } else showToast(data.error || t('remote.toast.tunnelStartError'), 'error');
        } catch { showToast(t('toast.error.network'), 'error'); }
        setLoading(false);
    };

    const stopTunnel = async (): Promise<void> => {
        try {
            await authFetch('/api/admin/tunnel/stop', { method: 'POST' });
            showToast(t('remote.toast.tunnelOff'));
            loadTunnel();
        } catch { showToast(t('toast.error'), 'error'); }
    };

    const setTunnelMode = async (m: 'quick' | 'named'): Promise<void> => {
        setMode(m);
        try {
            await authFetch('/api/admin/tunnel/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: m }),
            });
        } catch { /* ignore */ }
    };

    const toggleAutoStart = async (): Promise<void> => {
        try {
            await authFetch('/api/admin/tunnel/auto-start', { method: 'POST' });
            showToast(t('remote.toast.autoStartUpdated'));
            loadTunnel();
        } catch { showToast(t('toast.error'), 'error'); }
    };

    const isActive = tunnel?.running || tunnel?.status === 'active';
    const qrUrl = tunnel?.url ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(tunnel.url)}` : '';

    const startPreview = async (): Promise<void> => {
        const port = parseInt(previewPort, 10);
        if (!port || port < 1 || port > 65535) {
            showToast(t('preview.toast.invalidPort'), 'error');
            return;
        }
        setPreviewLoading(true);
        try {
            const res = await authFetch('/api/admin/preview/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ port }),
            });
            const data = await res.json() as { success?: boolean; url?: string; error?: string };
            if (data.success) {
                showToast(t('preview.toast.started'));
                await loadTunnel();
            } else showToast(data.error || t('preview.toast.startError'), 'error');
        } catch { showToast(t('toast.error.network'), 'error'); }
        setPreviewLoading(false);
    };

    const stopPreview = async (port: number): Promise<void> => {
        try {
            await authFetch('/api/admin/preview/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ port }),
            });
            showToast(t('preview.toast.stopped'));
            loadTunnel();
        } catch { showToast(t('toast.error'), 'error'); }
    };

    const stopAllPreviews = async (): Promise<void> => {
        try {
            await authFetch('/api/admin/preview/stop-all', { method: 'POST' });
            showToast(t('preview.toast.allStopped'));
            loadTunnel();
        } catch { showToast(t('toast.error'), 'error'); }
    };

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('remote.label')} title={t('remote.title')} description={t('remote.description')} />
            </div>

            {/* PIN Warning */}
            {!hasPin && (
                <div class="flex items-center gap-2.5 bg-[var(--error-muted)] border border-[rgba(239,68,68,0.2)] p-4 mb-5 text-[var(--error)] text-[13px]">
                    <AlertTriangle size={18} class="shrink-0" />
                    <div>
                        <strong>{t('remote.warning.label')}</strong> {t('remote.warning.noPin')}
                        <a href="#server" class="text-[var(--accent)] ml-1 underline">{t('remote.warning.noPinLink')}</a> {t('remote.warning.noPinSuffix')}
                    </div>
                </div>
            )}

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                {/* Tunnel Control */}
                <TechCard>
                    <div class="section-label mb-5 flex items-center gap-1.5">
                        <Globe size={14} /> {t('remote.section.tunnel')}
                    </div>
                    <div class="flex items-center justify-between mb-4">
                        <span class="text-[13px] font-medium">{t('common.status')}</span>
                        <span class={`flex items-center gap-1.5 text-xs font-semibold ${isActive ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                            <span class={`w-[7px] h-[7px] rounded-full ${isActive ? 'bg-[var(--success)] shadow-[0_0_6px_var(--success)]' : 'bg-[var(--error)]'}`} />
                            {isActive ? t('remote.status.running') : tunnel?.starting ? t('remote.status.starting') : t('remote.status.off')}
                        </span>
                    </div>

                    <div class="mb-4">
                        <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('common.mode')}</label>
                        <div class="flex gap-2">
                            <button class={`px-3 py-1.5 text-xs font-mono font-bold border cursor-pointer transition-all ${mode === 'quick' ? 'bg-[var(--brand)] text-[#000] border-[var(--brand)]' : 'bg-[var(--surface-color)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--brand)]'}`} onClick={() => setTunnelMode('quick')}>
                                {t('remote.mode.quick')}
                                <div class="text-[10px] opacity-60 mt-0.5">{t('remote.mode.quickDesc')}</div>
                            </button>
                            <button class={`px-3 py-1.5 text-xs font-mono font-bold border cursor-pointer transition-all ${mode === 'named' ? 'bg-[var(--brand)] text-[#000] border-[var(--brand)]' : 'bg-[var(--surface-color)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--brand)]'}`} onClick={() => setTunnelMode('named')}>
                                {t('remote.mode.named')} {tunnel?.namedTunnel?.available ? '' : '(N/A)'}
                                <div class="text-[10px] opacity-60 mt-0.5">{t('remote.mode.namedDesc')}</div>
                            </button>
                        </div>
                    </div>

                    {/* Named Tunnel Info */}
                    {mode === 'named' && tunnel?.namedTunnel && (
                        <div class="p-3 bg-[var(--surface-color)] border border-[var(--border-color)] mb-4 text-[13px]">
                            {tunnel.namedTunnel.available
                                ? <><span class="text-[var(--success)]">✅</span> <strong>{t('remote.mode.namedConfigured')}</strong><br /><code class="text-[var(--accent)]">{tunnel.namedTunnel.hostname}</code></>
                                : <><span class="text-[var(--error)]">❌</span> <strong>{t('remote.mode.namedNotConfigured')}</strong>{tunnel.namedTunnel.reason && <><br /><span class="text-[var(--text-muted)] text-[12px]">{tunnel.namedTunnel.reason}</span></>}</>
                            }
                        </div>
                    )}

                    <div class="flex gap-2">
                        {!isActive ? (
                            <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer disabled:opacity-50" onClick={startTunnel} disabled={loading || (!hasPin && !isActive)}>
                                {loading ? t('remote.btn.starting') : t('remote.btn.start')}
                            </button>
                        ) : (
                            <button class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--error)] hover:border-[var(--error)] hover:bg-[var(--error-muted)] transition-colors cursor-pointer" onClick={stopTunnel}>{t('remote.btn.stop')}</button>
                        )}
                    </div>

                    <TechToggle label={t('remote.toggle.autoStart')} desc={t('remote.toggle.autoStartDesc')} checked={!!tunnel?.autoStart} onChange={toggleAutoStart} />
                </TechCard>

                {/* Tunnel URL */}
                <TechCard>
                    <div class="section-label mb-5 flex items-center gap-2">{t('remote.section.publicUrl')}</div>
                    {tunnel?.url ? (
                        <div>
                            <div class="flex items-center gap-2 mb-3 bg-[var(--surface-color)] border border-[var(--border-color)] p-3">
                                <span class="flex-1 text-[13px] text-[var(--accent)] truncate font-mono">{tunnel.url}</span>
                                <button class="shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--accent)] cursor-pointer" onClick={() => copyToClipboard(tunnel.url!)}>
                                    <Copy size={14} /> <span class="text-[11px]">{t('common.copy')}</span>
                                </button>
                                <a class="shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--accent)]" href={tunnel.url} target="_blank">
                                    <ExternalLink size={14} />
                                </a>
                            </div>
                            {qrUrl && (
                                <div class="text-center">
                                    <div class="inline-block p-4 bg-white">
                                        <img src={qrUrl} width={200} height={200} alt="QR Code" class="block" />
                                    </div>
                                    <div class="text-[11px] text-[var(--text-muted)] mt-2">{t('remote.url.scanQr')}</div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div class="text-[var(--text-muted)] text-[13px]">
                            {isActive ? t('remote.url.waiting') : t('remote.url.startHint')}
                        </div>
                    )}
                    {tunnel?.error && (
                        <div class="mt-3 text-xs text-[var(--error)] bg-[var(--error-muted)] p-2">{tunnel.error}</div>
                    )}
                </TechCard>
            </div>

            {/* Dev Preview Tunnel */}
            <div class="grid grid-cols-1 gap-3 mb-5">
                <TechCard>
                    <div class="flex items-center justify-between mb-5">
                        <div class="section-label flex items-center gap-1.5">
                            <Monitor size={14} /> {t('preview.section.title')}
                            <span class="ml-2 px-1.5 py-0.5 text-[10px] bg-[var(--border-color)] text-[var(--text-secondary)] rounded-full">
                                {previews.length}
                            </span>
                        </div>
                        {previews.length > 1 && (
                            <button
                                class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--error)] hover:border-[var(--error)] hover:bg-[var(--error-muted)] transition-colors cursor-pointer"
                                onClick={stopAllPreviews}
                            >
                                {t('preview.btn.stopAll')}
                            </button>
                        )}
                    </div>

                    <div class="flex items-center gap-2.5 bg-[var(--error-muted)] border border-[rgba(239,68,68,0.2)] p-4 mb-5 text-[var(--error)] text-[13px]">
                        <AlertTriangle size={18} class="shrink-0" />
                        <div>{t('preview.warning.public')}</div>
                    </div>

                    <div class="flex flex-col sm:flex-row gap-3 items-end mb-6 border-b border-[var(--border-color)] pb-6">
                        <div class="w-full sm:flex-1">
                            <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('preview.field.port')}</label>
                            <input
                                type="number"
                                class="w-full px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                                placeholder={t('preview.field.portPlaceholder')}
                                value={previewPort}
                                onInput={(e) => setPreviewPort((e.target as HTMLInputElement).value)}
                                min={1}
                                max={65535}
                            />
                        </div>
                        <button
                            class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer disabled:opacity-50 h-[38px]"
                            onClick={startPreview}
                            disabled={previewLoading || !previewPort}
                        >
                            {previewLoading ? t('remote.btn.starting') : t('preview.btn.addPreview')}
                        </button>
                    </div>

                    <div class="text-xs font-semibold text-[var(--text-secondary)] mb-3">{t('preview.list.title')}</div>
                    
                    {previews.length > 0 ? (
                        <div class="space-y-3">
                            {previews.map(p => {
                                const qrUrl = p.url ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(p.url)}` : '';
                                const isActive = p.status === 'active';
                                
                                return (
                                    <div key={p.tunnelId} class="border border-[var(--border-color)] bg-[var(--surface-color)] p-4">
                                        <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-3">
                                            <div class="flex items-center gap-3">
                                                <span class={`flex items-center gap-1.5 text-xs font-semibold ${isActive ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>
                                                    <span class={`w-[7px] h-[7px] rounded-full ${isActive ? 'bg-[var(--success)] shadow-[0_0_6px_var(--success)]' : 'bg-[var(--border-color)]'}`} />
                                                    Port {p.port}
                                                </span>
                                                <span class="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">{p.status}</span>
                                            </div>
                                            <button 
                                                class="inline-flex items-center justify-center px-3 py-1 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--error)] hover:border-[var(--error)] hover:bg-[var(--error-muted)] transition-colors cursor-pointer" 
                                                onClick={() => p.port && stopPreview(p.port)}
                                            >
                                                {t('remote.btn.stop')}
                                            </button>
                                        </div>
                                        
                                        {p.url && (
                                            <div class="flex flex-col sm:flex-row gap-4">
                                                <div class="flex-1 min-w-0">
                                                    <div class="flex items-center gap-2 bg-[#00000020] border border-[var(--border-color)] p-2.5 mb-2">
                                                        <span class="flex-1 text-[13px] text-[var(--accent)] truncate font-mono">{p.url}</span>
                                                        <button class="shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--accent)] cursor-pointer" onClick={() => copyToClipboard(p.url!)}>
                                                            <Copy size={14} />
                                                        </button>
                                                        <a class="shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--accent)]" href={p.url} target="_blank" rel="noreferrer">
                                                            <ExternalLink size={14} />
                                                        </a>
                                                    </div>
                                                </div>
                                                <div class="shrink-0">
                                                    <div class="inline-block p-2 bg-white">
                                                        <img src={qrUrl} width={150} height={150} alt="QR Code" class="block" />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div class="text-[var(--text-muted)] text-[13px] py-4 text-center border border-dashed border-[var(--border-color)]">
                            {t('preview.list.empty')}
                        </div>
                    )}
                </TechCard>
            </div>
            {/* Security Info */}
            <TechCard class="mb-5">
                <div class="section-label mb-5 flex items-center gap-1.5">
                    <Shield size={14} /> {t('remote.section.security')}
                </div>
                <div class="text-[13px] text-[var(--text-secondary)] space-y-3">
                    <div class="flex items-start gap-2.5">
                        <Lock size={16} class="shrink-0 mt-0.5" />
                        <div><strong>{t('remote.security.encryption')}</strong> — {t('remote.security.encryptionDesc')}</div>
                    </div>
                    <div class="flex items-start gap-2.5">
                        <Key size={16} class="shrink-0 mt-0.5" />
                        <div><strong>{t('remote.security.randomUrl')}</strong> — {t('remote.security.randomUrlDesc')}</div>
                    </div>
                    <div class="flex items-start gap-2.5">
                        <Shield size={16} class="shrink-0 mt-0.5" />
                        <div><strong>{t('remote.security.rateLimit')}</strong> — {t('remote.security.rateLimitDesc')}</div>
                    </div>
                    <div class="flex items-start gap-2.5">
                        <Lock size={16} class="shrink-0 mt-0.5" />
                        <div><strong>{t('remote.security.pinRequired')}</strong> — {t('remote.security.pinRequiredDesc')}</div>
                    </div>
                </div>
            </TechCard>

            {/* Installation Help — show when cloudflared not found */}
            {!isActive && tunnel?.error?.includes('not found') && (
                <TechCard>
                    <div class="section-label mb-5 flex items-center gap-2">{t('remote.section.install')}</div>
                    <div class="text-[13px] text-[var(--text-secondary)] space-y-3">
                        <div>
                            <div class="font-semibold mb-1">Windows:</div>
                            <code class="block px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-xs font-mono">winget install --id Cloudflare.cloudflared</code>
                        </div>
                        <div>
                            <div class="font-semibold mb-1">macOS:</div>
                            <code class="block px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-xs font-mono">brew install cloudflared</code>
                        </div>
                        <div>
                            <div class="font-semibold mb-1">Linux:</div>
                            <code class="block px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-xs font-mono break-all">curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared</code>
                        </div>
                    </div>
                </TechCard>
            )}
        </div>
    );
};
