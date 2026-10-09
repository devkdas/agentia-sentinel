# Agentia Sentinel

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](package.json)
[![Agentia 0.122](https://img.shields.io/badge/agentia-0.122.0--alpha.1-blue.svg)](https://developer.copado.com/docs)

**Sentinel** answers "what could this break" before you ship. It reads a
Copado user story plus local git changes, classifies every file by
metadata type and risk weight, scores release risk transparently, and
writes an explainable report with readiness and a next action.

Deterministic by default, AI narration strictly opt-in. Built for the
**Agentia Headless Virtual Hackathon** as an oclif plugin on top of the
public `agentia` CLI.

---

## Table of Contents

- [The Problem](#the-problem)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Live Demo Workflow](#live-demo-workflow)
- [Command Reference](#command-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [How It Works](#how-it-works)
- [Security](#security)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Hackathon Fit](#hackathon-fit)
- [License](#license)

---

## The Problem

AI-assisted development keeps getting faster, but figuring out what a
change actually affects has not kept up. A small edit can ripple into
flows, permissions, integrations and tests. Deploying successfully is
not the same as deploying safely, yet most teams still judge risk from
gut feel and run the same regression suite no matter what changed.

## Features

- **Story linkage** — resolves the story title and status through the
  verified work list, or says plainly when nothing is linked.
- **Git change reading** — uncommitted plus staged changes with rename
  handling, or an offline `--files` list with zero repo access.
- **Transparent scoring** — every point carries its reason, bands at
  under 25 LOW, under 50 MODERATE, under 75 HIGH, else CRITICAL.
- **Local reference scan** — changed Apex classes checked against the
  tree for referencing files, capped and honest about limits.
- **Business area hints** — Accounts, Billing, Automation and access
  control inferred from changed paths.
- **Missing validation list** — unwired test evidence and local-only
  dependencies stated openly instead of assumed.
- **Opt-in AI narration** — operate agent plain English note, off by
  default so runs stay deterministic and free.
- **Zero private imports** — only shells out to public `agentia`
  commands plus local `git`.

## Installation

### Prerequisites

- Node 18 or newer.
- Agentia CLI beta: `npm install -g @copado/agentia-cli@beta`
- Authenticated machine: `agentia setup` (CICD at minimum).
- Git for `--dir` mode. File mode needs nothing.

### Install from source

```sh
git clone https://github.com/devkdas/agentia-sentinel.git
cd agentia-sentinel
npm install
npm run build
agentia plugins link .
```

Re-run `npm run build` after every change to the TypeScript files.

## Quick Start

### 1. Assess a story against local changes

```sh
agentia sentinel assess --story US-0000024 --dir ./my-repo --json
```

### 2. Assess offline with a file list

```sh
agentia sentinel assess --story US-0000024 --files force-app/main/default/classes/Foo.cls --json
```

### 3. Group changes by metadata risk

```sh
agentia sentinel diff --files force-app/main/default/classes/Foo.cls,force-app/main/default/profiles/Admin.profile-meta.xml --json
```

### 4. Write the report to a file

```sh
agentia sentinel report --story US-0000024 --dir ./my-repo --output ./risk.md --json
```

### 5. Add the AI narration (spends quota)

```sh
agentia sentinel assess --story US-0000024 --dir ./my-repo --ai-narrate --json
```

## Live Demo Workflow

Verified live:

```text
1. agentia sentinel diff --files <3 salesforce paths> --json
   -> ApexClass 3, Flow 3, Profile 4 grouped with total weight
2. agentia sentinel assess --story US-0000024 --files <same> --json
   -> story found (Draft), score 30 MODERATE, factors with reasons
3. agentia sentinel report --story US-0000024 --files <same> --output /tmp/sentinel-live.md --json
   -> markdown file written, readiness stated
```

## Command Reference

### `agentia sentinel assess`

| Flag | Description |
|---|---|
| `-s, --story <id>` | Copado user story ID scoping the assessment |
| `-d, --dir <path>` | Git working tree for local changes (default `.`) |
| `--files <list>` | Comma separated file paths for offline use, skips git |
| `--ai-narrate` | Operate agent impact note, off by default |
| `--timeout <n>` | AI gateway timeout seconds (default `120`, 30 to 600) |
| `-j, --json` | Machine readable JSON report |

Advisory only, always exits zero. Missing story, non repo
directories and unreachable agents all report honestly.

### `agentia sentinel diff`

| Flag | Description |
|---|---|
| `--files <list>` | Comma separated file paths to classify |
| `-d, --dir <path>` | Git working tree for local changes |
| `-j, --json` | Machine readable JSON output |

One of `--files` or `--dir` is required. Fully offline.

### `agentia sentinel report`

| Flag | Description |
|---|---|
| `-s, --story <id>` | Copado user story ID scoping the assessment |
| `-d, --dir <path>` | Git working tree for local changes (default `.`) |
| `--files <list>` | Comma separated file paths for offline use, skips git |
| `-o, --output <path>` | Report file path (default `./sentinel-report-<date>.<format>`) |
| `--format md\|json` | Report file format (default `md`) |
| `-j, --json` | Machine readable JSON summary |

Reads only, writes one local file.

## Configuration

Scoring weights live in `src/lib.ts` next to the rules they serve:
extensions map to metadata types with weights 0 to 4, factors cap at
100. Tune them there and rebuild.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Empty file list on a dirty tree | Untracked files only, or wrong `--dir` | Check `git status` in the target dir first |
| Story shows unlinked | ID missing from the work list, or gateway down | Verify the ID in the story record |
| Agent narration unavailable | Quota spent or gateway slow | Re-run without `--ai-narrate`, the score stands alone |
| ESM auto-transpile warning | Linked ESM plugin notice | Benign, compiled output is used |

## How It Works

```text
agentia sentinel assess
  -> work list (story) plus git status or file list (changes)
  -> extension rules classify every file with weights
  -> git grep reference scan, capped per class
  -> transparent factors summed to a banded score
  -> optional operate agent narration

agentia sentinel diff
  -> same classification, grouped output, no scoring

agentia sentinel report
  -> same assessment, written to a markdown or JSON file
```

## Security

Read only against orgs and repos. The only writes are the report
file you name and local git reads. AI narration sends the scored
summary to the operate agent only when you pass the flag.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript on Node 18+ |
| CLI Framework | oclif v4 (ESM, matching the host CLI) |
| Runtime calls | `node:child_process` to public `agentia` commands plus local `git` |
| AI | Operate agent via `ai agent ask`, strictly opt-in |

## Architecture

```text
Developer / Agent
        |
agentia sentinel assess --story --dir
        |
Sentinel (this plugin)
  |- readers  -> work list plus git status or file list
  |- classifier -> extension rules with weights
  |- scanner  -> capped git grep references
  |- scorer   -> transparent factors to band
  |- narrator -> optional operate agent note
        |
Human report plus JSON, report file via sentinel report
```

## Hackathon Fit

Prototypes the missing risk intelligence layer: deployment success
says what shipped, Sentinel says what it could break. Deterministic
by default with AI where it helps, honest about every gap, and
composable with blast maps plus audit reports for the full story.

## License

MIT License — see [LICENSE](LICENSE) for details.
