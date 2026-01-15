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

const mulaw = require("mulaw-js");

// function mulawToPCM(mulawBytes) {
//   // 1. Decode Mu-law to Int16Array
//   const decodedInt16 = mulaw.decode(mulawBytes);
  
//   // 2. Create a fresh buffer (2 bytes per sample)
//   const pcmBuffer = Buffer.alloc(decodedInt16.length * 2);

//   // 3. EXPLICITLY write as Little-Endian. 
//   // If you don't do this, it might default to Big-Endian, which sounds like static to Google.
//   for (let i = 0; i < decodedInt16.length; i++) {
//     pcmBuffer.writeInt16LE(decodedInt16[i], i * 2);
//   }
  
//   return pcmBuffer;
// }
function mulawToPCM(mulawBuffer) {
  try {
    const wav = new WaveFile();
    // Create a 1-channel, 8000Hz mu-law wav from the buffer
    wav.fromScratch(1, 8000, "8m", mulawBuffer);
    // Convert to 16-bit Linear PCM
    wav.toBitDepth("16");
    // Return just the raw samples (no WAV header)
    return Buffer.from(wav.data.samples);
  } catch (err) {
    console.error("Audio Conversion Error:", err);
    return null;
  }
}

function pcmToMulaw(pcmBuffer) {
const pcmBytes = pcmBuffer.slice(44);
const aligned = new Uint8Array(pcmBytes).slice(); // hard copy

const pcm16 = new Int16Array(aligned.buffer);

  // Convert back to Int16Array for encoding
  // const pcm = new Int16Array(
  //   pcmBuffer.buffer,
  //   pcmBuffer.byteOffset,
  //   pcmBuffer.length / 2
  // );
  return Buffer.from(mulaw.encode(pcm16));
}

module.exports = { mulawToPCM, pcmToMulaw };