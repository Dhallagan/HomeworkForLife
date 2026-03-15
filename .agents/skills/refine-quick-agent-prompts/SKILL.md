---
name: refine-quick-agent-prompts
description: Rewrite short, vague, or phone-typed user requests into bounded agent-ready prompts or GitHub issue drafts. Use when a user says things like "improve this screen", "tighten this flow", "make this feel better", or any other terse product or coding request that needs clearer scope, constraints, done criteria, or validation before handing it to Codex.
---

# Refine Quick Agent Prompts

Turn rough chats into small, executable tasks without making the user remember a template.

Default to a concise rewrite, not a long planning document. Preserve the user's intent and tone, but add the minimum structure needed so another agent can work reliably.

## Core Workflow

1. Identify the target.
   Determine the screen, flow, file area, or product surface the user means.

2. Extract the complaint and the intended outcome.
   Convert "this feels bad" into a short problem statement and 1-2 goals.

3. Add guardrails.
   Infer one or two constraints that keep the blast radius small. Prefer constraints such as:
   - keep the current visual style
   - do not change risky logic
   - open a PR to `main`
   - summarize validation and follow-up work

4. Choose the output shape.
   Use the lightest shape that solves the request:
   - `Quick Prompt`: for immediate Codex use
   - `Issue Draft`: for GitHub issue creation
   - `Prompt + Issue Draft`: when the user is clearly building backlog and execution flow together

5. Ask at most one clarification question only if the target is genuinely ambiguous and the wrong assumption would create rework.
   Otherwise make a reasonable assumption and state it briefly.

## Default Heuristics

Prefer small, reviewable changes.

- One user moment per task
- Usually no more than 2-4 primary files
- Do not combine multiple flows into one prompt unless the user explicitly wants that

When working in `Dhallagan/HomeworkForLife`, default to:
- keep the current notebook and paper visual style
- avoid overlapping changes to `app/index.tsx`, `app/walk.tsx`, and `src/modules/capture/useWalkCapture.ts`
- call out real-device validation for recording, permissions, HealthKit, Fitbit, or background behavior
- use `Open a PR to main.` as the default delivery instruction

If the request is too broad, narrow it to the most obvious first slice instead of echoing the whole thing back unchanged.

## Output Templates

### Quick Prompt

Use this when the user wants to fire off a task immediately:

```text
Improve [target] because [problem].
Goals:
- [goal 1]
- [goal 2]
Constraints:
- [constraint 1]
- [constraint 2]
Open a PR to main.
Summarize validation and any follow-up work still needed.
```

If the request is extremely short, compress further:

```text
Improve [target] because [problem].
Keep the current style.
Do not change [risky area].
Open a PR to main.
```

### Issue Draft

Use this when the user is shaping backlog:

```markdown
## Goal
[user-facing outcome]

## Scope
- [screen, module, or file area]

## Constraints
- [constraint 1]
- [constraint 2]

## Done Criteria
- [acceptance criterion 1]
- [acceptance criterion 2]

## Validation
- [required checks]
- [device-only notes if relevant]

## Preview Build Needed
[Yes or No]
```

## Examples

### Example 1

User input:

```text
The settings screen is too technical.
```

Rewrite:

```text
Improve the settings screen because it feels too technical and prototype-like.
Goals:
- make the information hierarchy easier to scan
- rewrite permission and service copy to feel consumer-facing
Constraints:
- keep the current visual style
- do not change permission logic or native wiring
Open a PR to main.
Summarize validation and any follow-up work still needed.
```

### Example 2

User input:

```text
We need to improve this screen.
```

If the target is clear from context, rewrite directly. If the target is not clear, ask one short question:

```text
Which screen do you mean: home, walk, insights, entry, or settings?
```

### Example 3

User input:

```text
Onboarding is too rough. Make it cleaner.
```

Rewrite into a first slice, not a giant program:

```text
Improve the first-run home experience because onboarding currently feels too rough and undefined.
Keep the current visual style.
Do not redesign the full onboarding flow yet.
Open a PR to main.
```

## Style Rules

- Keep rewrites short enough to send from a phone
- Prefer direct language over product-jargon
- Do not produce a long plan unless the user asked for one
- Preserve the user's urgency and taste, but add scope discipline
- When in doubt, choose the smallest sensible first PR
