import type { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { X } from 'lucide-preact';
import { showToast, PageHeader, TechCard } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';
interface Device {
    name: string;
    cdpPort: number;
    active: boolean;
}

export const DevicesPage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [devices, setDevices] = useState<Device[]>([]);
    const [newName, setNewName] = useState('');
    const [newPort, setNewPort] = useState('');

    const loadDevices = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/devices');
            const data = await res.json() as { devices?: Device[] };
            setDevices(data.devices || []);
        } catch { showToast(t('devices.toast.loadError'), 'error'); }
    };

    useEffect(() => { loadDevices(); }, []);

    const addDevice = async (): Promise<void> => {
        if (!newName.trim() || !newPort.trim()) { showToast(t('devices.toast.inputRequired'), 'error'); return; }
        try {
            const res = await authFetch('/api/admin/devices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim(), cdpPort: parseInt(newPort), active: false }),
            });
            const result = await res.json() as { success?: boolean; error?: string };
            if (result.success) { showToast(t('devices.toast.added')); setNewName(''); setNewPort(''); loadDevices(); }
            else showToast(result.error || t('toast.error'), 'error');
        } catch { showToast(t('toast.error.network'), 'error'); }
    };

    const switchDevice = async (port: number): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/devices/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cdpPort: port }),
            });
            const result = await res.json() as { success?: boolean; active?: { name: string }; error?: string };
            if (result.success) { showToast(t('devices.toast.switched') + ' ' + (result.active?.name || '')); loadDevices(); }
            else showToast(result.error || t('toast.error'), 'error');
        } catch { showToast(t('toast.error.network'), 'error'); }
    };

    const deleteDevice = async (port: number): Promise<void> => {
        try {
            const res = await authFetch(`/api/admin/devices/${port}`, { method: 'DELETE' });
            const result = await res.json() as { success?: boolean; error?: string };
            if (result.success) { showToast(t('devices.toast.deleted')); loadDevices(); }
            else showToast(result.error || t('toast.error'), 'error');
        } catch { showToast(t('toast.error.network'), 'error'); }
    };

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('devices.label')} title={t('devices.title')} description={t('devices.description')} />
            </div>
            <TechCard>
                <div class="section-label mb-5">{t('devices.section.connected')}</div>
                <div class="mb-4">
                    {devices.length === 0 ? (
                        <div class="text-[var(--text-muted)]">{t('common.loading')}</div>
                    ) : (
                        devices.map(d => (
                            <div key={d.cdpPort} class="terminal-row flex justify-between items-center">
                                <div>
                                    <div class="font-semibold flex items-center gap-1.5">
                                        <span class={`w-2 h-2 ${d.active ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'}`} />
                                        {d.name}
                                    </div>
                                    <div class="text-xs text-[var(--text-muted)]">Port {d.cdpPort} {d.active ? '— ' + t('devices.active') : ''}</div>
                                </div>
                                <div class="flex gap-1">
                                    {!d.active && (
                                        <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={() => switchDevice(d.cdpPort)}>{t('common.activate')}</button>
                                    )}
                                    <button class="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase border border-[var(--border-color)] text-[var(--error)] hover:border-[var(--error)] hover:bg-red-500/10 transition-colors cursor-pointer" onClick={() => deleteDevice(d.cdpPort)}>
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div class="border-t border-[var(--border-color)] mt-6 pt-6">
                    <div class="section-label mb-5">{t('devices.section.addNew')}</div>
                    <div class="flex gap-2 items-end flex-wrap">
                        <div>
                            <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('devices.field.name')}</label>
                            <input class="w-[160px] px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                                type="text" value={newName} placeholder="My Antigravity"
                                onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('devices.field.port')}</label>
                            <input class="w-[100px] px-3 py-2 bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-mono outline-none focus:border-[var(--brand)] transition-colors"
                                type="number" value={newPort} placeholder="9223" min={1000} max={65535}
                                onInput={(e) => setNewPort((e.target as HTMLInputElement).value)} />
                        </div>
                        <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-[#000] transition-colors cursor-pointer" onClick={addDevice}>{t('common.add')}</button>
                    </div>
                </div>
            </TechCard>
        </div>
    );
};
