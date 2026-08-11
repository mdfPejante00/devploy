import fs from 'node:fs';
import pc from 'picocolors';
import { select, confirm, isCancel, cancel } from '@clack/prompts';
import { loadConfig } from '../config/loader.js';
import { startFlow, endFlow } from '../ui/banner.js';
import { logger } from '../ui/logger.js';

export async function deleteCommand(projectNameArg?: string, options?: { force?: boolean; yes?: boolean }) {
  startFlow('Devploy Delete Project');

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
    endFlow('No project configurations found to delete in devploy.config.ts.');
    return;
  }

  let selectedKey = projectNameArg;
  if (!selectedKey || !projectsMap[selectedKey]) {
    if (projectKeys.length === 1 && !projectNameArg) {
      selectedKey = projectKeys[0];
    } else {
      const choice = await select({
        message: 'Select project to remove from configuration:',
        options: projectKeys.map((p) => ({
          value: p,
          label: `${p} (${projectsMap[p].name || p})`,
        })),
      });
      if (isCancel(choice)) return cancel('Deletion cancelled.');
      selectedKey = choice as string;
    }
  }

  const projectToDelete = projectsMap[selectedKey];
  const skipConfirm = options?.force || options?.yes;

  if (!skipConfirm) {
    const confirmed = await confirm({
      message: `Are you sure you want to delete project '${pc.cyan(selectedKey)}' (${projectToDelete.name || selectedKey}) from devploy.config.ts?`,
      initialValue: false,
    });
    if (isCancel(confirmed) || !confirmed) {
      return cancel('Deletion cancelled.');
    }
  }

  delete projectsMap[selectedKey];

  const updatedConfig = {
    ...config,
    projects: projectsMap,
  };

  const fileContent = `import { defineConfig } from 'devploy';

export default defineConfig(${JSON.stringify(updatedConfig, null, 2)});
`;

  fs.writeFileSync(filepath, fileContent, 'utf-8');

  logger.success(`Successfully removed project '${pc.cyan(selectedKey)}' from ${filepath}! 🎉`);
  endFlow(`Project '${selectedKey}' has been deleted.`);
}
