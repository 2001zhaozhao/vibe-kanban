# 2001zhaozhao's Vibe-Kanban Fork

`Disclaimer: the extra README sections in this fork are written by a human.`

A fork of Vibe-Kanban with various improvements.

The improvements are AI-coded with bare minimum quality control, as I don't intend to contribute them.
The main purpose of this fork is to experiment with AI development workflows that let me manage agents at a
higher level while preserving high code quality through manual oversight.
My aim is to push the human-in-the-loop AI development workflow as far as possible.

## Improvements

* Added a Remote Single-User Mode for use without OAuth
  * Allows skipping GitHub/Google OAuth and support a local account when self-hosting both the remote server,
    local server, and frontend.
  * All new Vibe-Kanban features such as organizations, projects, and the kanban board work properly.
  * You can remotely deploy vibe-kanban in Single User Mode to skip authentication.
    Configuring separate authentication via HTTP proxy Basic Auth is fully supported and provides
    security reassurances that do not depend on vibe-kanban itself.
* Added a convenience button to Merge All repositories, and a variant that also moves the linked issue to Done.
  * The feature is adaptive: if code is already merged, the Merge button will be disabled,
    and the Merge & Complete button can still move issue to done.
    If linked issue is already done, the Merge & Complete button will be disabled.
    If the workspace is not linked to any issue in any kanban board, the Merge & Complete button will be hidden.
  * Clicking the Merge & Complete button will move the issue to the top of the "Done" category.
    If this category is not found, it will move it to the rightmost category instead.
* Added Toasts feature
  * Vibe-Kanban dev complained it isn't accessible, but it sure can be helpful so I've added it to this fork.
  * Toasts are shown when Merge (both single-repo and multi-repo shortcut) are successful; when an issue is created;
    when an issue is moved between categories by user action; and when an agent completes
    (which previously only played sound).
* You can now see basic information of the linked issue from the Workspace UI
* Added TLS support for the local development remote server, enabling HTTP/2 and removing a browser concurrent
  connections limit issue that caused unusable performance when running the original `vibe-kanban` setup locally.
  Additional setup is required, see the `TLS Setup Guide` section below.
  * The TLS support is optional. You can leave it disabled if you are running the remote server behind a HTTPS proxy.
* Added the ability to right click a workspace card in the Project / Kanban Board page to directly go to the
  full-screen workspace view. Left click still shows a preview of the workspace just like before.
* Fixed a bug where agent logs from one workspace appears to show up in another workspace if directly switching between
  workspace previews in the Kanban page.
* When pasting multi-line text into the title of a new issue in the kanban board,
  any additional lines will overflow into the description.
* Added the ability to archive workspaces in the kanban board issue-linked workspace dropdown.
  This saves several clicks every time you are done with a task but did not merge into the main branch
  (e.g. for exploration tasks or tasks you decide to abandon).
* When using the feature to automatically resolve Git rebase conflicts, if the coding agent is currently in Plan mode,
  it will send the command in non-Plan mode instead. This avoids the agent creating an unnecessary plan to implement
  a simple rebase.
* Added a preconnect hint to the remote server's URL from the frontend to improve performance, and upgrade the
  connection to HTTP 2 sooner to resolve ElectricSQL shape loading issues on initial load.
  Also, the frontend will now delay loading until HTTP/2 has been negotiated with the remote server, or a fixed timeout.
* When accepting a plan in Claude Code ExitPlanMode, the UI will now automatically switch to Edit mode instead of
  remaining in Plan mode. This lets you send follow-up prompts without the agent switching back to plan mode.
* Added a new button when exiting the Claude Code Plan Mode to implement in a new workspace,
  similar to the "Clear Context and Implement" feature in Claude Code CLI which technically does the same thing.
  The button will create a new Workspace with a new agent being fed the plan as its prompt, switch to the current
  window to the new agent, and archive the existing workspace.
  This is analogous to how the same feature in the Claude Code CLI behaves, except it also creates a new Git worktree
  for the workspace due to how vibe-kanban works.
* Remove the "vibe kanban is shutting down" banner because don't care

## TLS Setup Guide

This fork includes a feature to allow local development without slowdowns by enabling HTTP/2 for the remote dev server.
HTTP/2 requires TLS so you need to follow the below guide to set up a local certificate via `mkcert`.
Without this, the server would use plain-HTTP with HTTP 1.1, which causes ElectricSQL's long-polling sync requests
to block each other due to the browser's 6 concurrent connection limit in HTTP 1.1.
(This is an issue in vanilla vibe-kanban which is fixed in this fork.)

