// const { WaveFile } = require("wavefile");
// const { sessionClient, createSessionPath } = require("../dfcx/client");
// // Global state for the current call session
// let dfcxStream = null;
// let activeTurn = null;
// let isEnding = false; // Guard to prevent 'write after end'

// /**
//  * Checks if the system is idle
//  */
// function canStartTurn() { return activeTurn === null; }
// /**
//  * Getter to share the stream with the main socket file
//  */
// function getDfcxStream() { return dfcxStream; }
// /**
//  * Getter to check if we are in Audio mode
//  */
// function isAudioTurn() { return activeTurn === "AUDIO"; }
// // New guard for mediasocket to check
// function canWrite() { return dfcxStream && !isEnding; }

// function startEventTurn(eventName, callSid, streamSid, ws) {
//     if (!canStartTurn()) return;
//     console.log(`🎯 EVENT TURN → ${eventName}`);
//     activeTurn = "EVENT";
//     isEnding = false;

//     dfcxStream = sessionClient.streamingDetectIntent();
//     attachDfcxHandlers(callSid, streamSid, ws);

//     dfcxStream.write({
//         session: createSessionPath(callSid),
//         queryInput: {
//             event: { event: eventName },
//             languageCode: "en-US",
//         },
//         outputAudioConfig: {
//             audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
//             sampleRateHertz: 8000,
//         },
//     });
//     dfcxStream.end();
// }

// function startAudioTurn(callSid, streamSid, ws) {
//     if (!canStartTurn()) return;
//     console.log("🎤 AUDIO TURN START");
//     activeTurn = "AUDIO";
//     isEnding = false;

//     dfcxStream = sessionClient.streamingDetectIntent();
//     attachDfcxHandlers(callSid, streamSid, ws);

//     dfcxStream.write({
//         session: createSessionPath(callSid),
//         queryInput: {
//             audio: {
//                 config: {
//                     audioEncoding: "AUDIO_ENCODING_LINEAR_16",
//                     sampleRateHertz: 8000,
//                     singleUtterance: true,
//                 },
//             },
//             languageCode: "en-US",
//         },
//         outputAudioConfig: {
//             audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
//             sampleRateHertz: 8000,
//         },
//     });
// }

// function startDtmfTurn(digit, callSid, streamSid, ws) {
//     if (!canStartTurn()) return;
//     console.log(`DTMF INPUT → "${digit}"`);
//     activeTurn = "DTMF";
//     isEnding = false;

//     dfcxStream = sessionClient.streamingDetectIntent();
//     attachDfcxHandlers(callSid, streamSid, ws);

//     const request = {
//         session: createSessionPath(callSid),
//         queryInput: {
//             dtmf: {
//                 digits: digit,
//                 transformed: true
//             },
//             languageCode: "en-US",
//         },
//         outputAudioConfig: {
//             audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
//             sampleRateHertz: 8000,
//         },
//     };

//     console.log("📤 Sending DTMF Payload:", JSON.stringify(request.queryInput.dtmf));
//     dfcxStream.write(request);
//     dfcxStream.end();
// }

// function closeTurn(callSid, streamSid, ws) {
//     isEnding = true;

//     if (dfcxStream && !dfcxStream.writableEnded) {
//         dfcxStream.end();
//     }

//     dfcxStream = null;
//     activeTurn = null;

//     console.log("🔁 Turn closed");

//     // 🟢 IMMEDIATELY re-arm listening
//     if (ws && ws.readyState === ws.OPEN) {
//         startAudioTurn(callSid, streamSid, ws);
//     }
// }


// function closeTurn() {
//     isEnding = true; // Stop any more writes immediately
//     if (dfcxStream) {
//         dfcxStream.end(); // destroy is safer than end() for race conditions
//         // dfcxStream = null;
//     }
//     activeTurn = null;
//     console.log("🔁 Turn closed");
// }

// // function attachDfcxHandlers(callSid, streamSid, ws) {
// //     if (!dfcxStream) return;

// //     dfcxStream.on("error", (err) => {
// //         if (err.message.includes("write after end")) return; // Ignore known race condition
// //         console.error("❌ DFCX Error:", err.message);
// //         closeTurn();
// //     });

