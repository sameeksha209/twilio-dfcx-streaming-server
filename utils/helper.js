const { sessionClient, createSessionPath } = require("../dfcx/client");

let callSid;
let streamSid;
let dfcxStream = null;
let activeTurn = null; // null | "EVENT" | "AUDIO"
/* ---------------- TURN HELPERS ---------------- */

function canStartTurn() {
    return activeTurn === null;
}

function startEventTurn(eventName) {
    if (!canStartTurn()) return;

    console.log(`🎯 EVENT TURN → ${eventName}`);
    activeTurn = "EVENT";

    dfcxStream = sessionClient.streamingDetectIntent();
    attachDfcxHandlers();

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

    // Event = immediate half-close
    dfcxStream.end();
}

function startAudioTurn() {
    if (!canStartTurn()) return;

    console.log("🎤 AUDIO TURN START");
    activeTurn = "AUDIO";

    dfcxStream = sessionClient.streamingDetectIntent();
    attachDfcxHandlers();

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

function closeTurn() {
    if (dfcxStream) {
        dfcxStream.destroy();
        dfcxStream = null;
    }
    activeTurn = null;
    console.log("🔁 Turn closed");
}

/* ---------------- DFCX HANDLERS ---------------- */

function attachDfcxHandlers() {
    dfcxStream.on("error", (err) => {
        console.error("❌ DFCX Error:", err.message);
        closeTurn();
    });

    dfcxStream.on("data", (data) => {
        // Speech end detection
        if (
            activeTurn === "AUDIO" &&
            data.recognitionResult?.isFinal
        ) {
            console.log("🛑 End of speech detected");
            dfcxStream.end(); // HALF-CLOSE
        }

        // Bot audio
        const outputAudio = data.detectIntentResponse?.outputAudio;
        if (outputAudio?.length) {
            sendAudioToTwilio(outputAudio);
            closeTurn();
        }
    });
}

/* ---------------- AUDIO OUT ---------------- */

function sendAudioToTwilio(outputAudio) {
    const wav = new WaveFile(outputAudio);
    wav.toMuLaw();
    const mulaw = Buffer.from(wav.getSamples());

    const FRAME_SIZE = 160;
    for (let i = 0; i < mulaw.length; i += FRAME_SIZE) {
        ws.send(
            JSON.stringify({
                event: "media",
                streamSid,
                media: {
                    payload: mulaw.slice(i, i + FRAME_SIZE).toString("base64"),
                },
            })
        );
    }
}

module.exports = {startAudioTurn, startEventTurn, sendAudioToTwilio, attachDfcxHandlers, closeTurn, canStartTurn}