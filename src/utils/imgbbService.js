/**
 * ImgBB Upload Service
 * Upload ảnh lên ImgBB để có link vĩnh viễn
 */

const https = require('https');
const http = require('http');
const FormData = require('form-data');
const { URL } = require('url');

const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

/**
 * Helper function to fetch URL and return buffer
 */
function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return fetchBuffer(response.headers.location).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Helper function to POST form data
 */
function postFormData(url, formData) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: formData.getHeaders()
        };

        const req = https.request(options, (response) => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                try {
                    const body = Buffer.concat(chunks).toString();
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
            response.on('error', reject);
        });

        req.on('error', reject);
        formData.pipe(req);
    });
}

/**
 * Upload ảnh lên ImgBB từ URL
 * @param {string} imageUrl - URL của ảnh cần upload
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function uploadFromUrl(imageUrl) {
    if (!IMGBB_API_KEY) {
        return { success: false, error: 'IMGBB_API_KEY not configured' };
    }

    try {
        // Download ảnh trước
        const imageBuffer = await fetchBuffer(imageUrl);
        const base64Image = imageBuffer.toString('base64');

        // Upload lên ImgBB
        const formData = new FormData();
        formData.append('key', IMGBB_API_KEY);
        formData.append('image', base64Image);

        const result = await postFormData(IMGBB_UPLOAD_URL, formData);

        if (result.success) {
            return {
                success: true,
                url: result.data.url,
                displayUrl: result.data.display_url,
                deleteUrl: result.data.delete_url,
                thumb: result.data.thumb?.url
            };
        } else {
            return { success: false, error: result.error?.message || 'Upload failed' };
        }
    } catch (error) {
        console.error('[ImgBB] Upload error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Upload ảnh lên ImgBB từ Buffer
 * @param {Buffer} imageBuffer - Buffer của ảnh
 * @param {string} name - Tên file (optional)
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function uploadFromBuffer(imageBuffer, name = 'image') {
    if (!IMGBB_API_KEY) {
        return { success: false, error: 'IMGBB_API_KEY not configured' };
    }

    try {
        const base64Image = imageBuffer.toString('base64');

        const formData = new FormData();
        formData.append('key', IMGBB_API_KEY);
        formData.append('image', base64Image);
        formData.append('name', name);

        const result = await postFormData(IMGBB_UPLOAD_URL, formData);

        if (result.success) {
            return {
                success: true,
                url: result.data.url,
                displayUrl: result.data.display_url,
                deleteUrl: result.data.delete_url,
                thumb: result.data.thumb?.url
            };
        } else {
            return { success: false, error: result.error?.message || 'Upload failed' };
        }
    } catch (error) {
        console.error('[ImgBB] Upload error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Kiểm tra API key có hợp lệ không
 * @returns {boolean}
 */
function isConfigured() {
    return !!IMGBB_API_KEY;
}

module.exports = {
    uploadFromUrl,
    uploadFromBuffer,
    isConfigured
};
