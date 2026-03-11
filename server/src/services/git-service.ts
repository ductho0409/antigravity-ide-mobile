/**
 * Git Service
 * 
 * Wrapper for git CLI commands to provide basic git functionality.
 */

import { execFileSync } from 'child_process';
import * as Ollama from './ollama-client.js';
import * as Config from '../config.js';
import type {
    GitStatusResult,
    GitBranchResult,
    GitLogResult,
    GitCommitResult,
    GitFileStatus,
    GitStashEntry,
    GitTagEntry,
    GitRemoteEntry
} from '../types.js';

const EXEC_OPTS = {
    encoding: 'utf8' as const,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 10000
};

/**
 * Quick check: is this a git repo?
 */
export function isGitRepo(cwd: string): boolean {
    try {
        execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { ...EXEC_OPTS, cwd });
        return true;
    } catch {
        return false;
    }
}

function getStatusLabel(status: string): string {
    switch (status) {
        case 'M': return 'modified';
        case 'A': return 'added';
        case 'D': return 'deleted';
        case 'R': return 'renamed';
        case 'U': return 'unmerged';
        case '?': return 'untracked';
        default: return 'unknown';
    }
}

/**
 * Get current git status
 * Returns: { branch, files: [{path, status, staged}], clean }
 */
export function getStatus(cwd: string): GitStatusResult {
    if (!isGitRepo(cwd)) {
        return { branch: '', files: [], staged: [], unstaged: [], clean: true, error: 'Not a git repository' };
    }

    try {
        let branch = '';
        try {
            const branchOutput = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { ...EXEC_OPTS, cwd });
            branch = branchOutput.trim();
        } catch {
            // Might fail on empty repo without commits
        }

        const statusOutput = execFileSync('git', ['status', '--porcelain', '-u'], { ...EXEC_OPTS, cwd });
        
        const files: GitFileStatus[] = [];
        const staged: GitFileStatus[] = [];
        const unstaged: GitFileStatus[] = [];

        if (statusOutput.trim()) {
            const lines = statusOutput.split('\n').filter(line => line.length > 0);
            for (const line of lines) {
                if (line.length < 4) continue;
                
                const x = line.charAt(0);
                const y = line.charAt(1);
                
                const pathStr = line.slice(3);
                // Handle rename output format "old -> new" by taking the new path
                const path = pathStr.includes(' -> ') ? pathStr.split(' -> ')[1] : pathStr;
                
                if (x !== ' ' && x !== '?') {
                    const file: GitFileStatus = {
                        path,
                        status: x,
                        staged: true,
                        statusLabel: getStatusLabel(x)
                    };
                    files.push(file);
                    staged.push(file);
                }
                
                if (y !== ' ') {
                    const file: GitFileStatus = {
                        path,
                        status: y,
                        staged: false,
                        statusLabel: getStatusLabel(y)
                    };
                    files.push(file);
                    unstaged.push(file);
                }
            }
        }

        return {
            branch,
            files,
            staged,
            unstaged,
            clean: files.length === 0
        };
    } catch (e) {
        return { branch: '', files: [], staged: [], unstaged: [], clean: true, error: (e as Error).message };
    }
}

/**
 * Get current branch and list of all branches
 * Returns: { current, branches[] }
 */
export function getBranch(cwd: string): GitBranchResult {
    if (!isGitRepo(cwd)) {
        return { current: '', branches: [], error: 'Not a git repository' };
    }

    try {
        const branchOutput = execFileSync('git', ['branch', '--format=%(refname:short)'], { ...EXEC_OPTS, cwd });
        const branches = branchOutput.trim().split('\n').filter(b => b.length > 0);
        
        let current = '';
        try {
            const currentOutput = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { ...EXEC_OPTS, cwd });
            current = currentOutput.trim();
        } catch {
            // Ignore failure on empty repos
        }

        return { current, branches };
    } catch (e) {
        return { current: '', branches: [], error: (e as Error).message };
    }
}

