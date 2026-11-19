# คู่มือตั้ง Workload Identity Pool และ OIDC Provider บน Google Cloud แบบจับมือทำ

> **คู่มือนี้เป็นเอกสารจากสถาปัตยกรรมเวอร์ชันก่อนและไม่จำเป็นสำหรับรุ่นปัจจุบัน** ตอนนี้ระบบใช้ Vercel frontend + Apps Script backend จึงไม่ต้องตั้ง Workload Identity, Service Account หรือ OIDC Provider ให้อ่าน [คู่มือ Deploy รุ่นปัจจุบัน](README-TH.md) แทน

คู่มือนี้เป็นคู่มือแยกสำหรับขั้นตอนที่มักสับสนที่สุดในการเชื่อม Vercel กับ Google Cloud: สร้าง Workload Identity Pool, สร้าง OIDC Provider, จำกัดให้เฉพาะเว็บ Vercel ของเรา และผูกสิทธิ์ให้ Service Account โดย **ไม่สร้าง JSON key**

ใช้กับโปรเจกต์ IMS ในโฟลเดอร์ `vercel-app` ซึ่งโค้ดใช้ `getVercelOidcToken()` และตั้งค่า audience จาก Environment Variable `GCP_AUDIENCE` อยู่แล้ว

> **ก่อนเริ่ม:** ต้องมี Google Cloud Project, เปิด Google Sheets API และ IAM Service Account Credentials API, สร้าง Service Account แล้ว (ไม่ต้องสร้าง Key) และมี Vercel Project ที่เชื่อม GitHub แล้ว หากยังไม่ได้สร้างชีต/Service Account ให้อ่าน [คู่มือ Google Sheets แบบไม่ใช้ JSON Key](GOOGLE-SHEETS-SETUP-TH.md) ก่อน

## ทำความเข้าใจคำสำคัญก่อนลงมือ

| คำ | อธิบายง่าย ๆ |
|---|---|
| Identity Provider (IdP) | Vercel เป็นผู้ยืนยันว่า Request มาจาก Deployment ไหน |
| OIDC token | บัตรชั่วคราวที่ Vercel ออกให้กับ Function ขณะทำงาน |
| Workload Identity Pool | ด่านรับตัวตนจากภายนอกเข้ามาใน Google Cloud |
| OIDC Provider | กฎใน Pool ที่บอกว่า Google ควรเชื่อ Issuer ใด และตรวจ token อย่างไร |
| Attribute mapping | แปลง claim ใน token ของ Vercel ให้ Google ใช้เป็นตัวระบุ `google.subject` |
| Attribute condition | เงื่อนไข CEL ที่คัดว่า token จาก Team/Project/Environment ใดเข้าได้ |
| Service Account | ตัวตน Google ที่มีสิทธิ์เข้าถึง Google Sheet ของเรา |
| Workload Identity User | Role ที่อนุญาตให้ Vercel identity ขอใช้ Service Account แบบชั่วคราว |
| Audience | ระบุว่าบัตร OIDC นี้ออกมาให้ Provider/ปลายทางใด ไม่ใช่ชื่อ Project |

ภาพรวมการทำงาน:

```text
Vercel Function
   │ ขอ OIDC token (เฉพาะโปรเจกต์/สภาพแวดล้อมที่อนุญาต)
   ▼
Google STS ตรวจ Issuer + Audience + Attribute condition
   │ ถ้าผ่าน จะได้รับสิทธิ์ impersonate Service Account ชั่วคราว
   ▼
Service Account เรียก Google Sheets API
   │
   └── เปิด/แก้ไขเฉพาะชีตที่แชร์ให้ Service Account
```

Google และ Vercel แนะนำการเชื่อมแบบ Federation เพื่อหลีกเลี่ยง credential ระยะยาว [1] [2]

## เตรียมค่าที่ต้องจดไว้

จดค่าต่อไปนี้ใน Notepad ชั่วคราวก่อนเปิด Console:

