import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import boxen from 'boxen';
import { text, password as passwordPrompt, select, confirm, spinner, isCancel, cancel } from '@clack/prompts';
import { loadConfig } from '../config/loader.js';
import { DevployConfig, ProjectConfig, SSHHostConfig, SSHDeploymentTarget } from '../types/index.js';
import { startFlow, endFlow, showSuccessSummaryCard } from '../ui/banner.js';
import { isKeyEncrypted } from '../utils/ssh.js';

export async function modCommand(projectNameArg?: string) {
  startFlow('Devploy Modify Project Configuration');

  const { config, filepath } = await loadConfig();

  const projectsMap = config.projects || (config.name ? {
    [config.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')]: {
      name: config.name,
      dir: config.dir || '.',
      targets: config.targets || {},
    }
  } : {});

  const projectKeys = Object.keys(projectsMap);

  if (projectKeys.length === 0) {
    endFlow('No projects found to modify in devploy.config.ts.');
    return;
  }

  let selectedKey = projectNameArg;
  if (!selectedKey || !projectsMap[selectedKey]) {
    if (projectKeys.length === 1 && !projectNameArg) {
      selectedKey = projectKeys[0];
    } else {
      const choice = await select({
        message: 'Select project to modify:',
        options: projectKeys.map((p) => ({ value: p, label: `${p} (${projectsMap[p].name})` })),
      });
      if (isCancel(choice)) return cancel('Modification cancelled.');
      selectedKey = choice as string;
    }
  }

  const targetProject = projectsMap[selectedKey];
  const targetEnv = 'production'; // default env target to modify
  const currentTarget = (targetProject.targets?.[targetEnv] || {}) as SSHDeploymentTarget;
  const currentHostObj: SSHHostConfig = currentTarget.hosts?.[0] || { host: '192.168.1.100', port: 22, username: 'deploy' };

  // Detect current auth type
  const currentAuthType = currentHostObj.keyPath ? 'key' : 'password';
  const currentAuthLabel = currentAuthType === 'key'
    ? `🔑 SSH Private Key (${currentHostObj.keyPath || 'not set'})`
    : `🔒 SSH Password`;

  // Display Current Configuration Summary Card
  console.log('\n');
  console.log(
    boxen(
      `${pc.bold(pc.cyan('📋 Current Configuration:'))} ${pc.bold(pc.white(targetProject.name || selectedKey))}\n\n` +
      `  ${pc.gray('• Project Key:')}     ${pc.bold(pc.white(selectedKey))}\n` +
      `  ${pc.gray('• Display Name:')}    ${pc.white(targetProject.name || selectedKey)}\n` +
      `  ${pc.gray('• Local Directory:')} ${pc.yellow(targetProject.dir || '.')}\n` +
      `  ${pc.gray('• Server Target:')}   ${pc.green(`${currentHostObj.username}@${currentHostObj.host}`)}\n` +
      `  ${pc.gray('• Auth Method:')}     ${pc.cyan(currentAuthLabel)}\n` +
      `  ${pc.gray('• Deploy Path:')}     ${pc.cyan(currentTarget.deployPath || `/var/www/${selectedKey}`)}\n` +
      `  ${pc.gray('• Pre-Build Lint:')}  ${currentTarget.hooks?.preBuild?.includes('npm run lint') ? pc.green('Enabled') : pc.gray('Disabled')}`,
      {
        padding: 1,
        margin: { top: 0, bottom: 1 },
        borderStyle: 'round',
        borderColor: 'cyan',
      }
    )
  );

  // 1. Modify Display Name
  const name = await text({
    message: 'Project Display Name:',
    initialValue: targetProject.name || selectedKey,
    placeholder: targetProject.name || selectedKey,
    validate: (val) => (!val ? 'Name cannot be empty' : undefined),
  });
  if (isCancel(name)) return cancel('Modification cancelled.');

  // 2. Modify Local Directory
  const projectDir = await text({
    message: 'Local directory of the project to deploy:',
    initialValue: targetProject.dir || '.',
    placeholder: targetProject.dir || '.',
  });
  if (isCancel(projectDir)) return cancel('Modification cancelled.');

  // Verify local directory
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

  // 3. Modify Server Host IP
  const host = await text({
    message: 'Target Server IP / Hostname:',
    initialValue: currentHostObj.host || '192.168.1.100',
    placeholder: currentHostObj.host || '192.168.1.100',
  });
  if (isCancel(host)) return cancel('Modification cancelled.');

  // 4. Modify SSH Username
  const username = await text({
    message: 'SSH Username:',
    initialValue: currentHostObj.username || 'deploy',
    placeholder: currentHostObj.username || 'deploy',
  });
  if (isCancel(username)) return cancel('Modification cancelled.');

  // 5. Select SSH Authentication Method
  const authType = await select({
    message: 'Select SSH Authentication Method:',
    initialValue: currentAuthType,
    options: [
      { value: 'key', label: '🔑 SSH Private Key (with optional passphrase)' },
      { value: 'password', label: '🔒 SSH Password' },
    ],
  });
  if (isCancel(authType)) return cancel('Modification cancelled.');

  // Build the updated host object, clearing old auth fields first
  const updatedHostObj: SSHHostConfig = {
    host: host as string,
    port: currentHostObj.port || 22,
    username: username as string,
  };

  if (authType === 'key') {
    const keyPath = await text({
      message: 'SSH Key File Path:',
      initialValue: currentHostObj.keyPath || '~/.ssh/id_ed25519',
      placeholder: '~/.ssh/id_ed25519',
    });
    if (isCancel(keyPath)) return cancel('Modification cancelled.');
    updatedHostObj.keyPath = keyPath as string;

    // Check if key is encrypted and prompt for passphrase
    const expandedKeyPath = (keyPath as string).replace(/^~/, process.env.HOME || '');
    let encrypted = false;
    if (fs.existsSync(expandedKeyPath)) {
      try { encrypted = isKeyEncrypted(fs.readFileSync(expandedKeyPath)); } catch (_) {}
    }

    if (encrypted) {
      const passphrase = await text({
        message: 'SSH Key Passphrase (leave empty if managed by ssh-agent):',
        placeholder: '(leave empty to use ssh-agent)',
      });
      if (isCancel(passphrase)) return cancel('Modification cancelled.');
      updatedHostObj.passphrase = (passphrase as string) || '${SSH_PASSPHRASE}';
    } else {
      updatedHostObj.passphrase = currentHostObj.keyPath === (keyPath as string)
        ? (currentHostObj.passphrase || '')
        : '';
    }
  } else {
    // Password auth — store placeholder, real value from env
    updatedHostObj.password = '${SSH_PASSWORD}';
  }

  // 6. Modify Remote Deploy Path
  const deployPath = await text({
    message: 'Remote Deploy Path:',
    initialValue: currentTarget.deployPath || `/var/www/${selectedKey}`,
    placeholder: currentTarget.deployPath || `/var/www/${selectedKey}`,
  });
  if (isCancel(deployPath)) return cancel('Modification cancelled.');

  // 7. Modify Install Hook
  const hasInstallHook = currentTarget.hooks?.install?.includes('npm install') || false;
  const addInstallHook = await confirm({
    message: "Add install hook ('npm install') before build?",
    initialValue: hasInstallHook,
  });
  if (isCancel(addInstallHook)) return cancel('Modification cancelled.');

  // 8. Modify Pre-Build Lint Hook
  const hasLintHook = currentTarget.hooks?.preBuild?.includes('npm run lint') || false;
  const addLintHook = await confirm({
    message: "Add pre-build lint check ('npm run lint') hook?",
    initialValue: hasLintHook,
  });
  if (isCancel(addLintHook)) return cancel('Modification cancelled.');

  // 9. Modify Health Check
  const hasHealthCheck = !!currentTarget.healthCheck?.url;
  const addHealthCheck = await confirm({
    message: 'Configure post-deployment HTTP Health Check?',
    initialValue: hasHealthCheck,
  });
  if (isCancel(addHealthCheck)) return cancel('Modification cancelled.');

  let healthCheckObj: any = undefined;
  if (addHealthCheck) {
    const healthUrl = await text({
      message: 'Health Check URL:',
      initialValue: currentTarget.healthCheck?.url || `http://${host}:3000/health`,
      placeholder: `http://${host}:3000/health`,
    });
    if (isCancel(healthUrl)) return cancel('Modification cancelled.');

    if (healthUrl) {
      healthCheckObj = {
        url: healthUrl as string,
        expectedStatus: currentTarget.healthCheck?.expectedStatus || 200,
      };
    }
  }

  const installHooks: string[] = [];
  if (addInstallHook) {
    installHooks.push('npm install');
  }

  const preBuildHooks: string[] = [];
  if (addLintHook) {
    preBuildHooks.push('npm run lint');
  }

  const updatedProjectObj: ProjectConfig = {
    name: name as string,
    dir: resolvedLocalDir,
    targets: {
      ...targetProject.targets,
      [targetEnv]: {
        ...currentTarget,
        driver: 'ssh',
        hosts: [updatedHostObj],
        deployPath: deployPath as string,
        include: currentTarget.include || [],
        exclude: currentTarget.exclude || ['.git', 'node_modules', '.claude', '.qodo', '.vscode'],
        keepReleases: currentTarget.keepReleases || 3,
        hooks: {
          ...(currentTarget.hooks || {}),
          install: installHooks.length ? installHooks : undefined,
          preBuild: preBuildHooks.length ? preBuildHooks : undefined,
        },
        healthCheck: healthCheckObj,
      },
    },
  };

  const updatedProjectsMap = {
    ...projectsMap,
    [selectedKey]: updatedProjectObj,
  };

  const updatedConfig: DevployConfig = {
    projects: updatedProjectsMap,
  };

  const fileContent = `import { defineConfig } from 'devploy';\n\nexport default defineConfig(${JSON.stringify(updatedConfig, null, 2)});\n`;

  fs.writeFileSync(filepath, fileContent, 'utf-8');

  showSuccessSummaryCard({
    projectName: selectedKey,
    projectDir: resolvedLocalDir,
    targetEnv: targetEnv,
    host: host as string,
    username: username as string,
    deployPath: deployPath as string,
    isNewFile: false,
  });

  if (authType === 'password') {
    console.log(pc.cyan(`\n💡 Tip: Set SSH_PASSWORD="<your_password>" in a .env file or export it before running devploy deploy.`));
  }
}

