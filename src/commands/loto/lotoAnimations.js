/**
 * lotoAnimations.js
 * Chứa dữ liệu và logic chọn animation cho game Loto
 */

// Cấu trúc Frame cũ:
// frames [1, 2]: Phase 1 (Mở đầu)
// frames [3, 4]: Phase 2 (Diễn biến)
// frames [5]:    Phase 3 (Cao trào)
// frames [6]:    Phase 4 (Chốt)
// frames [7]:    Phase 5 (Hiện kết quả - xử lý bên loto.js)

const GENERIC_ANIMATIONS = [
    // 1. Cổ điển
    [
        { frames: [1, 2], emoji: '🎒', text: 'Thò tay vô túi...' },
        { frames: [3, 4], emoji: '🤏', text: 'Đang kéo ra nè...' },
        { frames: [5], emoji: '👀', text: 'Ố ồ, sắp thấy rồi...' },
        { frames: [6], emoji: '🥁', text: 'Là số...' }
    ],
    // 2. Xóc mạnh
    [
        { frames: [1, 2], emoji: '🌪️', text: 'Xóc túi xà xà...' },
        { frames: [3, 4], emoji: '🌀', text: 'Trộn đều lên nào...' },
        { frames: [5], emoji: '✨', text: 'Bắt dính 1 em!' },
        { frames: [6], emoji: '🔢', text: 'Số...' }
    ],
    // 3. Thổi phép
    [
        { frames: [1, 2], emoji: '🌬️', text: 'Phù phù... xin vía...' },
        { frames: [3, 4], emoji: '🙏', text: 'Cầu trời khấn phật...' },
        { frames: [5], emoji: '⚡', text: 'Tay bốc rất nhanh!' },
        { frames: [6], emoji: '🎯', text: 'Số...' }
    ],
    // 4. Hồi hộp
    [
        { frames: [1, 2], emoji: '😰', text: 'Tay run run...' },
        { frames: [3, 4], emoji: '💓', text: 'Tim đập thình thịch...' },
        { frames: [5], emoji: '🫣', text: 'Hồi hộp quá đi...' },
        { frames: [6], emoji: '📢', text: 'Là số...' }
    ],
    // 5. Quyết đoán
    [
        { frames: [1, 2], emoji: '😎', text: 'Nhắm mắt chọn bừa...' },
        { frames: [3, 4], emoji: '🤜', text: 'Chộp lấy một tràng...' },
        { frames: [5], emoji: '☝️', text: 'Chỉ lấy một con!' },
        { frames: [6], emoji: '🔥', text: 'Chốt số...' }
    ],
    // 6. Lục lọi
    [
        { frames: [1, 2], emoji: '🕵️', text: 'Bới tung cả túi...' },
        { frames: [3, 4], emoji: '🔎', text: 'Đâu rồi đâu rồi...' },
        { frames: [5], emoji: '💡', text: 'A đây rồi!' },
        { frames: [6], emoji: '📍', text: 'Số...' }
    ],
    // 7. Nhấp nhử
    [
        { frames: [1, 2], emoji: '🎣', text: 'Rút ra... lại thả...' },
        { frames: [3, 4], emoji: '😏', text: 'Lại rút ra... hị hị...' },
        { frames: [5], emoji: '😜', text: 'Thôi chọn em này!' },
        { frames: [6], emoji: '🎣', text: 'Dính số...' }
    ],
    // 8. Soi kỹ
    [
        { frames: [1, 2], emoji: '🧐', text: 'Mở miệng túi ra...' },
        { frames: [3, 4], emoji: '🔦', text: 'Ngó nghiêng tìm số...' },
        { frames: [5], emoji: '💎', text: 'Thấy 1 em lấp lánh!' },
        { frames: [6], emoji: '🔍', text: 'Số...' }
    ],
    // 9. Vung vẩy
    [
        { frames: [1, 2], emoji: '🤹', text: 'Tung túi lên trời...' },
        { frames: [3, 4], emoji: '🤸', text: 'Hứng lấy một con...' },
        { frames: [5], emoji: '👌', text: 'Chụp dính!' },
        { frames: [6], emoji: '🎪', text: 'Số...' }
    ],
    // 10. Niệm chú
    [
        { frames: [1, 2], emoji: '🧙', text: 'Lẩm bẩm thần chú...' },
        { frames: [3, 4], emoji: '✨', text: 'Vừng ơi mở ra...' },
        { frames: [5], emoji: '👻', text: 'Số hiện hình!' },
        { frames: [6], emoji: '🔮', text: 'Số...' }
    ],
    // 11. Rút trộm
    [
        { frames: [1, 2], emoji: '🫣', text: 'Ngó trước ngó sau...' },
        { frames: [3, 4], emoji: '🤫', text: 'Không ai để ý...' },
        { frames: [5], emoji: '🤏', text: 'Lén rút 1 con!' },
        { frames: [6], emoji: '🚓', text: 'Số...' }
    ],
    // 12. Mời cụ
    [
        { frames: [1, 2], emoji: '🛐', text: 'Khấn vái tứ phương...' },
        { frames: [3, 4], emoji: '🕯️', text: 'Nhờ cụ mách nước...' },
        { frames: [5], emoji: '👐', text: 'Tay tự đưa vào...' },
        { frames: [6], emoji: '⛩️', text: 'Số...' }
    ],
    // 13. Đảo lộn
    [
        { frames: [1, 2], emoji: '🙃', text: 'Lộn ngược cái túi...' },
        { frames: [3, 4], emoji: '📉', text: 'Số rơi lã chã...' },
        { frames: [5], emoji: '🤲', text: 'Chộp được 1 em!' },
        { frames: [6], emoji: '🎲', text: 'Số...' }
    ],
    // 14. Hai tay
    [
        { frames: [1, 2], emoji: '👐', text: 'Thò cả 2 tay...' },
        { frames: [3, 4], emoji: '🦗', text: 'Bắt như bắt cào cào...' },
        { frames: [5], emoji: '✊', text: 'Được 1 nắm to...' },
        { frames: [6], emoji: '🖐️', text: 'Rớt hết còn số...' }
    ],
    // 15. Ngửi mùi
    [
        { frames: [1, 2], emoji: '👃', text: 'Hít hà hít hà...' },
        { frames: [3, 4], emoji: '💵', text: 'Thơm mùi tiền...' },
        { frames: [5], emoji: '🐾', text: 'Lần theo mùi hương...' },
        { frames: [6], emoji: '💩', text: 'Số...' }
    ],
    // 16. Lắng nghe
    [
        { frames: [1, 2], emoji: '👂', text: 'Áp tai vào túi...' },
        { frames: [3, 4], emoji: '💬', text: 'Nghe tiếng thì thầm...' },
        { frames: [5], emoji: '📞', text: 'Em này đang gọi!' },
        { frames: [6], emoji: '🔊', text: 'Số...' }
    ],
    // 17. Vuốt ve
    [
        { frames: [1, 2], emoji: '👋', text: 'Vuốt ve cái túi...' },
        { frames: [3, 4], emoji: '😽', text: 'Ngoan nào ngoan nào...' },
        { frames: [5], emoji: '😻', text: 'Tự chui ra tay!' },
        { frames: [6], emoji: '🐈', text: 'Số...' }
    ],
    // 18. Dọa nạt
    [
        { frames: [1, 2], emoji: '😡', text: 'Quát cái túi!' },
        { frames: [3, 4], emoji: '🤬', text: '"Nhả số đẹp mau!"' },
        { frames: [5], emoji: '😖', text: 'Túi sợ nhả ra...' },
        { frames: [6], emoji: '💢', text: 'Số...' }
    ],
    // 19. Thôi miên
    [
        { frames: [1, 2], emoji: '😵‍💫', text: 'Đung đưa đồng hồ...' },
        { frames: [3, 4], emoji: '💤', text: '"Ngươi buồn ngủ..."' },
        { frames: [5], emoji: '🤤', text: 'Túi mở miệng...' },
        { frames: [6], emoji: '👁️', text: 'Số...' }
    ],
    // 20. Ảo thuật
    [
        { frames: [1, 2], emoji: '🎩', text: 'Úm ba la xì bùa...' },
        { frames: [3, 4], emoji: '🕊️', text: 'Hô biến!' },
        { frames: [5], emoji: '🌹', text: 'Bông hoa nở ra...' },
        { frames: [6], emoji: '🐇', text: 'Số...' }
    ],
    // 21. Mổ cò
    [
        { frames: [1, 2], emoji: '👇', text: 'Chọt một ngón vào...' },
        { frames: [3, 4], emoji: '🐔', text: 'Mổ mổ mổ...' },
        { frames: [5], emoji: '🤏', text: 'Dính một con!' },
        { frames: [6], emoji: '🐣', text: 'Số...' }
    ],
    // 22. Boxing
    [
        { frames: [1, 2], emoji: '🥊', text: 'Đấm túi bịch bịch...' },
        { frames: [3, 4], emoji: '🤢', text: 'Túi ói ra số...' },
        { frames: [5], emoji: '🤮', text: 'Văng ra xa!' },
        { frames: [6], emoji: '🤕', text: 'Số...' }
    ],
    // 23. Câu cá
    [
        { frames: [1, 2], emoji: '🎣', text: 'Thả móc câu vào...' },
        { frames: [3, 4], emoji: '🐟', text: 'Giật cần mạnh...' },
        { frames: [5], emoji: '🦈', text: 'Dính cá to!' },
        { frames: [6], emoji: '🐡', text: 'Số...' }
    ],
    // 24. Nam châm
    [
        { frames: [1, 2], emoji: '🧲', text: 'Dùng nam châm hút...' },
        { frames: [3, 4], emoji: '⛓️', text: 'Cạch cạch cạch...' },
        { frames: [5], emoji: '🦾', text: 'Dính một chùm!' },
        { frames: [6], emoji: '🔧', text: 'Gỡ được số...' }
    ],
    // 25. Soi đèn
    [
        { frames: [1, 2], emoji: '🔦', text: 'Rọi đèn pin vào...' },
        { frames: [3, 4], emoji: '💡', text: 'Sáng trưng cả túi...' },
        { frames: [5], emoji: '👀', text: 'Thấy em trốn góc!' },
        { frames: [6], emoji: '🔦', text: 'Số...' }
    ],
    // 26. Kẹp cua
    [
        { frames: [1, 2], emoji: '🦀', text: 'Dùng kẹp cua kẹp...' },
        { frames: [3, 4], emoji: '😫', text: 'Á đau tay quá!' },
        { frames: [5], emoji: '🩸', text: 'Kẹp trúng rồi!' },
        { frames: [6], emoji: '🩹', text: 'Số...' }
    ],
    // 27. Rung lắc
    [
        { frames: [1, 2], emoji: '🎲', text: 'Lắc như xí ngầu...' },
        { frames: [3, 4], emoji: '🔊', text: 'Kêu rào rạo...' },
        { frames: [5], emoji: '📥', text: 'Đổ ra bàn!' },
        { frames: [6], emoji: '🎰', text: 'Số...' }
    ],
    // 28. Thổi sáo
    [
        { frames: [1, 2], emoji: '🪈', text: 'Thổi sáo dụ rắn...' },
        { frames: [3, 4], emoji: '🐍', text: 'Số ngóc đầu lên...' },
        { frames: [5], emoji: '🤏', text: 'Bắt lấy đầu nó!' },
        { frames: [6], emoji: '🧺', text: 'Số...' }
    ],
    // 29. Vợt muỗi
    [
        { frames: [1, 2], emoji: '🏸', text: 'Vợt qua vợt lại...' },
        { frames: [3, 4], emoji: '⚡', text: 'Tách tách (điện)...' },
        { frames: [5], emoji: '🦟', text: 'Trúng một con!' },
        { frames: [6], emoji: '☠️', text: 'Số...' }
    ],
    // 30. Hút bụi
    [
        { frames: [1, 2], emoji: '🧹', text: 'Bật máy hút bụi...' },
        { frames: [3, 4], emoji: '🌪️', text: 'Vuuu.... Vuuu....' },
        { frames: [5], emoji: '🗑️', text: 'Hút được 1 con!' },
        { frames: [6], emoji: '🔌', text: 'Số...' }
    ]
];

