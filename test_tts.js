const { EdgeTTS } = require('node-edge-tts');
const tts = new EdgeTTS({
    voice: 'ko-KR-SunHiNeural',
    lang: 'ko-KR',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
});
tts.ttsPromise('네조 멍청이', 'test_out.mp3').then(() => {
    console.log('Success');
}).catch(e => {
    console.error('Error:', e);
});
