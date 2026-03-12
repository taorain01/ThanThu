/**
 * Member Card Generator - Wuxia Minimal Style
 * Phong cách Where Winds Meet - Viền vàng, họa tiết cổ trang
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');

// Config
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 350;
const BORDER_WIDTH = 3;
const BORDER_RADIUS = 8;
const INNER_PADDING = 12;

// Position colors (warm gold variants)
const POSITION_COLORS = {
    bc: { border: '#FFD700', accent: '#FFA500', text: '#FFE4B5' },     // Bang Chủ - Vàng đậm
    pbc: { border: '#DAA520', accent: '#CD853F', text: '#FFDAB9' },    // Phó BC - Vàng cam
    kc: { border: '#C0A060', accent: '#8B7355', text: '#F5DEB3' },     // Kỳ Cựu - Vàng đồng
    mem: { border: '#B8860B', accent: '#8B7355', text: '#FAEBD7' }     // Thành viên - Vàng nhạt
};

// Position names
const POSITION_NAMES = {
    bc: 'Bang Chủ',
    pbc: 'Phó Bang Chủ',
    kc: 'Kỳ Cựu',
    mem: 'Thành viên'
};

// Normalize position to standard code (bc, pbc, kc, mem)
function normalizePosition(position) {
    if (!position) return 'mem';
    const pos = position.toLowerCase().trim();

    // Các biến thể của Bang Chủ
    if (pos === 'bc' || pos === 'bangchu' || pos === 'bang chủ') return 'bc';

    // Các biến thể của Phó Bang Chủ
    if (pos === 'pbc' || pos === 'phobangchu' || pos === 'phó bang chủ' ||
        pos === 'pho bang chu' || pos === 'phó bc') return 'pbc';

    // Các biến thể của Kỳ Cựu
    if (pos === 'kc' || pos === 'kycuu' || pos === 'kỳ cựu' || pos === 'ky cuu') return 'kc';

    // Các biến thể của Thành viên
    if (pos === 'mem' || pos === 'member' || pos === 'thành viên' || pos === 'thanh vien') return 'mem';

    // Nếu là mã chuẩn đã tồn tại trong POSITION_NAMES, trả về
    if (POSITION_NAMES[pos]) return pos;

    // Mặc định: trả về giá trị gốc (có thể là custom position như kỳ cựu variants)
    return pos;
}

// Icon paths (local files - không bao giờ hết hạn)
const ICON_KYCUU_PATH = path.join(__dirname, '../assets/images/role_icons/LangGia_KyCuu.png');
const ICON_MEMBER_PATH = path.join(__dirname, '../assets/images/role_icons/LangGia_ThanhVien.png');

// Paths
const FONTS_DIR = path.join(__dirname, '../assets/fonts/Be_Vietnam_Pro');
const CJK_FONTS_DIR = path.join(__dirname, '../assets/fonts/Noto_Sans_CJK');

// Register fonts
try {
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'BeVietnamPro-Bold.ttf'), 'BeVietnamPro-Bold');
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'BeVietnamPro-Regular.ttf'), 'BeVietnamPro-Regular');
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'BeVietnamPro-Light.ttf'), 'BeVietnamPro-Light');
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'BeVietnamPro-SemiBold.ttf'), 'BeVietnamPro-SemiBold');

    // CJK font for Chinese/Japanese/Korean characters
    GlobalFonts.registerFromPath(path.join(CJK_FONTS_DIR, 'NotoSansCJKsc-Regular.otf'), 'NotoSansCJK');
    console.log('✅ Fonts registered for member card (Vietnamese + CJK)');
} catch (e) {
    console.error('⚠️ Could not load fonts:', e.message);
}

/**
 * Tính số ngày từ ngày vào guild
 */
function calculateDays(joinedAt) {
    if (!joinedAt) return 0;
    const joinDate = new Date(joinedAt);
    const now = new Date();
    return Math.floor(Math.abs(now - joinDate) / (1000 * 60 * 60 * 24));
}

/**
 * Load image with retry logic (retries only on failure)
 * @param {string} url - Image URL
 * @param {number} maxRetries - Max retry attempts (default 2)
 * @param {number} timeout - Timeout per attempt in ms (default 5000)
 */
