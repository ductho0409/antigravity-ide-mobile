/**
 * LoginScreen — PIN authentication
 * Ported from public/mobile-components/login.html + api.js PIN logic
 */
import { useState, useRef, useEffect } from 'preact/hooks';
import { useApp } from '../context/AppContext';
import { Lock, LogIn } from 'lucide-preact';
import { useTranslation } from '../i18n';

export function LoginScreen() {
    const { login } = useApp();
    const { t } = useTranslation();
    const [error, setError] = useState('');
    const [pinLen, setPinLen] = useState(0);
    const [shake, setShake] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    // Auto-focus on mount
    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 100);
    }, []);

    async function submitPin() {
        const pin = inputRef.current?.value || '';
        if (!pin || pin.length < 4) {
            setError(t('mobile.login.pleaseEnterPin'));
            return;
        }

        const result = await login(pin);
        if (!result.success) {
            setError(result.error || t('mobile.login.invalidPin'));
            setShake(true);
            setTimeout(() => {
                setShake(false);
                if (inputRef.current) {
                    inputRef.current.value = '';
                    inputRef.current.focus();
                }
                setPinLen(0);
            }, 600);
        }
    }

    function handleInput() {
        const len = inputRef.current?.value.length || 0;
        setPinLen(len);
        clearTimeout(debounceRef.current);

        if (len === 6) {
            submitPin();
        } else if (len >= 4) {
            debounceRef.current = setTimeout(submitPin, 500);
        }
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitPin();
        }
    }

    return (
        <div
            className="fixed inset-0 bg-[var(--bg-dark)] z-[2000] flex flex-col items-center justify-center p-5 overflow-hidden"
            id="loginScreen"
        >
            {/* Ambient orbs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute w-[260px] h-[260px] bg-[var(--accent-primary)] rounded-full blur-[80px] opacity-35 -top-[60px] -right-[40px] animate-[loginOrbFloat_12s_ease-in-out_infinite]" />
                <div className="absolute w-[200px] h-[200px] bg-[var(--accent-secondary,var(--accent-primary))] rounded-full blur-[80px] opacity-35 -bottom-[30px] -left-[50px] animate-[loginOrbFloat_12s_ease-in-out_infinite] [animation-delay:-4s]" />
                <div className="absolute w-[140px] h-[140px] bg-[var(--accent-glow,var(--accent-primary))] rounded-full blur-[80px] opacity-20 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-[loginOrbFloat_12s_ease-in-out_infinite] [animation-delay:-8s]" />
            </div>

            <div
                className={`relative bg-[var(--bg-card)] border border-[var(--border)] rounded-[28px] px-8 py-11 pb-9 max-w-[340px] w-full text-center backdrop-blur-[20px] z-[1] animate-[loginCardIn_0.5s_cubic-bezier(0.16,1,0.3,1)] shadow-[0_8px_32px_rgba(0,0,0,0.12),0_0_0_1px_var(--border),inset_0_1px_0_rgba(255,255,255,0.06)] ${shake ? 'animate-[loginShake_0.4s_ease]' : ''}`}
            >
                {/* Lock icon */}
                <div className="relative inline-flex items-center justify-center w-[72px] h-[72px] mx-auto mb-5 text-[var(--accent-primary)]">
                    <div className="absolute inset-0 rounded-full border-2 border-[var(--accent-primary)] opacity-25 animate-[loginRingPulse_2.5s_ease-in-out_infinite]" />
                    <Lock size={32} strokeWidth={1.5} />
                </div>

                <div className="text-[22px] font-bold text-[var(--text-primary)] mb-1.5 tracking-tight">{t('mobile.login.welcomeBack')}</div>
                <div className="text-[var(--text-muted)] text-[13px] mb-8">{t('mobile.login.enterPin')}</div>

                {/* PIN dots + hidden input */}
                <div
                    className="flex items-center justify-center gap-3.5 mb-3 relative py-3"
                    onClick={() => inputRef.current?.focus()}
                >
                    {[0, 1, 2, 3, 4, 5].map(i => (
                        <div
                            key={i}
                            className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-[250ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] ${i < pinLen
                                    ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)] scale-[1.15] shadow-[0_0_12px_var(--accent-glow,rgba(14,165,233,0.3))] animate-[pinDotPop_0.3s_cubic-bezier(0.34,1.56,0.64,1)]'
                                    : 'bg-transparent border-[var(--border-hover)]'
                                }`}
                        />
                    ))}
                    <input
                        ref={inputRef}
                        type="tel"
                        className="absolute w-px h-px opacity-0 pointer-events-none"
                        id="pinInput"
                        maxLength={6}
                        autoComplete="off"
                        inputMode="numeric"
                        onInput={handleInput}
                        onKeyDown={handleKeyDown}
                    />
                </div>

                <button
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-5 mt-5 bg-[var(--accent-primary)] border-none rounded-[14px] text-white text-[15px] font-semibold cursor-pointer transition-all duration-[250ms] ease shadow-[0_4px_16px_var(--accent-glow,rgba(14,165,233,0.25))] hover:brightness-110 hover:shadow-[0_6px_24px_var(--accent-glow,rgba(14,165,233,0.35))] hover:-translate-y-px active:translate-y-0 active:brightness-95"
                    onClick={submitPin}
                >
                    <LogIn size={18} />
                    {t('mobile.login.unlock')}
                </button>

                {error && (
                    <div className="text-[var(--error)] text-[13px] mt-3.5 animate-[loginShake_0.4s_ease]">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}
