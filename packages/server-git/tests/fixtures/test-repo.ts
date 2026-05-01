import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class TestRepository {
  constructor(public path: string) {}

  static async create(): Promise<TestRepository> {
    const path = await mkdtemp(join(tmpdir(), 'git-test-'));
    await execFileAsync('git', ['init'], { cwd: path });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: path });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: path });
    return new TestRepository(path);
  }

  async writeFile(name: string, content: string): Promise<void> {
    const filePath = join(this.path, name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  async commit(message: string): Promise<void> {
    await execFileAsync('git', ['add', '-A'], { cwd: this.path });
    await execFileAsync('git', ['commit', '-m', message], { cwd: this.path });
  }

  async createBranch(name: string): Promise<void> {
    await execFileAsync('git', ['branch', name], { cwd: this.path });
  }

  async cleanup(): Promise<void> {
    await rm(this.path, { recursive: true, force: true });
  }
}