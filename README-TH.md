# คู่มือ IMS: Vercel Frontend + Google Apps Script Backend

รุ่นนี้ใช้ **Vercel สำหรับหน้าเว็บ** และ **Google Apps Script สำหรับ API กับการอ่าน/เขียน Google Sheet** จึงไม่ต้องสร้าง Google Cloud Service Account, JSON Key, Workload Identity Pool หรือ OIDC Provider

```text
เบราว์เซอร์ → หน้าเว็บบน Vercel → Vercel API proxy → Apps Script Web App → Google Sheet
```

Vercel API proxy ทำให้เบราว์เซอร์เรียก API ในโดเมนเดียวกับหน้าเว็บ แล้วส่งคำขอต่อไป Apps Script จากฝั่งเซิร์ฟเวอร์ จึงหลีกเลี่ยงปัญหา CORS จากการเรียกข้ามโดเมนโดยตรง

ดูรายละเอียดรูปแบบ JSON response, การแปลง error เป็น HTTP status และเหตุผลที่ไม่ต้องเปิด CORS เพิ่มได้ที่ [รายงานตรวจ CORS และ Error handling](API-RESPONSE-CORS-REVIEW-TH.md)

## สิ่งที่ต้องใช้

- Google Account ที่สร้าง Google Sheet และ Google Apps Script ได้
- GitHub Account
- Vercel Account ที่เชื่อม GitHub
- โฟลเดอร์ `vercel-app` และไฟล์ `Code.gs` จากโปรเจกต์นี้

ไม่ต้องทำสิ่งต่อไปนี้: สร้าง Google Cloud Project, เปิด Google Sheets API, สร้าง Service Account, ดาวน์โหลด JSON Key หรือสร้าง Workload Identity Pool/OIDC Provider

## ส่วนที่ 1 — สร้าง Google Sheet

