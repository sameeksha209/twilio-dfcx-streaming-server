"use strict";
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const twilio = require('twilio'); // [AUTH] Twilio SDK — used for X-Twilio-Signature validation on WebSocket upgrade
const { mulawToPCM } = require("../utils/audio");
const { startEventTurn, startAudioTurn, closeTurn } = require("../utils/helper");

// [AUTH] TWILIO_AUTH_TOKEN: Twilio Account Auth Token for signature validation.
//        Server B validates all upgrade requests originate from Twilio.
//        Required — server exits at startup if not set.
const { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE, TWILIO_AUTH_TOKEN } = process.env;

// [AUTH] Fail fast — TWILIO_AUTH_TOKEN is required for X-Twilio-Signature validation
if (!TWILIO_AUTH_TOKEN) {
  console.error("[AUTH] FATAL: TWILIO_AUTH_TOKEN environment variable is not set. Server B requires this to validate X-Twilio-Signature on WebSocket upgrade requests.");
  process.exit(1);
}

module.exports = function (server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    console.log("--- TWILIO INBOUND CHECK ---");
    console.log({
      method: req.method,
      url: req.url,
      headers: req.headers,
      signatureHeader: req.headers['x-twilio-signature']
    });
    const pathname = req.url.split('?')[0];

    // [AUTH] Layer 0 — Path validation
    if (pathname !== "/streaming") {
      console.warn(`[HTTP] Unauthorized upgrade path: ${pathname}`);
      socket.destroy();
      return;
    }

    console.log(`[HTTP] 🟢 Upgrade request for ${pathname}`);

    // [AUTH] Layer 1 — X-Twilio-Signature validation
    const signature = req.headers['x-twilio-signature'];

    if (!signature) {
      console.error("[AUTH] Missing X-Twilio-Signature header — rejecting upgrade");
      socket.destroy();
      return;
    }

    // Reconstruct the public URL (Cloud Run terminates TLS)
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const urlHTTPS = `${proto}://${req.headers.host}${req.url}`;
    const urlWSS = `wss://${req.headers.host}${req.url}`;

    // Try exact URL first, then trailing-slash variant (Twilio quirk)
    const valid = twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, urlHTTPS, {})
      || twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, urlWSS, {});

    if (!valid) {
      console.error(`[AUTH] X-Twilio-Signature validation failed for ${url}`);
      socket.destroy();
      return;
    }

    console.log("[AUTH] X-Twilio-Signature validated");

    // Upgrade to WebSocket (JWT validation happens on 'start' event — Layer 2)
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    // Initial state setup
    ws.dfcxStream = null;
    ws.activeTurn = null;
    ws.callSid = "PENDING"; // Default until 'start' event

    console.log("🟢 [WS] Connection established");

    ws.on("message", (msg) => {
      let json;
      try {
        json = JSON.parse(msg);
      } catch (err) {
        console.error(`[WS] ❌ JSON Parse Error: ${err.message}`);
        return;
      }

      switch (json.event) {
        case "start":
          console.log(`🚀STREAM_START | JSON: ${JSON.stringify(json.start)}`);
          ws.callSid = json.start.callSid;
          ws.streamSid = json.start.streamSid;
          ws.stopInProgress = false; //for agentHandoff
          const token = json.start.customParameters?.token;
          if (!token) {
            console.error(`❌ [${ws.callSid}] AUTH_ERROR: Token missing in customParameters`);
            ws.close(1008, "Missing auth token");
            return;
          }

          try {
            const decodedJWT = jwt.verify(token, JWT_SECRET, {
              algorithms: ["HS256"],
              issuer: JWT_ISSUER,
              audience: JWT_AUDIENCE,
            });

            if (decodedJWT.callSid !== ws.callSid) {
              console.error(`❌ [${ws.callSid}] AUTH_ERROR: Token callSid mismatch`);
              ws.close(1008, "Token does not match call");
              return;
            }

            ws.user = decodedJWT;
            ws.customData = {
              ani: json.start.customParameters?.ani,
              dnis: json.start.customParameters?.dnis,
              language: json.start.customParameters?.language,
              token
            };

            console.log(`✅ [${ws.callSid}] AUTH_SUCCESS | Welcome event triggered`);
            startEventTurn("welcome", ws);

          } catch (err) {
            console.error(`❌ [${ws.callSid}] AUTH_INVALID: ${err.message}`);
            ws.close(1008, "Invalid or Expired Token");
          }
          break;

        case "media":
          //Don't process media if the call isn't fully authenticated yet
          if (ws.callSid === "PENDING" || ws.stopInProgress) return;

          if (!ws.dfcxStream) {
            console.log(`🎙️ [${ws.callSid}] AUDIO_START: Creating DFCX stream`);
            startAudioTurn(ws);
          }

          if (ws.activeTurn === "AUDIO" && ws.dfcxStream) {
            const pcm = mulawToPCM(Buffer.from(json.media.payload, "base64"));
            if (pcm) {
              ws.dfcxStream.write({ queryInput: { audio: { audio: pcm } } });
            }
          }
          break;

        case "dtmf":
          console.log(`🔢 [${ws.callSid}] DTMF: ${json.dtmf.digit}`);
          closeTurn(ws);
          startEventTurn(`DTMF_${json.dtmf.digit}`, ws);
          break;

        case "mark":
          console.log(`📍 [${ws.callSid}] MARK: "${json.mark.name}"`);
          break;

        case "stop":
          console.log(`⏹️ [${ws.callSid}] STREAM_STOP: Twilio ended the stream`);
          closeTurn(ws);
          break;
      }
    });

    ws.on("close", (code, reason) => {
      console.log(`🔴 [${ws.callSid}] WS_CLOSED | Code: ${code}`);
      closeTurn(ws);
    });

    ws.on("error", (err) => {
      console.error(`⚠️ [${ws.callSid}] WS_ERROR:`, err.message);
      closeTurn(ws);
    });
  });
};