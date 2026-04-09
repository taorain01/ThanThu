const { createClient } = require('@supabase/supabase-js');

// Khởi tạo Supabase client dùng admin key để bypass Row Level Security
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const REPORT_WEBHOOK_URL = 'https://discord.com/api/webhooks/1489373408050548918/306XD99lLQ7fTohVwx9_q59rZEbKG_BAX0tLBPC6ugG78KA6ChPY0P7iakv6wVoNLxzO';

// ═══ Hàm hỗ trợ ═══

function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function progressBar(current, max, length = 10) {
    const filled = Math.round((current / max) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

function getStatusEmoji(bytes) {
    if (bytes > 100 * 1024 * 1024) return '🔴';
    if (bytes > 20 * 1024 * 1024) return '🟡';
    return '🟢';
}

// ═══ Lấy dữ liệu từ Supabase ═══

async function fetchTableData(tableName, columns) {
    const { data, error } = await supabase.from(tableName).select(columns);
    if (error) {
        console.error(`[TacticsReport] ❌ Lỗi truy vấn ${tableName}:`, error.message);
        return [];
    }
    return data || [];
}

// ═══ Báo cáo chính ═══

async function sendTacticsStorageReport() {
    try {
        console.log('[TacticsReport] 📊 Đang tổng hợp dữ liệu storage...');

        // Lấy dữ liệu song song cho nhanh
        const [historyRows, presetRows, liveRows] = await Promise.all([
            fetchTableData('bc_tactics_history', 'id, guild_id, session_id, day, type, saved_at, roster, markers'),
            fetchTableData('bc_tactics_presets', 'id, guild_id, preset_name, updated_at, markers'),
            fetchTableData('bc_tactics', 'guild_id, session_id, day, updated_at, markers, notes')
        ]);

        // Tính dung lượng từng bảng
        const calcSize = (rows) => rows.reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify(r), 'utf8'), 0);
        const historySize = calcSize(historyRows);
        const presetSize = calcSize(presetRows);
        const liveSize = calcSize(liveRows);
        const totalSize = historySize + presetSize + liveSize;
        const totalRecords = historyRows.length + presetRows.length + liveRows.length;

        // Trạng thái rỗng
        if (totalRecords === 0) {
            await sendToWebhook([{
                title: '⚔️ Lang Gia ─ Báo Cáo Storage',
                description: '> Hiện tại chưa có dữ liệu chiến thuật nào được lưu trữ.',
                color: 0x2f3136
            }]);
            return;
        }

        // ── Supabase Free Plan: 500MB database ──
        const SUPABASE_LIMIT = 500 * 1024 * 1024;
        const usagePercent = ((totalSize / SUPABASE_LIMIT) * 100).toFixed(2);

        // Màu embed dựa theo mức sử dụng
        let embedColor = 0x2ecc71; // Xanh lá
        if (totalSize > 100 * 1024 * 1024) embedColor = 0xe74c3c;
        else if (totalSize > 20 * 1024 * 1024) embedColor = 0xf39c12;

        // ═══ EMBED 1: Tổng quan ═══
        const overviewEmbed = {
            author: {
                name: '⚔️ LANG GIA ─ BÁO CÁO STORAGE CHIẾN THUẬT',
                icon_url: 'https://cdn-icons-png.flaticon.com/512/2920/2920349.png'
            },
            color: embedColor,
            description:
                `### ${getStatusEmoji(totalSize)} Tổng Quan Dung Lượng\n` +
                `\`\`\`\n` +
                `╔══════════════════════════════════════╗\n` +
                `║  Tổng bản ghi :  ${String(totalRecords).padStart(6)}  records    ║\n` +
                `║  Tổng JSON    :  ${formatBytes(totalSize).padStart(10)}          ║\n` +
                `║  Quota dùng   :  ${usagePercent.padStart(6)}%  / 500 MB   ║\n` +
                `╚══════════════════════════════════════╝\n` +
                `\`\`\`\n` +
                `${progressBar(totalSize, SUPABASE_LIMIT, 20)}  **${usagePercent}%**`,
            fields: [
                {
                    name: '📜 Lịch Sử (bc_tactics_history)',
                    value: `\`${formatBytes(historySize)}\` ─ ${historyRows.length} bản ghi`,
                    inline: true
                },
                {
                    name: '💾 Preset (bc_tactics_presets)',
                    value: `\`${formatBytes(presetSize)}\` ─ ${presetRows.length} bản ghi`,
                    inline: true
                },
                {
                    name: '🗺️ Live Map (bc_tactics)',
                    value: `\`${formatBytes(liveSize)}\` ─ ${liveRows.length} bản ghi`,
                    inline: true
                }
            ],
            footer: {
                text: '🔄 Tự động gửi mỗi thứ Hai lúc 08:00',
                icon_url: 'https://cdn-icons-png.flaticon.com/512/1828/1828640.png'
            },
            timestamp: new Date().toISOString()
        };

        // ═══ EMBED 2: Top bản ghi nặng nhất ═══
        const allItems = [];
        for (const r of historyRows) {
            allItems.push({
                label: `📜 History #${r.id}`,
                detail: `${r.day || '?'} ─ ${r.type || 'edit'}`,
                size: Buffer.byteLength(JSON.stringify(r), 'utf8'),
                date: r.saved_at
            });
        }
        for (const r of presetRows) {
            allItems.push({
                label: `💾 ${r.preset_name || 'Preset'}`,
                detail: `ID: ${r.id}`,
                size: Buffer.byteLength(JSON.stringify(r), 'utf8'),
                date: r.updated_at
            });
        }
        for (const r of liveRows) {
            allItems.push({
                label: `🗺️ Live`,
                detail: `${r.day || '?'} ─ ${r.session_id || 'legacy'}`,
                size: Buffer.byteLength(JSON.stringify(r), 'utf8'),
                date: r.updated_at
            });
        }

        allItems.sort((a, b) => b.size - a.size);
        const top10 = allItems.slice(0, 10);

        let rankText = top10.map((item, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${i + 1}.\``;
            const pct = ((item.size / totalSize) * 100).toFixed(1);
            const bar = progressBar(item.size, top10[0].size, 8);
            return `${medal} ${item.label} (${item.detail})\n` +
                   `${bar}  **${formatBytes(item.size)}** ─ ${pct}%`;
        }).join('\n\n');

        if (allItems.length > 10) {
            rankText += `\n\n> *...và ${allItems.length - 10} bản ghi khác*`;
        }

        const detailEmbed = {
            color: 0x2f3136,
            title: '🏆 Top 10 Bản Ghi Nặng Nhất',
            description: rankText,
        };

        await sendToWebhook([overviewEmbed, detailEmbed]);
        console.log('[TacticsReport] ✅ Đã gửi báo cáo thành công!');

    } catch (e) {
        console.error('[TacticsReport] ❌ Lỗi khi tạo báo cáo:', e);
    }
}

// ═══ Gửi Webhook (hỗ trợ nhiều embeds) ═══

async function sendToWebhook(embeds) {
    if (!REPORT_WEBHOOK_URL) return;
    const embedArray = Array.isArray(embeds) ? embeds : [embeds];
    try {
        await fetch(REPORT_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: '⚔️ Lang Gia Reporter',
                avatar_url: 'https://cdn-icons-png.flaticon.com/512/2920/2920349.png',
                embeds: embedArray
            })
        });
    } catch (e) {
        console.error('[TacticsReport] ❌ Webhook gửi thất bại:', e.message);
    }
}

module.exports = { sendTacticsStorageReport };
