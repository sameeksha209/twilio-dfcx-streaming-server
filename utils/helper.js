const { WaveFile } = require("wavefile");
const { sessionClient, createSessionPath } = require("../dfcx/client");
const twilio = require('twilio');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const axios = require('axios');

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


// function startAudioTurn(callSid, streamSid, ws) {
//     if (dfcxStream) return; // Don't start if already running

//     console.log("🎤 AUDIO TURN STARTING...");
//     activeTurn = "AUDIO";
//     dfcxStream = sessionClient.streamingDetectIntent();

//     // 1. Send Initial Config
//     dfcxStream.write({
//         session: createSessionPath(callSid),
//         queryInput: {
//             audio: {
//                 config: {
//                     audioEncoding: "AUDIO_ENCODING_LINEAR_16",
//                     sampleRateHertz: 8000,
//                     singleUtterance: true, // Stops listening after user pauses
//                 },
//             },
//             languageCode: "en-US",
//         },
//         queryParams: {
//             parameters: {
//                 ani: { stringValue: ws.customData.ani },
//                 dnis: { stringValue: ws.customData.dnis },
//                 language: { stringValue: ws.customData.language }
//             }
//         },
//         outputAudioConfig: {
//             audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
//             sampleRateHertz: 8000,
//         },
//     });

//     // 2. Attach Handlers
//     dfcxStream.on("error", (err) => {
//         console.error("❌ DFCX Error:", err);
//         closeTurn();
//     });

//     dfcxStream.on("data", async (data) => {
//         //console.log('inside data:', data);

//         // Log partial transcripts to see if it's working in real-time
//         if (data.recognitionResult) {
//             console.log(`🗣️ Hearing: "${data.recognitionResult.transcript}" (Final: ${data.recognitionResult.isFinal})`);
//         }

//         if (data.recognitionResult?.isFinal) {
//             console.log('logging data:', data);
//         }

//         const response = data.detectIntentResponse;
//         if (response && response.outputAudio) {
//             console.log("🔊 Sending Bot Response to Twilio");
//             sendAudioToTwilio(response.outputAudio, streamSid, ws);
//             // Note: We don't closeTurn here immediately if you want continuous convo, 
//             // but for simple Request/Response, we reset after audio is sent.
//             closeTurn();
//         }
//         if (response?.queryResult) {
//             console.log('Intent:', response?.queryResult?.intent?.displayName);
//             console.log('Parameters:', JSON.stringify(response?.queryResult?.parameters, null, 2));
//             console.log('matchEvent:', response?.queryResult?.match?.event);
//         }

//         //         if (response?.queryResult?.responseMessages) {
//         //             response.queryResult.responseMessages.forEach((msg, i) => {
//         //                 //console.log(`responseMessage[${i}] type:`, Object.keys(msg));
//         //                 /* if (msg.payload?.fields) {
//         //                     const payload = {};

//         //                     for (const [key, val] of Object.entries(msg.payload.fields)) {
//         //                         payload[key] =
//         //                             val.stringValue ??
//         //                             val.numberValue ??
//         //                             val.boolValue ??
//         //                             null;
//         //                     }

//         //                     console.log(`CustomPayload[${i}]:`, JSON.stringify(payload));
//         //                 } */
//         //                 if (msg.liveAgentHandoff) {
//         //                     console.log(`LiveAgentHandoff[${i}]:`, JSON.stringify(msg.liveAgentHandoff, null, 2));
//         //                     console.log("☎️ Agent handoff requested");
//         //                     closeTurn();

//         //                     // 2. Stop Twilio Media Stream
//         //                     ws.send(JSON.stringify({ event: "stop" }));

//         //                     // 3. Redirect live call to agent (replace with your agent's phone number or client identity)
//         //                     try {
//         //                         twilioClient.calls(callSid).update({
//         //                             twiml: `
//         // <Response>
//         // <Say>Please wait while I connect you to an agent.</Say>
//         // <Dial>+13126464159</Dial>
//         // </Response>
//         //                     `
//         //                         });
//         //                     } catch (err) {
//         //                         console.error("Error updating Twilio call for handoff:", err);
//         //                     }
//         //                     return;
//         //                 }
//         //             });
//         //         }
//         // if (response?.queryResult?.responseMessages) {
//         //     for (const msg of response.queryResult.responseMessages) {
//         //         if (msg.liveAgentHandoff) {
//         //             console.log("🚨 Handoff triggered by Dialogflow CX");

//         //             const metadata = msg.liveAgentHandoff.metadata?.fields || {};
//         //             const handoffPayload = {
//         //                 last_utterance: metadata.last_user_utterance?.stringValue,
//         //                 ani: ws.customData?.ani || metadata.ani?.stringValue,
//         //                 dnis: ws.customData?.dnis || metadata.dnis?.stringValue,
//         //                 language: ws.customData?.language || metadata.language?.stringValue
//         //             };
//         //             console.log('handoffPayload:', handoffPayload);
//         //             const params = new URLSearchParams(handoffPayload).toString();
//         //             const studioUrl = `https://webhooks.twilio.com/v1/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Flows/${process.env.HANDOFF_FLOW_SID}?${params}`;
//         //             console.log("🔗 Redirecting to Studio URL:", studioUrl);
//         //             closeTurn();
//         //             setTimeout(async () => {
//         //                 try {
//         //                     ws.send(JSON.stringify({ event: "stop" }));

//         //                     await twilioClient.calls(callSid).update({
//         //                         method: "POST",
//         //                         url: studioUrl
//         //                     });

