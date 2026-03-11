import { usePWAInstall } from '../hooks/usePWAInstall';
import { X } from 'lucide-preact';
import { useState, useEffect } from 'preact/hooks';
import { useTranslation } from '../i18n';

export function PWAInstallPrompt() {
    const { isInstallable, promptInstall } = usePWAInstall();
    const { t } = useTranslation();
    const [dismissed, setDismissed] = useState(false);

    // Load dismissed state from localStorage
    useEffect(() => {
        const isDismissed = localStorage.getItem('pwa_prompt_dismissed') === 'true';
        setDismissed(isDismissed);
    }, []);

    const handleDismiss = () => {
        setDismissed(true);
        localStorage.setItem('pwa_prompt_dismissed', 'true');
    };

    if (!isInstallable || dismissed) return null;

    return (
        <div className="fixed bottom-[90px] left-4 right-4 z-[9999] animate-in slide-in-from-bottom-5">
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-[14px] p-4 shadow-2xl flex items-center gap-4 backdrop-blur-xl">
                <div className="w-10 h-10 rounded-[10px] overflow-hidden shrink-0 shadow-md">
                    <img src="/icon-192.png" alt="App Icon" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--text)] m-0 mb-1">{t('mobile.pwa.installTitle')}</h3>
                    <p className="text-xs text-[var(--text-muted)] m-0 leading-tight">{t('mobile.pwa.installDesc')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button 
                        onClick={promptInstall}
                        className="bg-[var(--accent-primary)] text-white text-xs font-semibold px-4 py-2 rounded-[8px] border-none cursor-pointer"
                    >
                        {t('mobile.pwa.install')}
                    </button>
                    <button 
                        onClick={handleDismiss}
                        className="bg-transparent text-[var(--text-muted)] p-2 rounded-full border-none cursor-pointer hover:bg-[var(--surface-hover)]"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
