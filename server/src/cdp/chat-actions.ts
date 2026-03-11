/**
 * CDP Chat Actions — New chat, history, select chat
 */
import { withContexts, withCDP } from './core.js';
import type { CDPCallFn } from './core.js';

interface ChatActionResult {
    success: boolean;
    method?: string;
    error?: string;
}

interface ChatItem {
    title: string;
    date: string;
}

interface ChatHistoryResult {
    success: boolean;
    chats: ChatItem[];
    panelFound?: boolean;
    error?: string;
}

/**
 * [ACTION] START_NEW_CHAT
 * Kích hoạt luồng tạo cuộc hội thoại mới trên giao diện Antigravity IDE.
 * Hàm này thực hiện việc tìm kiếm nút "New Conversation" (hoặc biểu tượng dấu cộng "+") 
 * trên giao diện thông qua DOM manipulation và sử dụng Giao thức CDP để click vào nút đó.
 * 
 * @returns {Promise<ChatActionResult>} Kết quả thực thi bao gồm trạng thái thành công 
 * và phương thức đã dùng để click (method) hoặc lỗi nếu không tìm thấy nút.
 */
export async function startNewChat(): Promise<ChatActionResult> {
    return withCDP<ChatActionResult>(8000, async (call: CDPCallFn) => {
        const FIND_NEW_CHAT = `(() => {
            const tooltipBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
            if (tooltipBtn && tooltipBtn.offsetParent !== null) {
                const r = tooltipBtn.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    tooltipBtn.click();
                    return { found: true, x: r.x + r.width/2, y: r.y + r.height/2, method: 'tooltip-id' };
                }
            }
            
            const allClickable = Array.from(document.querySelectorAll('a, button, [role="button"]'));
            const ariaBtn = allClickable.find(el => {
                if (el.offsetParent === null) return false;
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                const title = (el.getAttribute('title') || '').toLowerCase();
                return aria.includes('new conversation') || title.includes('new conversation') ||
                       aria.includes('start a new') || title.includes('start a new');
            });
            if (ariaBtn) {
                ariaBtn.click();
                const r = ariaBtn.getBoundingClientRect();
                return { found: true, x: r.x + r.width/2, y: r.y + r.height/2, method: 'aria-label' };
            }
            
            const topPlusBtn = allClickable.find(el => {
                if (el.offsetParent === null) return false;
                const rect = el.getBoundingClientRect();
                if (rect.top > 80 || rect.left < 800) return false;
                const svg = el.querySelector('svg');
                if (!svg) return false;
                const html = svg.innerHTML;
                return html.includes('M12 5') || html.includes('M5 12') || 
                       svg.classList.contains('lucide-plus');
            });
            if (topPlusBtn) {
                topPlusBtn.click();
                const r = topPlusBtn.getBoundingClientRect();
                return { found: true, x: r.x + r.width/2, y: r.y + r.height/2, method: 'top-plus-icon' };
            }
            
            return { found: false, error: 'New conversation button not found' };
        })()`;

        const findResult = await call('Runtime.evaluate', {
            expression: FIND_NEW_CHAT,
            returnByValue: true
        });

        const btn = (findResult as Record<string, Record<string, unknown>>).result?.value as { found: boolean; x?: number; y?: number; method?: string; error?: string } | undefined;

        if (btn?.found && btn.x !== undefined && btn.y !== undefined) {
            await call('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: Math.round(btn.x),
                y: Math.round(btn.y),
                button: 'left',
                clickCount: 1
            });
            await call('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: Math.round(btn.x),
                y: Math.round(btn.y),
                button: 'left',
                clickCount: 1
            });

            return { success: true, method: btn.method };
        }

        return { success: false, error: btn?.error || 'New chat button not found' };
    }, { success: false, error: 'WebSocket error' });
}

/**
 * [ACTION] CLOSE_HISTORY_PANEL
 * Đóng panel lịch sử chat hiện tại bằng cách gửi phím 'Escape' qua giao thức CDP.
 * Hữu ích để dọn dẹp focus sau khi mở panel lịch sử lên để quét mà không muốn chọn item nào.
 * 
 * @returns {Promise<ChatActionResult>} Kết quả thực thi.
 */
