import { Router } from 'express';
import type { Request, Response } from 'express';
import type { GitRouteDeps } from '../types.js';
import * as GitService from '../services/git-service.js';

export function createGitRoutes(deps: GitRouteDeps): Router {
    const router = Router();
    const { getWorkspacePath } = deps;

    // GET /api/git/status — returns branch + changed files (staged/unstaged)
    router.get('/api/git/status', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            const result = GitService.getStatus(cwd);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // GET /api/git/log — returns recent commits
    router.get('/api/git/log', (req: Request, res: Response) => {
        try {
            const count = parseInt(req.query.count as string) || 20;
            const cwd = getWorkspacePath();
            const result = GitService.getLog(cwd, count);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // POST /api/git/stage — stage file(s)
    router.post('/api/git/stage', (req: Request, res: Response) => {
        try {
            const { files } = req.body;
            if (!Array.isArray(files) || files.length === 0) {
                res.status(400).json({ success: false, error: 'Valid files array is required' });
                return;
            }
            const cwd = getWorkspacePath();
            const result = GitService.stageFiles(cwd, files);
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/unstage — unstage file(s)
    router.post('/api/git/unstage', (req: Request, res: Response) => {
        try {
            const { files } = req.body;
            if (!Array.isArray(files) || files.length === 0) {
                res.status(400).json({ success: false, error: 'Valid files array is required' });
                return;
            }
            const cwd = getWorkspacePath();
            const result = GitService.unstageFiles(cwd, files);
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/commit — commit with message
    router.post('/api/git/commit', (req: Request, res: Response) => {
        try {
            const { message } = req.body;
            if (!message || typeof message !== 'string') {
                res.status(400).json({ success: false, error: 'Valid commit message is required' });
                return;
            }
            const cwd = getWorkspacePath();
            const result = GitService.commitChanges(cwd, message);
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/discard — discard changes for file(s)
    router.post('/api/git/discard', (req: Request, res: Response) => {
        try {
            const { files } = req.body;
            if (!Array.isArray(files) || files.length === 0) {
                res.status(400).json({ success: false, error: 'Valid files array is required' });
                return;
            }
            const cwd = getWorkspacePath();
            const result = GitService.discardChanges(cwd, files);
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/stage-all
    router.post('/api/git/stage-all', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.stageAll(cwd));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/unstage-all
    router.post('/api/git/unstage-all', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.unstageAll(cwd));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/discard-all
    router.post('/api/git/discard-all', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.discardAll(cwd));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/commit-amend
    router.post('/api/git/commit-amend', (req: Request, res: Response) => {
        try {
            const { message } = req.body;
            const cwd = getWorkspacePath();
            res.json(GitService.commitAmend(cwd, message));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/push
    router.post('/api/git/push', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.pushChanges(cwd));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/pull
    router.post('/api/git/pull', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.pullChanges(cwd));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // GET /api/git/commit-files?hash=abc123
    router.get('/api/git/commit-files', (req: Request, res: Response) => {
        try {
            const hash = req.query.hash as string;
            if (!hash) { res.status(400).json({ files: [], error: 'hash required' }); return; }
            const cwd = getWorkspacePath();
            res.json(GitService.getCommitFiles(cwd, hash));
        } catch (e) {
            res.status(500).json({ files: [], error: (e as Error).message });
        }
    });

    // POST /api/git/stash
    router.post('/api/git/stash', (req: Request, res: Response) => {
        try {
            const { message } = req.body;
            const cwd = getWorkspacePath();
            res.json(GitService.stash(cwd, message));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/stash-pop
    router.post('/api/git/stash-pop', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.stashPop(cwd));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // GET /api/git/stashes
    router.get('/api/git/stashes', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.listStashes(cwd));
        } catch (e) {
            res.status(500).json({ stashes: [], error: (e as Error).message });
        }
    });

    // POST /api/git/switch-branch
    router.post('/api/git/switch-branch', (req: Request, res: Response) => {
        try {
            const { branch } = req.body;
            if (!branch) { res.status(400).json({ success: false, error: 'branch required' }); return; }
            const cwd = getWorkspacePath();
            res.json(GitService.switchBranch(cwd, branch));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // GET /api/git/branches
    router.get('/api/git/branches', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.getBranch(cwd));
        } catch (e) {
            res.status(500).json({ current: '', branches: [], error: (e as Error).message });
        }
    });

    // POST /api/git/generate-message — AI commit message generation
    router.post('/api/git/generate-message', async (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            const result = await GitService.generateCommitMessage(cwd);
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/create-branch
    router.post('/api/git/create-branch', (req: Request, res: Response) => {
        try {
            const { branch, startPoint } = req.body;
            if (!branch) { res.status(400).json({ success: false, error: 'branch required' }); return; }
            const cwd = getWorkspacePath();
            res.json(GitService.createBranch(cwd, branch, startPoint));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/delete-branch
    router.post('/api/git/delete-branch', (req: Request, res: Response) => {
        try {
            const { branch, force } = req.body;
            if (!branch) { res.status(400).json({ success: false, error: 'branch required' }); return; }
            const cwd = getWorkspacePath();
            res.json(GitService.deleteBranch(cwd, branch, force));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/delete-remote-branch
    router.post('/api/git/delete-remote-branch', (req: Request, res: Response) => {
        try {
            const { remote = 'origin', branch } = req.body;
            if (!branch) { res.status(400).json({ success: false, error: 'branch required' }); return; }
            const cwd = getWorkspacePath();
            res.json(GitService.deleteRemoteBranch(cwd, remote, branch));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/merge
    router.post('/api/git/merge', (req: Request, res: Response) => {
        try {
            const { branch } = req.body;
            if (!branch) { res.status(400).json({ success: false, error: 'branch required' }); return; }
            const cwd = getWorkspacePath();
            res.json(GitService.mergeBranch(cwd, branch));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/fetch
    router.post('/api/git/fetch', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.fetchAll(cwd));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/cherry-pick
    router.post('/api/git/cherry-pick', (req: Request, res: Response) => {
        try {
            const { hash } = req.body;
            if (!hash) { res.status(400).json({ success: false, error: 'hash required' }); return; }
            const cwd = getWorkspacePath();
            res.json(GitService.cherryPick(cwd, hash));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // GET /api/git/tags
    router.get('/api/git/tags', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.listTags(cwd));
        } catch (e) {
            res.status(500).json({ tags: [], error: (e as Error).message });
        }
    });

    // POST /api/git/create-tag
    router.post('/api/git/create-tag', (req: Request, res: Response) => {
        try {
            const { name, message } = req.body;
            if (!name) { res.status(400).json({ success: false, error: 'name required' }); return; }
            const cwd = getWorkspacePath();
            res.json(GitService.createTag(cwd, name, message));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/delete-tag
    router.post('/api/git/delete-tag', (req: Request, res: Response) => {
        try {
            const { name } = req.body;
            if (!name) { res.status(400).json({ success: false, error: 'name required' }); return; }
            const cwd = getWorkspacePath();
            res.json(GitService.deleteTag(cwd, name));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // POST /api/git/reset
    router.post('/api/git/reset', (req: Request, res: Response) => {
        try {
            const { mode, count } = req.body;
            if (!mode || !['soft', 'mixed', 'hard'].includes(mode)) {
                res.status(400).json({ success: false, error: 'valid mode required (soft|mixed|hard)' }); 
                return;
            }
            const cwd = getWorkspacePath();
            res.json(GitService.resetHead(cwd, mode, count));
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // GET /api/git/remotes
    router.get('/api/git/remotes', (req: Request, res: Response) => {
        try {
            const cwd = getWorkspacePath();
            res.json(GitService.listRemotes(cwd));
        } catch (e) {
            res.status(500).json({ remotes: [], error: (e as Error).message });
        }
    });

    // GET /api/git/graph-log
    router.get('/api/git/graph-log', (req: Request, res: Response) => {
        try {
            const count = parseInt(req.query.count as string) || 30;
            const cwd = getWorkspacePath();
            res.json(GitService.getGraphLog(cwd, count));
        } catch (e) {
            res.status(500).json({ lines: [], error: (e as Error).message });
        }
    });

    return router;
}
