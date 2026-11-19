# รายงานตรวจโค้ด Vercel — IMS

> **รายงานนี้ตรวจสถาปัตยกรรมรุ่นก่อน (Vercel API เชื่อม Google Sheets โดยตรงผ่าน OIDC)** ปัจจุบันเปลี่ยนเป็น Vercel frontend + Apps Script backend แล้ว โปรดใช้ README ปัจจุบันและทดสอบ end-to-end หลัง Deploy ใหม่

ตรวจ `api/ims.js`, `index.html`, `setup.html` และคู่มือในโฟลเดอร์ `vercel-app` วันที่ 17 พฤศจิกายน 2026

## สรุปผล

โครงสร้างโดยรวมเหมาะกับ Vercel แบบ Static Frontend + Node.js Function ใน `api/` และใช้ Google Sheets API จากฝั่งเซิร์ฟเวอร์ การเรียก API แทน `google.script.run` ถูกเชื่อมไว้แล้ว และมีการตรวจ Admin ที่ฝั่งเซิร์ฟเวอร์ ไม่ได้พึ่งแค่การซ่อนปุ่มในหน้าเว็บ หลังตรวจพบว่านโยบาย Google Cloud ไม่อนุญาตให้สร้าง Service Account Key ผมเปลี่ยน backend ให้ใช้ Vercel OIDC Workload Identity Federation (`@vercel/oidc` + `google-auth-library`) แทนการเก็บ JSON key ระยะยาว

ผมแก้จุดเสี่ยง XSS ในตาราง Inventory, Audit และ User management แล้ว โดย escape ค่าที่มาจาก Google Sheet และผูกปุ่มผ่าน event listener แทนการแทรกค่า Part_No/Username ลงใน `onclick` ที่รัน JavaScript ได้ ส่วนฟังก์ชัน Edit Part เชื่อมกับ API ฝั่งเซิร์ฟเวอร์แล้ว

ตรวจไวยากรณ์ของ API JavaScript, inline JavaScript ของหน้าเว็บและหน้า Setup รวมถึงโครงสร้าง `package.json` แล้วผ่าน และยืนยันว่าเวอร์ชัน Vercel ไม่มี `google.script.run` เหลืออยู่ การตรวจนี้ **ยังไม่ใช่การทดสอบ end-to-end** เพราะยังไม่ได้ติดตั้ง `googleapis` และยังไม่มี Spreadsheet ID/Service Account ของผู้ใช้เพื่อเชื่อมกับ Google Sheets จริง

## จุดที่ควรแก้ก่อนเปิดใช้งานจริง

### 1. Session อยู่ใน localStorage และออกจากระบบไม่ได้เพิกถอน token ที่ฝั่งเซิร์ฟเวอร์ — ความสำคัญสูง

หน้าเว็บเก็บ HMAC token ใน `localStorage` ซึ่ง JavaScript ทุกตัวที่ทำงานในหน้าเดียวกันอ่านได้ หากหน้าเว็บเกิด XSS token อาจถูกขโมยได้ API `logout` ปัจจุบันตรวจ token แล้วตอบสำเร็จ แต่ไม่ได้เพิกถอน token จากฝั่งเซิร์ฟเวอร์ ดังนั้น token ที่ถูกคัดลอกไปยังคงใช้ได้จนหมดอายุ (ปัจจุบัน 6 ชั่วโมง)

**แนะนำ:** เปลี่ยนเป็น cookie ที่ตั้ง `HttpOnly; Secure; SameSite=Lax` และเพิ่มกลไกเพิกถอน Session ฝั่งเซิร์ฟเวอร์ พร้อมตรวจบัญชีและ Role ปัจจุบันจาก Users ทุกครั้ง หรือใช้ผู้ให้บริการ Authentication ที่ดูแล Session ให้ หากยังไม่เปลี่ยน ให้ใช้เครื่องที่เชื่อถือได้ ออกจากระบบหลังใช้ และอย่าใช้รหัสผ่านตัวอย่าง

### 2. การปรับสต็อกไม่เป็น transaction เดียว — ความสำคัญสูงเมื่อมีผู้ใช้พร้อมกัน

`transact()` อ่านยอดเดิม จากนั้นเขียนยอดใหม่และ append ประวัติคนละ API request หากมีพนักงานสองคนเบิก Part_No เดียวกันในเวลาใกล้กัน ทั้งคู่สามารถอ่านยอดเดิมเดียวกันแล้วเขียนทับกัน ทำให้ยอดคลาดเคลื่อนหรือเบิกเกินจริงได้ Google Sheets API ไม่ได้ทำให้ลำดับ read-check-write-append หลายคำสั่งนี้เป็น transaction เดียว

**แนะนำ:** หากมีผู้ใช้ทำรายการพร้อมกันหรือสต็อกมีมูลค่าสูง ให้ย้ายส่วน Stock/Transactions ไปฐานข้อมูลที่รองรับ transaction เช่น PostgreSQL/Supabase/Cloud SQL หรือสร้างคิว/ตัวกลางที่ serialize คำสั่ง อย่าถือว่า `batchUpdate` เพียงอย่างเดียวแก้ race condition ของการอ่านและตรวจยอดได้

### 3. ความหมาย `RETURN` ต้องยืนยันกับผู้ใช้ระบบ