// //     dfcxStream.on("data", (data) => {
// //         console.log('data',data)
// //         console.log(`🗣️ User: "${data?.recognitionResult?.transcript}"`);

// //         if (activeTurn === "AUDIO" && data.recognitionResult?.isFinal) {
// //             console.log(`🗣️ User: "${data.recognitionResult.transcript}"`);
// //             isEnding = true; // 🛑 BLOCK WRITES NOW
// //             dfcxStream.end();
// //         }

// //         const outputAudio = data.detectIntentResponse?.outputAudio;
// //         console.log('output audio', outputAudio);
// //         if (outputAudio?.length) {
// //             console.log("🔊 Bot is speaking...");
// //             sendAudioToTwilio(outputAudio, streamSid, ws);
// //             closeTurn();
// //         }
// //     });
// // }

// function attachDfcxHandlers(callSid, streamSid, ws) {
//     if (!dfcxStream) return;

//     dfcxStream.on("error", (err) => {
//         if (err.message.includes("write after end")) return;
//         console.error("❌ DFCX Error:", err.message);
//         closeTurn(callSid, streamSid, ws);
//     });

//     dfcxStream.on("data", (data) => {
//         console.log('data-----',data)
//         // 1. Handle Recognition Results
//         if (data.recognitionResult) {
//             const transcript = data?.recognitionResult?.transcript;
//             const isFinal = data?.recognitionResult?.isFinal;
//               console.log('transcript and isFinal', transcript,isFinal)
//             if (transcript) console.log(`🗣️ User: "${transcript}" ${isFinal ? '[FINAL]' : ''}`);

//             // if (isFinal && activeTurn === "AUDIO") {
//             //     // We've heard the user, stop sending more audio from Twilio
//             //     isEnding = true; 
//             //     // Don't close the turn yet; we need to wait for the bot's response!
//             // }
//         }

//         // 2. Handle the Bot's Response
//         if (data.detectIntentResponse) {
//             const outputAudio = data.detectIntentResponse.outputAudio;

//             if (outputAudio && outputAudio.length > 0) {
//                 console.log("🔊 Bot is speaking, sending to Twilio...");
//                 sendAudioToTwilio(outputAudio, streamSid, ws);

//                 // IMPORTANT: Only close the turn AFTER we have processed the bot's response
//                 setTimeout(() => {
//         closeTurn(callSid, streamSid, ws);
//     }, 50);
//             }
//         }
//     });
// }

// function sendAudioToTwilio(outputAudio, streamSid, ws) {
//     try {
//         const wav = new WaveFile(outputAudio);
//         wav.toMuLaw();
//         const mulaw = Buffer.from(wav.getSamples());

//         const FRAME_SIZE = 160; // Twilio standard chunk size
//         for (let i = 0; i < mulaw.length; i += FRAME_SIZE) {
//             ws.send(JSON.stringify({
//                 event: "media",
//                 streamSid,
//                 media: { payload: mulaw.slice(i, i + FRAME_SIZE).toString("base64") },
//             }));
//         }
//     } catch (e) {
//         console.error("❌ Audio conversion error:", e);
//     }
// }

// module.exports = {
//     startEventTurn, startAudioTurn, closeTurn, getDfcxStream, isAudioTurn, canStartTurn, canWrite, startDtmfTurn
// };

const { WaveFile } = require("wavefile");
const { sessionClient, createSessionPath } = require("../dfcx/client");
const twilio = require('twilio');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

let dfcxStream = null;
let activeTurn = null;

function getDfcxStream() { return dfcxStream; }
function isAudioTurn() { return activeTurn === "AUDIO"; }

function closeTurn() {
    if (dfcxStream) {
        dfcxStream.end();
        dfcxStream = null; // IMPORTANT: Must reset to null
    }
    activeTurn = null;
    console.log("🔁 Turn state reset");
}

