/**
 * ?huongdan - Hướng dẫn chơi minigame
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PAGES = [
    // Page 1: Giới thiệu
    {
        title: '📖 MINI GAME LANGGIA',
        color: 0x3498DB,
        description: `**Chào mừng đến với Mini Game LangGia!**

🎯 **Mục tiêu:** Chill theo cách của bạn
• Thu thập trang bị Vàng cho 8 slot
• Tune (nâng cấp) từng món để tăng Mastery
• Cạnh tranh bảng xếp hạng Mastery
• Khám phá hệ thống Đá Đen & Khắc Dòng

⚔️ **3 Phái:**
• **DPS** - Tập trung Công/Xuyên
• **Tanker** - Tập trung Máu/Giáp  
• **Healer** - Tập trung Hồi/Công

💡 Dùng \`?pickrole\` để chọn phái!
📜 Xem nhanh các lệnh: \`?lenh\``,
        footer: 'Trang 1/6 • Tiền tệ & Mua sắm →'
    },

    // Page 2: Tiền tệ & Mua sắm
    {
        title: '💰 TIỀN TỆ & MUA SẮM',
        color: 0x2ECC71,
        description: `**Các loại tiền tệ & vật phẩm:**

🌾 **Hạt** - Tiền chính
• Nhận từ: \`?daily\`, \`?weekly\`, nhiệm vụ, bán đồ
• Dùng để: Mua Box, LCP, Slot kho

📦 **Box T1** - 100 Hạt/box
• Mở ra trang bị Tím/Vàng ngẫu nhiên
• Lệnh: \`?buy box [số]\` hoặc \`?box [số]\`

💎 **Đá T1** - Từ phân tách đồ Tím
• Tune dòng trang bị Vàng
• Đổi Đá Đen: 200 Đá T1 = 1 Đá Đen

🔮 **Thạch Âm** - Từ Bí Cảnh
• Tune dòng vàng trên trang bị

🌑 **Đá Đen** - Hệ thống Khắc Dòng
• Lệnh: \`?buy dd [số]\` (200 Đá T1/viên)

🔥 **Lửa Cầu Phúc** - Tăng tỉ lệ vàng
• Lệnh: \`?buy lcp [số]\` (10k Hạt/viên)`,
        footer: 'Trang 2/6 • ← Giới thiệu | Trang bị →'
    },

    // Page 3: Trang bị
    {
        title: '🎽 TRANG BỊ & TUNE',
        color: 0xF1C40F,
        description: `**Hệ thống Tune:**
• Trang bị Vàng có 6 dòng stat
• Tune = đổi stat ngẫu nhiên
• Dòng tím: Đá T1
• Dòng vàng: Thạch Âm

🌑 **Đá Đen & Khắc Dòng:**
• Hút dòng từ trang bị: \`?daden <id_nguồn>\`
• Chuyển dòng sang trang bị khác
• Xem danh sách đá: \`?ddlist\`

💡 \`?tune\` nâng cấp | \`?daden\` khắc dòng!`,
        footer: 'Trang 3/6 • ← Tiền tệ | Bí Cảnh →'
    },

    // Page 4: Dungeon
    {
        title: '⚔️ BÍ CẢNH (DUNGEON)',
        color: 0xE67E22,
        description: `**Hệ thống Bí Cảnh:**

💧 **Nhựa** - Thể lực
• Tự động hồi theo thời gian
• Tối đa 500 nhựa
• Dùng để farming Bí Cảnh

🏃 **Bí Cảnh Solo**
• Đi một mình, phần thưởng cơ bản
• Chọn mức x1, x2, x3 nhân phần thưởng
• Lệnh: \`?dung\` hoặc \`?bicanh\`

👥 **Bí Cảnh Coop** (5 người + AI)
• Rủ bạn bè hoặc đi với AI
• Combo phái tăng sát thương

🎁 **Phần thưởng:**
• Box T1, Hạt, Thạch Âm`,
        footer: 'Trang 4/6 • ← Trang bị | Nhiệm vụ →'
    },

    // Page 5: Nhiệm vụ
    {
        title: '📋 NHIỆM VỤ',
        color: 0x9B59B6,
        description: `**Hệ thống nhiệm vụ:**

📅 **Nhiệm vụ Ngày** (Reset 00:00)
• 3 nhiệm vụ ngẫu nhiên mỗi ngày
• Phần thưởng: Hạt, Box, Đá, Thạch Âm

📆 **Nhiệm vụ Tuần** (Reset Thứ 2)
• 2 nhiệm vụ ngẫu nhiên mỗi tuần
• Phần thưởng cao hơn nhiệm vụ ngày

**Các loại nhiệm vụ:**
• Mở Box, Tune trang bị
• Phân tách đồ, Mua hàng Shop
• Gắn trang bị, Đi Bí Cảnh

💡 \`?q\` hoặc \`?quest\` để xem nhiệm vụ!`,
        footer: 'Trang 5/6 • ← Bí Cảnh | Lệnh →'
    },

    // Page 6: Danh sách lệnh
    {
        title: '⌨️ DANH SÁCH LỆNH',
        color: 0xE74C3C,
        description: `**💰 Kinh tế:**
\`?bal\` \`?tien\` - Xem số dư
\`?daily\` - Nhận thưởng ngày
\`?weekly\` - Nhận thưởng tuần
\`?nhua\` - Xem vật phẩm

**🛒 Mua sắm:**
\`?shop\` - Xem shop
\`?buy box [số]\` - Mua box
\`?buy lcp [số]\` - Mua Lửa Cầu Phúc
\`?buy dd [số]\` - Mua Đá Đen
\`?buy slot\` - Mở rộng kho

**📦 Trang bị:**
\`?box [số]\` - Mua & mở box
\`?inv\` \`?kho\` - Xem kho
\`?equip <id>\` - Gắn đồ
\`?trangbi\` - Xem đồ mặc
\`?tune\` \`?nc\` - Tune đồ
\`?dismantle\` - Phân tách
\`?ban\` - Bán đồ

**🌑 Đá Đen:**
\`?daden <id>\` - Hút dòng
\`?ddlist\` - Xem đá
\`?khacda <stone_id> <target_id> <line>\` - Khắc

**⚔️ Bí Cảnh:**
\`?dung\` \`?bicanh\` - Đi dungeon

**📋 Khác:**
\`?q\` \`?nv\` - Nhiệm vụ
\`?lb\` \`?top\` - BXH
\`?pickrole\` - Chọn phái
\`?use <item>\` - Dùng item`,
        footer: 'Trang 6/6 • ← Nhiệm vụ | Hết'
    }
];

async function execute(message, args) {
    let currentPage = 0;
    const userId = message.author.id;

    const getEmbed = (page) => {
        const data = PAGES[page];
        return new EmbedBuilder()
            .setColor(data.color)
            .setTitle(data.title)
            .setDescription(data.description)
            .setFooter({ text: data.footer })
            .setTimestamp();
    };

    const getButtons = (page) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`guide_prev_${userId}`)
                .setLabel('◀️ Trước')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`guide_page_${userId}`)
                .setLabel(`${page + 1}/${PAGES.length}`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`guide_next_${userId}`)
                .setLabel('Sau ▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === PAGES.length - 1)
        );
    };

    const reply = await message.reply({
        embeds: [getEmbed(currentPage)],
        components: [getButtons(currentPage)]
    });

    const collector = reply.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        time: 120000
    });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId === `guide_prev_${userId}`) {
                currentPage = Math.max(0, currentPage - 1);
            } else if (interaction.customId === `guide_next_${userId}`) {
                currentPage = Math.min(PAGES.length - 1, currentPage + 1);
            }

            await interaction.update({
                embeds: [getEmbed(currentPage)],
                components: [getButtons(currentPage)]
            });
        } catch (error) {
            // Xử lý các lỗi interaction hết hạn hoặc network timeout
            if (error.code === 10062 || error.code === 40060) {
                // 10062: Unknown interaction, 40060: Interaction has already been acknowledged
                try {
                    await interaction.reply({
                        content: '⚠️ Phiên đã hết hạn! Vui lòng dùng lại lệnh `?huongdan`.',
                        ephemeral: true
                    });
                } catch (e) {
                    // Nếu không thể reply, bỏ qua
                }
            } else if (error.message?.includes('Timeout') || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
                // Network timeout - không làm gì cả, để tránh crash
                console.log('[huongdan] Network timeout khi xử lý nút:', error.message);
            } else {
                console.error('[huongdan] Lỗi xử lý nút:', error);
            }
        }
    });

    collector.on('end', async () => {
        try {
            await reply.edit({ components: [] });
        } catch (e) { }
    });
}

module.exports = { execute };


