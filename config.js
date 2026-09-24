require('dotenv').config();

module.exports = {
  freshdesk: {
    domain: process.env.FRESHDESK_DOMAIN,
    apiKey: process.env.FRESHDESK_API_KEY,
  },
  pagerduty: {
    apiKey: process.env.PAGERDUTY_API_KEY, // REST API v2 token
    serviceId: process.env.PAGERDUTY_SERVICE_ID, // target service to create incidents on
    fromEmail: process.env.PAGERDUTY_FROM_EMAIL, // must be a real user on the PD account
    urgency: process.env.PAGERDUTY_URGENCY || 'high', // 'high' or 'low'
  },
  condition: {
    field: process.env.CONDITION_FIELD || 'cf_firstresponses_overdue',
    value: process.env.CONDITION_VALUE || 'Yes',
  },
  poll: {
    intervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES || 5),
    lookbackMinutes: Number(process.env.POLL_LOOKBACK_MINUTES || 60),
    secret: process.env.POLL_SECRET || '',
    requestTimeoutMs: Number(process.env.POLL_REQUEST_TIMEOUT_MS || 30000),
  },
  port: process.env.PORT || 4000,
};