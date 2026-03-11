/**
 * useTheme — Theme switching and persistence
 * Ported from public/js/mobile/theme.js
 */
import { useCallback } from 'preact/hooks';
import { authFetch } from './useApi';

const THEMES = [
    'midnight', 'ember', 'nord', 'command', 'neon', 'dracula', 'monokai', 'carbon',
    'paper', 'ocean', 'command-light', 'sand', 'rose',
    'solarized-dark', 'solarized-light'
] as const;
type Theme = typeof THEMES[number];

const THEME_ICONS: Record<Theme, string> = {
    midnight: '🌙',
    ember: '🔥',
    nord: '❄️',
    command: '⌘',
    neon: '⚡',
    dracula: '🧛',
    monokai: '🎨',
    carbon: '🏗️',
    paper: '📝',
    ocean: '🌊',
    'command-light': '⌘',
    sand: '☕',
    rose: '🌹',
    'solarized-dark': '🌘',
    'solarized-light': '🌖'
};

function applyThemeToBody(theme: string): void {
    const legacyClasses = ['light-theme', 'pastel-theme', 'rainbow-theme', 'slate-theme', 'dark-theme'];
    const newClasses = THEMES.map(t => `${t}-theme`);
    document.body.classList.remove(...legacyClasses, ...newClasses);
    
    let activeTheme = theme;
    if (!THEMES.includes(theme as Theme)) {
        activeTheme = 'command';
    }
    
    // Always apply a class for explicit scoping
    document.body.classList.add(`${activeTheme}-theme`);
}

export function useTheme() {
    const setTheme = useCallback((theme: string) => {
        const activeTheme = THEMES.includes(theme as Theme) ? theme : 'command';
        applyThemeToBody(activeTheme);
        localStorage.setItem('theme', activeTheme);
    }, []);

    const cycleTheme = useCallback(() => {
        const current = localStorage.getItem('theme') || 'command';
        const idx = THEMES.indexOf(current as Theme);
        const nextIdx = idx >= 0 ? (idx + 1) % THEMES.length : 1;
        const next = THEMES[nextIdx];
        setTheme(next);
    }, [setTheme]);

    const loadTheme = useCallback(async () => {
        const local = localStorage.getItem('theme');
        if (local && THEMES.includes(local as Theme)) {
            applyThemeToBody(local);
            return;
        }
        try {
            const res = await authFetch('/api/admin/mobile-ui');
            const data = await res.json();
            setTheme(THEMES.includes(data.theme as Theme) ? data.theme : 'command');
        } catch {
            setTheme('command');
        }
    }, [setTheme]);

    const getThemeIcon = useCallback((theme?: string): string => {
        const t = (theme || localStorage.getItem('theme') || 'command') as Theme;
        return THEME_ICONS[t] || '⌘';
    }, []);

    return { setTheme, cycleTheme, loadTheme, getThemeIcon, THEMES };
}