| ค่าที่ต้องรู้ | ตัวอย่าง/วิธีหา |
|---|---|
| Google Cloud Project ID | ดูใน Project selector หรือหน้า Project Dashboard เช่น `ims-cloud-123` |
| Google Cloud Project number | เป็นเลขล้วน เช่น `123456789012`; ดูที่ Google Cloud → IAM & Admin → Settings หรือ Project Dashboard |
| Vercel Team slug | ดู URL ของ Vercel Team/Project และการตั้งค่า OIDC ของ Vercel เช่น `acme-team`; ใช้ slug ไม่ใช่ชื่อที่แสดงสวยงาม |
| Vercel Project name | ชื่อ Project ใน Vercel Dashboard เช่น `ims-spare-parts-vercel`; ใช้ชื่อที่อยู่ใน claim subject ตามเอกสาร Vercel |
| Vercel Environment | เริ่มจาก `production` ก่อน |
| Service Account email | เช่น `ims-vercel-app@ims-cloud-123.iam.gserviceaccount.com` |

**สำคัญ:** ค่าที่ใช้ใน principal URI คือ Project number ของ Google Cloud Project ที่บรรจุ Workload Identity Pool ไม่ใช่ Project ID และไม่ใช่ Project number ของ Vercel

## ขั้นที่ 1 — ตั้ง Vercel ให้ใช้ Team issuer และดู Team slug

Vercel มี issuer แบบ Team และ Global แนะนำให้ใช้ **Team issuer** เพื่อแยกตัวตนของทีม

