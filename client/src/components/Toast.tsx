/**
 * Toast — Notification component
 * Ported from public/js/mobile/utils.js showToast()
 */
import { useApp } from '../context/AppContext';
import type { Toast } from '../context/AppContext';

function ToastItem({ toast }: { toast: Toast }) {
    const iconMap = {
        info: '💡',
        success: '✅',
        error: '❌',
    };

    return (
        <div class={`toast toast-${toast.type}`}>
            <span>{iconMap[toast.type]}</span>
            <span>{toast.message}</span>
        </div>
    );
}

export function ToastContainer() {
    const { toasts } = useApp();

    if (toasts.length === 0) return null;

    return (
        <div id="toastContainer" class="toast-container">
            {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
        </div>
    );
}
