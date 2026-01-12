const { WaveFile } = require("wavefile");
const { sessionClient, createSessionPath } = require("../dfcx/client");

// Global state for the current call session
let dfcxStream = null;
let activeTurn = null;

/**
 * Checks if the system is idle
 */
function canStartTurn() {
    return activeTurn === null;
}

/**
 * Getter to share the stream with the main socket file
 */
function getDfcxStream() {
    return dfcxStream;
}

/**
 * Getter to check if we are in Audio mode
 */
function isAudioTurn() {
    return activeTurn === "AUDIO";
}

/**
 * Triggers a Welcome or DTMF event
 */
function startEventTurn(eventName, callSid, streamSid, ws) {
    if (!canStartTurn()) return;

    console.log(`🎯 EVENT TURN → ${eventName}`);
    activeTurn = "EVENT";

    dfcxStream = sessionClient.streamingDetectIntent();
    attachDfcxHandlers(callSid, streamSid, ws);

    dfcxStream.write({
        session: createSessionPath(callSid),
        queryInput: {
            event: { event: eventName },
            languageCode: "en-US",
        },
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
        },
    });

    // Events are one-shot: end the request side immediately
    dfcxStream.end();
}

/**
 * Opens the pipe for human speech
 */
function startAudioTurn(callSid, streamSid, ws) {
    if (!canStartTurn()) return;

    console.log("🎤 AUDIO TURN START");
    activeTurn = "AUDIO";

    dfcxStream = sessionClient.streamingDetectIntent();
    attachDfcxHandlers(callSid, streamSid, ws);

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
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
        },
    });
}

/**
 * Cleans up Google Stream and resets state
 */
function closeTurn() {
    if (dfcxStream) {
        dfcxStream.end();
        //dfcxStream = null;
    }
    activeTurn = null;
    console.log("🔁 Turn closed");
}

/**
 * Listens to Google's response
 */
function attachDfcxHandlers(callSid, streamSid, ws) {
    if (!dfcxStream) return;

    dfcxStream.on("error", (err) => {
        console.error("❌ DFCX Error:", err.message);
        closeTurn();
    });

    dfcxStream.on("data", (data) => {
        // 1. Handle Speech Detection
        if (activeTurn === "AUDIO" && data.recognitionResult?.isFinal) {
            console.log(`🗣️ User said: "${data.recognitionResult.transcript}"`);
            dfcxStream.end();
        }

        // 2. Handle Bot Audio Response
        const outputAudio = data.detectIntentResponse?.outputAudio;
        if (outputAudio?.length) {
            console.log("🔊 Bot is speaking...");
            sendAudioToTwilio(outputAudio, streamSid, ws);
            closeTurn(); // Reset for next turn
        }
    });
}

/**
 * Sends audio back to the phone
 */
function sendAudioToTwilio(outputAudio, streamSid, ws) {
    try {
        const wav = new WaveFile(outputAudio);
        wav.toMuLaw();
        const mulaw = Buffer.from(wav.getSamples());

        const FRAME_SIZE = 160;
        for (let i = 0; i < mulaw.length; i += FRAME_SIZE) {
            ws.send(JSON.stringify({
                event: "media",
                streamSid,
                media: {
                    payload: mulaw.slice(i, i + FRAME_SIZE).toString("base64"),
                },
            }));
        }
    } catch (e) {
        console.error("❌ Error sending audio:", e);
    }
}

module.exports = {
    startEventTurn,
    startAudioTurn,
    closeTurn,
    getDfcxStream,
    isAudioTurn,
    canStartTurn
};