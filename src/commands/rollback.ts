import pc from 'picocolors';
import { select, confirm, isCancel, cancel } from '@clack/prompts';
import { loadConfig } from '../config/loader.js';
import { Orchestrator } from '../orchestrator/runner.js';
import { startFlow } from '../ui/banner.js';

export async function rollbackCommand(options: { project?: string; env?: string; release?: string; yes?: boolean }) {
  startFlow('Devploy Instant Release Rollback');

  const { config, filepath } = await loadConfig();

  let selectedProject = options.project;
  if (config.projects && Object.keys(config.projects).length > 0) {
    const projectKeys = Object.keys(config.projects);
    if (!selectedProject) {
      if (projectKeys.length === 1) {
        selectedProject = projectKeys[0];
      } else {
        const choice = await select({
          message: 'Select project to rollback:',
          options: projectKeys.map((p) => ({ value: p, label: `${p} (${config.projects![p].name})` })),
        });
        if (isCancel(choice)) return cancel('Rollback cancelled.');
        selectedProject = choice as string;
      }
    }
  }

  const proj = config.projects && selectedProject ? config.projects[selectedProject] : config;
  const availableTargets = Object.keys(proj.targets || {});

  let selectedEnv = options.env;
  if (!selectedEnv) {
    const choice = await select({
      message: 'Select target environment to rollback:',
      options: availableTargets.map((t) => ({ value: t, label: t })),
    });
    if (isCancel(choice)) return cancel('Rollback cancelled.');
    selectedEnv = choice as string;
  }

  const projName = proj.name || selectedProject || 'default';

  if (!options.yes) {
    const ok = await confirm({
      message: `Are you sure you want to ROLLBACK ${pc.bold(projName)} in ${pc.red(selectedEnv.toUpperCase())}?`,
      initialValue: false,
    });
    if (isCancel(ok) || !ok) return cancel('Rollback aborted.');
  }

  const orchestrator = new Orchestrator();
  await orchestrator.rollback(config, filepath, selectedEnv, selectedProject, options.release);
}
