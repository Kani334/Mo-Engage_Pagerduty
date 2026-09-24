const axios = require('axios');
const config = require('../config');

const restClient = axios.create({
  baseURL: 'https://api.pagerduty.com',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/vnd.pagerduty+json;version=2',
    Authorization: `Token token=${config.pagerduty.apiKey}`,
    From: config.pagerduty.fromEmail,
  },
});

/**
 * Create an incident directly on the configured service via the PagerDuty
 * REST API. Unlike the Events API, this returns the full incident object
 * (id, html_url, status) immediately — no polling needed.
 */
async function createIncident({ title, details, urgency }) {
  const { data } = await restClient.post('/incidents', {
    incident: {
      type: 'incident',
      title,
      service: {
        id: config.pagerduty.serviceId,
        type: 'service_reference',
      },
      urgency: urgency || config.pagerduty.urgency,
      body: {
        type: 'incident_body',
        details,
      },
    },
  });

  return data.incident; // { id, html_url, status, incident_number, ... }
}

async function getIncident(incidentId) {
  const { data } = await restClient.get(`/incidents/${incidentId}`);
  return data.incident;
}

async function getIncidentNotes(incidentId) {
  const { data } = await restClient.get(`/incidents/${incidentId}/notes`);
  return data.notes || [];
}

async function addIncidentNote(incidentId, content) {
  await restClient.post(`/incidents/${incidentId}/notes`, {
    note: { content },
  });
}

module.exports = { createIncident, getIncident, getIncidentNotes, addIncidentNote };