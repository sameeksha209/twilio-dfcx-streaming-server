// "use strict";

// const WebSocket = require("ws");
// const jwt = require("jsonwebtoken");
// const { sessionClient, createSessionPath } = require("../dfcx/client");
// const { mulawToPCM, pcmToMulaw } = require("../utils/audio");

// const JWT_SECRET = process.env.STREAM_JWT_SECRET;

// module.exports = function (server) {

//   const wss = new WebSocket.Server({
//     server,
//     path: "/streaming"
//   });
//   wss.on("connection", (ws) => {
//     console.log("✅ Twilio WebSocket connected");

//     let isAuthenticated = false;
//     let callSid = null;
//     let dfcxStream = null;
//     let isConfigSent = false;

//     ws.on("message", (msg) => {
//       let json;
//       try {
//         json = JSON.parse(msg);
//       } catch (err) {
//         console.error("❌ Invalid JSON from Twilio");
//         return;
//       }

//       /* ---------------- CONNECTED ---------------- */
//       if (json.event === "connected") {
//         console.log("🔗 Twilio connected");
//         return;
//       }

//       /* ---------------- START ---------------- */
//       if (json.event === "start") {
//         try {
//           // 🔐 OPTIONAL JWT AUTH (enable if needed)
//           // const token = json.start?.customParameters?.token;
//           // callSid = json.start?.callSid;
//           // if (!token) throw new Error("JWT missing");

//           // const decoded = jwt.verify(token, JWT_SECRET, {
//           //   issuer: "relay-server",
//           //   audience: "twilio-stream"
//           // });

//           // if (decoded.callSid !== callSid) {
//           //   throw new Error("CallSid mismatch");
//           // }

//           isAuthenticated = true;
//           callSid = json.start?.callSid;

//           console.log("🔐 Auth successful, CallSid:", callSid);

//           /* -------- Create CX streaming session -------- */
//           const sessionPath = createSessionPath();

//           dfcxStream = sessionClient
//             .streamingDetectIntent()
//             .on("error", (err) => {
//               console.error("❌ DFCX stream error:", err);
//             })
//             .on("data", (data) => {
//               console.log('inside data part,', data)
//               /* ---- Send synthesized audio back to Twilio ---- */
//               if (data.outputAudio?.length) {
//                 const mulaw = pcmToMulaw(data.outputAudio);

//                 ws.send(JSON.stringify({
//                   event: "media",
//                   media: {
//                     payload: Buffer.from(mulaw).toString("base64")
//                   }
//                 }));
//               }

//               /* ---- Optional: logs ---- */
//               const texts =
//                 data.detectIntentResponse?.textResponses?.textResponses;

//               if (texts?.length) {
//                 console.log(
//                   "🤖 DFCX:",
//                   texts.map(t => t.text).join(" | ")
//                 );
//               }
//             });

//           /* -------- MUST send audio config FIRST -------- */
//           dfcxStream.write({
//             session: sessionPath,
//             queryInput: {
//               audio: {
//                 config: {
//                   audioEncoding: "AUDIO_ENCODING_LINEAR_16",
//                   sampleRateHertz: 8000
//                 }
//               },
//               languageCode: "en"
//             },
//             outputAudioConfig: {
//               audioEncoding: "OUTPUT_AUDIO_ENCODING_LINEAR_16",
//               sampleRateHertz: 8000
//             }
//           });

//           isConfigSent = true;
//           return;
//         } catch (err) {
//           console.error("❌ Authentication failed:", err.message);
//           ws.close(4001, "Unauthorized");
//           return;
//         }
//       }

//       /* -------- BLOCK UNTIL AUTH -------- */
//       // if (!isAuthenticated || !dfcxStream || !isConfigSent) {
//       //   return;
//       // }

//       /* ---------------- MEDIA ---------------- */
//     if (json.event === "media") {
//   if (!json.media || !json.media.payload) {
//     console.warn("⚠️ Media event without payload, skipping");
//     return;
//   }
//     const mulawBytes = Buffer.from(json.media.payload, "base64");

//   const pcmBuffer = mulawToPCM(mulawBytes);


//   if (!pcmBuffer || !pcmBuffer.length) return;

