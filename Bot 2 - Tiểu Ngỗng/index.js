require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });

const {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require("discord.js");
const {
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} = require("@discordjs/voice");

const token = process.env.BOT2_TOKEN || process.env.TIEU_NGONG_TOKEN || process.env.BRIDGE_BOT_TOKEN;
const prefix = process.env.BOT2_PREFIX || "!";
const allowedGuildId = process.env.BOT2_GUILD_ID || "";
const defaultVoiceChannelId = process.env.BOT2_VOICE_CHANNEL_ID || "";
const adminOnly = String(process.env.BOT2_ADMIN_ONLY || "true").toLowerCase() !== "false";

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
      if (!canControlBot(message)) return message.reply("Ban khong co quyen dieu khien Bot 2.");
      return joinVoice(message, args);
    }

    if (command === "leave") {
      if (!canControlBot(message)) return message.reply("Ban khong co quyen dieu khien Bot 2.");
      return leaveVoice(message);
    }

    if (command === "bot2help") {
      return message.reply([
        "`!ping` - test Bot 2",
        "`!bot2` - xem trang thai",
        "`!join [voiceChannelId]` - cho Bot 2 vao voice",
        "`!leave` - cho Bot 2 roi voice",
      ].join("\n").replaceAll("!", prefix));
    }
  } catch (error) {
    console.error(`[Bot2] Command ${command} failed:`, error);
    return message.reply(`Loi Bot 2: ${error.message}`);
  }
});

function canControlBot(message) {
  if (!adminOnly) return true;

  const permissions = message.member?.permissions;
  return Boolean(
    permissions?.has(PermissionFlagsBits.Administrator) ||
    permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

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

async function joinVoice(message, args) {
  const channel = await resolveVoiceChannel(message, args);
  if (!channel) {
    return message.reply("Hay vao voice truoc, hoac dung `!join <voiceChannelId>`.".replace("!", prefix));
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
    }
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  return message.reply(`Bot 2 da vao voice: ${channel.name}`);
}

async function leaveVoice(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) return message.reply("Bot 2 chua o trong voice.");

  connection.destroy();
  return message.reply("Bot 2 da roi voice.");
}

async function resolveVoiceChannel(message, args) {
  const requestedId = args[0]?.match(/\d{15,25}/)?.[0] || defaultVoiceChannelId;

  if (requestedId) {
    const channel = await message.guild.channels.fetch(requestedId).catch(() => null);
    if (channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice) {
      return channel;
    }
  }

  const memberVoice = message.member?.voice?.channel;
  if (memberVoice?.type === ChannelType.GuildVoice || memberVoice?.type === ChannelType.GuildStageVoice) {
    return memberVoice;
  }

  return null;
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
