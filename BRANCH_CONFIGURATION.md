# Branch Configuration Support

This document describes the branch configuration feature added to Perceo to support repositories with different default branches (e.g., `master`, `main`, `develop`).

## Overview

Perceo now automatically detects and allows configuration of the main/watched branch for a Git repository. This ensures proper functionality for repositories that use `master` or other branch names instead of `main`.

## Changes Made

### 1. CLI Init Command (`apps/cli/src/commands/init.ts`)

#### New CLI Option

- Added `--branch <branch>` option to specify the main branch explicitly
- Auto-detection if not specified

#### Branch Detection Logic

Added `detectDefaultBranch()` function that tries multiple methods:

1. Query the remote's default branch via `git symbolic-ref refs/remotes/origin/HEAD`
2. Check the current branch with `git branch --show-current`
3. Verify if `main` branch exists with `git rev-parse --verify main`
4. Verify if `master` branch exists with `git rev-parse --verify master`
5. Fallback to `main` as default

#### Configuration Storage

- Branch is now stored in `.perceo/config.json` under `project.branch`
- Example config:

```json
{
	"version": "1.0",
	"project": {
		"id": "...",
		"name": "my-project",
		"framework": "nextjs",
		"branch": "master"
	},
	"observer": {
		"watch": {
			"paths": ["app/", "src/"],
			"ignore": ["node_modules/", ".next/", "dist/", "build/"],
			"debounceMs": 500
		}
	}
}
```

#### GitHub Actions Workflow Generation

- Updated `generateGitHubWorkflow()` to accept the configured branch
- Workflow triggers on the configured branch plus common alternatives (main/master)
- Example generated workflow:

```yaml
on:
    pull_request:
        branches: [master, main]
    push:
        branches: [master, main]
```

#### User Feedback

- Displays detected or specified branch during initialization
- Shows branch in the summary output
- Updates help text to use the configured branch

### 2. Temporal Worker (`apps/temporal-worker/`)

#### Workflow Input (`src/workflows/bootstrap-project.workflow.ts`)

- `BootstrapProjectInput` already includes `branch: string` field
- Workflow passes branch to all relevant activities:
    - `cloneRepositoryActivity({ gitRemoteUrl, branch })`
    - `getCommitHistoryActivity({ projectDir, branch })`
    - `extractStepsForFlowActivity({ ..., branch })`

#### Git Activities (`src/activities/git.activities.ts`)

- `cloneRepositoryActivity` accepts and uses branch parameter
- `getCommitHistoryActivity` accepts and uses branch parameter
- Both activities properly pass branch to git-ops utilities

#### Git Operations (`src/utils/git-ops.ts`)

- `cloneRepository(gitRemoteUrl, branch)` - clones specific branch
- `getAllCommits(projectDir, branch)` - gets commits from specific branch
- Default branch parameter is `"main"` for backward compatibility

### 3. Worker API Endpoint (`apps/temporal-worker/src/index.ts`)

- `/api/workflows/bootstrap` endpoint accepts `branch` parameter
- Defaults to `"main"` if not provided: `const { ..., branch = "main", ... } = body`
- Passes branch to workflow input

## Usage

### Initializing with Auto-Detection

```bash
perceo init
# Auto-detected default branch: master
```

### Initializing with Explicit Branch

```bash
perceo init --branch develop
# Using specified branch: develop
```

### Existing Commands

The `analyze` command already accepts branch as a base reference:

```bash
perceo analyze --base master
perceo analyze --base develop
```

## Backward Compatibility

- Existing projects without branch configuration will continue to work
- Default branch is `"main"` if not specified
- GitHub Actions workflows support both configured branch and common alternatives
- Worker API endpoint defaults to `"main"` for backward compatibility

## Testing

All components build successfully:

- ✅ CLI builds without errors
- ✅ Temporal worker builds without errors
- ✅ No linter errors in modified files

## Files Modified

1. `apps/cli/src/commands/init.ts`
    - Added branch detection and configuration logic
    - Updated workflow generation
    - Added CLI option `--branch`

2. `apps/temporal-worker/src/workflows/bootstrap-project.workflow.ts`
    - Already supported branch parameter (no changes needed)

3. `apps/temporal-worker/src/activities/git.activities.ts`
    - Already supported branch parameter (no changes needed)

4. `apps/temporal-worker/src/utils/git-ops.ts`
    - Already supported branch parameter (no changes needed)

5. `apps/temporal-worker/src/index.ts`
    - Already supported branch parameter with default (no changes needed)

## Future Enhancements

Potential improvements for future releases:

1. **Branch Validation**: Add validation to check if the specified branch exists
2. **Multi-Branch Support**: Support watching multiple branches
3. **Branch Switching**: Add command to update the configured branch
4. **CI Configuration**: Auto-detect branch from CI environment variables
5. **Remote Branch Sync**: Periodically check if remote default branch changed
