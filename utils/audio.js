const mulaw = require("mulaw-js");

function mulawToPCM(mulawBytes) {
  return mulaw.decode(mulawBytes);
}

function pcmToMulaw(pcmBuffer) {
  const pcm = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    pcmBuffer.length / 2
  );

  return Buffer.from(mulaw.encode(pcm));
}

module.exports = { mulawToPCM, pcmToMulaw };
