import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { Brain, Zap, AlertCircle } from 'lucide-preact';
import { showToast, PageHeader, TechCard, TechToggle, ConfirmModal } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';

interface ModelInfo {
    context_length?: number;
    parameter_size?: string;
    family?: string;
    quantization_level?: string;
}

interface ActionLogEntry {
    action: string;
    detail: string;
    result?: string;
    timestamp: string;
}

export const SupervisorPage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState(false);
    const [disableInjects, setDisableInjects] = useState(false);
    const [endpoint, setEndpoint] = useState('http://localhost:11434');
    const [model, setModel] = useState('');
    const [maxActions, setMaxActions] = useState(10);
    const [contextWindow, setContextWindow] = useState(8192);
    const [projectContext, setProjectContext] = useState('');
    const [ollamaOk, setOllamaOk] = useState(false);
    const [models, setModels] = useState<string[]>([]);
    const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
    const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
    const [actionsPerMin, setActionsPerMin] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLoaded = useRef(false);

    const loadAll = async (): Promise<void> => {
        try {
            const [supRes, logRes] = await Promise.all([
                authFetch('/api/admin/supervisor'),
                authFetch('/api/admin/supervisor/logs?limit=20'),
            ]);
            const sup = await supRes.json() as Record<string, unknown>;
            const log = await logRes.json() as { actions: ActionLogEntry[] };

            setEnabled(!!sup.enabled);
            const config = sup.config as Record<string, unknown> | undefined;
            if (config) {
                setEndpoint(config.endpoint as string || 'http://localhost:11434');
                setModel(config.model as string || '');
                setMaxActions(config.maxActionsPerMinute as number || 10);
                setContextWindow(config.contextWindow as number || 8192);
                setProjectContext(config.projectContext as string || '');
                setDisableInjects(!!config.disableInjects);
            }
            setActionsPerMin(sup.actionsThisMinute as number || 0);
            if (sup.ollamaAvailable) setOllamaOk(true);
            if (Array.isArray(sup.ollamaModels) && (sup.ollamaModels as string[]).length > 0) setModels(sup.ollamaModels as string[]);
            if (sup.modelInfo) setModelInfo(sup.modelInfo as ModelInfo);
            setActionLog(log.actions || []);
            setLoaded(true);
            isLoaded.current = true;
        } catch { showToast(t('supervisor.toast.loadError'), 'error'); setLoaded(true); }
    };

    useEffect(() => { loadAll(); }, []);

    const testOllama = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/supervisor/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint, model }),
            });
            const data = await res.json() as { available: boolean; models?: string[]; modelInfo?: ModelInfo };
            setOllamaOk(data.available);
            if (data.models) setModels(data.models);
            if (data.modelInfo) setModelInfo(data.modelInfo);
            showToast(data.available ? t('supervisor.toast.ollamaOk') : t('supervisor.toast.ollamaFail'), data.available ? 'success' : 'error');
        } catch { showToast(t('supervisor.toast.ollamaError'), 'error'); setOllamaOk(false); }
    };

    const autoSave = (overrides?: Record<string, unknown>, silent = false): void => {
        if (!isLoaded.current) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            try {
                await authFetch('/api/admin/supervisor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint, model, maxActionsPerMinute: maxActions, contextWindow, disableInjects, projectContext,
                        ...overrides,
                    }),
                });
                if (!silent) showToast(t('toast.savedAuto'));
            } catch { showToast(t('toast.error.save'), 'error'); }
        }, 800);
    };

    const toggleSupervisor = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/supervisor/toggle', { method: 'POST' });
            const data = await res.json() as { enabled: boolean };
            setEnabled(data.enabled);
            showToast(data.enabled ? t('supervisor.toast.on') : t('supervisor.toast.off'));
        } catch { showToast(t('toast.error'), 'error'); }
    };

    const saveContext = async (): Promise<void> => {
        try {
            await authFetch('/api/admin/supervisor/context', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: projectContext }),
            });
            showToast(t('supervisor.toast.contextSaved'));
        } catch { showToast(t('toast.error.save'), 'error'); }
    };

    const clearHistory = async (): Promise<void> => {
        try {
            await authFetch('/api/admin/supervisor/clear', { method: 'POST' });
            setActionLog([]);
            showToast(t('supervisor.toast.historyCleared'));
        } catch { showToast(t('toast.error'), 'error'); }
    };


    if (!loaded) return <div class="text-[var(--text-muted)]">{t('common.loading')}</div>;

    const maxCtx = modelInfo?.context_length || 32768;

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('supervisor.label')} title={t('supervisor.title')} description={t('supervisor.description')} />
                <div class="flex gap-2 shrink-0">
                    <span class="inline-flex items-center gap-1 px-3 py-1 border border-[var(--brand)] text-[11px] font-mono font-bold uppercase tracking-widest bg-[var(--brand-glow)] text-[var(--brand)]">
                        {t('common.autoSave')}
                    </span>
                </div>
            </div>

            {/* Stat cards */}
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-[1px] bg-[var(--border-color)] border border-[var(--border-color)] mb-5">
                <div class="bg-[var(--surface-color)] p-5 relative">
                    <div class="crosshair"></div>
                    <div class={`stat-number ${enabled ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                        {enabled ? t('common.on') : t('common.off')}
                    </div>
                    <div class="text-xs text-[var(--text-secondary)] mt-1 font-mono uppercase tracking-wider">{t('supervisor.stat.status')}</div>
                </div>
                <div class="bg-[var(--surface-color)] p-5 relative">
                    <div class="crosshair"></div>
                    <div class={`stat-number ${ollamaOk ? 'text-[var(--success)]' : 'text-[var(--text-secondary)]'}`}>
                        {ollamaOk ? 'OK' : '—'}
                    </div>
                    <div class="text-xs text-[var(--text-secondary)] mt-1 font-mono uppercase tracking-wider">{t('supervisor.stat.ollama')}</div>
                </div>
                <div class="bg-[var(--surface-color)] p-5 relative">
                    <div class="crosshair"></div>
                    <div class="stat-number">{actionsPerMin}/{maxActions}</div>
                    <div class="text-xs text-[var(--text-secondary)] mt-1 font-mono uppercase tracking-wider">{t('supervisor.stat.rate')}</div>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                {/* Toggles */}
                <TechCard class="mb-5">
                    <div class="section-label mb-5 flex items-center gap-1.5">
                        <Brain size={14} /> {t('supervisor.section.control')}
                    </div>
                    <TechToggle label={t('supervisor.toggle.enable')} desc={t('supervisor.toggle.enableDesc')} checked={enabled} onChange={toggleSupervisor} />
                    <TechToggle label={t('supervisor.toggle.disableInjects')} desc={t('supervisor.toggle.disableInjectsDesc')} checked={disableInjects} onChange={() => {
                        const next = !disableInjects;
                        setDisableInjects(next);
                        autoSave({ disableInjects: next }, true);
                        showToast(next ? t('supervisor.toast.injectsOff') : t('supervisor.toast.injectsOn'));
                    }} />
                </TechCard>
                {/* Ollama Connection */}
                <TechCard class="mb-5">
                    <div class="section-label mb-5 flex items-center gap-1.5">
                        <Zap size={14} /> {t('supervisor.section.ollama')}
                    </div>
                    <div class="mb-3">
                        <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('supervisor.field.endpoint')}</label>
                        <div class="flex gap-2">
                            <input class="flex-1 px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                                value={endpoint} placeholder="http://localhost:11434"
                                onInput={(e) => { const v = (e.target as HTMLInputElement).value; setEndpoint(v); autoSave({ endpoint: v }); }} />
                            <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer" onClick={testOllama}>{t('common.test')}</button>
                        </div>
                        <div class="text-[11px] text-[var(--text-muted)] mt-1">{t('supervisor.field.endpointHint')}</div>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('supervisor.field.model')}</label>
                        {models.length > 0 ? (
                            <select class="w-full px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors appearance-none cursor-pointer"
                                value={model} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setModel(v); autoSave({ model: v }); }}>
                                <option value="">{t('supervisor.field.modelSelect')}</option>
                                {models.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        ) : (
                            <input class="w-full px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                                value={model} placeholder={t('supervisor.field.modelPlaceholder')}
                                onInput={(e) => { const v = (e.target as HTMLInputElement).value; setModel(v); autoSave({ model: v }); }} />
                        )}
                        <div class="text-[11px] text-[var(--text-muted)] mt-1">{t('supervisor.field.modelHint')}</div>
                    </div>
                    {modelInfo && (
                        <div class="mt-3 text-[11px] text-[var(--text-muted)] grid grid-cols-2 gap-1">
                            {modelInfo.context_length && <div>Context: {modelInfo.context_length.toLocaleString()}</div>}
                            {modelInfo.parameter_size && <div>Params: {modelInfo.parameter_size}</div>}
                            {modelInfo.family && <div>Family: {modelInfo.family}</div>}
                            {modelInfo.quantization_level && <div>Quant: {modelInfo.quantization_level}</div>}
                        </div>
                    )}
                </TechCard>
            </div>

            {/* Sliders */}
            <TechCard class="mb-5">
                <div class="section-label mb-5 flex items-center gap-2">{t('supervisor.section.limits')}</div>
                <div class="mb-4">
                    <div class="flex justify-between mb-1">
                        <label class="text-xs font-semibold text-[var(--text-secondary)]">{t('supervisor.slider.maxActions')}</label>
                        <span class="text-xs font-bold text-[var(--brand)]">{maxActions}</span>
                    </div>
                    <input type="range" min={1} max={60} value={maxActions}
                        class="w-full h-1.5 bg-[var(--surface-color)] appearance-none cursor-pointer accent-[var(--brand)]"
                        onInput={(e) => { const v = parseInt((e.target as HTMLInputElement).value); setMaxActions(v); autoSave({ maxActionsPerMinute: v }); }} />
                    <div class="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5"><span>1</span><span>60</span></div>
                    <div class="text-[11px] text-[var(--text-muted)] mt-1">{t('supervisor.slider.maxActionsHint')}</div>
                </div>
                <div>
                    <div class="flex justify-between mb-1">
                        <label class="text-xs font-semibold text-[var(--text-secondary)]">{t('supervisor.slider.contextWindow')}</label>
                        <span class="text-xs font-bold text-[var(--brand)]">{contextWindow.toLocaleString()}</span>
                    </div>
                    <input type="range" min={2048} max={maxCtx} step={1024} value={contextWindow}
                        class="w-full h-1.5 bg-[var(--surface-color)] appearance-none cursor-pointer accent-[var(--brand)]"
                        onInput={(e) => { const v = parseInt((e.target as HTMLInputElement).value); setContextWindow(v); autoSave({ contextWindow: v }); }} />
                    <div class="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5"><span>2,048</span><span>{maxCtx.toLocaleString()}</span></div>
                    <div class="text-[11px] text-[var(--text-muted)] mt-1">{t('supervisor.slider.contextWindowHint')}</div>
                </div>
            </TechCard>

            {/* Project Context */}
            <TechCard class="mb-5">
                <div class="section-label mb-5 flex items-center gap-2">{t('supervisor.section.projectContext')}</div>
                <textarea class="w-full h-28 px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors resize-y font-[inherit]"
                    placeholder={t('supervisor.projectContext.placeholder')}
                    value={projectContext}
                    onInput={(e) => setProjectContext((e.target as HTMLTextAreaElement).value)} />
                <div class="text-[11px] text-[var(--text-muted)] mt-1 mb-2">{t('supervisor.projectContext.hint')}</div>
                <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer" onClick={saveContext}>{t('supervisor.btn.saveContext')}</button>
            </TechCard>

            {/* Action Log */}
            <TechCard>
                <div class="flex items-center justify-between mb-4">
                    <div class="section-label flex items-center gap-1.5">
                        <AlertCircle size={14} /> {t('supervisor.section.actionLog')}
                    </div>
                    <div class="flex gap-2">
                        <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={loadAll}>{t('common.refresh')}</button>
                        <button class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--error)] hover:border-[var(--error)] hover:bg-[var(--error-muted)] transition-colors cursor-pointer" onClick={() => setConfirmOpen(true)}>{t('supervisor.btn.clearHistory')}</button>
                    </div>
                </div>
                <div class="max-h-[300px] overflow-y-auto">
                    {actionLog.length === 0 ? (
                        <div class="text-[var(--text-muted)] text-[13px]">{t('supervisor.actionLog.empty')}</div>
                    ) : (
                        actionLog.map((entry, i) => (
                            <div key={i} class="terminal-row flex-col items-start gap-1">
                                <div class="flex items-center gap-2">
                                    <span class="text-[11px] text-[var(--text-muted)] shrink-0 w-[60px]">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    <span class={`text-[10px] font-semibold px-1.5 py-0.5 shrink-0
                                        ${entry.action === 'inject' ? 'bg-[var(--brand-glow)] text-[var(--brand)]' : ''}
                                        ${entry.action === 'click' ? 'bg-[var(--success-muted)] text-[var(--success)]' : ''}
                                        ${entry.action === 'notify' ? 'bg-[rgba(251,191,36,0.12)] text-[var(--warning)]' : ''}
                                        ${entry.action === 'error' || entry.action === 'error_recovery' ? 'bg-[var(--error-muted)] text-[var(--error)]' : ''}
                                        ${!['inject', 'click', 'notify', 'error', 'error_recovery'].includes(entry.action) ? 'bg-[var(--surface-color)] text-[var(--text-muted)]' : ''}
                                    `}>{entry.action}</span>
                                </div>
                                <div class="text-[13px] mt-1 text-[var(--text-secondary)]">{entry.detail}</div>
                                {entry.result && <div class="text-[11px] mt-0.5 text-[var(--text-muted)]">→ {entry.result}</div>}
                            </div>
                        ))
                    )}
                </div>
            </TechCard>
            <ConfirmModal
                open={confirmOpen}
                title={t('supervisor.confirm.clearHistory')}
                message={t('supervisor.confirm.clearHistory')}
                confirmLabel={t('common.confirmDelete')}
                cancelLabel={t('common.cancel')}
                variant="danger"
                onConfirm={() => { setConfirmOpen(false); clearHistory(); }}
                onCancel={() => setConfirmOpen(false)}
            />
        </div>
    );
};
