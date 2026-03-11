/**
 * CDP Barrel Export — Re-exports all CDP modules
 */

// Core (must be first — other modules depend on it)
export {
    getCdpUrl,
    setActiveDevice,
    getActiveDevice,
    setActiveTarget,
    getActiveTarget,
    getTargets,
    getVersion,
    findEditorTarget,
    connectToTarget,
    isAvailable,
    waitForConnection,
    isCdpConnected,
} from './core.js';
export type { CdpTarget, CdpClient } from './core.js';

// Queue
export { queueMessage, flushMessageQueue } from './queue.js';

// Screenshot
export { captureScreenshot, getPageMetrics } from './screenshot.js';

// Scroll
export { remoteScroll } from './scroll.js';

// Commands
export { injectCommand, injectAndSubmit, focusInput } from './commands.js';

// Workspace
export { getWorkspacePath } from './workspace.js';

// Snapshot
export { getChatSnapshotClean, clearLastSnapshot } from './snapshot.js';

// Chat Scrape
export { getChatMessages, getAgentPanelContent, getConversationText } from './chat-scrape.js';

// Model & Mode
export { getModelAndMode, getAvailableModels, setModel, getAvailableModes, setMode } from './model-mode.js';

// Windows
export { discoverAllTargets, switchToTarget, closeWindow, launchNewWindow, getRecentWorkspaces } from './windows.js';

// Approvals
export { getPendingApprovals, respondToApproval, clickElementByXPath } from './approvals.js';

// Chat Actions
export { startNewChat, closeHistoryPanel, getChatHistoryList, selectChatByTitle } from './chat-actions.js';

// File Operations
export { openFileInIDE, openFileDiffInIDE } from './file-ops.js';

// Terminal
export { listTerminals, getTerminalContent, sendTerminalInput, sendTerminalRawKey, sendTerminalSpecialKey, switchTerminal, createTerminal, closeTerminal } from './terminal.js';
export type { TerminalInfo, TerminalContent } from './terminal.js';
