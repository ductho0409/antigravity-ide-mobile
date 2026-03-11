/**
 * Telegram Bot - Notifications + on-demand commands for Antigravity
 * 
 * Features:
 * - Commands: /start, /help, /status, /quota, /screenshot
 * - Notifications: process complete, errors, input needed (buttons)
 * - Rate limiting: per-user cooldown (15 commands / 60s window)
 * - Persistent bot menu via setMyCommands()
 * - Message threading: group related notifications into reply chains
 * 
 * 1:1 migration from telegram-bot.mjs
 */

// ============================================================================
// Types
// ============================================================================

type NotificationType = 'complete' | 'error' | 'input_needed' | 'progress' | 'warning';

interface TelegramBotInstance {
    sendMessage: (chatId: string | number, text: string, opts?: Record<string, unknown>) => Promise<{ message_id: number }>;
    sendPhoto: (chatId: string | number, photo: Buffer, opts?: Record<string, unknown>) => Promise<{ message_id: number }>;
    sendChatAction: (chatId: string | number, action: string) => Promise<void>;
    setMyCommands: (commands: Array<{ command: string; description: string }>) => Promise<void>;
    answerCallbackQuery: (queryId: string, opts?: Record<string, unknown>) => Promise<void>;
    editMessageReplyMarkup: (markup: Record<string, unknown>, opts: Record<string, unknown>) => Promise<void>;
    onText: (regexp: RegExp, callback: (msg: TelegramMessage) => void) => void;
    on: (event: string, callback: (data: unknown) => void) => void;
    stopPolling: () => Promise<void>;
}

interface TelegramMessage {
    chat: { id: number };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
    id?: string;
}

interface BotConfig {
    botToken: string;
    chatId?: string;
    topicId?: number;
    notifications?: {
        onComplete?: boolean;
        onError?: boolean;
        onInputNeeded?: boolean;
    };
}

interface RateLimitEntry {
    count: number;
    windowStart: number;
    warned: boolean;
}

interface ThreadEntry {
    messageId: number;
    createdAt: number;
}

interface InlineButton {
    label: string;
    xpath: string;
}

// XPath cache: stores full XPath strings indexed by short ID to keep callback_data < 64 bytes
const xpathCache = new Map<string, string>();
let xpathCounter = 0;
function cacheXPath(xpath: string): string {
    // Check if already cached
    for (const [id, x] of xpathCache) if (x === xpath) return id;
    const id = 'x' + (xpathCounter++ % 999);
    xpathCache.set(id, xpath);
    return id;
}
function getXPath(id: string): string | undefined {
    return xpathCache.get(id);
}

// ============================================================================
// Dependency Loader (lazy)
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let TelegramBotConstructor: any;
let bot: TelegramBotInstance | null = null;
let botConfig: BotConfig | null = null;

async function loadDependency(): Promise<boolean> {
    if (TelegramBotConstructor) return true;
    try {
        const mod = await import('node-telegram-bot-api');
        TelegramBotConstructor = mod.default;
        return true;
    } catch {
        console.error('⚠️ node-telegram-bot-api not installed. Run: npm install node-telegram-bot-api');
        return false;
    }
}

// ============================================================================
// Callback hooks (set by http-server)
// ============================================================================

let getStatusFn: (() => Promise<Record<string, unknown>>) | null = null;
let getScreenshotFn: (() => Promise<string | null>) | null = null;
let clickByXPathFn: ((xpath: string) => Promise<{ success: boolean; error?: string }>) | null = null;
let getQuotaFn: (() => Promise<Record<string, unknown>>) | null = null;

export function registerCallbacks(callbacks: {
    getStatus?: () => Promise<Record<string, unknown>>;
    getScreenshot?: () => Promise<string | null>;
    clickByXPath?: (xpath: string) => Promise<{ success: boolean; error?: string }>;
    getQuota?: () => Promise<Record<string, unknown>>;
}): void {
    getStatusFn = callbacks.getStatus || null;
    getScreenshotFn = callbacks.getScreenshot || null;
    clickByXPathFn = callbacks.clickByXPath || null;
    getQuotaFn = callbacks.getQuota || null;
}

// ============================================================================
// Rate Limiting
// ============================================================================

const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW = 60000;
const rateLimits = new Map<number, RateLimitEntry>();

