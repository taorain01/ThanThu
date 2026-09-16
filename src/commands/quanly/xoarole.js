/**
 * ?xoarole - Lệnh xóa toàn bộ role thường trong server, chỉ giữ lại các role chỉ định
 * Chỉ OWNER_ID mới có quyền thực hiện
 * Chỉ áp dụng cho server 450633680000385036
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');

const OWNER_ID = '395151484179841024';
const TARGET_GUILD_ID = '450633680000385036';

// 6 Role được chỉ định giữ lại (ID và Tên)
const KEEP_ROLES = [
    { id: '1442772617282191362', name: 'WWM' },
    { id: '1119518101336236113', name: 'LMHT' },
    { id: '1119584584657551420', name: 'ARAM' },
    { id: '532813820599468032',  name: 'LOL' },
    { id: '1385594110496346216', name: '🙂‍↔️' },
    { id: '1385592587418734703', name: 'Des' },
];

const KEEP_ROLE_IDS = new Set(KEEP_ROLES.map(r => r.id));
const KEEP_ROLE_NAMES = new Set(KEEP_ROLES.map(r => r.name.toLowerCase()));

// Helper sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldKeepRole(role, guild) {
    // 1. Không xóa @everyone
    if (role.id === guild.id || role.name === '@everyone') return true;

    // 2. Không xóa các role nằm trong danh sách whitelist giữ lại
    if (KEEP_ROLE_IDS.has(role.id) || KEEP_ROLE_NAMES.has(role.name.toLowerCase())) return true;

    // 3. Không xóa role do Bot / Discord tự quản lý (managed / booster / bot integration)
    if (role.managed) return true;

    // 4. Không thể xóa role cao hơn role cao nhất của bot (Discord không cho phép)
    if (!role.editable) return true;

    return false;
}

async function execute(message, args) {
    // Kiểm tra quyền Owner
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Bạn không có quyền thực hiện lệnh này! Chỉ Owner bot mới có thể dùng.');
    }

    const guild = message.guild;
    if (!guild) {
        return message.reply('❌ Lệnh này chỉ có thể sử dụng bên trong server!');
    }

    if (guild.id !== TARGET_GUILD_ID) {
        return message.reply(`❌ Lệnh này chỉ được cấu hình cho server \`${TARGET_GUILD_ID}\`!`);
    }

    const isDirectConfirm = args[0] && args[0].toLowerCase() === 'confirm';

    // Fetch toàn bộ role mới nhất từ Discord
    await guild.roles.fetch();
    const botMember = await guild.members.fetch(message.client.user.id);

    const allRoles = Array.from(guild.roles.cache.values());
    const rolesToDelete = allRoles.filter(r => !shouldKeepRole(r, guild));
    const rolesKept = allRoles.filter(r => shouldKeepRole(r, guild));

    if (rolesToDelete.length === 0) {
        return message.reply('✅ Không có role nào cần xóa! Tất cả các role hiện tại đều thuộc danh sách giữ lại hoặc role hệ thống.');
    }

    // Nếu gõ trực tiếp ?xoarole confirm
    if (isDirectConfirm) {
        return runDeletion(message, rolesToDelete, rolesKept);
    }

    // Tạo Embed xem trước & cảnh báo
    const previewKeep = KEEP_ROLES.map(r => `• **${r.name}** (\`${r.id}\`)`).join('\n');
    const previewDeleteSample = rolesToDelete.slice(0, 15).map(r => `• ${r.name} (\`${r.id}\`)`).join('\n');
    const remainingCount = rolesToDelete.length - 15;

    const confirmEmbed = new EmbedBuilder()
        .setColor(0xFF3366)
        .setTitle('⚠️ XÁC NHẬN XÓA TOÀN BỘ ROLE KHÔNG THUỘC DANH SÁCH')
        .setDescription(
            `Server: **${guild.name}**\n` +
            `Bot quyền cao nhất: **${botMember.roles.highest.name}** (vị trí: ${botMember.roles.highest.position})\n\n` +
            `🔒 **CÁC ROLE ĐƯỢC GIỮ LẠI (6 Role chỉ định):**\n${previewKeep}\n` +
            `*(Kèm theo role hệ thống @everyone, các role bot/integration không thể xóa)*\n\n` +
            `🗑️ **SỐ ROLE SẼ BỊ XÓA:** **${rolesToDelete.length}** role\n` +
            `${previewDeleteSample}${remainingCount > 0 ? `\n... và **${remainingCount}** role khác.` : ''}\n\n` +
            `⚠️ **LƯU Ý:** Hành động này **KHÔNG THỂ HOÀN TÁC**!\n` +
            `Bấm nút **Xác nhận Xóa** bên dưới hoặc gõ \`?xoarole confirm\` để tiến hành.`
        )
        .setFooter({ text: 'Yêu cầu sẽ tự hủy sau 60 giây nếu không xác nhận' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('confirm_clear_roles')
            .setLabel(`Xác nhận Xóa (${rolesToDelete.length} role)`)
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️'),
        new ButtonBuilder()
            .setCustomId('cancel_clear_roles')
            .setLabel('Hủy bỏ')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
    );

    const promptMsg = await message.reply({
        embeds: [confirmEmbed],
        components: [row]
    });

    const collector = promptMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === message.author.id,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        if (interaction.customId === 'cancel_clear_roles') {
            await interaction.update({
                content: '❌ Đã hủy lệnh xóa role. Không có thay đổi nào được thực hiện.',
                embeds: [],
                components: []
            });
            collector.stop('cancelled');
            return;
        }

        if (interaction.customId === 'confirm_clear_roles') {
            await interaction.update({
                content: '⏳ Đang khởi tạo quá trình xóa role...',
                components: []
            });
            collector.stop('confirmed');
            return runDeletion(message, rolesToDelete, rolesKept, promptMsg);
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time') {
            await promptMsg.edit({
                content: '⌛ Đã hết thời gian xác nhận (60s). Lệnh xóa role đã tự động hủy.',
                components: []
            }).catch(() => {});
        }
    });
}

/**
 * Thực hiện xóa danh sách role với safe rate limit delay
 */
