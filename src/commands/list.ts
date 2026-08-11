import pc from 'picocolors';
import Table from 'cli-table3';
import { loadConfig } from '../config/loader.js';
import { startFlow, endFlow } from '../ui/banner.js';
import { getResponsiveColWidths } from '../ui/logger.js';

export async function listCommand() {
  startFlow('Devploy Projects List');

  const { config, filepath, isGlobal } = await loadConfig();

  const projectsMap = config.projects || (config.name ? {
    [config.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')]: {
      name: config.name,
      dir: config.dir || '.',
      targets: config.targets || {},
    }
  } : {});

  const projectKeys = Object.keys(projectsMap);

  if (projectKeys.length === 0) {
    endFlow(`No projects found in configuration file (${filepath}).`);
    return;
  }

  console.log(pc.gray(`📄 Loaded configuration from: ${filepath} (${isGlobal ? 'Global' : 'Local'})`));
  console.log('\n' + pc.bold(pc.cyan(`📦 Configured Projects (${projectKeys.length})`)) + '\n');

  const colWidths = getResponsiveColWidths([0.18, 0.20, 0.32, 0.12, 0.18], [14, 14, 20, 12, 16]);

  const table = new Table({
    head: [
      pc.bold(pc.white('Project Key')),
      pc.bold(pc.white('Display Name')),
      pc.bold(pc.white('Local Dir')),
      pc.bold(pc.white('Environments')),
      pc.bold(pc.white('Deploy Target')),
    ],
    colWidths,
    wordWrap: true,
    style: { head: [], border: ['gray'] },
  });

  for (const key of projectKeys) {
    const proj = projectsMap[key];
    const envs = Object.keys(proj.targets || {});

    let serverTargets = '-';
    if (envs.length > 0) {
      const firstEnv = envs[0];
      const targetObj = proj.targets[firstEnv];
      if (targetObj.driver === 'ssh' && targetObj.hosts?.[0]) {
        const host = targetObj.hosts[0];
        serverTargets = `${host.username}@${host.host}`;
      } else if (targetObj.driver === 'docker') {
        serverTargets = `Docker (${targetObj.containerName})`;
      } else if (targetObj.driver === 'k8s') {
        serverTargets = `K8s (${targetObj.namespace || 'default'})`;
      }
    }

    table.push([
      pc.bold(pc.cyan(key)),
      proj.name || key,
      pc.yellow(proj.dir || '.'),
      pc.magenta(envs.join(', ').toUpperCase()),
      pc.green(serverTargets),
    ]);
  }

  console.log(table.toString());
  console.log('');

  endFlow(`Found ${projectKeys.length} project(s). Deploy with \`devploy deploy --project <name>\`.`);
}
