# Project Workflow

- By default, publish completed and tested implementation changes to GitHub,
  unless the user asks to keep them local. Commit only changes belonging to the
  current task, push to the existing `main` branch, and verify the GitHub Pages
  deployment before reporting the version as live.
- Fetch the latest remote state before publishing. Online progress saves can
  advance `main` independently: preserve them and never force-push over them.
  If the local branch has diverged, publish the task commit from a temporary
  worktree based on `origin/main`, without replacing the user's local files.
- Do not change or publish saved patterns or progress as part of a code update.
  Leave unrelated working-tree changes untouched, including deleted examples.
  Never put authentication tokens in the repository or command output.
