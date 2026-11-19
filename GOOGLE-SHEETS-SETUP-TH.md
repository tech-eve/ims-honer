# คู่มือตั้ง Google Sheets แบบไม่ใช้ JSON Key

> **เอกสารนี้เป็นของสถาปัตยกรรมเวอร์ชันก่อน** รุ่นปัจจุบันเชื่อม Google Sheet ผ่าน Google Apps Script และไม่ต้องตั้งค่า Google Cloud API, Service Account หรือ OIDC ดู [คู่มือ Vercel Frontend + Apps Script Backend](README-TH.md) แทน

คู่มือนี้ใช้ **Workload Identity Federation (OIDC)** เชื่อม Vercel กับ Google Cloud โดยไม่สร้างหรือเก็บ Service Account JSON Key วิธีนี้เหมาะกับกรณีที่ Google Cloud แจ้งว่าไม่อนุญาตให้สร้าง Key และยังเป็นแนวทางที่ปลอดภัยกว่า เพราะ Vercel ขอ credential อายุสั้นเมื่อ Function ทำงาน แทนการเก็บกุญแจระยะยาว [1] [2]

> **ข้อสำคัญ:** หากผู้ดูแล Google Cloud ปิดการสร้าง Service Account Key นี่เป็นนโยบายความปลอดภัย ไม่ใช่คุณตั้งค่าผิด อย่าปิดนโยบาย `iam.disableServiceAccountKeyCreation` เพื่อให้ผ่านขั้นตอนนี้ ใช้คู่มือนี้แทน

## สิ่งที่ต้องเตรียม

คุณต้องมีบัญชี Google ที่สร้าง Google Cloud Project และ Workload Identity Pool ได้ รวมถึงสิทธิ์จัดการ Service Account และ IAM policy ให้กับบัญชีบริการ ถ้าเมนูหรือปุ่มบางอย่างหายไป อาจเป็นเพราะสิทธิ์บัญชีไม่พอ ให้ผู้ดูแล Google Cloud ช่วยทำส่วนนั้น

อีกด้านหนึ่งต้องมีโปรเจกต์ Vercel ที่เชื่อม GitHub แล้ว และจำค่า Team slug, ชื่อ Vercel project และ Environment ที่ต้องใช้ให้ได้ วิธีนี้ใช้ได้กับทุกแผน Vercel ตามเอกสาร Vercel [1]

## ภาพรวมสิ่งที่จะสร้าง

- Google Sheet ที่เก็บข้อมูล IMS
- Google Cloud Project ที่เปิด Google Sheets API และ IAM Service Account Credentials API
- Service Account (สร้างบัญชีได้ แต่ **ไม่สร้าง Key**)
- Workload Identity Pool และ OIDC Provider ที่เชื่อถือ Vercel
- สิทธิ์ให้เฉพาะ Deployment ของ Vercel project/environment ที่ระบุ impersonate Service Account ได้
- การแชร์ไฟล์ Google Sheet ให้ Service Account เป็น Editor
- Environment Variables บน Vercel ที่ไม่มี Private Key

## ขั้นที่ 1 — สร้าง Google Sheet และจด Spreadsheet ID

