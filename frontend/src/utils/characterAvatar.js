// Tạo ảnh nhân vật theo màu người chơi cho UI React (chat, ...).
// Dùng cùng quy tắc đổi màu với ColorSwapPipeline trong game/shaders/fragShader.js:
// - pixel đỏ  (thân)  -> màu người chơi * r
// - pixel xanh (bóng)  -> màu người chơi * 0.5 * b
// - còn lại (kính, viền) giữ nguyên

const SPRITE_URL = "/assets/sprites/Base/idle.png";

/** @type {Promise<HTMLImageElement> | null} */
let spritePromise = null;
/** @type {Map<string, Promise<string>>} */
const cache = new Map();

function loadSprite() {
    if (!spritePromise) {
        spritePromise = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (e) => {
                spritePromise = null;
                reject(e);
            };
            img.src = SPRITE_URL;
        });
    }
    return spritePromise;
}

/** @param {string} hex */
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return [136, 136, 136];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Trả về data URL của sprite nhân vật đã đổi sang màu `color`.
 * @param {string} color mã hex, vd "#c51111"
 * @returns {Promise<string>}
 */
export function getCharacterAvatar(color) {
    const key = (color || "").toLowerCase();
    if (!cache.has(key)) {
        const job = loadSprite().then((img) => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const px = data.data;
            const [cr, cg, cb] = hexToRgb(key);
            const T = 0.4 * 255;
            for (let i = 0; i < px.length; i += 4) {
                const r = px[i], g = px[i + 1], b = px[i + 2];
                if (r > T && g < T && b < T) {
                    const f = r / 255;
                    px[i] = cr * f;
                    px[i + 1] = cg * f;
                    px[i + 2] = cb * f;
                } else if (b > T && r < T && g < T) {
                    const f = (b / 255) * 0.5;
                    px[i] = cr * f;
                    px[i + 1] = cg * f;
                    px[i + 2] = cb * f;
                }
            }
            ctx.putImageData(data, 0, 0);
            return canvas.toDataURL("image/png");
        });
        job.catch(() => cache.delete(key));
        cache.set(key, job);
    }
    return cache.get(key);
}
