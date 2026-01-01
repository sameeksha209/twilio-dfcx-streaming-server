const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { sessionClient, createSessionPath } = require("../dfcx/client");
const { mulawToPCM, pcmToMulaw } = require("../utils/audio");

const JWT_SECRET = process.env.STREAM_JWT_SECRET;

module.exports = function (server) {
  const wss = new WebSocket.Server({ server, path: "/streaming" });
  
/*   wss.addEventListener("open", (event) => {
  wss.send("Hello Server!");
})
wss.addEventListener("error", (event) => { wss.send('error occured')}) */


  wss.on("connection", (ws, req) => {
    console.log("Twilio WebSocket connected:", req);

    let isAuthenticated = false;
    let callContext = {};
    let dfcxStream = null;

    ws.on("message", async (msg) => {
      try {
        const json = JSON.parse(msg);

        // 1️⃣ START EVENT → AUTHENTICATION
        if (json.event === "start") {
          try {
            const token = json.start.customParameters?.token;

            if (!token) {
              throw new Error("JWT missing");
            }

            const decoded = jwt.verify(token, JWT_SECRET, {
              issuer: "relay-server",
              audience: "twilio-stream"
            });

            // Optional hardening
            if (decoded.callSid !== json.start.callSid) {
              throw new Error("CallSid mismatch");
            }

            console.log("JWT validated:", decoded);

            isAuthenticated = true;
            callContext.callSid = decoded.callSid;

            // 2️⃣ Create DFCX stream ONLY after auth
            const sessionPath = createSessionPath();

            dfcxStream = sessionClient
              .streamingDetectIntent()
              .on("error", (err) => console.error("DFCX Error:", err))
              .on("data", (data) => {
                if (data.outputAudio) {
                  const mulawBytes = pcmToMulaw(data.outputAudio);
                  ws.send(mulawBytes);
                }

                if (data.detectIntentResponse?.textResponses) {
                  const texts = data.detectIntentResponse.textResponses.textResponses.map(
                    t => t.text
                  );
                  console.log("DFCX:", texts.join(" | "));
                }
              });

            // Start DFCX audio config
            dfcxStream.write({
              session: sessionPath,
              queryInput: {
                audioConfig: {
                  audioEncoding: "AUDIO_ENCODING_MULAW",
                  sampleRateHertz: 8000
                }
              }
            });

            return;
          } catch (err) {
            console.error("Authentication failed:", err.message);
            ws.close(4001, "Unauthorized");
            return;
          }
        }

        // 3️⃣ BLOCK everything until authenticated
        if (!isAuthenticated) {
          console.warn("Message before auth — closing WS");
          ws.close(4001, "Unauthorized");
          return;
        }

        // 4️⃣ MEDIA EVENT → AUDIO STREAMING
        if (json.event === "media") {
          const mulawBytes = Buffer.from(json.media.payload, "base64");
          const pcm = mulawToPCM(mulawBytes);

          dfcxStream.write({
            queryInput: {
              audio: Buffer.from(pcm.buffer)
            }
          });
        }

        // 5️⃣ STOP EVENT
        if (json.event === "stop") {
          console.log("Stream stopped:", callContext.callSid);
          ws.close();
        }

      } catch (err) {
        console.error("Invalid WS message:", err.message);
      }
    });
    
    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });

    ws.on("close", () => {
      console.log("WebSocket Closed:", callContext.callSid);
      if (dfcxStream) dfcxStream.end();
    });
  });
};
