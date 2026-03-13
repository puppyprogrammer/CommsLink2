# Git Worktrees for Parallel Claudes/Agents [8aliqg]

## Claude Plan Summary

- Add worktree_manage socket to agent (create/list/delete .worktrees/<name>), optional machine_worktree Prisma model (machine_id, name, branch, path).
- Route claude spawn cwd to worktree path if @worktree specified.
- Update CLAUDE_REGEX to capture optional @worktree: {claude machine@worktree prompt}

Key files: packages/terminal-agent/src/index.ts (~60 lines), claude_session_input handler (~15 lines), services/api/src/handlers/chat/index.ts regex (~5 lines). DB migration if model added.

Ready for Puppy approval before {claude!} implementation.