//   // ✅ DO NOT wrap again
//   dfcxStream.write({
//     queryInput: {
//       audio: {
//         audio: pcmBuffer
//       }
//     }
//   });
//   return;
// }

//       /* ---------------- STOP ---------------- */
//       if (json.event === "stop") {
//         console.log("🛑 Call ended:", callSid);
//         ws.close();
//       }
//     });

//     ws.on("close", () => {
//       console.log("🔌 WebSocket closed:", callSid || "unknown");
//       if (dfcxStream) {
//         dfcxStream.end();
//         dfcxStream = null;
//       }
//     });

//     ws.on("error", (err) => {
//       console.error("❌ WebSocket error:", err);
//     });
//   });
// };

"use strict";

const WebSocket = require("ws");
const { sessionClient, createSessionPath } = require("../dfcx/client");
const { mulawToPCM, pcmToMulaw } = require("../utils/audio");

module.exports = function (server) {
  const wss = new WebSocket.Server({ server, path: "/streaming" });

  wss.on("connection", (ws) => {
    console.log("✅ Twilio WebSocket connected");

    let callSid = null;
    let streamSid = null;
    let dfcxStream = null;
    let isConfigSent = false;

    ws.on("message", (msg) => {
      let json;
      try {
        json = JSON.parse(msg);
      } catch (err) {
        console.error("❌ Invalid JSON from Twilio");
        return;
      }

      /* ---------------- 1. START EVENT ---------------- */
      if (json.event === "start") {
        callSid = json.start?.callSid;
        streamSid = json.streamSid; // Required to send audio back to Twilio
        
        console.log(`🚀 Session Started | CallSid: ${callSid}`);

        const sessionPath = createSessionPath(callSid);

        // A. Initialize the Bi-directional Stream
        dfcxStream = sessionClient.streamingDetectIntent();

        // B. Set up Listeners BEFORE writing config
        dfcxStream.on("error", (err) => {
          console.error(`❌ DFCX [${callSid}] Error:`, err.message);
        });

        dfcxStream.on("data", (data) => {
          console.log(data,'initial data')
          // Log Transcript (Interim/Final)
          if (data.recognitionResult) {
            console.log(`🎤 [${callSid}] Heard: "${data.recognitionResult.transcript}" (Final: ${data.recognitionResult.isFinal})`);
          }
           console.log('data output Audio',data.outputAudio, data.outputAudio?.length)
          // Send Audio Response back to Twilio
          if (data.outputAudio?.length) {
            console.log('inside sending event triggeri')
    ws.send(JSON.stringify({
      event: "media",
      streamSid: streamSid,
      media: { payload: pcmToMulaw(data.outputAudio).toString("base64") }
    }));
    console.log('event send')
  }

          // Log Agent Text Response
          const responses = data.detectIntentResponse?.queryResult?.responseMessages;
          if (responses) {
            responses.forEach(res => {
              if (res.text) console.log(`🤖 [${callSid}] Agent:`, res.text.text.join(" "));
            });
          }
        });

        // C. Send initial Configuration
        dfcxStream.write({
            session: sessionPath,
            queryInput: {
              audio: {
                config: {
                  audioEncoding: "AUDIO_ENCODING_LINEAR_16",
                  sampleRateHertz: 8000
                }
              },
              languageCode: "en"
            },
            outputAudioConfig: {
              audioEncoding: "OUTPUT_AUDIO_ENCODING_LINEAR_16",
              sampleRateHertz: 8000
            }
          });

          isConfigSent = true;
          return;
        }
      /* ---------------- 2. MEDIA EVENT ---------------- */
      if (json.event === "media") {
  if (!json.media || !json.media.payload) {
    console.warn("⚠️ Media event without payload, skipping");
    return;
  }
    const mulawBytes = Buffer.from(json.media.payload, "base64");

  const pcmBuffer = mulawToPCM(mulawBytes);


  if (!pcmBuffer || !pcmBuffer.length) return;

  // ✅ DO NOT wrap again
  dfcxStream.write({
    queryInput: {
      audio: {
        audio: pcmBuffer
      }
    }
  });
  console.log('stream written to dfcx')
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
      if (dfcxStream) {
        dfcxStream.end();
      }
    });
  });
};