import { useState, useEffect, useCallback, useRef } from 'preact/hooks';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;      // default: 'Confirm'
    cancelText?: string;       // default: 'Cancel'
    destructive?: boolean;     // if true, confirm button is red
    showInput?: boolean;       // if true, show text input (prompt mode)
    inputPlaceholder?: string; // placeholder for input
    inputDefaultValue?: string; // default value for input
    onConfirm: (inputValue?: string) => void;  // called with input value in prompt mode
    onCancel: () => void;
}

export function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    destructive = false,
    showInput = false,
    inputPlaceholder = '',
    inputDefaultValue = '',
    onConfirm,
    onCancel
}: ConfirmDialogProps) {
    const [inputValue, setInputValue] = useState(inputDefaultValue);
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset input value when dialog opens
    useEffect(() => {
        if (isOpen) {
            setInputValue(inputDefaultValue);
            if (showInput && inputRef.current) {
                setTimeout(() => {
                    inputRef.current?.focus();
                }, 50);
            }
        }
    }, [isOpen, inputDefaultValue, showInput]);

    // Handle escape key
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCancel();
            } else if (e.key === 'Enter' && showInput) {
                onConfirm(inputValue);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onCancel, onConfirm, showInput, inputValue]);

    // Prevent body scroll when open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const handleConfirm = useCallback(() => {
        onConfirm(showInput ? inputValue : undefined);
    }, [onConfirm, showInput, inputValue]);

    const handleOverlayClick = useCallback((e: MouseEvent) => {
        if (e.target === e.currentTarget) {
            onCancel();
        }
    }, [onCancel]);

    if (!isOpen) return null;

    return (
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity"
            onClick={handleOverlayClick}
        >
            <div class="w-[calc(100%-2rem)] max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-xl">
                <h3 class="mb-2 text-base font-semibold text-[var(--text-primary)]">
                    {title}
                </h3>
                <p class="mb-5 text-sm text-[var(--text-muted)]">
                    {message}
                </p>

                {showInput && (
                    <input
                        ref={inputRef}
                        type="text"
                        class="mb-5 w-full rounded-lg border border-[var(--border)] bg-black/20 p-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                        placeholder={inputPlaceholder}
                        value={inputValue}
                        onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
                    />
                )}

                <div class="flex gap-3">
                    <button
                        type="button"
                        class="flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-[var(--border)] bg-white/5 text-sm font-medium text-[var(--text-muted)] hover:bg-white/10"
                        onClick={onCancel}
                    >
                        {cancelText}
                    </button>
                    <button
                        type="button"
                        class={`flex min-h-[44px] flex-1 items-center justify-center rounded-lg text-sm font-medium text-white hover:opacity-90 ${
                            destructive ? 'bg-[#f85149]' : 'bg-[var(--accent-primary)]'
                        }`}
                        onClick={handleConfirm}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