/**
 * Get git commit log
 * Returns: { commits: [{hash, message, date, author}] }
 */
export function getLog(cwd: string, count: number = 50): GitLogResult {
    if (!isGitRepo(cwd)) {
        return { commits: [], error: 'Not a git repository' };
    }

    try {
        const format = '%h%x00%s%x00%aI%x00%an';
        const logOutput = execFileSync('git', ['log', `-n`, count.toString(), `--format=${format}`], { ...EXEC_OPTS, cwd });
        
        const commits = logOutput.trim().split('\n')
            .filter(line => line.length > 0)
            .map(line => {
                const parts = line.split('\x00');
                return {
                    hash: parts[0] || '',
                    message: parts[1] || '',
                    date: parts[2] || '',
                    author: parts[3] || ''
                };
            });

        return { commits };
    } catch (e) {
        return { commits: [], error: (e as Error).message };
    }
}

/**
 * Stage file(s) - git add
 */
export function stageFiles(cwd: string, files: string[]): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    if (!files || files.length === 0) return { success: false, error: 'No files specified' };

    try {
        execFileSync('git', ['add', ...files], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/**
 * Unstage file(s) - git restore --staged
 */
export function unstageFiles(cwd: string, files: string[]): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    if (!files || files.length === 0) return { success: false, error: 'No files specified' };

    try {
        execFileSync('git', ['restore', '--staged', ...files], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/**
 * Commit with message
 */
export function commitChanges(cwd: string, message: string): GitCommitResult {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    if (!message) return { success: false, error: 'Commit message is required' };

    try {
        execFileSync('git', ['commit', '-m', message], { ...EXEC_OPTS, cwd });
        
        const hashOutput = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { ...EXEC_OPTS, cwd });
        const hash = hashOutput.trim();

        return { success: true, hash, message };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/**
 * Discard changes - git checkout -- <file>
 */
export function discardChanges(cwd: string, files: string[]): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    if (!files || files.length === 0) return { success: false, error: 'No files specified' };

    try {
        execFileSync('git', ['checkout', '--', ...files], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/**
 * Get diff stat summary
 */
export function getDiffStat(cwd: string): string {
    if (!isGitRepo(cwd)) return '';

    try {
        const output = execFileSync('git', ['diff', '--stat'], { ...EXEC_OPTS, cwd });
        return output.trim();
    } catch {
        return '';
    }
}


/** Stage all files - git add -A */
export function stageAll(cwd: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['add', '-A'], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/** Unstage all files - git reset */
export function unstageAll(cwd: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['reset'], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/** Discard all changes - git checkout . + git clean -fd */
export function discardAll(cwd: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['checkout', '.'], { ...EXEC_OPTS, cwd });
        execFileSync('git', ['clean', '-fd'], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/** Commit amend (reuse message or new message) */
export function commitAmend(cwd: string, message?: string): GitCommitResult {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        const args = message
            ? ['commit', '--amend', '-m', message]
            : ['commit', '--amend', '--no-edit'];
        execFileSync('git', args, { ...EXEC_OPTS, cwd });
        const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { ...EXEC_OPTS, cwd }).trim();
        return { success: true, hash, message: message || '(amended)' };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/** Push to remote */
export function pushChanges(cwd: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['push'], { ...EXEC_OPTS, cwd, timeout: 30000 });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/** Pull from remote */
export function pullChanges(cwd: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['pull'], { ...EXEC_OPTS, cwd, timeout: 30000 });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/** Get files changed in a specific commit */
export function getCommitFiles(cwd: string, hash: string): { files: string[]; error?: string } {
    if (!isGitRepo(cwd)) return { files: [], error: 'Not a git repository' };
    try {
        const output = execFileSync('git', ['show', '--name-status', '--format=', hash], { ...EXEC_OPTS, cwd });
        const files = output.trim().split('\n').filter(l => l.length > 0).map(l => {
            const parts = l.split('\t');
            return parts.length >= 2 ? `${parts[0]} ${parts.slice(1).join(' → ')}` : l;
        });
        return { files };
    } catch (e) {
        return { files: [], error: (e as Error).message };
    }
}

/** Stash changes */
export function stash(cwd: string, message?: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
        execFileSync('git', args, { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/** Pop latest stash */
export function stashPop(cwd: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['stash', 'pop'], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/** List stashes */
export function listStashes(cwd: string): { stashes: GitStashEntry[]; error?: string } {
    if (!isGitRepo(cwd)) return { stashes: [], error: 'Not a git repository' };
    try {
        const output = execFileSync('git', ['stash', 'list', '--format=%gd%x00%s%x00%aI'], { ...EXEC_OPTS, cwd });
        if (!output.trim()) return { stashes: [] };
        const stashes = output.trim().split('\n').map(line => {
            const parts = line.split('\x00');
            return { index: parts[0] || '', message: parts[1] || '', date: parts[2] || '' };
        });
        return { stashes };
    } catch (e) {
        return { stashes: [], error: (e as Error).message };
    }
}
/** Switch branch */
export function switchBranch(cwd: string, branch: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    if (!branch) return { success: false, error: 'Branch name is required' };
    try {
        execFileSync('git', ['checkout', branch], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/** AI-generated commit message using Ollama */
export async function generateCommitMessage(cwd: string): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    // Check if Supervisor is enabled
    const svConfig = Config.getConfig('supervisor') as { enabled?: boolean } | undefined;
    if (!svConfig?.enabled) {
        return { success: false, error: 'Supervisor is not enabled. Enable it in Admin → Supervisor to use AI commit messages.' };
    }

    try {
        // Get diff for context
        let diff = '';
        try {
            diff = execFileSync('git', ['diff', '--cached', '--stat'], { ...EXEC_OPTS, cwd });
            if (!diff.trim()) {
                diff = execFileSync('git', ['diff', '--stat'], { ...EXEC_OPTS, cwd });
            }
        } catch { /* ignore */ }
        
        if (!diff.trim()) {
            return { success: false, error: 'No changes to describe' };
        }

        // Get detailed diff (truncated for prompt size)
        let detailedDiff = '';
        try {
            detailedDiff = execFileSync('git', ['diff', '--cached'], { ...EXEC_OPTS, cwd });
            if (!detailedDiff.trim()) {
                detailedDiff = execFileSync('git', ['diff', '--stat'], { ...EXEC_OPTS, cwd });
            }
            // Truncate to ~4000 chars to fit in prompt
            if (detailedDiff.length > 4000) {
                detailedDiff = detailedDiff.slice(0, 4000) + '\n... (truncated)';
            }
        } catch { /* ignore */ }
        const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
        const endpoint = (config.endpoint as string) || 'http://localhost:11434';
        const model = (config.model as string) || 'llama3';
        
        Ollama.setEndpoint(endpoint);

        const prompt = `Write a descriptive git commit message for these changes.

Rules:
- First line: conventional commit format (feat/fix/refactor/style/docs/chore/test) with scope if applicable, max 72 chars
- Add a blank line after the first line
- Then write 2-4 bullet points describing what changed and why
- Keep each bullet point concise but informative
- No quotes around the message
- Use present tense ("add feature" not "added feature")

Example format:
feat(auth): add OAuth2 login flow

- Add Google and GitHub OAuth providers with token refresh
- Create middleware for session validation
- Update user model with provider fields

Changes summary:
${diff}

Detailed diff:
${detailedDiff}

Commit message:`;

        const result = await Ollama.generate(prompt, model);
        if (!result.success) {
            return { success: false, error: result.error || 'Ollama generation failed' };
        }

        // Clean up the response
        let message = (result.response || '').trim();
        // Remove wrapping quotes if the model added them
        message = message.replace(/^["']/, '').replace(/["']$/, '');
        // Remove trailing period from first line only
        const lines = message.split('\n');
        if (lines.length > 0) {
            lines[0] = lines[0].replace(/\.$/, '');
        }
        message = lines.join('\n');
        
        return { success: true, message };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function createBranch(cwd: string, branchName: string, startPoint?: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        const args = ['checkout', '-b', branchName];
        if (startPoint) args.push(startPoint);
        execFileSync('git', args, { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function deleteBranch(cwd: string, branchName: string, force?: boolean): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        const flag = force ? '-D' : '-d';
        execFileSync('git', ['branch', flag, branchName], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function deleteRemoteBranch(cwd: string, remote: string, branchName: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['push', remote, '--delete', branchName], { ...EXEC_OPTS, cwd, timeout: 30000 });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function mergeBranch(cwd: string, branchName: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['merge', branchName], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function fetchAll(cwd: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['fetch', '--all'], { ...EXEC_OPTS, cwd, timeout: 30000 });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function cherryPick(cwd: string, hash: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['cherry-pick', hash], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function listTags(cwd: string): { tags: GitTagEntry[]; error?: string } {
    if (!isGitRepo(cwd)) return { tags: [], error: 'Not a git repository' };
    try {
        const output = execFileSync('git', ['tag', '--list', '--sort=-creatordate', '--format=%(refname:short)%x00%(objectname:short)%x00%(creatordate:iso)'], { ...EXEC_OPTS, cwd });
        if (!output.trim()) return { tags: [] };
        const tags = output.trim().split('\n').map(line => {
            const parts = line.split('\x00');
            return {
                name: parts[0] || '',
                hash: parts[1] || '',
                date: parts[2] || ''
            };
        });
        return { tags };
    } catch (e) {
        return { tags: [], error: (e as Error).message };
    }
}

export function createTag(cwd: string, name: string, message?: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        const args = message ? ['tag', '-a', name, '-m', message] : ['tag', name];
        execFileSync('git', args, { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function deleteTag(cwd: string, name: string): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['tag', '-d', name], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function resetHead(cwd: string, mode: 'soft' | 'mixed' | 'hard', count: number = 1): { success: boolean; error?: string } {
    if (!isGitRepo(cwd)) return { success: false, error: 'Not a git repository' };
    try {
        execFileSync('git', ['reset', `--${mode}`, `HEAD~${count}`], { ...EXEC_OPTS, cwd });
        return { success: true };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function listRemotes(cwd: string): { remotes: GitRemoteEntry[]; error?: string } {
    if (!isGitRepo(cwd)) return { remotes: [], error: 'Not a git repository' };
    try {
        const output = execFileSync('git', ['remote', '-v'], { ...EXEC_OPTS, cwd });
        if (!output.trim()) return { remotes: [] };
        
        const remotesMap = new Map<string, GitRemoteEntry>();
        const lines = output.trim().split('\n');
        
        for (const line of lines) {
            const match = line.match(/^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/);
            if (match) {
                const [, name, url, type] = match;
                if (!remotesMap.has(name)) {
                    remotesMap.set(name, { name, fetchUrl: '', pushUrl: '' });
                }
                const entry = remotesMap.get(name)!;
                if (type === 'fetch') entry.fetchUrl = url;
                if (type === 'push') entry.pushUrl = url;
            }
        }
        
        return { remotes: Array.from(remotesMap.values()) };
    } catch (e) {
        return { remotes: [], error: (e as Error).message };
    }
}

export function getGraphLog(cwd: string, count: number = 30): { lines: string[]; error?: string } {
    if (!isGitRepo(cwd)) return { lines: [], error: 'Not a git repository' };
    try {
        const output = execFileSync('git', ['log', '--graph', '--oneline', '--decorate', '--all', '-n', count.toString()], { ...EXEC_OPTS, cwd });
        if (!output.trim()) return { lines: [] };
        return { lines: output.trim().split('\n') };
    } catch (e) {
        return { lines: [], error: (e as Error).message };
    }
}