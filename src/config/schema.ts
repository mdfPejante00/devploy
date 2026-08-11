import { z } from 'zod';

export const SSHHostConfigSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().optional().default(22),
  username: z.string().min(1, 'Username is required'),
  keyPath: z.string().optional(),
  passphrase: z.string().optional(),
  password: z.string().optional(),
  agent: z.string().optional(),
});

export const LifecycleHooksSchema = z.object({
  install: z.array(z.string()).optional(),
  preBuild: z.array(z.string()).optional(),
  build: z.array(z.string()).optional(),
  postBuild: z.array(z.string()).optional(),
  preDeploy: z.array(z.string()).optional(),
  deploy: z.array(z.string()).optional(),
  postDeploy: z.array(z.string()).optional(),
  healthCheck: z.array(z.string()).optional(),
});

export const HealthCheckConfigSchema = z.object({
  url: z.string().url('Health check URL must be a valid URL'),
  expectedStatus: z.number().optional().default(200),
  timeoutSeconds: z.number().optional().default(15),
  maxRetries: z.number().optional().default(3),
});

export const SSHTargetSchema = z.object({
  driver: z.literal('ssh'),
  hosts: z.array(SSHHostConfigSchema).min(1, 'At least one SSH host is required'),
  deployPath: z.string().min(1, 'Deploy path is required'),
  keepReleases: z.number().optional().default(5),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  hooks: LifecycleHooksSchema.optional(),
  healthCheck: HealthCheckConfigSchema.optional(),
  environmentVars: z.record(z.string()).optional(),
});

export const DockerTargetSchema = z.object({
  driver: z.literal('docker'),
  hosts: z.array(SSHHostConfigSchema).min(1, 'At least one SSH host is required'),
  imageName: z.string().min(1, 'Docker image name is required'),
  containerName: z.string().min(1, 'Container name is required'),
  portMappings: z.array(z.string()).optional(),
  composeFile: z.string().optional(),
  hooks: LifecycleHooksSchema.optional(),
  healthCheck: HealthCheckConfigSchema.optional(),
  environmentVars: z.record(z.string()).optional(),
});

export const K8sTargetSchema = z.object({
  driver: z.literal('k8s'),
  context: z.string().optional(),
  namespace: z.string().optional().default('default'),
  manifestPath: z.string().optional(),
  helmChartPath: z.string().optional(),
  releaseName: z.string().optional(),
  hooks: LifecycleHooksSchema.optional(),
  healthCheck: HealthCheckConfigSchema.optional(),
});

export const DeploymentTargetSchema = z.discriminatedUnion('driver', [
  SSHTargetSchema,
  DockerTargetSchema,
  K8sTargetSchema,
]);

export const ProjectConfigSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  dir: z.string().optional(),
  targets: z.record(DeploymentTargetSchema).refine(
    (targets) => Object.keys(targets).length > 0,
    { message: 'At least one target environment must be defined' }
  ),
});

export const DevployConfigSchema = z.object({
  name: z.string().optional(),
  dir: z.string().optional(),
  projects: z.record(ProjectConfigSchema).optional(),
  targets: z.record(DeploymentTargetSchema).optional(),
}).refine(
  (data) => (data.projects && Object.keys(data.projects).length > 0) || (data.name && data.targets && Object.keys(data.targets).length > 0),
  { message: 'Configuration must specify either `projects` or top-level `name` and `targets`.' }
);
