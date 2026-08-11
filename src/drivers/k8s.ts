import pc from 'picocolors';
import { execa } from 'execa';
import { BaseDriver, DeploymentOptions } from './base.js';
import { HostStatus, K8sDeploymentTarget } from '../types/index.js';
import { logger, createSpinner } from '../ui/logger.js';

export class K8sDriver extends BaseDriver {
  name = 'k8s';

  async deploy(options: DeploymentOptions): Promise<void> {
    const { target } = options;
    const k8sTarget = target as K8sDeploymentTarget;
    const s = createSpinner();

    const ns = k8sTarget.namespace || 'default';
    const ctxFlag = k8sTarget.context ? ['--context', k8sTarget.context] : [];

    if (k8sTarget.helmChartPath) {
      const release = k8sTarget.releaseName || options.targetName;
      s.start(`Upgrading Helm release '${release}' in namespace '${ns}'...`);
      try {
        await execa('helm', [
          'upgrade',
          '--install',
          release,
          k8sTarget.helmChartPath,
          '--namespace',
          ns,
          ...ctxFlag,
        ]);
        s.stop(pc.green(`✔ Helm release '${release}' deployed successfully`));
      } catch (err: any) {
        s.stop(pc.red(`✖ Helm deployment failed: ${err.message}`));
        throw err;
      }
    } else if (k8sTarget.manifestPath) {
      s.start(`Applying Kubernetes manifests from '${k8sTarget.manifestPath}'...`);
      try {
        await execa('kubectl', ['apply', '-f', k8sTarget.manifestPath, '-n', ns, ...ctxFlag]);
        s.stop(pc.green(`✔ Manifests applied successfully`));
      } catch (err: any) {
        s.stop(pc.red(`✖ Kubectl apply failed: ${err.message}`));
        throw err;
      }
    } else {
      throw new Error('Kubernetes deployment requires either `manifestPath` or `helmChartPath`.');
    }
  }

  async rollback(options: DeploymentOptions, targetRelease?: string): Promise<void> {
    const { target } = options;
    const k8sTarget = target as K8sDeploymentTarget;
    const s = createSpinner();
    const ns = k8sTarget.namespace || 'default';
    const release = k8sTarget.releaseName || options.targetName;

    if (k8sTarget.helmChartPath) {
      s.start(`Rolling back Helm release '${release}'...`);
      await execa('helm', ['rollback', release, '--namespace', ns]);
      s.stop(pc.green(`✔ Helm rollback complete`));
    } else {
      logger.warn('Rollback for raw manifests requires custom kubectl rollout undo.');
    }
  }

  async unlock(options: DeploymentOptions): Promise<void> {}

  async getStatus(targetName: string, target: K8sDeploymentTarget): Promise<HostStatus[]> {
    const ns = target.namespace || 'default';
    try {
      const { stdout } = await execa('kubectl', ['get', 'pods', '-n', ns, '-o', 'wide']);
      return [
        {
          host: `K8s Namespace: ${ns}`,
          connected: true,
          activeRelease: stdout.split('\n')[1] || 'Pods Active',
          releases: [],
        },
      ];
    } catch (err: any) {
      return [
        {
          host: `K8s Cluster`,
          connected: false,
          releases: [],
          error: err.message,
        },
      ];
    }
  }

  async streamLogs(projectName: string, target: K8sDeploymentTarget, lines: number = 50, filter?: string): Promise<void> {
    const ns = target.namespace || 'default';
    logger.info(`Streaming pod logs for '${projectName}' in namespace '${ns}'...`);
    const args = ['logs', '-n', ns, '-l', `app=${projectName}`, '-f', '--tail', String(lines)];
    if (filter) {
      await execa('bash', ['-c', `kubectl ${args.join(' ')} | grep -i "${filter}"`], {
        stdout: 'inherit',
        stderr: 'inherit',
      });
    } else {
      await execa('kubectl', args, {
        stdout: 'inherit',
        stderr: 'inherit',
      });
    }
  }
}