Setup guide from Claude:
```
One-time setup with https://github.com/FiloSottile/mkcert:

# Install mkcert (once)
# macOS: brew install mkcert
# Linux: see https://github.com/FiloSottile/mkcert#installation

# Install local CA into system trust store (once)
mkcert -install

# Generate certs for localhost (once)
cd crates/remote
mkcert -cert-file localhost-cert.pem -key-file localhost-key.pem localhost 127.0.0.1 ::1

Then add to .env.remote:
TLS_CERT_PATH=localhost-cert.pem
TLS_KEY_PATH=localhost-key.pem

And update VK_SHARED_API_BASE to use https://:
VK_SHARED_API_BASE=https://localhost:3000
```

## My Own Deployment

This is how I personally deploy this Vibe-Kanban fork.
The fork fully supports a setup like this through the added Single User Mode feature.
This lets me spin up my customized vibe-kanban with one command to work on my own projects,
backed by a self-hosted remote server.

### CI/CD setup:

* On push to this fork repository, CI/CD is triggered via `trigger-fork-deploy` GitHub workflow.
* The build & deploy workflow in my private Git repository is triggered to publish the backend Docker image.
* The remote server Docker image is deployed to my private server via CI/CD or with a local direct-deployment script.

### Remote server setup:

* Hosted on a Ubuntu server.
* Runs on Docker Compose with image sourced from the private Git repository.
* Runs in vibe-kanban Single User Mode (feature added by this fork) and listens to localhost.
* Uses a reverse proxy with HTTPS and Basic Auth for security independent to vibe-kanban's authentication.

### Frontend setup:

* A local script conveniently runs the frontend binary, pointing it to the deployed remote server.
* A user-scope systemctl service runs the above local script as a background process.
* A custom bash script controls the service.
  I can simply type the `kanban` command to start my vibe-kanban local server.

## Long-term goal of the fork

Eventually, I would like to experiment with agent orchestration systems that use vibe-kanban as the
task sharing UI to give humans visibility and high-level control of the agent team's workflow.

I think that effective quality-control by humans at the highest possible "managerial" level is the key to building an
effective agent swarm architecture that saves human time without going off the rails, and UI is a very important
piece of the puzzle which I would like to experiment with by forking vibe-kanban.
Basically I want to build better UIs that let the human more effectively play the role of a manager of
a team of coding agents.

<p align="center">
  <a href="https://vibekanban.com">
    <picture>
      <source srcset="packages/public/vibe-kanban-logo-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/public/vibe-kanban-logo.svg" media="(prefers-color-scheme: light)">
      <img src="packages/public/vibe-kanban-logo.svg" alt="Vibe Kanban Logo">
    </picture>
  </a>
</p>

<p align="center">Get 10X more out of Claude Code, Gemini CLI, Codex, Amp and other coding agents...</p>
<p align="center">
  <a href="https://www.npmjs.com/package/vibe-kanban"><img alt="npm" src="https://img.shields.io/npm/v/vibe-kanban?style=flat-square" /></a>
  <a href="https://github.com/BloopAI/vibe-kanban/blob/main/.github/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/BloopAI/vibe-kanban/.github%2Fworkflows%2Fpublish.yml" /></a>
  <a href="https://deepwiki.com/BloopAI/vibe-kanban"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

<h1 align="center">
  <a href="https://jobs.polymer.co/vibe-kanban?source=github"><strong>We're hiring!</strong></a>
</h1>

![](packages/public/vibe-kanban-screenshot-overview.png)

## Overview

In a world where software engineers spend most of their time planning and reviewing coding agents, the most impactful way to ship more is to get faster at planning and review.

Vibe Kanban is built for this. Use kanban issues to plan work, either privately or with your team. When you're ready to begin, create workspaces where coding agents can execute.

- **Plan with kanban issues** — create, prioritise, and assign issues on a kanban board
- **Run coding agents in workspaces** — each workspace gives an agent a branch, a terminal, and a dev server
- **Review diffs and leave inline comments** — send feedback directly to the agent without leaving the UI
- **Preview your app** — built-in browser with devtools, inspect mode, and device emulation
- **Switch between 10+ coding agents** — Claude Code, Codex, Gemini CLI, GitHub Copilot, Amp, Cursor, OpenCode, Droid, CCR, and Qwen Code
- **Create pull requests and merge** — open PRs with AI-generated descriptions, review on GitHub, and merge

![](packages/public/vibe-kanban-screenshot-workspace.png)

One command. Describe the work, review the diff, ship it.

```bash
npx vibe-kanban
```


## Installation

