import pc from 'picocolors';
import Table from 'cli-table3';
import { log, spinner } from '@clack/prompts';
import { HostStatus } from '../types/index.js';

export const logger = {
  info: (msg: string) => log.info(pc.cyan(msg)),
  success: (msg: string) => log.success(pc.green(msg)),
  warn: (msg: string) => log.warn(pc.yellow(msg)),
  error: (msg: string) => log.error(pc.red(msg)),
  step: (msg: string) => log.step(pc.bold(msg)),
  message: (msg: string) => log.message(msg),
};

export function createSpinner() {
  return spinner();
}

export function getResponsiveColWidths(proportions: number[], minWidths: number[]): number[] {
  const termWidth = process.stdout.columns || 100;
  const n = proportions.length;
  const borderOverhead = (n + 1) + (2 * n);
  const usableWidth = Math.max(50, termWidth - borderOverhead);

  return proportions.map((prop, idx) => {
    const calc = Math.floor(usableWidth * prop);
    const min = minWidths[idx] || 10;
    return Math.max(min, calc);
  });
}

export function renderStatusTable(targetName: string, hostStatuses: HostStatus[]) {
  console.log('\n' + pc.bold(pc.cyan(`📊 Environment Status: ${targetName.toUpperCase()}`)) + '\n');

  const colWidths = getResponsiveColWidths([0.22, 0.18, 0.25, 0.15, 0.20], [15, 14, 18, 14, 14]);

  const table = new Table({
    head: [
      pc.bold(pc.white('Host')),
      pc.bold(pc.white('Connection')),
      pc.bold(pc.white('Active Release')),
      pc.bold(pc.white('Total Releases')),
      pc.bold(pc.white('Status')),
    ],
    colWidths,
    wordWrap: true,
    style: { head: [], border: ['gray'] },
  });

  for (const s of hostStatuses) {
    const connBadge = s.connected ? pc.green('● Connected') : pc.red('✖ Disconnected');
    const activeRel = s.activeRelease ? pc.green(s.activeRelease) : pc.yellow('None / Unknown');
    const relCount = String(s.releases.length);
    const statusText = s.error ? pc.red(s.error) : s.connected ? pc.green('Healthy') : pc.red('Error');

    table.push([s.host, connBadge, activeRel, relCount, statusText]);
  }

  console.log(table.toString());
  console.log('');
}
