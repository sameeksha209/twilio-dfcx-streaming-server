const { sessionClient, createSessionPath } = require("../dfcx/client");
const axios = require('axios');

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
            token: ws.customData?.token
        };

        const response = await axios.post('https://csrservice-7670-dev.twil.io/checkCallbackStatus', payload);
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

        const response = await axios.post('https://csrservice-7670-dev.twil.io/checkCallbackStatus', payload);
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
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
        },
    });

    stream.on("data", async (data) => {
        if (data.recognitionResult) {
            console.log(`🗣️ [${ws.callSid}] HEARING: "${data.recognitionResult.transcript}" (Final: ${data.recognitionResult.isFinal})`);
        }

        const response = data.detectIntentResponse;
        if (response) {
            const queryResult = response.queryResult;
            const intent = queryResult?.intent?.displayName;
            const handoffMsg = queryResult?.responseMessages?.find(m => m.liveAgentHandoff);

            if (intent) console.log(`🎯 [${ws.callSid}] INTENT_MATCH: ${intent}`);

            if (response.outputAudio) {
                console.log(`🔊 [${ws.callSid}] BOT_AUDIO: Sending ${response.outputAudio.length} bytes to Twilio`);
                sendAudioToTwilio(response.outputAudio, ws);
            }

            if (handoffMsg) {
                await executeHandoff(handoffMsg, intent, ws);
            } else if (intent === "Add Card") {
                await executeAddCard(intent, ws);
            } else if (response.outputAudio) {
                closeTurn(ws);
            }
        }
    });

    stream.on("error", (err) => {
        console.error(`❌ [${ws.callSid}] DFCX_ERROR:`, err);
        closeTurn(ws);
    });
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
        queryInput: { event: { event: eventName }, languageCode: ws.customData.language },
        queryParams: {
            parameters: {
                fields: {
                    ani: { stringValue: ws.customData.ani || "" },
                    dnis: { stringValue: ws.customData.dnis || "" }
                }
            }
        },
        outputAudioConfig: { audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW", sampleRateHertz: 8000 }
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

module.exports = { startEventTurn, startAudioTurn, closeTurn };