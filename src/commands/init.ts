import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { text, password as passwordPrompt, select, confirm, spinner, isCancel, cancel } from '@clack/prompts';
import { loadConfig, GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from '../config/loader.js';
import { DevployConfig, ProjectConfig, SSHHostConfig } from '../types/index.js';
import { SSHClientWrapper } from '../utils/ssh.js';
import { startFlow, endFlow, showSuccessSummaryCard } from '../ui/banner.js';

export async function initCommand() {
  startFlow('Devploy Interactive Setup Wizard');

  let mode: 'create' | 'add' | 'overwrite' = 'create';
  let existingConfig: DevployConfig | null = null;
  let targetConfigPath = GLOBAL_CONFIG_PATH;

  try {
    const loaded = await loadConfig();
    existingConfig = loaded.config;
    targetConfigPath = loaded.filepath;

    const action = await select({
      message: `A configuration file already exists at \`${targetConfigPath}\`. What would you like to do?`,
      options: [
        { value: 'add', label: `➕ Add another project to configuration (${path.basename(targetConfigPath)})` },
        { value: 'overwrite', label: `⚠️ Overwrite configuration (${path.basename(targetConfigPath)}) entirely` },
      ],
    });

    if (isCancel(action)) return cancel('Initialization cancelled.');
    mode = action as 'add' | 'overwrite';
  } catch (_) {
    mode = 'create';
    targetConfigPath = GLOBAL_CONFIG_PATH;
  }

  const name = await text({
    message: 'What is your project name?',
    placeholder: 'my-awesome-app',
    defaultValue: mode === 'add' ? 'second-app' : path.basename(process.cwd()),
    validate: (val) => (!val ? 'Project name cannot be empty' : undefined),
  });

  if (isCancel(name)) return cancel('Cancelled.');
  const projectSlug = (name as string).toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  const projectDir = await text({
    message: 'Local directory of the project to deploy:',
    placeholder: '. (current root) or ./services/api',
    defaultValue: mode === 'add' ? `./${name}` : '.',
  });

  if (isCancel(projectDir)) return cancel('Cancelled.');

  // --- 1. Test & verify local directory existence ---
  const s = spinner();
  s.start(`Verifying local project directory '${projectDir}'...`);

  const resolvedLocalDir = path.resolve(process.cwd(), projectDir as string);
  if (!fs.existsSync(resolvedLocalDir)) {
    s.stop(pc.yellow(`⚠️ Directory '${projectDir}' does not exist locally yet.`));
    const createNow = await confirm({
      message: `Would you like to create directory '${projectDir}' now?`,
      initialValue: true,
    });
    if (isCancel(createNow)) return cancel('Cancelled.');
    if (createNow) {
      fs.mkdirSync(resolvedLocalDir, { recursive: true });
      s.start('Creating directory...');
      await new Promise((r) => setTimeout(r, 300));
      s.stop(pc.green(`✔ Created local directory '${projectDir}'`));
    }
  } else {
    s.stop(pc.green(`✔ Local directory verified: '${projectDir}'`));
  }

  const driver = await select({
    message: 'Select deployment driver strategy:',
    initialValue: 'ssh',
    options: [
      { value: 'ssh', label: 'Bare-Metal SSH / Zero-Downtime Symlink (PM2 / Node)' },
    ],
  });

  if (isCancel(driver)) return cancel('Cancelled.');

  const host = await text({ message: 'Target Server IP / Hostname:', placeholder: '192.168.1.100' });
  if (isCancel(host)) return cancel('Cancelled.');

  const username = await text({ message: 'SSH Username:', defaultValue: 'deploy' });
  if (isCancel(username)) return cancel('Cancelled.');

  const authType = await select({
    message: 'Select SSH Authentication Method:',
    options: [
      { value: 'key', label: '🔑 SSH Private Key (with optional passphrase)' },
      { value: 'password', label: '🔒 SSH Password' },
    ],
  });

  if (isCancel(authType)) return cancel('Cancelled.');

  const hostObj: SSHHostConfig = {
    host: host as string,
    port: 22,
    username: username as string,
  };

  let testPassphraseOrPassword = '';

  if (authType === 'key') {
    const keyPath = await text({
      message: 'SSH Key File Path:',
      defaultValue: '~/.ssh/id_ed25519',
    });
    if (isCancel(keyPath)) return cancel('Cancelled.');
    hostObj.keyPath = keyPath as string;
    hostObj.passphrase = '${SSH_PASSPHRASE}';
  } else {
    const pwd = await passwordPrompt({
      message: `Enter SSH Server Password for ${username}@${host} (for connection test):`,
    });
    if (isCancel(pwd)) return cancel('Cancelled.');
    testPassphraseOrPassword = pwd as string;
    hostObj.password = '${SSH_PASSWORD}';
  }

  // --- 2. Test SSH Connection ---
  s.start(`Testing SSH connection to ${username}@${host}...`);

  const testClient = new SSHClientWrapper(hostObj);
  let connSuccess = false;
  let connError = '';

  try {
    await testClient.connect(testPassphraseOrPassword || undefined);
    connSuccess = true;
  } catch (err: any) {
    connError = err.message;
  } finally {
    testClient.close();
  }

  if (connSuccess) {
    s.stop(pc.green(`✔ SSH connection successful to ${username}@${host}!`));
  } else {
    s.stop(pc.yellow(`⚠️ Connection test failed to ${username}@${host}: ${connError}`));
    const proceedAnyway = await confirm({
      message: 'Would you like to save this configuration anyway?',
      initialValue: true,
    });
    if (isCancel(proceedAnyway) || !proceedAnyway) {
      return cancel('Initialization cancelled.');
    }
  }

  const deployPath = await text({ message: 'Remote Deploy Path:', placeholder: `/var/www/${name}` });
  if (isCancel(deployPath)) return cancel('Cancelled.');

  const addInstallHook = await confirm({
    message: "Would you like to add an install hook ('npm install') before build?",
    initialValue: true,
  });
  if (isCancel(addInstallHook)) return cancel('Cancelled.');

  const addLintHook = await confirm({
    message: "Would you like to add a pre-build lint check ('npm run lint') hook?",
    initialValue: false,
  });
  if (isCancel(addLintHook)) return cancel('Cancelled.');

  const addPruneHook = await confirm({
    message: "Would you like to add a post-deploy prune ('npm prune --production') hook?",
    initialValue: false,
  });
  if (isCancel(addPruneHook)) return cancel('Cancelled.');

  const pkgPath = path.join(resolvedLocalDir, 'package.json');
  let detectedHooks: any = {};

  const install: string[] = [];
  const preBuild: string[] = [];
  const build: string[] = [];
  const postDeploy: string[] = [];

  if (addInstallHook) {
    install.push('npm install');
  }

  if (addLintHook) {
    preBuild.push('npm run lint');
  }

  if (addPruneHook) {
    postDeploy.push('npm prune --production');
  }

  if (fs.existsSync(pkgPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkgJson.scripts || {};
      if (scripts.build) build.push('npm run build');
    } catch (_) {}
  }

  detectedHooks = {
    ...(install.length ? { install } : {}),
    ...(preBuild.length ? { preBuild } : {}),
    ...(build.length ? { build } : {}),
    ...(postDeploy.length ? { postDeploy } : {}),
  };

  const addHealthCheck = await confirm({
    message: 'Would you like to configure a post-deployment HTTP Health Check?',
    initialValue: false,
  });
  if (isCancel(addHealthCheck)) return cancel('Cancelled.');

  let healthCheckObj: any = undefined;
  if (addHealthCheck) {
    const healthUrl = await text({
      message: 'Health Check URL:',
      placeholder: `http://${host}:3000/health`,
    });
    if (isCancel(healthUrl)) return cancel('Cancelled.');

    if (healthUrl) {
      healthCheckObj = {
        url: healthUrl as string,
        expectedStatus: 200,
      };
    }
  }

  const newProjectObj: ProjectConfig = {
    name,
    dir: resolvedLocalDir,
    targets: {
      production: {
        driver: 'ssh',
        hosts: [hostObj],
        deployPath: deployPath as string,
        include: [],
        exclude: ['.git', 'node_modules', '.claude', '.qodo', '.vscode'],
        keepReleases: 5,
        hooks: detectedHooks,
        healthCheck: healthCheckObj,
      },
    },
  };

  let finalConfig: DevployConfig;

  if (mode === 'add' && existingConfig) {
    const projectsMap: Record<string, ProjectConfig> = existingConfig.projects
      ? { ...existingConfig.projects }
      : {};

    if (!existingConfig.projects && existingConfig.name && existingConfig.targets) {
      const existingSlug = existingConfig.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      projectsMap[existingSlug] = {
        name: existingConfig.name,
        dir: existingConfig.dir ? path.resolve(process.cwd(), existingConfig.dir) : process.cwd(),
        targets: existingConfig.targets,
      };
    }

    projectsMap[projectSlug] = newProjectObj;
    finalConfig = { projects: projectsMap };
  } else {
    finalConfig = {
      projects: {
        [projectSlug]: newProjectObj,
      },
    };
  }

  const fileContent = `import { defineConfig } from 'devploy';

export default defineConfig(${JSON.stringify(finalConfig, null, 2)});
`;

  fs.mkdirSync(path.dirname(targetConfigPath), { recursive: true });
  fs.writeFileSync(targetConfigPath, fileContent, 'utf-8');

  showSuccessSummaryCard({
    projectName: projectSlug,
    projectDir: resolvedLocalDir,
    targetEnv: 'production',
    host: host as string,
    username: username as string,
    deployPath: deployPath as string,
    isNewFile: mode !== 'add',
  });
}