//         //                     console.log(`✅ Call ${callSid} redirected to Studio Flow`);
//         //                 } catch (err) {
//         //                     console.error("Error updating Twilio call for handoff:", err);
//         //                 }
//         //             }, 2000); //2 sec delay ensures audio plays first
//         //         }
//         //     }
//         // }

//         if (response?.queryResult?.responseMessages) {
//             for (const msg of response.queryResult.responseMessages) {
//                 if (msg.liveAgentHandoff) {
//                     console.log("🚨 Handoff signal detected! Calling Webhook...");

//                     try {
//                         const testPayload = {
//                             callSid: callSid,
//                             status_trigger: "HANDOFF_TRIGGER"
//                         };

//                         // 1. Call the webhook
//                         const webhookResponse = await axios.post('https://csrservice-7670-dev.twil.io/checkCallbackStatus', testPayload);
//                         console.log('✅ WEBHOOK TEST SUCCESS:', webhookResponse.status, webhookResponse.data);

//                         // 2. WAIT slightly for the bot's "Transferring you" audio to finish playing
//                         setTimeout(() => {
//                             console.log("🧼 Cleaning up stream to allow Twilio to Redirect...");

//                             // 3. Close the Dialogflow Stream
//                             closeTurn();

//                             // 4. IMPORTANT: Tell Twilio to stop the Media Stream
//                             // This allows the <Redirect> TwiML from the webhook to take control
//                             ws.send(JSON.stringify({ event: "stop" }));

//                             // 5. Close the local WebSocket
//                             ws.close();
//                         }, 2000);

//                     } catch (error) {
//                         console.error('❌ WEBHOOK FAILED:', error.message);
//                     }
//                 }
//             }
//         }
//     });
// }

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
                    singleUtterance: true,
                },
            },
            languageCode: "en-US",
        },
        queryParams: {
            parameters: {
                ani: { stringValue: ws.customData?.ani || "" },
                dnis: { stringValue: ws.customData?.dnis || "" },
                language: { stringValue: ws.customData?.language || "en-US" }
            }
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

    dfcxStream.on("data", async (data) => {
        if (data.recognitionResult) {
            console.log(`🗣️ Hearing: "${data.recognitionResult.transcript}" (Final: ${data.recognitionResult.isFinal})`);
        }

        const response = data.detectIntentResponse;
        if (response) {
            console.log('data: ', data);
        }
        const responseMessages = response?.queryResult?.responseMessages || [];
        console.log("responseMessages array: ", JSON.stringify(responseMessages));
        const handoffMsg = responseMessages.find(msg => msg.liveAgentHandoff);
        const intent = response?.queryResult?.intent?.displayName;

        // --- HANDLE AUDIO OUTPUT ---
        if (response && response.outputAudio) {
            console.log("🔊 Sending Bot Response to Twilio");
            sendAudioToTwilio(response.outputAudio, streamSid, ws);

            // Only close turn immediately if this is NOT a handoff.
            if (!handoffMsg) {
                closeTurn();
            }
        }

        // --- LOGGING FOR DEBUGGING ---
        if (response?.queryResult) {
            console.log('Intent:', intent);
            console.log('matchEvent:', response?.queryResult?.match?.event);
        }

        // --- HANDLE HANDOFF & MARK EVENT ---
        if (handoffMsg) {
            console.log("🚨 Handoff signal detected!");

            try {
                const metadata = handoffMsg.liveAgentHandoff.metadata?.fields || {};

                // Construct the JSON payload for the Mark Name
                const handoffPayload = {
                    last_utterance: metadata.last_user_utterance?.stringValue,
                    ani: ws.customData?.ani || metadata.ani?.stringValue,
                    dnis: ws.customData?.dnis || metadata.dnis?.stringValue,
                    language: ws.customData?.language || metadata.language?.stringValue,
                    last_open_intent: response?.queryResult?.intent?.displayName,
                    callSid: callSid
                };

                // const customDataString = JSON.stringify(handoffPayload);
                // console.log('🚀 Sending Mark Name:', customDataString);

                // // 3. Send the Mark inside the 'name' field
                // ws.send(JSON.stringify({
                //     event: "mark",
                //     streamSid: streamSid,
                //     mark: {
                //         name: customDataString
                //     }
                // }));

                const webhookResponse = await axios.post('https://csrservice-7670-dev.twil.io/checkCallbackStatus', handoffPayload);
                console.log('✅ WEBHOOK TEST SUCCESS:', webhookResponse.status, webhookResponse.data);

                ws.send(JSON.stringify({ event: "stop" }));
                console.log('Sream stopped');
                closeTurn();
                // setTimeout(() => {
                //     console.log("closing socket connection");
                //     ws.close();
                // }, 3500);

            } catch (error) {
                console.error('❌ Failed to process webhook call:', error.message);
            }
        }

        if (intent === "Add Card") {
            console.log("🚨 add card detected!");
            try {
                const ccHandoffPayload = {
                    last_open_intent: intent,
                    callSid: callSid,
                    token: ws.customData?.token
                };
                console.log('ccHandoffPayload:', JSON.stringify(ccHandoffPayload));
                const webhookResponse = await axios.post('https://csrservice-7670-dev.twil.io/checkCallbackStatus', ccHandoffPayload);
                console.log('✅AddCardCC WEBHOOK TEST SUCCESS:', webhookResponse.status, webhookResponse.data);
                //ws.send(JSON.stringify({ event: "stop" }));
                console.log('Sream stopped');
                closeTurn();
            } catch (error) {
                console.error('❌ Failed to process webhook call:', error.message);
            }
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
