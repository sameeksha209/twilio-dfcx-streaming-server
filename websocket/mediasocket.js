
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

//     ws.on("message", (msg) => {
//       let json;
//       try {
//         json = JSON.parse(msg);
//       } catch (err) {
//         console.error("❌ Invalid JSON from Twilio");
//         return;
//       }

//       /* ---------------- 1. START EVENT ---------------- */
//       if (json.event === "start") {
//         callSid = json.start?.callSid;
//         streamSid = json.streamSid;

//         console.log(`🚀 Session Started | CallSid: ${callSid}`);

//         const sessionPath = createSessionPath(callSid);

//         // Initialize bi-directional Dialogflow stream
//         dfcxStream = sessionClient.streamingDetectIntent();

//         dfcxStream.on("error", (err) => {
//           console.error(`❌ DFCX [${callSid}] Error:`, err.message);
//         });

//         dfcxStream.on("data", (data) => {
//           // 1️⃣ Log transcript
//           if (data.recognitionResult) {
//             console.log(
//               `🎤 [${callSid}] Heard: "${data.recognitionResult.transcript}" (Final: ${data.recognitionResult.isFinal})`
//             );
//           }

//           // 2️⃣ Send audio back to Twilio
//           const outputAudio = data.detectIntentResponse?.outputAudio;
//           if (outputAudio?.length) {
//             console.log("🔊 Sending audio to Twilio...");

//             const wav = new WaveFile(outputAudio);
//             wav.toMuLaw();
//             const mulaw = Buffer.from(wav.getSamples());

//             const FRAME_SIZE = 160; // 20ms per frame
//             let offset = 0;

//             // Stream audio in real-time using setInterval
//             const interval = setInterval(() => {
//               if (offset >= mulaw.length) {
//                 clearInterval(interval);
//                 return;
//               }

//               const chunk = mulaw.slice(offset, offset + FRAME_SIZE);
//               offset += FRAME_SIZE;

//               ws.send(
//                 JSON.stringify({
//                   event: "media",
//                   streamSid,
//                   media: { payload: chunk.toString("base64") },
//                 })
//               );
//             }, 20); // 20ms per frame
//           }

//           // 3️⃣ Log agent text responses
//           const responses = data.detectIntentResponse?.queryResult?.responseMessages;
//           if (responses) {
//             responses.forEach((res) => {
//               if (res.text) {
//                 console.log(`🤖 [${callSid}] Agent:`, res.text.text.join(" "));
//               }
//             });
//           }
//         });

//         // Send initial configuration to Dialogflow
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
//             audioEncoding: "OUTPUT_AUDIO_ENCODING_LINEAR_16",
//             sampleRateHertz: 8000,
//             voice: { name: "en-US-Standard-C" },
//           },
//         });

//         console.log("✅ Dialogflow stream initialized");
//         return;
//       }

//       /* ---------------- 2. MEDIA EVENT ---------------- */
//       if (json.event === "media") {
//         if (!json.media?.payload) {
//           console.warn("⚠️ Media event without payload, skipping");
//           return;
//         }

//         const mulawBytes = Buffer.from(json.media.payload, "base64");
//         const pcmBuffer = mulawToPCM(mulawBytes);

//         if (!pcmBuffer?.length) return;

//         // Send user audio to Dialogflow
//         dfcxStream.write({
//           queryInput: {
//             audio: { audio: pcmBuffer },
//           },
//         });

//         // console.log("✅ User audio sent to Dialogflow");
//         return;
//       }

//       /* ---------------- 3. STOP EVENT ---------------- */
//       if (json.event === "stop") {
//         console.log(`🛑 Call Ended | CallSid: ${callSid}`);
//         if (dfcxStream) {
//           dfcxStream.end();
//           dfcxStream = null;
//         }
//       }
//     });

//     ws.on("close", () => {
//       console.log(`🔌 WebSocket Closed | CallSid: ${callSid}`);
//       if (dfcxStream) {
//         dfcxStream.end();
//       }
//     });
//   });
// };

"use strict";

const WebSocket = require("ws");
const { sessionClient, createSessionPath } = require("../dfcx/client");
const { mulawToPCM } = require("../utils/audio");
const { WaveFile } = require("wavefile");

