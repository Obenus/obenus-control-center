import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, "sha512");
}

export function encrypt(text: string): string {
    if (!text) return "";
    const secret = process.env.APP_SECRET_KEY;
    if (!secret) throw new Error("APP_SECRET_KEY is missing in env");

    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getKey(secret, salt);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", "base64");
    encrypted += cipher.final("base64");

    const tag = cipher.getAuthTag();

    return Buffer.concat([
        salt,
        iv,
        tag,
        Buffer.from(encrypted, "base64"),
    ]).toString("base64");
}

export function decrypt(encryptedText: string): string {
    if (!encryptedText) return "";
    const secret = process.env.APP_SECRET_KEY;
    if (!secret) throw new Error("APP_SECRET_KEY is missing in env");

    try {
        const rawData = Buffer.from(encryptedText, "base64");

        const salt = rawData.subarray(0, SALT_LENGTH);
        const iv = rawData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
        const tag = rawData.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
        const encrypted = rawData.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

        const key = getKey(secret, salt);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encrypted.toString("base64"), "base64", "utf8");
        decrypted += decipher.final("utf8");

        return decrypted;
    } catch (error) {
        throw new Error("Decryption failed. Ensure APP_SECRET_KEY is correct.");
    }
}
