import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { authFetch, getServerUrl } from '../hooks/useApi';
import { useApp } from '../context/AppContext';
import { useTranslation } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { 
    GitBranch, GitCommit, RefreshCw, Plus, Minus, Undo2, Check, 
    ChevronDown, ChevronRight, ArrowUp, ArrowDown, Sparkles, 
    Package, Trash2, FileText, Tag, Globe, RotateCcw, GitMerge, Download, Cherry
} from 'lucide-preact';

interface GitFileStatus {
    path: string;
    status: string;
    staged: boolean;
    statusLabel?: string;
}

interface GitStatusResult {
    branch: string;
    files: GitFileStatus[];
    staged: GitFileStatus[];
    unstaged: GitFileStatus[];
    clean: boolean;
    error?: string;
}

interface GitCommitEntry {
    hash: string;
    message: string;
    date: string;
    author: string;
}

interface GitStashEntry {
    index: string;
    message: string;
    date: string;
}

interface GitTagEntry {
    name: string;
    hash: string;
    date?: string;
}

interface GitRemoteEntry {
    name: string;
    fetchUrl: string;
    pushUrl: string;
}

function relativeTime(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    if (Number.isNaN(then)) return dateStr;
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

const SectionHeader = ({ title, count, isOpen, onToggle }: { title: string, count: number, isOpen: boolean, onToggle: () => void }) => (
    <div 
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mt-2 mb-1 px-1 cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors"
        onClick={onToggle}
    >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title} ({count})
    </div>
);

