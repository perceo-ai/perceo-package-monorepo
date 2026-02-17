# @perceo/temporal-worker

## 0.3.2

### Patch Changes

- Change LLM to sonnet 4.5 for cost and better performance
  - @perceo/observer-engine@3.0.2

## 0.3.1

### Patch Changes

- Updating logginf or the temporal and cli output off init
- Updated dependencies
  - @perceo/observer-engine@3.0.1
  - @perceo/supabase@0.3.1

## 0.3.0

### Minor Changes

- Completely revamped the observer engine's init/bootstrap workflow to better suit how I want flows to be generated/how I want them to look

### Patch Changes

- Updated dependencies
  - @perceo/observer-engine@3.0.0
  - @perceo/supabase@0.3.0

## 0.2.5

### Patch Changes

- Try to fix the .env not working again.
- Updated dependencies
  - @perceo/observer-engine@2.0.5
  - @perceo/supabase@0.2.4

## 0.2.4

### Patch Changes

- Fix anon key and supabase url not present for login before pulling public_env
- Updated dependencies
  - @perceo/observer-engine@2.0.4
  - @perceo/supabase@0.2.3

## 0.2.3

### Patch Changes

- Adding loading for .env variables from public env
- Updated dependencies
  - @perceo/observer-engine@2.0.3
  - @perceo/supabase@0.2.2

## 0.2.2

### Patch Changes

- Updated dependencies
  - @perceo/supabase@0.2.1
  - @perceo/observer-engine@2.0.2

## 0.2.1

### Patch Changes

- @perceo/observer-engine@2.0.1

## 0.2.0

### Minor Changes

- fe27e70: Adding base observer engine that updates on init and ci
- d844404: Init command finally works and all workers + packages configured/deployed

### Patch Changes

- Updated dependencies [341eabf]
- Updated dependencies [fe27e70]
- Updated dependencies [d844404]
  - @perceo/observer-engine@2.0.0
  - @perceo/supabase@0.2.0
