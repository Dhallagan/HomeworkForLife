# Codex Workflow

This repo is set up for small, reviewable feature slices that can be delegated to cloud coding agents.

## Default flow

1. Start from `main`
2. Open or use an issue with a tight blast radius
3. Ask Codex to implement that issue on a new branch
4. Let GitHub CI run
5. Add the `eas-build-ios:preview` label to the PR if you want a phone-installable iOS preview build
6. Review the diff and the build
7. Merge after validation

## Good task shape

- one user moment per PR
- usually no more than 2 to 4 primary files
- preserve the current notebook and paper visual language unless the task says otherwise
- call out device-only validation for recording, HealthKit, Fitbit, permissions, or background behavior

## Avoid

- broad prompts like "professionalize the whole app"
- overlapping PRs against `app/walk.tsx`, `app/index.tsx`, or `src/modules/capture/useWalkCapture.ts`
- claiming simulator validation for background audio or HealthKit behavior

## Suggested labels

- `agent-ready` for issues that can be handed to Codex now
- `blast-radius:small` for tightly scoped tasks
- `ui`, `analytics`, `onboarding`, `walk-flow`, `settings`, `insights`, `native-risk` for routing and review expectations

## Phone workflow

1. Open ChatGPT or Codex on your phone
2. Start a task against `Dhallagan/HomeworkForLife`
3. Point the agent at a specific issue
4. Open the PR in GitHub mobile
5. Add `eas-build-ios:preview` if you need an installable build
6. Review CI, build status, and PR comments from your phone

For rough phone-written prompts, this repo includes the skill `.agents/skills/refine-quick-agent-prompts/`.
Use it when you want Codex to tighten a vague request like "improve this screen" into a bounded task before implementation.

## PR expectations

Every PR should include:

- a short summary of what changed
- user-visible impact
- validation performed
- remaining device-only checks
- follow-up risks or next slices
