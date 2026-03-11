/**
 * AssistPanel — Supervisor chat with streaming + Task Queue
 * Ported from public/js/mobile/assist.js (217 lines) + task-queue.js (141 lines)
 */
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { authFetch, getServerUrl } from '../hooks/useApi';
import { escapeHtml } from '../utils';
import { Bot, Send, ClipboardList, Brain, X } from 'lucide-preact';
import { useTranslation } from '../i18n';
import { OrnamentWrapper } from './OrnamentWrapper';

// ─── Types ──────────────────────────────────────────────────────────
interface AssistMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: number;
}

interface QueueTask {
    instruction: string;
    status: 'pending' | 'running' | 'completed';
}

// ─── Helpers ────────────────────────────────────────────────────────
function formatAssistMarkdown(text: string): string {
    let s = escapeHtml(text);
    // assist-code-block / assist-inline-code classes are defined in components.css
    s = s.replace(/```([\s\S]*?)```/g, '<pre class="assist-code-block">$1</pre>');
    s = s.replace(/`([^`]+)`/g, '<code class="assist-inline-code">$1</code>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\n/g, '<br>');
    return s;
}

// ─── AssistPanel Component ──────────────────────────────────────────
export function AssistPanel() {
    const { t } = useTranslation();
    // Chat state
    const [messages, setMessages] = useState<AssistMessage[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [streamingContent, setStreamingContent] = useState<string | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Task queue state
    const [taskQueue, setTaskQueue] = useState<QueueTask[]>([]);
    const [taskInput, setTaskInput] = useState('');
    const [taskExpanded, setTaskExpanded] = useState(false);

    // Supervisor status
    const [supervisorStatus, setSupervisorStatus] = useState<{ enabled: boolean; status: string }>({ enabled: false, status: 'idle' });

    // ─── Load chat history ──────────────────────────────────────────
    const loadHistory = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/supervisor/chat/history`);
            const data = await res.json();
            if (data.messages && data.messages.length > 0) {
                setMessages(data.messages);
            }
        } catch (_e) { /* silent */ }
    }, []);

    // ─── Load task queue ────────────────────────────────────────────
    const refreshTaskQueue = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/supervisor/queue`);
            const data = await res.json();
            setTaskQueue(data.queue || []);
        } catch (_e) { /* silent */ }
    }, []);

    // ─── Load supervisor status ─────────────────────────────────────
    const loadStatus = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/admin/supervisor`);
            const d = await res.json();
            setSupervisorStatus({ enabled: !!d.enabled, status: d.status || 'idle' });
        } catch (_e) { /* silent */ }
    }, []);

    // Load on mount
    useEffect(() => {
        loadHistory();
        refreshTaskQueue();
        loadStatus();
        const interval = setInterval(loadStatus, 10000);
        return () => clearInterval(interval);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Scroll to bottom on new messages
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingContent]);

    // ─── Send message (SSE streaming) ───────────────────────────────
    const sendMessage = useCallback(async () => {
        const msg = input.trim();
        if (!msg || sending) return;

        // Add user message
        const userMsg: AssistMessage = { role: 'user', content: msg, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setSending(true);
        setStreamingContent('');

        let rawText = '';

        try {
            const res = await authFetch(`${getServerUrl()}/api/supervisor/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg }),
            });

            const reader = res.body?.getReader();
            if (!reader) throw new Error('No reader');

            const decoder = new TextDecoder();
            let buffer = '';


            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;

                buffer += decoder.decode(chunk.value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(trimmed.substring(6));
                        if (data.token) {
                            rawText += data.token;
                            setStreamingContent(rawText);
                        }
                        if (data.file_content) {
                            // Server sends file_content AFTER done — update the text
                            rawText = data.file_content;
                            setStreamingContent(rawText);
                        }
                        if (data.error) {
                            rawText += `\n\nError: ${data.error}`;
                            setStreamingContent(rawText);
                        }
                        if (data.done) {
                            // Don't finalize here — file_content may follow after done
                            // Don't finalize yet — file_content may follow
                        }
                    } catch (_parseErr) { /* skip malformed SSE */ }
                }
            }

            // Finalize: stream ended — create the assistant message
            if (rawText) {
                const assistMsg: AssistMessage = { role: 'assistant', content: rawText, timestamp: Date.now() };
                setMessages(prev => [...prev, assistMsg]);
            }
            setStreamingContent(null);
        } catch (_e) {
            setStreamingContent(null);
            const errMsg: AssistMessage = { role: 'assistant', content: t('mobile.assist.connectionError'), timestamp: Date.now() };
            setMessages(prev => [...prev, errMsg]);
        } finally {
            setSending(false);
        }
    }, [input, sending]);

    // ─── Task queue actions ─────────────────────────────────────────
    const addTask = useCallback(async () => {
        const instruction = taskInput.trim();
        if (!instruction) return;
        setTaskInput('');
        try {
            await authFetch(`${getServerUrl()}/api/supervisor/queue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instruction }),
            });
            refreshTaskQueue();
        } catch (_e) { /* silent */ }
    }, [taskInput, refreshTaskQueue]);

    const removeTask = useCallback(async (index: number) => {
        try {
            await authFetch(`${getServerUrl()}/api/supervisor/queue/${index}`, { method: 'DELETE' });
            refreshTaskQueue();
        } catch (_e) { /* silent */ }
    }, [refreshTaskQueue]);

    const clearCompleted = useCallback(async () => {
        try {
            await authFetch(`${getServerUrl()}/api/supervisor/queue`, { method: 'DELETE' });
            refreshTaskQueue();
        } catch (_e) { /* silent */ }
    }, [refreshTaskQueue]);

    // ─── Format time ────────────────────────────────────────────────
    const fmtTime = (ts?: number) => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    // ─── Render ─────────────────────────────────────────────────────
    return (
        <OrnamentWrapper 
            title={t('mobile.assist.title')} 
            icon={<Bot size={16} />}
            className="flex-1 min-h-0 m-2"
        >
            <div className="flex-1 flex flex-col min-h-0 relative">
                {/* Supervisor status (Small notification within panel) */}
                <div className="p-2 bg-[var(--bg-glass)] border-b border-[var(--border)] flex justify-end">
                    {(() => {
                        const statusMap: Record<string, { color: string; label: string }> = {
                            idle: { color: '#a6e3a1', label: t('mobile.assist.idle') },
                            thinking: { color: '#f9e2af', label: t('mobile.assist.thinking') },
                            acting: { color: '#89b4fa', label: t('mobile.assist.acting') },
                            error: { color: '#f38ba8', label: t('mobile.common.error') },
                        };
                        if (!supervisorStatus.enabled) {
                            return (
                                <div className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.08] text-[var(--text-muted)] flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 inline-block" />
                                    {t('mobile.assist.disabled')}
                                </div>
                            );
                        }
                        const s = statusMap[supervisorStatus.status] || statusMap.idle;
                        return (
                            <div className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.08] text-[var(--text-muted)] flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: s.color }} />
                                {s.label}
                            </div>
                        );
                    })()}
                </div>

            {/* Chat messages */}
            <div ref={containerRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                {messages.length === 0 && !streamingContent && (
                    <div className="text-center py-10 px-5 text-[var(--text-muted)]">
                        <div className="mb-3 text-[var(--accent-primary)] flex justify-center"><Bot size={40} /></div>
                        <div className="text-lg font-semibold mb-2 text-[var(--text)]">{t('mobile.assist.supervisorAssist')}</div>
                        <div className="text-[13px] leading-relaxed">Chat with your AI supervisor. Ask about agent activity, project status, or give instructions.</div>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                            className={`max-w-[85%] px-3.5 py-2.5 text-sm leading-normal ${msg.role === 'user'
                                ? 'bg-[var(--accent-primary)] text-white rounded-[16px_16px_4px_16px]'
                                : 'bg-[var(--bg-glass)] border border-[var(--border)] rounded-[16px_16px_16px_4px]'
                                }`}
                        >
                            {msg.role === 'assistant' && (
                                <div className="text-[11px] opacity-70 mb-1 font-semibold text-[var(--accent-primary)] flex items-center gap-1">
                                    <Brain size={12} /> {t('mobile.assist.supervisor')}
                                </div>
                            )}
                            <div className="text-[var(--text-primary)]"
                                dangerouslySetInnerHTML={{ __html: msg.role === 'user' ? escapeHtml(msg.content) : formatAssistMarkdown(msg.content) }} />
                            {msg.timestamp && (
                                <div className={`text-[10px] opacity-50 mt-1 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                                    {fmtTime(msg.timestamp)}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {/* Streaming response */}
                {streamingContent !== null && (
                    <div className="flex justify-start">
                        <div className="max-w-[85%] px-3.5 py-2.5 rounded-[16px_16px_16px_4px] bg-[var(--bg-glass)] border border-[var(--border)]">
                            <div className="text-[11px] opacity-70 mb-1 font-semibold text-[var(--accent-primary)] flex items-center gap-1">
                                    <Brain size={12} /> {t('mobile.assist.supervisor')}
                            </div>
                            {streamingContent ? (
                                <div className="text-[var(--text-primary)]" dangerouslySetInnerHTML={{ __html: formatAssistMarkdown(streamingContent) }} />
                            ) : (
                                <span className="inline-flex gap-1 py-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-pulse" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-pulse [animation-delay:0.2s]" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-pulse [animation-delay:0.4s]" />
                                </span>
                            )}
                        </div>
                    </div>
                )}

                <div ref={chatEndRef} />
            </div>

            {/* Task Queue (collapsible) */}
            {(taskQueue.length > 0 || taskExpanded) && (
                <div className="border-t border-[var(--border)] bg-white/[0.02]">
                    <div
                        className="flex justify-between items-center px-4 py-2 cursor-pointer"
                        onClick={() => setTaskExpanded(!taskExpanded)}
                    >
                        <span className="text-[13px] font-semibold text-[var(--text)] flex items-center gap-1">
                            <ClipboardList size={14} /> {t('mobile.assist.taskQueue')} ({taskQueue.length})
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">{taskExpanded ? '▲' : '▼'}</span>
                    </div>

                    {taskExpanded && (
                        <div className="px-4 pb-2">
                            {taskQueue.length === 0 ? (
                                <div className="text-xs text-[var(--text-muted)] text-center p-2">
                                    {t('mobile.assist.noTasks')}
                                </div>
                            ) : (
                                <div className="max-h-[150px] overflow-y-auto flex flex-col gap-1">
                                    {taskQueue.map((t, i) => {
                                        const statusIcon = t.status === 'completed' ? '✓' : t.status === 'running' ? '▶' : '⏳';
                                        const statusColor = t.status === 'completed' ? '#a6e3a1' : t.status === 'running' ? 'var(--accent)' : 'var(--text-muted)';
                                        return (
                                            <div key={i} className="flex items-center gap-2 text-xs py-1">
                                                <span style={{ color: statusColor }}>{statusIcon}</span>
                                                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: statusColor }}>
                                                    {t.instruction.substring(0, 60)}{t.instruction.length > 60 ? '...' : ''}
                                                </span>
                                                {t.status !== 'completed' && (
                                                    <button
                                                        className="bg-transparent border-none text-[var(--text-muted)] cursor-pointer flex"
                                                        onClick={(e) => { e.stopPropagation(); removeTask(i); }}
                                                    ><X size={14} /></button>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {taskQueue.some(t => t.status === 'completed') && (
                                        <button
                                            className="text-[11px] text-[var(--text-muted)] bg-transparent border-none cursor-pointer text-center p-1"
                                            onClick={clearCompleted}
                                        >{t('mobile.assist.clearCompleted')}</button>
                                    )}
                                </div>
                            )}

                            {/* Add task input */}
                            <div className="flex gap-1.5 mt-2">
                                <input
                                    type="text"
                                    value={taskInput}
                                    onInput={(e) => setTaskInput((e.target as HTMLInputElement).value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
                                    placeholder={t('mobile.assist.addTask')}
                                    className="flex-1 px-2.5 py-1.5 bg-white/5 border border-[var(--border)] rounded-md text-[var(--text)] text-xs outline-none"
                                />
                                <button
                                    onClick={addTask}
                                    className="px-3 py-1.5 bg-[var(--accent-primary)] text-[var(--bg-card)] border-none rounded-md text-xs cursor-pointer"
                                >+</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Chat input */}
            <div className="flex gap-2 px-4 py-4 border-t border-[var(--border)] bg-[var(--bg-card)]">
                <input
                    type="text"
                    value={input}
                    onInput={(e) => setInput((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !sending) sendMessage(); }}
                    placeholder={t('mobile.assist.askSupervisor')}
                    disabled={sending}
                    className="flex-1 px-4 py-3 bg-white/5 border border-[var(--border)] rounded-[10px] text-[var(--text)] text-sm outline-none"
                />
                <button
                    onClick={sendMessage}
                    disabled={sending || !input.trim()}
                    className={`w-10 h-10 rounded-xl border-none flex items-center justify-center shrink-0 ${sending
                        ? 'bg-white/5 text-[var(--text-muted)] cursor-not-allowed'
                        : 'bg-[var(--accent-primary)] text-[var(--bg-card)] cursor-pointer'
                        }`}
                >
                    {sending ? '...' : <Send size={18} />}
                </button>
            </div>
            </div>
        </OrnamentWrapper>
    );
}
