import pc from 'picocolors';
import { execa } from 'execa';
import { BaseDriver, DeploymentOptions } from './base.js';
import { DockerDeploymentTarget, HostStatus } from '../types/index.js';
import { SSHClientWrapper } from '../utils/ssh.js';
import { logger, createSpinner } from '../ui/logger.js';

export class DockerDriver extends BaseDriver {
  name = 'docker';

  async deploy(options: DeploymentOptions): Promise<void> {
    const { target, releaseId } = options;
    const dockerTarget = target as DockerDeploymentTarget;
    const s = createSpinner();

    // 1. Build Docker image locally if needed
    const fullTag = `${dockerTarget.imageName}:${releaseId}`;
    s.start(`Building Docker image locally: ${fullTag}...`);
    try {
      await execa('docker', ['build', '-t', fullTag, '-t', `${dockerTarget.imageName}:latest`, '.']);
      s.stop(pc.green(`✔ Built Docker image: ${fullTag}`));
    } catch (err: any) {
      s.stop(pc.red(`✖ Docker build failed: ${err.message}`));
      throw err;
    }

    // 2. Deploy to remote hosts via SSH + Docker Container run / compose
    for (const hostConfig of dockerTarget.hosts) {
      const client = new SSHClientWrapper(hostConfig);
      await client.connectWithRetry({ isInteractive: options.isInteractive !== false });

      try {
        s.start(`[${hostConfig.host}] Deploying container ${dockerTarget.containerName}...`);
        
        // Stop & remove old container if exists
        await client.exec(`docker stop ${dockerTarget.containerName} 2>/dev/null || true`);
        await client.exec(`docker rm ${dockerTarget.containerName} 2>/dev/null || true`);

        // Format port mappings
        const ports = (dockerTarget.portMappings || []).map((p) => `-p ${p}`).join(' ');

        // Run container
        const runCmd = `docker run -d --name ${dockerTarget.containerName} --restart always ${ports} ${fullTag}`;
        const res = await client.exec(runCmd);

        if (res.code !== 0) {
          throw new Error(`[${hostConfig.host}] Container run failed: ${res.stderr}`);
        }

        s.stop(pc.green(`✔ [${hostConfig.host}] Container running`));
      } finally {
        client.close();
      }
    }
  }

  async rollback(options: DeploymentOptions, targetRelease?: string): Promise<void> {
    logger.warn('Docker rollback requires a previous image tag argument.');
  }

  async unlock(options: DeploymentOptions): Promise<void> {}

  async getStatus(targetName: string, target: DeploymentTarget): Promise<HostStatus[]> {
    const dockerTarget = target as DockerDeploymentTarget;
    const statuses: HostStatus[] = [];

    for (const hostConfig of dockerTarget.hosts) {
      const client = new SSHClientWrapper(hostConfig);
      try {
        await client.connectWithRetry({ isInteractive: false });
        const res = await client.exec(`docker ps --filter "name=${dockerTarget.containerName}" --format "{{.Status}}"`);
        const statusStr = res.stdout.trim() || 'Container Not Running';

        statuses.push({
          host: hostConfig.host,
          connected: true,
          activeRelease: statusStr,
          releases: [],
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
    const dockerTarget = target as DockerDeploymentTarget;
    const host = dockerTarget.hosts[0];
    if (!host) throw new Error('No host configured');

    const client = new SSHClientWrapper(host);
    await client.connectWithRetry({ isInteractive: true });
    const filterText = filter ? ` (filtered by '${pc.yellow(filter)}')` : '';
    logger.info(`Streaming Docker logs for container '${dockerTarget.containerName}'...${filterText} (Ctrl+C to stop)`);
    try {
      const grepPipe = filter ? ` | grep -i "${filter}"` : '';
      await client.streamRemoteCommand(`docker logs -f --tail ${lines} ${dockerTarget.containerName}${grepPipe}`, (line) => {
        console.log(`[${pc.cyan(host.host)}] ${line}`);
      });
    } finally {
      client.close();
    }
  }
}
