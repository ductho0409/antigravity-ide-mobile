/**
 * CDP Chat Scrape — Scrape chat messages and panel content
 */
import { findEditorTarget, connectToTarget } from './core.js';

interface ChatMessage {
    role: 'user' | 'agent';
    content: string;
    timestamp: string;
}

interface ChatMessagesResult {
    messages: ChatMessage[];
    count: number;
    note?: string;
}

interface PanelContentResult {
    found: boolean;
    selector?: string;
    content: string;
    html?: string;
}

interface ConversationTextResult {
    found: boolean;
    rawText?: string;
    source?: string;
    lines?: string[];
}

/**
 * [DATA] GET_CHAT_MESSAGES
 * Cào (scrape) các tin nhắn của cuộc trò chuyện đang được hiển thị trực tiếp trên giao diện IDE (Cursor/VSCode).
 * Đây là một cơ chế Fallback dự phòng, dùng DOM của IDE để đọc nội dung text hiển thị, sau đó lọc các 
 * câu lệnh metadata/thông báo hệ thống qua một danh sách \`blacklist\`.
 * 
 * Lưu ý: Luồng stream xịn nhất nên đi qua MCP (Model Context Protocol), hàm này chỉ là đọc trộm text hiển thị màn hình 
 * khi hệ thống socket chính gặp vấn đề kết nối.
 *
 * @returns {Promise<ChatMessagesResult>} Mảng danh sách các tin nhắn đã lọc tạp âm (tối đa 20 tin nhắn gần nhất)
 * bao gồm \`role\` ('user' hoặc 'agent') và \`content\` là nội dung text.
 */
export async function getChatMessages(): Promise<ChatMessagesResult> {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    const messages = [];
                    
                    const blacklist = [
                        /^(gemini|claude|gpt|model|opus|sonnet|flash)/i,
                        /^(pro|low|high|medium|thinking)/i,
                        /^(submit|cancel|dismiss|retry)/i,
                        /^(planning|execution|verification)/i,
                        /^(agent|assistant|user)$/i,
                        /^\\d+:\\d+/,
                        /terminated due to error/i,
                        /troubleshooting guide/i,
                        /can plan before executing/i,
                        /deep research.*complex tasks/i,
                        /conversation mode/i,
                        /fast agent/i,
                        /\\(thinking\\)/i,
                        /ask anything/i,
                        /add context/i,
                        /workflows/i,
                        /mentions/i
                    ];
                    
                    function isBlacklisted(text) {
                        const trimmed = text.trim();
                        if (trimmed.length < 20) return true;
                        if (trimmed.split(' ').length < 4) return true;
                        
                        for (const pattern of blacklist) {
                            if (pattern.test(trimmed)) return true;
                        }
                        return false;
                    }
                    
                    const conversationSelectors = [
                        '.conversation-content',
                        '.agent-response',
                        '.assistant-message',
                        '.user-query',
                        '[data-mode-id] .view-lines',
                        '.auxiliary-bar .content',
                        '.panel-content'
                    ];
                    
                    for (const sel of conversationSelectors) {
                        const els = document.querySelectorAll(sel);
                        for (const el of els) {
                            const text = el.innerText?.trim();
                            if (text && !isBlacklisted(text) && text.length > 30 && text.length < 5000) {
                                const hasProperSentences = /[.!?]/.test(text);
                                const wordCount = text.split(/\\s+/).length;
                                
                                if (hasProperSentences && wordCount > 5) {
                                    const classStr = (el.className || '').toLowerCase();
                                    let role = 'agent';
                                    if (classStr.includes('user') || classStr.includes('human')) {
                                        role = 'user';
                                    }
                                    
                                    messages.push({
                                        role,
                                        content: text.substring(0, 1500),
                                        timestamp: new Date().toISOString()
                                    });
                                }
                            }
                        }
                        if (messages.length > 0) break;
                    }
                    
                    return { 
                        messages: messages.slice(-20), 
                        count: messages.length,
                        note: 'Use MCP broadcast_interaction for reliable chat streaming'
                    };
                })()
            `,
            returnByValue: true
        });

        return (result as Record<string, Record<string, unknown>>).result?.value as ChatMessagesResult || { messages: [], count: 0 };
    } finally {
        client.close();
    }
}

/**
 * [DATA] GET_AGENT_PANEL_CONTENT
 * Lấy toàn bộ nội dung hiển thị (cả HTML và Text) của cột Chat/Agent Panel bên phải IDE.
 * Hàm này hữu ích cho mục đích Debug hoặc Snapshot để ứng dụng mobile biết được IDE 
 * đang hiển thị màn hình hay trạng thái panel nào. 
 *
 * @returns {Promise<PanelContentResult>} Kết quả chứa \`found\` (tìm thấy panel hay không),
 * \`selector\` (string CSS dùng để query ra panel đó) và \`content\` (đoạn plain text tối đa 5000 ký tự).
 */
export async function getAgentPanelContent(): Promise<PanelContentResult> {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    const panelSelectors = [
                        '.agent-panel',
                        '.chat-panel', 
                        '[class*="agent"]',
                        '[class*="chat-view"]',
                        '.panel.right',
                        '.sidebar-right',
                        '.auxiliary-bar'
                    ];
                    
                    for (const sel of panelSelectors) {
                        const panel = document.querySelector(sel);
                        if (panel) {
                            return {
                                found: true,
                                selector: sel,
                                content: panel.innerText?.substring(0, 5000) || '',
                                html: panel.innerHTML?.substring(0, 10000) || ''
                            };
                        }
                    }
                    
                    return {
                        found: false,
                        content: document.body.innerText?.substring(0, 5000) || ''
                    };
                })()
            `,
            returnByValue: true
        });

        return (result as Record<string, Record<string, unknown>>).result?.value as PanelContentResult || { found: false, content: '' };
    } finally {
        client.close();
    }
}

