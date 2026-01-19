"use strict";
const WebSocket = require("ws");
const { mulawToPCM } = require("../utils/audio");
const { startEventTurn, startAudioTurn, closeTurn, getDfcxStream, isAudioTurn } = require("../utils/helper");
const JWT_SECRET = process.env.STREAM_JWT_SECRET;
const JWT_ISSUER = "relay-server";
const JWT_AUDIENCE = "twilio-stream";
const jwt = require("jsonwebtoken");


module.exports = function (server) {
  // const wss = new WebSocket.Server({ server, path: "/streaming" });
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    console.log('inside upgrading server', req.url, req.headers);
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
          token = json.start.customParameters.token;
          if (!token) {
            console.error("Missing token");
            ws.close(1008, "Missing auth token"); // Policy violation
            return;
          }
          try {
            const decodedJWT = jwt.verify(token, JWT_SECRET, {
              algorithms: ["HS256"],
              issuer: JWT_ISSUER,
              audience: JWT_AUDIENCE,
              clockTolerance: 5,
            });
            console.log(decodedJWT)
            //  if(decodedJWT)
            // req.user = payload; // attach claims
            next();
          } catch (err) {
            return res.status(401).json({
              message: "Invalid or expired token",
            });
          }
          // Start the conversation with a welcome event
          startEventTurn("media", callSid, streamSid, ws);
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
          closeTurn();
          break;
      }
    });

    ws.on("close", () => closeTurn());
  });
};