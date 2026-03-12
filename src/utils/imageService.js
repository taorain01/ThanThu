/**
 * Unified Image Upload Service
 * Thử Cloudinary trước, nếu lỗi thì fallback sang ImgBB
 */

const cloudinaryService = require('./cloudinaryService');
const imgbbService = require('./imgbbService');

/**
 * Upload ảnh với fallback
 * @param {string} imageUrl - URL của ảnh cần upload
 * @returns {Promise<{success: boolean, url?: string, service?: string, error?: string}>}
 */
async function uploadFromUrl(imageUrl) {
    // Thử Cloudinary trước (ổn định hơn)
    if (cloudinaryService.isConfigured()) {
        console.log('[ImageService] Trying Cloudinary...');
        const result = await cloudinaryService.uploadFromUrl(imageUrl);
        if (result.success) {
            console.log(`[ImageService] Cloudinary success: ${result.url}`);
            return { ...result, service: 'cloudinary' };
        }
        console.warn(`[ImageService] Cloudinary failed: ${result.error}`);
    }

    // Fallback sang ImgBB
    if (imgbbService.isConfigured()) {
        console.log('[ImageService] Falling back to ImgBB...');
        const result = await imgbbService.uploadFromUrl(imageUrl);
        if (result.success) {
            console.log(`[ImageService] ImgBB success: ${result.url}`);
            return { ...result, service: 'imgbb' };
        }
        console.warn(`[ImageService] ImgBB failed: ${result.error}`);
    }

    // Cả hai đều fail
    return {
        success: false,
        error: 'Both Cloudinary and ImgBB failed or not configured'
    };
}

/**
 * Upload ảnh từ buffer với fallback
 * @param {Buffer} imageBuffer - Buffer của ảnh
 * @param {string} name - Tên file (optional)
 * @returns {Promise<{success: boolean, url?: string, service?: string, error?: string}>}
 */
async function uploadFromBuffer(imageBuffer, name = 'discord_image') {
    // Thử Cloudinary trước
    if (cloudinaryService.isConfigured()) {
        console.log('[ImageService] Trying Cloudinary (buffer)...');
        const result = await cloudinaryService.uploadFromBuffer(imageBuffer, name);
        if (result.success) {
            return { ...result, service: 'cloudinary' };
        }
        console.warn(`[ImageService] Cloudinary failed: ${result.error}`);
    }

    // Fallback sang ImgBB
    if (imgbbService.isConfigured()) {
        console.log('[ImageService] Falling back to ImgBB (buffer)...');
        const result = await imgbbService.uploadFromBuffer(imageBuffer, name);
        if (result.success) {
            return { ...result, service: 'imgbb' };
        }
        console.warn(`[ImageService] ImgBB failed: ${result.error}`);
    }

    return {
        success: false,
        error: 'Both Cloudinary and ImgBB failed or not configured'
    };
}

/**
 * Kiểm tra có service nào được cấu hình không
 * @returns {boolean}
 */
function isConfigured() {
    return cloudinaryService.isConfigured() || imgbbService.isConfigured();
}

/**
 * Lấy thông tin service đang hoạt động
 * @returns {string}
 */
function getActiveServices() {
    const services = [];
    if (cloudinaryService.isConfigured()) services.push('Cloudinary');
    if (imgbbService.isConfigured()) services.push('ImgBB');
    return services.join(', ') || 'None';
}

/**
 * Upload ảnh lên CẢ HAI service song song (Cloudinary + ImgBB)
 * @param {string} imageUrl - URL của ảnh cần upload
 * @returns {Promise<{cloudinary?: string, imgbb?: string}>} Object chứa URLs từ mỗi service
 */
async function uploadToAll(imageUrl) {
    const results = { cloudinary: null, imgbb: null };
    const promises = [];

    // Upload Cloudinary
    if (cloudinaryService.isConfigured()) {
        promises.push(
            cloudinaryService.uploadFromUrl(imageUrl)
                .then(result => {
                    if (result.success) {
                        results.cloudinary = result.url;
                        console.log(`[ImageService] Cloudinary: ${result.url}`);
                    }
                })
                .catch(e => console.warn(`[ImageService] Cloudinary error: ${e.message}`))
        );
    }

    // Upload ImgBB
    if (imgbbService.isConfigured()) {
        promises.push(
            imgbbService.uploadFromUrl(imageUrl)
                .then(result => {
                    if (result.success) {
                        results.imgbb = result.url;
                        console.log(`[ImageService] ImgBB: ${result.url}`);
                    }
                })
                .catch(e => console.warn(`[ImageService] ImgBB error: ${e.message}`))
        );
    }

    // Đợi cả hai hoàn thành
    await Promise.all(promises);

    return results;
}

module.exports = {
    uploadFromUrl,
    uploadFromBuffer,
    uploadToAll,
    isConfigured,
    getActiveServices
};
