import { createContext } from 'preact';
import { useContext, useState, useCallback } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { vi } from './vi';
import { en } from './en';
import type { Language, Translations } from './types';

const translations: Record<Language, Translations> = { vi, en };

interface I18nContextValue {
    lang: Language;
    t: (key: string) => string;
    setLang: (lang: Language) => void;
    toggleLang: () => void;
}

const I18nContext = createContext<I18nContextValue>({
    lang: 'vi',
    t: (key: string) => key,
    setLang: () => {},
    toggleLang: () => {},
});

export function I18nProvider({ children }: { children: ComponentChildren }) {
    const [lang, setLangState] = useState<Language>(() => {
        const saved = localStorage.getItem('app-lang');
        return (saved === 'en' || saved === 'vi') ? saved : 'vi';
    });

    const setLang = useCallback((l: Language) => {
        setLangState(l);
        localStorage.setItem('app-lang', l);
    }, []);

    const toggleLang = useCallback(() => {
        setLangState(prev => {
            const next = prev === 'vi' ? 'en' : 'vi';
            localStorage.setItem('app-lang', next);
            return next;
        });
    }, []);

    const t = useCallback((key: string): string => {
        return translations[lang][key] || translations['vi'][key] || key;
    }, [lang]);

    return (
        <I18nContext.Provider value={{ lang, t, setLang, toggleLang }}>
            {children}
        </I18nContext.Provider>
    );
}

export function useTranslation() {
    return useContext(I18nContext);
}
