const config = require('../config');
const freshdesk = require('./freshdeskClient');
const pagerduty = require('./pagerdutyClient');
const stateStore = require('./stateStore');

async function runPollCycle() {
  const state = stateStore.load();
  const pollStartedAt = new Date();
  const since =
    state.lastPollTime ||
    new Date(Date.now() - config.poll.intervalMinutes * 60000).toISOString();

  console.log(`[poll] checking tickets updated since ${since}`);

  let tickets;
  try {
    tickets = await freshdesk.getUpdatedTickets(since);
  } catch (err) {
    console.error('[poll] failed to fetch tickets from Freshdesk:', err.response?.data || err.message);
    return;
  }

  const fieldValues = tickets.reduce((values, ticket) => {
    const value = ticket.custom_fields?.[config.condition.field];
    const key = value == null ? '<empty>' : String(value);
    values[key] = (values[key] || 0) + 1;
    return values;
  }, {});
  console.log(
    `[poll] fetched ${tickets.length} ticket(s); ${config.condition.field} values: ${JSON.stringify(fieldValues)}`
  );

  let retryNeeded = false;

  for (const ticket of tickets) {
    const fieldValue = ticket.custom_fields?.[config.condition.field];
    const conditionMet = String(fieldValue ?? '').trim().toLowerCase() ===
      String(config.condition.value).trim().toLowerCase();
    const processedTicket = state.processedTickets[ticket.id];
    const alreadyProcessed = Boolean(processedTicket);

    if (conditionMet && (!alreadyProcessed || processedTicket.notePending)) {
      const handled = await handleTriggeredTicket(ticket, state, processedTicket);
      retryNeeded = retryNeeded || !handled;
    } else if (!conditionMet && alreadyProcessed) {
      // Field flipped back off — allow it to re-trigger if it becomes overdue again later.
      delete state.processedTickets[ticket.id];
    }
  }

  if (!retryNeeded) {
    state.lastPollTime = pollStartedAt.toISOString();
  }

  await syncProcessedIncidents(state);
  stateStore.save(state);
}

async function syncProcessedIncidents(state) {
  for (const [ticketId, processedTicket] of Object.entries(state.processedTickets)) {
    try {
      await syncIncident(ticketId, processedTicket, state);
    } catch (err) {
      console.error(
        `[poll] failed to sync PagerDuty/Freshdesk notes for ticket #${ticketId}:`,
        err.response?.data || err.message
      );
    }
  }
}

async function syncIncident(ticketId, processedTicket, state) {
  const incident = await pagerduty.getIncident(processedTicket.incidentId);
  const pagerDutyNotes = await pagerduty.getIncidentNotes(processedTicket.incidentId);
  const syncedPagerDutyNotes = new Set(processedTicket.pagerDutyNoteIds || []);
  const syncedFreshdeskNotes = new Set(processedTicket.freshdeskNoteIds || []);

  for (const note of pagerDutyNotes) {
    if (syncedPagerDutyNotes.has(note.id) || note.content.includes('[Freshdesk sync]')) continue;
    await freshdesk.addPrivateNote(
      ticketId,
      `<p><b>[PagerDuty sync]</b></p><p>${escapeHtml(note.content)}</p>`
    );
    syncedPagerDutyNotes.add(note.id);
  }

  const conversations = await freshdesk.getTicketConversations(ticketId);
  for (const conversation of conversations) {
    const body = conversation.body_text || conversation.body || '';
    if (
      conversation.private !== true ||
      !stripHtml(body) ||
      syncedFreshdeskNotes.has(String(conversation.id)) ||
      body.includes('[PagerDuty sync]') ||
      body.includes('PagerDuty incident created automatically')
    ) continue;

    await pagerduty.addIncidentNote(
      processedTicket.incidentId,
      `[Freshdesk sync] Ticket #${ticketId}\n${stripHtml(body)}`
    );
    console.log(
      `[poll] synced Freshdesk private note ${conversation.id} to PagerDuty incident ${processedTicket.incidentId}`
    );
    syncedFreshdeskNotes.add(String(conversation.id));
  }

  if (incident.status === 'resolved' && !processedTicket.resolvedNoted) {
    await freshdesk.addPrivateNote(
      ticketId,
      `<p><b>[PagerDuty sync]</b> PagerDuty incident <b>${incident.id}</b> was resolved.</p>`
    );
    processedTicket.resolvedNoted = true;
  }

  processedTicket.pagerDutyNoteIds = [...syncedPagerDutyNotes];
  processedTicket.freshdeskNoteIds = [...syncedFreshdeskNotes];
  state.processedTickets[ticketId] = processedTicket;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function handleTriggeredTicket(ticket, state, processedTicket) {
  const url = freshdesk.ticketUrl(ticket.id);

  const retryingNote = processedTicket?.notePending && processedTicket.incidentId;
  console.log(
    retryingNote
      ? `[poll] retrying private note for ticket #${ticket.id}`
      : `[poll] condition met for ticket #${ticket.id} — creating PagerDuty incident`
  );

  let incident;
  if (retryingNote) {
    incident = processedTicket.incident || await pagerduty.getIncident(processedTicket.incidentId);
  } else {
    try {
      incident = await pagerduty.createIncident({
        title: `First response overdue: Ticket #${ticket.id} — ${ticket.subject}`,
        details: [
          `Freshdesk ticket: ${url}`,
          `Subject: ${ticket.subject}`,
          `Status: ${ticket.status}`,
          `Priority: ${ticket.priority}`,
          `Requester ID: ${ticket.requester_id}`,
        ].join('\n'),
      });
    } catch (err) {
      console.error(
        `[poll] failed to create PagerDuty incident for ticket #${ticket.id}:`,
        err.response?.data || err.message
      );
      return false;
    }
  }

  const noteBody = buildNoteHtml({ ticket, incident });

  try {
    await freshdesk.addPrivateNote(ticket.id, noteBody);
  } catch (err) {
    console.error(
      `[poll] failed to add private note to ticket #${ticket.id}:`,
      err.response?.data || err.message
    );
    state.processedTickets[ticket.id] = {
      incidentId: incident.id,
      incidentNumber: incident.incident_number,
      incident,
      notePending: true,
      triggeredAt: processedTicket?.triggeredAt || new Date().toISOString(),
    };
    return false;
  }

  state.processedTickets[ticket.id] = {
    incidentId: incident.id,
    incidentNumber: incident.incident_number,
    triggeredAt: new Date().toISOString(),
  };
  return true;
}

function buildNoteHtml({ ticket, incident }) {
  return `
    <p><b>🔔 PagerDuty incident created automatically</b></p>
    <ul>
      <li><b>Incident:</b> <a href="${incident.html_url}">#${incident.incident_number}</a> (status: ${incident.status})</li>
      <li><b>Incident ID:</b> ${incident.id}</li>
      <li><b>Trigger:</b> Firstresponses Overdue = Yes on ticket #${ticket.id}</li>
      <li><b>Created at:</b> ${new Date().toISOString()}</li>
    </ul>
  `.trim();
}

module.exports = { runPollCycle };