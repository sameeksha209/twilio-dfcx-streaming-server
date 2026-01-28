const { sessionClient, createSessionPath } = require("../dfcx/client");
const axios = require("axios");

function getDfcxStream(state) {
    return state.dfcxStream;
}

function isAudioTurn(state) {
    return state.activeTurn === "AUDIO";
}

function closeTurn(state) {
    try {
        if (state.dfcxStream) {
            state.dfcxStream.end();
            console.log("🔔 DFCX stream ended successfully");
        }
    } catch (err) {
        console.error("❌ Error closing DFCX stream:", err);
    }

    state.dfcxStream = null;
    state.activeTurn = null;
    state.turnClosed = false;

    console.log("🔁 Turn state reset");
}

function startAudioTurn(callSid, streamSid, ws) {
    const state = ws.callState;

    if (state.dfcxStream || ws.callState.streamEnded) {
        return;
    }

    console.log(`[${callSid}] 🎤 AUDIO TURN START`);
    state.activeTurn = "AUDIO";
    //state.turnClosed = false;

    const dfcxStream = sessionClient.streamingDetectIntent();
    state.dfcxStream = dfcxStream;

    // Initial config
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
            languageCode: ws.customData?.language || "en-US",
        },
        queryParams: {
            parameters: {
                ani: { stringValue: ws.customData?.ani || "" },
                dnis: { stringValue: ws.customData?.dnis || "" },
                language: { stringValue: ws.customData?.language || "en-US" },
            },
        },
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
        },
    });

    dfcxStream.on("error", (err) => {
        console.error(`[${callSid}] ❌ DFCX ERROR:`, err);
        closeTurn(state);
    });

    dfcxStream.on("data", async (data) => {
        if (state.turnClosed) return;

        // Log speech recognition results
        if (data.recognitionResult) {
            console.log(
                `[${callSid}] 🗣️ Transcript: "${data.recognitionResult.transcript}" | final=${data.recognitionResult.isFinal}`
            );
        }

        const response = data.detectIntentResponse;
        if (!response) return;
        const intent = response?.queryResult?.intent?.displayName;
        const responseMessages = response.queryResult?.responseMessages || [];
        const handoffMsg = responseMessages.find((m) => m.liveAgentHandoff);
        console.log(`[${callSid}] Intent: ${intent} | matchEvent: "${response.queryResult?.match?.event || "N/A"}"`);
        console.log(`[${callSid}] responseMessages:`, JSON.stringify(responseMessages));

        // Send audio to Twilio
        if (response.outputAudio) {
            console.log(`[${callSid}] 🔊 Sending bot audio to Twilio`);
            sendAudioToTwilio(response.outputAudio, streamSid, ws);

            if (!handoffMsg) {
                closeTurn(state);
            }
        }

        // Handle live agent handoff
        if (handoffMsg) {
            try {
                const metadata = handoffMsg.liveAgentHandoff.metadata?.fields || {};
                const handoffPayload = {
                    last_utterance: metadata.last_user_utterance?.stringValue,
                    ani: ws.customData?.ani,
                    dnis: ws.customData?.dnis,
                    language: ws.customData?.language,
                    last_open_intent: response?.queryResult?.intent?.displayName,
                    callSid: callSid
                };
                const webhookResponse = await axios.post('https://csrservice-7670-dev.twil.io/checkCallbackStatus', handoffPayload);
                console.log(`[${callSid}] 🚨 HANDOFF SENT SUCCESSFULLY:`, webhookResponse.status, webhookResponse.data);
                ws.callState.streamEnded = true;
                ws.send(JSON.stringify({ event: "stop" }));
                console.log('Sream stopped');
                closeTurn(state);
            } catch (err) {
                console.error(`[${callSid}] ❌ HANDOFF ERROR`, err.message);
            }
        }
    });
}

function startEventTurn(eventName, callSid, streamSid, ws) {
    const state = ws.callState;
    if (state.turnClosed) {
        //console.warn(`[${callSid}] ⚠️ EVENT TURN SKIPPED: Turn already closed`);
        return;
    }

    console.log(`[${callSid}] ⚡ EVENT TURN START: ${eventName}`);
    state.activeTurn = "EVENT";
    state.turnClosed = false;

    const dfcxStream = sessionClient.streamingDetectIntent();
    state.dfcxStream = dfcxStream;

    dfcxStream.on("data", (data) => {
        if (state.turnClosed) return;

        const response = data.detectIntentResponse;
        if (response?.outputAudio) {
            console.log(`[${callSid}] 🔊 Sending event audio to Twilio`);
            sendAudioToTwilio(response.outputAudio, streamSid, ws);
            closeTurn(state);
        }
    });

    dfcxStream.write({
        session: createSessionPath(callSid),
        queryInput: {
            event: { event: eventName },
            languageCode: ws.customData?.language || "en-US",
        },
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
        },
    });
}

function sendAudioToTwilio(outputAudio, streamSid, ws) {
    if (ws.readyState !== ws.OPEN) {
        //console.warn("⚠️ Cannot send audio, WebSocket not open");
        return;
    }

    ws.send(
        JSON.stringify({
            event: "media",
            streamSid,
            media: {
                payload: Buffer.from(outputAudio).toString("base64"),
            },
        })
    );
    console.log(`🔊 Audio frame sent to Twilio (streamSid=${streamSid})`);
}

module.exports = {
    startAudioTurn,
    startEventTurn,
    closeTurn,
    getDfcxStream,
    isAudioTurn,
};
