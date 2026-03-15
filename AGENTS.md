# WalkLog Agent Guide

## Product context

WalkLog is an Expo Router iPhone app for spoken walking journals. The core loop is:

1. Start a walk
2. Record audio while walking
3. Transcribe the audio
4. Save the journal entry with step data
5. Explore entries and AI-generated insights

The current visual language is intentional. Preserve the paper/notebook aesthetic unless a task explicitly asks for a redesign.

## Setup

Run these commands from the repo root:

```bash
nvm use
npm ci
npm run typecheck
npm run doctor
```

Use `npm run ci:check` before opening or updating a PR.

Use Node `20.19.4` or newer within the Node 20 line for Expo SDK 54 compatibility.

## Environment

Local development may require these environment variables:

- `EXPO_PUBLIC_OPENAI_API_KEY`
- `EXPO_PUBLIC_FITBIT_CLIENT_ID`

Never hardcode secrets. Do not commit `.env.local`.

## Safe changes

Good default tasks for agents:

- onboarding flow improvements
- UI polish that keeps the current style
- state management cleanup
- empty states, loading states, and error states
- analytics/event instrumentation hooks
- build and CI configuration
- copy and settings UX improvements

## Changes that need extra care

Be careful when changing:

- `app/walk.tsx`
- `src/modules/capture/useWalkCapture.ts`
- `src/modules/steps/*`
- `app.json`

These areas affect permissions, background audio, native capabilities, and step tracking.

## Validation expectations

For UI or workflow changes:

- run `npm run ci:check`
- explain any untested device-specific behavior

For recording, permissions, HealthKit, Fitbit, or background behavior:

- run `npm run ci:check`
- call out that real-device validation is still required
- do not claim simulator-only proof for background audio or HealthKit behavior

## PR expectations

Keep PRs small and scoped. In the PR summary include:

- what changed
- user-visible impact
- validation run
- follow-up work or remaining risks

## Build targets

Preferred EAS profiles:

- `development` for dev client work
- `preview` for internal installable builds
- `production` for store distribution
