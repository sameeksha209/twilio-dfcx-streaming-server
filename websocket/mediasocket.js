// "use strict";

// const WebSocket = require("ws");
// const { sessionClient, createSessionPath } = require("../dfcx/client");
// const { mulawToPCM } = require("../utils/audio");
// const { WaveFile } = require("wavefile");

// module.exports = function (server) {
//   const wss = new WebSocket.Server({ server, path: "/streaming" });

//   wss.on("connection", (ws) => {
//     console.log("✅ Twilio WebSocket connected");

//     let callSid = null;
//     let streamSid = null;
//     let dfcxStream = null;
//     let isReady = false; // 👈 NEW: Gate to prevent audio from clobbering the event

//     ws.on("message", (msg) => {
//       let json;
//       try {
//         json = JSON.parse(msg);
//       } catch (err) {
//         return;
//       }

//       /* ---------------- 1. START EVENT ---------------- */
//       if (json.event === "start") {
//         callSid = json.start?.callSid;
//         streamSid = json.start?.streamSid;
//         console.log(`🚀 Session Started | CallSid: ${callSid}`, streamSid);

//         const sessionPath = createSessionPath(callSid);
//         dfcxStream = sessionClient.streamingDetectIntent();

//         dfcxStream.on("error", (err) => {
//           console.error(`❌ DFCX Error:`, err.message);
//         });

//         dfcxStream.on("data", (data) => {
//            if (data.recognitionResult) {
//             console.log(
//               `🎤 [${callSid}] Heard: "${data.recognitionResult.transcript}" (Final: ${data.recognitionResult.isFinal})`
//             );
//           }
//           // Log if the event actually triggered
//           if (data.detectIntentResponse?.queryResult?.triggeredEvent) {
//              console.log("🎯 Event Triggered:", data.detectIntentResponse.queryResult.triggeredEvent);
//           }

//           const outputAudio = data.detectIntentResponse?.outputAudio;
//           if (outputAudio?.length && ws.readyState === WebSocket.OPEN) {
//             const wav = new WaveFile(outputAudio);
//             wav.toMuLaw();
//             const mulaw = Buffer.from(wav.getSamples());
//             const FRAME_SIZE = 160;
//             let offset = 0;

//             while (offset < mulaw.length) {
//               const chunk = mulaw.slice(offset, offset + FRAME_SIZE);
//               offset += FRAME_SIZE;
//               ws.send(JSON.stringify({
//                 event: "media",
//                 streamSid,
//                 media: { payload: chunk.toString("base64") },
//               }));
//             }
//           }
//         });

//         // 1. Send Config
//         dfcxStream.write({
//           session: sessionPath,
//           queryInput: {
//             audio: {
//               config: {
//                 audioEncoding: "AUDIO_ENCODING_LINEAR_16",
//                 singleUtterance: false,
//                 sampleRateHertz: 8000,
//               },
//             },
//             languageCode: "en-US",
//           },
//           outputAudioConfig: {
//             audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
//             sampleRateHertz: 8000,
//           },
//         });

//         // 2. Send Event
//         dfcxStream.write({
//           queryInput: { event: { event: "media" } }
//         });
//         console.log("✅ Config and media Event sent to DFCX");

//         // 3. Open the gate after a short delay
//         setTimeout(() => {
//           isReady = true;
//           console.log("🔓 Gate open: Now forwarding phone audio to DFCX");
//         }, 1200); 

//         return;
//       }

//       /* ---------------- 2. MEDIA EVENT ---------------- */
//       if (json.event === "media") {
//         // 👈 KEY FIX: If we aren't ready, don't send audio yet
//         if (!dfcxStream || !isReady) return; 

//         const mulawBytes = Buffer.from(json.media.payload, "base64");
//         const pcmBuffer = mulawToPCM(mulawBytes);

//         if (pcmBuffer?.length && dfcxStream.writable) {
//           dfcxStream.write({
//             queryInput: { audio: { audio: pcmBuffer } },
//           });
//         }
//         return;
//       }

//       /* ---------------- 3. STOP EVENT ---------------- */
//       if (json.event === "stop") {
//         if (dfcxStream) dfcxStream.end();
//       }
//     });

//     ws.on("close", () => {
//       if (dfcxStream) {
//         dfcxStream.destroy();
//         dfcxStream = null;
//       }
//     });
//   });
// };

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
        console.log("JSON:: ", JSON.stringify(json, null, 2));
        callSid = json.start.callSid;
        streamSid = json.start.streamSid;
        console.log(`🚀 Call Started: ${callSid}`);

        // Trigger Welcome Greeting
        startEventTurn("media", callSid, streamSid, ws);
        return;
      }

      /* ---- AUDIO MEDIA ---- */
      if (json.event === "media") {
        // If nothing is happening, start a voice turn
        if (isAudioTurn() === false && getDfcxStream() === null) {
          startAudioTurn(callSid, streamSid, ws);
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