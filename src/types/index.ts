export type DriverType = 'ssh' | 'docker' | 'k8s' | 'static';

export interface SSHHostConfig {
  host: string;
  port?: number;
  username: string;
  keyPath?: string;
  passphrase?: string;
  password?: string;
  agent?: string;
}

export interface LifecycleHooks {
  install?: string[];
  preBuild?: string[];
  build?: string[];
  postBuild?: string[];
  preDeploy?: string[];
  deploy?: string[];
  postDeploy?: string[];
  healthCheck?: string[];
}

export interface HealthCheckConfig {
  url: string;
  expectedStatus?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
}

export interface SSHDeploymentTarget {
  driver: 'ssh';
  hosts: SSHHostConfig[];
  deployPath: string;
  keepReleases?: number;
  include?: string[];
  exclude?: string[];
  hooks?: LifecycleHooks;
  healthCheck?: HealthCheckConfig;
  environmentVars?: Record<string, string>;
}

export interface DockerDeploymentTarget {
  driver: 'docker';
  hosts: SSHHostConfig[];
  imageName: string;
  containerName: string;
  portMappings?: string[];
  composeFile?: string;
  hooks?: LifecycleHooks;
  healthCheck?: HealthCheckConfig;
  environmentVars?: Record<string, string>;
}

export interface K8sDeploymentTarget {
  driver: 'k8s';
  context?: string;
  namespace?: string;
  manifestPath?: string;
  helmChartPath?: string;
  releaseName?: string;
  hooks?: LifecycleHooks;
  healthCheck?: HealthCheckConfig;
}

export type DeploymentTarget = SSHDeploymentTarget | DockerDeploymentTarget | K8sDeploymentTarget;

export interface ProjectConfig {
  name: string;
  dir?: string;
  targets: Record<string, DeploymentTarget>;
}

export interface DevployConfig {
  name?: string;
  dir?: string;
  projects?: Record<string, ProjectConfig>;
  targets?: Record<string, DeploymentTarget>;
}

export interface ReleaseInfo {
  name: string;
  timestamp: string;
  commitHash?: string;
  isCurrent: boolean;
}

export interface HostStatus {
  host: string;
  connected: boolean;
  activeRelease?: string;
  releases: ReleaseInfo[];
  error?: string;
}