1. เปิด [Vercel Dashboard](https://vercel.com/dashboard) แล้วเลือก Team ที่เป็นเจ้าของ IMS Project
2. เปิด IMS Project
3. เข้า **Settings → Security**
4. หาแผง **Secure backend access with OIDC federation** (ชื่อ/ตำแหน่งอาจต่างเล็กน้อย)
5. เลือก **Team issuer** แล้วกด Save หากยังเป็น Global
6. เปิดหน้า Vercel Team/Project URL และจด Team slug จาก URL/การตั้งค่าทีมให้ถูกต้อง ตัวอย่าง issuer ของ Team ชื่อ `acme-team` คือ:

   ```text
   https://oidc.vercel.com/acme-team
   ```

7. จดชื่อ Project ตามที่ Vercel ใช้จริง อย่าคิดชื่อใหม่เอง เพราะจะนำไปเทียบกับ `sub` claim ของ OIDC token

> หากใช้ **Global issuer** จริง URL จะเป็น `https://oidc.vercel.com` แต่คู่มือนี้ตั้งค่าแบบ Team issuer ให้จำกัดขอบเขตชัดเจน อย่าสลับ issuer mode ใน Vercel หลังสร้าง Provider โดยไม่แก้ Issuer URL ใน Google ให้ตรงกัน

## ขั้นที่ 2 — เข้าเมนู Workload Identity Federation

1. เปิด [Google Cloud Console](https://console.cloud.google.com/)
2. ที่แถบด้านบน คลิก Project selector และเลือก Google Cloud Project ที่จะเก็บ Pool และ Service Account
3. ตรวจชื่อโปรเจกต์ที่แสดงบนแถบด้านบน อย่าดำเนินการต่อถ้ายังเลือกผิดโปรเจกต์
4. คลิกเมนู **☰** ด้านซ้ายบน
5. เลือก **IAM & Admin → Workload Identity Federation**
6. ถ้าหาเมนูไม่เจอ ให้ใช้ช่องค้นหาด้านบนของ Cloud Console พิมพ์ `Workload Identity Federation`

ถ้าหน้าแจ้งว่าไม่มีสิทธิ์ ให้ผู้ดูแลเพิ่มบทบาทที่มีสิทธิ์จัดการ Workload Identity Pool/Provider เช่น `Workload Identity Pool Admin` และสิทธิ์จัดการ Service Account; อย่าแก้ด้วยการให้ Owner กว้าง ๆ หากเป็นระบบใช้งานจริง [2]

## ขั้นที่ 3 — สร้าง Workload Identity Pool

Pool คือ “ประตูรับตัวตนจากระบบภายนอก” ในขั้นนี้ยังไม่ได้ระบุ Vercel issuer จนกว่าจะสร้าง Provider

1. คลิก **Create pool** หรือ **Create identity pool**
2. ในหน้า **Create an identity pool** ใส่ค่าตัวอย่างดังนี้:

   - **Name / Display name:** `Vercel IMS Production`
   - **Pool ID:** `vercel-ims-prod`
   - **Description:** `OIDC identities for IMS production on Vercel`

3. Pool ID ใช้ใน URL และ Environment Variables ห้ามใช้ช่องว่าง ใช้ตัวพิมพ์เล็ก ตัวเลข และขีดกลางตามที่ Console อนุญาต ตรวจให้แน่ใจ เพราะ Pool ID เปลี่ยนทีหลังไม่ได้
4. ถ้ามีตัวเลือก **Enable pool** ให้เปิดใช้งาน (Enabled)
5. คลิก **Continue / Next**
6. หน้าถัดไปจะเริ่มเพิ่ม Provider ให้ทำขั้นต่อไป

จด Pool ID ตามที่ Console ยืนยันไว้จริง ตัวอย่างนี้ใช้ `vercel-ims-prod`; อย่าใส่ข้อความตัวอย่างนี้ถ้าเลือก ID อื่น

## ขั้นที่ 4 — เพิ่ม OIDC Provider ให้ Pool

Provider จะตรวจว่า token มาจาก Issuer ที่เชื่อถือได้ และมี Audience ที่ถูกต้อง

### 4.1 เลือก Provider type

1. ในหน้า **Add a provider / Configure provider**, เลือก **OpenID Connect (OIDC)** ไม่ใช่ AWS, SAML หรือประเภทอื่น
2. กรอก:

   - **Provider name / Display name:** `Vercel IMS Production`
   - **Provider ID:** `vercel-ims-prod`

3. Provider ID จะกลายเป็นส่วนหนึ่งของ Audience และไม่ควรเปลี่ยนหลังเปิดใช้ ให้ตรวจสะกดก่อน Continue

### 4.2 กรอก Issuer URL

ในช่อง **Issuer URL** ใส่ URL ที่ตรงกับ Vercel issuer mode ที่เลือกในขั้นที่ 1:

```text
https://oidc.vercel.com/TEAM_SLUG
```

ตัวอย่าง ถ้า Team slug คือ `acme-team` ให้ใส่:

```text
https://oidc.vercel.com/acme-team
```

อย่าใส่ `https://vercel.com/acme-team` เพราะนั่นไม่ใช่ OIDC Issuer URL และอย่าใส่ชื่อ Project ต่อท้าย Issuer

### 4.3 ตั้ง Audience — เลือก Default audience

หน้า Console จะให้เลือกระหว่าง **Default audience** กับ **Allowed audiences** ให้เลือก **Default audience** ซึ่ง Vercel แนะนำสำหรับการเชื่อม GCP โดยใช้ค่าเฉพาะ Provider

หลังสร้าง Provider แล้ว Google จะแสดงค่า Audience URI รูปแบบ:

```text
https://iam.googleapis.com/projects/GOOGLE_PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID
```

ตัวอย่างสมมติ:

```text
https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel-ims-prod/providers/vercel-ims-prod
```

คัดลอก **ค่าเต็มจากหน้า Google Cloud จริง** ไปเก็บเป็น `GCP_AUDIENCE` อย่าใส่ `https://vercel.com/TEAM_SLUG` ลงในตัวแปรนี้เมื่อเลือก Default audience

> โค้ด IMS ใช้ `getVercelOidcToken({ audience: GCP_AUDIENCE })` เพื่อขอ token ที่มี audience นี้ ส่วน External Account config ภายใน API สร้างค่า audience รูปแบบ `//iam.googleapis.com/projects/.../providers/...` เอง ทั้งสองรูปแบบนี้มีหน้าที่คนละส่วน อย่าแก้โค้ดให้แทนกันโดยไม่เข้าใจ

### 4.4 ไม่ต้องอัปโหลด JWK

ถ้ามีช่อง **JWK file (JSON)** ให้ปล่อยว่าง Google จะค้น public signing keys ผ่าน OIDC issuer ของ Vercel เอง การอัปโหลด JWK ไม่ใช่การอัปโหลด Service Account Key และไม่ต้องทำใน setup นี้ [2]

คลิก **Continue / Next** เพื่อไปตั้งค่า Attributes

## ขั้นที่ 5 — ตั้ง Attribute mapping

Mapping กำหนดว่า Google จะเรียกตัวตนภายนอกนี้ว่าอะไร

1. หาแผง **Configure provider attributes / Attribute mapping**
2. เพิ่มแถว mapping หนึ่งแถว:

   | Google attribute | OIDC assertion |
   |---|---|
   | `google.subject` | `assertion.sub` |

3. ถ้า Console มีแถวเริ่มต้นอื่นที่ไม่จำเป็น ให้เอาออกเพื่อให้การตั้งค่าง่ายและลดความสับสน
4. อย่า map เป็น `assertion.email` เพราะ Vercel identity ไม่จำเป็นต้องใช้ email และ Google แนะนำให้ใช้ subject ที่เป็น unique identity [2]

ค่าที่ต้องได้ตรงตัวคือ:

```text
google.subject=assertion.sub
```

อย่าใส่เครื่องหมาย quote ครอบ `assertion.sub` และอย่าใส่ `google.subject` ไว้ฝั่ง assertion

## ขั้นที่ 6 — ตั้ง Attribute condition จำกัดเฉพาะ IMS Production

Condition เป็น CEL expression ถ้าผลเป็น `true` token จึงผ่าน Provider ได้ หากเป็น `false` หรือ claim ไม่ตรง token จะถูกปฏิเสธ

1. ก่อนใส่ condition ให้ตรวจชื่อ Team slug และ Project name อีกครั้งจาก Vercel
2. ในช่อง **Attribute condition** ใส่ expression นี้ โดยแทนค่า placeholder ด้วยค่าจริง:

   ```text
   assertion.sub == 'owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:production'
   ```

   ตัวอย่างสมมติ Team slug `acme-team` และ project `ims-spare-parts-vercel`:

   ```text
   assertion.sub == 'owner:acme-team:project:ims-spare-parts-vercel:environment:production'
   ```

3. ห้ามพิมพ์ `TEAM_SLUG` หรือ `VERCEL_PROJECT_NAME` ตามตัวอย่างจริง ต้องแทนด้วยค่าของคุณ
4. ห้ามลบ `owner:`, `project:` หรือ `environment:` ออกจาก expression
5. เริ่มต้นให้เปิดเฉพาะ `production` ก่อน เพื่อไม่ให้ Preview deployments ใช้ Service Account โดยไม่ตั้งใจ
6. ถ้าต้องการให้ Preview ใช้ได้ภายหลัง ให้เพิ่ม Preview อย่างชัดเจน เช่น:

   ```text
   assertion.sub == 'owner:acme-team:project:ims-spare-parts-vercel:environment:production' || assertion.sub == 'owner:acme-team:project:ims-spare-parts-vercel:environment:preview'
   ```

   เปลี่ยนตัวอย่างให้เป็นค่าจริงก่อน Save

7. ถ้าชื่อ Vercel Project หรือ Environment ของคุณเป็น Custom Environment ให้ใช้ค่าที่ Vercel แสดงจริง ไม่ใช่คำว่า `production` โดยเดา
8. คลิก **Save / Create** เพื่อสร้าง Provider

Google กำหนดให้ attribute condition เป็น CEL expression และใช้ปฏิเสธ token ที่ไม่ตรงเงื่อนไข [2] Vercel แสดง subject pattern ตัวอย่าง `owner:TEAM:project:PROJECT:environment:production` ในวิธีตั้งค่า GCP [1]

## ขั้นที่ 7 — ตรวจ Provider ที่สร้างแล้วและคัด Audience

หลัง Save Console จะกลับมาหน้า Pool หรือ Provider list

1. คลิก Pool `vercel-ims-prod` (หรือ Pool ID ที่คุณใช้)
2. คลิก Provider ที่เพิ่งสร้าง
3. ตรวจค่าต่อไปนี้:
   - Provider type เป็น **OIDC**
   - Issuer URL ตรงกับ `https://oidc.vercel.com/TEAM_SLUG`
   - Audience mode เป็น **Default audience**
   - Attribute mapping มี `google.subject = assertion.sub`
   - Attribute condition ระบุ Vercel Team, Project และ `production`
   - Provider/Pool เปิดใช้งานอยู่
4. คัดลอก **Default audience / Provider audience** URI เต็มจากหน้า Provider
5. เก็บ URI นี้ไว้เป็น `GCP_AUDIENCE` ใน Vercel

ถ้าเปิด Provider แล้วไม่เห็น Audience ชัดเจน ให้มองหาส่วน Provider details หรือ copy audience/resource name ในหน้าเดียวกัน อย่าประกอบจากชื่อเองหากมีค่า Console แสดงให้คัดลอก

## ขั้นที่ 8 — สร้าง IAM principal ที่ตรงกับ subject

Google ใช้ Project number, Pool ID และ `google.subject` ที่ map ไว้ เพื่อสร้าง principal

รูปแบบ principal สำหรับ subject รายตัวคือ:

```text
principal://iam.googleapis.com/projects/GOOGLE_PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/subject/VERCEL_SUBJECT
```

เมื่อ subject เป็น `owner:acme-team:project:ims-spare-parts-vercel:environment:production` principal จะมีรูปแบบ:

```text
principal://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel-ims-prod/subject/owner:acme-team:project:ims-spare-parts-vercel:environment:production
```

แทน `123456789012`, Pool ID, Team slug และ Project name ด้วยค่าจริง การใส่ subject แบบรายตัวจำกัดสิทธิ์ให้ deployment ตัวเดียว/Environment เดียวมากกว่าใช้ทั้ง Pool

## ขั้นที่ 9 — ให้ Workload Identity User บน Service Account

1. ใน Cloud Console ไปที่ **IAM & Admin → Service Accounts**
2. คลิก Service Account ที่สร้างไว้ เช่น `ims-vercel-app@...`
3. เปิดแท็บ **Permissions** หรือคลิก **Manage access / Grant access** บน Service Account
4. กด **Grant access / Add principal**
5. ในช่อง **New principals** วาง principal จากขั้นที่ 8 เต็มเส้นเดียว ห้ามใส่ quote หรือ code fence
6. ในช่อง **Select a role** ค้นหาและเลือก:

   ```text
   Workload Identity User
   roles/iam.workloadIdentityUser
   ```

7. บันทึกการเปลี่ยนแปลง
8. ตรวจว่า principal ถูกเพิ่มในรายการ IAM ของ Service Account และ Role เป็น Workload Identity User

> เลือก **Workload Identity User** ไม่ใช่ `Service Account User` และไม่ใช่ `Service Account Token Creator` สำหรับกรณีมาตรฐานนี้ Google อธิบายการมอบ `roles/iam.workloadIdentityUser` ให้ federated principal บน Service Account โดยตรง [3]

ถ้า Console มีตัวช่วย “Allow identities from this pool to impersonate this service account” ให้เลือกการกรองแบบ **Only identities matching the filter** และกำหนด Subject ให้ตรงกับ `owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:production` อย่าเลือกอนุญาตทั้ง Pool หากไม่จำเป็น

## ขั้นที่ 10 — เติม Environment Variables ให้ตรงกัน

ใน Vercel Project ไปที่ **Settings → Environment Variables** และเพิ่มค่าต่อไปนี้อย่างน้อยสำหรับ **Production**:

| Vercel variable | นำค่ามาจาก |
|---|---|
| `GCP_PROJECT_NUMBER` | Project number ของ Google Cloud Project ที่มี Pool |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | Pool ID ที่สร้างในขั้นที่ 3 |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | Provider ID ที่สร้างในขั้นที่ 4 |
| `GCP_SERVICE_ACCOUNT_EMAIL` | อีเมล Service Account ที่ API จะ impersonate |
| `GCP_AUDIENCE` | Audience URI เต็มที่คัดจาก Provider details |
| `SPREADSHEET_ID` | ID ของ Google Sheet ที่แชร์ให้ Service Account |
| `SESSION_SECRET` | Secret สำหรับ Session ของแอป |
| `SETUP_KEY` | Secret ชั่วคราวสำหรับ setup เริ่มต้น |

ชื่อ/ID ต้องสะกดตรง case-sensitive ตาม Environment Variable. อย่าใส่ `GOOGLE_SERVICE_ACCOUNT_JSON` ในเวอร์ชันนี้ และไม่ต้องอัปโหลด JSON key

หลัง Save ให้ Redeploy เพื่อให้ Function อ่านค่าชุดใหม่ได้

## ขั้นที่ 11 — ทดสอบการเชื่อมต่อ

1. ตรวจว่า Vercel deployment เป็น Production และใช้ Project/Environment ที่ระบุใน condition
2. เปิด `https://YOUR_VERCEL_DOMAIN/setup.html`
3. ป้อน `SETUP_KEY` แล้วกดสร้างแท็บ
4. ถ้าสำเร็จ ให้เปิด Google Sheet ตรวจแท็บ Users, Parts_Inventory, Transactions และ Audit_Logs
5. ถ้าล้มเหลว เปิด Vercel → **Deployments → deployment ล่าสุด → Functions / Logs** จดเฉพาะข้อความ error ที่ไม่มี token/secret
6. เทียบ error กับตารางแก้ปัญหาด้านล่าง

## วิธีไล่ปัญหาทีละชั้น

| ข้อความ/อาการ | จุดที่ควรตรวจ |
|---|---|
| `Invalid audience` หรือ audience mismatch | `GCP_AUDIENCE` ต้องตรงกับ Default audience URI ของ Provider และโค้ดต้องขอ Vercel OIDC token ด้วย audience เดียวกัน |
| `issuer mismatch` / issuer not allowed | Team issuer mode ใน Vercel ต้องตรงกับ Issuer URL ใน Provider รวม Team slug และ https |
| `attribute condition` ไม่ผ่าน | ตรวจ subject, Team slug, Vercel project name, environment และตัวพิมพ์เล็ก/ใหญ่ให้ตรง |
| `Permission denied` ตอน impersonate/generateAccessToken | ตรวจ principal URI ว่าใช้ Google Project number + Pool ID + subject ถูกต้อง และได้รับ `roles/iam.workloadIdentityUser` บน Service Account |
| `IAM Service Account Credentials API disabled` | เปิด API นี้ใน Google Cloud Project ที่เก็บ Service Account |
| `403` จาก Sheets API | แชร์ Google Sheet ให้ `GCP_SERVICE_ACCOUNT_EMAIL` เป็น Editor และเปิด Google Sheets API |
| `Pool/Provider not found` | ตรวจ Pool ID, Provider ID, Project number, location `global` และ Environment Variables |
| Setup key ไม่ถูกต้อง | เป็นปัญหาของ `SETUP_KEY` ไม่ใช่ OIDC; ตรวจค่านี้แยกจาก Google IAM |

อย่าโพสต์ OIDC token, `SESSION_SECRET`, `SETUP_KEY` หรือเนื้อหา response ที่อาจมี credential ลงใน forum สาธารณะ

## เช็กลิสต์ก่อนถือว่าตั้งเสร็จ

- [ ] Vercel ตั้ง Team issuer แล้ว และ Google Provider ใช้ Issuer URL เดียวกัน
- [ ] มี Pool และ Provider เปิดใช้งาน
- [ ] Audience mode เป็น Default audience และ `GCP_AUDIENCE` มาจากค่า Provider จริง
- [ ] `google.subject = assertion.sub`
- [ ] Attribute condition จำกัด Team + Project + production
- [ ] IAM principal ใช้ Project number ของ Google + Pool ID + subject ที่ตรง
- [ ] principal ได้ `roles/iam.workloadIdentityUser` บน Service Account
- [ ] Service Account แชร์ Google Sheet เป็น Editor
- [ ] เปิด Google Sheets API และ IAM Service Account Credentials API
- [ ] ตั้ง Environment Variables ครบและ Redeploy แล้ว
- [ ] ไม่ได้สร้างหรือ commit JSON key

## แหล่งข้อมูลทางการ

[1]: https://vercel.com/docs/oidc/gcp "Vercel: Connect to Google Cloud Platform with OIDC"
[2]: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers "Google Cloud: Workload Identity Federation with other providers"
[3]: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines "Google Cloud: Workload Identity Federation with deployment pipelines"