async function runDeletion(message, rolesToDelete, rolesKept, existingMsg = null) {
    const total = rolesToDelete.length;
    let deletedCount = 0;
    let failedCount = 0;
    const failedRoles = [];

    const statusEmbed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('🚀 ĐANG TIẾN HÀNH XÓA ROLE...')
        .setDescription(`Tiến độ: **0 / ${total}** role đã xóa...\nVui lòng không tắt bot!`)
        .setTimestamp();

    let progressMsg;
    if (existingMsg) {
        progressMsg = await existingMsg.edit({ content: null, embeds: [statusEmbed] });
    } else {
        progressMsg = await message.reply({ embeds: [statusEmbed] });
    }

    console.log(`[XoaRole] Bắt đầu xóa ${total} role trong server ${message.guild.name}...`);

    for (let i = 0; i < total; i++) {
        const role = rolesToDelete[i];
        try {
            console.log(`[XoaRole] [${i + 1}/${total}] Đang xóa role: "${role.name}" (${role.id})...`);
            await role.delete('Xóa role hàng loạt theo yêu cầu của Owner');
            deletedCount++;
        } catch (err) {
            console.error(`[XoaRole] Lỗi khi xóa role "${role.name}" (${role.id}):`, err.message);
            failedCount++;
            failedRoles.push(`${role.name} (${err.message})`);
        }

        // Cập nhật progress mỗi 10 role hoặc ở role cuối cùng
        if ((i + 1) % 10 === 0 || i === total - 1) {
            statusEmbed.setDescription(
                `Tiến độ: **${i + 1} / ${total}**\n` +
                `✅ Đã xóa: **${deletedCount}**\n` +
                `❌ Lỗi: **${failedCount}**\n` +
                `Đang xử lý tiếp...`
            );
            await progressMsg.edit({ embeds: [statusEmbed] }).catch(() => {});
        }

        // Delay 700ms giữa các lần gọi API để an toàn tránh rate limit Discord
        await sleep(700);
    }

    // Embed tổng kết
    const finishedEmbed = new EmbedBuilder()
        .setColor(failedCount === 0 ? 0x2ECC71 : 0xF1C40F)
        .setTitle('✅ HOÀN TẤT TIẾN TRÌNH XÓA ROLE')
        .setDescription(
            `🏠 Server: **${message.guild.name}**\n\n` +
            `📊 **KẾT QUẢ:**\n` +
            `• Tổng số role cần xóa: **${total}**\n` +
            `• Đã xóa thành công: **${deletedCount}**\n` +
            `• Thất bại / Bỏ qua: **${failedCount}**\n\n` +
            `🔒 **CÁC ROLE ĐÃ ĐƯỢC GIỮ LẠI:**\n` +
            KEEP_ROLES.map(r => `• **${r.name}** (\`${r.id}\`)`).join('\n') +
            `\n*(và các role hệ thống bot/managed không thể xóa)*` +
            (failedRoles.length > 0 ? `\n\n⚠️ **Chi tiết role lỗi:**\n${failedRoles.slice(0, 10).join('\n')}` : '')
        )
        .setFooter({ text: 'Hoàn tất lúc' })
        .setTimestamp();

    await progressMsg.edit({ embeds: [finishedEmbed] }).catch(() => {});
    console.log(`[XoaRole] Hoàn tất! Thành công: ${deletedCount}, Thất bại: ${failedCount}`);
}

module.exports = {
    name: 'xoarole',
    aliases: ['clearroles', 'xoatoanborole'],
    description: 'Xóa toàn bộ role thường trong server, chỉ giữ lại các role chỉ định',
    execute
};