function startAudioTurn(callSid, streamSid, ws) {
    if (dfcxStream) return; // Don't start if already running

    console.log("🎤 AUDIO TURN STARTING...");
    activeTurn = "AUDIO";
    dfcxStream = sessionClient.streamingDetectIntent();

    // 1. Send Initial Config
    dfcxStream.write({
        session: createSessionPath(callSid),
        queryInput: {
            audio: {
                config: {
                    audioEncoding: "AUDIO_ENCODING_LINEAR_16",
                    sampleRateHertz: 8000,
                    singleUtterance: true, // Stops listening after user pauses
                },
            },
            languageCode: "en-US",
        },
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
        },
    });

    // 2. Attach Handlers
    dfcxStream.on("error", (err) => {
        console.error("❌ DFCX Error:", err);
        closeTurn();
    });

    dfcxStream.on("data", (data) => {
        //console.log('inside data:', data);

        // Log partial transcripts to see if it's working in real-time
        if (data.recognitionResult) {
            console.log(`🗣️ Hearing: "${data.recognitionResult.transcript}" (Final: ${data.recognitionResult.isFinal})`);
        }

        const response = data.detectIntentResponse;
        if (response && response.outputAudio) {
            console.log("🔊 Sending Bot Response to Twilio");
            sendAudioToTwilio(response.outputAudio, streamSid, ws);
            // Note: We don't closeTurn here immediately if you want continuous convo, 
            // but for simple Request/Response, we reset after audio is sent.
            closeTurn();
        }
        if (response?.queryResult) {
            console.log('Intent:', response?.queryResult?.intent?.displayName);
            console.log('Parameters:', JSON.stringify(response?.queryResult?.parameters, null, 2));
            console.log('matchEvent:', response?.queryResult?.match?.event);
        }

        if (response?.queryResult?.responseMessages) {
            response.queryResult.responseMessages.forEach((msg, i) => {
                //console.log(`responseMessage[${i}] type:`, Object.keys(msg));
                /* if (msg.payload?.fields) {
                    const payload = {};

                    for (const [key, val] of Object.entries(msg.payload.fields)) {
                        payload[key] =
                            val.stringValue ??
                            val.numberValue ??
                            val.boolValue ??
                            null;
                    }

                    console.log(`CustomPayload[${i}]:`, JSON.stringify(payload));
                } */
                if (msg.liveAgentHandoff) {
                    console.log(`LiveAgentHandoff[${i}]:`, JSON.stringify(msg.liveAgentHandoff, null, 2));
                    console.log("☎️ Agent handoff requested");
                    closeTurn();

                    // 2. Stop Twilio Media Stream
                    ws.send(JSON.stringify({ event: "stop" }));

                    // 3. Redirect live call to agent (replace with your agent's phone number or client identity)
                    try {
                        twilioClient.calls(callSid).update({
                            twiml: `
<Response>
<Say>Please wait while I connect you to an agent.</Say>
<Dial>>+1555123456</Dial>
</Response>
                    `
                        });
                    } catch (err) {
                        console.error("Error updating Twilio call for handoff:", err);
                    }
                    return;
                }
            });
        }

    });
}

function startEventTurn(eventName, callSid, streamSid, ws) {
    activeTurn = "EVENT";
    dfcxStream = sessionClient.streamingDetectIntent();

    // Set up handlers before writing
    dfcxStream.on("data", (data) => {
        const response = data.detectIntentResponse;
        if (response && response.outputAudio) {
            sendAudioToTwilio(response.outputAudio, streamSid, ws);
            closeTurn();
        }
    });

    dfcxStream.write({
        session: createSessionPath(callSid),
        queryInput: { event: { event: eventName }, languageCode: "en-US" },
        outputAudioConfig: { audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW", sampleRateHertz: 8000 }
    });
}

function sendAudioToTwilio(outputAudio, streamSid, ws) {
    // Dialogflow returns raw Mu-Law if requested in outputAudioConfig
    // No need to use WaveFile to convert if encoding was set to MULAW
    const base64Audio = Buffer.from(outputAudio).toString("base64");

    ws.send(JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: base64Audio }
    }));
}

module.exports = { startEventTurn, startAudioTurn, closeTurn, getDfcxStream, isAudioTurn };

// const { WaveFile } = require("wavefile");
// const { sessionClient, createSessionPath } = require("../dfcx/client");

// // Global state for the current call session
// let dfcxStream = null;
// let activeTurn = null;

