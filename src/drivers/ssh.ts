import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { execa } from 'execa';
import { password, confirm, isCancel } from '@clack/prompts';
import { BaseDriver, DeploymentOptions } from './base.js';
import { HostStatus, ReleaseInfo, SSHDeploymentTarget } from '../types/index.js';
import { SSHClientWrapper } from '../utils/ssh.js';
import { logger, createSpinner } from '../ui/logger.js';

export function cleanupLocalReleases(workDir: string, maxReleases: number = 3): string[] {
  const baseDir = path.join(workDir, 'devploy', 'releases');
  if (!fs.existsSync(baseDir)) return [];

  function findTarFiles(dir: string): { path: string; name: string; mtime: number }[] {
    let files: { path: string; name: string; mtime: number }[] = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(findTarFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.tar.gz')) {
          const stat = fs.statSync(fullPath);
          files.push({ path: fullPath, name: entry.name, mtime: stat.mtimeMs });
        }
      }
    } catch (_) {}
    return files;
  }

  function cleanEmptyDirs(dir: string): void {
    try {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const sub = path.join(dir, entry.name);
          cleanEmptyDirs(sub);
          try {
            if (fs.readdirSync(sub).length === 0) {
              fs.rmdirSync(sub);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  const allArchives = findTarFiles(baseDir);
  allArchives.sort((a, b) => (b.mtime !== a.mtime ? b.mtime - a.mtime : b.name.localeCompare(a.name)));

  const deleted: string[] = [];
  if (allArchives.length > maxReleases) {
    const toRemove = allArchives.slice(maxReleases);
    for (const file of toRemove) {
      try {
        fs.unlinkSync(file.path);
        deleted.push(file.name);
      } catch (_) {}
    }
  }

  cleanEmptyDirs(baseDir);
  return deleted;
}

export class SSHDriver extends BaseDriver {
  name = 'ssh';

  async deploy(options: DeploymentOptions): Promise<void> {
    const { target, releaseId } = options;
    const sshTarget = target as SSHDeploymentTarget;
    const s = createSpinner();

    s.start(`Connecting to ${sshTarget.hosts.length} remote host(s)...`);

    // 1. Establish SSH clients
    const clients: SSHClientWrapper[] = [];
    try {
      for (const hostConfig of sshTarget.hosts) {
        const client = new SSHClientWrapper(hostConfig);
        await client.connectWithRetry({ isInteractive: options.isInteractive !== false });
        clients.push(client);
      }
      s.stop(pc.green(`✔ Connected to ${clients.length} host(s)`));
    } catch (err: any) {
      s.stop(pc.red(`✖ Failed to connect: ${err.message}`));
      throw err;
    }

    try {
      // 2. Lock check & remote structure setup
      for (const client of clients) {
        const lockPath = path.join(sshTarget.deployPath, '.deploy.lock');
        const lockCheck = await client.exec(`test -f "${lockPath}" && echo "LOCKED" || echo "UNLOCKED"`);

        if (lockCheck.stdout.includes('LOCKED')) {
          // Auto-clear stale lock from previous runs for seamless deployment
          await client.exec(`rm -f "${lockPath}"`);
        }

        // Acquire lock & create directories
        await client.exec(`mkdir -p "${path.join(sshTarget.deployPath, 'releases')}" "${path.join(sshTarget.deployPath, 'shared')}"`);
        await client.exec(`touch "${lockPath}"`);
      }

      const workDir = options.projectDir || process.cwd();

      // 3. Create release archive locally in devploy/releases/<YEAR>/<MONTH> & upload
      const now = new Date();
      const year = now.getFullYear().toString();
      const month = String(now.getMonth() + 1).padStart(2, '0');

      const localReleasesDir = path.join(workDir, 'devploy', 'releases', year, month);
      if (!fs.existsSync(localReleasesDir)) {
        fs.mkdirSync(localReleasesDir, { recursive: true });
      }

      const releaseFolderName = `rel_${releaseId}`;
      const tarFileName = `${releaseFolderName}.tar.gz`;
      const localTarPath = path.join(localReleasesDir, tarFileName);

      const relPathDisplay = path.join('devploy', 'releases', year, month, tarFileName);
      s.start(`Creating release archive ('${relPathDisplay}')...`);
      const defaultExcludes = ['.git', 'node_modules', 'devploy', '.claude', '.qodo', '.vscode', '.idea', '.DS_Store', tarFileName];
      const customExcludes = sshTarget.exclude || [];
      const allExcludes = [...new Set([...defaultExcludes, ...customExcludes])];

      const tarArgs: string[] = [];
      for (const ex of allExcludes) {
        tarArgs.push(`--exclude=${ex}`);
      }
      tarArgs.push('-czf', localTarPath);

      const includePaths = sshTarget.include !== undefined && sshTarget.include.length > 0 ? sshTarget.include : ['.'];
      tarArgs.push(...includePaths);

      await execa('tar', tarArgs, { cwd: workDir });
      s.stop(pc.green(`✔ Archive created at '${relPathDisplay}' containing: ${includePaths.join(', ')}`));

      // 4. Upload & Extract on each host
      for (const client of clients) {
        const remoteReleasePath = path.join(sshTarget.deployPath, 'releases', releaseFolderName);
        const remoteTarPath = path.join(sshTarget.deployPath, tarFileName);

        s.start(`[${client.config.host}] Uploading release payload...`);
        await client.uploadFile(localTarPath, remoteTarPath);
        s.stop(pc.green(`✔ Payload uploaded to ${client.config.host}`));

        s.start(`[${client.config.host}] Extracting payload & preparing directory...`);
        await client.exec(`mkdir -p "${remoteReleasePath}" && tar -xzf "${remoteTarPath}" -C "${remoteReleasePath}" && rm -f "${remoteTarPath}"`);
        s.stop(pc.green(`✔ Payload extracted on ${client.config.host}`));

        // 5. Pre-deploy lifecycle hooks on remote server (install -> preBuild -> build)
        const buildHookPhases: { name: string; hooks?: string[] }[] = [
          { name: 'Install', hooks: sshTarget.hooks?.install },
          { name: 'Pre-Build', hooks: sshTarget.hooks?.preBuild },
          { name: 'Build', hooks: sshTarget.hooks?.build },
        ];

        for (const phase of buildHookPhases) {
          if (phase.hooks && phase.hooks.length > 0) {
            for (const hook of phase.hooks) {
              s.start(`[${client.config.host}] Remote ${phase.name} hook: ${hook}...`);
              const res = await client.exec(`cd "${remoteReleasePath}" && ${hook}`);
              if (res.code !== 0) {
                s.stop(pc.red(`✖ [${client.config.host}] Remote ${phase.name} hook failed: ${hook}`));
                throw new Error(`[${client.config.host}] Remote ${phase.name} hook '${hook}' failed: ${res.stderr || res.stdout}`);
              }
              s.stop(pc.green(`✔ [${client.config.host}] Remote ${phase.name} hook completed: ${hook}`));
            }
          }
        }

        // 6. Atomic Symlink Switch
        const currentSymlink = path.join(sshTarget.deployPath, 'current');
        s.start(`[${client.config.host}] Switching symlink 'current' -> '${releaseFolderName}'...`);
        await client.exec(`ln -sfn "${remoteReleasePath}" "${currentSymlink}"`);
        s.stop(pc.green(`✔ Symlink updated on ${client.config.host}`));

        // Clean up node_modules from previous release directories after symlink switch
        const releasesDir = path.join(sshTarget.deployPath, 'releases');
        await client.exec(
          `cd "${releasesDir}" && for d in rel_*; do [ -d "$d" ] && [ "$d" != "${releaseFolderName}" ] && rm -rf "$d/node_modules"; done`
        );

        // 7. Post-Deploy hooks (executed inside current/ after symlink switch)
        if (sshTarget.hooks?.postDeploy && sshTarget.hooks.postDeploy.length > 0) {
          for (const hook of sshTarget.hooks.postDeploy) {
            s.start(`[${client.config.host}] Remote Post-Deploy hook: ${hook}...`);
            const res = await client.exec(`cd "${currentSymlink}" && ${hook}`);
            if (res.code !== 0) {
              s.stop(pc.red(`✖ [${client.config.host}] Remote Post-Deploy hook failed: ${hook}`));
              throw new Error(`[${client.config.host}] Remote Post-Deploy hook '${hook}' failed: ${res.stderr || res.stdout}`);
            }
            s.stop(pc.green(`✔ [${client.config.host}] Remote Post-Deploy hook completed: ${hook}`));
          }
        }

        // 8. PM2 Process Management
        let shouldRestartPm2 = true;
        if (options.isInteractive !== false) {
          const runPm2 = await confirm({
            message: `Would you like to start/restart PM2 using ecosystem.config.cjs on ${client.config.host}?`,
            initialValue: true,
          });
          if (isCancel(runPm2) || !runPm2) {
            shouldRestartPm2 = false;
          }
        }

        if (shouldRestartPm2) {
          s.start(`[${client.config.host}] Reloading PM2 process via ecosystem.config.cjs (Zero-Downtime)...`);
          const pm2Res = await client.exec(
            `cd "${currentSymlink}" && (pm2 startOrReload ecosystem.config.cjs --cwd "${currentSymlink}" --update-env || pm2 reload ecosystem.config.cjs --cwd "${currentSymlink}" --update-env || pm2 restart ecosystem.config.cjs --cwd "${currentSymlink}" --update-env || pm2 start ecosystem.config.cjs --cwd "${currentSymlink}" --update-env)`
          );
          if (pm2Res.code === 0) {
            s.stop(pc.green(`✔ PM2 process started/restarted on ${client.config.host}`));
          } else {
            s.stop(pc.yellow(`⚠️ PM2 output: ${pm2Res.stderr.trim() || pm2Res.stdout.trim()}`));
          }
        }

        // 9. Keep Releases Cleanup on target server
        const keepCount = sshTarget.keepReleases || 3;
        await client.exec(
          `cd "${path.join(sshTarget.deployPath, 'releases')}" && ls -dt rel_* 2>/dev/null | tail -n +${keepCount + 1} | xargs -r rm -rf`
        );
      }

      // 10. Keep Releases Cleanup on local machine
      const keepCount = sshTarget.keepReleases || 3;
      const prunedLocal = cleanupLocalReleases(workDir, keepCount);
      if (prunedLocal.length > 0) {
        s.start(`Pruning old local releases...`);
        s.stop(pc.green(`✔ Pruned ${prunedLocal.length} old local release archive(s) (keeping latest ${keepCount})`));
      }

    } finally {
      // Release locks & close connections
      for (const client of clients) {
        try {
          const lockPath = path.join(sshTarget.deployPath, '.deploy.lock');
          await client.exec(`rm -f "${lockPath}"`);
        } catch (_) {}
        client.close();
      }
    }
  }

  async rollback(options: DeploymentOptions, targetRelease?: string): Promise<void> {
    const { target } = options;
    const sshTarget = target as SSHDeploymentTarget;
    const s = createSpinner();

    s.start(`Connecting to remote hosts for rollback...`);

    const clients: SSHClientWrapper[] = [];
    for (const hostConfig of sshTarget.hosts) {
      const client = new SSHClientWrapper(hostConfig);
      await client.connectWithRetry({ isInteractive: true });
      clients.push(client);
    }
    s.stop(pc.green(`✔ Connected to hosts`));

    try {
      for (const client of clients) {
        const releasesDir = path.join(sshTarget.deployPath, 'releases');
        const res = await client.exec(`cd "${releasesDir}" && ls -dt rel_*`);
        const availableReleases = res.stdout.split('\n').map((r) => r.trim()).filter(Boolean);

        if (availableReleases.length < 2 && !targetRelease) {
          throw new Error(`[${client.config.host}] Cannot rollback: No previous release found.`);
        }

        const rollbackRelease = targetRelease || availableReleases[1];
        const targetPath = path.join(releasesDir, rollbackRelease);

        s.start(`[${client.config.host}] Rolling back symlink to '${rollbackRelease}'...`);
        const symlinkPath = path.join(sshTarget.deployPath, 'current');
        await client.exec(`ln -sfn "${targetPath}" "${symlinkPath}"`);
        s.stop(pc.green(`✔ [${client.config.host}] Rolled back to ${rollbackRelease}`));
      }
    } finally {
      for (const c of clients) c.close();
    }
  }

  async unlock(options: DeploymentOptions): Promise<void> {
    const { target } = options;
    const sshTarget = target as SSHDeploymentTarget;
    const s = createSpinner();

    s.start(`Connecting to remote hosts to unlock...`);

    const clients: SSHClientWrapper[] = [];
    for (const hostConfig of sshTarget.hosts) {
      const client = new SSHClientWrapper(hostConfig);
      await client.connectWithRetry({ isInteractive: true });
      clients.push(client);
    }
    s.stop(pc.green(`✔ Connected to hosts`));

    try {
      for (const client of clients) {
        const lockPath = path.join(sshTarget.deployPath, '.deploy.lock');
        s.start(`[${client.config.host}] Removing deployment lock file...`);
        await client.exec(`rm -f "${lockPath}"`);
        s.stop(pc.green(`✔ [${client.config.host}] Successfully unlocked`));
      }
    } finally {
      for (const c of clients) c.close();
    }
  }

  async getStatus(targetName: string, target: DeploymentTarget): Promise<HostStatus[]> {
    const sshTarget = target as SSHDeploymentTarget;
    const statuses: HostStatus[] = [];

    for (const hostConfig of sshTarget.hosts) {
      const client = new SSHClientWrapper(hostConfig);
      try {
        await client.connectWithRetry({ isInteractive: false });

        // Get active symlink target
        const symlinkRes = await client.exec(`readlink "${path.join(sshTarget.deployPath, 'current')}"`);
        const activeRelease = symlinkRes.stdout.trim() ? path.basename(symlinkRes.stdout.trim()) : undefined;

        // List releases
        const releasesRes = await client.exec(`cd "${path.join(sshTarget.deployPath, 'releases')}" 2>/dev/null && ls -l --time-style=long-iso rel_* 2>/dev/null`);
        const releases: ReleaseInfo[] = [];

        if (releasesRes.stdout) {
          const lines = releasesRes.stdout.split('\n');
          for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length >= 8) {
              const relName = parts[parts.length - 1];
              if (relName.startsWith('rel_')) {
                releases.push({
                  name: relName,
                  timestamp: `${parts[5]} ${parts[6]}`,
                  isCurrent: relName === activeRelease,
                });
              }
            }
          }
        }

        statuses.push({
          host: hostConfig.host,
          connected: true,
          activeRelease,
          releases,
        });
      } catch (err: any) {
        statuses.push({
          host: hostConfig.host,
          connected: false,
          releases: [],
          error: err.message,
        });
      } finally {
        client.close();
      }
    }

    return statuses;
  }

  async streamLogs(projectName: string, target: DeploymentTarget, lines: number = 50, filter?: string): Promise<void> {
    const sshTarget = target as SSHDeploymentTarget;
    const host = sshTarget.hosts[0];
    if (!host) throw new Error('No host configured');

    const client = new SSHClientWrapper(host);
    await client.connectWithRetry({ isInteractive: true });

    const filterText = filter ? ` (filtered by '${pc.yellow(filter)}')` : '';
    logger.info(`Streaming logs for project '${pc.cyan(projectName)}' from ${host.host}...${filterText} (Ctrl+C to stop)`);
    try {
      const posixDeployPath = sshTarget.deployPath.replace(/\\/g, '/');
      const logsDir = path.posix.join(posixDeployPath, 'current', 'logs');
      const currentDir = path.posix.join(posixDeployPath, 'current');
      const grepPipe = filter ? ` | grep -i "${filter}"` : '';

      const logCommand = [
        `if pm2 list 2>/dev/null | grep -q "${projectName}"; then pm2 logs "${projectName}" --lines ${lines}${grepPipe};`,
        `elif [ -d "${logsDir}" ] && [ "$(ls -A "${logsDir}" 2>/dev/null)" ]; then tail -f -n ${lines} "${logsDir}"/*${grepPipe};`,
        `elif [ -d "${currentDir}" ] && ls "${currentDir}"/*.log 1>/dev/null 2>&1; then tail -f -n ${lines} "${currentDir}"/*.log${grepPipe};`,
        `elif journalctl -u "${projectName}" -n 1 2>/dev/null; then journalctl -u "${projectName}" -f -n ${lines}${grepPipe};`,
        `else echo "No logs found for project '${projectName}' in PM2, ${logsDir}, or journalctl.";`,
        `fi`
      ].join(' ');

      await client.streamRemoteCommand(logCommand, (line) => {
        console.log(`[${pc.cyan(host.host)}] ${line}`);
      });
    } finally {
      client.close();
    }
  }
}