function checkRateLimit(chatId: number): boolean {
    const now = Date.now();
    let entry = rateLimits.get(chatId);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
        rateLimits.set(chatId, { count: 1, windowStart: now, warned: false });
        return true;
    }

    entry.count++;

    if (entry.count > RATE_LIMIT_MAX) {
        if (!entry.warned) {
            entry.warned = true;
            const remainingSec = Math.ceil((RATE_LIMIT_WINDOW - (now - entry.windowStart)) / 1000);
            bot?.sendMessage(chatId,
                `⏳ *Rate limit reached*\nMax ${RATE_LIMIT_MAX} commands per minute.\nPlease wait ${remainingSec}s.`,
                { parse_mode: 'Markdown' }
            );
        }
        return false;
    }

    return true;
}

// Clean up stale rate-limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [chatId, entry] of rateLimits) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) {
            rateLimits.delete(chatId);
        }
    }
}, 300000);

// ============================================================================
// Message Threading
// ============================================================================

const THREAD_EXPIRY = 3600000; // 1 hour
const notificationThreads = new Map<string, ThreadEntry>();

function getThreadMessageId(threadKey: string | undefined): number | null {
    if (!threadKey) return null;
    const entry = notificationThreads.get(threadKey);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > THREAD_EXPIRY) {
        notificationThreads.delete(threadKey);
        return null;
    }
    return entry.messageId;
}

function setThreadMessageId(threadKey: string | undefined, messageId: number): void {
    if (!threadKey || !messageId) return;
    notificationThreads.set(threadKey, { messageId, createdAt: Date.now() });
}

export function clearThread(threadKey: string): void {
    notificationThreads.delete(threadKey);
}

// ============================================================================
// Bot Commands
// ============================================================================

const BOT_COMMANDS = [
    { command: 'help', description: 'Show command reference' },
    { command: 'status', description: 'Connection & server status' },
    { command: 'quota', description: 'AI model quota usage' },
    { command: 'screenshot', description: 'Capture IDE screenshot' },
];

// ============================================================================
// Helpers
// ============================================================================

function buildProgressBar(percent: number): string {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
}

