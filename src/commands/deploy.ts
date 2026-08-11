import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { multiselect, select, confirm, isCancel, cancel } from '@clack/prompts';
import { loadConfig } from '../config/loader.js';
import { Orchestrator } from '../orchestrator/runner.js';
import { startFlow, endFlow } from '../ui/banner.js';

export async function deployCommand(options: { project?: string; env?: string; yes?: boolean; force?: boolean }) {
  startFlow('Devploy Deployment');

  const { config, filepath } = await loadConfig();

  let selectedProject = options.project;
  if (config.projects && Object.keys(config.projects).length > 0) {
    const projectKeys = Object.keys(config.projects);
    if (!selectedProject) {
      if (projectKeys.length === 1) {
        selectedProject = projectKeys[0];
      } else {
        const choice = await select({
          message: 'Select project to deploy:',
          options: projectKeys.map((k) => ({ value: k, label: config.projects![k].name || k })),
        });
        if (isCancel(choice)) return cancel('Deployment cancelled.');
        selectedProject = choice as string;
      }
    }
  }

  const proj = selectedProject && config.projects ? config.projects[selectedProject] : config;
  if (!proj) {
    return cancel(`Project '${selectedProject || 'default'}' not found in configuration.`);
  }

  let selectedEnv = options.env;
  if (!selectedEnv) {
    const availableTargets = proj.targets ? Object.keys(proj.targets) : [];
    if (availableTargets.length === 0) {
      return cancel(`No deployment targets found for project '${selectedProject}'.`);
    }
    if (availableTargets.length === 1) {
      selectedEnv = availableTargets[0];
    } else {
      const choice = await select({
        message: 'Select target environment:',
        options: availableTargets.map((t) => ({ value: t, label: t })),
      });
      if (isCancel(choice)) return cancel('Deployment cancelled.');
      selectedEnv = choice as string;
    }
  }

  const targetObj = proj.targets ? proj.targets[selectedEnv] : undefined;

  if (!options.yes && targetObj) {
    const projectDir = path.resolve(proj.dir || process.cwd());
    let filteredItems: string[] = [];
    if (fs.existsSync(projectDir)) {
      try {
        const allItems = fs.readdirSync(projectDir);
        const defaultExcludes = ['.git', 'node_modules', 'devploy', '.claude', '.qodo', '.vscode', '.idea', '.DS_Store'];
        const customExcludes = targetObj.exclude || [];
        const excludedSet = new Set([...defaultExcludes, ...customExcludes]);
        filteredItems = allItems.filter((item) => !excludedSet.has(item) && !item.endsWith('.tar.gz'));
      } catch (_) {}
    }

    const multiselectOptions = [
      { value: '.', label: '. (entire workspace)', hint: 'Deploys all non-excluded files & folders' },
      ...filteredItems.map((item) => {
        let isDir = false;
        try {
          isDir = fs.statSync(path.join(projectDir, item)).isDirectory();
        } catch (_) {}
        return {
          value: item,
          label: `${item}${isDir ? '/' : ''}`,
        };
      }),
    ];

    const currentIncludes = targetObj.include || [];
    let initialSelectedValues: string[] = [];
    if (currentIncludes.length === 0 || currentIncludes.includes('.')) {
      initialSelectedValues = ['.'];
    } else {
      initialSelectedValues = currentIncludes.filter((inc) => filteredItems.includes(inc) || inc === '.');
    }

    const selectedIncludes = await multiselect({
      message: 'Files & directories to include for deployment:',
      options: multiselectOptions,
      initialValues: initialSelectedValues,
      required: false,
    });

    if (isCancel(selectedIncludes)) return cancel('Deployment cancelled.');

    const choiceArr = (selectedIncludes as string[]) || [];
    if (choiceArr.includes('.') || choiceArr.length === 0) {
      targetObj.include = ['.'];
    } else {
      targetObj.include = choiceArr;
    }

    // Persist updated include patterns into devploy.config.ts for future deployments
    try {
      const fileContent = `import { defineConfig } from 'devploy';

export default defineConfig(${JSON.stringify(config, null, 2)});
`;
      fs.writeFileSync(filepath, fileContent, 'utf-8');
    } catch (_) {}

    const projName = proj.name || selectedProject || 'default';
    const ok = await confirm({
      message: `Are you sure you want to deploy ${pc.bold(projName)} to ${pc.cyan(selectedEnv.toUpperCase())}?`,
      initialValue: true,
    });
    if (isCancel(ok) || !ok) {
      return cancel('Deployment aborted.');
    }
  }

  const orchestrator = new Orchestrator();
  await orchestrator.deploy(config, filepath, selectedEnv, selectedProject, !options.yes, options.force);
}
