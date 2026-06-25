const { GoogleGenerativeAI } = require("@google/generative-ai");

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEFAULT_GEMINI_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.0-flash'];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let currentGeminiKeyIndex = 0;

function trimValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function getDeepSeekApiKey() {
    // Hỗ trợ cả DEEPSEEK đúng chính tả và DEEPSEAK theo cách gọi quen tay.
    return trimValue(process.env.DEEPSEEK_API_KEY) || trimValue(process.env.DEEPSEAK_API_KEY);
}

function getDeepSeekBaseUrl() {
    return (trimValue(process.env.DEEPSEEK_BASE_URL) || trimValue(process.env.DEEPSEAK_BASE_URL) || DEFAULT_DEEPSEEK_BASE_URL)
        .replace(/\/+$/u, '');
}

function getDeepSeekModel() {
    return trimValue(process.env.DEEPSEEK_MODEL) || trimValue(process.env.DEEPSEAK_MODEL) || DEFAULT_DEEPSEEK_MODEL;
}

function getDeepSeekThinkingMode() {
    const value = (trimValue(process.env.DEEPSEEK_THINKING) || 'disabled').toLowerCase();
    return value === 'enabled' ? 'enabled' : 'disabled';
}

function getNumberEnv(name, fallback) {
    const raw = trimValue(process.env[name]);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function loadGeminiApiKeys() {
    const keys = [];
    for (let i = 1; i <= 30; i++) {
        const key = trimValue(process.env[`GEMINI_API_KEY_${i}`]);
        if (key) keys.push(key);
    }

    const singleKey = trimValue(process.env.GEMINI_API_KEY);
    if (keys.length === 0 && singleKey) {
        keys.push(singleKey);
    }

    return keys;
}

function getNextGeminiApiKey(keys) {
    if (keys.length === 0) return null;
    const key = keys[currentGeminiKeyIndex % keys.length];
    currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % keys.length;
    return key;
}

function hasAnyFortuneAiKey() {
    return Boolean(getDeepSeekApiKey() || loadGeminiApiKeys().length > 0);
}

function compactError(error, maxLength = 160) {
    const message = error?.message || String(error);
    return message.replace(/\s+/gu, ' ').slice(0, maxLength);
}

function isRateLimitError(error) {
    const message = error?.message || '';
    return message.includes('429') || /too many requests|rate limit/iu.test(message);
}

function isTransientDeepSeekError(error) {
    const message = error?.message || '';
    return isRateLimitError(error) || /\b5\d\d\b/u.test(message) || /timeout|aborted|network/iu.test(message);
}

function isGeminiKeyInvalid(error) {
    const message = error?.message || '';
    return message.includes('API_KEY_INVALID')
        || message.includes('API key expired')
        || message.includes('400 Bad Request');
}

async function fetchWithTimeout(url, options, timeoutMs) {
    if (typeof fetch !== 'function') {
        throw new Error('Global fetch is not available in this Node.js runtime');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function parseDeepSeekError(response) {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    let bodyText = '';

    try {
        bodyText = await response.text();
    } catch {
        bodyText = '';
    }

    if (bodyText.length > 300) {
        bodyText = `${bodyText.slice(0, 300)}...`;
    }

    throw new Error(`DeepSeek HTTP ${response.status}${statusText}${bodyText ? `: ${bodyText}` : ''}`);
}

async function generateWithDeepSeek(prompt, logPrefix) {
    const apiKey = getDeepSeekApiKey();
    if (!apiKey) {
        console.log(`[${logPrefix}] DeepSeek key not configured, using Gemini fallback...`);
        return null;
    }

    const model = getDeepSeekModel();
    const baseUrl = getDeepSeekBaseUrl();
    const maxRetries = getNumberEnv('DEEPSEEK_MAX_RETRIES', 1);
    const timeoutMs = getNumberEnv('DEEPSEEK_TIMEOUT_MS', 30000);
    const maxTokens = getNumberEnv('DEEPSEEK_MAX_TOKENS', 700);
    const temperature = getNumberEnv('DEEPSEEK_TEMPERATURE', 0.9);
    const thinkingMode = getDeepSeekThinkingMode();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const body = {
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: maxTokens,
                stream: false,
                thinking: { type: thinkingMode },
            };

            if (thinkingMode === 'disabled') {
                body.temperature = temperature;
            }

            const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            }, timeoutMs);

            if (!response.ok) {
                await parseDeepSeekError(response);
            }

            const data = await response.json();
            const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
            if (!text || !String(text).trim()) {
                throw new Error('DeepSeek returned an empty response');
            }

            console.log(`[${logPrefix}] Success with DeepSeek (${model})`);
            return String(text);
        } catch (error) {
            if (attempt < maxRetries && isTransientDeepSeekError(error)) {
                console.log(`[${logPrefix}] DeepSeek (${model}) transient error, retry ${attempt + 1}/${maxRetries}: ${compactError(error)}`);
                await delay(2000);
                continue;
            }

            console.log(`[${logPrefix}] DeepSeek (${model}) failed, using Gemini fallback: ${compactError(error)}`);
            return null;
        }
    }

    return null;
}

