import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { DevployConfig } from '../types/index.js';
import { DevployConfigSchema } from './schema.js';

// Load .env if present
dotenv.config();

export const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.devploy');
export const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'devploy.config.ts');

export function defineConfig(config: DevployConfig): DevployConfig {
  return config;
}

function interpolateEnvVars(obj: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] || '');
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars);
  }
  if (obj !== null && typeof obj === 'object') {
    const res: any = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = interpolateEnvVars(v);
    }
    return res;
  }
  return obj;
}

export async function loadConfig(cwd: string = process.cwd()): Promise<{ config: DevployConfig; filepath: string; isGlobal: boolean }> {
  const possibleFiles = [
    'devploy.config.ts',
    'devploy.config.js',
    'devploy.config.mjs',
    'devploy.config.json',
    '.devployrc.json',
  ];

  let configFilePath: string | null = null;

  // 1. Search local working directory and parent directories upward
  let currentDir = path.resolve(cwd);
  while (true) {
    for (const file of possibleFiles) {
      const fullPath = path.join(currentDir, file);
      if (fs.existsSync(fullPath)) {
        configFilePath = fullPath;
        break;
      }
    }
    if (configFilePath) break;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // Reached root directory
    currentDir = parentDir;
  }

  let isGlobal = false;

  // 2. Search global ~/.devploy directory if not found locally or in parents
  if (!configFilePath) {
    for (const file of possibleFiles) {
      const globalPath = path.join(GLOBAL_CONFIG_DIR, file);
      if (fs.existsSync(globalPath)) {
        configFilePath = globalPath;
        isGlobal = true;
        break;
      }
    }
  } else {
    // Check if the found config is located in global dir
    if (path.resolve(configFilePath).startsWith(path.resolve(GLOBAL_CONFIG_DIR))) {
      isGlobal = true;
    }
  }

  if (!configFilePath) {
    throw new Error(
      `No Devploy configuration file found in ${cwd} or global directory (${GLOBAL_CONFIG_DIR}).\nRun \`devploy init\` to create a devploy.config.ts file.`
    );
  }

  let rawConfig: any;

  if (configFilePath.endsWith('.json')) {
    const fileContent = fs.readFileSync(configFilePath, 'utf-8');
    rawConfig = JSON.parse(fileContent);
  } else {
    try {
      const { createJiti } = await import('jiti');
      const currentFilePath = fileURLToPath(import.meta.url);
      const jiti = createJiti(import.meta.url, {
        interopDefault: true,
        alias: {
          devploy: currentFilePath,
        },
      });
      const imported = await jiti.import(configFilePath);
      rawConfig = (imported as any).default || imported;
    } catch (err: any) {
      throw new Error(`Failed to load configuration file ${configFilePath}: ${err.message}`);
    }
  }

  // Interpolate environment variables
  const processedConfig = interpolateEnvVars(rawConfig);

  // Validate schema
  const parsed = DevployConfigSchema.safeParse(processedConfig);
  if (!parsed.success) {
    const formattedErrors = parsed.error.issues
      .map((issue) => `  - [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration in ${configFilePath}:\n${formattedErrors}`);
  }

  return { config: parsed.data as DevployConfig, filepath: configFilePath, isGlobal };
}

export function resolveProject(
  config: DevployConfig,
  configFilePath: string,
  projectName?: string
): { projectName: string; projectConfig: { name: string; dir?: string; targets: Record<string, any> }; projectDir: string } {
  const configDir = path.dirname(configFilePath);

  if (config.projects && Object.keys(config.projects).length > 0) {
    const projectKeys = Object.keys(config.projects);
    const selectedKey = projectName || projectKeys[0];
    const proj = config.projects[selectedKey];

    if (!proj) {
      throw new Error(`Project '${projectName}' not found in configuration. Available projects: ${projectKeys.join(', ')}`);
    }

    const resolvedDir = proj.dir ? path.resolve(configDir, proj.dir) : configDir;
    return {
      projectName: proj.name || selectedKey,
      projectConfig: proj,
      projectDir: resolvedDir,
    };
  }

  // Single project mode fallback
  const resolvedDir = config.dir ? path.resolve(configDir, config.dir) : configDir;
  return {
    projectName: config.name || 'default-project',
    projectConfig: {
      name: config.name || 'default-project',
      dir: config.dir,
      targets: config.targets || {},
    },
    projectDir: resolvedDir,
  };
}
