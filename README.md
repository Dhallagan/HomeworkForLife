# WalkLog

WalkLog is an Expo Router iPhone app for spoken walking journals. The current
product scope is intentionally narrow:

- Start a walk
- Talk freely
- End the walk
- Upload the recorded audio to OpenAI Whisper for transcription
- Save the transcript with the walk's step count
- Show today's steps on the home screen when Apple Health access is granted

There is no backend, login, paywall, or export in this version. Transcription is
currently sent directly from the app to OpenAI for prototype purposes, which is
not a production-safe secret model.

## Run locally

1. Use Node `20.19.4` or newer within the Node 20 line. `.nvmrc` is included for this.
2. Install dependencies with `npm install`
3. Copy `.env.example` to `.env.local` and fill in required values
4. Run `npm run typecheck`
5. Run `npm run doctor`
6. Generate native projects with `npm run prebuild`
7. Run on iPhone or simulator with `npm run ios`
8. Set `EXPO_PUBLIC_OPENAI_API_KEY` before running on a real device
9. If you want Fitbit steps, set `EXPO_PUBLIC_FITBIT_CLIENT_ID` and register `walklog://fitbit` as the redirect URI in the Fitbit developer app

## Cloud agent groundwork

This repo now includes a few basics for remote agent and review workflows:

- `AGENTS.md` defines setup, validation, and guardrails for coding agents
- `.github/workflows/ci.yml` runs typecheck and Expo doctor on pushes and PRs
- `.github/workflows/eas-preview.yml` can trigger EAS preview builds from GitHub
- `eas.json` includes `development`, `preview`, and `production` build profiles

Useful commands:

- `npm run ci:check`
- `eas build --platform ios --profile preview`
- `eas build --platform ios --profile production`

Recommended review loop:

1. Push a branch
2. Let CI pass
3. Trigger an EAS preview build for iPhone testing
4. Review the diff and build from your phone
5. Merge after device validation

## GitHub-triggered preview builds

To let GitHub Actions trigger EAS builds, add an `EXPO_TOKEN` repository secret.
Create it from the Expo access token page and store it in GitHub Actions secrets.

Once that secret exists, you have two trigger paths:

1. Run the `EAS Preview` workflow manually from the GitHub Actions tab
2. Add the `eas-build-ios:preview` label to a PR targeting `main`

The PR-label path is the simplest one to use from a phone.

Expo SDK 54 lists Node `20.19.x` as the minimum supported version, and the
current EAS SDK 54 images use Node `20.19.4`. Local `expo-doctor` will fail on
older Node 20 releases such as `20.6.1`. Sources: [Expo SDK 54 reference](https://docs.expo.dev/versions/v54.0.0/), [EAS build infrastructure](https://docs.expo.dev/build-reference/infrastructure/).

## Weekend validation

Before treating the prototype as successful, manually validate:

1. A real outdoor 10-minute walk with the screen locked for part of the session
2. Whisper transcription completes and saves the entry after `End Walk`
3. Health permission granted shows a real step total on home and saves walk steps
4. Health permission denied still saves an entry with `0` steps
5. Microphone permission denied does not crash the app
6. Settings reflects real microphone/Health status and can open system settings
