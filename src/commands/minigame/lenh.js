/**
 * ?lenh - Danh sách lệnh minigame ngắn gọn
 */

const { EmbedBuilder } = require('discord.js');

async function execute(message, args) {
    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📜 DANH SÁCH LỆNH MINIGAME')
        .setDescription(`
**💰 Kinh tế:**
• \`?bal\` \`?tien\` \`?hat\` - Xem số dư
• \`?nhua\` \`?item\` \`?vatpham\` - Xem vật phẩm
• \`?daily\` - Nhận thưởng ngày
• \`?weekly\` - Nhận thưởng tuần

**🛒 Mua sắm:**
• \`?shop\` - Xem cửa hàng
• \`?buy box [số]\` - Mua box (100 Hạt/box)
• \`?buy lcp [số]\` - Mua Lửa Cầu Phúc (10k Hạt)
• \`?buy dd [số]\` - Mua Đá Đen (200 Đá T1)
• \`?buy slot\` - Mở rộng kho (giá leo thang)

**📦 Trang bị:**
• \`?box [số]\` - Mua & mở box nhanh
• \`?inv\` \`?tuido\` \`?kho\` - Xem kho đồ
• \`?equip <id>\` \`?gan\` - Gắn trang bị
• \`?unequip <id>\` \`?go\` - Gỡ trang bị
• \`?trangbi\` - Xem đồ đang mặc
• \`?tune\` \`?nc\` - Nâng cấp trang bị
• \`?tune <id>\` - Tune nhanh theo ID
• \`?tune <id> <1-4>\` - Tune nhiều dòng
• \`?dismantle\` \`?phantach\` - Phân tách đồ Tím
• \`?ban\` - Bán đồ (select menu)
• \`?lock <id>\` - Khóa/mở khóa trang bị
• \`?xem <id>\` - Xem chi tiết item

**🌑 Đá Đen & Khắc Dòng:**
• \`?daden <id>\` \`?dd\` - Hút dòng từ trang bị
• \`?ddlist\` - Xem danh sách Đá Đen
• \`?khacda <stone_id> <target_id> <line>\` - Khắc dòng

**🔥 Lửa Cầu Phúc:**
• \`?use lcp\` - Đốt Lửa Cầu Phúc (+15% vàng, 2h)
• \`?use lcpcl\` - Đốt LCP Cỡ Lớn (+30% vàng, 4h)

**⚔️ Bí Cảnh:**
• \`?dung\` \`?bicanh\` - Đi bí cảnh
• \`?huydung\` \`?huybicanh\` - Hủy bí cảnh

**📋 Nhiệm vụ & Khác:**
• \`?q\` \`?nv\` \`?quest\` - Xem nhiệm vụ
• \`?lb\` \`?top\` \`?bxh\` - Bảng xếp hạng
• \`?pickrole\` - Chọn phái (DPS/Tanker/Healer)
• \`?info\` \`?i\` - Thông tin người chơi
• \`?thanhtuu\` \`?ach\` - Thành tựu
• \`?huongdan\` \`?hd\` - Hướng dẫn chi tiết
        `.trim())
        .setFooter({ text: '💡 Xem hướng dẫn chi tiết: ?huongdan' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };


