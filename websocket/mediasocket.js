"use strict";
const WebSocket = require("ws");
const { mulawToPCM } = require("../utils/audio");
const { startEventTurn, startAudioTurn, closeTurn, getDfcxStream, isAudioTurn } = require("../utils/helper");
const { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } = process.env;
const jwt = require("jsonwebtoken");


module.exports = function (server) {
  // const wss = new WebSocket.Server({ server, path: "/streaming" });
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    //console.log('inside upgrading server', req.url, req.headers);
    const pathname = req.url.split('?')[0];
    if (pathname === "/streaming") {
      console.log("Handling WebSocket upgrade...", req.url);
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      console.log('inside error connection', req.url)
      socket.destroy();
    }
  });
  wss.on("connection", (ws) => {
    let callSid, streamSid, token;

    ws.on("message", (msg) => {
      let json;
      try { json = JSON.parse(msg); } catch { return; }

      switch (json.event) {
        case "start":
          console.log('json start event ', json.start)
          callSid = json.start.callSid;
          streamSid = json.start.streamSid;
          token = json.start.customParameters?.token;
          if (!token) {
            console.error("Missing token");
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

            // Validate callSid
            if (decodedJWT.callSid !== callSid) {
              console.error("Token callSid mismatch");
              ws.close(1008, "Token does not match call");
              return;
            }

            // Save decoded JWT for later use
            ws.user = decodedJWT;
            const ani = json.start.customParameters?.ani;
            const dnis = json.start.customParameters?.dnis;
            const language = json.start.customParameters?.language;
            ws.customData = { ani, dnis, language };
            console.log('custom data: ', ws.customData);
            // Start the conversation with a welcome event
            startEventTurn("media", callSid, streamSid, ws);
          } catch (err) {
            console.error("JWT verification failed:", err.message);
            ws.close(1008, "Invalid or expired token");
            return;
          }

          break;

        case "media":
          // If no stream is active, start one
          if (!getDfcxStream()) {
            startAudioTurn(callSid, streamSid, ws);
          }

          // Forward PCM audio to Google
          const currentStream = getDfcxStream();
          if (isAudioTurn() && currentStream) {
            const pcm = mulawToPCM(Buffer.from(json.media.payload, "base64"));
            if (pcm) {
              currentStream.write({ queryInput: { audio: { audio: pcm } } });
            }
          }
          break;

        case "dtmf":
          closeTurn();
          startEventTurn(`DTMF_${json.dtmf.digit}`, callSid, streamSid, ws);
          break;

        case "stop":
          console.log('Stream stopped for Call SID:', json?.stop?.callSid);
          closeTurn();
          // Gracefully close WebSocket
          if (ws.readyState === ws.OPEN) {
            console.log('closing ws connection...')
            ws.close(1000, "Twilio stream stopped");
          }
          break;

      }
    });

    ws.on("close", () => closeTurn());
  });
};