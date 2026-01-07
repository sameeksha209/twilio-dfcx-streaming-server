const mulaw = require("mulaw-js");

/**
 * Converts Twilio Mu-law buffer to 16-bit Linear PCM Buffer for DFCX
 */
function mulawToPCM(mulawBytes) {
  const decodedInt16 = mulaw.decode(mulawBytes);
  // Convert Int16Array to a raw Buffer of bytes
  return Buffer.from(decodedInt16.buffer);
}

/**
 * Converts DFCX 16-bit Linear PCM Buffer back to Mu-law for Twilio
 */
function pcmToMulaw(pcmBuffer) {
  const pcm = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    pcmBuffer.length / 2
  );
  return Buffer.from(mulaw.encode(pcm));
}

module.exports = { mulawToPCM, pcmToMulaw };

// const mulaw = require("mulaw-js");

// function mulawToPCM(mulawBytes) {
//   return mulaw.decode(mulawBytes);
// }

// function pcmToMulaw(pcmBuffer) {
//   const pcm = new Int16Array(
//     pcmBuffer.buffer,
//     pcmBuffer.byteOffset,
//     pcmBuffer.length / 2
//   );

//   return Buffer.from(mulaw.encode(pcm));
// }

// module.exports = { mulawToPCM, pcmToMulaw };
