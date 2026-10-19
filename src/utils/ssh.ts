import fs from 'node:fs';
import path from 'node:path';
import ssh2Pkg from 'ssh2';
import type { Client as SSHClientType, ConnectConfig } from 'ssh2';
import { SSHHostConfig } from '../types/index.js';
import { password, spinner, isCancel } from '@clack/prompts';
import pc from 'picocolors';

const { Client: SSHClient, utils } = ssh2Pkg;

export function isKeyEncrypted(keyData: Buffer | string): boolean {
  try {
    const buf = typeof keyData === 'string' ? Buffer.from(keyData) : keyData;
    const res = utils.parseKey(buf);
    if (res instanceof Error) {
      const msg = res.message.toLowerCase();
      return msg.includes('encrypted') || msg.includes('passphrase');
    }
    return false;
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    return msg.includes('encrypted') || msg.includes('passphrase');
  }
}

export class SSHClientWrapper {
  private client: SSHClientType;
  public config: SSHHostConfig;

  constructor(config: SSHHostConfig) {
    this.client = new SSHClient();
    this.config = config;
  }

  public connect(passphraseOverride?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = new SSHClient();
      const connParams: ConnectConfig = {
        host: this.config.host,
        port: this.config.port || 22,
        username: this.config.username,
        readyTimeout: 10000,
      };

      const agentSocket = this.config.agent || process.env.SSH_AUTH_SOCK;
      const activeCredential = passphraseOverride || this.config.passphrase || this.config.password || process.env.SSH_PASSPHRASE || process.env.SSH_PASSWORD;
      const cleanCredential = activeCredential && activeCredential !== '${SSH_PASSWORD}' && activeCredential !== '${SSH_PASSPHRASE}' ? activeCredential : undefined;

      if (this.config.keyPath) {
        // Explicit Key Authentication
        const expandedPath = this.config.keyPath.replace(/^~/, process.env.HOME || '');
        if (fs.existsSync(expandedPath)) {
          const keyBuffer = fs.readFileSync(expandedPath);
          const encrypted = isKeyEncrypted(keyBuffer);

          if (cleanCredential) {
            // Decrypt with provided passphrase
            connParams.privateKey = keyBuffer;
            connParams.passphrase = cleanCredential;
          } else if (encrypted && agentSocket && !passphraseOverride) {
            // Key is encrypted and no passphrase provided, but SSH Agent is available.
            // Delegate to the agent! Do NOT pass privateKey because ssh2 throws synchronously if privateKey cannot be parsed.
            connParams.agent = agentSocket;
          } else {
            // Unencrypted key OR no agent: pass privateKey to let ssh2 authenticate or surface passphrase requirement
            connParams.privateKey = keyBuffer;
            if (agentSocket && !passphraseOverride) {
              connParams.agent = agentSocket;
            }
          }
        } else if (agentSocket) {
          connParams.agent = agentSocket;
        }
      } else if (cleanCredential) {
        // Explicit Password Authentication
        connParams.password = cleanCredential;
        connParams.tryKeyboard = true;
        this.client.on('keyboard-interactive', (_name, _instructions, _instructionsLang, _prompts, finish) => {
          finish([cleanCredential]);
        });
      } else {
        // Fallback to SSH Agent or default local SSH keys (~/.ssh/id_rsa, id_ed25519, etc.)
        if (agentSocket) {
          connParams.agent = agentSocket;
        }
        const defaultKeyPaths = [
          path.join(process.env.HOME || '', '.ssh', 'id_rsa'),
          path.join(process.env.HOME || '', '.ssh', 'id_ed25519'),
          path.join(process.env.HOME || '', '.ssh', 'id_ecdsa'),
          path.join(process.env.HOME || '', '.ssh', 'id_dsa'),
        ];
        const existingKey = defaultKeyPaths.find((p) => fs.existsSync(p));
        if (existingKey) {
          const keyBuffer = fs.readFileSync(existingKey);
          const encrypted = isKeyEncrypted(keyBuffer);
          // If encrypted and agent is available, do not pass raw privateKey so agent can authenticate
          if (!encrypted || !agentSocket) {
            connParams.privateKey = keyBuffer;
          }
        }
      }

      this.client.on('ready', () => resolve());
      this.client.on('error', (err) => reject(new Error(`[${this.config.host}] SSH Connection error: ${err.message}`)));

      try {
        this.client.connect(connParams);
      } catch (err: any) {
        reject(new Error(`[${this.config.host}] SSH Connection error: ${err.message}`));
      }
    });
  }

  public async connectWithRetry(options?: { isInteractive?: boolean }): Promise<void> {
    let connected = false;
    let passphraseAttempt: string | undefined = undefined;
    let attempts = 0;
    let lastErr: any = null;
    let s: ReturnType<typeof spinner> | null = null;

    while (!connected && attempts < 3) {
      try {
        if (passphraseAttempt) {
          s = spinner();
          s.start(`Connecting to ${this.config.host} with provided credentials...`);
        }
        await this.connect(passphraseAttempt);
        connected = true;
        if (s) {
          s.stop(pc.green(`✔ Connected to ${this.config.host}`));
          s = null;
        }
      } catch (err: any) {
        lastErr = err;
        if (s) {
          s.stop(pc.red(`✖ Authentication failed for ${this.config.host}`));
          s = null;
        }
        const isAuthError =
          err.message.includes('Encrypted private') ||
          err.message.includes('passphrase') ||
          err.message.includes('integrity check failed') ||
          err.message.includes('authentication failed') ||
          err.message.includes('USERAUTH_FAILURE') ||
          err.message.includes('All configured authentication methods failed');

        if (isAuthError && options?.isInteractive !== false) {
          const credentialLabel = this.config.keyPath ? 'SSH Key Passphrase' : 'SSH Password';
          const pass = await password({
            message: `Enter ${credentialLabel} for ${this.config.username}@${this.config.host}:`,
          });
          if (isCancel(pass)) throw new Error('SSH Credential entry cancelled.');
          passphraseAttempt = pass as string;
          attempts++;
        } else {
          throw err;
        }
      }
    }

    if (!connected && lastErr) {
      throw lastErr;
    }
  }

  private prepareEnvCommand(cmd: string): string {
    const envPrefix = [
      '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"',
      '[ -s "$HOME/.profile" ] && . "$HOME/.profile"',
      '[ -s "$HOME/.bashrc" ] && . "$HOME/.bashrc"',
      'export PATH=$PATH:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$HOME/.fnm/current/bin:$HOME/.n/bin:/usr/local/bin',
    ].join('; ');

    return `${envPrefix}; ${cmd}`;
  }

  public exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const fullCmd = this.prepareEnvCommand(command);
      this.client.exec(fullCmd, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number) => {
          resolve({ stdout, stderr, code });
        });
        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  public streamRemoteCommand(command: string, onLine?: (line: string) => void): Promise<number> {
    return new Promise((resolve, reject) => {
      const fullCmd = this.prepareEnvCommand(command);
      this.client.exec(fullCmd, { pty: true }, (err, stream) => {
        if (err) return reject(err);

        let stdoutBuf = '';
        let stderrBuf = '';

        stream.on('close', (code: number) => {
          if (stdoutBuf.length > 0 && onLine) {
            onLine(stdoutBuf);
          }
          if (stderrBuf.length > 0 && onLine) {
            onLine(`[STDERR] ${stderrBuf}`);
          }
          resolve(code);
        });

        stream.on('data', (data: Buffer) => {
          stdoutBuf += data.toString();
          const lines = stdoutBuf.split('\n');
          stdoutBuf = lines.pop() ?? '';
          for (const line of lines) {
            if (onLine) onLine(line);
          }
        });

        stream.stderr?.on('data', (data: Buffer) => {
          stderrBuf += data.toString();
          const lines = stderrBuf.split('\n');
          stderrBuf = lines.pop() ?? '';
          for (const line of lines) {
            if (onLine) onLine(`[STDERR] ${line}`);
          }
        });
      });
    });
  }

  public uploadFile(localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.fastPut(localPath, remotePath, (putErr) => {
          if (putErr) return reject(putErr);
          resolve();
        });
      });
    });
  }

  public close(): void {
    this.client.end();
  }
}
