// ==========================================
// โค้ดเวอร์ชันพร้อมขึ้นออนไลน์ (Production Ready)
// ==========================================

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const NodeCache = require('node-cache');
const fs = require('fs');
require('dotenv').config();

const app = express();
// อนุญาตให้หน้าเว็บ (Frontend) จากทุกโดเมนมาดึงข้อมูลได้
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
}));

// ตั้งค่า Cache ให้อยู่ได้ 60 วินาที
const cache = new NodeCache({ stdTTL: 60 });

// ID ของไฟล์ Google Sheets ทั้ง 5 ไฟล์ (เปลี่ยนเป็น ID จริงของคุณถ้ายังไม่ได้ใส่)
const SHEET_FILES = {
  DIAMOND: "1yT_Af7VEUC6sQpJrVxynlMvimkpGUR3dVdC9BJQ_cHU",
  PLATINUM: "1ynB3NvU_aZB8DyW5E_ua7Qfap2BOPYBC1qSulgnmRkI",
  GOLD: "1czxlyds6ckL6TpQFKSHNV697TTe8VRxV9ohRKRpTfs8",
  SILVER: "1GfZmbcUQ4fzLqUU3SPiHyzpXHD0wtt1y2iT_363DvS4",
  BRONZE: "10VcaFvq9Ip0Bj4EKg9F51RKFx5DhgfdDT9hAzWmWz7E"
};

// ==========================================
// ระบบอ่าน Credentials อย่างปลอดภัย (Local vs Production)
// ==========================================
let auth;

try {
    if (process.env.GOOGLE_CREDENTIALS) {
        // [โหมด Production บน Render.com] อ่านจาก Environment Variable
        console.log("Using credentials from Environment Variable.");
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
    } else if (fs.existsSync('./credentials.json')) {
        // [โหมดทดสอบในเครื่อง] อ่านจากไฟล์ credentials.json
        console.log("Using credentials from credentials.json file.");
        auth = new google.auth.GoogleAuth({
            keyFile: './credentials.json',
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
    } else {
        throw new Error("ไม่พบข้อมูล Credentials! กรุณาใส่ไฟล์ credentials.json หรือตั้งค่า GOOGLE_CREDENTIALS");
    }
} catch (err) {
    console.error("Authentication Error:", err.message);
}

const sheetsApi = google.sheets({ version: 'v4', auth });

// ==========================================
// ฟังก์ชันดึงข้อมูลจาก Sheets แบบคู่ขนาน (Parallel)
// ==========================================
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

// ==========================================
// API Endpoint
// ==========================================
app.get('/api/customers', async (req, res) => {
  try {
    const cachedData = cache.get('CUSTOMER_DATA');
    if (cachedData) {
      return res.json({ source: 'cache', data: cachedData });
    }

    const data = await fetchAllData();
    
    // ตั้งค่า Cache
    cache.set('CUSTOMER_DATA', data);
    
    res.json({ source: 'sheets', data: data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// หน้าเช็คสถานะ API พื้นฐาน
app.get('/', (req, res) => {
    res.send("API is running! 🚀 ไปที่ /api/customers เพื่อดูข้อมูล");
});

// รัน Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});