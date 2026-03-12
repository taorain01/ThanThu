/**
 * ?addhelp command - Show help for member management commands
 * Display detailed usage and permissions for all commands
 */

/**
 * Execute addhelp command
 */
async function execute(message, args) {
  const helpText = `**📚 HƯỚNG DẪN LỆNH**

**👤 ?addmem** - Thêm thành viên
\`?addmem @user <chức_vụ> <uid> <tên> [Xnt]\`
VD: \`?addmem @rain pbc 402040 Rain 19nt\`

**🆔 ?addid** - Thêm UID vào danh sách chờ (QL/KC)
\`?addid <uid> <tên_game> [Xnt]\`
VD: \`?addid 8919579 RainDiTu 33nt\`

**Chức vụ:**
• \`bc\` - Bang Chủ (Quản Lý)
• \`pbc\` - Phó BC (Quản Lý)
• \`kc\` - Kỳ Cựu (QL/KC)
• \`mem\` - Thành viên (tự thêm)

**📋 ?listmem** (\`?dsmem\`, \`?dstv\`) - DS thành viên (+ danh sách chờ)
**⏳ ?listid** (\`?listcho\`) - Chỉ xem danh sách chờ
**📝 ?listallmem** - Tất cả (cả người rời)
**👁️ ?xem** - Xem thông tin
  • \`?xem @user\` - Tag người dùng
  • \`?xem 12345\` - Tìm theo UID
  • \`?xem RainĐiTu\` - Tìm theo tên nhân vật
**🏆 ?setkc <tên>\` - Set KC tùy chỉnh (KC)
**👋 ?roiguild @user [Xnt]** - Đánh dấu rời (QL/KC)
**🏆 ?setkc <tên>** - Set KC tùy chỉnh (KC)
**👋 ?roiguild @user [Xnt]** - Đánh dấu rời (QL/KC)

**🗑️ Lệnh Xóa (QL):**
\`?xoabc\`, \`?xoapbc\`, \`?rsrejoin @user\` (\`?rsrj\`)

**⚙️ Khác:**
\`?pickrole\`, \`?addhelp\``;

  await message.channel.send(helpText);
}

module.exports = { execute };


