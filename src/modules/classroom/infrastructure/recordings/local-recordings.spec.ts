import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SpoolFileMissingException } from '../../domain/recording.js';
import { LocalDiskRecordingStorage } from './local-disk-recording-storage.js';
import { LocalRecordingSpool } from './local-recording-spool.js';

const SECRET = 'x'.repeat(32);
const NOW = Date.UTC(2026, 9, 28, 15, 0);

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) {
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString();
}

describe('recordings on this server', () => {
  let dir: string;
  let spoolDir: string;
  let uploadsDir: string;
  let clock: number;
  const storage = () =>
    new LocalDiskRecordingStorage(uploadsDir, 'https://api.example.com', SECRET, () => clock);
  const tokenOf = (url: string) => url.slice('https://api.example.com/recordings/media/'.length);

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'recordings-'));
    spoolDir = path.join(dir, 'spool');
    uploadsDir = path.join(dir, 'uploads');
    await mkdir(path.join(spoolDir, 'session'), { recursive: true });
    await writeFile(path.join(spoolDir, 'session', 'a.mp4'), 'the class');
    clock = NOW;
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('read from the spool, stored, and the spool copy removed with its folder', async () => {
    const spool = new LocalRecordingSpool(spoolDir);
    const content = await spool.read('session/a.mp4');
    expect(content.sizeBytes).toBe(9);

    await storage().save('recordings/i/s/r.mp4', content);
    await spool.remove('session/a.mp4');

    expect(await readFile(path.join(uploadsDir, 'recordings/i/s/r.mp4'), 'utf8')).toBe('the class');
    expect(await readdir(spoolDir)).toEqual([]);
  });

  it('never read outside the spool, nor a file that is not there', async () => {
    const spool = new LocalRecordingSpool(spoolDir);
    await writeFile(path.join(dir, 'secret.mp4'), 'not a recording');

    for (const name of ['../secret.mp4', 'session/missing.mp4', 'session']) {
      await expect(spool.read(name)).rejects.toBeInstanceOf(SpoolFileMissingException);
    }
    await spool.remove('../secret.mp4');
    expect(await readFile(path.join(dir, 'secret.mp4'), 'utf8')).toBe('not a recording');
  });

  it('leave no file behind when a copy is cut short', async () => {
    const broken = (async function* () {
      yield Buffer.from('half');
      throw new Error('disk gone');
    })();

    await expect(storage().save('recordings/i/s/r.mp4', { sizeBytes: 9, chunks: broken })).rejects.toThrow('disk gone');

    expect(await readdir(path.join(uploadsDir, 'recordings/i/s'))).toEqual([]);
  });

  it('play through a signed link that names the file and how to serve it', async () => {
    const local = storage();
    await local.save('recordings/i/s/r.mp4', await new LocalRecordingSpool(spoolDir).read('session/a.mp4'));

    const url = await local.link('recordings/i/s/r.mp4', { fileName: 'clase.mp4', download: true, expiresInSeconds: 60 });

    expect(url.startsWith('https://api.example.com/recordings/media/')).toBe(true);
    const file = await local.resolve(tokenOf(url));
    expect(file).toEqual({ path: path.join(uploadsDir, 'recordings/i/s/r.mp4'), fileName: 'clase.mp4', download: true });
    expect(await collect((await new LocalRecordingSpool(uploadsDir).read('recordings/i/s/r.mp4')).chunks)).toBe('the class');
  });

  it('refuse a link that expired, was altered, or was signed with another secret', async () => {
    const local = storage();
    await local.save('recordings/i/s/r.mp4', await new LocalRecordingSpool(spoolDir).read('session/a.mp4'));
    const token = tokenOf(await local.link('recordings/i/s/r.mp4', { fileName: 'c.mp4', download: false, expiresInSeconds: 60 }));
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ key: '../../etc/passwd', name: 'x', download: false, exp: NOW / 1000 + 60 })).toString('base64url');
    const elsewhere = new LocalDiskRecordingStorage(uploadsDir, 'https://api.example.com', 'y'.repeat(32), () => clock);

    expect(await local.resolve(`${forged}.${signature}`)).toBeNull();
    expect(await local.resolve(payload)).toBeNull();
    expect(await local.resolve(token)).not.toBeNull();
    expect(await elsewhere.resolve(token)).toBeNull();
    clock = NOW + 61_000;
    expect(await local.resolve(token)).toBeNull();
  });
});