/**
 * [DATA] GET_CONVERSATION_TEXT
 * Lấy toàn bộ văn bản (plaintext) có thể nhìn thấy được từ khu vực hội thoại/panel bên phải.
 * Chức năng tương tự \`getAgentPanelContent\` nhưng chuyên biệt hơn trong việc chia đoạn văn (lines), 
 * hữu ích cho việc trích xuất nội dung văn bản cho mục đích phân tích (analytics) hoặc render đơn giản.
 *
 * @returns {Promise<ConversationTextResult>} Kết quả chứa raw text (tối đa 8000 ký tự)
 * và một mảng \`lines\` phân tách từng dòng text để mobile app thao tác dễ hơn.
 */
export async function getConversationText(): Promise<ConversationTextResult> {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    const rightPanel = document.querySelector('.split-view-container .split-view-view:last-child') 
                        || document.querySelector('.editor-group-container + *')
                        || document.querySelector('.auxiliary-bar-content')
                        || document.querySelector('[id*="workbench.panel"]');
                    
                    if (rightPanel) {
                        const text = rightPanel.innerText || '';
                        const lines = text.split('\\n').filter(l => l.trim().length > 20);
                        
                        return {
                            found: true,
                            rawText: text.substring(0, 8000),
                            lines: lines.slice(0, 50)
                        };
                    }
                    
                    const markdownContainers = document.querySelectorAll('.rendered-markdown, .markdown-body, [class*="markdown"]');
                    if (markdownContainers.length > 0) {
                        const texts = Array.from(markdownContainers).map(el => el.innerText).filter(t => t.length > 30);
                        return {
                            found: true,
                            source: 'markdown',
                            lines: texts.slice(0, 20)
                        };
                    }
                    
                    return { found: false };
                })()
            `,
            returnByValue: true
        });

        return (result as Record<string, Record<string, unknown>>).result?.value as ConversationTextResult || { found: false };
    } finally {
        client.close();
    }
}
