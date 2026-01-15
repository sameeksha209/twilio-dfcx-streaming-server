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

    const request = {
        session: createSessionPath(callSid),
        queryInput: {
            dtmf: {
                digits: digit,
                transformed: true
            },
            languageCode: "en-US",
        },
        outputAudioConfig: {
            audioEncoding: "OUTPUT_AUDIO_ENCODING_MULAW",
            sampleRateHertz: 8000,
        },
    };

    console.log("📤 Sending DTMF Payload:", JSON.stringify(request.queryInput.dtmf));
    dfcxStream.write(request);
    dfcxStream.end();
}

function closeTurn(callSid, streamSid, ws) {
    isEnding = true;

    if (dfcxStream && !dfcxStream.writableEnded) {
        dfcxStream.end();
    }

    dfcxStream = null;
    activeTurn = null;

    console.log("🔁 Turn closed");

    // 🟢 IMMEDIATELY re-arm listening
    if (ws && ws.readyState === ws.OPEN) {
        startAudioTurn(callSid, streamSid, ws);
    }
}


function closeTurn() {
    isEnding = true; // Stop any more writes immediately
    if (dfcxStream) {
        dfcxStream.end(); // destroy is safer than end() for race conditions
        // dfcxStream = null;
    }
    activeTurn = null;
    console.log("🔁 Turn closed");
}

// function attachDfcxHandlers(callSid, streamSid, ws) {
//     if (!dfcxStream) return;

//     dfcxStream.on("error", (err) => {
//         if (err.message.includes("write after end")) return; // Ignore known race condition
//         console.error("❌ DFCX Error:", err.message);
//         closeTurn();
//     });

//     dfcxStream.on("data", (data) => {
//         console.log('data',data)
//         console.log(`🗣️ User: "${data?.recognitionResult?.transcript}"`);

//         if (activeTurn === "AUDIO" && data.recognitionResult?.isFinal) {
//             console.log(`🗣️ User: "${data.recognitionResult.transcript}"`);
//             isEnding = true; // 🛑 BLOCK WRITES NOW
//             dfcxStream.end();
//         }

//         const outputAudio = data.detectIntentResponse?.outputAudio;
//         console.log('output audio', outputAudio);
//         if (outputAudio?.length) {
//             console.log("🔊 Bot is speaking...");
//             sendAudioToTwilio(outputAudio, streamSid, ws);
//             closeTurn();
//         }
//     });
// }

function attachDfcxHandlers(callSid, streamSid, ws) {
    if (!dfcxStream) return;

    dfcxStream.on("error", (err) => {
        if (err.message.includes("write after end")) return;
        console.error("❌ DFCX Error:", err.message);
        closeTurn(callSid, streamSid, ws);
    });

    dfcxStream.on("data", (data) => {
        console.log('data-----',data)
        // 1. Handle Recognition Results
        if (data.recognitionResult) {
            const transcript = data?.recognitionResult?.transcript;
            const isFinal = data?.recognitionResult?.isFinal;
              console.log('transcript and isFinal', transcript,isFinal)
            if (transcript) console.log(`🗣️ User: "${transcript}" ${isFinal ? '[FINAL]' : ''}`);

            // if (isFinal && activeTurn === "AUDIO") {
            //     // We've heard the user, stop sending more audio from Twilio
            //     isEnding = true; 
            //     // Don't close the turn yet; we need to wait for the bot's response!
            // }
        }

        // 2. Handle the Bot's Response
        if (data.detectIntentResponse) {
            const outputAudio = data.detectIntentResponse.outputAudio;
            
            if (outputAudio && outputAudio.length > 0) {
                console.log("🔊 Bot is speaking, sending to Twilio...");
                sendAudioToTwilio(outputAudio, streamSid, ws);
                
                // IMPORTANT: Only close the turn AFTER we have processed the bot's response
                setTimeout(() => {
        closeTurn(callSid, streamSid, ws);
    }, 50);
            }
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