1. เปิด [Google Sheets](https://sheets.google.com) และสร้างสเปรดชีตใหม่
2. ตั้งชื่อ เช่น `IMS Spare Parts Database`
3. URL จะหน้าตาประมาณ `https://docs.google.com/spreadsheets/d/1AbCdEf...123/edit`
4. คัดลอกเฉพาะข้อความระหว่าง `/d/` กับ `/edit` เก็บไว้เป็น `SPREADSHEET_ID`
5. อย่าสับสนกับ `gid=0` ซึ่งเป็นรหัสของแท็บ ไม่ใช่รหัสไฟล์

## ขั้นที่ 2 — เลือก Google Cloud Project และเปิด API

1. เปิด [Google Cloud Console](https://console.cloud.google.com/)
2. เลือก Project ที่จะใช้ หรือสร้างใหม่ เช่น `IMS Vercel`
3. เปิด **☰ → APIs & Services → Library**
4. ค้นหา **Google Sheets API** แล้วกด **Enable**
5. กลับไป Library ค้นหา **IAM Service Account Credentials API** แล้วกด **Enable** เพื่อให้ระบบออก access token ชั่วอายุสั้นตอน impersonate Service Account
6. จด **Project ID** และ **Project number**: ไปที่ **☰ → IAM & Admin → Settings** หรือหน้า Project Dashboard แล้วคัดลอกค่าทั้งสอง ค่าที่ใช้ใน `GCP_PROJECT_NUMBER` เป็นเลข Project number ไม่ใช่ Project ID

ถ้าเห็น **Manage** แทน **Enable** แปลว่า API นั้นเปิดอยู่แล้ว ตรวจให้แน่ใจว่าคุณกำลังดู Project เดียวกับที่จะเก็บ Service Account และ Workload Identity Pool

## ขั้นที่ 3 — สร้าง Service Account โดยไม่สร้าง Key

1. ไปที่ **☰ → IAM & Admin → Service Accounts**
2. กด **Create Service Account**
3. ตั้งชื่อ เช่น `ims-vercel-app` แล้วกด Continue/Create
4. ถ้ามีหน้าจอถามว่าจะให้ Project role อะไรแก่ Service Account ให้ยังไม่ต้องเลือก เพราะเราไม่ต้องการสิทธิ์กว้างทั้งโปรเจกต์
5. กด Done เพื่อสร้าง
6. เปิด Service Account ที่สร้าง แล้วคัดลอกอีเมล เช่น `ims-vercel-app@your-project.iam.gserviceaccount.com` บันทึกเป็น `GCP_SERVICE_ACCOUNT_EMAIL`
7. **ไม่ต้องเปิดแท็บ Keys และไม่ต้องกด Add key**

การสร้าง Service Account ทำได้โดยไม่สร้าง Key บัญชีบริการจะเข้าถึง Google Workspace file ที่แชร์ให้โดยตรงได้ [3]

## ขั้นที่ 4 — สร้าง Workload Identity Pool และ OIDC Provider

สำหรับคำอธิบายแบบเจาะลึกทีละหน้าจอ พร้อมตัวอย่าง Audience URI, CEL condition, principal URI และการมอบ Role ให้ Service Account เปิด [คู่มือ Workload Identity แบบจับมือทำ](WORKLOAD-IDENTITY-SETUP-TH.md)

หน้าจอ Google Cloud อาจเปลี่ยนตำแหน่งตามเวอร์ชัน Console แต่ให้หา **IAM & Admin → Workload Identity Federation** แล้วเริ่มสร้าง Pool

### 4.1 สร้าง Pool

1. ไปที่ **☰ → IAM & Admin → Workload Identity Federation**
2. กด **Create pool**
3. ตั้งชื่อ เช่น `vercel-ims`
4. ใช้ Pool ID ที่ระบบสร้างให้ หรือกำหนดเป็น `vercel-ims` (Pool ID เปลี่ยนภายหลังไม่ได้ ให้ตรวจให้ดีก่อนสร้าง)
5. ตั้ง Description เช่น `OIDC identities from Vercel IMS app`
6. กด **Continue**

จด Pool ID ไว้เป็น `GCP_WORKLOAD_IDENTITY_POOL_ID`

### 4.2 สร้าง Provider แบบ OpenID Connect

1. เลือก Provider type **OpenID Connect (OIDC)**
2. ตั้ง Provider name เช่น `vercel-ims-production`; จด Provider ID ที่ได้เป็น `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`
3. Vercel แนะนำ **Team issuer**. Issuer URL มีรูปแบบ:

   ```text
   https://oidc.vercel.com/TEAM_SLUG
   ```

   เปลี่ยน `TEAM_SLUG` เป็น slug ของ Vercel Team ที่ URL ของทีม/โปรเจกต์จริงใช้ ไม่ใช่ชื่อที่แสดงผลทั่วไป หากบัญชีเป็น personal team ให้ดู slug ที่ปรากฏใน URL/dashboard ของ Vercel และใช้ตามนั้น
4. เลือก **Default audience** (แนะนำ) เพื่อให้ Google สร้าง audience URI ที่ระบุ Provider นี้โดยเฉพาะ หลังสร้าง Provider แล้วให้คัดลอก URI ที่ Google แสดงไว้ ตัวอย่างรูปแบบ:

   ```text
   https://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID
   ```

   ค่านี้จะเป็น `GCP_AUDIENCE` ใน Vercel ห้ามแต่งเองหาก Console มี URI จริงให้คัดลอก
5. ปล่อย **JWK file** ว่าง เพราะ Google จะอ่าน public keys จาก OIDC issuer ของ Vercel
6. ใน **Attribute mapping** ให้เพิ่ม mapping นี้:

   ```text
   google.subject = assertion.sub
   ```

7. กำหนด **Attribute condition** เพื่อจำกัดให้เฉพาะ Vercel Team, Project และ Environment ที่ตั้งใจอนุญาตเท่านั้น ใช้ claim `sub` ที่ Vercel แสดง/เอกสารกำหนดในรูปแบบ:

   ```text
   assertion.sub == 'owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:production'
   ```

   แทนที่ `TEAM_SLUG` และ `VERCEL_PROJECT_NAME` ด้วยค่าจริงของคุณ ถ้าจะให้ Preview ทำงานด้วย ต้องเพิ่มเงื่อนไขสำหรับ environment `preview` อย่างชัดเจน เช่น CEL expression:

   ```text
   assertion.sub == 'owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:production' || assertion.sub == 'owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:preview'
   ```

   เริ่มต้นให้อนุญาตเฉพาะ `production` ก่อน และอย่าใช้เงื่อนไขกว้างที่อนุญาตทุกโปรเจกต์หรือทุก environment
8. บันทึก Provider แล้วเปิดรายละเอียด Provider เพื่อตรวจ **Issuer**, **Audience**, **Attribute mapping** และ **Condition** ให้ถูกต้อง

Vercel ระบุค่า Team issuer, audience, mapping, วิธีสร้าง principal และการส่ง token ผ่าน `getVercelOidcToken()` ในคู่มือ GCP OIDC โดยตรง [1] Google อนุญาตให้ใช้ attribute condition จำกัด OIDC identity ที่รับได้ [2]

## ขั้นที่ 5 — อนุญาตให้ Vercel ใช้ Service Account นี้

ขั้นนี้เชื่อม “ตัวตนจาก Vercel” เข้ากับ Service Account ที่สร้างไว้ ไม่ใช่การให้ Vercel เข้าถึงทั้ง Google Cloud Project

1. เปิดหน้า Workload Identity Pool/Provider แล้วคัดลอก **IAM principal** หรือสร้าง principal identifier ตามรูปแบบที่ Google Console แสดง
2. Subject ต้องตรงกับค่าของ Vercel Deployment ที่อนุญาต เช่น:

   ```text
   owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:production
   ```

3. เปิด **IAM & Admin → Service Accounts** แล้วคลิก `ims-vercel-app`
4. ไปที่แท็บ **Permissions** หรือ **Grant access** ของ Service Account
5. เพิ่ม principal จากขั้นที่ 1 โดยใช้ principal แบบเจาะจงถึง subject ที่อนุญาต (หลีกเลี่ยง principalSet แบบกว้าง หากไม่จำเป็น)
6. ให้ Role **Workload Identity User** (`roles/iam.workloadIdentityUser`) กับ principal นั้นบน Service Account นี้
7. บันทึก

โดยทั่วไป WIF service-account impersonation ต้องให้ principal มี `roles/iam.workloadIdentityUser` บน Service Account เป้าหมาย และการ map/condition ต้องสอดคล้องกับ subject ที่เลือก [1] [2] หาก Google Console แสดงตัวช่วย **Grant access / Allow identities from this pool to impersonate this service account** ให้ใช้ตัวช่วยนั้นและเลือก Role Workload Identity User

## ขั้นที่ 6 — แชร์ชีตให้ Service Account

1. กลับไป Google Sheet ที่สร้างในขั้นที่ 1
2. กด **Share / แชร์**
3. เพิ่มอีเมล `GCP_SERVICE_ACCOUNT_EMAIL` ที่จดไว้ในขั้นที่ 3
4. ให้สิทธิ์ **Editor** เพราะ IMS ต้องสร้างแท็บและเขียนข้อมูล
5. ปิดการแจ้งเตือนอีเมลได้ แล้วกด Share/Send
6. ตรวจว่าบัญชีบริการปรากฏในรายการ Share และมีสิทธิ์ Editor

อย่าเปิดชีตเป็น “Anyone with the link” เพื่อแก้ปัญหา permission การเปิด Sheets API และการตั้ง IAM ใน Cloud ไม่ได้แทนการแชร์ไฟล์ Google Sheet ให้ Service Account [3]

## ขั้นที่ 7 — ตั้งค่า Vercel Environment Variables

ใน Vercel เปิด Project → **Settings → Environment Variables** เพิ่มค่าต่อไปนี้:

| Name | ค่า |
|---|---|
| `SPREADSHEET_ID` | Spreadsheet ID จากขั้นที่ 1 |
| `GCP_PROJECT_NUMBER` | เลข Project number จากขั้นที่ 2 |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | Pool ID จากขั้นที่ 4 |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | Provider ID จากขั้นที่ 4 |
| `GCP_SERVICE_ACCOUNT_EMAIL` | อีเมล Service Account จากขั้นที่ 3 |
| `GCP_AUDIENCE` | audience URI จริงที่คัดลอกจาก Provider ในขั้นที่ 4 |
| `SESSION_SECRET` | สุ่มข้อความลับยาวอย่างน้อย 32 ตัวอักษร |
| `SETUP_KEY` | สุ่มข้อความอีกชุด ใช้ตอนสร้างแท็บครั้งแรกเท่านั้น |

ค่ากลุ่ม GCP ข้างต้นเป็น identifier/configuration ไม่ใช่ private key แต่ยังควรตั้งเฉพาะ Project ที่ต้องใช้ เพิ่ม `Production` ก่อน หากจะทดสอบ Preview ให้เพิ่ม environment ที่ตรงกับ condition ใน Google Cloud ด้วย

`SESSION_SECRET` และ `SETUP_KEY` เป็นค่าลับ ห้ามวางในโค้ดหรือ GitHub การเปลี่ยน Environment Variables มีผลกับ Deployment ใหม่ ดังนั้นบันทึกค่าแล้วให้ Redeploy [4]

### สุ่ม Secret บน Windows

เปิด PowerShell แล้วรันคำสั่งต่อไปนี้หนึ่งครั้งสำหรับ `SESSION_SECRET` แล้วรันซ้ำอีกครั้งสำหรับ `SETUP_KEY`:

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

เก็บค่าที่ได้ไว้ใน Password Manager อย่าใช้ค่าเดียวกันทั้งสองตัว

## ขั้นที่ 8 — Redeploy แล้วเริ่มต้นชีต

1. บันทึก Environment Variables ให้ครบ
2. ไปที่ **Deployments** แล้วสั่ง Redeploy deployment ล่าสุด หรือ push commit ใหม่ให้ Vercel สร้าง deployment
3. รอให้ deployment สำเร็จ
4. เปิด `https://ชื่อโปรเจกต์.vercel.app/setup.html`
5. กรอก `SETUP_KEY` แล้วสั่งสร้างชีต
6. ถ้าขึ้นสำเร็จ ให้เปิด Google Sheet ตรวจว่ามีแท็บ `Users`, `Parts_Inventory`, `Transactions` และ `Audit_Logs`
7. เปิดหน้าแรกของเว็บแล้ว Login ด้วย `admin` / `1234` จากนั้นเปลี่ยนรหัสตัวอย่างก่อนใช้จริง
8. เมื่อ setup และทดสอบเสร็จ ให้ลบ `SETUP_KEY` ออกจาก Vercel แล้ว Redeploy และลบไฟล์ `setup.html` ออกจาก GitHub repository พร้อม push commit ใหม่

## ถ้าติดปัญหา

**`Permission denied` / HTTP 403 จาก Google Sheets:** ตรวจว่าแชร์ชีตให้ Service Account เป็น Editor แล้ว ตรวจว่า Vercel principal ได้ `roles/iam.workloadIdentityUser` บน Service Account และ Subject condition ตรงกับ Team/Project/Environment จริง

**`Invalid audience` หรือ STS exchange ล้มเหลว:** ตรวจ `GCP_AUDIENCE` ว่าคัดจากหน้า Provider ตรงตัว ตรวจ Provider audience mode เป็น Default audience และตรวจ Issuer URL ว่าตรงกับ Team slug/issuer mode ที่เลือกใน Vercel

**`The identity pool/provider was not found`:** ตรวจ Project number, Pool ID, Provider ID และ location (`global`) ว่าใส่ถูก และสร้าง Provider ใน Google Cloud Project ที่ต้องการ

**`IAM Service Account Credentials API has not been used` หรือ generateAccessToken error:** ตรวจว่าเปิด IAM Service Account Credentials API แล้ว และ Workload Identity principal มี Role ที่จำเป็นบน Service Account

**`invalid_target` / subject ไม่ผ่าน condition:** ตรวจค่า `TEAM_SLUG`, Vercel project name และ Environment ใน `assertion.sub` ให้ตรงทุกตัวอักษร ดูชื่อ Project/Environment ใน Vercel Dashboard ห้ามแก้ condition ให้กว้างแบบทุกคนเข้าได้เพื่อทดลอง

**ระบบขึ้น `ยังไม่ได้ตั้งค่าตัวแปร ...`:** ตรวจชื่อ Environment Variable และตรวจว่า Redeploy หลังบันทึกแล้ว

ตรวจรายละเอียดเพิ่มที่ **Vercel → Deployments → deployment ล่าสุด → Functions / Logs** โดยอย่านำ log ที่มีข้อมูลลับไปโพสต์สาธารณะ

## ถ้าไม่มีสิทธิ์สร้าง Pool หรือกำหนด IAM

แม้ว่าวิธีนี้ไม่ใช้ Key แต่ยังต้องมีสิทธิ์จัดการ Workload Identity Pool/Provider และมอบ Role ให้ Service Account ถ้า Google Cloud เป็นขององค์กร ให้ส่งคู่มือนี้ให้ผู้ดูแล Cloud ทำขั้นที่ 2–5 ให้ หรือสร้าง Cloud Project ส่วนตัวที่คุณมีสิทธิ์จัดการและเก็บชีตสำหรับระบบนี้ใน Project ที่คุณควบคุม

ไม่แนะนำให้ตั้ง Google Sheet เป็น Public, ใช้ API key สำหรับข้อมูลคลังสินค้า หรือปิดนโยบายองค์กรเพื่อสร้าง JSON key เอกสาร Google แนะนำให้รักษานโยบายปิด key และเลือก federation/credential อายุสั้นเมื่อทำได้ [5]

## แหล่งข้อมูลทางการ

[1]: https://vercel.com/docs/oidc/gcp "Connect Vercel to Google Cloud with OIDC"
[2]: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers "Google Cloud Workload Identity Federation with other providers"
[3]: https://developers.google.com/workspace/guides/create-credentials "Google Workspace credentials and service accounts"
[4]: https://vercel.com/docs/environment-variables "Vercel environment variables"
[5]: https://docs.cloud.google.com/iam/docs/keys-create-delete "Create and delete service account keys"
