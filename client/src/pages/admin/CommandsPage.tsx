import type { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Zap, Play, X } from 'lucide-preact';
import { showToast, PageHeader, TechCard } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';
interface Command {
    label: string;
    prompt: string;
    icon?: string;
}

export const CommandsPage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [commands, setCommands] = useState<Command[]>([]);

    const loadCommands = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/commands');
            const data = await res.json() as { commands?: Command[] };
            setCommands(data.commands || []);
        } catch { showToast(t('commands.toast.loadError'), 'error'); }
    };

    useEffect(() => { loadCommands(); }, []);

    const saveCommands = async (cmds: Command[]): Promise<void> => {
        try {
            await authFetch('/api/admin/commands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commands: cmds }),
            });
            showToast(t('commands.toast.saved'));
        } catch { showToast(t('toast.error.save'), 'error'); }
    };

    const addCommand = (): void => {
        const next = [...commands, { label: t('commands.defaultLabel'), prompt: t('commands.defaultPrompt'), icon: 'zap' }];
        setCommands(next);
        saveCommands(next);
    };

    const updateCommand = (index: number, field: 'label' | 'prompt', value: string): void => {
        const next = [...commands];
        next[index] = { ...next[index], [field]: value };
        setCommands(next);
        saveCommands(next);
    };

    const removeCommand = (index: number): void => {
        const next = commands.filter((_, i) => i !== index);
        setCommands(next);
        saveCommands(next);
    };

    const runCommand = async (index: number): Promise<void> => {
        const cmd = commands[index];
        if (!cmd) return;
        showToast(t('commands.toast.running') + ' ' + cmd.label + '...');
        try {
            const res = await authFetch('/api/commands/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: cmd.prompt }),
            });
            const result = await res.json() as { success?: boolean; error?: string };
            showToast(result.success ? cmd.label + ' ' + t('commands.toast.sent') : (result.error || t('toast.error')), result.success ? 'success' : 'error');
        } catch { showToast(t('commands.toast.execError'), 'error'); }
    };

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('commands.label')} title={t('commands.title')} description={t('commands.description')} />
                <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer" onClick={addCommand}>{t('commands.btn.add')}</button>
            </div>
            <div>
                {commands.length === 0 ? (
                    <TechCard class="text-[var(--text-muted)]">
                        {t('commands.empty')}
                    </TechCard>
                ) : (
                    commands.map((cmd, i) => (
                        <TechCard key={i} class="mb-4 !p-4">
                            <div class="flex items-center gap-4">
                                <Zap size={24} class="shrink-0 text-[var(--brand)] opacity-70" />
                                <div class="flex-1 min-w-0">
                                    <input class="w-full px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none mb-2 focus:border-[var(--brand)] transition-colors"
                                        value={cmd.label} placeholder={t('commands.placeholder.label')}
                                        onChange={(e) => updateCommand(i, 'label', (e.target as HTMLInputElement).value)} />
                                    <input class="w-full px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                                        value={cmd.prompt} placeholder={t('commands.placeholder.prompt')}
                                        onChange={(e) => updateCommand(i, 'prompt', (e.target as HTMLInputElement).value)} />
                                </div>
                                <div class="flex gap-2 shrink-0">
                                    <button class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer" onClick={() => runCommand(i)}>
                                        <Play size={14} /> {t('common.run')}
                                    </button>
                                    <button class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--error)] hover:border-[var(--error)] hover:bg-red-500/10 transition-colors cursor-pointer" onClick={() => removeCommand(i)}>
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>
                        </TechCard>
                    ))
                )}
            </div>
        </div>
    );
};