Make sure you have authenticated with your favourite coding agent. A full list of supported coding agents can be found in the [docs](https://vibekanban.com/docs/supported-coding-agents). Then in your terminal run:

```bash
npx vibe-kanban
```

## Documentation

Head to the [website](https://vibekanban.com/docs) for the latest documentation and user guides.

## Self-Hosting

Want to host your own Vibe Kanban Cloud instance? See our [self-hosting guide](https://vibekanban.com/docs/self-hosting/deploy-docker).

## Support

We use [GitHub Discussions](https://github.com/BloopAI/vibe-kanban/discussions) for feature requests. Please open a discussion to create a feature request. For bugs please open an issue on this repo.

## Contributing

We would prefer that ideas and changes are first raised with the core team via [GitHub Discussions](https://github.com/BloopAI/vibe-kanban/discussions) or [Discord](https://discord.gg/AC4nwVtJM3), where we can discuss implementation details and alignment with the existing roadmap. Please do not open PRs without first discussing your proposal with the team.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (>=20)
- [pnpm](https://pnpm.io/) (>=8)

Additional development tools:
```bash
cargo install cargo-watch
cargo install sqlx-cli
```

Install dependencies:
```bash
pnpm i
```

### Running the dev server

```bash
pnpm run dev
```

This will start the backend and web app. A blank DB will be copied from the `dev_assets_seed` folder.

### Building the web app

To build just the web app:

```bash
cd packages/local-web
pnpm run build
```

### Build from source (macOS)

1. Run `./local-build.sh`
2. Test with `cd npx-cli && node bin/cli.js`

### Environment Variables

The following environment variables can be configured at build time or runtime:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `POSTHOG_API_KEY` | Build-time | Empty | PostHog analytics API key (disables analytics if empty) |
| `POSTHOG_API_ENDPOINT` | Build-time | Empty | PostHog analytics endpoint (disables analytics if empty) |
| `PORT` | Runtime | Auto-assign | **Production**: Server port. **Dev**: Frontend port (backend uses PORT+1) |
| `BACKEND_PORT` | Runtime | `0` (auto-assign) | Backend server port (dev mode only, overrides PORT+1) |
| `FRONTEND_PORT` | Runtime | `3000` | Frontend dev server port (dev mode only, overrides PORT) |
| `HOST` | Runtime | `127.0.0.1` | Backend server host |
| `MCP_HOST` | Runtime | Value of `HOST` | MCP server connection host (use `127.0.0.1` when `HOST=0.0.0.0` on Windows) |
| `MCP_PORT` | Runtime | Value of `BACKEND_PORT` | MCP server connection port |
| `DISABLE_WORKTREE_CLEANUP` | Runtime | Not set | Disable all git worktree cleanup including orphan and expired workspace cleanup (for debugging) |
| `VK_ALLOWED_ORIGINS` | Runtime | Not set | Comma-separated list of origins that are allowed to make backend API requests (e.g., `https://my-vibekanban-frontend.com`) |
| `VK_SHARED_API_BASE` | Runtime | Not set | Base URL for the remote/cloud API used by the local desktop app |
| `VK_SHARED_RELAY_API_BASE` | Runtime | Not set | Base URL for the relay API used by tunnel-mode connections |
| `VK_TUNNEL` | Runtime | Not set | Enable relay tunnel mode when set (requires relay API base URL) |

**Build-time variables** must be set when running `pnpm run build`. **Runtime variables** are read when the application starts.

#### Self-Hosting with a Reverse Proxy or Custom Domain

When running Vibe Kanban behind a reverse proxy (e.g., nginx, Caddy, Traefik) or on a custom domain, you must set the `VK_ALLOWED_ORIGINS` environment variable. Without this, the browser's Origin header won't match the backend's expected host, and API requests will be rejected with a 403 Forbidden error.

Set it to the full origin URL(s) where your frontend is accessible:

```bash
# Single origin
VK_ALLOWED_ORIGINS=https://vk.example.com

# Multiple origins (comma-separated)
VK_ALLOWED_ORIGINS=https://vk.example.com,https://vk-staging.example.com
```

### Remote Deployment

When running Vibe Kanban on a remote server (e.g., via systemctl, Docker, or cloud hosting), you can configure your editor to open projects via SSH:

1. **Access via tunnel**: Use Cloudflare Tunnel, ngrok, or similar to expose the web UI
2. **Configure remote SSH** in Settings → Editor Integration:
   - Set **Remote SSH Host** to your server hostname or IP
   - Set **Remote SSH User** to your SSH username (optional)
3. **Prerequisites**:
   - SSH access from your local machine to the remote server
   - SSH keys configured (passwordless authentication)
   - VSCode Remote-SSH extension

When configured, the "Open in VSCode" buttons will generate URLs like `vscode://vscode-remote/ssh-remote+user@host/path` that open your local editor and connect to the remote server.

See the [documentation](https://vibekanban.com/docs/settings/general) for detailed setup instructions.
