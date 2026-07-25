// ==========================================
// โค้ดเวอร์ชันพร้อมขึ้นออนไลน์ + ระบบ Real-time (SSE)
// [อัปเดต] ดึงข้อมูลทีละไฟล์ (Sequential) ป้องกัน Google API บล็อก
// ==========================================

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const NodeCache = require('node-cache');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

const cache = new NodeCache({ stdTTL: 86400 }); 
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

// ฟังก์ชันหน่วงเวลาเล็กน้อย ป้องกัน API โดนแบน
const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchAllData() {
  let allData = [];
  const ranks = Object.keys(SHEET_FILES);

  // เปลี่ยนจาก Promise.all เป็น for...of เพื่อดึงทีละแรงค์ (ต่อคิว)
  for (const rank of ranks) {
    const spreadsheetId = SHEET_FILES[rank];
    if (!spreadsheetId || spreadsheetId.includes("ใส่_ID")) continue;

    try {
      console.log(`กำลังดึงข้อมูล Rank: ${rank}...`);
      const sheetInfo = await sheetsApi.spreadsheets.get({ spreadsheetId });
      const sheetTitles = sheetInfo.data.sheets.map(s => s.properties.title);

      // ดึงข้อมูลทีละ Sub-sheet (ต่อคิว)
      for (const sheetTitle of sheetTitles) {
        const response = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `${sheetTitle}!A:Z`, 
        });

        const data = response.data.values;
        if (!data || data.length === 0) continue;

        let headerRowIndex = -1;
        // ค้นหาบรรทัดที่มีคำว่า ยูสเซอร์ โดยตัดเว้นวรรคออกด้วย เพื่อความชัวร์ (trim)
        for (let i = 0; i < Math.min(20, data.length); i++) {
          if (data[i]) {
            const rowStr = data[i].map(c => String(c).trim());
            if (rowStr.indexOf('ยูสเซอร์') !== -1) {
              headerRowIndex = i;
              break;
            }
          }
        }

        if (headerRowIndex !== -1) {
          const headers = data[headerRowIndex].map(h => String(h).trim());
          const iconIdx = headers.indexOf('👑');
          const userIdx = headers.indexOf('ยูสเซอร์');
          const nameIdx = headers.indexOf('ชื่อ - นามสกุล');
          const linkIdx = headers.indexOf('Link');

          for (let i = headerRowIndex + 1; i < data.length; i++) {
            const row = data[i];
            if (row[userIdx] && String(row[userIdx]).trim() !== "") {
              allData.push({
                icon: iconIdx !== -1 && row[iconIdx] ? row[iconIdx] : '',
                user: String(row[userIdx]).trim(),
                name: nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : '',
                link: linkIdx !== -1 && row[linkIdx] ? String(row[linkIdx]).trim() : '',
                rank: rank,
                subSheet: sheetTitle
              });
            }
          }
        }
        
        // หน่วงเวลา 0.2 วินาทีก่อนไปดึงชีตถัดไป ให้ Google ได้หายใจ
        await delay(200);
      }
    } catch (error) {
      console.error(`Error reading Rank ${rank}:`, error.message);
    }
  }
  
  console.log(`ดึงข้อมูลสำเร็จทั้งหมด: ${allData.length} รายการ`);
  return allData;
}

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

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  res.write(`data: connected\n\n`);

  connectedClients.push(res);

  req.on('close', () => {
    connectedClients = connectedClients.filter(client => client !== res);
  });
});

app.post('/api/webhook/update', (req, res) => {
  console.log("⚡ ได้รับสัญญาณการเปลี่ยนแปลงจาก Google Sheets!");
  cache.del('CUSTOMER_DATA');
  
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