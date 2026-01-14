"use strict";

const WebSocket = require("ws");
const { mulawToPCM } = require("../utils/audio");
const {
  startEventTurn,
  startAudioTurn,
  closeTurn,
  getDfcxStream,
  isAudioTurn,
  canWrite,
  startDtmfTurn
} = require("../utils/helper");

module.exports = function (server) {
  const wss = new WebSocket.Server({ server, path: "/streaming" });

  wss.on("connection", (ws) => {
    console.log("✅ Twilio WebSocket connected");

    let callSid;
    let streamSid;

    ws.on("message", (msg) => {
      let json;
      try {
        json = JSON.parse(msg);
      } catch { return; }

      /* ---- CALL START ---- */
      if (json.event === "start") {
        //console.log("JSON:: ", JSON.stringify(json, null, 2));
        callSid = json.start.callSid;
        streamSid = json.start.streamSid;
        console.log(`🚀 Call Started: ${callSid}`);

        // Trigger Welcome Greeting
        startEventTurn("media", callSid, streamSid, ws);
        return;
      }
      let audioTurnTimer = null;

      /* ---- AUDIO MEDIA ---- */
      if (json.event === "media") {
        // If nothing is happening, start a voice turn
        if (isAudioTurn() === false && getDfcxStream() === null) {
          if (!audioTurnTimer) {
            audioTurnTimer = setTimeout(() => {
              startAudioTurn(callSid, streamSid, ws);
              audioTurnTimer = null;
            }, 500); // 700–1200ms sweet spot
          }
        // }
        // startAudioTurn(callSid, streamSid, ws);
      }

      const currentStream = getDfcxStream();

      if (isAudioTurn() && canWrite() && currentStream) {
        const pcm = mulawToPCM(Buffer.from(json.media.payload, "base64"));
        if (pcm?.length) {
          try {
            currentStream.write({
              queryInput: { audio: { audio: pcm } },
            });
          } catch (e) {
            // This catch handles the rare millisecond overlap
          }
        }
      }
      return;
    }

      /* ---- DTMF ---- */
      if (json.event === "dtmf") {
      const digit = json.dtmf.digit;
      console.log(`🔢 Twilio Signal: ${digit}`);

      // 1. Immediately kill any current audio stream to free up the "Gate"
      closeTurn();

      // 2. Trigger the native DTMF turn
      //startDtmfTurn(digit, callSid, streamSid, ws);

      startDtmfTurn(digit, callSid, streamSid, ws);
      return;

    }

    /* ---- CALL END ---- */
    if (json.event === "stop") {
      console.log("📴 Call ended - Cleaning up");
      closeTurn();
    }
  });

  ws.on("close", () => {
    console.log("🔌 WebSocket closed");
    closeTurn();
  });
});
};