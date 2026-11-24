// Ingress, normalized storage and model admission must accept the same recording.
export const voiceLimits=Object.freeze({
 minSeconds:0.2,
 maxSeconds:90,
 uploadBytes:4*1024*1024,
 pcmBytesPerSecond:16000*2,
 wavBytes:90*16000*2+44,
});
export const voiceUploadBase64Limit=4*Math.ceil(voiceLimits.uploadBytes/3);
export const voiceWavBase64Limit=4*Math.ceil(voiceLimits.wavBytes/3);
