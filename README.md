# 🚀 Devploy

> **Modern, Scalable & Zero-Downtime Server Deployment CLI for Node.js Applications**

Devploy is an elegant, high-performance command-line deployment tool designed for Node.js applications and PM2 process management. It delivers a **zero-downtime, atomic symlink deployment architecture** (`releases/` -> `current/`) with interactive setup wizards, multi-project workspace support, and automatic process reloads.

---

## ✨ Features

- ⚡ **Zero-Downtime Atomic Symlinks**: Instantaneous release switching using `/var/www/<project>/current` symlinks.
- 📦 **Multi-Project Workspaces**: Manage, deploy, and delete multiple projects/microservices from a single `devploy.config.ts`.
- 📜 **Project-Specific Live Log Streaming & Filtering**: Real-time log streaming for individual target projects with keyword search filtering (`--filter` / `--grep`).
- 🔒 **Secure SSH Authentication**: Supports SSH Agent, Key Passphrases, SSH Passwords with interactive retry loaders, and Environment Variables (`SSH_PASSWORD`, `SSH_PASSPHRASE`).
- 🔄 **PM2 Process Management**: Seamless process reloads via `ecosystem.config.cjs` using `startOrReload` and `--update-env`.
- 📊 **Responsive Terminal Tables**: Auto-calculates column widths and wraps text cleanly to adapt to your terminal window size.
- 🌐 **Remote Lifecycle Hooks**: Executes `install` (`npm install`), `preBuild` (`npm run lint`), `build` (`npm run build`), and `postDeploy` (`npm prune --production`) directly on target servers.
- 📁 **Organized Local Archives**: Saves deployment payloads locally under `devploy/releases/<YEAR>/<MONTH>/rel_<timestamp>.tar.gz`.
- 🎨 **Beautiful CLI UX**: Rich visual dashboards, loaders, spinners, tables, and interactive wizards powered by `@clack/prompts`, `boxen`, `picocolors`, and `cli-table3`.
- 🛠️ **Smart Configuration Loader**: Native TypeScript configuration parsing via `jiti`.
- 🔓 **Automatic Lock Resolution**: Seamlessly handles and clears stale deployment lock files (`.deploy.lock`).

---

## 📥 Installation

```bash
# Global installation via NPM
npm install -g @chiake/devploy

# Or run instantly via npx
npx @chiake/devploy deploy
```

Verify installation:
```bash
devploy --version
```

---

## 🎯 Quick Start Workflow

### 1. Initialize Configuration

Run the interactive setup wizard in your project root:

```bash
devploy init
```

The wizard will guide you through:
1. Naming your project and setting local source directory (`dir`).
2. Verification of local directory existence.
3. Target server IP (`host`), SSH username, and authentication method.
4. Active network connection test to the target server.
5. Setting up remote deployment path (`/var/www/<project>`).
6. Configuring lifecycle hooks (`install`, `lint`, `prune`) and HTTP Health Checks.

---

### 2. Deploy Your Application

Interactive deployment:
```bash
devploy deploy
```

Deploy a specific project and environment directly:
```bash
devploy deploy --project my-api --env production
```

Non-interactive CI/CD deployment:
```bash
devploy deploy --env production --yes
```

---

## 💻 CLI Commands Reference

| Command | Alias | Description |
| :--- | :--- | :--- |
| `devploy init` | - | Initialize or append a project to `devploy.config.ts` |
| `devploy deploy` | - | Deploy application to a target environment |
| `devploy list` | `devploy ls` | Display responsive styled table of all configured projects |
| `devploy mod [name]` | `devploy modify`, `devploy edit` | Interactively modify project settings with pre-filled current values |
| `devploy delete [name]` | `devploy remove`, `devploy rm` | Remove a specific project configuration from `devploy.config.ts` |
| `devploy status` | - | Check remote server connection, active symlink, and release history |
| `devploy rollback` | - | Instantly revert `current/` symlink to a previous release |
| `devploy logs` | - | Stream real-time remote logs for a specific project with optional filter |
| `devploy unlock` | - | Manually remove `.deploy.lock` from target server |
| `devploy purge` | - | Safely delete local `devploy.config.ts` configuration |

