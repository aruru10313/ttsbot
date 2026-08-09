const { Client, GatewayIntentBits, Events } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    getVoiceConnection
} = require('@discordjs/voice');
const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const ffmpeg = require('ffmpeg-static');
const express = require('express');

// Render 무료 호스팅 꺼짐 방지용 웹 서버 (UptimeRobot 등에서 접속할 용도)
const app = express();
app.get('/', (req, res) => res.send('디스코드 TTS 봇이 정상적으로 작동 중입니다.'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ 웹 서버가 포트 ${port}에서 실행 중입니다. (Render 호스팅용)`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

// 더 자연스럽고 고품질인 Edge TTS 엔진 사용 (SunHi 목소리)
const tts = new EdgeTTS({
    voice: 'ko-KR-SunHiNeural',
    lang: 'ko-KR',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
});

const guildState = new Map();

// 오디오 파일 저장용 임시 폴더
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// 봇이 준비되었을 때
client.once(Events.ClientReady, async () => {
    console.log(`✅ 로그인 성공: ${client.user.tag}`);
    client.user.setActivity('/입장 | 한국어 TTS 봇', { type: 'PLAYING' });
    
    // 슬래시 명령어 등록
    const commands = [
        {
            name: '입장',
            description: '현재 접속 중인 음성 채널에 봇을 부르고, 이 채팅 채널의 메시지를 읽기 시작합니다.',
        },
        {
            name: '퇴장',
            description: '봇을 음성 채널에서 내보내고 메시지 읽기를 중지합니다.',
        },
        {
            name: '채팅삭제',
            description: '원하는 개수만큼 최근 채팅을 한 번에 삭제합니다.',
            options: [
                {
                    name: '개수',
                    description: '삭제할 메시지 개수 (1~100)',
                    type: 4, // ApplicationCommandOptionType.Integer
                    required: true,
                    min_value: 1,
                    max_value: 100
                }
            ]
        }
    ];

    try {
        // 글로벌 명령어 등록 (이제 완전히 반영되었으므로 이것만 사용)
        await client.application.commands.set(commands);
        
        // 중복 방지를 위해 서버(길드)에 개별 등록했던 명령어는 싹 지움
        for (const [id, guild] of client.guilds.cache) {
            await guild.commands.set([]);
        }
        
        console.log('✅ 슬래시 명령어 등록 완료 (/입장, /퇴장, /채팅삭제 사용 가능)');
    } catch (error) {
        console.error('명령어 등록 오류:', error);
    }
});

// 봇이 새로운 서버에 초대되었을 때
client.on(Events.GuildCreate, async guild => {
    // 글로벌 명령어가 알아서 적용되므로 개별 등록은 더 이상 하지 않음
    try {
        await guild.commands.set([]);
    } catch (console) {}
});

async function playNext(guildId) {
    const state = guildState.get(guildId);
    if (!state || state.queue.length === 0) {
        if (state) state.isPlaying = false;
        return;
    }

    state.isPlaying = true;
    const text = state.queue.shift();
    const tempFilePath = path.join(tempDir, `${guildId}_${Date.now()}.mp3`);

    try {
        await tts.ttsPromise(text, tempFilePath);
        const resource = createAudioResource(tempFilePath);
        state.player.play(resource);
        
        // 삭제를 위해 현재 재생중인 파일 경로 저장
        state.currentFile = tempFilePath;
    } catch (error) {
        console.error('TTS 변환 오류:', error);
        // 오류 발생 시 다음 큐로 바로 넘김
        playNext(guildId);
    }
}

// 텍스트를 읽기 좋게 전처리하는 함수 (초성, 은어 등)
function processText(text) {
    let t = text;
    
    // 자주 쓰는 초성 및 단어 사전 (우선순위 높음)
    const dict = {
        '네조': '네조 멍청이',
        'ㅄ': '븅신',
        'ㅂㅅ': '븅신',
        'ㅅㅂ': '씨이발',
        'ㅆㅂ': '씨이발',
        'ㅈㄴ': '존나',
        'ㅇㅈ': '인정',
        'ㅇㅇ': '응응',
        'ㄴㄴ': '노노',
        'ㄱㄱ': '고고',
        'ㅁㅊ': '미친',
        'ㅅㄱ': '수고',
        'ㅂㅂ': '바이바이',
        'ㅎㅇ': '하이',
        'ㅉㅉ': '쯧쯧',
        'ㅇㅋ': '오케이'
    };
    
    for (const [key, value] of Object.entries(dict)) {
        const regex = new RegExp(key, 'g');
        t = t.replace(regex, value);
    }

    // 낱자 모음/자음 자연스럽게 읽기 (예: 아ㅏㅏㅏ -> 아아아아)
    const jamoDict = {
        'ㅏ': '아', 'ㅑ': '야', 'ㅓ': '어', 'ㅕ': '여',
        'ㅗ': '오', 'ㅛ': '요', 'ㅜ': '우', 'ㅠ': '유',
        'ㅡ': '으', 'ㅣ': '이', 'ㅐ': '애', 'ㅒ': '얘',
        'ㅔ': '에', 'ㅖ': '예',
        'ㅋ': '크', 'ㅎ': '흐'
    };

    for (const [key, value] of Object.entries(jamoDict)) {
        const regex = new RegExp(key, 'g');
        t = t.replace(regex, value);
    }
    
    return t;
}

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === '입장') {
        const voiceChannel = interaction.member?.voice.channel;
        
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ 먼저 음성 채널에 접속해주세요!', ephemeral: true });
        }

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });

            const player = createAudioPlayer();
            connection.subscribe(player);
            
            player.on(AudioPlayerStatus.Idle, () => {
                const state = guildState.get(interaction.guild.id);
                if (state && state.currentFile) {
                    try {
                        if (fs.existsSync(state.currentFile)) {
                            fs.unlinkSync(state.currentFile);
                        }
                    } catch (e) { console.error('임시 파일 삭제 오류:', e); }
                }
                playNext(interaction.guild.id);
            });

            guildState.set(interaction.guild.id, {
                textChannelId: interaction.channelId,
                voiceChannelId: voiceChannel.id,
                connection: connection,
                player: player,
                queue: [],
                isPlaying: false,
                currentFile: null
            });

            return interaction.reply(`✅ **${voiceChannel.name}** 채널에 입장했습니다!\n이제부터 이 채팅 채널(**${interaction.channel.name}**)에 올라오는 메시지를 읽어줍니다.`);
        } catch (error) {
            console.error(error);
            return interaction.reply({ content: '❌ 음성 채널 접속 중 오류가 발생했습니다.', ephemeral: true });
        }
    }

    if (interaction.commandName === '퇴장') {
        const connection = getVoiceConnection(interaction.guild.id);
        
        if (!connection) {
            return interaction.reply({ content: '❌ 봇이 현재 어떤 음성 채널에도 접속해있지 않습니다.', ephemeral: true });
        }

        connection.destroy();
        guildState.delete(interaction.guild.id);
        return interaction.reply('👋 음성 채널에서 퇴장하고 텍스트 읽기를 중지했습니다.');
    }

    if (interaction.commandName === '채팅삭제') {
        // 권한 확인 (서버에서 메시지 관리 권한이 있는 사람만 사용 가능)
        if (!interaction.member.permissions.has('ManageMessages')) {
            return interaction.reply({ content: '❌ 이 명령어를 사용할 권한(메시지 관리)이 없습니다.', ephemeral: true });
        }

        const amount = interaction.options.getInteger('개수');

        try {
            // 메시지 삭제 진행 (true: 14일 지난 메시지로 인한 오류 무시)
            const deleted = await interaction.channel.bulkDelete(amount, true);
            return interaction.reply({ content: `✅ 성공적으로 ${deleted.size}개의 메시지를 삭제했습니다!`, ephemeral: true });
        } catch (error) {
            console.error('메시지 삭제 오류:', error);
            return interaction.reply({ content: '❌ 메시지를 삭제하는 중 오류가 발생했습니다. (14일이 지난 메시지는 삭제할 수 없습니다.)', ephemeral: true });
        }
    }
});

client.on(Events.MessageCreate, async (message) => {
    // 봇의 메시지는 무시
    if (message.author.bot) return;

    let state = guildState.get(message.guild.id);

    // 봇이 현재 음성 채널에 연결되어 있지 않은데,
    // 유저가 자신이 속한 음성 채널의 '내장 채팅창'에 메시지를 보낸 경우 자동 입장
    if (!state && message.member?.voice?.channelId === message.channel.id) {
        const voiceChannel = message.member.voice.channel;
        
        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            const player = createAudioPlayer();
            connection.subscribe(player);
            
            player.on(AudioPlayerStatus.Idle, () => {
                const s = guildState.get(message.guild.id);
                if (s && s.currentFile) {
                    try {
                        if (fs.existsSync(s.currentFile)) {
                            fs.unlinkSync(s.currentFile);
                        }
                    } catch (e) { console.error('임시 파일 삭제 오류:', e); }
                }
                playNext(message.guild.id);
            });

            state = {
                textChannelId: message.channel.id,
                voiceChannelId: voiceChannel.id,
                connection: connection,
                player: player,
                queue: [],
                isPlaying: false,
                currentFile: null
            };
            
            guildState.set(message.guild.id, state);
        } catch (error) {
            console.error('자동 입장 오류:', error);
            return;
        }
    }

    // 위 과정을 거쳤는데도 state가 없으면 무시
    if (!state) return;

    // 입장한 텍스트 채널의 메시지만 처리
    if (state.textChannelId === message.channel.id) {
        // 메시지가 너무 길면 자르기 (200자 제한)
        let text = message.content.substring(0, 200).trim();
        
        // 빈 메시지 무시
        if (!text) return;

        // 초성 및 은어 전처리
        text = processText(text);

        state.queue.push(text);
        if (!state.isPlaying) {
            playNext(message.guild.id);
        }
    }
});

// 음성 채널 상태 변경 감지 (사람이 없으면 자동 퇴장)
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const state = guildState.get(oldState.guild.id);
    if (!state) return;

    // 만약 상태 변화가 있었던 채널이 봇이 있는 채널이라면
    if (oldState.channelId === state.voiceChannelId) {
        const channel = oldState.guild.channels.cache.get(state.voiceChannelId);
        
        if (channel) {
            // 채널에 봇 외의 유저가 있는지 확인
            const members = channel.members.filter(m => !m.user.bot);
            
            if (members.size === 0) {
                // 모두 나갔으면 봇도 퇴장
                if (state.connection) {
                    state.connection.destroy();
                }
                guildState.delete(oldState.guild.id);
                
                // 텍스트 채널에 알림 메시지 보내기
                const textChannel = oldState.guild.channels.cache.get(state.textChannelId);
                if (textChannel) {
                    textChannel.send('👋 음성 채널에 아무도 없어서 자동으로 퇴장하고 TTS 읽기를 중단했습니다.');
                }
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
