---
name: git-commit
description: Review, stage, and commit all current Git changes with a repository-style message informed by the complete uncommitted diff and relevant conversation context. Use when the user asks to commit, checkpoint, or save the current repository work in Git.
---

# Commit Current Changes

Create one commit containing every current tracked and untracked change unless the user explicitly narrows the scope. Treat invocation as authorization to stage and commit that scope; do not push.

## Workflow

1. Build a complete picture.
   - Read the relevant current conversation for the goal, decisions, and terminology behind the work.
   - Run `git status --short --branch` and inspect the latest commit message with `git log -1 --format=%B`.
   - Inspect both unstaged and staged changes with `git diff --stat`, `git diff`, `git diff --cached --stat`, and `git diff --cached`.
   - Enumerate untracked files with `git ls-files --others --exclude-standard` and inspect their contents. Account for deletions, renames, binary files, and generated artifacts as well as ordinary text edits.
   - Review every changed path. Do not rely on filenames or a diff summary alone.

2. Check commit safety.
   - Stop if the directory is not a Git repository, there are unresolved conflicts, or there is nothing to commit.
   - Do not stage likely credentials, private keys, tokens, environment files, or unexpectedly large/generated artifacts without confirming they belong in version control. If any are suspicious, stop and explain the specific paths.
   - Preserve the user's changes. Do not rewrite implementation merely to make the commit easier to describe.

3. Validate the work.
   - Run `git diff --check` and any focused validation clearly implied by the changed files, repository guidance, or conversation context.
   - If validation fails, report the failure and do not claim success. Only fix it when the user's request or the current conversation authorizes implementation changes.

4. Compose the commit message from the full evidence.
   - Treat the actual diff as authoritative and use conversation context to explain intent. Do not claim changes absent from the diff.
   - Match the repository's latest-message style: one imperative, sentence-case header with no trailing period, then a blank line, then two or more `- ` bullets.
   - Make each bullet a concise sentence ending in a period. Group related outcomes and behavior; avoid a file-by-file inventory.
   - Use this exact shape:

     ```text
     Add concise outcome-oriented header

     - Describe one substantial behavior or outcome.
     - Describe another substantial behavior or outcome.
     ```

   - Never mention, imply, or add trailers saying the commit was authored, co-authored, generated, or assisted by Codex, Claude, an AI, or any other automated tool.
   - Never add an AI identity through `Co-authored-by`, `Author`, `Committer`, `Signed-off-by`, or similar attribution. Leave the repository's configured human Git identity unchanged; do not use `--author` or modify Git identity configuration.

5. Stage and commit.
   - Run `git add -A` so the commit includes all changes in scope, including deletions and untracked files.
   - Reinspect `git status --short`, `git diff --cached --stat`, and `git diff --cached`. Confirm every initial in-scope path is represented and no unsafe path was added.
   - Run `git diff --cached --check`.
   - Commit with the exact prepared message, preserving the header, blank line, and contiguous bullet list. If using a temporary message file, keep it outside the repository or remove it afterward.
   - If a hook fails or modifies files, inspect the resulting state before retrying. Do not bypass hooks unless the user explicitly requests it.

6. Verify and report.
   - Verify the result with `git show -1 --stat --format=fuller`, `git log -1 --format=%B`, and `git status --short --branch`.
   - Report the commit hash and final message, validation performed, and whether any changes remain. Do not push unless the user separately asks.
