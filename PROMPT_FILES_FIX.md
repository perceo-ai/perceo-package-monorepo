# Fix: Personas Prompt Config Not Loaded

## Problem

The Temporal Worker was failing with the error:

```
Error: Personas prompt config not loaded
    at ClaudeClient.extractPersonasFromDiff
    at extractPersonasFromDiffActivity
```

or:

```
Error: flows-from-graph prompt config not loaded
    at ClaudeClient.identifyFlowsFromRouteGraph
    at identifyFlowsFromGraphActivity
```

This occurred because the prompt files (`prompt.txt` and `schema.json`) in `src/prompts/` were not being copied to the `dist/` directory during the build process.

## Root Cause

TypeScript compilation (`tsc`) only compiles `.ts` files to `.js` files. It doesn't copy non-TypeScript files like `.txt` and `.json` files to the output directory.

The `ClaudeClient` class tries to load prompts from disk at runtime:

```typescript
const promptsDir = join(__dirname, "../prompts");
// Reads from: dist/prompts/personas/prompt.txt
//             dist/prompts/flows/prompt.txt
//             dist/prompts/steps/prompt.txt
//             dist/prompts/flows-from-graph/...
//             dist/prompts/personas-assign/...
```

When these files were missing, the `loadPrompts()` method would fail silently (only logging errors), and later calls would throw the error.

## Solution

1. **Local build** – The build script in `apps/temporal-worker/package.json` copies the prompts directory after TypeScript compilation:

    ```json
    "build": "tsc && cp -r src/prompts dist/prompts"
    ```

2. **Docker build** – The Dockerfile explicitly copies `src/prompts` into `dist/prompts` after the pnpm build, so the image always has all prompt configs even if a cached build omitted them.

## Additional Improvements

Added better logging to the `ClaudeClient.loadPrompts()` method to help diagnose similar issues in the future:

- Logs the prompts directory path being used
- Logs each prompt file path being loaded
- Logs success messages for each loaded prompt config
- Shows summary of all loaded prompt configs

## Verification

After the fix:

1. Build completes successfully: `pnpm worker:build`
2. Prompt files exist in dist:
    - `dist/prompts/personas/prompt.txt`
    - `dist/prompts/personas/schema.json`
    - `dist/prompts/flows/prompt.txt`
    - `dist/prompts/flows/schema.json`
    - `dist/prompts/steps/prompt.txt`
    - `dist/prompts/steps/schema.json`
    - `dist/prompts/flows-from-graph/prompt.txt`
    - `dist/prompts/flows-from-graph/schema.json`
    - `dist/prompts/personas-assign/prompt.txt`
    - `dist/prompts/personas-assign/schema.json`
3. Docker builds will include these files since the Dockerfile copies them into `dist/` after build

## Next Steps

To deploy the fix:

1. Build the worker: `pnpm worker:build`
2. Build and push Docker image (or let CI do it)
3. Deploy to Cloud Run: `pnpm worker:deploy`
