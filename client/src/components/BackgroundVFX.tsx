import type { FC } from 'preact/compat';

export const BackgroundVFX: FC = () => {
    return (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            {/* Grid Pattern — matches admin theme: 32px grid on border color */}
            <div 
                className="absolute inset-0 opacity-[var(--grid-opacity)]"
                style={{
                    backgroundImage: `
                        linear-gradient(var(--border) 1px, transparent 1px),
                        linear-gradient(90deg, var(--border) 1px, transparent 1px)
                    `,
                    backgroundSize: '32px 32px'
                }}
            />
            
            {/* Radial Glow — ellipse matching admin theme */}
            <div 
                className="absolute pointer-events-none"
                style={{
                    top: '-20vh',
                    left: '10vw',
                    width: '80vw',
                    height: '80vh',
                    background: 'radial-gradient(ellipse at center, var(--brand-glow) 0%, transparent 60%)',
                    zIndex: 0,
                }}
            />
        </div>
    );
};
