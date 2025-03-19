const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
require('dotenv').config(); // Load environment variables first

const allowedUsers = ["6281215465555", "6282174948353", "6281364174333", "6281270148555", "6281270031385", "6281328270986", "628127062011", "6282288251985"];
const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");


const chatSessions = {}; // Menyimpan sesi percakapan untuk setiap pengguna

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("GEMINI_API_KEY is missing! Please check your .env file.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
});

const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 2048, //8192
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
        printQRInTerminal: true,
        syncFullHistory: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Koneksi terputus, mencoba menyambung ulang:", shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === "open") {
            console.log("Bot WhatsApp terhubung!");
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        if (!m.messages[0]?.message) return;

        const msg = m.messages[0];

        // Cek apakah pesan dari bot sendiri
        if (msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const senderNumber = senderJid.replace(/[@].*/, ""); // Mengambil nomor HP
        const senderName = msg.pushName || "Tanpa Nama"; 
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const messageType = Object.keys(msg.message)[0];

        console.log(`📩 Pesan dari ${senderName} (${senderNumber}): ${text}`);

        if (!allowedUsers.includes(senderNumber)) return;
 
        try {
            // Mengecek apakah pengguna sudah memiliki sesi percakapan
            if (!chatSessions[senderNumber]) {
                chatSessions[senderNumber] = model.startChat({
                    generationConfig,
                    history: [],
                });
            }

            // Kirim status "Sedang mengetik..."
            await sock.sendPresenceUpdate("composing", senderJid);
    
            const chatSession = chatSessions[senderNumber];
            const result = await chatSession.sendMessage(text);
            const textai = transformText(result.response?.candidates?.[0]?.content.parts[0].text) || "No response received.";

            await sock.sendMessage(senderJid, { text: textai });
        } catch (error) {
            console.error("Error:", error.message);
        }
 
    return sock;
    });
}

startBot();
