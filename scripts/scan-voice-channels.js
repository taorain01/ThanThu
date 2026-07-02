/**
 * Quét danh sách kênh voice + role của guild rồi ghi lên Supabase (voice_relay_guild_meta)
 * để trang voice-editor.html có dữ liệu cho dropdown.
 *
 * - Bỏ qua các kênh voice ẩn (những kênh mà @everyone KHÔNG có quyền View Channel).
 * - Dùng token bot chính (Đại Ngỗng) và Supabase service key trong .env ở thư mục gốc.
 *
 * Chạy 1 lần bằng:  node scripts/scan-voice-channels.js
 */

require('dotenv').config();
// Nguồn token dự phòng: .env của Bot 2 (Tiểu Ngỗng) nếu .env gốc không có token.
try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', 'Bot 2 - Tiểu Ngỗng', '.env') });
} catch (_) { /* bỏ qua nếu không có */ }
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const GUILD_ID = process.env.SCAN_GUILD_ID || '450633680000385036';
const TOKEN = process.env.token || process.env.DISCORD_TOKEN || process.env.BOT2_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function die(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

if (!TOKEN) die('Thiếu biến "token" trong .env (token bot Đại Ngỗng).');
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) die('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_KEY trong .env.');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', run);
client.once('ready', run); // tương thích discord.js cũ hơn

let done = false;
async function run() {
  if (done) return;
  done = true;
  try {
    console.log(`✅ Đăng nhập: ${client.user.tag}`);
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();

    const everyone = guild.roles.everyone;

    // --- Kênh voice công khai (bỏ kênh ẩn) ---
    const voiceChannels = [];
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
      const perms = channel.permissionsFor(everyone);
      const visible = perms && perms.has(PermissionsBitField.Flags.ViewChannel);
      if (!visible) {
        console.log(`   · Bỏ qua kênh ẩn: ${channel.name}`);
        continue;
      }
      voiceChannels.push({ id: channel.id, name: channel.name });
    }
    voiceChannels.sort((a, b) => a.name.localeCompare(b.name, 'vi'));

    // --- Role (bỏ @everyone và role do bot/integration quản lý) ---
    const roles = [];
    for (const role of guild.roles.cache.values()) {
      if (role.id === guild.id) continue; // @everyone
      if (role.managed) continue;         // role của bot/booster/integration
      roles.push({ id: role.id, name: role.name, position: role.position });
    }
    roles.sort((a, b) => b.position - a.position);
    const rolesOut = roles.map(({ id, name }) => ({ id, name }));

    console.log(`📋 Kênh voice công khai: ${voiceChannels.length} | Role: ${rolesOut.length}`);

    const { error } = await supabase
      .from('voice_relay_guild_meta')
      .upsert({
        guild_id: GUILD_ID,
        voice_channels: voiceChannels,
        roles: rolesOut,
        updated_at: new Date().toISOString()
      }, { onConflict: 'guild_id' });

    if (error) throw error;
    console.log('✅ Đã ghi lên Supabase (voice_relay_guild_meta). Xong!');
  } catch (err) {
    console.error('❌ Lỗi:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
    process.exit(process.exitCode || 0);
  }
}

client.login(TOKEN).catch((e) => die('Đăng nhập Discord thất bại: ' + e.message));
