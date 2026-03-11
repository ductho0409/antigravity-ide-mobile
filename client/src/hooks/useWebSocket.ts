/**
 * useWebSocket — WS connection with auto-reconnect
 * Ported from public/js/mobile/websocket.js
 */
import { useEffect, useRef, useCallback } from 'preact/hooks';
import { getServerUrl } from './useApi';

interface WebSocketMessage {
    event: string;
    data: Record<string, unknown>;
    ts: string;
}

interface WebSocketCallbacks {
    onConnect?: () => void;
    onDisconnect?: () => void;
    onChatMessage?: (msg: Record<string, unknown>, isNew: boolean) => void;
    onChatUpdate?: (data: Record<string, unknown>) => void;
    onFileChanged?: (data: Record<string, unknown>) => void;
    onWorkspaceChanged?: (data: Record<string, unknown>) => void;
    onStreamFrame?: (dataUrl: string, metadata?: { width?: number; height?: number }) => void;
    onStreamStarted?: (data?: { cssViewport?: { width: number; height: number } }) => void;
    onStreamStopped?: () => void;
    onTerminalUpdate?: (data: Record<string, unknown>) => void;
    onTerminalListResult?: (data: Record<string, unknown>) => void;
    onTerminalContentResult?: (data: Record<string, unknown>) => void;

}

export type WsSendFn = (data: Record<string, unknown>) => void;

export function useWebSocket(callbacks: WebSocketCallbacks): WsSendFn {
    const cbRef = useRef(callbacks);
    cbRef.current = callbacks;
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        let ws: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout>;

        function connect() {
            const serverUrl = getServerUrl();
            const wsUrl = serverUrl.replace('http', 'ws');
            const token = localStorage.getItem('authToken') || '';
            ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
            wsRef.current = ws;

            ws.onopen = () => {
                cbRef.current.onConnect?.();
            };

            ws.onclose = () => {
                cbRef.current.onDisconnect?.();
                reconnectTimer = setTimeout(connect, 3000);
            };

            ws.onerror = () => {
                cbRef.current.onDisconnect?.();
            };

            ws.onmessage = (event) => {
                // Binary message = stream frame (JPEG)
                if (event.data instanceof Blob) {
                    const url = URL.createObjectURL(event.data);
                    cbRef.current.onStreamFrame?.(url);
                    return;
                }
                try {
                    const msg: WebSocketMessage = JSON.parse(event.data);
                    handleMessage(msg);
                } catch (_e) {
                    // Ignore parse errors
                }
            };
        }

        function handleMessage(msg: WebSocketMessage) {
            const cb = cbRef.current;
            switch (msg.event) {
                case 'history':
                    if (cb.onChatMessage) {
                        const messages = (msg.data as { messages: Record<string, unknown>[] }).messages;
                        messages?.forEach((m) => cb.onChatMessage!(m, false));
                    }
                    break;
                case 'message':
                case 'mobile_command':
                    cb.onChatMessage?.(msg.data, true);
                    break;
                case 'chat_update':
                    cb.onChatUpdate?.(msg.data);
                    break;
                case 'file_changed':
                    cb.onFileChanged?.(msg.data);
                    break;
                case 'workspace_changed':
                    cb.onWorkspaceChanged?.(msg.data);
                    break;
                case 'terminal_update':
                    cb.onTerminalUpdate?.(msg.data);
                    break;
                case 'terminal_list_result':
                    cb.onTerminalListResult?.(msg.data);
                    break;
                case 'terminal_content_result':
                    cb.onTerminalContentResult?.(msg.data);
                    break;
                case 'stream_frame': {
                    const frameData = msg.data as { dataUrl: string; metadata?: { width?: number; height?: number } };
                    cb.onStreamFrame?.(frameData.dataUrl, frameData.metadata);
                    break;
                }
                case 'stream_started': {
                    const startData = msg.data as { cssViewport?: { width: number; height: number } } | undefined;
                    cb.onStreamStarted?.(startData);
                    break;
                }
                case 'stream_stopped':
                    cb.onStreamStopped?.();
                    break;
                case 'clipboard_result': {
                    const clipData = msg.data as { action?: string; text?: string; success?: boolean };
                    if (clipData.action === 'copy' && clipData.success && clipData.text) {
                        navigator.clipboard.writeText(clipData.text).catch(() => { /* ignore */ });
                    }
                    break;
                }
                case 'agent_notification': {
                    const notif = msg.data as { type?: string; message?: string };
                    if (notif.message) {
                        // Vibrate on mobile (pattern: urgent for errors, gentle for others)
                        try {
                            if (notif.type === 'error') navigator.vibrate([200, 100, 200, 100, 200]);
                            else if (notif.type === 'input_needed') navigator.vibrate([200, 100, 200]);
                            else navigator.vibrate(200);
                        } catch { /* vibrate not supported */ }
                        // Browser notification (only if page not focused)
                        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
                            const icon = notif.type === 'error' ? '🔴' : notif.type === 'input_needed' ? '🟡' : '✅';
                            new Notification(`${icon} Antigravity`, { body: notif.message, tag: 'agent-notif' });
                        }
                    }
                    break;
                }
            }
        }

        connect();

        return () => {
            clearTimeout(reconnectTimer);
            if (ws) {
                ws.onclose = null; // Prevent reconnect on intentional close
                ws.close();
            }
        };
    }, []);

    return useCallback<WsSendFn>((data) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }, []);
}
