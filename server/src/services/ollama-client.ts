/**
 * Ollama Client - HTTP client for the Ollama AI API
 * 
 * Features:
 * - Health check (isAvailable)
 * - List available models
 * - Chat completion (blocking + streaming)
 * 
 * 1:1 migration from ollama-client.mjs
 */

// ============================================================================
// Types
// ============================================================================

interface OllamaModel {
    name: string;
    size: number;
    modified_at: string;
    details?: {
        parameter_size?: string;
        quantization_level?: string;
        family?: string;
    };
}

interface OllamaModelListResponse {
    models: OllamaModel[];
}

interface OllamaChatMessage {
    role: string;
    content: string;
}

interface OllamaChatOptions {
    num_ctx?: number;
    temperature?: number;
}

interface OllamaModelInfo {
    context_length?: number;
    parameter_size?: string;
    family?: string;
    quantization_level?: string;
}

interface OllamaChatResponse {
    success: boolean;
    response?: string;
    error?: string;
}

interface OllamaStreamChunk {
    message?: { content: string };
    done?: boolean;
}

// ============================================================================
// State
// ============================================================================

let endpoint = 'http://localhost:11434';

// ============================================================================
// Configuration
// ============================================================================

export function setEndpoint(url: string): void {
    endpoint = url.replace(/\/+$/, ''); // strip trailing slashes
}

export function getEndpoint(): string {
    return endpoint;
}

// ============================================================================
// Health Check
// ============================================================================

export async function isAvailable(): Promise<{ available: boolean; error?: string; models?: string[] }> {
    try {
        const res = await fetch(`${endpoint}/api/tags`, {
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) return { available: false, error: `HTTP ${res.status}` };
        const data = (await res.json()) as OllamaModelListResponse;
        const models = (data.models || []).map(m => m.name);
        return { available: true, models };
    } catch (e) {
        return { available: false, error: (e as Error).message };
    }
}

// ============================================================================
// List Models
// ============================================================================

export async function listModels(): Promise<string[]> {
    try {
        const res = await fetch(`${endpoint}/api/tags`, {
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) return [];
        const data = (await res.json()) as OllamaModelListResponse;
        return (data.models || []).map(m => m.name);
    } catch {
        return [];
    }
}

// ============================================================================
// Model Info (context window, parameter size, etc.)
// ============================================================================

export async function getModelInfo(model: string): Promise<OllamaModelInfo | null> {
    try {
        const res = await fetch(`${endpoint}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: model }),
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
            model_info?: Record<string, unknown>;
            details?: {
                parameter_size?: string;
                family?: string;
                quantization_level?: string;
            };
        };

        // Extract context_length from model_info keys
        // Ollama returns it as e.g. "llama.context_length" or "qwen2.context_length"
        let contextLength: number | undefined;
        if (data.model_info) {
            for (const [key, value] of Object.entries(data.model_info)) {
                if (key.endsWith('.context_length') && typeof value === 'number') {
                    contextLength = value;
                    break;
                }
            }
        }

        return {
            context_length: contextLength,
            parameter_size: data.details?.parameter_size,
            family: data.details?.family,
            quantization_level: data.details?.quantization_level,
        };
    } catch {
        return null;
    }
}

// ============================================================================
// Chat (Blocking)
// ============================================================================

export async function chat(
    messages: OllamaChatMessage[],
    model: string = 'llama3',
    options: OllamaChatOptions = {}
): Promise<OllamaChatResponse> {
    try {
        const res = await fetch(`${endpoint}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                stream: false,
                options: {
                    num_ctx: options.num_ctx || 4096,
                    ...(options.temperature !== undefined ? { temperature: options.temperature } : {})
                }
            }),
            signal: AbortSignal.timeout(300000) // 5 minute timeout (matches streaming)
        });

        if (!res.ok) {
            const body = await res.text();
            return { success: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
        }

        const data = (await res.json()) as { message?: { content: string } };
        return {
            success: true,
            response: data.message?.content || ''
        };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

// ============================================================================
// Chat (Streaming)
// ============================================================================

export async function chatStream(
    messages: OllamaChatMessage[],
    model: string = 'llama3',
    onToken: (token: string) => void,
    options: OllamaChatOptions = {}
): Promise<OllamaChatResponse> {
    try {
        const res = await fetch(`${endpoint}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                stream: true,
                options: {
                    num_ctx: options.num_ctx || 4096,
                    ...(options.temperature !== undefined ? { temperature: options.temperature } : {})
                }
            }),
            signal: AbortSignal.timeout(300000) // 5 min for streaming
        });

        if (!res.ok) {
            const body = await res.text();
            return { success: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
        }

        const reader = res.body?.getReader();
        if (!reader) return { success: false, error: 'No response body' };

        const decoder = new TextDecoder();
        let fullResponse = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const chunk = JSON.parse(line) as OllamaStreamChunk;
                    if (chunk.message?.content) {
                        fullResponse += chunk.message.content;
                        onToken(chunk.message.content);
                    }
                } catch {
                    // skip malformed JSON lines
                }
            }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
            try {
                const chunk = JSON.parse(buffer) as OllamaStreamChunk;
                if (chunk.message?.content) {
                    fullResponse += chunk.message.content;
                    onToken(chunk.message.content);
                }
            } catch {
                // skip
            }
        }

        return { success: true, response: fullResponse };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

// ============================================================================
// Generate (Non-chat)
// ============================================================================

export async function generate(
    prompt: string,
    model: string
): Promise<OllamaChatResponse> {
    try {
        const res = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, stream: false }),
            signal: AbortSignal.timeout(120000)
        });

        if (!res.ok) {
            const body = await res.text();
            return { success: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
        }

        const data = (await res.json()) as { response?: string };
        return { success: true, response: data.response || '' };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}
