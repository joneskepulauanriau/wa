const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
require("dotenv").config();

const {
    GoogleGenerativeAI,
} = require("@google/generative-ai");

const chatSessions = {}; // Menyimpan sesi percakapan untuk setiap pengguna

const USERS_FILE = "allowed_users.json";

function loadAllowedUsers() {
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    } catch (error) {
        return [];
    }
}

function saveAllowedUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let allowedUsers = loadAllowedUsers();
const authorizingUser = process.env.AUTHORIZING_USER;
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("GEMINI_API_KEY is missing! Please check your .env file.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 2048,
    responseMimeType: "text/plain",
};

function transformText(inputText) {
    if (!inputText) return "";

    return inputText
        .replace(/^\s*\*\s+/gm, "- ") // Mengubah list dengan '*' jadi '-'
        .replace(/^\s*(\d+)\.\s+/gm, "$1. ") // Memastikan list angka tetap valid
        .replace(/(^|[^*])\*(\S.*?\S|\S)\*(?!\*)/g, "$1_$2_") // Mengubah '*italic*' ke '_italic_', tanpa mengganggu **bold**
        .replace(/\*\*(.*?)\*\*/g, "*$1*") // Mengubah '**bold**' ke '*bold*'
        .replace(/\n{3,}/g, "\n\n") // Menghapus baris kosong berlebih
        .trim(); // Menghapus spasi di awal dan akhir
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth_multi_device");
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: true,
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: false });
        if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
            console.log("Koneksi terputus, mencoba menyambung ulang...");
            startBot();
        } else if (connection === "open") {
            console.log("Bot WhatsApp terhubung!");
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        if (!m.messages[0]?.message) return;

        const msg = m.messages[0];
        if (msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const senderNumber = senderJid.replace(/[@].*/, "");
        const senderName = msg.pushName || "Tanpa Nama";
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        console.log(`📩 Pesan dari ${senderName} (${senderNumber}): ${text}`);

        if (senderNumber === authorizingUser) {
            if (text.startsWith("!adduser ")) {
                const newUser = text.split(" ")[1];
                if (newUser && !allowedUsers.includes(newUser)) {
                    allowedUsers.push(newUser);
                    saveAllowedUsers(allowedUsers);
                    await sock.sendMessage(senderJid, { text: `✅ Pengguna ${newUser} telah ditambahkan.` });
                }
            } else if (text.startsWith("!deluser ")) {
                const removeUser = text.split(" ")[1];
                allowedUsers = allowedUsers.filter((user) => user !== removeUser);
                saveAllowedUsers(allowedUsers);
                await sock.sendMessage(senderJid, { text: `❌ Pengguna ${removeUser} telah dihapus.` });
            } else if (text === "!listusers") {
                await sock.sendMessage(senderJid, { text: `📋 Pengguna diizinkan: ${allowedUsers.join(", ")}` });
            }
        }

        if (!allowedUsers.includes(senderNumber)) return;

        try {
            if (!chatSessions[senderNumber]) {
                chatSessions[senderNumber] = model.startChat({
                    generationConfig,
                    history: [],
                });
            }

            await sock.sendPresenceUpdate("composing", senderJid);
            const chatSession = chatSessions[senderNumber];
            const result = await chatSession.sendMessage(text);
            const textai = transformText(result.response?.candidates?.[0]?.content.parts[0]?.text) || "No response received.";

            await sock.sendMessage(senderJid, { text: textai });
        } catch (error) {
            console.error("Error:", error.message);
        }
    });
}

startBot();
