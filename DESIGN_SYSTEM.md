# WalkLog Design System

WalkLog should feel like a quiet field notebook, not a generic utility app.
The product is small, so the interface has to do two jobs at once:

1. Make recording a walk feel calm and intentional.
2. Make setup and system state feel clear without breaking the notebook mood.

## Design Direction

The app uses a warm paper palette, soft rounded surfaces, and sparse interface chrome.
Primary screens should feel like pages, tabs, and note panels rather than default mobile cards.

## Core Principles

### 1. Notebook First

When deciding between a generic app pattern and a paper-like pattern, prefer the paper-like one.
Use `PaperSheet`, `PaperRow`, `PaperTab`, and notebook-styled panels before inventing a new surface.

### 2. One Voice For Type

Use large, airy titles for the main moment on a screen.
Use body copy sparingly and keep it practical.
Use monospaced uppercase text only for metadata, section labels, and small status labels.

### 3. Warm Surfaces, Sharp Meaning

Backgrounds and panels should stay quiet.
Only use stronger contrast for:

- the primary action
- destructive actions
- state signals like `Ready`, `Blocked`, or `Missing`

### 4. Status Near Action

If a screen asks the user to fix or allow something, show the current state next to the title and place the action directly underneath the explanation.
Do not separate status, copy, and action across different cards.

### 5. Fewer Containers

Prefer one strong panel with grouped rows over many small unrelated cards.
If two items belong to the same mental model, keep them in the same panel and separate them with a rule.

## Tokens

Source of truth lives in [src/theme.ts](/Users/dylan/Development/WalkLog/src/theme.ts).

- `colors`: warm paper palette plus semantic ink and status colors
- `spacing`: base rhythm for gaps and padding
- `radii`: shared corner sizes
- `layout`: screen and panel padding rules
- `statusColors`: chip colors for neutral, success, and danger states

## Shared Primitives

Shared layout and utility components live in [src/components/ui.tsx](/Users/dylan/Development/WalkLog/src/components/ui.tsx).
Notebook-specific surfaces live in [src/components/notebook.tsx](/Users/dylan/Development/WalkLog/src/components/notebook.tsx).

Use these primitives by default:

- `Screen`: standard safe-area screen wrapper
- `ScreenHeader`: eyebrow, title, and description for a screen intro
- `SectionLabel`: small uppercase separator between major groups
- `Panel`: standard warm surface for grouped content
- `Pill`: compact status indicator
- `PrimaryButton`: main action inside a panel
- `SecondaryButton`: lower-emphasis follow-up action
- `PaperSheet`: long-form content, transcripts, and writing surfaces
- `PaperRow`: list rows and row-based grouped settings

## Screen Recipes

### Home

Use direct, editorial hierarchy:

- date and title first
- main list second
- one persistent bottom action

### Entry Detail

Use `PaperSheet` for editable long-form text.
Keep chrome minimal.

For journal reading and editing surfaces, use the tighter History type scale as the reference point:

- small date and meta text
- compact bold entry titles
- small preview/body copy
- favor one continuous reading column over stacked sub-panels

When showing journal history by day, prefer a linear ledger treatment:

- date in a narrow left gutter
- one divider between date and content
- entries stacked in one continuous right column
- avoid extra stats rows or boxed subsections unless they are necessary for comprehension

### Walk Capture

Use one active focal area.
Metrics and transcript preview should support the recording state, not compete with it.

### Settings

Use a preflight layout:

- one overview panel for readiness
- one grouped permissions panel
- one grouped services panel

Every setting block should include:

- a small eyebrow describing its role
- a clear title
- a status pill
- one short explanation
- one direct action when needed

## Do / Don’t

Do:

- group related controls inside one panel
- keep meta text monospaced and uppercase
- let status chips carry state instead of adding extra labels everywhere
- reserve strong contrast for actions and warnings

Don’t:

- mix generic app cards with notebook surfaces on the same screen
- stack multiple competing primary actions in one group
- use long paragraphs where one direct sentence works
- invent a new border radius, shadow, or spacing step without adding it to the theme
