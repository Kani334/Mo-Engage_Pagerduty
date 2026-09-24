const express = require('express');
const cron = require('node-cron');
const config = require('../config');
const { runPollCycle } = require('./poller');

const app = express();
let pollInProgress = false;

async function runPollSafely() {
  if (pollInProgress) {
    console.log('[poll] skipped because another poll is already running');
    return false;
  }

  pollInProgress = true;
  try {
    await runPollCycle();
    return true;
  } catch (err) {
    console.error('[poll] unexpected error:', err.stack || err.message);
    return false;
  } finally {
    pollInProgress = false;
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/poll', async (req, res) => {
  if (!config.poll.secret || req.get('x-poll-secret') !== config.poll.secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const completed = await runPollSafely();
  return res.status(completed ? 200 : 503).json({
    status: completed ? 'completed' : 'failed_or_in_progress',
    time: new Date().toISOString(),
  });
});

app.listen(config.port, () => {
  console.log(`Freshdesk ⇄ PagerDuty integration listening on port ${config.port}`);
});

const cronExpression = `*/${config.poll.intervalMinutes} * * * *`;
console.log(`Polling Freshdesk every ${config.poll.intervalMinutes} minute(s)`);
console.log(`Polling with a ${config.poll.lookbackMinutes}-minute overlap window`);

cron.schedule(cronExpression, () => {
  void runPollSafely();
});

// Run once immediately on startup so you don't wait for the first interval.
void runPollSafely();
