// ==========================================
// โค้ดเวอร์ชันพร้อมขึ้นออนไลน์ + ระบบ Real-time (SSE)
// ==========================================

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const NodeCache = require('node-cache');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json()); // รองรับการรับข้อมูลแบบ JSON

// ตั้งค่า Cache ให้อยู่ได้นานๆ (เพราะเราจะลบมันเองเมื่อข้อมูลเปลี่ยน)
const cache = new NodeCache({ stdTTL: 86400 }); // เก็บไว้ 1 วันเต็มๆ

// เก็บรายชื่อหน้าเว็บ (Clients) ที่กำลังเชื่อมต่ออยู่
let connectedClients = [];

const SHEET_FILES = {
  DIAMOND: "1yT_Af7VEUC6sQpJrVxynlMvimkpGUR3dVdC9BJQ_cHU",
  PLATINUM: "1ynB3NvU_aZB8DyW5E_ua7Qfap2BOPYBC1qSulgnmRkI",
  GOLD: "1czxlyds6ckL6TpQFKSHNV697TTe8VRxV9ohRKRpTfs8",
  SILVER: "1GfZmbcUQ4fzLqUU3SPiHyzpXHD0wtt1y2iT_363DvS4",
  BRONZE: "10VcaFvq9Ip0Bj4EKg9F51RKFx5DhgfdDT9hAzWmWz7E"
};

let auth;
try {
    if (process.env.GOOGLE_CREDENTIALS) {
        console.log("Using credentials from Environment Variable.");
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
    } else if (fs.existsSync('./credentials.json')) {
        console.log("Using credentials from credentials.json file.");
        auth = new google.auth.GoogleAuth({
            keyFile: './credentials.json',
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
    } else {
        console.warn("No credentials found!");
    }
} catch (err) {
    console.error("Authentication Error:", err.message);
}

const sheetsApi = google.sheets({ version: 'v4', auth });

async function fetchAllData() {
  let allData = [];
  const ranks = Object.keys(SHEET_FILES);

  await Promise.all(ranks.map(async (rank) => {
    const spreadsheetId = SHEET_FILES[rank];
    if (!spreadsheetId || spreadsheetId.includes("ใส่_ID")) return;

    try {
      const sheetInfo = await sheetsApi.spreadsheets.get({ spreadsheetId });
      const sheetTitles = sheetInfo.data.sheets.map(s => s.properties.title);

      await Promise.all(sheetTitles.map(async (sheetTitle) => {
        const response = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `${sheetTitle}!A:Z`, 
        });

        const data = response.data.values;
        if (!data || data.length === 0) return;

        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(20, data.length); i++) {
          if (data[i] && data[i].indexOf('ยูสเซอร์') !== -1) {
            headerRowIndex = i;
            break;
          }
        }

        if (headerRowIndex !== -1) {
          const headers = data[headerRowIndex];
          const iconIdx = headers.indexOf('👑');
          const userIdx = headers.indexOf('ยูสเซอร์');
          const nameIdx = headers.indexOf('ชื่อ - นามสกุล');
          const linkIdx = headers.indexOf('Link');

          for (let i = headerRowIndex + 1; i < data.length; i++) {
            const row = data[i];
            if (row[userIdx] && row[userIdx].toString().trim() !== "") {
              allData.push({
                icon: iconIdx !== -1 && row[iconIdx] ? row[iconIdx] : '',
                user: row[userIdx].toString(),
                name: nameIdx !== -1 && row[nameIdx] ? row[nameIdx].toString() : '',
                link: linkIdx !== -1 && row[linkIdx] ? row[linkIdx].toString() : '',
                rank: rank,
                subSheet: sheetTitle
              });
            }
          }
        }
      }));
    } catch (error) {
      console.error(`Error reading Rank ${rank}:`, error.message);
    }
  }));
  return allData;
}

// 1. API สำหรับดึงข้อมูลรายชื่อ
app.get('/api/customers', async (req, res) => {
  try {
    const cachedData = cache.get('CUSTOMER_DATA');
    if (cachedData) {
      return res.json({ source: 'cache', data: cachedData });
    }

    const data = await fetchAllData();
    cache.set('CUSTOMER_DATA', data);
    res.json({ source: 'sheets', data: data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. API สำหรับกระจายสัญญาณให้หน้าเว็บ (Server-Sent Events)
app.get('/api/stream', (req, res) => {
  // ตั้งค่าให้เชื่อมต่อค้างไว้แบบ Real-time
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // ส่งข้อความแรกเพื่อยืนยันการเชื่อมต่อ
  res.write(`data: connected\n\n`);

  // เก็บ Client นี้ไว้ในระบบ
  connectedClients.push(res);

  // เมื่อผู้ใช้ปิดหน้าเว็บ ให้ลบออกจากระบบ
  req.on('close', () => {
    connectedClients = connectedClients.filter(client => client !== res);
  });
});

// 3. API สำหรับรับสัญญาณจาก Google Sheets (Webhook)
app.post('/api/webhook/update', (req, res) => {
  console.log("⚡ ได้รับสัญญาณการเปลี่ยนแปลงจาก Google Sheets!");
  
  // ล้างความจำ Cache ทิ้ง เพื่อให้รอบต่อไปไปดึงข้อมูลใหม่
  cache.del('CUSTOMER_DATA');
  
  // กระซิบบอกหน้าเว็บทุกเครื่องที่เปิดอยู่ให้ "ดึงข้อมูลใหม่เดี๋ยวนี้!"
  connectedClients.forEach(client => {
    client.write(`data: UPDATE_NOW\n\n`);
  });

  res.status(200).send("Webhook received and cache cleared");
});

app.get('/', (req, res) => {
    res.send("API is running! 🚀");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});