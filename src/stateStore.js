const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');

function load() {
  if (!fs.existsSync(STATE_FILE)) {
    return { lastPollTime: null, processedTickets: {} };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function save(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

module.exports = { load, save };
