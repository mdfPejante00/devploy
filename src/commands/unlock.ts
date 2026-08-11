import { select, isCancel, cancel } from '@clack/prompts';
import { loadConfig } from '../config/loader.js';
import { Orchestrator } from '../orchestrator/runner.js';
import { startFlow } from '../ui/banner.js';

export async function unlockCommand(options: { project?: string; env?: string }) {
  startFlow('Devploy Unlock Target Environment');

  const { config, filepath } = await loadConfig();

  let selectedProject = options.project;
  if (config.projects && Object.keys(config.projects).length > 0) {
    const projectKeys = Object.keys(config.projects);
    if (!selectedProject) {
      if (projectKeys.length === 1) {
        selectedProject = projectKeys[0];
      } else {
        const choice = await select({
          message: 'Select project to unlock:',
          options: projectKeys.map((p) => ({ value: p, label: `${p} (${config.projects![p].name})` })),
        });
        if (isCancel(choice)) return cancel('Unlock cancelled.');
        selectedProject = choice as string;
      }
    }
  }

  const proj = config.projects && selectedProject ? config.projects[selectedProject] : config;
  const availableTargets = Object.keys(proj.targets || {});

  let selectedEnv = options.env;
  if (!selectedEnv) {
    if (availableTargets.length === 1) {
      selectedEnv = availableTargets[0];
    } else {
      const choice = await select({
        message: 'Select target environment to unlock:',
        options: availableTargets.map((t) => ({ value: t, label: t })),
      });
      if (isCancel(choice)) return cancel('Unlock cancelled.');
      selectedEnv = choice as string;
    }
  }

  const orchestrator = new Orchestrator();
  await orchestrator.unlock(config, filepath, selectedEnv, selectedProject);
}
