import * as fs from 'fs/promises';

export async function appendBoundedJsonLine(
  filePath: string,
  value: unknown,
  maxBytes: number,
  retainedFiles: number,
): Promise<void> {
  const line = `${JSON.stringify(value)}\n`;
  const lineBytes = Buffer.byteLength(line);
  let currentBytes = 0;
  try {
    currentBytes = (await fs.stat(filePath)).size;
  } catch {
    // appendFile creates a missing active file.
  }

  if (currentBytes > 0 && currentBytes + lineBytes > maxBytes) {
    for (let index = retainedFiles; index >= 1; index -= 1) {
      const source = index === 1 ? filePath : `${filePath}.${index - 1}`;
      const destination = `${filePath}.${index}`;
      if (index === retainedFiles) await fs.rm(destination, { force: true });
      try {
        await fs.rename(source, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  await fs.appendFile(filePath, line, 'utf8');
}

export async function readJsonlTail(
  filePath: string,
  maxReadBytes: number,
  maxEntries: number,
): Promise<Record<string, unknown>[]> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, 'r');
    const { size } = await handle.stat();
    if (size === 0) return [];
    const length = Math.min(size, maxReadBytes);
    const start = size - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    const result: Record<string, unknown>[] = [];
    const lines = text.split('\n');
    for (let index = lines.length - 1; index >= 0 && result.length < maxEntries; index -= 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result.push(parsed);
      } catch {
        // Ignore truncated or malformed log lines.
      }
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  } finally {
    await handle?.close();
  }
}
