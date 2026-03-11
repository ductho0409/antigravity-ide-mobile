import type { FunctionalComponent, ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { AlertTriangle } from 'lucide-preact';
// ============================================================================
// Admin Shared Utilities — Toast, Clipboard, Theme, Types
// ============================================================================

// ─── Toast Notification System ──────────────────────────────────────
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, type: 'success' | 'error' = 'success'): void {
    let container = document.getElementById('toast');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast';
        container.className = 'toast';
        document.body.appendChild(container);
    }

    const icon = type === 'success'
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>';

    container.innerHTML = icon + '<span>' + message + '</span>';
    container.className = `toast ${type} show`;

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        if (container) container.className = `toast ${type}`;
    }, 2500);
}

// ─── Clipboard Utility ──────────────────────────────────────────────
export async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        showToast('URL copied!');
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('URL copied!');
    }
}

// ─── Theme Toggle ───────────────────────────────────────────────────
export function toggleTheme(): void {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('admin-theme', 'light');
    } else {
        document.documentElement.classList.add('dark');
        localStorage.setItem('admin-theme', 'dark');
    }
}

export function restoreTheme(): void {
    const saved = localStorage.getItem('admin-theme') || 'dark';
    if (saved === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

// ─── Status Types ───────────────────────────────────────────────────
export interface AdminStatus {
    cdpConnected: boolean;
    telegramActive: boolean;
    uptime: string;
    activeClients: number;
    port: number;
    memory: string;
    authEnabled: boolean;
    lanIP: string;
    node: string;
    version: string;
}

export interface AdminConfig {
    server?: { port?: number; pin?: string };
    telegram?: {
        enabled?: boolean;
        botToken?: string;
        chatId?: string;
        topicId?: string;
        notifications?: {
            onComplete?: boolean;
            onError?: boolean;
            onInputNeeded?: boolean;
        };
    };
    dashboard?: { refreshInterval?: number; theme?: string };
    autoAcceptCommands?: boolean;
    mobileUI?: {
        showQuickActions?: boolean;
        navigationMode?: 'sidebar' | 'topbar' | 'bottombar';
    };
    supervisor?: {
        showAssistTab?: boolean;
    };
}


export const TechCard: FunctionalComponent<{ class?: string; children: ComponentChildren }> = ({ class: className, children }) => (
    <div class={`tech-card p-8 ${className || ''}`}>
        <div class="bracket bracket-tl"></div>
        <div class="bracket bracket-tr"></div>
        <div class="bracket bracket-bl"></div>
        <div class="bracket bracket-br"></div>
        {children}
    </div>
);

export const TechToggle: FunctionalComponent<{
    checked: boolean;
    onChange: ((v: boolean) => void) | (() => void);
    label?: string;
    desc?: string;
}> = ({ checked, onChange, label, desc }) => (
    <div class={`flex items-center justify-between ${label ? 'pb-6 border-b border-[var(--border-color)] last:border-b-0 last:pb-0' : ''}`}>
        {label && (
            <div>
                <div class="font-bold text-lg mb-1">{label}</div>
                {desc && <div class="text-[13px] text-[var(--text-secondary)]">{desc}</div>}
            </div>
        )}
        <div
            class={`tech-toggle ${checked ? 'on' : ''}`}
            onClick={() => (onChange as (v: boolean) => void)(!checked)}
        ></div>
    </div>
);

export const PageHeader: FunctionalComponent<{
    label: string;
    title: string;
    description?: string;
}> = ({ label, title, description }) => (
    <div class="mb-12">
        <div class="font-mono text-[10px] font-bold tracking-[0.2em] text-[var(--brand)] mb-6 flex items-center gap-2 uppercase">
            <span class="w-1.5 h-1.5 bg-[var(--brand)] inline-block"></span> {label}
        </div>
        <h1 class="font-display text-3xl md:text-4xl font-bold uppercase tracking-tight mb-4">{title}</h1>
        {description && <p class="text-lg text-[var(--text-secondary)] max-w-2xl font-light">{description}</p>}
    </div>
);

export const SectionLabel: FunctionalComponent<{ children: ComponentChildren }> = ({ children }) => (
    <div class="section-label mb-4">{children}</div>
);


export const ConfirmModal: FunctionalComponent<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: 'danger' | 'default';
}> = ({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, variant = 'default' }) => {
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, onCancel]);

    if (!open) return null;

    const Icon = variant === 'danger' ? <AlertTriangle class="w-10 h-10 mb-6 text-[var(--color-error)] drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]" /> : null;

    return (
        <div class="confirm-backdrop" onClick={onCancel}>
            <div class={`confirm-modal ${variant}`} onClick={e => e.stopPropagation()}>
                <div class="bracket bracket-tl"></div>
                <div class="bracket bracket-tr"></div>
                <div class="bracket bracket-bl"></div>
                <div class="bracket bracket-br"></div>
                {Icon}
                <h2 class={`font-display text-2xl uppercase tracking-tight mb-2 ${variant === 'danger' ? 'text-[var(--color-error)]' : 'text-[var(--brand)]'}`}>{title}</h2>
                <p class="text-[13px] text-[var(--text-secondary)] mb-6">{message}</p>
                <div class="flex items-center justify-end gap-4 mt-10">
                    <button
                        onClick={onCancel}
                        class="px-6 py-3 border border-[var(--border-color)] text-[var(--text-secondary)] font-mono text-[12px] font-bold tracking-widest uppercase hover:bg-[rgba(255,255,255,0.05)] hover:text-white transition-colors cursor-pointer"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        class={`px-6 py-3 border font-mono text-[12px] font-bold tracking-widest uppercase transition-all cursor-pointer ${
                            variant === 'danger'
                                ? 'border-[var(--color-error)] text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-white hover:shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                                : 'border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-black hover:shadow-[0_0_15px_var(--brand-glow)]'
                        }`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};