function escapeMarkdown(text: string): string {
    return text.replace(/([_*`\[])/g, '\\$1');
}

function isAuthorized(msg: TelegramMessage): boolean {
    if (!botConfig?.chatId) return true;
    // callback_query has chat inside msg.message; regular messages have it at top level
    const chatId = msg.chat?.id ?? msg.message?.chat?.id;
    if (!chatId) return true;
    return String(chatId) === String(botConfig.chatId);
}

// ============================================================================
// Initialize
// ============================================================================

export async function initBot(config: BotConfig): Promise<boolean> {
    if (bot) await stopBot();

    if (!config?.botToken) {
        console.log('ℹ️ Telegram bot: no token configured');
        return false;
    }

    const loaded = await loadDependency();
    if (!loaded) return false;

    botConfig = config;

    try {
        bot = new TelegramBotConstructor(config.botToken, { polling: true }) as TelegramBotInstance;

        // Error handler — EFATAL = conflicting polling (e.g. tsx watch restart)
        // Auto-restart polling after a short delay
        bot.on('polling_error', (err: unknown) => {
            const e = err as { code?: string; message?: string };
            console.error('🤖 Telegram polling error:', e.code || e.message);
            if (e.code === 'EFATAL') {
                console.log('🤖 EFATAL detected — restarting polling in 5s...');
                setTimeout(async () => {
                    try {
                        await bot!.stopPolling();
                        // @ts-expect-error — internal method to restart
                        await bot!.startPolling({ restart: false });
                        console.log('🤖 Telegram polling restarted');
                    } catch (restartErr) {
                        console.error('🤖 Polling restart failed:', (restartErr as Error).message);
                    }
                }, 5000);
            }
        });

        // Register persistent command menu
        try {
            await bot.setMyCommands(BOT_COMMANDS);
            console.log('🤖 Telegram bot menu registered');
        } catch (e) {
            console.error('🤖 Failed to set bot commands:', (e as Error).message);
        }

        // /start command
        bot.onText(/\/start/, (msg: TelegramMessage) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            bot!.sendMessage(msg.chat.id,
                `✅ *Antigravity Mobile Bot Active*\n\n` +
                `Your Chat ID: \`${msg.chat.id}\`\n\n` +
                `🔗 [XCloudPhone](https://xcloudphone.com)\n\n` +
                `Type /help for available commands.`,
                { parse_mode: 'Markdown' }
            );
        });

        // /help command
        bot.onText(/\/help/, (msg: TelegramMessage) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            bot!.sendMessage(msg.chat.id,
                `📖 *Command Reference*\n\n` +
                `*📊 Monitoring*\n` +
                `/status — Server & CDP connection status\n` +
                `/quota — AI model quota remaining\n` +
                `/screenshot — Capture IDE screen\n\n` +
                `*ℹ️ Info*\n` +
                `/start — Show welcome & chat ID\n` +
                `/help — This message`,
                { parse_mode: 'Markdown' }
            );
        });

        // /status command
        bot.onText(/\/status/, async (msg: TelegramMessage) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            try {
                const status = getStatusFn ? await getStatusFn() : { error: 'Status not available' };
                const text = status.error
                    ? `❌ ${status.error}`
                    : `🟢 *Antigravity Status*\n\n` +
                    `CDP: ${status.cdpConnected ? '✅ Connected' : '❌ Disconnected'}\n` +
                    `Uptime: ${status.uptime || 'N/A'}\n` +
                    `Clients: ${status.activeClients || 0}`;
                bot!.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
            } catch (e) {
                bot!.sendMessage(msg.chat.id, `❌ Error: ${(e as Error).message}`);
            }
        });

        // /quota command
        bot.onText(/\/quota/, async (msg: TelegramMessage) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            try {
                bot!.sendChatAction(msg.chat.id, 'typing');
                const quota = getQuotaFn ? (await getQuotaFn()) as Record<string, unknown> : null;

                if (!quota || !quota.available) {
                    bot!.sendMessage(msg.chat.id,
                        `❌ *Quota Unavailable*\n\n${(quota?.error as string) || 'Quota service not connected. Is Antigravity running?'}`,
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }

                const models = quota.models as Array<Record<string, unknown>>;
                if (!models || models.length === 0) {
                    bot!.sendMessage(msg.chat.id, '📊 No model quota data available.');
                    return;
                }

                const statusIcons: Record<string, string> = {
                    healthy: '🟢',
                    warning: '🟡',
                    danger: '🔴',
                    exhausted: '⚫'
                };

                let text = '📊 *Model Quota Status*\n\n';
                for (const model of models) {
                    const icon = statusIcons[model.status as string] || '⚪';
                    const bar = buildProgressBar(model.remainingPercent as number);
                    text += `${icon} *${escapeMarkdown(model.name as string)}*\n`;
                    text += `   ${bar} ${model.remainingPercent}%`;
                    if (model.resetIn) {
                        text += ` \\(resets in ${escapeMarkdown(model.resetIn as string)}\\)`;
                    }
                    text += '\n\n';
                }

                // Truncate if needed (Telegram 4096 char limit)
                if (text.length > 4000) {
                    text = text.slice(0, 3950) + '\n\n_(truncated)_';
                }

                bot!.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
            } catch (e) {
                bot!.sendMessage(msg.chat.id, `❌ Quota error: ${(e as Error).message}`);
            }
        });

        // /screenshot command
        bot.onText(/\/screenshot/, async (msg: TelegramMessage) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            try {
                bot!.sendChatAction(msg.chat.id, 'upload_photo');
                const base64 = getScreenshotFn ? await getScreenshotFn() : null;
                if (!base64) {
                    bot!.sendMessage(msg.chat.id, '❌ Could not capture screenshot');
                    return;
                }
                const buffer = Buffer.from(base64, 'base64');
                bot!.sendPhoto(msg.chat.id, buffer, { caption: '📸 IDE Screenshot' });
            } catch (e) {
                bot!.sendMessage(msg.chat.id, `❌ Screenshot error: ${(e as Error).message}`);
            }
        });

        // Handle inline keyboard button presses
        bot.on('callback_query', async (query: unknown) => {
            const q = query as TelegramMessage & { id: string; data: string };
            if (!isAuthorized(q)) return;
            try {
                const data = JSON.parse(q.data) as { action?: string; a?: string; xpath?: string; xid?: string; label?: string; l?: string };
                const action = data.action || data.a;
                const xpath = data.xpath || (data.xid ? getXPath(data.xid) : undefined);
                const label = data.label || data.l || 'element';
                if ((action === 'click_xpath' || action === 'cx') && xpath && clickByXPathFn) {
                    const result = await clickByXPathFn(xpath);
                    if (result?.success) {
                        await bot!.answerCallbackQuery(q.id, { text: `✅ Clicked: ${label}` });
                        await bot!.editMessageReplyMarkup({ inline_keyboard: [] }, {
                            chat_id: q.message!.chat.id,
                            message_id: q.message!.message_id
                        });
                    } else {
                        await bot!.answerCallbackQuery(q.id, { text: `❌ ${result?.error || 'Click failed'}`, show_alert: true });
                    }
                } else if (!xpath) {
                    await bot!.answerCallbackQuery(q.id, { text: '❌ XPath expired, please try again' });
                } else {
                    await bot!.answerCallbackQuery(q.id, { text: 'Action not available' });
                }
            } catch (e) {
                await bot!.answerCallbackQuery(q.id, { text: `❌ Error: ${(e as Error).message}`, show_alert: true });
            }
        });

        console.log('🤖 Telegram bot started');
        return true;
    } catch (e) {
        console.error('🤖 Telegram bot init failed:', (e as Error).message);
        bot = null;
        return false;
    }
}

