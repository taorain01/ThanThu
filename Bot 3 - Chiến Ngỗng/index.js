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

const token = process.env.BOT3_TOKEN || process.env.CHIEN_NGONG_TOKEN;
const prefix = process.env.BOT3_PREFIX || "#";
const allowedGuildId = process.env.BOT3_GUILD_ID || process.env.VOICE_RELAY_GUILD_ID || "";
const defaultVoiceChannelId = process.env.BOT3_VOICE_CHANNEL_ID || "";
const adminOnly = String(process.env.BOT3_ADMIN_ONLY || "true").toLowerCase() !== "false";

if (!token) {
  console.error("[Bot3] Missing BOT3_TOKEN in Bot 3 - Chien Ngong/.env");
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
  console.log(`[Bot3] Logged in as ${client.user.tag}`);
  console.log(`[Bot3] Prefix: ${prefix}`);
  try {
    const { initVoiceRelay } = require("../src/voiceRelay");
    await initVoiceRelay(client, { defaultBotId: 3, botName: "Chiến Ngỗng" });
  } catch (error) {
    console.error("[Bot3][VoiceRelay] Khong khoi dong duoc:", error.message);
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

    if (command === "bot3" || command === "cngong" || command === "chienngong") {
      return sendStatus(message);
    }

    if (command === "join") {
      if (!canControlBot(message)) return message.reply("Ban khong co quyen dieu khien Bot 3.");
      return joinVoice(message, args);
    }

    if (command === "leave") {
      if (!canControlBot(message)) return message.reply("Ban khong co quyen dieu khien Bot 3.");
      return leaveVoice(message);
    }
  } catch (error) {
    console.error(`[Bot3] Command ${command} failed:`, error);
    return message.reply(`Loi Bot 3: ${error.message}`);
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
    .setTitle("Bot 3 - Chien Ngong")
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
    return message.reply("Hay vao voice truoc, hoac dung `#join <voiceChannelId>`.".replace("#", prefix));
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
  return message.reply(`Bot 3 da vao voice: ${channel.name}`);
}

async function leaveVoice(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) return message.reply("Bot 3 chua o trong voice.");

  connection.destroy();
  return message.reply("Bot 3 da roi voice.");
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