// /**
//  * Checks if the system is idle
//  */
// function canStartTurn() {
//     return activeTurn === null;
// }

// /**
//  * Getter to share the stream with the main socket file
//  */
// function getDfcxStream() {
//     return dfcxStream;
// }

// /**
//  * Getter to check if we are in Audio mode
//  */
// function isAudioTurn() {
//     return activeTurn === "AUDIO";
// }

// /**
//  * Triggers a Welcome or DTMF event
//  */
// function startEventTurn(eventName, callSid, streamSid, ws) {
//     if (!canStartTurn()) return;

//     console.log(`🎯 EVENT TURN → ${eventName}`);
//     activeTurn = "EVENT";

//     dfcxStream = sessionClient.streamingDetectIntent();
//     attachDfcxHandlers(callSid, streamSid, ws);

//     dfcxStream.write({
//         session: createSessionPath(callSid),
//         queryInput: {
//             event: { event: eventName },
//             languageCode: "en-US",
//         },
//         outputAudioConfig: {
//             audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
//             sampleRateHertz: 8000,
//         },
//     });

//     // Events are one-shot: end the request side immediately
//     dfcxStream.end();
// }

// /**
//  * Opens the pipe for human speech
//  */
// function startAudioTurn(callSid, streamSid, ws) {
//     if (!canStartTurn()) return;

//     console.log("🎤 AUDIO TURN START");
//     activeTurn = "AUDIO";

//     dfcxStream = sessionClient.streamingDetectIntent();
//     attachDfcxHandlers(callSid, streamSid, ws);

//     dfcxStream.write({
//         session: createSessionPath(callSid),
//         queryInput: {
//             audio: {
//                 config: {
//                     audioEncoding: "AUDIO_ENCODING_LINEAR_16",
//                     sampleRateHertz: 8000,
//                     singleUtterance: true,
//                 },
//             },
//             languageCode: "en-US",
//         },
//         outputAudioConfig: {
//             audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
//             sampleRateHertz: 8000,
//         },
//     });
// }

// /**
//  * Cleans up Google Stream and resets state
//  */
// function closeTurn() {
//     if (dfcxStream) {
//         dfcxStream.end();
//         //dfcxStream = null;
//     }
//     activeTurn = null;
//     console.log("🔁 Turn closed");
// }

// /**
//  * Listens to Google's response
//  */
// function attachDfcxHandlers(callSid, streamSid, ws) {
//     if (!dfcxStream) return;

//     dfcxStream.on("error", (err) => {
//         console.error("❌ DFCX Error:", err.message);
//         closeTurn();
//     });

//     dfcxStream.on("data", (data) => {
//        console.log('data ----',data)
//         // 1. Handle Speech Detection
//         if (activeTurn === "AUDIO" && data.recognitionResult?.isFinal) {
//             console.log(`🗣️ User said: "${data.recognitionResult.transcript}"`);
//             dfcxStream.end();
//         }

//         // 2. Handle Bot Audio Response
//         const outputAudio = data.detectIntentResponse?.outputAudio;
//         if (outputAudio?.length) {
//             console.log("🔊 Bot is speaking...");
//             sendAudioToTwilio(outputAudio, streamSid, ws);
//             closeTurn(); // Reset for next turn
//         }
//     });
// }

// /**
//  * Sends audio back to the phone
//  */
// function sendAudioToTwilio(outputAudio, streamSid, ws) {
//     try {
//         const wav = new WaveFile(outputAudio);
//         wav.toMuLaw();
//         const mulaw = Buffer.from(wav.getSamples());

//         const FRAME_SIZE = 160;
//         for (let i = 0; i < mulaw.length; i += FRAME_SIZE) {
//             ws.send(JSON.stringify({
//                 event: "media",
//                 streamSid,
//                 media: {
//                     payload: mulaw.slice(i, i + FRAME_SIZE).toString("base64"),
//                 },
//             }));
//         }
//     } catch (e) {
//         console.error("❌ Error sending audio:", e);
//     }
// }

// module.exports = {
//     startEventTurn,
//     startAudioTurn,
//     closeTurn,
//     getDfcxStream,
//     isAudioTurn,
//     canStartTurn
// };