async function loadImageWithRetry(url, maxRetries = 2, timeout = 5000) {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            const image = await Promise.race([
                loadImage(url),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout')), timeout)
                )
            ]);

            // Validate image - ImgBB error pages are typically small placeholder images
            // Valid user images should be at least 100x100 pixels
            if (image.width < 100 || image.height < 100) {
                throw new Error(`Invalid image dimensions: ${image.width}x${image.height} (possibly error page)`);
            }

            return image;
        } catch (e) {
            console.log(`[memberCard] Load attempt ${i + 1} failed: ${e.message}`);
            if (i === maxRetries) throw e;
            await new Promise(r => setTimeout(r, 500)); // Wait 0.5s before retry
        }
    }
}

/**
 * Load image with fallback - thử primary URL trước, nếu fail thì dùng backup URL
 * @param {string} primaryUrl - Primary URL (usually Cloudinary)
 * @param {string|null} backupUrl - Backup URL (usually ImgBB)
 * @param {number} maxRetries - Max retry attempts (default 1)
 * @param {number} timeout - Timeout in ms (default 3000)
 */
async function loadImageWithFallback(primaryUrl, backupUrl = null, maxRetries = 1, timeout = 3000) {
    // Thử load từ primary URL trước
    try {
        return await loadImageWithRetry(primaryUrl, maxRetries, timeout);
    } catch (e) {
        console.log(`[memberCard] Primary URL failed: ${e.message}`);
    }

    // Nếu có backup URL, thử load từ đó
    if (backupUrl) {
        console.log(`[memberCard] Trying backup URL...`);
        try {
            return await loadImageWithRetry(backupUrl, maxRetries, timeout);
        } catch (e) {
            console.log(`[memberCard] Backup URL also failed: ${e.message}`);
        }
    }

    // Cả hai đều fail
    throw new Error('Both primary and backup URLs failed');
}

/**
 * Vẽ rounded rect path
 */
function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * Vẽ ảnh với crop center
 */
function drawCroppedImage(ctx, image, x, y, targetWidth, targetHeight) {
    const imgRatio = image.width / image.height;
    const targetRatio = targetWidth / targetHeight;

    let sourceX, sourceY, sourceWidth, sourceHeight;

    if (imgRatio > targetRatio) {
        sourceHeight = image.height;
        sourceWidth = image.height * targetRatio;
        sourceX = (image.width - sourceWidth) / 2;
        sourceY = 0;
    } else {
        sourceWidth = image.width;
        sourceHeight = image.width / targetRatio;
        sourceX = 0;
        sourceY = (image.height - sourceHeight) / 2;
    }

    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, targetWidth, targetHeight);
}

/**
 * Vẽ họa tiết hoa đơn giản (dạng điểm trang trí)
 */
function drawFlowerMotif(ctx, x, y, size, color, alpha = 0.6) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;

    // Vẽ 5 cánh hoa đơn giản
    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        const angle = (i * 72 - 90) * Math.PI / 180;
        const petalX = x + Math.cos(angle) * size * 0.8;
        const petalY = y + Math.sin(angle) * size * 0.8;
        ctx.arc(petalX, petalY, size * 0.35, 0, Math.PI * 2);
        ctx.fill();
    }

    // Tâm hoa
    ctx.fillStyle = '#8B7355';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

/**
 * Vẽ nhánh tre đơn giản
 */
