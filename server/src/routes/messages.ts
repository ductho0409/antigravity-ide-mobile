/**
 * Message & Supervisor Routes — Broadcast, inbox, supervisor chat, task queue
 * 1:1 migration from routes/messages.mjs
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { MessageRouteDeps } from '../types.js';

export function createMessageRoutes(deps: MessageRouteDeps): Router {
    const router = Router();
    const { messages, inbox, saveMessages, broadcast, clients, Supervisor } = deps;

    // ── Messages ──────────────────────────────────────────────────────────
    router.post('/api/broadcast', (req: Request, res: Response) => {
        const { type, content, context_summary, timestamp } = req.body;
        const msg = {
            type: type || 'agent',
            content: content || '',
            context_summary,
            timestamp: timestamp || new Date().toISOString()
        };
        messages.push(msg);
        saveMessages();
        broadcast('message', msg);
        console.log(`📡 [${type}] ${(content || '').substring(0, 60)}...`);
        res.json({ success: true, clients: clients.size });
    });

    router.get('/api/messages', (req: Request, res: Response) => {
        const limit = parseInt(req.query.limit as string) || 100;
        res.json({ messages: messages.slice(-limit), count: messages.length });
    });

    router.post('/api/inbox', (req: Request, res: Response) => {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });
        inbox.items.push({
            content: message,
            from: 'mobile',
            timestamp: new Date().toISOString()
        });
        broadcast('inbox_updated', { count: inbox.items.length });
        console.log(`📥 [INBOX] ${message.substring(0, 50)}...`);
        res.json({ success: true, inbox_count: inbox.items.length });
    });

    router.get('/api/inbox/read', (_req: Request, res: Response) => {
        const result = { messages: [...inbox.items], count: inbox.items.length };
        inbox.items = [];
        res.json(result);
    });

    router.post('/api/messages/clear', (_req: Request, res: Response) => {
        messages.length = 0;
        saveMessages();
        broadcast('messages_cleared', {});
        res.json({ success: true });
    });

    // ── Supervisor Chat ─────────────────────────────────────────────────
    router.post('/api/supervisor/chat', async (req: Request, res: Response) => {
        const { message } = req.body || {};
        if (!message || !message.trim()) return res.json({ success: false, error: 'Empty message' });
        const result = await Supervisor.chatWithUser(message.trim());
        res.json(result);
    });

    router.get('/api/supervisor/chat/history', (_req: Request, res: Response) => {
        res.json({ messages: Supervisor.getUserChatHistory() });
    });

    router.post('/api/supervisor/chat/stream', async (req: Request, res: Response) => {
        const { message } = req.body || {};
        if (!message || !message.trim()) {
            return res.json({ success: false, error: 'Empty message' });
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        try {
            const result = await Supervisor.chatWithUserStream(message.trim(), (token: string) => {
                res.write(`data: ${JSON.stringify({ token })}\n\n`);
            });

            if (result.success) {
                const processed = await Supervisor.processFileReads(result.response);
                const hasFileContent = processed !== result.response;
                res.write(`data: ${JSON.stringify({ done: true, response: result.response })}\n\n`);
                if (hasFileContent) {
                    res.write(`data: ${JSON.stringify({ file_content: processed })}\n\n`);
                }
            } else {
                res.write(`data: ${JSON.stringify({ error: result.error })}\n\n`);
            }
        } catch (e) {
            res.write(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
        }
        res.end();
    });

    // ── Task Queue ─────────────────────────────────────────────────────
    router.get('/api/supervisor/queue', (_req: Request, res: Response) => {
        res.json({ queue: Supervisor.getTaskQueue() });
    });

    router.post('/api/supervisor/queue', (req: Request, res: Response) => {
        const { instruction } = req.body || {};
        if (!instruction) return res.json({ success: false, error: 'Missing instruction' });
        res.json(Supervisor.addTask(instruction));
    });

    router.delete('/api/supervisor/queue/:index', (req: Request, res: Response) => {
        res.json(Supervisor.removeTask(parseInt(req.params.index)));
    });

    router.delete('/api/supervisor/queue', (_req: Request, res: Response) => {
        res.json(Supervisor.clearTaskQueue());
    });

    // ── File Awareness ─────────────────────────────────────────────────
    router.post('/api/supervisor/file/read', (req: Request, res: Response) => {
        const { path } = req.body || {};
        if (!path) return res.json({ success: false, error: 'Missing path' });
        res.json(Supervisor.readProjectFile(path));
    });

    router.post('/api/supervisor/file/list', (req: Request, res: Response) => {
        const { path } = req.body || {};
        res.json(Supervisor.listProjectDir(path || ''));
    });

    // ── Session Intelligence ───────────────────────────────────────────
    router.get('/api/supervisor/sessions', (_req: Request, res: Response) => {
        res.json(Supervisor.getSessionStats());
    });

    router.post('/api/supervisor/sessions/save', (_req: Request, res: Response) => {
        res.json({ success: true, digest: Supervisor.saveSessionDigest() });
    });

    return router;
}
