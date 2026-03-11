/**
 * CDP Queue — Message batching for bulk injection
 */

interface QueuedMessage {
    text: string;
    timestamp: number;
}

/** In-memory message queue for batching */
const _messageQueue: QueuedMessage[] = [];
let _batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_WINDOW_MS = 5000;

/**
 * Queue a message for batch sending. Messages within BATCH_WINDOW_MS
 * are combined into a single "[Mobile] batch" injection.
 */
export function queueMessage(text: string, onFlush?: (combined: string) => void): { queued: boolean; queueLength: number } {
    _messageQueue.push({ text, timestamp: Date.now() });

    if (_batchTimer) clearTimeout(_batchTimer);

    _batchTimer = setTimeout(async () => {
        const batch = _messageQueue.splice(0);
        if (batch.length === 0) return;

        let combined: string;
        if (batch.length === 1) {
            combined = `[Mobile] ${batch[0].text}`;
        } else {
            combined = `[Mobile — ${batch.length} messages]\n${batch.map((m, i) => `${i + 1}. ${m.text}`).join('\n')}`;
        }

        if (onFlush) onFlush(combined);
    }, BATCH_WINDOW_MS);

    return { queued: true, queueLength: _messageQueue.length };
}

/**
 * Flush the message queue immediately (don't wait for timer)
 */
export function flushMessageQueue(onFlush?: (combined: string) => void): { flushed: boolean; reason?: string; count?: number } {
    if (_batchTimer) clearTimeout(_batchTimer);
    _batchTimer = null;

    const batch = _messageQueue.splice(0);
    if (batch.length === 0) return { flushed: false, reason: 'empty' };

    let combined: string;
    if (batch.length === 1) {
        combined = `[Mobile] ${batch[0].text}`;
    } else {
        combined = `[Mobile — ${batch.length} messages]\n${batch.map((m, i) => `${i + 1}. ${m.text}`).join('\n')}`;
    }

    if (onFlush) onFlush(combined);
    return { flushed: true, count: batch.length };
}
