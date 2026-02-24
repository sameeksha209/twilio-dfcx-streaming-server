const { sessionClient, createSessionPath } = require("../dfcx/client");
const axios = require('axios');

function mapToDfParams(data) {
    const fields = {};
    if (!data) return fields;

    Object.entries(data).forEach(([key, value]) => {
        // Skip the token to keep session size down and logs clean
        if (key === 'token') return;

        if (value !== undefined && value !== null) {
            // Mapping everything as stringValue for maximum compatibility with DFCX
            fields[key] = { stringValue: String(value) };
        }
    });
    return fields;
}

function closeTurn(ws) {
    if (ws.dfcxStream) {
        console.log(`🔄 [${ws.callSid}] TURN_RESET: Closing DFCX stream`);
        ws.dfcxStream.end();
        ws.dfcxStream = null;
    }
    ws.activeTurn = null;
}

async function executeAddCard(intent, ws) {
    const start = Date.now();
    console.log(`💳 [${ws.callSid}] WEBHOOK_SEND: Add Card | Intent: ${intent}`);

    try {
        const payload = {
            last_open_intent: intent,
            callSid: ws.callSid,
            streamSid: ws.streamSid,
            token: ws.customData?.token
        };
        console.log(`[${ws.callSid}] executeAddCard payload ${JSON.stringify(payload)}`);
        const response = await axios.post('https://relayserver-2802-dev.twil.io/checkCallbackStatus', payload);
        console.log(`✅ [${ws.callSid}] WEBHOOK_RCVD: Success (${response.status}) | Duration: ${Date.now() - start}ms | Data: ${JSON.stringify(response.data)}`);

        closeTurn(ws);
    } catch (error) {
        console.error(`❌ [${ws.callSid}] WEBHOOK_FAIL: Add Card Error: ${error.message}`);
    }
}

async function executeHandoff(handoffMsg, lastIntent, ws) {
    const start = Date.now();
    console.log(`🚨 [${ws.callSid}] WEBHOOK_SEND: Handoff | Intent: ${lastIntent}`);
    // 🛑 STOP NEW STREAMS FROM STARTING
    ws.stopInProgress = true;

    try {
        const metadata = handoffMsg.liveAgentHandoff.metadata?.fields || {};
        const payload = {
            last_utterance: metadata.last_user_utterance?.stringValue,
            ani: ws.customData?.ani || metadata.ani?.stringValue,
            dnis: ws.customData?.dnis || metadata.dnis?.stringValue,
            language: ws.customData?.language || metadata.language?.stringValue,
            last_open_intent: lastIntent,
            callSid: ws.callSid
        };
        console.log(`[${ws.callSid}] executeHandoff payload ${JSON.stringify(payload)}`);
        const response = await axios.post('https://relayserver-2802-dev.twil.io/checkCallbackStatus', payload);
        console.log(`✅ [${ws.callSid}] WEBHOOK_RCVD: Handoff Success (${response.status}) | Duration: ${Date.now() - start}ms | Data: ${JSON.stringify(response.data)}`);

        ws.send(JSON.stringify({ event: "stop" }));
        console.log(`⏹️ [${ws.callSid}] INSTRUCTION: Sent STOP to Twilio for handoff`);
        closeTurn(ws);
    } catch (error) {
        console.error(`❌ [${ws.callSid}] WEBHOOK_FAIL: Handoff Error: ${error.message}`);
    }
}

function startAudioTurn(ws) {
    if (ws.dfcxStream) return;

    console.log(`📡 [${ws.callSid}] DFCX_STREAM: Opening new Audio Stream`);
    ws.activeTurn = "AUDIO";
    const stream = sessionClient.streamingDetectIntent();
    ws.dfcxStream = stream;

    stream.write({
        session: createSessionPath(ws.callSid),
        queryInput: {
            audio: {
                config: {
                    audioEncoding: "AUDIO_ENCODING_LINEAR_16",
                    sampleRateHertz: 8000,
                    singleUtterance: true,
                },
            },
            languageCode: ws.customData.language,
        },
        queryParams: {
            // ✅ Added dynamic parameters to voice turns too!
            parameters: { fields: mapToDfParams(ws.customData) }
        },
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
        },
    });

    setupStreamHandlers(stream, ws);
}