export function GitPanel() {
    const { activePanel, showToast, viewFileDiffRef } = useApp();
    const { t } = useTranslation();
    const [status, setStatus] = useState<GitStatusResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [commitMsg, setCommitMsg] = useState('');
    const [committing, setCommitting] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
    
    const [showCommitMenu, setShowCommitMenu] = useState(false);
    const [commitAction, setCommitAction] = useState<'commit' | 'amend' | 'push' | 'sync'>('commit');
    
    const [logEntries, setLogEntries] = useState<GitCommitEntry[]>([]);
    const [showLog, setShowLog] = useState(false);
    const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
    const [commitFiles, setCommitFiles] = useState<Record<string, string[]>>({});
    
    const [stashes, setStashes] = useState<GitStashEntry[]>([]);
    const [showStashes, setShowStashes] = useState(false);
    
    const [branches, setBranches] = useState<string[]>([]);
    const [showBranchMenu, setShowBranchMenu] = useState(false);
    const [showNewBranch, setShowNewBranch] = useState(false);
    const [newBranchName, setNewBranchName] = useState('');
    
    const [pushing, setPushing] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [fetching, setFetching] = useState(false);
    
    const [tags, setTags] = useState<GitTagEntry[]>([]);
    const [showTags, setShowTags] = useState(false);
    const [showNewTag, setShowNewTag] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [newTagMessage, setNewTagMessage] = useState('');

    const [remotes, setRemotes] = useState<GitRemoteEntry[]>([]);
    const [showRemotes, setShowRemotes] = useState(false);

    const [graphLines, setGraphLines] = useState<string[]>([]);
    const [showGraph, setShowGraph] = useState(false);
    
    const [showResetMenu, setShowResetMenu] = useState(false);
    const [resetCount, setResetCount] = useState(1);

    const [logCount, setLogCount] = useState(20);

    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        confirmText?: string;
        cancelText?: string;
        destructive?: boolean;
        showInput?: boolean;
        inputPlaceholder?: string;
        inputDefaultValue?: string;
        onConfirm: (inputValue?: string) => void;
    }>({
        isOpen: false, title: '', message: '', onConfirm: () => {}
    });

    const showConfirm = useCallback((opts: Omit<typeof confirmDialog, 'isOpen'>) => {
        setConfirmDialog({ ...opts, isOpen: true });
    }, []);

    const closeConfirm = useCallback(() => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
    }, []);

    const [showStaged, setShowStaged] = useState(true);
    const [showUnstaged, setShowUnstaged] = useState(true);

    const hasLoadedRef = useRef(false);

    const loadStatus = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authFetch(`${getServerUrl()}/api/git/status`);
            const data: GitStatusResult = await res.json();
            
            if (data.error) {
                showToast(data.error, 'error');
            } else {
                setStatus(data);
            }

            if (!workspaceRoot) {
                const wsRes = await authFetch(`${getServerUrl()}/api/files`);
                const wsData = await wsRes.json();
                if (wsData.path) {
                    setWorkspaceRoot(wsData.path);
                }
            }
        } catch (e) {
            showToast('Failed to load git status: ' + (e as Error).message, 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast, workspaceRoot]);

    const loadBranches = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/git/branches`);
            const data = await res.json();
            if (data.branches) setBranches(data.branches);
        } catch (e) { showToast('Failed to load branches: ' + (e as Error).message, 'error'); }
    }, []);

    const loadStashes = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/git/stashes`);
            const data = await res.json();
            if (data.stashes) setStashes(data.stashes);
        } catch (e) { showToast('Failed to load stashes: ' + (e as Error).message, 'error'); }
    }, []);

    const loadLog = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/git/log?count=${logCount}`);
            const data = await res.json();
            if (data.commits) setLogEntries(data.commits);
        } catch (e) { showToast('Failed to load recent commits: ' + (e as Error).message, 'error'); }
    }, [logCount, showToast]);

    const loadTags = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/git/tags`);
            const data = await res.json();
            if (data.tags) setTags(data.tags);
        } catch (e) { showToast('Failed to load tags: ' + (e as Error).message, 'error'); }
    }, []);

    const loadRemotes = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/git/remotes`);
            const data = await res.json();
            if (data.remotes) setRemotes(data.remotes);
        } catch (e) { showToast('Failed to load remotes: ' + (e as Error).message, 'error'); }
    }, []);

    const loadGraphLog = useCallback(async () => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/git/graph-log?count=30`);
            const data = await res.json();
            if (data.lines) setGraphLines(data.lines);
        } catch (e) { showToast('Failed to load graph log: ' + (e as Error).message, 'error'); }
    }, []);

    const loadAll = useCallback(() => {
        loadStatus();
        loadBranches();
        loadStashes();
        loadLog();
        loadTags();
        loadRemotes();
        if (showGraph) loadGraphLog();
    }, [loadStatus, loadBranches, loadStashes, loadLog, loadTags, loadRemotes, showGraph, loadGraphLog]);

    useEffect(() => {
        if (activePanel === 'git' && !hasLoadedRef.current) {
            hasLoadedRef.current = true;
            loadAll();
        } else if (activePanel !== 'git') {
            hasLoadedRef.current = false;
        }
    }, [activePanel, loadAll]);

    useEffect(() => {
        if (hasLoadedRef.current && showLog) loadLog();
    }, [logCount, loadLog, showLog]);

    useEffect(() => {
        if (showGraph && graphLines.length === 0) {
            loadGraphLog();
        }
    }, [showGraph, graphLines.length, loadGraphLog]);

    useEffect(() => {
        const handleClickOutside = () => {
            setShowCommitMenu(false);
            setShowBranchMenu(false);
            setShowResetMenu(false);
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    const handleAction = async (endpoint: string, payload: any = {}, successMsg?: string) => {
        try {
            const res = await authFetch(`${getServerUrl()}/api/git/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Unknown error');
            if (successMsg) showToast(successMsg, 'success');
            loadAll();
            return true;
        } catch (err) {
            showToast(`Failed to ${endpoint}: ` + (err as Error).message, 'error');
            return false;
        }
    };

    const handleStage = (e: Event, path: string) => { e.stopPropagation(); handleAction('stage', { files: [path] }); };
    const handleUnstage = (e: Event, path: string) => { e.stopPropagation(); handleAction('unstage', { files: [path] }); };
    const handleDiscard = (e: Event, path: string) => { 
        e.stopPropagation(); 
        showConfirm({
            title: t('mobile.git.confirmDiscardTitle'),
            message: `Are you sure you want to discard changes in ${path}?`,
            confirmText: t('mobile.git.discardChanges'),
            cancelText: t('mobile.git.cancel'),
            destructive: true,
            onConfirm: () => {
                closeConfirm();
                handleAction('discard', { files: [path] });
            }
        });
    };

    const handleStageAll = () => handleAction('stage-all', {}, t('mobile.git.stagedAllChanges'));
    const handleUnstageAll = () => handleAction('unstage-all', {}, t('mobile.git.unstagedAllChanges'));
    const handleDiscardAll = () => {
        showConfirm({
            title: t('mobile.git.confirmDiscardAllTitle'),
            message: t('mobile.git.confirmDiscardAllMsg'),
            confirmText: t('mobile.git.discardAll') || 'Discard All',
            cancelText: t('mobile.git.cancel'),
            destructive: true,
            onConfirm: () => {
                closeConfirm();
                handleAction('discard-all', {}, t('mobile.git.discardedAll'));
            }
        });
    };

    const handlePush = async () => {
        setPushing(true);
        await handleAction('push', {}, t('mobile.git.pushSuccess'));
        setPushing(false);
    };

    const handlePull = async () => {
        setPulling(true);
        await handleAction('pull', {}, t('mobile.git.pullSuccess'));
        setPulling(false);
    };

    const handleStash = async () => {
        showConfirm({
            title: t('mobile.git.stashPromptTitle'),
            message: t('mobile.git.stashMessagePrompt'),
            showInput: true,
            inputPlaceholder: t('mobile.git.messageOptional'),
            confirmText: t('mobile.git.stash') || 'Stash',
            cancelText: t('mobile.git.cancel'),
            onConfirm: (msg) => { 
                closeConfirm(); 
                handleAction('stash', { message: msg || '' }, t('mobile.git.stashSuccess')); 
            }
        });
    };

    const handleStashPop = () => handleAction('stash-pop', {}, t('mobile.git.popSuccess'));
    
    const handleSwitchBranch = async (branch: string) => {
        await handleAction('switch-branch', { branch }, `Switched to ${branch}`);
        setShowBranchMenu(false);
    };

    const handleCreateBranch = async () => {
        if (!newBranchName.trim()) return;
        const res = await handleAction('create-branch', { branch: newBranchName.trim() }, `Created branch ${newBranchName}`);
        if (res) {
            setShowNewBranch(false);
            setNewBranchName('');
            setShowBranchMenu(false);
        }
    };

    const handleDeleteBranch = async (e: Event, branch: string) => {
        e.stopPropagation();
        showConfirm({
            title: t('mobile.git.confirmDeleteBranchTitle'),
            message: `Are you sure you want to delete branch '${branch}'?`,
            confirmText: t('mobile.git.deleteBranch'),
            cancelText: t('mobile.git.cancel'),
            destructive: true,
            onConfirm: () => {
                closeConfirm();
                handleAction('delete-branch', { branch, force: false }, `Deleted branch ${branch}`);
            }
        });
    };

    const handleMergeBranch = async (e: Event, branch: string) => {
        e.stopPropagation();
        showConfirm({
            title: t('mobile.git.confirmMergeTitle'),
            message: `Are you sure you want to merge '${branch}' into '${status?.branch}'?`,
            confirmText: t('mobile.git.mergeInto'),
            cancelText: t('mobile.git.cancel'),
            destructive: false,
            onConfirm: () => {
                closeConfirm();
                handleAction('merge', { branch }, `Merged branch ${branch}`).then(() => setShowBranchMenu(false));
            }
        });
    };

    const handleFetch = async () => {
        setFetching(true);
        await handleAction('fetch', {}, t('mobile.git.fetchSuccess'));
        setFetching(false);
    };

    const handleReset = async (mode: 'soft' | 'mixed' | 'hard') => {
        if (mode === 'hard') {
            showConfirm({
                title: t('mobile.git.confirmResetTitle'),
                message: `WARNING: Hard reset will discard all uncommitted changes and permanently remove the last ${resetCount} commit(s). Are you absolutely sure?`,
                confirmText: t('mobile.git.confirm'),
                cancelText: t('mobile.git.cancel'),
                destructive: true,
                onConfirm: () => {
                    closeConfirm();
                    performReset(mode);
                }
            });
            return;
        }
        performReset(mode);
    };

    const performReset = async (mode: 'soft' | 'mixed' | 'hard') => {
        const res = await handleAction('reset', { mode, count: resetCount }, `Reset (${mode}) successful`);
        if (res) {
            setShowResetMenu(false);
            setResetCount(1);
        }
    };

    const handleCreateTag = async () => {
        if (!newTagName.trim()) return;
        const res = await handleAction('create-tag', { name: newTagName.trim(), message: newTagMessage.trim() }, `Created tag ${newTagName}`);
        if (res) {
            setShowNewTag(false);
            setNewTagName('');
            setNewTagMessage('');
        }
    };

    const handleDeleteTag = async (name: string) => {
        showConfirm({
            title: t('mobile.git.confirmDeleteTagTitle'),
            message: `Are you sure you want to delete tag '${name}'?`,
            confirmText: t('mobile.git.delete'),
            cancelText: t('mobile.git.cancel'),
            destructive: true,
            onConfirm: () => {
                closeConfirm();
                handleAction('delete-tag', { name }, `Deleted tag ${name}`);
            }
        });
    };

    const handleCherryPick = async (e: Event, hash: string) => {
        e.stopPropagation();
        showConfirm({
            title: t('mobile.git.confirmCherryPickTitle'),
            message: `Are you sure you want to cherry-pick commit ${hash.substring(0, 7)} into current branch?`,
            confirmText: t('mobile.git.cherryPickCommit'),
            cancelText: t('mobile.git.cancel'),
            destructive: false,
            onConfirm: () => {
                closeConfirm();
                handleAction('cherry-pick', { hash }, `Cherry-picked commit ${hash.substring(0, 7)}`);
            }
        });
    };
    const handleGenerateMessage = async () => {
        if (!status?.staged?.length) {
            showToast(t('mobile.git.stageFirst'), 'info');
            return;
        }
        setGenerating(true);
        try {
            const res = await authFetch(`${getServerUrl()}/api/git/generate-message`, { method: 'POST' });
            const data = await res.json();
            if (data.success && data.message) setCommitMsg(data.message);
            else throw new Error(data.error || 'No message generated');
        } catch (err) {
            showToast('Failed to generate: ' + (err as Error).message, 'error');
        } finally {
            setGenerating(false);
        }
    };

    const executeCommit = async (action: 'commit' | 'amend' | 'push' | 'sync') => {
        setCommitting(true);
        try {
            if (action === 'sync') {
                setPulling(true);
                const pullRes = await handleAction('pull', {}, t('mobile.git.pullSuccess'));
                setPulling(false);
                if (!pullRes) throw new Error('Pull failed');
            }

            const endpoint = action === 'amend' ? 'commit-amend' : 'commit';
            const commitRes = await handleAction(endpoint, { message: commitMsg }, 'Committed successfully');
            if (!commitRes) throw new Error('Commit failed');

            if (action === 'push' || action === 'sync') {
                setPushing(true);
                await handleAction('push', {}, t('mobile.git.pushSuccess'));
                setPushing(false);
            }

            setCommitMsg('');
        } catch (err) {
            // Toast handled by handleAction
        } finally {
            setCommitting(false);
        }
    };

    const openDiff = (path: string) => {
        if (viewFileDiffRef.current && workspaceRoot) {
            const separator = workspaceRoot.endsWith('/') || workspaceRoot.endsWith('\\') ? '' : '/';
            const absolutePath = `${workspaceRoot}${separator}${path}`;
            const ext = '.' + (path.split('.').pop() || '');
            viewFileDiffRef.current(absolutePath, ext);
        }
    };

    const loadCommitFiles = async (hash: string) => {
        if (expandedCommit === hash) {
            setExpandedCommit(null);
            return;
        }
        setExpandedCommit(hash);
        if (commitFiles[hash]) return;

        try {
            const res = await authFetch(`${getServerUrl()}/api/git/commit-files?hash=${hash}`);
            const data = await res.json();
            if (data.files) {
                setCommitFiles(prev => ({ ...prev, [hash]: data.files }));
            }
        } catch (e) {
            showToast('Failed to load commit files', 'error');
        }
    };

    const getStatusColor = (s: string) => {
        switch (s) {
            case 'M': return 'text-[#f69d50] bg-[#f69d50]/10'; // modified
            case 'A': return 'text-[#3fb950] bg-[#3fb950]/10'; // added
            case 'D': return 'text-[#f85149] bg-[#f85149]/10'; // deleted
            case '?': return 'text-[var(--text-muted)] bg-white/10'; // untracked
            case 'U': return 'text-[#89b4fa] bg-[#89b4fa]/10'; // unmerged
            default: return 'text-[var(--text-muted)] bg-white/10';
        }
    };

    const getStatusText = (s: string) => s === '?' ? 'U' : s;

    const renderFileItem = (file: GitFileStatus, isStaged: boolean) => (
        <div 
            key={file.path} 
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] cursor-pointer transition-all duration-200 hover:bg-[var(--bg-glass)]"
            onClick={() => openDiff(file.path)}
        >
            <span className={`w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold ${getStatusColor(file.status)} shrink-0`}>
                {getStatusText(file.status)}
            </span>
            <span className="flex-1 text-sm whitespace-nowrap overflow-hidden text-ellipsis">
                {file.path}
            </span>
            <div className="flex gap-1 shrink-0">
                {isStaged ? (
                    <button 
                        className="w-9 h-9 flex items-center justify-center bg-white/5 border border-[var(--border)] rounded cursor-pointer text-[var(--text-muted)] hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={(e) => handleUnstage(e, file.path)}
                        title={t('mobile.git.unstageFile')}
                        disabled={committing}
                    >
                        <Minus size={16} />
                    </button>
                ) : (
                    <>
                        <button 
                            className="w-9 h-9 flex items-center justify-center bg-white/5 border border-[var(--border)] rounded cursor-pointer text-[var(--text-muted)] hover:bg-[rgba(248,81,73,0.2)] hover:text-[#f85149] hover:border-[#f85149]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={(e) => handleDiscard(e, file.path)}
                            title={t('mobile.git.discardChanges')}
                            disabled={committing}
                        >
                            <Undo2 size={16} />
                        </button>
                        <button 
                            className="w-9 h-9 flex items-center justify-center bg-white/5 border border-[var(--border)] rounded cursor-pointer text-[var(--text-muted)] hover:bg-[rgba(63,185,80,0.2)] hover:text-[#3fb950] hover:border-[#3fb950]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={(e) => handleStage(e, file.path)}
                            title={t('mobile.git.stageFile')}
                            disabled={committing}
                        >
                            <Plus size={16} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );

    return (
        <div className="flex-1 min-h-0 flex flex-col overscroll-contain git-panel">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-card)] shrink-0 relative z-20">
                <GitBranch size={18} />
                <div 
                    className="flex-1 flex items-center gap-1 cursor-pointer min-w-0"
                    onClick={(e) => { e.stopPropagation(); setShowBranchMenu(!showBranchMenu); }}
                >
                    <span className="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                        {status?.branch || 'Loading...'}
                    </span>
                    <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" />
                </div>
                {showBranchMenu && (
                    <div className="absolute top-full left-4 mt-1 w-64 max-h-64 overflow-y-auto bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl z-50 flex flex-col">
                        {!showNewBranch ? (
                            <div 
                                className="px-3 py-2 text-sm cursor-pointer hover:bg-[var(--bg-glass)] text-[var(--text-primary)] border-b border-[var(--border)] flex items-center gap-2"
                                onClick={(e) => { e.stopPropagation(); setShowNewBranch(true); }}
                            >
                                <Plus size={14} /> {t('mobile.git.newBranch')}
                            </div>
                        ) : (
                            <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <input 
                                    autoFocus
                                    className="flex-1 bg-black/20 border border-[var(--border)] rounded p-1 text-sm text-[var(--text-primary)] outline-none" 
                                    placeholder={t('mobile.git.branchName')}
                                    value={newBranchName}
                                    onChange={e => setNewBranchName((e.target as HTMLInputElement).value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleCreateBranch(); else if (e.key === 'Escape') setShowNewBranch(false); }}
                                />
                                <button className="text-[var(--accent-primary)] p-1 hover:bg-white/10 rounded" onClick={handleCreateBranch}><Check size={14} /></button>
                                <button className="text-[var(--text-muted)] p-1 hover:bg-white/10 rounded" onClick={() => setShowNewBranch(false)}><Minus size={14} /></button>
                            </div>
                        )}
                        {branches.map(b => {
                            const isCurrent = b === status?.branch;
                            return (
                                <div 
                                    key={b} 
                                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-[var(--bg-glass)] flex items-center justify-between group ${isCurrent ? 'text-[var(--accent-primary)] font-medium' : 'text-[var(--text-primary)]'}`}
                                    onClick={() => handleSwitchBranch(b)}
                                >
                                    <span className="truncate flex-1 pr-2">{b}</span>
                                    {!isCurrent && (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button 
                                                className="p-1.5 rounded hover:bg-[rgba(63,185,80,0.2)] text-[var(--text-muted)] hover:text-[#3fb950]"
                                                title={t('mobile.git.mergeInto')}
                                                onClick={(e) => handleMergeBranch(e, b)}
                                            >
                                                <GitMerge size={14} />
                                            </button>
                                            <button 
                                                className="p-1.5 rounded hover:bg-[rgba(248,81,73,0.2)] text-[var(--text-muted)] hover:text-[#f85149]"
                                                title={t('mobile.git.deleteBranch')}
                                                onClick={(e) => handleDeleteBranch(e, b)}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                <button
                    className="px-2.5 py-1 text-xs bg-white/10 border border-[var(--border)] rounded-md text-[var(--text-muted)] cursor-pointer flex items-center"
                    onClick={loadAll}
                    disabled={loading}
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {status?.error === 'Not a git repository' ? (
                <div className="flex-1 flex items-center justify-center p-8 text-[var(--text-muted)] text-sm">
                    {t('mobile.git.notGitRepo')}
                </div>
            ) : (
                <>
                    {/* Toolbar Row */}
                    <div className="flex gap-2 px-3 py-2 overflow-x-auto whitespace-nowrap border-b border-[var(--border)] shrink-0 bg-[var(--bg-card)]" style={{ scrollbarWidth: 'none' }}>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-[var(--border)] rounded-md text-xs font-medium hover:bg-white/10 text-[var(--text-primary)] transition-colors" onClick={handleStageAll}>
                            <Plus size={14} /> {t('mobile.git.stageAll')}
                        </button>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-[var(--border)] rounded-md text-xs font-medium hover:bg-white/10 text-[var(--text-primary)] transition-colors" onClick={handleUnstageAll}>
                            <Minus size={14} /> {t('mobile.git.unstageAll')}
                        </button>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-glass)] border border-[var(--border)] rounded-md text-xs font-medium hover:bg-[rgba(248,81,73,0.1)] text-[#f85149] hover:border-[#f85149]/30 transition-colors" onClick={handleDiscardAll}>
                            <Trash2 size={14} /> {t('mobile.git.discardAll')}
                        </button>
                        <div className="w-px h-5 bg-[var(--border)] mx-1 self-center shrink-0" />
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-[var(--border)] rounded-md text-xs font-medium hover:bg-white/10 text-[var(--text-primary)] transition-colors" onClick={handlePush} disabled={pushing}>
                            <ArrowUp size={14} className={pushing ? 'animate-bounce' : ''} /> {t('mobile.git.push')}
                        </button>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-[var(--border)] rounded-md text-xs font-medium hover:bg-white/10 text-[var(--text-primary)] transition-colors" onClick={handlePull} disabled={pulling}>
                            <ArrowDown size={14} className={pulling ? 'animate-bounce' : ''} /> {t('mobile.git.pull')}
                        </button>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-[var(--border)] rounded-md text-xs font-medium hover:bg-white/10 text-[var(--text-primary)] transition-colors" onClick={handleFetch} disabled={fetching}>
                            <Download size={14} className={fetching ? 'animate-bounce' : ''} /> {t('mobile.git.fetch')}
                        </button>
                        <div className="w-px h-5 bg-[var(--border)] mx-1 self-center shrink-0" />
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-[var(--border)] rounded-md text-xs font-medium hover:bg-white/10 text-[var(--text-primary)] transition-colors" onClick={handleStash}>
                            <Package size={14} /> {t('mobile.git.stash')}
                        </button>
                        {stashes.length > 0 && (
                            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 rounded-md text-xs font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/20 transition-colors" onClick={handleStashPop}>
                                <Undo2 size={14} /> {t('mobile.git.pop')}
                            </button>
                        )}
                        <div className="relative flex">
                            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-glass)] border border-[var(--border)] rounded-md text-xs font-medium hover:bg-[rgba(248,81,73,0.1)] text-[#f85149] hover:border-[#f85149]/30 transition-colors" onClick={(e) => { e.stopPropagation(); setShowResetMenu(!showResetMenu); }}>
                                <RotateCcw size={14} /> {t('mobile.git.reset')}
                            </button>
                            {showResetMenu && (
                                <div className="absolute top-full right-0 mt-1 w-64 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl z-50 py-2 flex flex-col gap-1 text-[var(--text-primary)]" onClick={e => e.stopPropagation()}>
                                    <div className="px-3 pb-2 mb-1 border-b border-[var(--border)] text-xs text-[var(--text-muted)] flex items-center justify-between">
                                        <span>{t('mobile.git.commitsToReset')}</span>
                                        <input type="number" min="1" max="99" value={resetCount} onChange={e => setResetCount(parseInt((e.target as HTMLInputElement).value) || 1)} className="w-12 bg-black/20 border border-[var(--border)] rounded px-1 text-center outline-none" />
                                    </div>
                                    <button className="px-3 py-1.5 text-sm text-left hover:bg-[var(--bg-glass)]" onClick={() => handleReset('soft')}>{t('mobile.git.softReset')}</button>
                                    <button className="px-3 py-1.5 text-sm text-left hover:bg-[var(--bg-glass)]" onClick={() => handleReset('mixed')}>{t('mobile.git.mixedReset')}</button>
                                    <button className="px-3 py-1.5 text-sm text-left hover:bg-[rgba(248,81,73,0.1)] text-[#f85149]" onClick={() => handleReset('hard')}>{t('mobile.git.hardReset')}</button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 overscroll-contain touch-pan-y flex flex-col gap-4">
                        {/* Commit Area */}
                        <div className="flex flex-col gap-2 bg-[var(--bg-glass)] border border-[var(--border)] rounded-xl p-3 relative">
                            <div className="flex gap-2">
                                <textarea 
                                    className="flex-1 bg-black/20 border border-[var(--border)] rounded-lg p-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-[var(--accent-primary)]"
                                    style={{ minHeight: commitMsg.includes('\n') ? '120px' : '80px' }}
                                    placeholder={t('mobile.git.commitMessage')}
                                    value={commitMsg}
                                    onChange={(e) => setCommitMsg((e.target as HTMLTextAreaElement).value)}
                                />
                                <button 
                                    className="w-10 flex flex-col items-center justify-center gap-1 bg-white/5 border border-[var(--border)] rounded-lg hover:bg-white/10 hover:text-[var(--accent-primary)] transition-colors disabled:opacity-50"
                                    onClick={handleGenerateMessage}
                                    disabled={generating}
                                    title="Generate commit message"
                                >
                                    <Sparkles size={16} className={generating ? 'animate-pulse text-[var(--accent-primary)]' : ''} />
                                </button>
                            </div>
                            
                            <div className="relative flex mt-1">
                                <button 
                                    className="flex-1 py-2 pl-3 pr-2 bg-[var(--accent-primary)] text-white font-medium rounded-l-lg border-r border-black/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                                    onClick={() => executeCommit(commitAction)}
                                    disabled={committing || (!commitMsg.trim() && commitAction !== 'amend')}
                                >
                                    <GitCommit size={16} />
                                    {committing ? t('mobile.git.working') : (
                                        commitAction === 'commit' ? t('mobile.git.commit') :
                                        commitAction === 'amend' ? t('mobile.git.commitAmend') :
                                        commitAction === 'push' ? t('mobile.git.commitAndPush') :
                                        t('mobile.git.commitAndSync')
                                    )}
                                </button>
                                <button
                                    className="px-2 bg-[var(--accent-primary)] text-white rounded-r-lg hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center"
                                    onClick={(e) => { e.stopPropagation(); setShowCommitMenu(!showCommitMenu); }}
                                    disabled={committing}
                                >
                                    <ChevronDown size={16} />
                                </button>

                                {showCommitMenu && (
                                    <div className="absolute top-full right-0 mt-1 w-48 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl z-50 py-1">
                                        {[
                                            { id: 'commit', label: t('mobile.git.commit') },
                                            { id: 'amend', label: t('mobile.git.commitAmend') },
                                            { id: 'push', label: t('mobile.git.commitAndPush') },
                                            { id: 'sync', label: t('mobile.git.commitAndSync') },
                                        ].map(action => (
                                            <div
                                                key={action.id}
                                                className="px-4 py-2 text-sm hover:bg-[var(--bg-glass)] cursor-pointer"
                                                onClick={() => {
                                                    setCommitAction(action.id as any);
                                                    setShowCommitMenu(false);
                                                }}
                                            >
                                                {action.label}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {loading && !status ? (
                            <div className="text-center p-8 text-[var(--text-muted)]">{t('mobile.git.loadingStatus')}</div>
                        ) : status?.error ? (
                            <div className="text-center p-8 text-[#f85149] bg-[#f85149]/10 rounded-xl text-sm border border-[#f85149]/20">
                                {status.error}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                                {status?.clean && (
                                    <div className="flex flex-col items-center justify-center py-6 text-[var(--text-muted)] opacity-60">
                                        <Check size={32} strokeWidth={1} className="mb-2" />
                                        <span className="text-xs">{t('mobile.git.workingTreeClean')}</span>
                                    </div>
                                )}

                                {/* Staged Changes */}
                                {status?.staged && status.staged.length > 0 && (
                                    <div className="flex flex-col">
                                        <SectionHeader title={t('mobile.git.stagedChanges')} count={status.staged.length} isOpen={showStaged} onToggle={() => setShowStaged(!showStaged)} />
                                        {showStaged && (
                                            <div className="flex flex-col mt-1">
                                                {status.staged.map(file => renderFileItem(file, true))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Unstaged Changes */}
                                {status?.unstaged && status.unstaged.length > 0 && (
                                    <div className="flex flex-col">
                                        <SectionHeader title={t('mobile.git.changes')} count={status.unstaged.length} isOpen={showUnstaged} onToggle={() => setShowUnstaged(!showUnstaged)} />
                                        {showUnstaged && (
                                            <div className="flex flex-col mt-1">
                                                {status.unstaged.map(file => renderFileItem(file, false))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Stash List */}
                                {stashes.length > 0 && (
                                    <div className="flex flex-col">
                                        <SectionHeader title={t('mobile.git.stashes')} count={stashes.length} isOpen={showStashes} onToggle={() => setShowStashes(!showStashes)} />
                                        {showStashes && (
                                            <div className="flex flex-col gap-2 mt-1">
                                                {stashes.map(stash => (
                                                    <div key={stash.index} className="flex items-center gap-3 px-3 py-2 bg-white/5 border border-[var(--border)] rounded-lg">
                                                        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
                                                            <div className="text-sm text-[var(--text-primary)] whitespace-nowrap text-ellipsis overflow-hidden">
                                                                <span className="text-[var(--text-muted)] mr-1 text-xs">{stash.index}:</span> 
                                                                {stash.message}
                                                            </div>
                                                            <div className="text-[11px] text-[var(--text-muted)] mt-1">{relativeTime(stash.date)}</div>
                                                        </div>
                                                        <div className="flex gap-1 shrink-0">
                                                            <button 
                                                                className="px-2.5 py-1 text-xs bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 border border-[var(--accent-primary)]/30 rounded transition-colors"
                                                                onClick={() => handleAction('stash-pop', {}, t('mobile.git.popSuccess'))}
                                                            >
                                                                {t('mobile.git.pop')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Commit Log */}
                                {logEntries.length > 0 && (
                                    <div className="flex flex-col">
                                        <SectionHeader title={t('mobile.git.recentCommits')} count={logEntries.length} isOpen={showLog} onToggle={() => setShowLog(!showLog)} />
                                        {showLog && (
                                            <div className="flex flex-col gap-2 mt-1 mb-4">
                                                {logEntries.map(entry => (
                                                    <div key={entry.hash} className="flex flex-col bg-white/5 border border-[var(--border)] rounded-lg overflow-hidden">
                                                        <div 
                                                            className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-white/10 transition-colors group"
                                                            onClick={() => loadCommitFiles(entry.hash)}
                                                        >
                                                            <div className="flex flex-col flex-1 overflow-hidden min-w-0">
                                                                <div className="text-sm text-[var(--text-primary)] whitespace-nowrap text-ellipsis overflow-hidden">{entry.message}</div>
                                                                <div className="flex items-center gap-2 mt-1">
                                                                    <span className="text-[10px] font-mono text-[var(--accent-primary)] bg-[var(--accent-primary)]/10 px-1.5 py-0.5 rounded">{entry.hash.substring(0, 7)}</span>
                                                                    <span className="text-[11px] text-[var(--text-muted)]">{relativeTime(entry.date)}</span>
                                                                </div>
                                                            </div>
                                                            <button 
                                                                className="p-1.5 rounded hover:bg-[var(--accent-primary)]/20 text-[var(--text-muted)] hover:text-[var(--accent-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
                                                                title={t('mobile.git.cherryPickCommit')}
                                                                onClick={(e) => handleCherryPick(e, entry.hash)}
                                                            >
                                                                <Cherry size={14} />
                                                            </button>
                                                            {expandedCommit === entry.hash ? <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0"/> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0"/>}
                                                        </div>
                                                        {expandedCommit === entry.hash && commitFiles[entry.hash] && (
                                                            <div className="bg-black/20 px-3 py-2 border-t border-[var(--border)] flex flex-col gap-1 max-h-48 overflow-y-auto">
                                                                {commitFiles[entry.hash].map((file: string) => (
                                                                    <div key={file} className="text-xs text-[var(--text-muted)] whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-1.5 hover:text-[var(--text-primary)] cursor-pointer" onClick={(e) => { e.stopPropagation(); openDiff(file); }}>
                                                                        <FileText size={12} className="shrink-0" />
                                                                        {file}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                                {logEntries.length >= logCount && (
                                                    <button 
                                                        className="text-xs text-[var(--accent-primary)] hover:underline py-2 text-center w-full"
                                                        onClick={() => { setLogCount(prev => prev + 20); }}
                                                    >
                                                        {t('mobile.git.loadMore')}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Tags */}
                                <div className="flex flex-col">
                                    <SectionHeader title={t('mobile.git.tags')} count={tags.length} isOpen={showTags} onToggle={() => setShowTags(!showTags)} />
                                    {showTags && (
                                        <div className="flex flex-col gap-2 mt-1">
                                            {!showNewTag ? (
                                                <button 
                                                    className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] hover:bg-white/10 transition-colors"
                                                    onClick={() => setShowNewTag(true)}
                                                >
                                                    <Plus size={14} /> {t('mobile.git.newTag')}
                                                </button>
                                            ) : (
                                                <div className="flex flex-col gap-2 p-3 bg-white/5 border border-[var(--border)] rounded-lg">
                                                    <input 
                                                        autoFocus
                                                        className="bg-black/20 border border-[var(--border)] rounded p-1.5 text-sm text-[var(--text-primary)] outline-none" 
                                                        placeholder={t('mobile.git.tagName')}
                                                        value={newTagName}
                                                        onChange={e => setNewTagName((e.target as HTMLInputElement).value)}
                                                    />
                                                    <input 
                                                        className="bg-black/20 border border-[var(--border)] rounded p-1.5 text-sm text-[var(--text-primary)] outline-none" 
                                                        placeholder={t('mobile.git.messageOptional')}
                                                        value={newTagMessage}
                                                        onChange={e => setNewTagMessage((e.target as HTMLInputElement).value)}
                                                        onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(); else if (e.key === 'Escape') setShowNewTag(false); }}
                                                    />
                                                    <div className="flex justify-end gap-2 mt-1">
                                                        <button className="px-3 py-1 text-xs border border-[var(--border)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => setShowNewTag(false)}>{t('mobile.git.cancel')}</button>
                                                        <button className="px-3 py-1 text-xs bg-[var(--accent-primary)] text-white rounded hover:brightness-110" onClick={handleCreateTag}>{t('mobile.git.create')}</button>
                                                    </div>
                                                </div>
                                            )}
                                            {tags.map(tag => (
                                                <div key={tag.name} className="flex items-center justify-between px-3 py-2 bg-white/5 border border-[var(--border)] rounded-lg group">
                                                    <div className="flex flex-col overflow-hidden min-w-0">
                                                        <div className="flex items-center gap-1.5 text-sm text-[var(--text-primary)]">
                                                            <Tag size={12} className="text-[var(--text-muted)]" />
                                                            <span className="truncate font-medium">{tag.name}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-[10px] font-mono text-[var(--accent-primary)] opacity-80">{tag.hash.substring(0, 7)}</span>
                                                            {tag.date && <span className="text-[10px] text-[var(--text-muted)]">{relativeTime(tag.date)}</span>}
                                                        </div>
                                                    </div>
                                                    <button 
                                                        className="p-1.5 rounded hover:bg-[rgba(248,81,73,0.2)] text-[var(--text-muted)] hover:text-[#f85149] opacity-0 group-hover:opacity-100 transition-opacity"
                                                        onClick={() => handleDeleteTag(tag.name)}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Remotes */}
                                <div className="flex flex-col">
                                    <SectionHeader title={t('mobile.git.remotes')} count={remotes.length} isOpen={showRemotes} onToggle={() => setShowRemotes(!showRemotes)} />
                                    {showRemotes && (
                                        <div className="flex flex-col gap-2 mt-1">
                                            {remotes.map(remote => (
                                                <div key={remote.name} className="flex flex-col px-3 py-2 bg-white/5 border border-[var(--border)] rounded-lg">
                                                    <div className="flex items-center gap-1.5 text-sm text-[var(--text-primary)] font-medium mb-1">
                                                        <Globe size={12} className="text-[var(--text-muted)]" />
                                                        {remote.name}
                                                    </div>
                                                    <div className="text-[10px] text-[var(--text-muted)] truncate"><span className="opacity-50">Fetch:</span> {remote.fetchUrl}</div>
                                                    <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5"><span className="opacity-50">Push:</span> {remote.pushUrl}</div>
                                                </div>
                                            ))}
                                            {remotes.length === 0 && (
                                                <div className="text-xs text-[var(--text-muted)] py-2 text-center">{t('mobile.git.noRemotes')}</div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Git Graph */}
                                <div className="flex flex-col mb-4">
                                    <SectionHeader title={t('mobile.git.gitGraph')} count={graphLines.length} isOpen={showGraph} onToggle={() => setShowGraph(!showGraph)} />
                                    {showGraph && (
                                        <div className="mt-1 bg-black/30 border border-[var(--border)] rounded-lg overflow-x-auto p-3 text-xs font-mono whitespace-pre text-[var(--text-primary)] leading-tight">
                                            {graphLines.length === 0 ? (
                                                <div className="text-[var(--text-muted)] text-center py-4">{t('mobile.git.loadingGraph')}</div>
                                            ) : (
                                                graphLines.join('\n')
                                            )}
                                        </div>
                                    )}
                            </div>
                            </div>
                        )}
                    </div>
                </>
            )}
            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                title={confirmDialog.title}
                message={confirmDialog.message}
                confirmText={confirmDialog.confirmText}
                cancelText={confirmDialog.cancelText}
                destructive={confirmDialog.destructive}
                showInput={confirmDialog.showInput}
                inputPlaceholder={confirmDialog.inputPlaceholder}
                inputDefaultValue={confirmDialog.inputDefaultValue}
                onConfirm={confirmDialog.onConfirm}
                onCancel={closeConfirm}
            />
        </div>
    );
}