export async function closeHistoryPanel(): Promise<ChatActionResult> {
    return withCDP<ChatActionResult>(5000, async (call: CDPCallFn) => {
        await call('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Escape', code: 'Escape',
            windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
        });
        await call('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Escape', code: 'Escape',
            windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
        });
        return { success: true, method: 'escape_key' };
    }, { success: false, error: 'WebSocket error' });
}

/**
 * [ACTION] STOP_AGENT
 * Dừng agent đang chạy bằng cách:
 * 1. Tìm nút "Stop" trong cascade và click vào
 * 2. Nếu không tìm thấy, gửi phím Escape qua CDP
 */
export async function stopAgent(): Promise<ChatActionResult> {
    return withCDP<ChatActionResult>(8000, async (call: CDPCallFn) => {
        // Try to find and click the Stop button in the IDE UI
        const FIND_STOP = `(() => {
            // Look for stop button by text content
            const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
            for (const btn of allBtns) {
                if (btn.offsetParent === null) continue;
                const text = (btn.textContent || '').trim().toLowerCase();
                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                if (text === 'stop' || text === 'cancel' || text.includes('stop generating') ||
                    aria === 'stop' || aria.includes('stop') || aria.includes('cancel')) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        return { found: true, x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
                    }
                }
            }
            // Also look for stop icon (square icon in toolbar)
            for (const btn of allBtns) {
                if (btn.offsetParent === null) continue;
                const svg = btn.querySelector('svg');
                if (svg && (svg.classList.contains('lucide-square') || svg.classList.contains('lucide-stop-circle'))) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        return { found: true, x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
                    }
                }
            }
            return { found: false };
        })()`;

        const findResult = await call('Runtime.evaluate', {
            expression: FIND_STOP,
            returnByValue: true
        });
        const btn = (findResult as Record<string, Record<string, unknown>>).result?.value as { found: boolean; x?: number; y?: number } | undefined;

        if (btn?.found && btn.x !== undefined && btn.y !== undefined) {
            await call('Input.dispatchMouseEvent', {
                type: 'mousePressed', x: Math.round(btn.x), y: Math.round(btn.y),
                button: 'left', clickCount: 1
            });
            await call('Input.dispatchMouseEvent', {
                type: 'mouseReleased', x: Math.round(btn.x), y: Math.round(btn.y),
                button: 'left', clickCount: 1
            });
            return { success: true, method: 'stop_button' };
        }

        // Fallback: send Escape key (same as closeHistoryPanel)
        await call('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Escape', code: 'Escape',
            windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
        });
        await call('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Escape', code: 'Escape',
            windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
        });
        return { success: true, method: 'escape_key' };
    }, { success: false, error: 'WebSocket error' });
}

/**
 * [ACTION] GET_CHAT_HISTORY
 * Quét toàn bộ danh sách các cuộc hội thoại cũ đã lưu từ thanh Sidebar Của IDE.
 * Hàm sẽ tự động mở panel lịch sử (nếu bị đóng), tìm kiếm vùng chứa các tin nhắn cũ
 * và lọc bỏ những nội dung rác (thanh tìm kiếm, chữ thừa...) để trích xuất ra mảng danh sách chat.
 * 
 * @returns {Promise<ChatHistoryResult>} Object chứa mảng danh sách `chats` (bao gồm `title` - tên cuộc trò chuyện và `date` - ngày tạo ước tính). Cùng với trạng thái thực thi.
 */