function drawBambooLeaf(ctx, x, y, angle, length, color, alpha = 0.5) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    ctx.translate(x, y);
    ctx.rotate(angle * Math.PI / 180);

    // Thân
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(length, 0);
    ctx.stroke();

    // Lá
    ctx.fillStyle = color;
    for (let i = 1; i <= 3; i++) {
        const leafX = length * (i / 4);
        ctx.beginPath();
        ctx.ellipse(leafX, -5, 8, 3, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(leafX + 5, 6, 7, 2.5, 0.3, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

/**
 * Get icon path for position (with display role priority)
 */
function getIconPath(position, subRoleCode = null, displayCode = null) {
    const pos = normalizePosition(position);

    // Ưu tiên display code (từ user_display)
    const codeToUse = displayCode || subRoleCode;

    // Nếu có code, thử load custom icon
    if (codeToUse) {
        try {
            const { getSubRoleIcon } = require('../commands/quanly/subrole/addrole');
            const customIcon = getSubRoleIcon(codeToUse);
            if (customIcon && fs.existsSync(customIcon)) {
                return customIcon;
            }
        } catch (e) {
            // No fallback needed
        }
    }

    // Bang Chủ, Phó BC, Kỳ Cựu dùng icon Kỳ Cựu (màu tím)
    if (['bc', 'pbc', 'kc'].includes(pos)) {
        return ICON_KYCUU_PATH;
    }
    return ICON_MEMBER_PATH;
}

/**
 * Tạo member profile card - Wuxia Minimal Style
 * @param {Object} userData - User data from database
 * @param {string|Object} avatarUrl - URL string hoặc { primary, backup } object
 * @param {string|null} kcSubtype - KC subtype code
 */
async function createMemberCard(userData, avatarUrl, kcSubtype = null) {
    // === HANDLE AVATAR URL FORMAT ===
    // avatarUrl có thể là string (legacy) hoặc object { primary, backup }
    let primaryUrl, backupUrl;
    if (typeof avatarUrl === 'object' && avatarUrl !== null) {
        primaryUrl = avatarUrl.primary;
        backupUrl = avatarUrl.backup || null;
    } else {
        primaryUrl = avatarUrl;
        backupUrl = null;
    }

    // === CACHE CHECK ===
    const cardCache = require('./memberCardCache');
    const cacheKey = cardCache.generateCacheKey(userData, primaryUrl, kcSubtype);
    const cachedBuffer = cardCache.get(cacheKey);
    if (cachedBuffer) {
        return new AttachmentBuilder(cachedBuffer, { name: 'member_card.png' });
    }

    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // Get position colors (normalize to standard code)
    const pos = normalizePosition(userData.position);
    const colors = POSITION_COLORS[pos] || POSITION_COLORS.mem;

    // Build position name: [Role Chính] (Role Phụ)
    let positionName = POSITION_NAMES[pos] || 'Thành viên';
    let subRoleName = null;

    // === DISPLAY ROLE INTEGRATION ===
    // Ưu tiên: current_display_code > sub_role > kc_subtype
    // Nếu display code là 'hidden' thì không hiển thị sub role
    let displayCode = null;
    try {
        const db = require('../database/db');
        displayCode = db.getUserDisplay(userData.discord_id);
    } catch (e) {
        // DB not available, fallback
    }

    // Nếu displayCode = 'hidden' => user đã chọn ẩn role, không fallback
    const isHidden = displayCode === 'hidden';
    const subRoleCode = isHidden ? null : (displayCode || kcSubtype || userData.sub_role);

    if (subRoleCode) {
        try {
            const { getSubRoleName } = require('../commands/quanly/subrole/addrole');
            subRoleName = getSubRoleName(subRoleCode);
        } catch (e) {
            // No fallback needed
        }

        if (subRoleName) {
            positionName = `${POSITION_NAMES[pos] || 'Thành viên'} (${subRoleName})`;
        }
    }

    // === CLIP TO ROUNDED RECT ===
    ctx.save();
    roundedRect(ctx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, BORDER_RADIUS);
    ctx.clip();

    // === VẼ ẢNH NỀN (với fallback) ===
    try {
        const bgImage = await loadImageWithFallback(primaryUrl, backupUrl);
        drawCroppedImage(ctx, bgImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } catch (e) {
        // Fallback gradient kiểu thủy mặc
        const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        gradient.addColorStop(0, '#2c2c3e');
        gradient.addColorStop(0.5, '#1a1a2e');
        gradient.addColorStop(1, '#0f0f1a');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // === DARK VIGNETTE OVERLAY ===
    const vignette = ctx.createRadialGradient(
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.4,
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_WIDTH * 0.7
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // === GRADIENT PHÍA DƯỚI ===
    const bottomGradient = ctx.createLinearGradient(0, CANVAS_HEIGHT - 130, 0, CANVAS_HEIGHT);
    bottomGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    bottomGradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.6)');
    bottomGradient.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
    ctx.fillStyle = bottomGradient;
    ctx.fillRect(0, CANVAS_HEIGHT - 130, CANVAS_WIDTH, 130);

    ctx.restore(); // End clip

    // === VẼ VIỀN VÀNG KHUÔN ===
    // Outer border
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = BORDER_WIDTH;
    roundedRect(ctx, BORDER_WIDTH / 2, BORDER_WIDTH / 2,
        CANVAS_WIDTH - BORDER_WIDTH, CANVAS_HEIGHT - BORDER_WIDTH, BORDER_RADIUS);
    ctx.stroke();

    // Inner decorative line
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    roundedRect(ctx, INNER_PADDING, INNER_PADDING,
        CANVAS_WIDTH - INNER_PADDING * 2, CANVAS_HEIGHT - INNER_PADDING * 2, BORDER_RADIUS - 4);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // === HỌA TIẾT GÓC ===
    // Góc trái trên - tre (giữ lại)
    drawBambooLeaf(ctx, 15, 25, -30, 50, colors.border, 0.4);

    // === TÊN NHÂN VẬT ===
    const gameName = userData.game_username || userData.discord_name || 'Unknown';

    // Shadow ấm
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    ctx.font = '40px BeVietnamPro-SemiBold, NotoSansCJK, Arial';
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'left';
    ctx.fillText(gameName, 25, CANVAS_HEIGHT - 55);

    // Reset shadow
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // === UID ===
    const uid = userData.game_uid || '???';
    ctx.font = '20px BeVietnamPro-Regular, Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(`UID: ${uid}`, 25, CANVAS_HEIGHT - 22);

    // === ICON + CHỨC VỤ + SỐ NGÀY (góc phải dưới) ===
    const days = calculateDays(userData.joined_at);
    const isLeftMember = !!userData.left_at; // Kiểm tra đã rời guild
    const iconSize = 50;
    const iconX = CANVAS_WIDTH - iconSize - 15;
    const iconY = CANVAS_HEIGHT - iconSize - 15;

    // Vẽ icon (sử dụng display icon hoặc custom icon nếu có)
    try {
        const iconPath = getIconPath(pos, kcSubtype || userData.sub_role, displayCode);
        const icon = await loadImage(iconPath);
        ctx.drawImage(icon, iconX, iconY, iconSize, iconSize);
    } catch (e) {
        console.error('Could not load position icon:', e.message);
    }

    // Vẽ text chức vụ (phía trên icon, bên trái icon)
    ctx.textAlign = 'right';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    // Text căn giữa với icon (iconY + iconSize/2 = center)
    const textCenterY = iconY + iconSize / 2;

    ctx.font = '14px BeVietnamPro-SemiBold, Arial';
    ctx.fillStyle = isLeftMember ? '#FF6B6B' : colors.text; // Màu đỏ nếu đã rời
    ctx.fillText(isLeftMember ? 'Đã rời' : positionName, iconX - 10, textCenterY - 2);

    // Vẽ số ngày (dưới chức vụ) - CHỈ khi chưa rời guild
    if (!isLeftMember) {
        ctx.font = '11px BeVietnamPro-Light, Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText(`Đã vào được ${days} ngày`, iconX - 10, textCenterY + 14);
    }

    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // === XUẤT ẢNH & CACHE ===
    const buffer = canvas.toBuffer('image/png');
    cardCache.set(cacheKey, buffer);
    return new AttachmentBuilder(buffer, { name: 'member_card.png' });
}

// Default background - Local path (không bao giờ hết hạn)
const DEFAULT_BG_PATH = path.join(__dirname, '../assets/images/default_bg.png');

/**
 * Tạo card mặc định cho người chưa set avatar (600x100)
 */
async function createDefaultCard(userData, kcSubtype = null) {
    // === CACHE CHECK ===
    const cardCache = require('./memberCardCache');
    const cacheKey = cardCache.generateCacheKey(userData, null, kcSubtype) + '_default';
    const cachedBuffer = cardCache.get(cacheKey);
    if (cachedBuffer) {
        return new AttachmentBuilder(cachedBuffer, { name: 'member_card.png' });
    }

    const WIDTH = 600;
    const HEIGHT = 100;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Get position colors (normalize to standard code)
    const pos = normalizePosition(userData.position);
    const colors = POSITION_COLORS[pos] || POSITION_COLORS.mem;
    // Build position name with optional subtype for KC
    let positionName = POSITION_NAMES[pos] || 'Thành viên';
    if (pos === 'kc' && kcSubtype) {
        try {
            const { getKcRoleName } = require('../commands/quanly/addkc');
            const roleName = getKcRoleName(kcSubtype);
            positionName = `Kỳ Cựu (${roleName || kcSubtype.toUpperCase()})`;
        } catch (e) {
            positionName = `Kỳ Cựu (${kcSubtype.toUpperCase()})`;
        }
    }

    // === VẼ ẢNH NỀN MẶC ĐỊNH (blur effect) ===
    try {
        const bgImage = await loadImage(DEFAULT_BG_PATH);
        // Draw with crop center
        const imgRatio = bgImage.width / bgImage.height;
        const targetRatio = WIDTH / HEIGHT;
        let sourceX, sourceY, sourceWidth, sourceHeight;

        if (imgRatio > targetRatio) {
            sourceHeight = bgImage.height;
            sourceWidth = bgImage.height * targetRatio;
            sourceX = (bgImage.width - sourceWidth) / 2;
            sourceY = 0;
        } else {
            sourceWidth = bgImage.width;
            sourceHeight = bgImage.width / targetRatio;
            sourceX = 0;
            sourceY = (bgImage.height - sourceHeight) / 2;
        }
        ctx.drawImage(bgImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, WIDTH, HEIGHT);
    } catch (e) {
        // Fallback gradient
        const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
        gradient.addColorStop(0, '#2c2c3e');
        gradient.addColorStop(1, '#1a1a2e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // === DARK OVERLAY ===
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // === VIỀN VÀNG ===
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, WIDTH - 4, HEIGHT - 4);

    // === TÊN NHÂN VẬT (bên trái) ===
    const gameName = userData.game_username || userData.discord_name || 'Unknown';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    ctx.font = '28px BeVietnamPro-SemiBold, NotoSansCJK, Arial';
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'left';
    ctx.fillText(gameName, 20, 42);

    // === UID (dưới tên) ===
    ctx.shadowBlur = 0;
    const uid = userData.game_uid || '???';
    ctx.font = '16px BeVietnamPro-Regular, Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(`UID: ${uid}`, 20, 70);

    // === ICON + CHỨC VỤ + SỐ NGÀY (bên phải) ===
    const days = calculateDays(userData.joined_at);
    const isLeftMember = !!userData.left_at; // Kiểm tra đã rời guild
    const iconSize = 36;
    const iconX = WIDTH - iconSize - 12;
    const iconY = (HEIGHT - iconSize) / 2;

    // Vẽ icon (sử dụng custom icon nếu có)
    try {
        const iconPath = getIconPath(pos, kcSubtype);
        const icon = await loadImage(iconPath);
        ctx.drawImage(icon, iconX, iconY, iconSize, iconSize);
    } catch (e) {
        console.error('Could not load position icon:', e.message);
    }

    // Vẽ text chức vụ (bên trái icon)
    ctx.textAlign = 'right';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;

    // Text căn giữa với icon
    const textCenterY = iconY + iconSize / 2;

    ctx.font = '13px BeVietnamPro-SemiBold, Arial';
    ctx.fillStyle = isLeftMember ? '#FF6B6B' : colors.text; // Màu đỏ nếu đã rời
    ctx.fillText(isLeftMember ? 'Đã rời' : positionName, iconX - 10, textCenterY - 2);

    // Vẽ số ngày (dưới chức vụ) - CHỈ khi chưa rời guild
    if (!isLeftMember) {
        ctx.font = '10px BeVietnamPro-Light, Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText(`Đã vào được ${days} ngày`, iconX - 10, textCenterY + 12);
    }

    ctx.shadowBlur = 0;

    // === XUẤT ẢNH & CACHE ===
    const buffer = canvas.toBuffer('image/png');
    cardCache.set(cacheKey, buffer);
    return new AttachmentBuilder(buffer, { name: 'member_card.png' });
}

module.exports = {
    createMemberCard,
    createDefaultCard,
    POSITION_COLORS
};
