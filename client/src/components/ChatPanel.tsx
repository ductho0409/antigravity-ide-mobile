/**
 * ChatPanel — Main chat interface
 * Ported from:
 *   - public/js/mobile/chat-live.js (model/mode selectors, polling)
 *   - public/js/mobile/chat.js (send message, quick commands, remote prompts)
 *   - public/mobile-components/chat.html (HTML structure)
 */
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { useApp } from '../context/AppContext';
import { authFetch, getServerUrl } from '../hooks/useApi';
import { useChatPolling } from '../hooks/useChatPolling';
import { useWindows } from '../hooks/useWindows';
import { attachAllHandlers } from '../chat/chatHandlers';
import { ChatHistoryModal } from './ChatHistoryModal';
import { Clock, Plus, Monitor, FolderOpen, ArrowLeft, Check, RefreshCw, Send, X, Terminal, Maximize2, Minimize2 } from 'lucide-preact';
import { useTranslation } from '../i18n';
import { OrnamentWrapper } from './OrnamentWrapper';

// ─── Types ──────────────────────────────────────────────────────────
interface ChatMessage {
    type: 'user' | 'mobile_command' | 'agent' | 'status' | 'error';
    content: string;
    timestamp?: string | number;
}

// ─── ChatPanel Component ────────────────────────────────────────────
export function ChatPanel() {
    const { showToast, activePanel, viewFileDiffRef, chatUpdateRef } = useApp();
    const { t } = useTranslation();

    // Restart polling ref — set by useChatPolling, consumed by useWindows
    const restartPollingRef = useRef<(() => void) | null>(null);
    const restartPollingCallback = useCallback(() => {
        restartPollingRef.current?.();
    }, []);

    // Windows management (multi-window discovery, chat history, scroll sync)
    const win = useWindows({ showToast, restartPolling: restartPollingCallback });
    const [windowDropdownOpen, setWindowDropdownOpen] = useState(false);
    const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
    const windowDropdownRef = useRef<HTMLDivElement>(null);

    // Model/Mode state
    const [models, setModels] = useState<string[]>([]);
    const [currentModel, setCurrentModel] = useState('Unknown');
    const [currentMode, setCurrentMode] = useState('Planning');
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
    const dropdownDebounceRef = useRef(false);

    // Chat messages state (WebSocket-based messages)
    const [remotePrompts, setRemotePrompts] = useState<ChatMessage[]>([]);

    // Batch mode state
    const [batchMode, setBatchMode] = useState(false);
    const [batchCount, setBatchCount] = useState(0);
    const sendingRef = useRef(false);

    // Fullscreen mode
    const [fullscreen, setFullscreen] = useState(false);

    // Toggle fullscreen — add/remove class on body
    useEffect(() => {
        if (fullscreen) {
            document.body.classList.add('chat-fullscreen');
        } else {
            document.body.classList.remove('chat-fullscreen');
        }
        return () => document.body.classList.remove('chat-fullscreen');
    }, [fullscreen]);

    // Escape key exits fullscreen
    useEffect(() => {
        if (!fullscreen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setFullscreen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [fullscreen]);

    // Refs for polling
    const cascadeRef = useRef<HTMLDivElement>(null);
    const cascadeStyleRef = useRef<HTMLStyleElement>(null);
    const chatInputRef = useRef<HTMLTextAreaElement>(null);

    // ─── Load Models & Modes (from chat-live.js loadModelsAndModes) ────
    const loadModelsAndModes = useCallback(async () => {
        try {
            const res = await authFetch('/api/models');
            const data = await res.json();
            setModels(data.models || []);
            setCurrentModel(data.currentModel || 'Unknown');
            setCurrentMode(data.currentMode || 'Planning');
        } catch (_e) {
            setCurrentModel(t('mobile.chat.notConnected'));
        }
    }, []);

    useEffect(() => { loadModelsAndModes(); }, [loadModelsAndModes]);

    // ─── Select Model (from chat-live.js selectModel) ─────────────────
    const selectModel = useCallback(async (modelName: string) => {
        setModelDropdownOpen(false);
        setModeDropdownOpen(false);
        const prev = currentModel;
        setCurrentModel(t('mobile.chat.changing'));

        try {
            const res = await authFetch('/api/models/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: modelName }),
            });
            const result = await res.json();
            if (result.success) {
                setCurrentModel(result.selected || modelName);
                showToast(`Model: ${result.selected || modelName}`, 'success');
            } else {
                setCurrentModel(prev);
                showToast(result.error || t('mobile.chat.failedChangeModel'), 'error');
            }
        } catch (_e) {
            setCurrentModel(prev);
            showToast(t('mobile.chat.networkError'), 'error');
        }
    }, [currentModel, showToast]);

    // ─── Select Mode (from chat-live.js selectMode) ───────────────────
    const selectMode = useCallback(async (modeName: string) => {
        setModelDropdownOpen(false);
        setModeDropdownOpen(false);
        const prev = currentMode;
        setCurrentMode('...');

        try {
            const res = await authFetch('/api/modes/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: modeName }),
            });
            const result = await res.json();
            if (result.success) {
                setCurrentMode(modeName);
                showToast(`Mode: ${modeName}`, 'success');
            } else {
                setCurrentMode(prev);
                showToast(result.error || t('mobile.chat.failedChangeMode'), 'error');
            }
        } catch (_e) {
            setCurrentMode(prev);
            showToast(t('mobile.chat.networkError'), 'error');
        }
    }, [currentMode, showToast]);

    // ─── Toggle Dropdowns (with debounce from chat-live.js) ───────────
    const toggleModelDropdown = useCallback((e: Event) => {
        e.stopPropagation();
        if (dropdownDebounceRef.current) return;
        dropdownDebounceRef.current = true;
        setTimeout(() => { dropdownDebounceRef.current = false; }, 100);
        setModeDropdownOpen(false);
        setModelDropdownOpen(prev => !prev);
    }, []);

    const toggleModeDropdown = useCallback((e: Event) => {
        e.stopPropagation();
        if (dropdownDebounceRef.current) return;
        dropdownDebounceRef.current = true;
        setTimeout(() => { dropdownDebounceRef.current = false; }, 100);
        setModelDropdownOpen(false);
        setModeDropdownOpen(prev => !prev);
    }, []);

    // Close dropdowns on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.model-selector') && !target.closest('.mode-selector') &&
                !target.closest('.model-dropdown') && !target.closest('.mode-dropdown')) {
                setModelDropdownOpen(false);
                setModeDropdownOpen(false);
            }
        };
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);

    // ─── Close window dropdown on outside click ──────────────────────
    useEffect(() => {
        if (!windowDropdownOpen) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            // Skip if target was detached from DOM by a synchronous re-render
            // (e.g. clicking "New Window" triggers setShowWorkspacePicker which
            // re-renders dropdown content, detaching the original button)
            if (!target.isConnected) return;
            if (
                windowDropdownRef.current &&
                !windowDropdownRef.current.contains(target) &&
                target.id !== 'windowSelector' &&
                !target.closest('#windowSelector')
            ) {
                setWindowDropdownOpen(false);
            }
        };
        // Delay to avoid immediate close from the same click
        const id = setTimeout(() => document.addEventListener('click', handler), 10);
        return () => {
            clearTimeout(id);
            document.removeEventListener('click', handler);
        };
    }, [windowDropdownOpen]);

    // ─── Chat Polling (active only when on chat panel) ────────────────
    const { restartPolling } = useChatPolling(cascadeRef, cascadeStyleRef, activePanel === 'chat', {
        interval: 10000,
        chatUpdateRef,
        userScrollLockRef: win.userScrollLockRef,
        isAutoScrollingRef: win.isAutoScrollingRef,
        onRender: (container) => {
            attachAllHandlers(container, {
                showToast,
                viewFileDiff: (path, ext) => viewFileDiffRef.current?.(path, ext),
            });
        },
    });
    // Wire restartPolling into the ref so useWindows can call it
    restartPollingRef.current = restartPolling;

    // ─── Scroll sync: phone scroll → desktop scroll ───────────────────
    useEffect(() => {
        const container = cascadeRef.current;
        if (!container || activePanel !== 'chat') return;

        const handleScroll = () => {
            if (win.isAutoScrollingRef.current) return; // Ignore programmatic scrolls
            const maxScroll = container.scrollHeight - container.clientHeight;
            if (maxScroll <= 0) return;
            const pct = container.scrollTop / maxScroll;
            win.syncScroll(pct);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, [activePanel, win.syncScroll, win.isAutoScrollingRef]);


    // ─── Add Chat Message (from WebSocket via chat.js) ────────────────
    const addChatMessage = useCallback((msg: ChatMessage) => {

        // Track user prompts for remote prompts strip
        if (msg.type === 'user' || msg.type === 'mobile_command') {
            setRemotePrompts(prev => {
                const isDuplicate = prev.length > 0 && prev[prev.length - 1].content === msg.content;
                if (isDuplicate) return prev;
                const updated = [...prev, msg];
                if (updated.length > 3) updated.shift();
                return updated;
            });
        }
    }, []);

    // Expose addChatMessage to window for WebSocket callback
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as unknown as Record<string, unknown>).addChatMessage = addChatMessage;
        return () => { delete (window as unknown as Record<string, unknown>).addChatMessage; };
    }, [addChatMessage]);

    // ─── Send Message (with double-send guard) ──────────────────────
    const sendMessage = useCallback(async () => {
        const input = chatInputRef.current;
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        if (sendingRef.current) return; // prevent double-send

        sendingRef.current = true;

        // Copy to clipboard BEFORE sending — backup in case of failure
        // Use execCommand fallback because navigator.clipboard requires HTTPS
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch { /* clipboard may not be available */ }

        try {
            if (batchMode) {
                // Queue message for batch sending
                const res = await authFetch(`${getServerUrl()}/api/cdp/inject-batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text }),
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                    throw new Error(errData.error || `Server error ${res.status}`);
                }
                const result = await res.json();
                if (result.success) {
                    input.value = '';
                    input.style.height = 'auto';
                    setBatchCount(result.queueLength ?? batchCount + 1);
                    showToast(`${t('mobile.chat.queued')} (${result.queueLength ?? batchCount + 1})`, 'success');
                } else {
                    throw new Error(result.error || 'Queue failed');
                }
            } else {
                const res = await authFetch(`${getServerUrl()}/api/cdp/inject`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, submit: true }),
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                    throw new Error(errData.error || `Server error ${res.status}`);
                }
                const result = await res.json();
                if (result.success) {
                    input.value = '';
                    input.style.height = 'auto';
                    showToast(t('mobile.chat.sent'), 'success');
                } else {
                    throw new Error(result.error || 'Send failed — IDE may not be connected');
                }
            }
        } catch (e) {
            const msg = (e instanceof Error && e.message) ? e.message : 'Connection error';
            showToast(`❌ ${msg}`, 'error');
        } finally {
            sendingRef.current = false;
        }
    }, [showToast, batchMode, batchCount]);

    // ─── Flush Batch ──────────────────────────────────────────────────
    const flushBatch = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/cdp/flush-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const result = await res.json();
            if (result.success || result.flushed) {
                setBatchCount(0);
                showToast(t('mobile.chat.batchSent'), 'success');
            } else if (result.empty) {
                showToast(t('mobile.chat.queueEmpty'), 'info');
            } else {
                throw new Error(result.error);
            }
        } catch (_e) {
            showToast(t('mobile.chat.flushFailed'), 'error');
        }
    }, [showToast]);

    // ─── Quick Command (from chat.js sendQuick) ───────────────────────
    const sendQuick = useCallback((cmd: string) => {
        if (chatInputRef.current) {
            chatInputRef.current.value = cmd;
        }
        sendMessage();
    }, [sendMessage]);

    // ─── Keyboard handler (Enter = newline, no auto-send) ────────────
    const handleKeyDown = useCallback((_e: KeyboardEvent) => {
        // Enter = newline (default textarea behavior)
        // No auto-send — user must tap the Send button
    }, []);

    // ─── Auto-resize textarea ────────────────────────────────────────
    const handleInput = useCallback(() => {
        const el = chatInputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }, []);

    // ─── Mode display labels ─────────────────────────────────────────
    const modeLabel = currentMode.replace(/\s+/g, ' ').split(' ')[0];

    return (
        <OrnamentWrapper 
            className={`flex-1 min-h-0 chat-container ${fullscreen ? 'chat-fullscreen-panel' : 'm-2'}`}
            title={fullscreen ? undefined : `${t('mobile.chat.windows')} / ${win.activeWindowName}`}
        >
            <div class="flex-1 flex flex-col min-h-0">
                {/* ─── Style tag for cascade CSS injection ─── */}
                <style ref={cascadeStyleRef} id="cascadeStyles" />

                {/* ─── Chat Header (Internal Controls) ─── */}
                <div class="flex items-center justify-between px-3 py-2 bg-[var(--bg-glass)] border-b border-[var(--border)]">
                    <button
                        class="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-[var(--bg-glass)] transition-colors"
                        id="windowSelector"
                        onClick={() => {
                            setWindowDropdownOpen(prev => !prev);
                            setShowWorkspacePicker(false);
                        }}
                    >
                        <span class={`w-2 h-2 rounded-full ${win.windows.length > 0 && win.activeTargetId ? 'bg-[var(--success)] shadow-[0_0_8px_var(--success)]' : 'bg-[var(--text-muted)]'}`} />
                        <span class="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                            {win.activeWindowName}
                        </span>
                        <span class="text-[var(--text-muted)] text-[10px]">▼</span>
                    </button>
                    
                    <div class="flex items-center gap-1">
                        <button class="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] rounded-md transition-all" title={t('mobile.chat.pastChats')} onClick={() => win.loadChatHistory()}>
                            <Clock size={14} />
                        </button>
                        <button 
                            class={`p-2 hover:bg-[var(--bg-glass)] rounded-md transition-all ${fullscreen ? 'text-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                            title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                            onClick={() => setFullscreen(f => !f)}
                        >
                            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </button>
                        <button class="p-2 text-[var(--brand)] hover:brightness-125 hover:bg-[var(--bg-glass)] rounded-md transition-all" title={t('mobile.chat.newChat')} onClick={() => win.startNewChat()}>
                            <Plus size={14} />
                        </button>
                    </div>

                    {/* Window Dropdown (Repositioned) */}
                    {windowDropdownOpen && (
                        <div class="absolute top-12 left-2 z-[200] w-64 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-2xl backdrop-blur-xl ring-1 ring-[var(--brand)]/20" id="windowDropdown" ref={windowDropdownRef}>
                            {/* ... (Existing dropdown content remains similar but with updated styling) ... */}
                            {showWorkspacePicker ? (
                                <>
                                    <div class="flex items-center gap-2 px-3.5 py-3 border-b border-[var(--border)] text-[var(--text-primary)] font-semibold text-sm">
                                        <Monitor size={18} />
                                        <span class="flex-1">{t('mobile.chat.openNewWindow')}</span>
                                    </div>
                                    <div class="max-h-[50vh] overflow-y-auto p-1">
                                        <div
                                            class="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer rounded-lg transition-colors duration-150 active:bg-white/[0.08] bg-[rgba(14,165,233,0.08)] border border-[rgba(14,165,233,0.2)] mb-1"
                                            onClick={() => { win.launchNewWindow(); setWindowDropdownOpen(false); }}
                                        >
                                            <div class="w-7 h-7 flex items-center justify-center text-[var(--text-muted)]">
                                                <Monitor size={20} />
                                            </div>
                                            <div class="flex-1 min-w-0">
                                                <div class="text-[13px] text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">{t('mobile.chat.emptyWindow')}</div>
                                                <div class="text-[11px] text-[var(--text-muted)] mt-0.5">{t('mobile.chat.noFolder')}</div>
                                            </div>
                                        </div>
                                        {win.workspaces.map((ws: { name: string; path: string }) => (
                                            <div
                                                key={ws.path}
                                                class="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer rounded-lg transition-colors duration-150 active:bg-white/[0.08]"
                                                onClick={() => { win.launchNewWindow(ws.path); setWindowDropdownOpen(false); }}
                                            >
                                                <div class="w-7 h-7 flex items-center justify-center text-[var(--text-muted)]">
                                                    <FolderOpen size={20} />
                                                </div>
                                                <div class="flex-1 min-w-0">
                                                    <div class="text-[13px] text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">{ws.name}</div>
                                                    <div class="text-[11px] text-[var(--text-muted)] mt-0.5">{ws.path.replace(/^\/Users\/[^/]+/, '~')}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div class="flex gap-2 px-3 py-2.5 border-t border-[var(--border)]">
                                        <button class="flex-1 py-2 px-3 bg-[var(--bg-glass)] border border-[var(--border)] rounded-lg text-[var(--text-secondary)] text-xs cursor-pointer flex items-center justify-center gap-1.5 transition-all duration-200 hover:bg-[rgba(14,165,233,0.1)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]" onClick={() => setShowWorkspacePicker(false)}>
                                            <ArrowLeft size={14} />
                                            Back
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div class="px-3.5 pt-2.5 pb-1.5 text-[11px] font-semibold uppercase text-[var(--text-muted)] tracking-wider">{t('mobile.chat.windows')}</div>
                                    {win.windows.length === 0 ? (
                                        <div class="text-center p-6 text-[var(--text-muted)] text-[13px] flex flex-col items-center gap-2">
                                            <Monitor size={32} strokeWidth={1.5} className="opacity-40" />
                                            <div>{t('mobile.chat.noWindows')}</div>
                                        </div>
                                    ) : (
                                        win.windows.map(w => {
                                            const title = w.title.split('—')[0].trim();
                                            const isActive = w.id === win.activeTargetId;
                                            return (
                                                <div
                                                    key={w.id}
                                                    class={`group flex items-center gap-2.5 px-3 py-2.5 cursor-pointer rounded-lg transition-colors duration-150 active:bg-white/[0.08] ${isActive ? 'bg-[rgba(14,165,233,0.1)] border border-[rgba(14,165,233,0.3)]' : ''}`}
                                                    onClick={() => { win.switchWindow(w.id); setWindowDropdownOpen(false); }}
                                                >
                                                    <div class={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-[var(--success)] shadow-[0_0_6px_var(--success)]' : 'bg-[var(--text-muted)]'}`} />
                                                    <div class="flex-1 min-w-0">
                                                        <div class="text-[13px] text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">{title || w.title}</div>
                                                        <div class="text-[11px] text-[var(--text-muted)] mt-0.5">Port {w.port}</div>
                                                    </div>
                                                    {isActive ? (
                                                        <span class="text-[var(--accent-primary)] flex">
                                                            <Check size={14} strokeWidth={2.5} />
                                                        </span>
                                                    ) : (
                                                        <button
                                                            class="w-6 h-6 flex items-center justify-center rounded-md text-[var(--text-muted)] opacity-50 active:opacity-100 active:bg-red-500/20 active:text-red-400 transition-all duration-150"
                                                            title="Close window"
                                                            onClick={(e) => { e.stopPropagation(); win.closeWindow(w.id); setWindowDropdownOpen(false); }}
                                                        >
                                                            <X size={12} strokeWidth={2.5} />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                    <div class="flex gap-2 px-3 py-2.5 border-t border-[var(--border)]">
                                        <button class="flex-1 py-2 px-3 bg-[var(--bg-glass)] border border-[var(--border)] rounded-lg text-[var(--text-secondary)] text-xs cursor-pointer flex items-center justify-center gap-1.5 transition-all duration-200 hover:bg-[rgba(14,165,233,0.1)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]" onClick={async () => { showToast('Refreshing...', 'info'); const found = await win.discoverWindows(); showToast(`Found ${found.length} window${found.length !== 1 ? 's' : ''}`, found.length > 0 ? 'success' : 'info'); }}>
                                            <RefreshCw size={14} />
                                            Refresh
                                        </button>
                                        <button class="flex-1 py-2 px-3 bg-[var(--bg-glass)] border border-[var(--border)] rounded-lg text-[var(--text-secondary)] text-xs cursor-pointer flex items-center justify-center gap-1.5 transition-all duration-200 hover:bg-[rgba(14,165,233,0.1)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]" onClick={() => { win.loadWorkspaces(); setShowWorkspacePicker(true); }}>
                                            <Monitor size={14} />
                                            {t('mobile.chat.newWindow')}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* ─── Chat History Modal ─── */}
                <ChatHistoryModal
                    open={win.chatHistoryOpen}
                    loading={win.chatHistoryLoading}
                    chats={win.chatHistory}
                    onSelect={(title) => win.selectChat(title)}
                    onClose={() => win.closeChatHistory()}
                    onNewChat={() => win.startNewChat()}
                    onRefresh={() => win.loadChatHistory()}
                />

                {/* ─── Live IDE Chat (Cascade Container) ─── */}
                <div
                    id="cascade-container"
                    ref={cascadeRef}
                    class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 pt-4 hide-scrollbar"
                >
                    <div class="flex flex-col items-center justify-center h-full gap-4 text-[var(--text-muted)] opacity-50">
                        <Terminal size={48} strokeWidth={1} />
                        <span class="text-xs uppercase tracking-widest">{t('mobile.chat.loadingLiveChat')}</span>
                    </div>
                </div>

                {/* ─── Controls & Input Section ─── */}
                <div className="mt-auto bg-[var(--bg-glass)] border-t border-[var(--border)] p-2 space-y-2">
                    {/* Model/Mode Row */}
                    <div class="flex gap-2">
                        <button class="flex-1 flex items-center justify-between px-3 py-1.5 bg-[var(--bg-dark)] border border-[var(--border)] rounded group hover:border-[var(--brand)]/50 transition-all" id="modelSelectorBtn" onClick={toggleModelDropdown}>
                            <span class="text-[10px] text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap">{currentModel}</span>
                            <span class="text-[var(--text-muted)] text-[8px] group-hover:text-[var(--brand)]">▼</span>
                        </button>
                        <button class="flex-1 flex items-center justify-between px-3 py-1.5 bg-[var(--bg-dark)] border border-[var(--border)] rounded group hover:border-[var(--brand)]/50 transition-all" id="modeSelectorBtn" onClick={toggleModeDropdown}>
                            <span class="text-[10px] text-[var(--text-secondary)] tracking-wider font-bold uppercase">{modeLabel}</span>
                            <span class="text-[var(--text-muted)] text-[8px] group-hover:text-[var(--brand)]">▼</span>
                        </button>
                    </div>

                    {/* Model/Mode Dropdowns (Relative within wrapper) */}
                    <div className="relative">
                        {modelDropdownOpen && (
                            <div class="absolute bottom-full left-0 w-full mb-2 bg-[var(--bg-card)] border border-[var(--border)] rounded shadow-xl max-h-48 overflow-y-auto z-[210]" id="modelDropdown">
                                <div class="px-3 py-2 text-[10px] font-bold text-[var(--brand)] uppercase tracking-widest border-b border-[var(--border)] bg-[var(--bg-glass)]">{t('mobile.chat.selectModel')}</div>
                                <div id="modelList" class="p-1">
                                    {models.map(m => (
                                        <div
                                            key={m}
                                            class={`px-3 py-2 text-xs rounded cursor-pointer transition-all ${m === currentModel ? 'bg-[var(--brand)]/10 text-[var(--brand)] font-bold' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-glass)] hover:text-[var(--text-primary)]'}`}
                                            onClick={() => selectModel(m)}
                                        >
                                            {m}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {modeDropdownOpen && (
                            <div class="absolute bottom-full left-0 w-full mb-2 bg-[var(--bg-card)] border border-[var(--border)] rounded shadow-xl z-[210]" id="modeDropdown">
                                <div class="px-3 py-2 text-[10px] font-bold text-[var(--brand)] uppercase tracking-widest border-b border-[var(--border)] bg-[var(--bg-glass)]">{t('mobile.chat.conversationMode')}</div>
                                <div class="p-1 space-y-1">
                                    <div
                                        class={`p-3 rounded-md cursor-pointer transition-all border ${currentMode === 'Planning' ? 'bg-[var(--brand)]/5 border-[var(--brand)]/30' : 'border-transparent hover:bg-[var(--bg-glass)]'}`}
                                        onClick={() => selectMode('Planning')}
                                    >
                                        <div class={`text-xs font-bold uppercase tracking-wider ${currentMode === 'Planning' ? 'text-[var(--brand)]' : 'text-[var(--text-primary)]'}`}>{t('mobile.chat.planning')}</div>
                                        <div class="text-[10px] text-[var(--text-muted)] mt-0.5">{t('mobile.chat.planningDesc')}</div>
                                    </div>
                                    <div
                                        class={`p-3 rounded-md cursor-pointer transition-all border ${currentMode === 'Fast' ? 'bg-[var(--brand)]/5 border-[var(--brand)]/30' : 'border-transparent hover:bg-[var(--bg-glass)]'}`}
                                        onClick={() => selectMode('Fast')}
                                    >
                                        <div class={`text-xs font-bold uppercase tracking-wider ${currentMode === 'Fast' ? 'text-[var(--brand)]' : 'text-[var(--text-primary)]'}`}>{t('mobile.chat.fast')}</div>
                                        <div class="text-[10px] text-[var(--text-muted)] mt-0.5">{t('mobile.chat.fastDesc')}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Quick Actions */}
                    <div class="flex gap-1 overflow-x-auto pb-1 hide-scrollbar">
                        {['continue', 'yes', 'no', 'stop', 'help'].map(cmd => (
                            <button 
                                key={cmd}
                                class="px-3 py-1 bg-[var(--bg-glass)] border border-[var(--border)] rounded-full text-[10px] text-[var(--text-secondary)] hover:text-[var(--brand)] hover:border-[var(--brand)] transition-all whitespace-nowrap active:scale-95" 
                                onClick={() => sendQuick(cmd)}
                            >
                                {cmd === 'continue' ? t('mobile.chat.continue') : cmd === 'help' ? t('mobile.chat.help') : cmd}
                            </button>
                        ))}
                    </div>

                    {/* Remote Prompt Hints */}
                    {remotePrompts.length > 0 && (
                        <div class="flex gap-2 overflow-x-auto hide-scrollbar opacity-60 hover:opacity-100 transition-opacity">
                            {remotePrompts.map((msg, i) => (
                                <div key={i} class="text-[9px] bg-[var(--bg-dark)] px-2 py-1 rounded border border-[var(--border)] whitespace-nowrap font-mono text-[var(--text-muted)]">
                                    {msg.content.substring(0, 30)}{msg.content.length > 30 ? '...' : ''}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Chat Input Wrapper */}
                    <div class="space-y-1">
                        {batchMode && batchCount > 0 && (
                            <div class="flex items-center justify-between px-3 py-1.5 bg-[var(--brand)]/10 rounded-t border-x border-t border-[var(--brand)]/20 animate-pulse">
                                <span class="text-[10px] text-[var(--brand)] font-bold uppercase tracking-tighter">
                                    {batchCount} QUEUED
                                </span>
                                <button
                                    onClick={flushBatch}
                                    class="text-[9px] font-bold px-2 py-0.5 bg-[var(--brand)] text-white rounded hover:brightness-110 active:scale-95 transition-all"
                                >
                                    {t('mobile.chat.sendAll')}
                                </button>
                            </div>
                        )}
                        <div class={`relative flex items-center bg-[var(--bg-dark)] border transition-all duration-300 rounded overflow-hidden ${batchMode ? 'border-[var(--brand)] ring-1 ring-[var(--brand)]/30' : 'border-[var(--border)] focus-within:border-[var(--brand)]/50 focus-within:ring-1 focus-within:ring-[var(--brand)]/20'}`}>
                            <button
                                onClick={() => { setBatchMode(p => !p); setBatchCount(0); }}
                                class={`p-3 transition-colors ${batchMode ? 'text-[var(--brand)]' : 'text-[var(--text-muted)]'}`}
                                title={batchMode ? t('mobile.chat.batchModeOn') : t('mobile.chat.singleMode')}
                            >
                                <Plus size={18} class={batchMode ? 'rotate-45 transition-transform' : 'transition-transform'} />
                            </button>
                            <textarea
                                ref={chatInputRef}
                                id="chatInput"
                                class="flex-1 bg-transparent border-none text-[15px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:ring-0 py-3 resize-none overflow-y-auto"
                                style={{ height: 'auto', maxHeight: '120px' }}
                                rows={1}
                                placeholder={batchMode ? t('mobile.chat.queueMessage') : t('mobile.chat.sendMessage')}
                                autoComplete="off"
                                onKeyDown={handleKeyDown}
                                onInput={handleInput}
                            />
                            <button class="p-3 text-[var(--brand)] hover:brightness-125 transition-all active:scale-90" onClick={sendMessage}>
                                <Send size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

        </OrnamentWrapper>
    );
}
