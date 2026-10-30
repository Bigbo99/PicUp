import assert from 'node:assert/strict';
import { it } from 'node:test';
import { withJobWatchdog } from './job-watchdog';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

it('does not time out or duplicate consumers while the queue is idle', async () => {
  let calls = 0;
  let timeouts = 0;
  let finish!: () => void;
  const pending = withJobWatchdog(async () => {
    calls++;
    await new Promise<void>(resolve => { finish = resolve; });
    return null;
  }, 5, () => { timeouts++; });
  await pause(25);
  assert.equal(calls, 1);
  assert.equal(timeouts, 0);
  finish();
  await pending;
});

it('requests process termination for a stuck execution without abandoning it', async () => {
  let timeouts = 0;
  let finish!: () => void;
  const pending = withJobWatchdog(async started => {
    started();
    await new Promise<void>(resolve => { finish = resolve; });
    return 'done';
  }, 5, () => { timeouts++; });
  await pause(25);
  assert.equal(timeouts, 1);
  finish();
  assert.equal(await pending, 'done');
});

it('clears the watchdog when execution completes or fails', async () => {
  let timeouts = 0;
  await withJobWatchdog(async started => { started(); }, 5, () => { timeouts++; });
  await assert.rejects(withJobWatchdog(async started => {
    started();
    throw new Error('failed execution');
  }, 5, () => { timeouts++; }), /failed execution/);
  await pause(25);
  assert.equal(timeouts, 0);
});
