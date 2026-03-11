/**
 * Config Manager - Centralized configuration with JSON file persistence
 * 
 * Stores config in data/config.json
 * Provides load/save/get/update methods
 * 
 * 1:1 migration from config.mjs
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import type { AppConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const CONFIG_FILE = join(PROJECT_ROOT, 'data', 'config.json');

const DEFAULT_CONFIG: AppConfig = {
    server: {
        port: 3333,
        pin: null
    },
    telegram: {
        enabled: false,
        botToken: '',
        chatId: '',
        topicId: '',
        notifications: {
            onComplete: true,
            onError: true,
            onInputNeeded: true
        }
    },
    dashboard: {
        refreshInterval: 2000,
        theme: 'dark'
    },
    devices: [
        { name: 'Default', cdpPort: 9222, active: true }
    ],
    quickCommands: [
        { label: 'Run Tests', prompt: 'Run all tests and report results', icon: '🧪' },
        { label: 'Git Status', prompt: 'Show git status, recent commits, and any uncommitted changes', icon: '📊' },
        { label: 'Build', prompt: 'Build the project and report any errors', icon: '🔨' }
    ],
    scheduledScreenshots: {
        enabled: true,
        intervalMs: 30000,
        format: 'webp' as const,
        quality: 70,
        maxFiles: 200
    },
    mobileUI: {
        showQuickActions: true,
        navigationMode: 'sidebar',
        theme: 'dark'
    },
    autoAcceptCommands: false,
    tunnel: {
        autoStart: false,
        mode: 'quick'
    },
    preview: {
        lastPort: null,
        autoStart: false
    },
    supervisor: {
        enabled: false,
        provider: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'llama3',
        projectContext: '',
        showAssistTab: false,
        maxActionsPerMinute: 10,
        errorRecovery: { enabled: true, maxRetries: 3 },
        projectRoot: '',
        disableInjects: false,
        contextWindow: 8192
    }
};

let config: AppConfig | null = null;

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        const srcVal = source[key];
        const tgtVal = result[key];
        if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal)
            && tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)) {
            result[key] = deepMerge(
                tgtVal as Record<string, unknown>,
                srcVal as Record<string, unknown>
            );
        } else {
            result[key] = srcVal;
        }
    }
    return result;
}

export function loadConfig(): AppConfig {
    const dataDir = join(PROJECT_ROOT, 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    if (existsSync(CONFIG_FILE)) {
        try {
            const raw = readFileSync(CONFIG_FILE, 'utf-8');
            const saved = JSON.parse(raw);
            config = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, saved) as unknown as AppConfig;
            console.log('📋 Config loaded from', CONFIG_FILE);
        } catch (e) {
            console.error('⚠️ Failed to parse config, using defaults:', (e as Error).message);
            config = { ...DEFAULT_CONFIG };
        }
    } else {
        config = { ...DEFAULT_CONFIG };
        saveConfig();
        console.log('📋 Created default config at', CONFIG_FILE);
    }

    return config;
}

export function saveConfig(): void {
    const dataDir = join(PROJECT_ROOT, 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    try {
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
        console.error('⚠️ Failed to save config:', (e as Error).message);
    }
}

export function getConfig(path?: string): unknown {
    if (!config) loadConfig();
    if (!path) return config;

    return path.split('.').reduce<unknown>(
        (obj, key) => (obj as Record<string, unknown>)?.[key],
        config
    );
}

export function updateConfig(path: string, value: unknown): void {
    if (!config) loadConfig();

    const keys = path.split('.');
    let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') {
            obj[keys[i]] = {};
        }
        obj = obj[keys[i]] as Record<string, unknown>;
    }
    obj[keys[keys.length - 1]] = value;
    saveConfig();
}

export function mergeConfig(partial: Partial<AppConfig>): AppConfig {
    if (!config) loadConfig();
    config = deepMerge(config as unknown as Record<string, unknown>, partial as unknown as Record<string, unknown>) as unknown as AppConfig;
    saveConfig();
    return config;
}
