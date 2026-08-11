import pc from 'picocolors';
import { BaseDriver } from '../drivers/base.js';
import { SSHDriver } from '../drivers/ssh.js';
import { DockerDriver } from '../drivers/docker.js';
import { K8sDriver } from '../drivers/k8s.js';
import { DevployConfig, DeploymentTarget, HealthCheckConfig } from '../types/index.js';
import { resolveProject } from '../config/loader.js';
import { logger, createSpinner } from '../ui/logger.js';

export class Orchestrator {
  private getDriver(driverType: string): BaseDriver {
    switch (driverType) {
      case 'ssh':
        return new SSHDriver();
      case 'docker':
        return new DockerDriver();
      case 'k8s':
        return new K8sDriver();
      default:
        throw new Error(`Unsupported deployment driver: '${driverType}'`);
    }
  }

  public generateReleaseId(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  public async runHealthCheck(config: HealthCheckConfig): Promise<boolean> {
    const s = createSpinner();
    s.start(`Running health check probe (${config.url})...`);

    const maxRetries = config.maxRetries || 3;
    const expectedStatus = config.expectedStatus || 200;
    const timeoutMs = (config.timeoutSeconds || 15) * 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(config.url, { signal: controller.signal });
        clearTimeout(timer);

        if (res.status === expectedStatus) {
          s.stop(pc.green(`✔ Health check passed! (${res.status} OK)`));
          return true;
        }
      } catch (err: any) {
        if (attempt < maxRetries) {
          s.message(pc.yellow(`[Attempt ${attempt}/${maxRetries}] Health check failed (${err.message}). Retrying in 3s...`));
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    s.stop(pc.red(`✖ Health check failed after ${maxRetries} attempts.`));
    return false;
  }

  public async deploy(
    config: DevployConfig,
    configFilePath: string,
    targetName: string,
    projectName?: string,
    isInteractive: boolean = true,
    force: boolean = false
  ): Promise<void> {
    const { projectName: resolvedName, projectConfig, projectDir } = resolveProject(config, configFilePath, projectName);
    const target: DeploymentTarget = projectConfig.targets[targetName];
    if (!target) {
      throw new Error(`Target environment '${targetName}' not found in project '${resolvedName}'.`);
    }

    const driver = this.getDriver(target.driver);
    const releaseId = this.generateReleaseId();

    logger.step(`Initiating deployment for project '${pc.cyan(resolvedName)}' -> target '${pc.green(targetName)}'`);
    logger.message(`Project Directory: ${pc.gray(projectDir)}`);
    logger.message(`Release ID: ${pc.cyan(releaseId)}`);

    const startTime = Date.now();

    try {
      await driver.deploy({
        targetName,
        target,
        releaseId,
        projectDir,
        force,
        isInteractive,
      });

      // Health Check Phase
      if (target.healthCheck) {
        const passed = await this.runHealthCheck(target.healthCheck);
        if (!passed) {
          logger.error('Health check failed! Triggering automatic rollback...');
          await driver.rollback({ targetName, target, releaseId, projectDir, isInteractive });
          throw new Error('Deployment aborted and rolled back due to health check failure.');
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.success(`Successfully deployed '${resolvedName}' to '${targetName}' in ${elapsed}s! 🎉`);
    } catch (err: any) {
      logger.error(`Deployment failed: ${err.message}`);
      throw err;
    }
  }

  public async unlock(
    config: DevployConfig,
    configFilePath: string,
    targetName: string,
    projectName?: string
  ): Promise<void> {
    const { projectName: resolvedName, projectConfig, projectDir } = resolveProject(config, configFilePath, projectName);
    const target: DeploymentTarget = projectConfig.targets[targetName];
    if (!target) {
      throw new Error(`Target environment '${targetName}' not found in project '${resolvedName}'.`);
    }

    const driver = this.getDriver(target.driver);
    logger.step(`Unlocking target environment '${targetName}' for project '${resolvedName}'`);

    await driver.unlock({
      targetName,
      target,
      releaseId: '',
      projectDir,
    });

    logger.success(`Successfully unlocked target environment '${targetName}'.`);
  }

  public async rollback(
    config: DevployConfig,
    configFilePath: string,
    targetName: string,
    projectName?: string,
    release?: string
  ): Promise<void> {
    const { projectName: resolvedName, projectConfig, projectDir } = resolveProject(config, configFilePath, projectName);
    const target: DeploymentTarget = projectConfig.targets[targetName];
    if (!target) {
      throw new Error(`Target environment '${targetName}' not found in project '${resolvedName}'.`);
    }

    const driver = this.getDriver(target.driver);
    logger.step(`Initiating rollback for project '${resolvedName}' -> target '${targetName}'`);

    await driver.rollback({
      targetName,
      target,
      releaseId: '',
      projectDir,
    }, release);

    logger.success(`Rollback completed for target '${targetName}'.`);
  }

  public async getStatus(
    config: DevployConfig,
    configFilePath: string,
    targetName: string,
    projectName?: string
  ) {
    const { projectConfig } = resolveProject(config, configFilePath, projectName);
    const target = projectConfig.targets[targetName];
    if (!target) {
      throw new Error(`Target environment '${targetName}' not found.`);
    }
    const driver = this.getDriver(target.driver);
    return driver.getStatus(targetName, target);
  }

  public async streamLogs(
    config: DevployConfig,
    configFilePath: string,
    targetName: string,
    projectName?: string,
    lines: number = 50,
    filter?: string
  ) {
    const { projectConfig, projectName: resolvedName } = resolveProject(config, configFilePath, projectName);
    const target = projectConfig.targets[targetName];
    if (!target) {
      throw new Error(`Target environment '${targetName}' not found.`);
    }
    const driver = this.getDriver(target.driver);
    return driver.streamLogs(resolvedName, target, lines, filter);
  }
}