export async function getChatHistoryList(): Promise<ChatHistoryResult> {
    const fallback: ChatHistoryResult = { success: false, chats: [], error: 'No context could execute' };

    return withContexts<ChatHistoryResult>(10000, async (call, contexts) => {
        const SCRIPT = `(async () => {
            try {
                const chats = [];
                const seenTitles = new Set();

                let historyBtn = document.querySelector(
                    '[data-tooltip-id*="history"], [data-tooltip-id*="past"], [data-tooltip-id*="recent"], [data-tooltip-id*="conversation-history"]'
                );
                
                if (!historyBtn) {
                    const newChatBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
                    if (newChatBtn) {
                        const parent = newChatBtn.parentElement;
                        if (parent) {
                            const siblings = Array.from(parent.children).filter(el => el !== newChatBtn);
                            historyBtn = siblings.find(el => 
                                (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') &&
                                el.offsetParent !== null
                            );
                        }
                    }
                }

                if (!historyBtn) {
                    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a[data-tooltip-id]'));
                    for (const btn of allButtons) {
                        if (btn.offsetParent === null) continue;
                        const hasIcon = btn.querySelector('svg.lucide-clock') ||
                                       btn.querySelector('svg.lucide-history') ||
                                       btn.querySelector('svg.lucide-folder') ||
                                       btn.querySelector('svg[class*="clock"]') ||
                                       btn.querySelector('svg[class*="history"]');
                        if (hasIcon) { historyBtn = btn; break; }
                    }
                }

                if (!historyBtn) {
                    return { success: false, chats: [], error: 'History button not found' };
                }

                historyBtn.click();
                await new Promise(r => setTimeout(r, 400));

                let panel = null;
                const inputs = Array.from(document.querySelectorAll('input'));
                const searchInput = inputs.find(i => {
                    const ph = (i.placeholder || '').toLowerCase();
                    return ph.includes('select a conversation') || ph.includes('search conversations') || ph.includes('search past chats') || (ph.includes('search') && i.className.includes('searchbox'));
                });
                
                if (searchInput) {
                    let container = searchInput;
                    for (let i = 0; i < 15; i++) {
                        if (!container.parentElement) break;
                        container = container.parentElement;
                        const rect = container.getBoundingClientRect();
                        if (rect.width > 200 && rect.height > 200) {
                            panel = container;
                            break;
                        }
                    }
                }

                if (!panel) {
                    historyBtn.click();
                    return { success: true, chats: [], panelFound: false, error: 'History panel not detected' };
                }

                const scope = panel;

                // Expand "Show X more..."
                const SHOW_MORE_RE = /^show\\s+\\d+\\s+more/i;
                for (let expandAttempt = 0; expandAttempt < 5; expandAttempt++) {
                    let otherY = Infinity;
                    const allCheck = Array.from(scope.querySelectorAll('*'));
                    for (const el of allCheck) {
                        if (el.offsetParent === null) continue;
                        const t = (el.textContent || '').trim().toLowerCase();
                        if (t === 'other conversations' && el.children.length === 0) {
                            otherY = el.getBoundingClientRect().y;
                            break;
                        }
                    }
                    
                    let showMoreBtn = null;
                    for (const el of allCheck) {
                        if (el.offsetParent === null) continue;
                        const t = (el.textContent || '').trim();
                        if (!SHOW_MORE_RE.test(t)) continue;
                        const rect = el.getBoundingClientRect();
                        if (rect.y >= otherY) continue;
                        if (window.getComputedStyle(el).cursor === 'pointer' || 
                            el.tagName === 'BUTTON' || el.tagName === 'A') {
                            showMoreBtn = el;
                            break;
                        }
                    }
                    
                    if (!showMoreBtn) break;
                    showMoreBtn.click();
                    await new Promise(r => setTimeout(r, 250));
                }

                // Cào chat items
                const allEls = Array.from(scope.querySelectorAll('*'));
                let topBoundaryY = 0;
                let otherConvY = Infinity;
                for (const el of allEls) {
                    if (el.offsetParent === null) continue;
                    const text = (el.textContent || '').trim().toLowerCase();
                    if (text === 'past conversations' || text === 'other conversations') {
                        otherConvY = el.getBoundingClientRect().y;
                    }
                }
                
                const SKIP_SET = new Set([
                    'current', 'recent', 'now', 'search', 'clear', 'close',
                    'other conversations', 'select a conversation', '+ new chat',
                    'show more...', 'delete', 'commit', 'changes', 'repositories',
                    'open agent manager', 'search...', 'messages', 'past conversations', 'new conversation'
                ]);
                
                const clickableItems = [];
                for (const el of allEls) {
                    if (el.offsetParent === null) continue;
                    
                    const rect = el.getBoundingClientRect();
                    // Loại bỏ điều kiện style.cursor pointer vì chat item trên IDE có khi không bọc css con trỏ
                    // Lọc những box có width > 100, height > 20 giống nút Chat
                    if (otherConvY !== Infinity && rect.y > otherConvY + 50) continue; 
                    if (rect.width < 100 || rect.height < 20 || rect.height > 120) continue;
                    
                    const fullText = (el.textContent || '').trim();
                    if (fullText.length < 3) continue;
                    
                    const lowerFull = fullText.toLowerCase();
                    if (SKIP_SET.has(lowerFull)) continue;
                    if (/^(current|recent in |other conversations)/i.test(lowerFull)) continue;
                    if (/^show\\s+\\d+\\s+more/i.test(lowerFull)) continue;
                    if (lowerFull === 'commit' || lowerFull === 'changes' || lowerFull === 'repositories' || lowerFull.includes('open agent manager')) continue;
                    
                    clickableItems.push({ el, rect, fullText, area: rect.width * rect.height });
                }
                
                const TIME_RE = /\\d+\\s*(sec|min|hr|hour|day|wk|week|mo|month|yr|year)s?\\s*ago/i;
                
                const byY = new Map();
                for (const item of clickableItems) {
                    const yKey = Math.round(item.rect.y / 10);
                    const existing = byY.get(yKey);
                    if (!existing || item.area < existing.area) {
                        byY.set(yKey, item);
                    }
                }
                
                const sorted = [...byY.values()].sort((a, b) => a.rect.y - b.rect.y);
                
                for (const item of sorted) {
                    let title = '';
                    let date = 'Recent';
                    
                    const childSpans = Array.from(item.el.querySelectorAll('span, div, p'));
                    for (const span of childSpans) {
                        const t = (span.textContent || '').trim();
                        if (!t || t.length < 3 || t.length > 80) continue;
                        if (SKIP_SET.has(t.toLowerCase())) continue;
                        if (TIME_RE.test(t)) { date = t; continue; }
                        if (t.includes('/') && !t.includes(' ')) continue;
                        if (!title) title = t;
                    }
                    
                    if (!title) {
                        title = item.fullText;
                        const timeMatch = title.match(TIME_RE);
                        if (timeMatch) {
                            date = timeMatch[0];
                            title = title.substring(0, timeMatch.index).trim();
                        }
                        title = title.replace(/\\s+[a-z]+\\/[a-z0-9-]+$/i, '').trim();
                    }
                    
                    if (!title || title.length < 3 || title.length > 80) continue;
                    if (SKIP_SET.has(title.toLowerCase())) continue;
                    if (TIME_RE.test(title)) continue;
                    if (/^\\d+$/.test(title)) continue;
                    if (/^show\\s+\\d+\\s+more/i.test(title)) continue;
                    
                    if (seenTitles.has(title)) continue;
                    seenTitles.add(title);
                    chats.push({ title, date });
                    
                    if (chats.length >= 30) break;
                }
                
                historyBtn.click();
                
                return { success: true, chats, panelFound: !!panel };
            } catch(e) { 
                return { success: false, chats: [], error: e.toString() }; 
            }
        })()`;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });
                const value = (result as Record<string, Record<string, unknown>>).result?.value as ChatHistoryResult | undefined;
                if (value?.success) {
                    return value;
                }
            } catch (_) { }
        }

        return fallback;
    }, fallback, 100);
}

