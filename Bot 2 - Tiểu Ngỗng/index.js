require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });

const {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
} = require("discord.js");
const { getVoiceConnection } = require("@discordjs/voice");
const {
  executeTtsCommand,
  handleTtsAutoRead,
} = require("../src/utils/ttsCommandHelper");

const token = process.env.BOT2_TOKEN || process.env.TIEU_NGONG_TOKEN || process.env.BRIDGE_BOT_TOKEN;
const prefix = process.env.BOT2_PREFIX || "!";
const allowedGuildId = process.env.BOT2_GUILD_ID || "";
const defaultVoiceChannelId = process.env.BOT2_VOICE_CHANNEL_ID || "";

if (!token) {
  console.error("[Bot2] Missing BOT2_TOKEN in Bot 2 - Tieu Ngong/.env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once("ready", async () => {
  console.log(`[Bot2] Logged in as ${client.user.tag}`);
  console.log(`[Bot2] Prefix: ${prefix}`);
  try {
    const { initVoiceRelay } = require("../src/voiceRelay");
    await initVoiceRelay(client, { defaultBotId: 2, botName: "Tiểu Ngỗng" });
  } catch (error) {
    console.error("[Bot2][VoiceRelay] Khong khoi dong duoc:", error.message);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (allowedGuildId && message.guild.id !== allowedGuildId) return;

  const { handleVoiceRelayMessage } = require("../src/voiceRelay");
  if (await handleVoiceRelayMessage(message, client)) return;

  if (await handleTtsAutoRead(message, { client, botName: "Tiểu Ngỗng" })) return;

  // Lệnh TTS chung ?join/?leave/?stop — pool 3 bot, bot nào rảnh thì vào, mỗi phòng 1 bot.
  const ttsPrefix = process.env.TTS_COMMAND_PREFIX || "?";
  if (ttsPrefix !== prefix && message.content.startsWith(ttsPrefix)) {
    const [sharedCmd, ...sharedArgs] = message.content.slice(ttsPrefix.length).trim().split(/\s+/);
    const sc = sharedCmd?.toLowerCase();
    if (["join", "leave", "stop"].includes(sc)) {
      return executeTtsCommand(message, sharedArgs, {
        client,
        prefix: ttsPrefix,
        commandName: sc,
        botName: "Tiểu Ngỗng",
        allowVoiceChannelId: true,
        defaultVoiceChannelId,
        smartPool: true,
        isResponder: false, // prefix gốc của Tiểu Ngỗng là '!' nên không phát thông báo chung
      });
    }
  }

  if (!message.content.startsWith(prefix)) return;

  const [commandName, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = commandName?.toLowerCase();

  try {
    if (command === "ping") {
      return message.reply(`Pong ${Math.round(client.ws.ping)}ms`);
    }

    if (command === "bot2" || command === "tngong" || command === "tieungong") {
      return sendStatus(message);
    }

    if (command === "join") {
      return executeTtsCommand(message, args, {
        client,
        prefix,
        commandName: command,
        botName: "Tiểu Ngỗng",
        allowVoiceChannelId: true,
        defaultVoiceChannelId,
      });
    }

    if (command === "leave") {
      return executeTtsCommand(message, args, {
        client,
        prefix,
        commandName: command,
        botName: "Tiểu Ngỗng",
        allowVoiceChannelId: true,
        defaultVoiceChannelId,
      });
    }

    if (command === "stop") {
      return executeTtsCommand(message, args, {
        client,
        prefix,
        commandName: command,
        botName: "Tiểu Ngỗng",
        allowVoiceChannelId: true,
        defaultVoiceChannelId,
      });
    }

    if (command === "bot2help") {
      return message.reply([
        "`!ping` - test Bot 2",
        "`!bot2` - xem trang thai",
        "`!join [voiceChannelId]` - cho Bot 2 vào voice TTS",
        "`!leave` - cho Bot 2 rời voice TTS",
        "`!stop` - dừng đọc TTS",
        "`.nội dung` - đọc TTS khi bạn ở cùng voice với bot",
      ].join("\n").replaceAll("!", prefix));
    }
  } catch (error) {
    console.error(`[Bot2] Command ${command} failed:`, error);
    return message.reply(`Loi Bot 2: ${error.message}`);
  }
});

async function sendStatus(message) {
  const connection = getVoiceConnection(message.guild.id);
  const embed = new EmbedBuilder()
    .setColor(connection ? 0x22c55e : 0x94a3b8)
    .setTitle("Bot 2 - Tieu Ngong")
    .addFields(
      { name: "Status", value: client.user ? "online" : "offline", inline: true },
      { name: "Ping", value: `${Math.round(client.ws.ping)}ms`, inline: true },
      { name: "Voice", value: connection ? connection.state.status : "not connected", inline: true }
    )
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  for (const guild of client.guilds.cache.values()) {
    getVoiceConnection(guild.id)?.destroy();
  }
  client.destroy();
  process.exit(0);
}

client.login(token);