module.exports = function (server) {
  const wss = new WebSocket.Server({ server, path: "/streaming" });

  wss.on("connection", (ws) => {
    console.log("✅ Twilio WebSocket connected");

    let callSid = null;
    let streamSid = null;
    let dfcxStream = null;
let packetCount = 0;
    ws.on("message", (msg) => {
      let json;
      try {
        json = JSON.parse(msg);
      } catch (err) {
        console.error("❌ Invalid JSON from Twilio");
        return;
      }

      console.log('inputs events ---', json.event)

      /* ---------------- 1. START EVENT ---------------- */
      if (json.event === "start") {
        callSid = json.start?.callSid;
        streamSid = json.streamSid;
        console.log(`🚀 Session Started | CallSid: ${callSid}`);

        const sessionPath = createSessionPath(callSid);

        // Initialize bi-directional Dialogflow stream
        dfcxStream = sessionClient.streamingDetectIntent();

        dfcxStream.on("error", (err) => {
          console.error(`❌ DFCX [${callSid}] Error:`, err.message);
        });

        dfcxStream.on("data", (data) => {
          // 1️⃣ Log transcript
          if (data.recognitionResult) {
            console.log(
              `🎤 [${callSid}] Heard: "${data.recognitionResult.transcript}" (Final: ${data.recognitionResult.isFinal})`
            );
          }

          // 2️⃣ Send audio back to Twilio **immediately**
          const outputAudio = data.detectIntentResponse?.outputAudio;
          if (outputAudio?.length && ws.readyState === WebSocket.OPEN) {
            const wav = new WaveFile(outputAudio);
            wav.toMuLaw();
            const mulaw = Buffer.from(wav.getSamples());
            const FRAME_SIZE = 160; // 20ms per frame
            let offset = 0;

            while (offset < mulaw.length) {
              const chunk = mulaw.slice(offset, offset + FRAME_SIZE);
              offset += FRAME_SIZE;

              ws.send(
                JSON.stringify({
                  event: "media",
                  streamSid,
                  media: { payload: chunk.toString("base64") },
                })
              );
            }
          }
          console.log('sending event back to twilio');

          // 3️⃣ Log agent text responses
          const responses = data.detectIntentResponse?.queryResult?.responseMessages;
          if (responses) {
            responses.forEach((res) => {
              if (res.text) {
                console.log(`🤖 [${callSid}] Agent:`, res.text.text.join(" "));
              }
            });
          }
        });

        // Send initial configuration to Dialogflow
        dfcxStream.write({
          session: sessionPath,
          queryInput: {
            audio: {
              config: {
                audioEncoding: "AUDIO_ENCODING_LINEAR_16",
                singleUtterance: false,
                sampleRateHertz: 8000,
              },
            },
            languageCode: "en-US",
          },
          outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
            voice: { name: "en-US-Standard-C" },
          },
        });

        console.log("✅ Dialogflow stream initialized");
        return;
      }

      /* ---------------- 2. MEDIA EVENT ---------------- */
      if (json.event === "media") {
        if (!json.media?.payload) return;
        packetCount++;
        
        // Only log once every 50 packets (approx. once per second)
        if (packetCount % 50 === 0) {
            console.log(`Streaming: Received ${packetCount} audio packets...`);
        }
        const mulawBytes = Buffer.from(json.media.payload, "base64");
        const pcmBuffer = mulawToPCM(mulawBytes);
        if (!pcmBuffer?.length) return;

        // Send user audio to Dialogflow
        dfcxStream.write({
          queryInput: { audio: { audio: pcmBuffer } },
        });
        return;
      }

      /* ---------------- 3. STOP EVENT ---------------- */
      if (json.event === "stop") {
        console.log(`🛑 Call Ended | CallSid: ${callSid}`);
        if (dfcxStream) {
          dfcxStream.end();
          dfcxStream = null;
        }
      }
    });

    ws.on("close", () => {
      console.log(`🔌 WebSocket Closed | CallSid: ${callSid}`);
      if (dfcxStream) dfcxStream.end();
    });
  });
};

