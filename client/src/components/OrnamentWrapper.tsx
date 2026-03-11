import type { ComponentChildren } from 'preact';

interface OrnamentWrapperProps {
    children: ComponentChildren;
    title?: string;
    icon?: ComponentChildren;
    actions?: ComponentChildren;
    className?: string;
    containerClass?: string;
    showGlow?: boolean;
}

/**
 * OrnamentWrapper — "Command Center" card aesthetic matching admin theme.
 * Features: Surface background, bracket corners on hover, crosshair accents, title bar.
 */
export const OrnamentWrapper = ({ 
    children, 
    title, 
    icon,
    actions,
    className = "",
    containerClass = "",
    showGlow = false 
}: OrnamentWrapperProps) => {
    return (
        <div className={`relative flex flex-col flex-1 min-h-0 group ${className}`}>
            {/* Background Layer — matches admin tech-card */}
            <div className={`absolute inset-0 bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden transition-all duration-300 group-hover:border-[rgba(0,229,153,0.3)] ${showGlow ? 'shadow-[0_0_30px_var(--brand-glow)]' : ''}`}
                style={{
                    // Hover gradient matching admin: surface → brand tint
                    background: undefined,
                }}
            >
                {/* Hover gradient overlay */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{
                        background: 'linear-gradient(180deg, var(--bg-card) 0%, rgba(0, 229, 153, 0.04) 100%)',
                    }}
                />

                {/* Bracket Corners — 16×16px, visible on hover (matching admin .bracket) */}
                <div className="absolute -top-px -left-px w-4 h-4 border-t-2 border-l-2 border-[var(--brand)] opacity-0 group-hover:opacity-80 transition-opacity duration-300" />
                <div className="absolute -top-px -right-px w-4 h-4 border-t-2 border-r-2 border-[var(--brand)] opacity-0 group-hover:opacity-80 transition-opacity duration-300" />
                <div className="absolute -bottom-px -left-px w-4 h-4 border-b-2 border-l-2 border-[var(--brand)] opacity-0 group-hover:opacity-80 transition-opacity duration-300" />
                <div className="absolute -bottom-px -right-px w-4 h-4 border-b-2 border-r-2 border-[var(--brand)] opacity-0 group-hover:opacity-80 transition-opacity duration-300" />
            </div>

            {/* Header / Title Bar — matches admin font-display style */}
            {title && (
                <div className="relative px-4 py-3 flex items-center justify-between border-b border-[var(--border)]">
                    <div className="flex items-center gap-2">
                        {icon && <span className="text-[var(--brand)] opacity-80">{icon}</span>}
                        <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display, inherit)' }}>
                            {title}
                        </span>
                    </div>
                    {actions && <div className="flex items-center gap-1">{actions}</div>}
                </div>
            )}

            {/* Main Content */}
            <div className={`relative flex-1 min-h-0 flex flex-col ${containerClass}`}>
                {children}
            </div>
        </div>
    );
};
