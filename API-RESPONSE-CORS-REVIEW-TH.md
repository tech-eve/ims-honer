# ผลตรวจ Apps Script Response, CORS และ Error handling

ตรวจ `apps-script/Code.gs`, `api/ims.js`, `index.html` และ `setup.html`

## สรุป CORS

สำหรับสถาปัตยกรรมปัจจุบัน **ไม่ต้องเพิ่ม CORS headers ใน Apps Script** เบราว์เซอร์ส่งคำขอไปยัง `/api/ims` บนโดเมน Vercel เดียวกับหน้าเว็บ ส่วน `api/ims.js` ซึ่งทำงานบนเซิร์ฟเวอร์เป็นผู้ส่ง POST ต่อไปยัง Apps Script ดังนั้น CORS policy ของเบราว์เซอร์ไม่ได้ใช้กับการเชื่อมต่อระหว่างเซิร์ฟเวอร์สองตัว

อย่าเปลี่ยน frontend ให้ `fetch(APPS_SCRIPT_URL)` โดยตรง และอย่าใส่ `Access-Control-Allow-Origin: *` เพื่อแก้อาการ เพราะ Apps Script ContentService ไม่มี API ทั่วไปให้กำหนด response header แบบ arbitrary และการเปิด wildcard ไม่จำเป็นกับระบบที่มี Session

## รูปแบบ response ที่ใช้

Apps Script `doPost(e)` คืน JSON envelope แบบใดแบบหนึ่ง:

```json
{"ok":true,"data": ...}
```

หรือเมื่อเกิดข้อผิดพลาด:

```json
{"ok":false,"error":"ข้อความอธิบาย"}
```

Apps Script ContentService ไม่ได้ให้ควบคุม HTTP status code ตามต้องการใน response นี้ จึงอาจตอบ HTTP 200 แม้ envelope จะมี `ok:false` เป็นเรื่องที่คาดไว้: Vercel proxy อ่าน JSON แล้วแปลงเป็น status ที่ browser ใช้งานได้

- 200: สำเร็จ
- 400: ข้อมูล/คำสั่งไม่ถูกต้อง เช่น Login ผิด หรือข้อมูลที่กรอกไม่ผ่าน validation
- 401: Session หมดอายุ/ไม่ถูกต้อง หรือ Setup Key ไม่ถูกต้อง
- 403: Session ถูกต้องแต่ไม่มีสิทธิ์ Admin
- 502: Apps Script ตอบ HTML/JSON ผิดรูปแบบ, ไม่มี field `data`, ติดต่อไม่ได้ หรือหมดเวลา
- 500: ยังไม่ได้ตั้งค่า `APPS_SCRIPT_URL` หรือ URL ไม่ถูกต้อง
- 405: เรียก Vercel API ด้วย method อื่นที่ไม่ใช่ POST

Vercel proxy กำหนด `Cache-Control: no-store` เพื่อป้องกัน cache response ที่อาจมีข้อมูลของผู้ใช้

## สิ่งที่แก้แล้ว

`Code.gs` มี `doPost(e)` ที่ parse JSON, จำกัดรายการ action ที่เปิดให้เรียก, ป้องกัน Setup ด้วย Script Property `IMS_SETUP_KEY`, จับ error และคืน JSON envelope โดยไม่ส่ง stack trace กลับผู้ใช้ (รายละเอียดถูกเขียนไว้ใน Apps Script execution log)

`api/ims.js` ระบุชัดว่าการเรียก Apps Script เป็น server-to-server จึงไม่เพิ่ม CORS header, ตรวจ method/URL/action, follow redirect ของ ContentService, แปลง error ไปยัง HTTP status และตอบ 502 หาก Google ส่งหน้า HTML แทน JSON หรือ response format ไม่ครบ

## สิ่งที่ยังต้องตรวจตอน Deploy จริง

การทดสอบในเครื่องยืนยัน syntax และจำลอง response ของ proxy แล้ว แต่ยังไม่ได้ทดสอบ Google Apps Script deployment จริง ตรวจว่า URL เป็น Web App `/exec`, Execute as เป็น Me, การเข้าถึงอนุญาต Vercel เรียกได้, และ Deploy เป็น version ล่าสุด หาก Vercel ได้ HTML sign-in แทน JSON ให้ตรวจการตั้ง access ของ Web App และข้อจำกัด Google Workspace

เนื่องจาก Apps Script Web App อาจ redirect response ของ ContentService ไป `script.googleusercontent.com` โค้ด proxy ใช้ `fetch` ที่ follow redirect; ให้ทดสอบ Setup และ Login จริงบน Vercel หลัง deploy ก่อนใช้ข้อมูล production