/**
 * Shared type definitions for the Antigravity backend
 */
import type { Request, Response, NextFunction } from 'express';
import type { WebSocket } from 'ws';

// ============================================================================
// Auth
// ============================================================================

export interface AuthState {
    authEnabled: boolean;
    authPinHash: string | null;
    validSessions: Set<string>;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining?: number;
    retryAfter?: number;
}

// ============================================================================
// Config
// ============================================================================

export interface ServerConfig {
    port: number;
    pin: string | null;
}

export interface TelegramNotifications {
    onComplete: boolean;
    onError: boolean;
    onInputNeeded: boolean;
}

export interface TelegramConfig {
    enabled: boolean;
    botToken: string;
    chatId: string;
    topicId: string;
    notifications: TelegramNotifications;
}

export interface DashboardConfig {
    refreshInterval: number;
    theme: string;
}

export interface DeviceConfig {
    name: string;
    cdpPort: number;
    active: boolean;
}

export interface QuickCommand {
    label: string;
    prompt: string;
    icon: string;
}

export interface ScheduledScreenshotsConfig {
    enabled: boolean;
    intervalMs: number;
    format: 'webp' | 'jpeg';
    quality: number;
    maxFiles: number;
}

export interface MobileUIConfig {
    showQuickActions: boolean;
    navigationMode: 'sidebar' | 'topbar';
    theme: string;
}

export interface TunnelConfig {
    autoStart: boolean;
    mode: 'quick' | 'named';
}

export interface PreviewConfig {
    lastPort: number | null;
    autoStart: boolean;
}

export interface SupervisorConfig {
    enabled: boolean;
    provider: string;
    endpoint: string;
    model: string;
    projectContext: string;
    showAssistTab: boolean;
    maxActionsPerMinute: number;
    errorRecovery: { enabled: boolean; maxRetries: number };
    projectRoot: string;
    disableInjects: boolean;
    contextWindow: number;
}

export interface AppConfig {
    server: ServerConfig;
    telegram: TelegramConfig;
    dashboard: DashboardConfig;
    devices: DeviceConfig[];
    quickCommands: QuickCommand[];
    scheduledScreenshots: ScheduledScreenshotsConfig;
    mobileUI: MobileUIConfig;
    autoAcceptCommands: boolean;
    tunnel: TunnelConfig;
    preview: PreviewConfig;
    supervisor: SupervisorConfig;
}

// ============================================================================
// Activity / Analytics
// ============================================================================

export interface ActivityEvent {
    id: number;
    type: string;
    message: string;
    timestamp: string;
    ts: number;
}

export interface Analytics {
    uptimeStart: number | null;
    messagesProcessed: number;
    screenshots: number;
    commands: number;
    fileOperations: number;
    errors: number;
}

// ============================================================================
// WebSocket
// ============================================================================

export type BroadcastFn = (event: string, data: unknown) => void;

// ============================================================================
// Route Dependency Interfaces
// ============================================================================

export interface AuthRouteDeps {
    localhostOnly: (req: Request, res: Response, next: NextFunction) => void;
    authState: AuthState;
    hashPin: (pin: string) => string;
    generateSessionToken: () => string;
    validateSession: (token: string | undefined) => boolean;
    checkLoginRateLimit: (ip: string) => RateLimitResult;
    recordFailedLogin: (ip: string) => void;
    clearLoginAttempts: (ip: string) => void;
    emitEvent: (type: string, message: string) => void;
}

export interface AdminRouteDeps {
    emitEvent: (type: string, message: string) => void;
    authState: AuthState;
    hashPin: (pin: string) => string;
    serverStartTime: number;
    clients: Set<WebSocket>;
    analytics: Analytics;
    trackMetric: (type: string) => void;
    activityEvents: ActivityEvent[];
    PROJECT_ROOT: string;
    HTTP_PORT: number;
    LOGS_DIR: string;
    SCREENSHOTS_DIR: string;
    startScreenshotScheduler: () => void;
    stopScreenshotScheduler: () => void;
    screenshotScheduler: {
        isRunning: () => boolean;
        getConfig: () => { format: string; quality: number; intervalMs: number; maxFiles: number };
        getFileCount: () => number;
        updateConfig: (config: Record<string, unknown>) => void;
    };
    loggingPaused: { get: () => boolean; set: (v: boolean) => void };
}

export interface SupervisorService {
    chatWithUser: (message: string) => Promise<{ success: boolean; response?: string; error?: string }>;
    getUserChatHistory: () => unknown[];
    chatWithUserStream: (message: string, onToken: (token: string) => void) => Promise<{ success: boolean; response: string; error?: string }>;
    processFileReads: (text: string) => Promise<string>;
    getTaskQueue: () => unknown[];
    addTask: (instruction: string) => { success: boolean };
    removeTask: (index: number) => { success: boolean };
    clearTaskQueue: () => { success: boolean };
    readProjectFile: (path: string) => { success: boolean; content?: string; error?: string };
    listProjectDir: (path: string) => { success: boolean; files?: unknown[]; error?: string };
    getSessionStats: () => unknown;
    saveSessionDigest: () => unknown;
}

export interface MessageRouteDeps {
    messages: Record<string, unknown>[];
    inbox: { items: Record<string, unknown>[] };
    saveMessages: () => void;
    broadcast: BroadcastFn;
    clients: Set<WebSocket>;
    Supervisor: SupervisorService;
}

export interface ChatMessage {
    id: string;
    role: string;
    content: string;
    timestamp: string;
}

export interface InboxItem {
    id: string;
    from: string;
    message: string;
    timestamp: string;
    read: boolean;
}

// ============================================================================
// Git Types
// ============================================================================

export interface GitFileStatus {
    path: string;
    status: string; // M, A, D, R, U, ?
    staged: boolean;
    statusLabel: string; // 'modified', 'added', 'deleted', etc.
}

export interface GitStatusResult {
    branch: string;
    files: GitFileStatus[];
    staged: GitFileStatus[];
    unstaged: GitFileStatus[];
    clean: boolean;
    error?: string;
}

export interface GitBranchResult {
    current: string;
    branches: string[];
    error?: string;
}

export interface GitCommitEntry {
    hash: string;
    message: string;
    date: string;
    author: string;
}

export interface GitLogResult {
    commits: GitCommitEntry[];
    error?: string;
}

export interface GitCommitResult {
    success: boolean;
    hash?: string;
    message?: string;
    error?: string;
}


export interface GitRouteDeps {
    getWorkspacePath: () => string;
    }

export interface GitStashEntry {
    index: string;
    message: string;
    date: string;
}

export interface GitTagEntry {
    name: string;
    hash: string;
    message?: string;
    date?: string;
}

export interface GitRemoteEntry {
    name: string;
    fetchUrl: string;
    pushUrl: string;
}