1. เปิด [Google Sheets](https://sheets.google.com) แล้วสร้างสเปรดชีตใหม่
2. ตั้งชื่อ เช่น `IMS Spare Parts Database`
3. ยังไม่ต้องสร้างแท็บเอง ระบบ Setup จะสร้าง `Users`, `Parts_Inventory`, `Parts_Price`, `Transactions`, `Audit_Logs` และ `Stock-Audit` ให้ โดยประวัติ Stock Audit ใหม่จะบันทึกใน `Stock-Audit`

## ส่วนที่ 2 — สร้าง Apps Script Backend

1. เปิด Google Sheet ที่สร้างไว้
2. ไปที่ **Extensions → Apps Script**
3. ใน Apps Script editor เลือกไฟล์ `Code.gs` ที่มีอยู่ ลบโค้ดตัวอย่างเดิม แล้ววางเนื้อหาทั้งหมดจากไฟล์ `apps-script/Code.gs` ที่อยู่ในชุด Vercel นี้ (หรือใช้ไฟล์ `Code.gs` ฉบับปรับปรุงในโฟลเดอร์หลักของโปรเจกต์)
4. กด **Save** (ไอคอนดิสก์) และตั้งชื่อโปรเจกต์ เช่น `IMS Backend`
5. ตรวจว่าไฟล์มี `doPost(e)` อยู่ท้ายไฟล์ และมีฟังก์ชัน `updatePart(...)`

สคริปต์นี้ผูกกับ Google Sheet โดยตรง ใช้ `SpreadsheetApp.getActiveSpreadsheet()` จึงไม่ต้องกรอก Spreadsheet ID หรือสร้าง OAuth credentials เอง

## ส่วนที่ 3 — ตั้ง Setup Key ใน Apps Script

Setup Key ใช้ป้องกันไม่ให้บุคคลทั่วไปสั่งสร้างแท็บ/บัญชีเริ่มต้นซ้ำได้

1. ใน Apps Script editor คลิก **Project Settings** (ไอคอนรูปเฟืองด้านซ้าย)
2. เลื่อนหา **Script Properties**
3. คลิก **Add script property**
4. ใส่ **Property:** `IMS_SETUP_KEY`
5. ใส่ **Value:** สร้างข้อความยาวและเดายาก เช่นใช้ Password Manager สร้างค่าใหม่
6. คลิก **Save script properties**
7. เก็บค่านี้ไว้ชั่วคราวเพื่อกรอกในหน้า `/setup.html` ของ Vercel

ค่านี้อยู่ใน Script Properties ฝั่ง Google Apps Script ไม่อยู่ในหน้าเว็บถาวร และห้าม Commit ลง GitHub

## ส่วนที่ 4 — Deploy Apps Script เป็น Web App

1. ที่ Apps Script editor คลิก **Deploy → New deployment**
2. คลิกไอคอนรูปเฟืองข้าง **Select type** แล้วเลือก **Web app**
3. ใส่ Description เช่น `IMS API v1`
4. ตั้ง **Execute as** เป็น **Me** (บัญชีเจ้าของสคริปต์) เพื่อให้ API อ่าน/เขียนชีตด้วยสิทธิ์ของเจ้าของ
5. ตั้ง **Who has access** เป็น **Anyone** เพื่อให้ Vercel Function เรียก API ได้โดยไม่ต้องมี Google sign-in ของผู้ใช้แต่ละคน
6. คลิก **Deploy**
7. Google อาจแสดงหน้าขอสิทธิ์ ให้ตรวจชื่อสคริปต์และบัญชี แล้วอนุญาตสิทธิ์ Spreadsheet ที่สคริปต์ต้องใช้
8. คัดลอก **Web app URL** ที่ลงท้ายด้วย `/exec` ตัวอย่าง:

   ```text
   https://script.google.com/macros/s/AKfycb...ตัวระบุการDeploy.../exec
   ```

9. เก็บ URL นี้ไว้เป็น `APPS_SCRIPT_URL`

**สำคัญ:** เลือก Anyone หมายถึง URL ของ API เปิดให้เข้าถึงจากอินเทอร์เน็ตได้ แต่คำสั่งข้อมูลต้องผ่าน Session token และคำสั่ง setup ต้องผ่าน Setup Key โค้ดที่ให้มามีการตรวจสิทธิ์ Admin/Staff ฝั่ง Apps Script แล้ว อย่าเผยแพร่ Setup Key และเปลี่ยนรหัสผ่านตัวอย่างทันทีหลังเริ่มระบบ

ถ้า Google Workspace ขององค์กรไม่มีตัวเลือก Anyone หรือมีข้อความว่าไม่อนุญาตให้เข้าถึงแบบสาธารณะ ให้สอบถามผู้ดูแล Workspace การตั้งเป็น “Anyone with Google account” อาจไม่ทำงานกับ Vercel proxy ที่ไม่ได้เข้าสู่ระบบ Google

## ส่วนที่ 5 — ตั้งค่า Vercel Frontend

1. ใช้ GitHub Desktop สร้าง repository จากโฟลเดอร์ `vercel-app` และตั้งเป็น **Private**
2. ตรวจว่าใน repository มี `index.html`, โฟลเดอร์ `api/ims.js`, `package.json` และ `setup.html`
3. อย่า Commit `.env` ที่มีค่าจริง หากมีไฟล์ `.env` ในเครื่อง ให้ตรวจว่า `.gitignore` กันไว้
4. ใน Vercel คลิก **Add New → Project** แล้ว Import repository
5. ถ้า repository root คือโฟลเดอร์ `vercel-app` ให้ใช้ Root Directory `./`
6. เลือก Framework preset **Other** หากถาม แล้วปล่อย Build Command/Output Directory ว่าง
7. ก่อน Deploy ให้เพิ่ม Environment Variable:

   - **Name:** `APPS_SCRIPT_URL`
   - **Value:** วาง Web app URL ที่คัดลอกไว้จากขั้นที่ 4 ให้ครบและลงท้าย `/exec`

8. เลือก Environment อย่างน้อย **Production**
9. กด Deploy และรอจนเสร็จ

Vercel proxy ตรวจรูปแบบ URL ให้เป็น Apps Script Web App URL และส่งเฉพาะรายการ API ที่กำหนดไว้ไปยัง Backend

## ส่วนที่ 6 — สร้างแท็บชีตครั้งแรก

1. เปิด URL ของ Vercel เช่น `https://ims-example.vercel.app`
2. เติม `/setup.html` ต่อท้าย URL
3. กรอก Setup Key ที่ตั้งไว้ใน Script Properties (`IMS_SETUP_KEY`)
4. กดปุ่มสร้างชีตและรอข้อความสำเร็จ
5. กลับไป Google Sheet ตรวจว่ามีแท็บ `Users`, `Parts_Inventory`, `Parts_Price`, `Transactions`, `Audit_Logs`, `Stock-Audit`; Setup จะคัดลอกประวัติเก่าจาก `Audit_Logs` ไป `Stock-Audit` โดยไม่ซ้ำตาม Audit_ID
6. เข้า URL หน้าแรกของ Vercel แล้วล็อกอินด้วย `admin` / `1234`
7. เปลี่ยนรหัสเริ่มต้นก่อนใช้งานจริง โดยแก้ Password ของบัญชีในแท็บ Users แล้วล็อกอินด้วยรหัสใหม่หนึ่งครั้ง
8. เมื่อตรวจระบบเรียบร้อย ให้ลบ `setup.html` ออกจาก repository แล้ว Commit/Push เวอร์ชันใหม่

อย่าเปิดเผย Setup Key ให้ผู้ใช้ทั่วไป แม้ลบหน้า Setup แล้ว Endpoint ก็ยังมี แต่การสร้างชีตจะต้องส่ง key ถูกต้อง

## วิธีอัปเดต Apps Script หลังแก้โค้ด

การกด Save ใน editor อย่างเดียวไม่ทำให้ Web App deployment version เดิมอัปเดตเสมอไป:

1. แก้ `Code.gs` แล้วกด Save
2. คลิก **Deploy → Manage deployments**
3. คลิกไอคอนแก้ไข (ดินสอ) ของ Web App deployment ปัจจุบัน
4. ในช่อง Version เลือก **New version**
5. คลิก **Deploy**
6. โดยทั่วไป URL `/exec` ของ deployment เดิมยังใช้ได้ ให้นำไปทดสอบอีกครั้ง

ถ้าสร้าง deployment ใหม่จนได้ URL ใหม่ อย่าลืมเปลี่ยน `APPS_SCRIPT_URL` ใน Vercel และ Redeploy Vercel ด้วย

### อัปเดตระบบที่ใช้อยู่ให้มี `Stock-Audit`

1. วางโค้ด `apps-script/Code.gs` รุ่นใหม่ใน Apps Script แล้ว Deploy เป็น **New version** ตามขั้นตอนข้างบน
2. Push ไฟล์หน้าเว็บและ API รุ่นใหม่จาก `vercel-app` ขึ้น GitHub เพื่อให้ Vercel Deploy
3. ให้แน่ใจว่า `setup.html` มีอยู่ใน deployment ชั่วคราว แล้วเปิด `https://โดเมนของคุณ/setup.html` กรอก Setup Key และกดสร้างชีตอีกครั้ง
4. ตรวจ Google Sheet ว่ามีแท็บ `Stock-Audit` และมีประวัติเก่าคัดลอกจาก `Audit_Logs` แล้ว (ระบบใช้ `Audit_ID` ป้องกันการคัดลอกซ้ำ)
5. ทดสอบบันทึกนับหนึ่งรายการและ Export CSV จากหน้า Stock Audit; จากนั้นนำ `setup.html` ออกจาก GitHub อีกครั้งเพื่อไม่เปิดหน้า setup ไว้โดยไม่จำเป็น

## ทดสอบการทำงาน

- หน้าแรก Vercel แสดงฟอร์มเข้าสู่ระบบ
- ล็อกอิน Admin ได้ และเห็นปุ่มจัดการอะไหล่/ผู้ใช้
- เพิ่มอะไหล่ทดลอง แล้วเห็นข้อมูลในแท็บ Parts_Inventory
- ทำรายการรับเข้า/เบิก แล้วเห็นข้อมูลใน Transactions
- ทดสอบ Stock Audit แล้วกดบันทึก ตรวจรายการใหม่ในชีต `Stock-Audit`; กด **Export Stock-Audit** เพื่อดาวน์โหลด CSV ได้จากหน้าเว็บ
- ตรวจแท็บ `Parts_Price` ว่ามีรหัสอะไหล่และราคา โดย `Part_Code` เชื่อมกับ `Part_No` ใน `Parts_Inventory` แบบไม่สนตัวพิมพ์เล็ก/ใหญ่และตัดช่องว่างหัวท้าย; หน้า Parts Inventory ของ Admin แสดงสถานะ Price match หากไม่พบ ระบบจะไม่ใช้ราคาค้างจาก Inventory และให้แก้รหัส/ราคาในชีต `Parts_Price` ราคาที่ขาดหรือไม่ใช่ THB จะไม่รวมในยอด Stock value (THB)
- ลองล็อกอิน Staff แล้วตรวจว่า Unit cost ไม่แสดง
- บัญชี Staff เปิด Stock Audit บนมือถือได้: กด **เปิดกล้องสแกน** ครั้งเดียว กล้องจะค้างไว้ให้ไล่ยิงบาร์โค้ด/QR ต่อเนื่อง แต่ละรหัสที่พบในระบบเพิ่มจำนวน 1 ชิ้นและรวมรหัสซ้ำเป็นยอดเดียว มีแถบแจ้งเตือนสีเขียวด้านบนและคิวสรุปใต้ภาพกล้อง; หากยิง 100 Part จะรออยู่ในรายการ 100 Part (รหัสเดิมที่ยิงซ้ำจะเพิ่มจำนวนในแถวเดียว) เมื่อเสร็จให้กด **Close** ปิดกล้อง ตรวจ/ลบรายการผิด แล้วกด **ยืนยันและบันทึกทั้งหมด** ครั้งเดียว ระบบจึงบันทึกชุดเดียวลง `Stock-Audit`
- หน้า Stock Audit ไม่มีตารางรายการ Parts หรือปุ่ม Adjust Stock; เพิ่มเข้าคิวได้ 3 วิธี: กล้อง, ปืน Barcode แบบ USB/Bluetooth ที่ทำงานเป็นคีย์บอร์ด, หรือพิมพ์ Part code ในช่องแล้วกด Enter/ปุ่ม **เพิ่ม 1 ชิ้น** ปืนยิงต้องแตะโฟกัสช่องรหัสก่อนใช้งาน และตั้ง suffix เป็น Enter/CR โดยไม่ส่งข้อความ prefix เกินจากรหัสสินค้า
- วิธีป้องกันรหัสผิด/นับซ้ำ: ระบบตัดช่องว่างหัวท้ายและเทียบ Part code โดยไม่สนตัวพิมพ์เล็ก/ใหญ่, รับเฉพาะรหัสที่มีใน Parts Inventory (รหัสไม่พบขึ้น X สีแดงและไม่เข้าคิว), หนึ่งครั้งที่กด Enter/เพิ่มจะนับหนึ่งชิ้นและล้างช่องหลังสำเร็จเพื่อกันกดซ้ำ; รหัสเดิมสแกนหรือส่ง Enter ใหม่จะเพิ่มจำนวนใน Part แถวเดิม หลังสแกนแล้วแก้จำนวน กด **+1** หรือลบได้จากคิวเท่านั้น ส่วนการปรับ `Current_Stock` ทำผ่านหน้า Parts Inventory สำหรับ Admin
- ก่อนยืนยัน Scan Queue แสดงยอด **จำนวน Part code ไม่ซ้ำ** และ **จำนวนชิ้นรวม** โดยคำนวณใหม่ทันทีหลังสแกน กด +1 แก้จำนวน หรือลบรายการ; เมื่อกดยืนยันจะมีหน้าต่างทวนยอดและรายการที่จะบันทึกอีกครั้งก่อนเขียนลง `Stock-Audit`
- ลองตั้ง `Current_Stock` ของ Part ที่มีอยู่ให้เป็น `0` แล้วสแกน: ต้องเข้าคิวได้ตามปกติ เพราะระบบตรวจว่ามี Part code ใน Inventory ไม่ได้ปฏิเสธเพราะสต็อกเป็นศูนย์; สแกนรหัสที่ไม่มีใน Inventory ต้องเห็นเครื่องหมาย X สีแดงและข้อความ **ไม่พบรหัสพาร์ทนี้** และรายการนั้นไม่เข้าคิว
- Dashboard เปรียบเทียบยอด `System_Stock` กับ `Actual_Count` จากผลนับล่าสุดต่อ Part code (ไม่บวกประวัติหลายรอบซ้ำ) แสดงยอดระบบรวม ยอดนับจริง ผลต่างสุทธิ ผลต่างรวมแบบ absolute และจำนวน Part ที่ต้องตรวจสอบ; รายละเอียดแยกรหัสยังซ่อนอยู่จนกด **Detail**
- Admin เห็นปุ่ม **Data cleanup** บน Dashboard เลือกตรวจ/ลบประวัติ Stock-Audit, ประวัติธุรกรรม หรืออะไหล่จาก Inventory ได้ทีละรายการ ต้องยืนยันก่อนลบ; การลบ transaction history ไม่ได้ปรับย้อนยอดสต็อก ส่วนการลบ Part จะลบแถวที่เกี่ยวข้องใน `Parts_Price` ด้วย

## แก้ปัญหาเบื้องต้น

- **`ยังไม่ได้ตั้งค่า APPS_SCRIPT_URL`** — เพิ่ม Environment Variable ใน Vercel แล้ว Redeploy
- **API ตอบ HTML แทน JSON** — ตรวจว่า Apps Script deploy เป็น Web App, URL ลงท้าย `/exec`, ตั้ง access เป็น Anyone และใช้ URL ของ deployment ไม่ใช่ URL editor
- **Apps Script ขอให้ Sign in / Permission denied** — ตรวจการตั้ง Who has access และข้อจำกัดของ Google Workspace
- **`Setup key ไม่ถูกต้อง`** — ตรวจค่าใน Script Properties ชื่อ `IMS_SETUP_KEY` และค่าที่กรอก ต้องตรงกันทุกตัวอักษร
- **`Missing sheet`** — เปิด `/setup.html` แล้วทำ Setup หรือสร้างแท็บ/หัวตารางตามที่ระบบกำหนด
- **แก้ Code.gs แล้วแต่ระบบทำงานแบบเดิม** — ไป Deploy → Manage deployments → Edit → New version → Deploy
- **Vercel Function timeout** — ตรวจ Apps Script Executions และ Google Sheet ว่ามีข้อมูลจำนวนมากหรือมีการเรียกพร้อมกันสูงหรือไม่

## ข้อควรทราบด้านความปลอดภัย

Apps Script Web App ใช้ Execute as Me และ Anyone จึงมีสิทธิ์ทำงานกับชีตในนามเจ้าของบัญชี แต่ Apps Script API ตรวจ Session และ Role ก่อนคำสั่งข้อมูล ระบบนี้เหมาะกับทีมขนาดเล็ก/ปริมาณงานไม่สูง ควรเปลี่ยนรหัสตัวอย่าง จำกัดผู้ใช้ Admin สำรองชีตเป็นระยะ และอย่าแชร์ `APPS_SCRIPT_URL` พร้อม Setup Key ในพื้นที่สาธารณะ

Apps Script Cache สำหรับ Session อาจหมดอายุก่อนเวลาที่ระบุได้ตามธรรมชาติของ Cache ทำให้ผู้ใช้อาจต้องเข้าสู่ระบบใหม่ หากมีธุรกรรมพร้อมกันจำนวนมาก Google Sheet อาจเกิดการชนกันของการปรับยอด จึงควรทดสอบด้วยข้อมูลจำลองก่อนใช้เป็นระบบคลังหลัก
