const OpenAI = require('openai');
const player = require('play-sound')();
const fs = require('fs');
require('dotenv').config({ path: '/Users/felixlunzenfichter/Documents/macos-voice-control/.env' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const voices = ['alloy', 'echo', 'onyx'];

async function testVoice(voice, text) {
  console.log(`Testing voice: ${voice}`);
  
  try {
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: voice,
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    const tempFile = `/tmp/voice_test_${voice}.mp3`;
    fs.writeFileSync(tempFile, buffer);
    
    return new Promise((resolve) => {
      player.play(tempFile, (err) => {
        if (err) console.error(`Error playing ${voice}:`, err);
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        resolve();
      });
    });
  } catch (error) {
    console.error(`Error with ${voice}:`, error.message);
  }
}

async function demoAllVoices() {
  for (const voice of voices) {
    await testVoice(voice, `Hello, this is the ${voice} voice. Testing one, two, three.`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second pause
  }
}

async function multiVoiceDemo() {
  console.log('\nStarting multi-voice conversation demo...\n');
  
  await testVoice('alloy', 'Worker one here. I am the primary voice handling your main tasks.');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testVoice('echo', 'Worker two speaking. I am the second voice in this multi-voice system.');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testVoice('onyx', 'Worker three active. I provide a third distinct voice for complex operations.');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testVoice('alloy', 'Back to worker one. This demonstrates how multiple Claude instances can have different voices.');
}

// Run both demos
async function runDemos() {
  await demoAllVoices();
  await multiVoiceDemo();
  console.log('\nAll demos complete!');
  process.exit(0);
}

runDemos();