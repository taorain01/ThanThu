/**
 * Cloudinary Upload Service - Official SDK
 * Upload ảnh lên Cloudinary để có link vĩnh viễn
 */

const cloudinary = require('cloudinary').v2;

// Flag để track đã config chưa
let isConfigDone = false;

/**
 * Ensure Cloudinary is configured (lazy init)
 */
function ensureConfig() {
    if (!isConfigDone && process.env.CLOUDINARY_CLOUD_NAME) {
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
        });
        isConfigDone = true;
        console.log('[Cloudinary] Configured successfully');
    }
}

/**
 * Kiểm tra API có được cấu hình không
 * @returns {boolean}
 */
function isConfigured() {
    ensureConfig();
    return !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
}

/**
 * Upload ảnh lên Cloudinary từ URL
 * @param {string} imageUrl - URL của ảnh cần upload
 * @returns {Promise<{success: boolean, url?: string, publicId?: string, error?: string}>}
 */
async function uploadFromUrl(imageUrl) {
    if (!isConfigured()) {
        return { success: false, error: 'Cloudinary not configured' };
    }

    try {
        const result = await cloudinary.uploader.upload(imageUrl, {
            folder: 'discord_bot',
            resource_type: 'image'
        });

        console.log(`[Cloudinary] Uploaded: ${result.secure_url}`);
        return {
            success: true,
            url: result.secure_url,
            publicId: result.public_id
        };
    } catch (error) {
        console.error('[Cloudinary] Upload from URL error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Upload ảnh lên Cloudinary từ Buffer
 * @param {Buffer} imageBuffer - Buffer của ảnh
 * @param {string} name - Tên file (optional)
 * @returns {Promise<{success: boolean, url?: string, publicId?: string, error?: string}>}
 */
async function uploadFromBuffer(imageBuffer, name = 'discord_image') {
    if (!isConfigured()) {
        return { success: false, error: 'Cloudinary not configured' };
    }

    try {
        // Convert buffer to data URI
        const base64 = imageBuffer.toString('base64');
        const dataUri = `data:image/png;base64,${base64}`;

        const result = await cloudinary.uploader.upload(dataUri, {
            folder: 'discord_bot',
            resource_type: 'image',
            public_id: name + '_' + Date.now()
        });

        console.log(`[Cloudinary] Uploaded: ${result.secure_url}`);
        return {
            success: true,
            url: result.secure_url,
            publicId: result.public_id
        };
    } catch (error) {
        console.error('[Cloudinary] Upload error:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    uploadFromUrl,
    uploadFromBuffer,
    isConfigured,
    deleteImage,
    deleteByUrl,
    extractPublicId
};

/**
 * Xoá ảnh trên Cloudinary bằng public_id
 * @param {string} publicId - Public ID của ảnh (vd: discord_bot/abc123)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteImage(publicId) {
    if (!isConfigured()) {
        return { success: false, error: 'Cloudinary not configured' };
    }

    try {
        const result = await cloudinary.uploader.destroy(publicId);
        if (result.result === 'ok') {
            console.log(`[Cloudinary] Deleted: ${publicId}`);
            return { success: true };
        } else {
            return { success: false, error: result.result };
        }
    } catch (error) {
        console.error('[Cloudinary] Delete error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Xoá ảnh trên Cloudinary bằng URL
 * @param {string} imageUrl - URL của ảnh Cloudinary
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteByUrl(imageUrl) {
    if (!imageUrl || !imageUrl.includes('cloudinary.com')) {
        return { success: false, error: 'Not a Cloudinary URL' };
    }

    const publicId = extractPublicId(imageUrl);
    if (!publicId) {
        return { success: false, error: 'Could not extract public_id from URL' };
    }

    return await deleteImage(publicId);
}

/**
 * Trích xuất public_id từ Cloudinary URL
 * @param {string} url - Cloudinary URL
 * @returns {string|null} public_id hoặc null
 */
function extractPublicId(url) {
    try {
        // URL format: https://res.cloudinary.com/cloud_name/image/upload/v123/folder/filename.ext
        const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
        return match ? match[1] : null;
    } catch (e) {
        return null;
    }
}