---

## 📖 Command Details & Usage Examples

### 📋 List Projects (`devploy list`)
View a responsive overview table of all projects, directories, environments, and server targets. Columns automatically adjust to fit your terminal window width:
```bash
devploy list
# shorthand:
devploy ls
```

### 🗑️ Delete Project (`devploy delete`)
Interactively select or specify a project to remove from `devploy.config.ts`:
```bash
# Interactive selection:
devploy delete

# Delete specific project by name:
devploy delete my-api
# aliases:
devploy rm my-api
devploy remove -p my-api

# Skip confirmation prompt (-y / --yes):
devploy delete my-api --yes
```

### ✏️ Modify Project Config (`devploy mod`)
Interactively update settings for an existing project. Input prompts are pre-filled with current values so you can hit `Enter` to keep existing settings:
```bash
devploy mod my-awesome-app
```

### 📊 View Remote Status (`devploy status`)
Check connectivity, current active release symlink, and available release history:
```bash
devploy status --env production
```

### ↺ Instant Rollback (`devploy rollback`)
Instantly switch the `current/` symlink back to the previous release (or a specific release ID):
```bash
devploy rollback --env production
# Or rollback to specific release ID:
devploy rollback --env production --release rel_20260807_120000
```

### 📜 Stream Remote Logs (`devploy logs`)
Stream live remote output from your target server for a specific project. Includes animated connection spinners after entering credentials and keyword filtering (`-f` / `--filter` / `-g` / `--grep`):
```bash
# Stream logs for project 'my-api':
devploy logs -p my-api

# Retrieve 100 lines and filter for errors only:
devploy logs -p my-api -n 100 --filter error

# Filter logs by specific pattern or status code:
devploy logs -p my-api -g "500 Internal Server Error"
```

---

## ⚙️ Configuration Schema (`devploy.config.ts`)

Devploy uses TypeScript for full type completion:

```typescript
import { defineConfig } from 'devploy';

export default defineConfig({
  projects: {
    'web-app': {
      name: 'Web Application',
      dir: './apps/web',
      targets: {
        production: {
          driver: 'ssh',
          hosts: [
            {
              host: '192.168.1.100',
              port: 22,
              username: 'deploy',
              passphrase: '${SSH_PASSPHRASE}',
            },
          ],
          deployPath: '/var/www/web-app',
          keepReleases: 5,
          include: ['.'],
          exclude: ['.git', 'node_modules', '.claude', '.qodo', '.vscode'],
          hooks: {
            install: ['npm install'],
            build: ['npm run build'],
            postDeploy: ['npm prune --production'],
          },
          healthCheck: {
            url: 'http://192.168.1.100:3000/health',
            expectedStatus: 200,
          },
        },
      },
    },
  },
});
```

---

## 🏗️ Remote Server Directory Architecture

When Devploy deploys your application, it creates a standardized zero-downtime folder structure on your target server:

```
/var/www/web-app/
├── current -> releases/rel_20260807_130000
├── releases/
│   ├── rel_20260807_110000/
│   ├── rel_20260807_120000/
│   └── rel_20260807_130000/  <-- Active release
└── shared/
```

- **`current/`**: Active symlink pointing to the latest release folder.
- **`releases/`**: Timestamped release directories (`rel_YYYYMMDD_HHMMSS`). Old releases beyond `keepReleases` are automatically pruned.
- **`shared/`**: Shared uploads, persistent storage, and environment files.

---

## 🤖 CI/CD Automation Example (GitHub Actions)

Deploy seamlessly from GitHub Actions using environment variables and non-interactive mode:

```yaml
name: Production Deployment

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Devploy
        run: npm install -g @chiake/devploy

      - name: Execute Deployment
        env:
          SSH_PASSWORD: ${{ secrets.SSH_PASSWORD }}
        run: devploy deploy --env production --yes
```

---

## 📄 License

MIT License © 2026 Devploy Team
