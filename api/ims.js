const allowedActions = new Set([
  'login', 'getAppData', 'logout', 'savePart', 'updatePart', 'deletePart',
  'transact', 'saveAudit', 'saveAuditBatch', 'adjustStock', 'getUsers', 'listUsers',
  'saveUser', 'deleteUser', 'getCsvData', 'getAuditCsvData', 'getAdminRecords',
  'deleteTransactionRecord', 'deleteAuditRecord', 'setupSheets'
]);

export default async function handler(req, res) {
  // Browser traffic is same-origin to Vercel; Apps Script is called server-to-server.
  // Therefore do not add permissive CORS headers to either endpoint.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'ใช้ POST เท่านั้น' });
  }

  const endpoint = process.env.APPS_SCRIPT_URL;
  if (!endpoint) return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า APPS_SCRIPT_URL ใน Vercel' });
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/.test(endpoint)) {
    return res.status(500).json({ error: 'APPS_SCRIPT_URL ต้องเป็น URL Web App ของ Apps Script ที่ลงท้ายด้วย /exec' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!body || typeof body !== 'object' || !allowedActions.has(String(body.action || ''))) {
      return res.status(400).json({ error: 'คำสั่ง API ไม่ถูกต้อง' });
    }

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: AbortSignal.timeout(25000)
    });

    const text = await upstream.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch {
      console.error('Apps Script returned non-JSON response:', text.slice(0, 500));
      return res.status(502).json({ error: 'Apps Script ไม่ได้ตอบกลับเป็น JSON ตรวจสิทธิ์การ Deploy Web App และ URL /exec' });
    }

    if (!payload || payload.ok !== true) {
      const message = String(payload?.error || 'Apps Script ทำรายการไม่สำเร็จ');
      const status = /admin permission|required admin|ต้องใช้สิทธิ์ admin/i.test(message)
        ? 403
        : /session|sign in|เข้าสู่ระบบ|setup key|setup key ไม่ถูกต้อง/i.test(message)
          ? 401
          : 400;
      return res.status(status).json({ error: message });
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      console.error('Apps Script returned success without a data field');
      return res.status(502).json({ error: 'Apps Script ตอบกลับไม่ครบรูปแบบ กรุณาตรวจเวอร์ชันที่ Deploy' });
    }
    return res.status(200).json(payload.data);
  } catch (error) {
    console.error('IMS Apps Script proxy:', error);
    const message = error?.name === 'TimeoutError'
      ? 'Apps Script ใช้เวลานานเกินไป ลองใหม่อีกครั้ง'
      : 'เชื่อมต่อ Apps Script ไม่สำเร็จ ตรวจ APPS_SCRIPT_URL และสถานะการ Deploy';
    return res.status(502).json({ error: message });
  }
}
