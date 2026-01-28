"use strict";
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { mulawToPCM } = require("../utils/audio");
const {
  startAudioTurn,
  startEventTurn,
  closeTurn,
  getDfcxStream,
  isAudioTurn,
} = require("../utils/helper");

const {
  JWT_SECRET,
  JWT_ISSUER,
  JWT_AUDIENCE,
} = process.env;

module.exports = function (server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const pathname = req.url.split("?")[0];

    if (pathname === "/streaming") {
      console.log(`[WS] Handling WebSocket upgrade: ${req.url}`);
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      console.warn(`[WS] Invalid upgrade path: ${req.url}, destroying socket`);
      socket.destroy();
    }
  });

  wss.on("connection", (ws, req) => {
    let callSid, streamSid;

    // Per-call state
    ws.callState = {
      dfcxStream: null,
      activeTurn: null,
      turnClosed: false,
      streamEnded: false,
    };
    ws.isAuthenticated = false;

    ws.on("message", (msg) => {
      let json;
      try {
        json = JSON.parse(msg);
      } catch (err) {
        console.error("[WS] Invalid JSON received", err.message);
        return;
      }

      switch (json.event) {
        case "start": {
          console.log('json start event: ', JSON.stringify(json.start));
          callSid = json.start.callSid;
          streamSid = json.start.streamSid;

          const token = json.start.customParameters?.token;
          if (!token) {
            console.error(`[${callSid}] ❌ Missing JWT token`);
            ws.close(1008, "Missing auth token");
            return;
          }

          let decodedJWT;
          try {
            decodedJWT = jwt.verify(token, JWT_SECRET, {
              algorithms: ["HS256"],
              issuer: JWT_ISSUER,
              audience: JWT_AUDIENCE,
            });

            if (decodedJWT.callSid !== callSid) {
              console.error(
                `[${callSid}] ❌ JWT callSid mismatch, token callSid: ${decodedJWT.callSid}`
              );
              ws.close(1008, "Token does not match call");
              return;
            }

            ws.user = decodedJWT;
            ws.isAuthenticated = true;
            console.log(`[${callSid}] ✅ JWT verified, connection authenticated`);
          } catch (err) {
            console.error(`[${callSid}] ❌ JWT verification failed: ${err.message}`);
            ws.close(1008, "Invalid or expired token");
            return;
          }

          ws.customData = {
            ani: json.start.customParameters?.ani,
            dnis: json.start.customParameters?.dnis,
            language: json.start.customParameters?.language,
          };

          console.log(`[${callSid}] Call started, custom data:`, ws.customData);

          // Start welcome / greeting
          startEventTurn("media", callSid, streamSid, ws);
          break;
        }

        case "media": {
          if (!ws.isAuthenticated) return;
          if (ws.callState.streamEnded) return;

          if (!getDfcxStream(ws.callState)) {
            //console.log(`[${callSid}] Starting audio turn`);
            startAudioTurn(callSid, streamSid, ws);
          }

          const stream = getDfcxStream(ws.callState);
          if (isAudioTurn(ws.callState) && stream) {
            const pcm = mulawToPCM(Buffer.from(json.media.payload, "base64"));
            if (pcm) {
              stream.write({ queryInput: { audio: { audio: pcm } } });
              console.log(
                `[${callSid}] Forwarded PCM audio to Dialogflow CX, length: ${pcm.length}`
              );
            }
          }
          break;
        }

        case "dtmf": {
          if (!ws.isAuthenticated) return;
          console.log(`[${callSid}] Received DTMF input: ${json.dtmf.digit}`);
          closeTurn(ws.callState);
          startEventTurn(`DTMF_${json.dtmf.digit}`, callSid, streamSid, ws);
          break;
        }

        case "stop": {
          if (!ws.isAuthenticated) return;
          console.log(`[${callSid}] 🛑 Received stop event, closing turn`);
          ws.callState.streamEnded = true;
          closeTurn(ws.callState);

          if (ws.readyState === ws.OPEN) {
            ws.close(1000, "Twilio stream ended");
          }
          break;
        }

        default: {
          console.warn(`[${callSid || "N/A"}] ⚠ Unknown event received: ${json.event}`);
        }
      }
    });

    ws.on("close", (code, reason) => {
      console.log(`[${callSid || "N/A"}] 🔌 WS closed, code: ${code}, reason: ${reason}`);
      closeTurn(ws.callState);
    });

    ws.on("error", (err) => {
      console.error(`[${callSid || "N/A"}] WS error`, err.message);
      closeTurn(ws.callState);
    });
  });

  console.log("[WS] WebSocket server initialized for /streaming");
};
