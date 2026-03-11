import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { useApp } from '../context/AppContext';
import { useTranslation } from '../i18n';
import { Terminal as TerminalIcon, Plus, RefreshCw, X, Send, ArrowDown, Copy, Check } from 'lucide-preact';
import { OrnamentWrapper } from './OrnamentWrapper';
export interface TerminalInfo {
    index: number;
    name: string;
    isActive: boolean;
    rows?: number;
    cols?: number;
    cursorX?: number;
    cursorY?: number;
    totalLines?: number;
}

export function TerminalPanel() {
    const { wsSendRef, terminalUpdateRef, activePanel, showToast } = useApp();
    const { t } = useTranslation();

    const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
    const [activeIndex, setActiveIndex] = useState<number>(-1);
    const [contentHtml, setContentHtml] = useState<string>('');
    const [inputText, setInputText] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(true);
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [copied, setCopied] = useState(false);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [newLineCount, setNewLineCount] = useState(0);

    const contentRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const isNearBottomRef = useRef(true);

    // Check scroll position to show/hide floating button
    const checkScrollPosition = useCallback(() => {
        if (!contentRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
        const nearBottom = scrollHeight - scrollTop - clientHeight < 80;
        isNearBottomRef.current = nearBottom;
        setShowScrollBtn(!nearBottom);
        if (nearBottom) setNewLineCount(0);
    }, []);

    // Initial fetch and push listener
    useEffect(() => {
        if (activePanel === 'terminal') {
            wsSendRef.current?.({ action: 'terminal_list' });
            setLoading(true);
        }
    }, [activePanel, wsSendRef]);

    useEffect(() => {
        terminalUpdateRef.current = (data: Record<string, unknown>) => {
            setLoading(false);
            if (data.terminals) {
                const terms = data.terminals as TerminalInfo[];
                setTerminals(terms);
                
                // Only auto-set activeIndex on initial load or if current selection no longer exists
                const currentExists = terms.find(t => t.index === activeIndex);
                if (activeIndex < 0 || !currentExists) {
                    const active = terms.find(t => t.isActive);
                    if (active) {
                        setActiveIndex(active.index);
                    } else if (terms.length > 0) {
                        setActiveIndex(terms[0].index);
                    }
                }
            }
            if (data.activeContent) {
                const content = data.activeContent as { contentHtml?: string };
                if (content.contentHtml !== undefined) {
                    setContentHtml(content.contentHtml);
                }
            }
        };

        return () => {
            terminalUpdateRef.current = null;
        };
    }, [activeIndex, showToast, terminalUpdateRef]);

    // Auto-fetch content when activeIndex changes (including first load)
    useEffect(() => {
        if (activeIndex >= 0) {
            wsSendRef.current?.({ action: 'terminal_content', index: activeIndex });
        }
    }, [activeIndex, wsSendRef]);

    // Auto-scroll to bottom only if user is already near bottom, otherwise count new lines
    useEffect(() => {
        if (contentRef.current) {
            if (isNearBottomRef.current) {
                contentRef.current.scrollTop = contentRef.current.scrollHeight;
            } else {
                // Count approximate new lines when user is scrolled up
                setNewLineCount(prev => prev + 1);
            }
        }
    }, [contentHtml]);

    // Listen to scroll events on the content div
    useEffect(() => {
        const el = contentRef.current;
        if (!el) return;
        el.addEventListener('scroll', checkScrollPosition, { passive: true });
        return () => el.removeEventListener('scroll', checkScrollPosition);
    }, [checkScrollPosition]);

    const handleSwitch = (index: number) => {
        setActiveIndex(index);
        setContentHtml(''); // clear while loading
        wsSendRef.current?.({ action: 'terminal_switch', index });
        wsSendRef.current?.({ action: 'terminal_content', index });
    };

    const handleCreate = () => {
        wsSendRef.current?.({ action: 'terminal_create' });
    };

    const handleClose = (index: number, e: Event) => {
        e.stopPropagation();
        wsSendRef.current?.({ action: 'terminal_close', index });
    };

    const handleRefresh = () => {
        setLoading(true);
        wsSendRef.current?.({ action: 'terminal_list' });
    };

    const handleSend = () => {
        if (!inputText.trim()) return;
        const cmd = inputText;
        wsSendRef.current?.({ action: "terminal_input", index: activeIndex, text: cmd + "\n" });
        
        setCommandHistory(prev => {
            const newHistory = prev.filter(c => c !== cmd);
            newHistory.push(cmd);
            if (newHistory.length > 50) newHistory.shift();
            return newHistory;
        });
        setHistoryIndex(-1);
        setInputText('');
        inputRef.current?.focus();
    };

    const sendRawKey = (key: string, code: string, keyCode: number) => {
        wsSendRef.current?.({ action: 'terminal_raw_key', index: activeIndex, key, code, keyCode });
    };

    const sendSpecialKey = (char: string, ctrl: boolean) => {
        wsSendRef.current?.({ action: 'terminal_special_key', index: activeIndex, char, ctrl });
    };

    const navigateHistory = (direction: 'up' | 'down') => {
        if (commandHistory.length === 0) return;
        
        setHistoryIndex(prev => {
            let newIndex = prev;
            if (direction === 'up') {
                newIndex = prev === -1 ? commandHistory.length - 1 : Math.max(0, prev - 1);
            } else {
                newIndex = prev === -1 ? -1 : Math.min(commandHistory.length, prev + 1);
            }
            
            if (newIndex === -1 || newIndex === commandHistory.length) {
                setInputText('');
                return -1;
            } else {
                setInputText(commandHistory[newIndex]);
                return newIndex;
            }
        });
    };

    const handleArrowUp = () => {
        if (terminals.length === 0) return;
        if (inputText || commandHistory.length > 0) {
            navigateHistory('up');
        } else {
            sendRawKey('ArrowUp', 'ArrowUp', 38);
        }
    };

    const handleArrowDown = () => {
        if (terminals.length === 0) return;
        if (inputText || historyIndex !== -1) {
            navigateHistory('down');
        } else {
            sendRawKey('ArrowDown', 'ArrowDown', 40);
        }
    };

    const scrollToBottom = () => {
        setNewLineCount(0);
        setShowScrollBtn(false);
        setTimeout(() => {
            contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
        }, 50);
    };

    const handleCopy = async () => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentHtml;
        const text = tempDiv.textContent || '';
        await navigator.clipboard.writeText(text);
        setCopied(true);
        showToast(t('mobile.terminal.copied'), 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    const handleInputFocus = () => {
        scrollToBottom();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSend();
        }
    };

    return (
        <OrnamentWrapper 
            title={t('mobile.terminal.title')} 
            icon={<TerminalIcon size={16} />}
            className="flex-1 min-h-0 m-2"
            actions={
                <>
                    <button className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" onClick={handleCopy} title={t('mobile.terminal.copyOutput')}>
                        {copied ? <Check size={16} className="text-[var(--success)]" /> : <Copy size={16} />}
                    </button>
                    <button className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" onClick={handleRefresh} title="Refresh">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </>
            }
        >
            <div className="flex-1 flex flex-col min-h-0 relative">
                <style>{`
                    .term-prompt { color: var(--success, #22c55e); display: inline-block; width: 100%; }
                    .term-error { color: var(--error, #ef4444); display: inline-block; width: 100%; }
                    .term-warn { color: var(--warning, #f59e0b); display: inline-block; width: 100%; }
                    .term-success { color: var(--success, #22c55e); display: inline-block; width: 100%; }
                    .term-path { color: var(--accent-primary, #3b82f6); display: inline-block; width: 100%; }
                    .term-line { 
                        color: var(--text-primary); 
                        display: inline-block;
                        width: 100%;
                    }
                `}</style>

                {/* Terminal Tabs / Header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-glass)] border-b border-[var(--border)] overflow-x-auto hide-scrollbar shrink-0">
                    {terminals.map(t => (
                        <div
                            key={t.index}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-all whitespace-nowrap border ${t.index === activeIndex 
                                ? 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/40 text-[var(--accent-primary)] shadow-[0_0_10px_rgba(14,165,233,0.1)]' 
                                : 'bg-white/5 border-transparent text-[var(--text-muted)] hover:bg-white/10'}`}
                            onClick={() => handleSwitch(t.index)}
                        >
                            <span className="text-[11px] font-mono font-bold">{t.name}</span>
                            {terminals.length > 1 && (
                                <button
                                    className="hover:text-red-400 p-0.5"
                                    onClick={(e) => handleClose(t.index, e as unknown as Event)}
                                >
                                    <X size={10} />
                                </button>
                            )}
                        </div>
                    ))}
                    <button
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
                        onClick={handleCreate}
                        title="New Terminal"
                    >
                        <Plus size={16} />
                    </button>
                    <div className="flex-1" />
                </div>

                {/* Terminal Content with relative wrapper for floating button */}
                <div className="flex-1 relative min-h-0">
                    <div 
                        ref={contentRef}
                        className="absolute inset-0 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed bg-[var(--bg-dark)]/50"
                        dangerouslySetInnerHTML={{ __html: contentHtml || '<div class="flex items-center gap-2 text-[var(--text-muted)] italic"><span class="animate-pulse">_</span> Initializing...</div>' }}
                    />

                    {/* Floating scroll-to-bottom button */}
                    {showScrollBtn && (
                        <button
                            onClick={scrollToBottom}
                            className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-3 py-2 rounded-full bg-[var(--accent-primary)] text-white text-xs font-medium shadow-lg shadow-black/30 hover:bg-[var(--accent-secondary)] transition-all animate-[slideInUp_0.2s_ease-out]"
                        >
                            <ArrowDown size={14} />
                            {newLineCount > 0 && (
                                <span className="tabular-nums">{newLineCount > 99 ? '99+' : newLineCount}</span>
                            )}
                        </button>
                    )}
                </div>

                {/* Quick Action Bar */}
                <div className="shrink-0 flex gap-1.5 px-3 py-2 bg-[var(--bg-card)] border-t border-[var(--border)] overflow-x-auto hide-scrollbar">
                    {[
                        { label: 'Ctrl+C', action: () => sendSpecialKey('c', true) },
                        { label: 'Tab', action: () => sendRawKey('Tab', 'Tab', 9) },
                        { label: '↑', action: handleArrowUp },
                        { label: '↓', action: handleArrowDown },
                        { label: 'Ctrl+L', action: () => sendSpecialKey('l', true) },
                        { label: 'Ctrl+D', action: () => sendSpecialKey('d', true) },
                        { label: 'Esc', action: () => sendRawKey('Escape', 'Escape', 27) },
                    ].map(btn => (
                        <button
                            key={btn.label}
                            onClick={btn.action}
                            disabled={terminals.length === 0}
                            className="px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap bg-white/10 text-[var(--text-secondary)] hover:bg-white/20 hover:text-[var(--text-primary)] border-none cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>

                {/* Input Bar */}
                <div className="shrink-0 flex gap-2 p-3 bg-[var(--bg-card)] border-t border-[var(--border)]">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputText}
                        onInput={(e) => setInputText((e.target as HTMLInputElement).value)}
                        onKeyDown={handleKeyDown}
                        onFocus={handleInputFocus}
                        placeholder={t('mobile.terminal.sendCommand')}
                        className="flex-1 px-4 py-2.5 bg-[var(--bg-dark)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent-primary)] transition-colors font-mono"
                        disabled={terminals.length === 0}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!inputText.trim() || terminals.length === 0}
                        className={`w-10 h-10 rounded-lg border-none flex items-center justify-center shrink-0 transition-colors ${
                            inputText.trim() && terminals.length > 0
                                ? 'bg-[var(--accent-primary)] text-white cursor-pointer hover:bg-[var(--accent-secondary)]'
                                : 'bg-white/5 text-[var(--text-muted)] cursor-not-allowed'
                        }`}
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </OrnamentWrapper>
    );
}