// Animation gieo vần theo số đuôi (Last Digit)
const RHYMING_ANIMATIONS = {
    // Đuôi 1: vần ỘT/ỐT
    1: [
        [ // 01
            { frames: [1, 2], emoji: '😴', text: 'Sáng ra ngậm đắng nuốt cay\nTối về nằm ngủ ngáy quay ra nhà' },
            { frames: [3, 4], emoji: '💃', text: 'Mơ toàn gái đẹp kiêu sa\nGiật mình tỉnh giấc hóa ra ôm...' },
            { frames: [5], emoji: '🏛️', text: 'CỘT !!!' },
            { frames: [6], emoji: '1️⃣', text: 'Là con số MỘT!' }
        ],
        [ // 11
            { frames: [1, 2], emoji: '📚', text: 'Học hành vất vả gian nan\nThi xong một cái tan hoang cõi lòng' },
            { frames: [3, 4], emoji: '💯', text: 'Điểm cao thì chẳng dám mong\nChỉ mong qua được đỡ mang tiếng...' },
            { frames: [5], emoji: '🥴', text: 'DỐT !!!' },
            { frames: [6], emoji: '1️⃣', text: 'Là con MƯỜI MỘT!' }
        ],
        [ // 21
            { frames: [1, 2], emoji: '🛌', text: 'Ăn no rồi lại nằm khoèo\nNghe giục đi làm thì hét lên to' },
            { frames: [3, 4], emoji: '🏃', text: 'Làm người sao tính so đo\nThấy việc là chạy như bò tung...' },
            { frames: [5], emoji: '🚧', text: 'CHỐT !!!' },
            { frames: [6], emoji: '2️⃣', text: 'Là HAI MƯƠI MỐT!' }
        ],
        [ // 31
            { frames: [1, 2], emoji: '🚜', text: 'Ra đường sợ nhất công nông\nVề nhà sợ nhất vợ không nói gì' },
            { frames: [3, 4], emoji: '🛒', text: 'Đêm nằm suy nghĩ li bì\nSáng ra mới biết vợ đi mua...' },
            { frames: [5], emoji: '🍞', text: 'BỘT !!!' },
            { frames: [6], emoji: '3️⃣', text: 'Là BA MƯƠI MỐT!' }
        ],
        [ // 41
            { frames: [1, 2], emoji: '☔', text: 'Trời mưa bong bóng phập phồng\nMẹ đi lấy chồng con ở với ai' },
            { frames: [3, 4], emoji: '🍠', text: 'Nhà còn mỗi một củ khoai\nChia năm xẻ bảy chẳng ai dám...' },
            { frames: [5], emoji: '😫', text: 'NUỐT !!!' },
            { frames: [6], emoji: '4️⃣', text: 'Là BỐN MƯƠI MỐT!' }
        ],
        [ // 51
            { frames: [1, 2], emoji: '🇻🇳', text: 'Đêm nằm nghĩ chuyện nước non\nThương em vất vả héo hon cả người' },
            { frames: [3, 4], emoji: '😁', text: 'Sáng ra thấy miệng em cười\nTươi như hoa nở mười phân vẹn...' },
            { frames: [5], emoji: '👍', text: 'TỐT !!!' },
            { frames: [6], emoji: '5️⃣', text: 'Là NĂM MƯƠI MỐT!' }
        ],
        [ // 61
            { frames: [1, 2], emoji: '😒', text: 'Anh này tính khí thật kỳ\nHơi tí là giận lầm lì bỏ đi' },
            { frames: [3, 4], emoji: '🥺', text: 'Em đây chẳng chấp làm chi\nChỉ thương cái tính nhu mì mà...' },
            { frames: [5], emoji: '🤪', text: 'DỐT !!!' },
            { frames: [6], emoji: '6️⃣', text: 'Là SÁU MƯƠI MỐT!' }
        ],
        [ // 71
            { frames: [1, 2], emoji: '😏', text: 'Ai ơi chớ vội cười nhau\nCười người hôm trước hôm sau người cười' },
            { frames: [3, 4], emoji: '🤡', text: 'Ngẫm mình tài giỏi hơn mười\nĐến khi đụng chuyện mới lòi cái...' },
            { frames: [5], emoji: '🥴', text: 'DỐT !!!' },
            { frames: [6], emoji: '7️⃣', text: 'Là BẢY MƯƠI MỐT!' }
        ],
        [ // 81
            { frames: [1, 2], emoji: '🙃', text: 'Ve vẻ vè ve, cái vè nói ngược\nNon cao đầy nước, đáy biển đầy cây' },
            { frames: [3, 4], emoji: '☁️', text: 'Dưới đất lắm mây\nTrên trời lắm...' },
            { frames: [5], emoji: '🏛️', text: 'CỘT !!!' },
            { frames: [6], emoji: '8️⃣', text: 'Là TÁM MƯƠI MỐT!' }
        ],
        [ // 01 variant
            { frames: [1, 2], emoji: '🍂', text: 'Gió mùa thu mẹ ru con ngủ\nNăm canh chày thức đủ vừa năm' },
            { frames: [3, 4], emoji: '🤒', text: 'Hỡi chàng chàng có về thăm\nVề thăm thằng Tí đang nằm sốt...' },
            { frames: [5], emoji: '🥵', text: 'SỐT !!!' },
            { frames: [6], emoji: '1️⃣', text: 'Là con số MỘT!' }
        ]
    ]
};

/**
 * Lấy animation cho số vừa bốc
 * @param {number} num Số vừa bốc (1-90)
 * @returns {Array} Animation set (mảng các phases)
 */
function getAnimation(num) {
    const lastDigit = num % 10;

    // Tạm thời bỏ qua Rhyming theo yêu cầu
    /*
    // Kiểm tra xem có animation gieo vần cho số đuôi này không
    if (RHYMING_ANIMATIONS[lastDigit]) {
        // 30% tỷ lệ ra animation gieo vần
        const chance = Math.random();
        if (chance < 0.3) {
            const poems = RHYMING_ANIMATIONS[lastDigit];
            const randomIndex = Math.floor(Math.random() * poems.length);
            return poems[randomIndex];
        }
    }
    */

    // Nếu không ra gieo vần hoặc không có vần, dùng Generic
    const randomIndex = Math.floor(Math.random() * GENERIC_ANIMATIONS.length);
    return GENERIC_ANIMATIONS[randomIndex];
}

module.exports = {
    getAnimation,
    GENERIC_ANIMATIONS,
    RHYMING_ANIMATIONS
};
