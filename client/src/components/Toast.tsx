/**
 * Toast — Notification component (Admin-style)
 * Matches the admin panel design: slide-in from right, SVG icons, sharp edges
 */
import { useApp } from '../context/AppContext';
import type { Toast } from '../context/AppContext';

const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5" />
    </svg>
);

const ErrorIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
        <line x1="12" x2="12" y1="9" y2="13" />
        <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
);

const InfoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
    </svg>
);

function ToastItem({ toast }: { toast: Toast }) {
    const iconMap = {
        info: <InfoIcon />,
        success: <CheckIcon />,
        error: <ErrorIcon />,
    };

    return (
        <div class={`toast toast-${toast.type} show`}>
            {iconMap[toast.type]}
            <span>{toast.message}</span>
        </div>
    );
}

export function ToastContainer() {
    const { toasts } = useApp();

    if (toasts.length === 0) return null;

    return (
        <div class="toast-container">
            {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
        </div>
    );
}