ตอนนี้ `RETURN` ลด `Current_Stock` แบบเดียวกับ `OUT` เพราะถูกตีความว่าอะไหล่ที่ช่างคืนเป็นชิ้นเสียและไม่ควรนับเป็นสต็อกดี แต่ชื่อ `RETURN` อาจถูกเข้าใจว่าเพิ่มจำนวนกลับเข้าคลัง อีกทั้งมี `Part_Condition` ระดับรายการ ไม่ใช่จำนวนแยก Good/Defective

**แนะนำ:** ตกลงกติกาธุรกิจก่อนใช้จริง เช่น แยกยอด Good กับ Defective, มีตำแหน่ง/สถานะเคลม, และกำหนดว่า RETURN เพิ่มหรือลดสต็อกประเภทใด จากนั้นปรับ schema และรายงานให้สอดคล้องกัน

### 4. เวลาใช้ UTC แต่ผู้ใช้อาจอ่านเป็นเวลาไทย — ความสำคัญปานกลาง

`stamp()` แปลงเวลาด้วย `toISOString()` ซึ่งเป็น UTC ขณะที่ช่องค้นหาประวัติกรองวันที่ที่หน้าเว็บ หากทีมทำงานตามเวลาไทย รายการช่วงหลังเที่ยงคืน/ก่อน 07:00 อาจไปอยู่คนละวันที่ผู้ใช้คาดไว้

**แนะนำ:** ระบุโซนเวลาให้ชัด เช่น `Asia/Bangkok` ที่ฝั่ง API และใช้รูปแบบเดียวกันตลอดทั้งชีต รายงาน และตัวกรองวันที่

### 5. Export CSV อ่าน Transactions ทั้งหมด — ความสำคัญปานกลางเมื่อข้อมูลโต

หน้า History แสดงข้อมูลล่าสุด 300 รายการ แต่ `getCsvData()` อ่านทุกแถวแล้วส่งกลับในคำขอเดียว เมื่อประวัติโตมาก คำขออาจช้า ใช้หน่วยความจำมาก หรือเกินขนาดตอบกลับที่เหมาะสม

**แนะนำ:** เพิ่มการแบ่งหน้า/กรองวันที่ฝั่ง API และ Export เฉพาะช่วงวันที่หรือช่วงข้อมูลที่ผู้ใช้เลือก

### 6. การลบอะไหล่ลบแถว แต่ประวัติยังเก็บ Part_No — ความสำคัญปานกลาง

ลบอะไหล่จาก Parts_Inventory แล้วรายการใน Transactions/Audit_Logs ยังคงอยู่ตามรหัสเดิม ซึ่งช่วยรักษาประวัติ แต่ไม่มีความสัมพันธ์แบบฐานข้อมูลคอยบอกว่าเป็นอะไหล่ที่เลิกใช้แล้ว และถ้ามี Part_No ซ้ำในอนาคต รายงานเก่าอาจดูสับสน

**แนะนำ:** ใช้สถานะ `Archived`/`Inactive` แทนการลบจริง หรือห้ามนำ Part_No เดิมกลับมาใช้

### 7. หน้ารวมมูลค่าใช้สกุลเงิน USD คงที่ — ความสำคัญปานกลางสำหรับการใช้งานในไทย

หน้า Dashboard ใช้ `Intl.NumberFormat` แบบ `currency: 'USD'` หาก Unit_Cost ในชีตเป็นเงินบาท ตัวเลขจะมีสัญลักษณ์ผิด

**แนะนำ:** กำหนดสกุลเงินตามธุรกิจ เช่น `THB` และจัดรูปแบบตัวเลข/ภาษาตาม locale ที่ต้องการ

### 8. Login ยังไม่มีการจำกัดจำนวนครั้ง — ควรทำก่อนเปิดสาธารณะ

API login เปิดให้เรียกผ่าน URL สาธารณะ และยังไม่มี rate limit/lockout ป้องกันการเดารหัสผ่าน ค่าเริ่มต้น `admin/1234` อ่อนมาก

**แนะนำ:** เปลี่ยนรหัสตัวอย่างทันที เพิ่ม rate limit หรือ CAPTCHA/ระบบ authentication ที่เหมาะสม และจำกัดผู้ใช้/การเข้าถึงตามนโยบายขององค์กร

## เช็กลิสต์ก่อนเชื่อมข้อมูลจริง

- สำหรับเวอร์ชันล่าสุด ให้ใช้ `SPREADSHEET_ID`, `GCP_PROJECT_NUMBER`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_AUDIENCE`, `SESSION_SECRET` และ `SETUP_KEY`; ไม่ต้องใช้ JSON Key
- เปิด Google Sheets API และ IAM Service Account Credentials API, ตั้ง WIF provider และให้ `roles/iam.workloadIdentityUser` กับ Vercel principal เฉพาะ project/environment ที่อนุญาต
- แชร์ Sheet ให้ `client_email` ของ Service Account ด้วยสิทธิ์ Editor โดยตรง ห้ามเปิดชีตเป็น Anyone with the link
- ใช้ `SETUP_KEY` เพียงครั้งเดียว แล้วลบตัวแปรนี้และ `setup.html` หลังสร้างชีต
- เปลี่ยนรหัสผ่าน `admin` และ `staff` ตัวอย่างก่อนให้คนอื่นใช้
- สำรองชีตและทดสอบด้วยข้อมูลทดลองก่อนใช้กับสต็อกจริง
- เปิด Vercel Function Logs หลังทดสอบ Setup, Login, Save Part, IN, OUT และ Audit
- ตรวจว่า Deploy เป็น HTTPS และทดสอบกล้องจาก URL Vercel โดยตรง ไม่ใช่หน้าเว็บที่ฝังใน side panel
