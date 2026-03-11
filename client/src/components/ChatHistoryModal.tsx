/**
 * ChatHistoryModal — Past conversations modal
 * Ported from windows.js renderChatHistory()
 */
import type { ChatHistoryItem } from '../hooks/useWindows';
import { RefreshCw, X, Plus } from 'lucide-preact';
import { useTranslation } from '../i18n';

interface ChatHistoryModalProps {
    open: boolean;
    loading: boolean;
    chats: ChatHistoryItem[];
    onSelect: (title: string) => void;
    onClose: () => void;
    onNewChat: () => void;
    onRefresh: () => void;
}

export function ChatHistoryModal({ open, loading, chats, onSelect, onClose, onNewChat, onRefresh }: ChatHistoryModalProps) {
    const { t } = useTranslation();
    if (!open) return null;

    return (
        <div
            className="fixed top-[50px] left-3 right-3 z-[1001] bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl max-h-[70vh] overflow-y-auto backdrop-blur-[20px] shadow-[0_8px_32px_rgba(0,0,0,0.5)] animate-[windowSlideIn_0.2s_ease]"
            id="chatHistoryModal"
        >
            <div className="flex justify-between items-center px-4 py-3.5 border-b border-[var(--border)]">
                <h3 className="m-0 text-base text-[var(--text-primary)]">{t('mobile.chatHistory.title')}</h3>
                <div className="flex gap-2 items-center">
                    <button
                        className="bg-transparent border-none text-[var(--text-muted)] text-lg cursor-pointer p-1"
                        title="Refresh"
                        onClick={onRefresh}
                    >
                        <RefreshCw size={16} />
                    </button>
                    <button
                        className="bg-transparent border-none text-[var(--text-muted)] text-lg cursor-pointer p-1"
                        onClick={onClose}
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>
            <div className="p-2 max-h-[50vh] overflow-y-auto">
                {loading ? (
                    <div className="text-center p-10 text-[var(--text-muted)] text-sm">
                        <div className="text-2xl mb-2">⏳</div>
                        {t('mobile.chatHistory.loading')}
                    </div>
                ) : chats.length === 0 ? (
                    <div className="text-center p-6 text-[var(--text-muted)] text-sm">
                        {t('mobile.chatHistory.empty')}
                        <br />
                        <small className="text-[var(--text-muted)]">
                            {t('mobile.chatHistory.hint')}
                        </small>
                    </div>
                ) : (
                    chats.map((c, i) => (
                        <div
                            key={c.title}
                            className="flex items-center gap-2.5 p-3 cursor-pointer rounded-lg transition-colors duration-150 active:bg-white/[0.08]"
                            onClick={() => onSelect(c.title)}
                        >
                            <div className="text-sm shrink-0">{i === 0 ? '🟢' : '💬'}</div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">{c.title.substring(0, 60)}</div>
                                {c.date && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{c.date}</div>}
                            </div>
                        </div>
                    ))
                )}
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)]">
                <button
                    className="flex-1 py-2.5 bg-[var(--accent-primary)] text-white border-transparent rounded-[10px] text-[13px] font-semibold cursor-pointer transition-all duration-200 active:scale-[0.97] flex items-center justify-center gap-1.5"
                    onClick={() => {
                        onClose();
                        onNewChat();
                    }}
                >
                    <Plus size={14} /> {t('mobile.chatHistory.newChat')}
                </button>
            </div>
        </div>
    );
}
