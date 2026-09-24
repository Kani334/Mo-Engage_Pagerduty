const axios = require('axios');
const https = require('https');
const config = require('../config');

// Force a modern, widely-compatible TLS version. Node's default negotiation
// can fail ("SSL alert number 40 / handshake failure") against some servers
// or through some corporate proxies/antivirus that intercept HTTPS.
const httpsAgent = new https.Agent({
  minVersion: 'TLSv1.2',
});

const freshdeskDomain = config.freshdesk.domain
  .trim()
  .replace(/^https?:\/\//i, '')
  .replace(/\/.*$/, '')
  .replace(/\.freshdesk\.com$/i, '');

const client = axios.create({
  baseURL: `https://${freshdeskDomain}.freshdesk.com/api/v2`,
  auth: { username: config.freshdesk.apiKey, password: 'X' },
  headers: { 'Content-Type': 'application/json' },
  httpsAgent,
});

/**
 * Fetch all tickets updated since a given ISO timestamp (handles pagination).
 * The ticket object returned by Freshdesk includes a `custom_fields` map,
 * which is what we inspect for the trigger condition.
 */
async function getUpdatedTickets(sinceISO) {
  let page = 1;
  const perPage = 100;
  const all = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data } = await client.get('/tickets', {
      params: {
        updated_since: sinceISO,
        order_by: 'updated_at',
        order_type: 'asc',
        per_page: perPage,
        page,
      },
    });

    all.push(...data);

    if (data.length < perPage) break;
    page += 1;
  }

  return all;
}

async function addPrivateNote(ticketId, bodyHtml) {
  await client.post(`/tickets/${ticketId}/notes`, {
    body: bodyHtml,
    private: true,
  });
}

async function getTicketConversations(ticketId) {
  let page = 1;
  const all = [];

  while (true) {
    const { data } = await client.get(`/tickets/${ticketId}/conversations`, {
      params: { page },
    });
    all.push(...data);
    if (data.length < 30) break;
    page += 1;
  }

  return all;
}

function ticketUrl(ticketId) {
  return `https://${freshdeskDomain}.freshdesk.com/a/tickets/${ticketId}`;
}

module.exports = { getUpdatedTickets, addPrivateNote, getTicketConversations, ticketUrl };