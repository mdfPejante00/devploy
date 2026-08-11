import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { confirm, isCancel, cancel } from '@clack/prompts';
import { GLOBAL_CONFIG_DIR } from '../config/loader.js';
import { startFlow, endFlow } from '../ui/banner.js';

export async function purgeCommand(options: { yes?: boolean }) {
  startFlow('Devploy Purge Configuration');

  const possibleFiles = [
    'devploy.config.ts',
    'devploy.config.js',
    'devploy.config.mjs',
    'devploy.config.json',
    '.devployrc.json',
  ];

  const existingFiles: string[] = [];
  for (const file of possibleFiles) {
    const localPath = path.join(process.cwd(), file);
    if (fs.existsSync(localPath)) {
      existingFiles.push(localPath);
    }
    const globalPath = path.join(GLOBAL_CONFIG_DIR, file);
    if (fs.existsSync(globalPath) && !existingFiles.includes(globalPath)) {
      existingFiles.push(globalPath);
    }
  }

  if (existingFiles.length === 0) {
    endFlow('No configuration files found to purge.');
    return;
  }

  if (!options.yes) {
    const ok = await confirm({
      message: `Are you sure you want to PURGE (delete) configuration file(s):\n${pc.red(existingFiles.join('\n'))}?`,
      initialValue: false,
    });

    if (isCancel(ok) || !ok) {
      return cancel('Purge operation aborted.');
    }
  }

  for (const file of existingFiles) {
    fs.unlinkSync(file);
  }

  endFlow(`Successfully purged configuration file(s):\n${existingFiles.join('\n')}`);
}
