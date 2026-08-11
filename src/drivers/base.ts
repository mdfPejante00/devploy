import { DeploymentTarget, HostStatus, ReleaseInfo } from '../types/index.js';

export interface DeploymentOptions {
  targetName: string;
  target: DeploymentTarget;
  releaseId: string;
  projectDir?: string;
  force?: boolean;
  isInteractive?: boolean;
}

export abstract class BaseDriver {
  abstract name: string;

  abstract deploy(options: DeploymentOptions): Promise<void>;
  abstract rollback(options: DeploymentOptions, targetRelease?: string): Promise<void>;
  abstract unlock(options: DeploymentOptions): Promise<void>;
  abstract getStatus(targetName: string, target: DeploymentTarget): Promise<HostStatus[]>;
  abstract streamLogs(targetName: string, target: DeploymentTarget, lines?: number, filter?: string): Promise<void>;
}
