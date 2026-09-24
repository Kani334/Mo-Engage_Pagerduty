const express = require('express');
const cron = require('node-cron');
const config = require('../config');
const { runPollCycle } = require('./poller');

const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(config.port, () => {
  console.log(`Freshdesk ⇄ PagerDuty integration listening on port ${config.port}`);
});

const cronExpression = `*/${config.poll.intervalMinutes} * * * *`;
console.log(`Polling Freshdesk every ${config.poll.intervalMinutes} minute(s)`);
console.log(`Polling with a ${config.poll.lookbackMinutes}-minute overlap window`);

cron.schedule(cronExpression, () => {
  runPollCycle().catch((err) => console.error('[poll] unexpected error:', err));
});

// Run once immediately on startup so you don't wait for the first interval.
runPollCycle().catch((err) => console.error('[poll] unexpected error:', err));