async function generateWithGemini(prompt, logPrefix) {
    const apiKeys = loadGeminiApiKeys();
    const maxKeyAttempts = apiKeys.length;
    const maxRetries = 2;
    let lastError = null;

    if (apiKeys.length === 0) {
        throw new Error('No Gemini API key configured for fallback');
    }

    for (let keyAttempt = 0; keyAttempt < maxKeyAttempts; keyAttempt++) {
        const apiKey = getNextGeminiApiKey(apiKeys);
        const keyLabel = `Gemini key ${(currentGeminiKeyIndex === 0 ? apiKeys.length : currentGeminiKeyIndex)}/${apiKeys.length}`;

        try {
            const genAI = new GoogleGenerativeAI(apiKey);

            for (const modelName of DEFAULT_GEMINI_MODELS) {
                const model = genAI.getGenerativeModel({ model: modelName });

                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        const result = await model.generateContent(prompt);
                        const response = await result.response;
                        const text = response.text();

                        if (!text || !text.trim()) {
                            throw new Error('Gemini returned an empty response');
                        }

                        console.log(`[${logPrefix}] Success with ${keyLabel} (${modelName})`);
                        return text;
                    } catch (apiError) {
                        lastError = apiError;

                        if (isRateLimitError(apiError) && attempt < maxRetries) {
                            console.log(`[${logPrefix}] ${keyLabel} (${modelName}) rate limit, retry ${attempt + 1}/${maxRetries}...`);
                            await delay(5000);
                            continue;
                        }

                        console.log(`[${logPrefix}] ${keyLabel} (${modelName}) failed: ${compactError(apiError, 100)}`);
                        if (isGeminiKeyInvalid(apiError)) {
                            throw apiError;
                        }
                        break;
                    }
                }
            }
        } catch (keyError) {
            lastError = keyError;
            const canTryNextKey = (isRateLimitError(keyError) || isGeminiKeyInvalid(keyError)) && keyAttempt < maxKeyAttempts - 1;
            if (canTryNextKey) {
                console.log(`[${logPrefix}] ${keyLabel} ${isGeminiKeyInvalid(keyError) ? 'expired/invalid' : 'rate limit'}, trying next key...`);
                continue;
            }
        }
    }

    throw lastError || new Error('All Gemini fallback attempts failed');
}

async function generateFortuneText(prompt, options = {}) {
    const logPrefix = options.logPrefix || 'FortuneAI';
    const deepSeekText = await generateWithDeepSeek(prompt, logPrefix);
    if (deepSeekText) return deepSeekText;

    return generateWithGemini(prompt, logPrefix);
}

module.exports = {
    generateFortuneText,
    hasAnyFortuneAiKey,
};
