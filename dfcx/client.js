const { SessionsClient } = require("@google-cloud/dialogflow-cx");

const projectId = process.env.GOOGLE_PROJECT_ID;
const location = process.env.GOOGLE_LOCATION;
const agentId = process.env.GOOGLE_AGENT_ID;

if (!projectId || !location || !agentId) {
  console.error("Missing required DFCX env vars");
  process.exit(1);
}

const sessionClient = new SessionsClient();

function createSessionPath() {
  return sessionClient.projectLocationAgentSessionPath(
    projectId,
    location,
    agentId,
    "twilio-relay-session-" + Date.now()
  );
}

module.exports = { sessionClient, createSessionPath };