// ============================================================================
// Stop
// ============================================================================

export async function stopBot(): Promise<void> {
    if (!bot) return;
    try {
        await bot.stopPolling();
    } catch { /* ignore */ }
    bot = null;
    console.log('🤖 Telegram bot stopped');
}

// ============================================================================
// Notification
// ============================================================================

export async function sendNotification(
    type: NotificationType,
    message: string,
    screenshotBase64?: string,
    buttons?: InlineButton[],
    threadKey?: string
): Promise<boolean> {
    if (!bot || !botConfig?.chatId) return false;

    // Check if this notification type is enabled (undefined = enabled by default)
    const notifs = botConfig.notifications || {};
    if (type === 'complete' && notifs.onComplete === false) return false;
    if (type === 'error' && notifs.onError === false) return false;
    if (type === 'input_needed' && notifs.onInputNeeded === false) return false;

    const icons: Record<string, string> = { complete: '✅', error: '❌', input_needed: '🔔', progress: '⏳', warning: '⚠️' };
    const titles: Record<string, string> = { complete: 'Process Complete', error: 'Error', input_needed: 'Input Needed', progress: 'Progress', warning: 'Warning' };
    const icon = icons[type] || 'ℹ️';
    const title = titles[type] || 'Notification';

    try {
        const text = `${icon} *${title}*\n\n${escapeMarkdown(message)}`;

        const opts: Record<string, unknown> = { parse_mode: 'Markdown' };

        // Topic support for supergroups
        if (botConfig.topicId) {
            opts.message_thread_id = botConfig.topicId;
        }

        // Thread support
        const replyTo = getThreadMessageId(threadKey);
        if (replyTo) {
            opts.reply_to_message_id = replyTo;
            opts.allow_sending_without_reply = true;
        }

        if (type === 'input_needed' && buttons && buttons.length > 0) {
            const inlineButtons = buttons.slice(0, 8).map(b => {
                const xid = cacheXPath(b.xpath);
                // callback_data must be < 64 bytes — use short xid instead of full xpath
                const cbData = JSON.stringify({ a: 'cx', xid, l: b.label.slice(0, 20) });
                return { text: b.label, callback_data: cbData };
            });
            // Arrange buttons in rows of 2
            const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
            for (let i = 0; i < inlineButtons.length; i += 2) {
                keyboard.push(inlineButtons.slice(i, i + 2));
            }
            opts.reply_markup = { inline_keyboard: keyboard };
        }

        let sentMessage: { message_id: number };
        if (screenshotBase64) {
            const buffer = Buffer.from(screenshotBase64, 'base64');
            sentMessage = await bot.sendPhoto(botConfig.chatId, buffer, {
                caption: text,
                parse_mode: 'Markdown',
                ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
                ...(opts.reply_to_message_id ? { reply_to_message_id: opts.reply_to_message_id, allow_sending_without_reply: true } : {})
            });
        } else {
            sentMessage = await bot.sendMessage(botConfig.chatId, text, opts);
        }

        // Store as thread head
        if (threadKey && !replyTo && sentMessage?.message_id) {
            setThreadMessageId(threadKey, sentMessage.message_id);
        }

        return true;
    } catch (e) {
        console.error('🤖 Notification send error:', (e as Error).message);
        return false;
    }
}

// ============================================================================
// Test & Status
// ============================================================================

export async function sendTestMessage(
    chatId?: string | number,
    topicId?: number
): Promise<{ success: boolean; error?: string }> {
    if (!bot) return { success: false, error: 'Bot not initialized' };
    try {
        const opts: Record<string, unknown> = { parse_mode: 'Markdown' };
        const tid = topicId || botConfig?.topicId;
        if (tid) opts.message_thread_id = tid;

        await bot.sendMessage(chatId || botConfig?.chatId || '',
            '🧪 *Test Message*\n\nAntigravity Mobile bot is working!',
            opts
        );
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function isRunning(): boolean {
    return bot !== null;
}