function startEventTurn(eventName, ws) {
    console.log(`🔔 [${ws.callSid}] EVENT_TRIGGER: ${eventName}`);
    ws.activeTurn = "EVENT";
    const stream = sessionClient.streamingDetectIntent();
    ws.dfcxStream = stream;

    stream.on("data", (data) => {
        if (data.detectIntentResponse?.outputAudio) {
            console.log(`🔊 [${ws.callSid}] BOT_AUDIO: Sending event response audio`);
            sendAudioToTwilio(data.detectIntentResponse.outputAudio, ws);
            closeTurn(ws);
        }
    });

    stream.write({
        session: createSessionPath(ws.callSid),
        queryInput: {
            event: { event: eventName },
            languageCode: ws.customData.language
        },
        queryParams: {
            // ✅ Uses the mapping helper to include all customParameters
            parameters: { fields: mapToDfParams(ws.customData) }
        },
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000
        }
    });
}

function sendAudioToTwilio(audioBuffer, ws) {
    const base64Audio = Buffer.from(audioBuffer).toString("base64");
    ws.send(JSON.stringify({
        event: "media",
        streamSid: ws.streamSid,
        media: { payload: base64Audio }
    }));
    ws.send(JSON.stringify({
        event: "mark",
        streamSid: ws.streamSid,
        mark: { name: "bot_speech_segment" }
    }));
}

// Shared handler to process DFCX responses for ANY type of input
function setupStreamHandlers(stream, ws) {
    stream.on("data", async (data) => {
        if (data.recognitionResult) {
            console.log(`🗣️ [${ws.callSid}] HEARING: "${data.recognitionResult.transcript}"`);
        }

        const response = data.detectIntentResponse;
        if (response) {
            const queryResult = response.queryResult;
            const intent = queryResult?.intent?.displayName;
            const handoffMsg = queryResult?.responseMessages?.find(m => m.liveAgentHandoff);

            if (intent) console.log(`🎯 [${ws.callSid}] MATCHED: ${intent}`);

            // Handle Audio Output
            if (response.outputAudio && response.outputAudio.length > 0) {
                sendAudioToTwilio(response.outputAudio, ws);
            }

            // Handle Logic/Redirects
            if (handoffMsg) {
                await executeHandoff(handoffMsg, intent, ws);
            } else if (intent === "Add Card") {
                await executeAddCard(intent, ws);
            } else if (response.outputAudio) {
                // Keep the turn active until audio is sent, then close for next user input
                closeTurn(ws);
            }
        }
    });

    stream.on("error", (err) => {
        console.error(`❌ [${ws.callSid}] DFCX_STREAM_ERROR:`, err);
        closeTurn(ws);
    });
}

function startDtmfTurn(digit, ws) {
    console.log(`🔢 [${ws.callSid}] DFCX_DTMF_SEND: ${digit}`);
    
    // 1. Lock the turn state to 'DTMF'
    ws.activeTurn = "DTMF"; 

    // 2. Clear Twilio buffer
    ws.send(JSON.stringify({
        event: "clear",
        streamSid: ws.streamSid
    }));

    const stream = sessionClient.streamingDetectIntent();
    ws.dfcxStream = stream;

    // Use a modified handler that only unlocks AFTER audio is received
    stream.on("data", (data) => {
        const response = data.detectIntentResponse;
        if (response) {
            // Handle matched intent/parameters
            if (response.queryResult?.intent) {
                console.log(`🎯 [${ws.callSid}] DTMF MATCH: ${response.queryResult.intent.displayName}`);
            }

            // Send response audio
            if (response.outputAudio && response.outputAudio.length > 0) {
                sendAudioToTwilio(response.outputAudio, ws);
            }

            // 🔓 IMPORTANT: Only unlock the turn after DFCX has responded
            // We use a small delay so the 'media' packets don't restart the loop immediately
            setTimeout(() => {
                if (ws.activeTurn === "DTMF") {
                    ws.activeTurn = null;
                    ws.dfcxStream = null;
                }
            }, 1000); 
        }
    });

    stream.write({
        session: createSessionPath(ws.callSid),
        queryInput: {
            dtmf: { digits: String(digit) },
            finishDigit: '#',
            languageCode: ws.customData.language
        },
        queryParams: {
            parameters: { fields: mapToDfParams(ws.customData) }
        },
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000
        }
    });

    stream.end();
}

module.exports = { startEventTurn, startAudioTurn, closeTurn, startDtmfTurn };