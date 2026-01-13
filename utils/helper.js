const { WaveFile } = require("wavefile");
const { sessionClient, createSessionPath } = require("../dfcx/client");
// Global state for the current call session
let dfcxStream = null;
let activeTurn = null;
let isEnding = false; // Guard to prevent 'write after end'

/**
 * Checks if the system is idle
 */
function canStartTurn() { return activeTurn === null; }
/**
 * Getter to share the stream with the main socket file
 */
function getDfcxStream() { return dfcxStream; }
/**
 * Getter to check if we are in Audio mode
 */
function isAudioTurn() { return activeTurn === "AUDIO"; }
// New guard for mediasocket to check
function canWrite() { return dfcxStream && !isEnding; }

function startEventTurn(eventName, callSid, streamSid, ws) {
    if (!canStartTurn()) return;
    console.log(`🎯 EVENT TURN → ${eventName}`);
    activeTurn = "EVENT";
    isEnding = false;

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
    dfcxStream.end();
}

function startAudioTurn(callSid, streamSid, ws) {
    if (!canStartTurn()) return;
    console.log("🎤 AUDIO TURN START");
    activeTurn = "AUDIO";
    isEnding = false;

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

function startDtmfTurn(digit, callSid, streamSid, ws) {
    if (!canStartTurn()) return;

    console.log(`DTMF INPUT → "${digit}"`);
    activeTurn = "DTMF";
    isEnding = false;

    dfcxStream = sessionClient.streamingDetectIntent();
    attachDfcxHandlers(callSid, streamSid, ws);

    dfcxStream.write({
        session: createSessionPath(callSid),
        queryInput: {
            text: {
                text: `DTMF_${digit}`
            },
            languageCode: "en-US",
        },
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
        },
    });

    // End the request side so Google can respond
    dfcxStream.end();
}

function closeTurn() {
    isEnding = true; // Stop any more writes immediately
    if (dfcxStream) {
        dfcxStream.destroy(); // destroy is safer than end() for race conditions
        dfcxStream = null;
    }
    activeTurn = null;
    console.log("🔁 Turn closed");
}

function attachDfcxHandlers(callSid, streamSid, ws) {
    if (!dfcxStream) return;

    dfcxStream.on("error", (err) => {
        if (err.message.includes("write after end")) return; // Ignore known race condition
        console.error("❌ DFCX Error:", err.message);
        closeTurn();
    });

    dfcxStream.on("data", (data) => {
        // 🔍 DEBUG: Log the NLU Result
        const queryResult = data.detectIntentResponse?.queryResult;
        if (queryResult) {
            console.log("--- DFCX Response Analysis ---");
            console.log(`Current Page: ${queryResult.currentPage?.displayName}`);
            console.log(`Matched Intent: ${queryResult.intent?.displayName || "NONE (No Match)"}`);
            console.log(`Match Type: ${queryResult.match?.matchType}`);
            console.log(`DTMF Digits Received: "${queryResult.dtmf?.digits}"`);
            console.log("------------------------------");
        }
        if (activeTurn === "AUDIO" && data.recognitionResult?.isFinal) {
            console.log(`🗣️ User: "${data.recognitionResult.transcript}"`);
            isEnding = true; // 🛑 BLOCK WRITES NOW
            dfcxStream.end();
        }

        const outputAudio = data.detectIntentResponse?.outputAudio;
        if (outputAudio?.length) {
            console.log("🔊 Bot is speaking...");
            sendAudioToTwilio(outputAudio, streamSid, ws);
            closeTurn();
        }
    });
}

function sendAudioToTwilio(outputAudio, streamSid, ws) {
    try {
        const wav = new WaveFile(outputAudio);
        wav.toMuLaw();
        const mulaw = Buffer.from(wav.getSamples());

        const FRAME_SIZE = 160; // Twilio standard chunk size
        for (let i = 0; i < mulaw.length; i += FRAME_SIZE) {
            ws.send(JSON.stringify({
                event: "media",
                streamSid,
                media: { payload: mulaw.slice(i, i + FRAME_SIZE).toString("base64") },
            }));
        }
    } catch (e) {
        console.error("❌ Audio conversion error:", e);
    }
}

module.exports = {
    startEventTurn, startAudioTurn, closeTurn, getDfcxStream, isAudioTurn, canStartTurn, canWrite, startDtmfTurn
};