/**
 * [ACTION] SELECT_CHAT_HISTORY
 * Chọn và tải nội dung của một cuộc hội thoại cũ thông qua Tên (Title) của nó.
 * Hàm này sẽ quét danh sách chat trên Sidebar, so khớp `title` yêu cầu với nội dung các mục
 * và sau đó click chính xác vào box chứa tên cuộc hội thoại đó để IDE tải giao diện tương ứng.
 * 
 * @param {string} title Tiêu đề (tên) của cuộc hội thoại cần mở. Hàm sẽ so khớp chuỗi (so khớp cả tiền tố)
 * @returns {Promise<ChatActionResult>} Kết quả thực thi bao gồm trạng thái tìm/click thành công.
 */
export async function selectChatByTitle(title: string): Promise<ChatActionResult> {
    const fallback: ChatActionResult = { success: false, error: 'No context could execute' };

    return withContexts<ChatActionResult>(10000, async (call, contexts) => {
        const safeTitle = JSON.stringify(title);
        const SCRIPT = `(async () => {
            try {
                const targetTitle = ${safeTitle};

                let historyBtn = document.querySelector(
                    '[data-tooltip-id*="history"], [data-tooltip-id*="past"], [data-tooltip-id*="recent"], [data-tooltip-id*="conversation-history"]'
                );
                
                if (!historyBtn) {
                    const newChatBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
                    if (newChatBtn) {
                        const parent = newChatBtn.parentElement;
                        if (parent) {
                            const siblings = Array.from(parent.children).filter(el => el !== newChatBtn);
                            historyBtn = siblings.find(el => 
                                (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') &&
                                el.offsetParent !== null
                            );
                        }
                    }
                }

                if (!historyBtn) {
                    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a[data-tooltip-id]'));
                    for (const btn of allButtons) {
                        if (btn.offsetParent === null) continue;
                        const hasIcon = btn.querySelector('svg.lucide-clock') ||
                                       btn.querySelector('svg.lucide-history') ||
                                       btn.querySelector('svg.lucide-folder') ||
                                       btn.querySelector('svg.lucide-clock-rotate-left');
                        if (hasIcon) { historyBtn = btn; break; }
                    }
                }

                if (historyBtn) {
                    historyBtn.click();
                    await new Promise(r => setTimeout(r, 800));
                }

                await new Promise(r => setTimeout(r, 200));

                let panel = null;
                const inputs = Array.from(document.querySelectorAll('input'));
                const searchInput = inputs.find(i => {
                    const ph = (i.placeholder || '').toLowerCase();
                    return ph.includes('select a conversation') || ph.includes('search conversations') || ph.includes('search past chats') || (ph.includes('search') && i.className.includes('searchbox'));
                });
                
                if (searchInput) {
                    let container = searchInput;
                    for (let i = 0; i < 15; i++) {
                        if (!container.parentElement) break;
                        container = container.parentElement;
                        const rect = container.getBoundingClientRect();
                        if (rect.width > 200 && rect.height > 200) {
                            panel = container;
                            break;
                        }
                    }
                }

                const scope = panel || document;
                const allElements = Array.from(scope.querySelectorAll('*'));
                
                let otherConvY = Infinity;
                for (const el of allElements) {
                    if (el.offsetParent === null) continue;
                    const text = (el.textContent || '').trim().toLowerCase();
                    if (text === 'past conversations' || text === 'other conversations') {
                        otherConvY = el.getBoundingClientRect().y;
                        break;
                    }
                }

                const prefix = targetTitle.substring(0, Math.min(30, targetTitle.length));

                const candidates = allElements.filter(el => {
                    if (el.offsetParent === null) return false;
                    const rect = el.getBoundingClientRect();
                    if (otherConvY !== Infinity && rect.y > otherConvY + 50) return false;
                    
                    const text = (el.innerText || '').trim();
                    return text && text.startsWith(prefix);
                });

                let bestTarget = null;
                let maxDepth = -1;

                for (const el of candidates) {
                    if (el.children.length > 5) continue;

                    let depth = 0;
                    let parent = el;
                    while (parent) { depth++; parent = parent.parentElement; }

                    if (depth > maxDepth) {
                        maxDepth = depth;
                        bestTarget = el;
                    }
                }

                if (bestTarget) {
                    let containerClickable = bestTarget;
                    let foundClickable = null;
                    for (let i = 0; i < 10; i++) {
                        if (!containerClickable) break;
                        const rect = containerClickable.getBoundingClientRect();
                        if (rect.width >= 100 && rect.height >= 20 && rect.height <= 200) {
                            foundClickable = containerClickable;
                            if (rect.height > 200) foundClickable = null;
                            else break;
                        }
                        containerClickable = containerClickable.parentElement;
                    }

                    if (foundClickable) {
                        foundClickable.scrollIntoView({ block: 'center' });
                        foundClickable.click();
                        return { success: true, method: 'clickable_parent_bounds' };
                    }

                    bestTarget.scrollIntoView({ block: 'center' });
                    bestTarget.click();
                    return { success: true, method: 'direct_click' };
                }

                return { success: false, error: 'Chat not found: ' + targetTitle };
            } catch(e) { return { success: false, error: e.toString() }; }
        })()`;

        for (const ctx of contexts) {
            try {
                const result = await call('Runtime.evaluate', {
                    expression: SCRIPT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });
                const value = (result as Record<string, Record<string, unknown>>).result?.value as ChatActionResult | undefined;
                if (value?.success) {
                    return value;
                }
            } catch (_) { }
        }

        return fallback;
    }, fallback, 100);
}
