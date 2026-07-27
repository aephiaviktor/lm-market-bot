'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { appendBoundedJsonLine, readJsonlTail } = require('../dist/reliability-policy');

test('bounded JSONL rotates the active file before it exceeds its budget', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lm-log-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'events.jsonl');
  await appendBoundedJsonLine(file, { id: 1, text: 'x'.repeat(40) }, 80, 2);
  await appendBoundedJsonLine(file, { id: 2, text: 'y'.repeat(40) }, 80, 2);
  assert.match(await fs.readFile(file, 'utf8'), /"id":2/);
  assert.match(await fs.readFile(`${file}.1`, 'utf8'), /"id":1/);
});

test('JSONL tail reads only complete newest records and respects the entry cap', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lm-tail-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'events.jsonl');
  const lines = Array.from({ length: 20 }, (_, id) => JSON.stringify({ id, text: 'z'.repeat(20) })).join('\n') + '\n';
  await fs.writeFile(file, lines);
  const records = await readJsonlTail(file, 300, 3);
  assert.deepEqual(records.map((record) => record.id), [19, 18, 17]);
});
