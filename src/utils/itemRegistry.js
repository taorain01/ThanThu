/**
 * Item Registry - Danh sách tất cả items trong game
 * Mỗi item có 2 ID: numId (số) và id (chữ)
 * Dùng với lệnh ?look <id>
 */

const ICONS = require('../config/icons');

const ITEMS = {
    // ID 1
    hat: {
        numId: 1,
        id: 'hat',
        name: 'Hạt',
        icon: ICONS.currency.hat,
        description: 'Đơn vị tiền tệ trong game, dùng để mua các vật phẩm trong shop.',
        usage: '?buy <item> để mua | ?shop để xem shop',
        dbField: 'hat'
    },
    // ID 2
    nhua: {
        numId: 2,
        id: 'nhua',
        name: 'Nhựa (Thể lực)',
        icon: ICONS.currency.nhua,
        description: 'Thể lực dùng để vào dungeon. Tối đa 500, hồi 1 mỗi 2.88 phút (đầy trong 24h).',
        usage: '?dung để xem thể lực và vào dungeon',
        dbField: 'nhua'
    },
    // ID 3
    dat1: {
        numId: 3,
        id: 'dat1',
        name: 'Đá Cường Hóa T1',
        icon: ICONS.currency.dat1,
        description: 'Đá dùng để tune các dòng 2-5 của trang bị Vàng. Nhận từ phân tách đồ Tím.',
        usage: '?tune <id> để nâng cấp trang bị',
        dbField: 'enhancement_stone_t1'
    },
    // ID 4
    thacham: {
        numId: 4,
        id: 'thacham',
        name: 'Thạch Âm',
        icon: ICONS.currency.thacham,
        description: 'Vật liệu quý hiếm dùng để tune dòng cuối cùng (dòng 5) của trang bị Vàng.',
        usage: '?tune <id> 5 để tune dòng cuối',
        dbField: 'thach_am'
    },
    // ID 5
    boxt1: {
        numId: 5,
        id: 'boxt1',
        name: 'Box T1',
        icon: ICONS.items.box,
        description: 'Hòm trang bị Tier 1. Mở ra nhận 1 trang bị ngẫu nhiên (Tím hoặc Vàng).',
        usage: '?box để mở | ?buy box để mua',
        dbField: 'boxes_t1'
    },
    // ID 6
    nhuacung: {
        numId: 6,
        id: 'nhuacung',
        name: 'Nhựa Cứng',
        icon: ICONS.items.nhuacung,
        description: 'Dùng để hồi ngay 60 Nhựa (thể lực). Nhận từ Daily Quest hiếm.',
        usage: '?dung để vào dungeon (tiêu thụ Nhựa)',
        dbField: 'nhua_cung'
    },
    // ID 7
    tinhthevang: {
        numId: 7,
        id: 'tinhthevang',
        name: 'Tinh Thể Vàng',
        icon: ICONS.items.tinhthevang,
        description: 'Tinh thể hiếm. Sử dụng khi tune để đảm bảo dòng tiếp theo là dòng Đề Cử Vàng.',
        usage: '?use tinhthevang để kích hoạt → ?tune <id> để tune',
        dbField: 'da_t1_khac_an'
    },
    // ID 8
    thachamvang: {
        numId: 8,
        id: 'thachamvang',
        name: 'Thạch Âm Vàng',
        icon: ICONS.items.thachamvang,
        description: 'Thạch Âm hiếm. Sử dụng khi tune dòng cuối để đảm bảo dòng cuối là Vàng.',
        usage: '?use thachamvang để kích hoạt → ?tune <id> 5 để tune dòng cuối',
        dbField: 'thach_am_khac_an'
    },
    // ID 9
    lcp: {
        numId: 9,
        id: 'lcp',
        name: 'Lửa Cầu Phúc',
        icon: ICONS.items.lcp,
        description: '+100% tỉ lệ mở gear Vàng từ Box. Hiệu lực 3 tiếng. Không cộng dồn, xài đè sẽ reset thời gian.',
        usage: '?use lcp để kích hoạt',
        dbField: 'lcp'
    },
    // ID 10
    lcpcl: {
        numId: 10,
        id: 'lcpcl',
        name: 'Lửa Cầu Phúc Cỡ Lớn',
        icon: ICONS.items.lcpcl,
        description: '+200% tỉ lệ mở gear Vàng từ Box. Hiệu lực 3 tiếng. Không cộng dồn, xài đè sẽ reset thời gian.',
        usage: '?use lcpcl để kích hoạt',
        dbField: 'lcpcl'
    },
    // ID 11
    daden: {
        numId: 11,
        id: 'daden',
        name: 'Đá Đen',
        icon: ICONS.items.daden,
        description: 'Hút năng lực dòng vàng từ trang bị (hủy đồ). Dùng để khắc ấn dòng lên đồ cùng loại.',
        usage: '?daden, ?dd, ?truyen để hút | ?khacda để khắc | ?ddlist để xem | ?u dd để dùng',
        dbField: 'black_stone_empty'
    },
    // ID 12
    buakhacyeu: {
        numId: 12,
        id: 'buakhacyeu',
        name: 'Bùa Khắc Yêu',
        icon: ICONS.items.buakhacyeu,
        description: 'Skip thời gian chờ dungeon (Solo/Coop5) và clear miễn phí 1 lần. Nhận thưởng ngay lập tức!',
        usage: 'Dùng khi start dungeon để skip timer',
        dbField: 'bua_khac_yeu'
    }
};

/**
 * Tìm item theo numId hoặc id
 * @param {string|number} idOrNumId - ID số hoặc ID chữ
 * @returns {Object|null} Item object hoặc null
 */
function getItem(idOrNumId) {
    const input = String(idOrNumId).toLowerCase().trim();

    // Nếu là số -> tìm theo numId
    if (!isNaN(input) && input !== '') {
        return Object.values(ITEMS).find(i => i.numId === parseInt(input)) || null;
    }

    // Nếu là chữ -> tìm theo id
    return ITEMS[input] || null;
}

/**
 * Lấy tất cả items theo thứ tự numId
 * @returns {Array} Mảng items đã sắp xếp
 */
function getAllItems() {
    return Object.values(ITEMS).sort((a, b) => a.numId - b.numId);
}

/**
 * Lấy ID số tiếp theo cho item mới
 * @returns {number} ID số tiếp theo
 */
function getNextNumId() {
    const maxId = Math.max(...Object.values(ITEMS).map(i => i.numId));
    return maxId + 1;
}

module.exports = {
    ITEMS,
    getItem,
    getAllItems,
    getNextNumId
};


