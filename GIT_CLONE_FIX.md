# Git Operations Fix for Cloud Run

## Problem

The Temporal worker was failing in Cloud Run with `ENOENT` errors when trying to execute Git commands:

```
Error: spawnSync /bin/bash ENOENT
Error: spawnSync /bin/sh ENOENT
```

The root cause was that the workflow was expecting a `projectDir` (local filesystem path) to be passed from the CLI, but Cloud Run containers don't have access to the user's local filesystem.

## Solution

Changed the architecture to **clone the Git repository inside the Cloud Run container** before processing:

### 1. **Added Git Clone Functionality** (`apps/temporal-worker/src/utils/git-ops.ts`)

```typescript
export function cloneRepository(gitRemoteUrl: string, branch: string): string;
export function cleanupRepository(projectDir: string): void;
```

- Clones repository to a temporary directory (`/tmp/perceo-git-*`)
- Fetches full history (needed for bootstrap analysis)
- Cleans up after workflow completes

### 2. **Added Clone/Cleanup Activities** (`apps/temporal-worker/src/activities/git.activities.ts`)

```typescript
export async function cloneRepositoryActivity(input: CloneRepositoryInput): Promise<CloneRepositoryOutput>;
export async function cleanupRepositoryActivity(input: { projectDir: string }): Promise<void>;
```

- Wraps Git clone/cleanup operations as Temporal activities
- Clone runs at workflow start (after validation, before commit scan)
- Cleanup runs at workflow end (success or failure)

### 3. **Updated Workflow** (`apps/temporal-worker/src/workflows/bootstrap-project.workflow.ts`)

**Before:**

```typescript
export interface BootstrapProjectInput {
	projectDir: string; // Local filesystem path (doesn't work in Cloud Run)
	// ...
}
```

**After:**

```typescript
export interface BootstrapProjectInput {
	gitRemoteUrl: string; // Git remote URL to clone
	// ...
}

// Workflow now:
// 1. Validates API key
// 2. Clones repository
// 3. Scans commit history
// 4. Extracts personas/flows/steps
// 5. Cleans up cloned repo (always, even on error)
```

### 4. **Updated Worker HTTP API** (`apps/temporal-worker/src/index.ts`)

```typescript
// Now expects gitRemoteUrl instead of projectDir
const { projectId, gitRemoteUrl, projectName, framework, branch, workflowApiKey } = body;
```

### 5. **Updated CLI** (`apps/cli/src/commands/init.ts`)

```typescript
// Sends Git remote URL instead of local path
bootstrapResponse = await fetch(`${workerApiUrl}/api/workflows/bootstrap`, {
	method: "POST",
	headers,
	body: JSON.stringify({
		projectId: tempProject.id,
		gitRemoteUrl, // ← Changed from projectDir
		projectName,
		framework,
		branch: "main",
		workflowApiKey,
	}),
});
```

### 6. **Fixed Shell Issues**

Removed explicit shell specifications from `execSync` calls:

**Before:**

```typescript
execSync(`git command`, { shell: "/bin/bash" }); // ENOENT error
```

**After:**

```typescript
execSync(`git command`); // No shell option = direct spawn
```

This is more portable and doesn't require bash/sh to be available.

## Testing

### Local Container Test

```bash
# Build the image
docker build -f apps/temporal-worker/Dockerfile -t perceo-worker-test .

# Test inside container
docker run -it --rm perceo-worker-test sh

# Inside container, verify Git works
node -e "const { execSync } = require('child_process'); console.log(execSync('git --version', {encoding: 'utf-8'}))"
```

### Deploy and Test

```bash
# Build the worker
pnpm --filter @perceo/temporal-worker build

# Build and deploy Docker image
BUILD_LOCALLY=1 ./scripts/deploy-temporal-worker.sh

# Test from CLI
perceo init
```

## Benefits

1. **Works in Cloud Run**: No local filesystem dependency
2. **Secure**: Temporary clones are isolated and cleaned up
3. **Scalable**: Each workflow gets its own repo clone
4. **Clean**: Automatic cleanup on success or failure
5. **Portable**: No shell dependencies

## Migration Notes

- The CLI now **requires** a Git remote to be configured
- Public repositories work out of the box
- Private repositories will need authentication (SSH keys or tokens) - to be added later if needed
- The `gitRemoteUrl` is already captured and stored in the database (`projects.git_remote_url`)

## Future Improvements

1. **Authentication**: Support private repositories with SSH keys or GitHub tokens
2. **Caching**: Cache frequently cloned repos to speed up workflows
3. **Shallow clones**: For large repos, optionally limit history depth
4. **Progress tracking**: Report clone progress in workflow status
