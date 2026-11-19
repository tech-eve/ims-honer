const SHEETS = {
  Users: ['Username','Password','Full_Name','Role','Branch'],
  Parts_Inventory: ['Part_No','Part_Name','Device_Model','Part_Type','Part_Condition','Unit_Cost','Current_Stock','Min_Stock','Bin_Location','Last_Updated'],
  Parts_Price: ['Part_Code','Unit_Cost','Currency','Last_Updated'],
  Transactions: ['Tx_ID','Timestamp','Type','Part_No','Part_Name','Qty','Job_Order_No','Technician_Or_User','Note'],
  Audit_Logs: ['Audit_ID','Date','Part_No','Part_Name','System_Stock','Actual_Count','Variance','Status','Auditor'],
  'Stock-Audit': ['Audit_ID','Date','Part_No','Part_Name','System_Stock','Actual_Count','Variance','Status','Auditor']
};
const SESSION_TTL = 21600;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index').setTitle('IMS | Spare Parts & Service').addMetaTag('viewport','width=device-width, initial-scale=1');
}
function setupSheets(setupKey) {
  const expected=PropertiesService.getScriptProperties().getProperty('IMS_SETUP_KEY');
  if(!expected||!setupKey||String(setupKey)!==expected)throw new Error('Setup key ไม่ถูกต้อง หรือยังไม่ได้ตั้ง Script Property IMS_SETUP_KEY');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    if (!sh.getLastRow()) sh.getRange(1,1,1,headers.length).setValues([headers]);
    else {
      const existing = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getDisplayValues()[0];
      if (headers.some((h,i) => existing[i] !== h)) throw new Error('Header mismatch in '+name+'. Check the first row before setup.');
    }
    sh.setFrozenRows(1); sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#e8eef7');
  });
  const users = ss.getSheetByName('Users');
  const existingUsers = users.getLastRow()>1 ? users.getRange(2,1,users.getLastRow()-1,5).getDisplayValues().map(r=>r[0]) : [];
  [['admin','1234','System Administrator','Admin','Main'],['staff','1234','Service Staff','Staff','Main']].forEach(u=>{if(!existingUsers.includes(u[0]))users.appendRow(u);});
  const priceSheet=ss.getSheetByName('Parts_Price'),knownPrices=new Set(priceSheet.getLastRow()>1?priceSheet.getRange(2,1,priceSheet.getLastRow()-1,1).getDisplayValues().flat().map(partCodeKey_):[]);
  const inventory=rows_('Parts_Inventory');
  inventory.forEach(p=>{const code=String(p.Part_No||'').trim(),key=partCodeKey_(code);if(code&&!knownPrices.has(key)&&p.Unit_Cost!==''&&p.Unit_Cost!==null){priceSheet.appendRow([code,Number(p.Unit_Cost)||0,'THB',new Date()]);knownPrices.add(key);}});
  const stockAudit=ss.getSheetByName('Stock-Audit'),stockIds=new Set(stockAudit.getLastRow()>1?stockAudit.getRange(2,1,stockAudit.getLastRow()-1,1).getDisplayValues().flat():[]),legacyAudits=rows_('Audit_Logs');
  legacyAudits.forEach(a=>{if(a.Audit_ID&&!stockIds.has(String(a.Audit_ID))){stockAudit.appendRow(SHEETS['Stock-Audit'].map(h=>a[h]===undefined?'':a[h]));stockIds.add(String(a.Audit_ID));}});
  return 'Sheets ready: Users, Parts_Inventory, Parts_Price, Transactions, Audit_Logs and Stock-Audit. Change the default passwords immediately.';
}
function db_(){const s=SpreadsheetApp.getActiveSpreadsheet(); if(!s)throw new Error('Bind this script to a Google spreadsheet.');return s;}
function rows_(sheetName){const sh=db_().getSheetByName(sheetName);if(!sh)throw new Error('Missing sheet: '+sheetName+'; run setupSheets().');const v=sh.getDataRange().getValues();if(v.length<2)return [];const h=v[0];return v.slice(1).filter(r=>r.some(c=>c!==''&&c!==null)).map(r=>{const o={};h.forEach((k,i)=>o[k]=r[i]);return o;});}
function fmt_(v){return v instanceof Date?Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm:ss'):v;}
function clean_(o){Object.keys(o).forEach(k=>o[k]=fmt_(o[k]));return o;}
function id_(){return Utilities.getUuid();}
function partCodeKey_(value){return String(value||'').trim().toUpperCase();}
function upsertPartPrice_(partCode,unitCost,currency){const sh=db_().getSheetByName('Parts_Price'),values=sh.getDataRange().getValues(),headers=values[0],codeIndex=headers.indexOf('Part_Code'),costIndex=headers.indexOf('Unit_Cost'),currencyIndex=headers.indexOf('Currency'),updatedIndex=headers.indexOf('Last_Updated'),matches=[];values.forEach((r,i)=>{if(i>0&&partCodeKey_(r[codeIndex])===partCodeKey_(partCode))matches.push({row:i+1,currency:r[currencyIndex]});});if(!matches.length){sh.appendRow([String(partCode).trim(),Number(unitCost)||0,currency||'THB',new Date()]);return;}matches.forEach(m=>{sh.getRange(m.row,costIndex+1).setValue(Number(unitCost)||0);sh.getRange(m.row,currencyIndex+1).setValue(currency||m.currency||'THB');sh.getRange(m.row,updatedIndex+1).setValue(new Date());});}
function deletePartPrice_(partCode){const sh=db_().getSheetByName('Parts_Price');if(!sh||sh.getLastRow()<2)return;const values=sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues();for(let i=values.length-1;i>=0;i--)if(partCodeKey_(values[i][0])===partCodeKey_(partCode))sh.deleteRow(i+2);}
function session_(token){if(!token)throw new Error('Please sign in again.');const raw=CacheService.getScriptCache().get('ims:'+token);if(!raw)throw new Error('Session expired. Please sign in again.');return JSON.parse(raw);}
function requireAdmin_(token){const u=session_(token);if(u.Role!=='Admin')throw new Error('Admin permission required.');return u;}
function login(username,password){const u=rows_('Users').find(x=>String(x.Username)===String(username)&&String(x.Password)===String(password));if(!u)throw new Error('Invalid username or password.');const token=id_();const profile={Username:String(u.Username),Full_Name:String(u.Full_Name),Role:String(u.Role),Branch:String(u.Branch)};CacheService.getScriptCache().put('ims:'+token,JSON.stringify(profile),SESSION_TTL);return {token:token,user:profile};}
function logout(token){if(token)CacheService.getScriptCache().remove('ims:'+token);return true;}
function getAppData(token){
  const user=session_(token),priceMap=new Map(rows_('Parts_Price').map(p=>[partCodeKey_(p.Part_Code),p]));
  let parts=rows_('Parts_Inventory').map(p=>{const price=priceMap.get(partCodeKey_(p.Part_No));p.Price_Matched=!!price;p.Unit_Cost=price?price.Unit_Cost:'';p.Price_Currency=price?String(price.Currency||'THB'):'THB';return clean_(p);});
  if(user.Role!=='Admin')parts=parts.map(p=>{delete p.Unit_Cost;delete p.Price_Matched;delete p.Price_Currency;return p;});
  const transactions=rows_('Transactions').map(clean_).reverse().slice(0,300),auditRows=rows_('Stock-Audit'),audits=auditRows.map(a=>clean_(Object.assign({},a))).reverse().slice(0,300),latestByPart=[],seenAuditParts=new Set();
  auditRows.slice().reverse().forEach(a=>{const key=partCodeKey_(a.Part_No);if(!key||seenAuditParts.has(key))return;seenAuditParts.add(key);const system=Number(a.System_Stock)||0,actual=Number(a.Actual_Count)||0,variance=a.Variance===''||a.Variance===null||a.Variance===undefined?actual-system:Number(a.Variance);latestByPart.push(clean_(Object.assign({},a,{System_Stock:system,Actual_Count:actual,Variance:variance,Status:variance===0?'MATCH':'VARIANCE'})));});
  const matches=latestByPart.filter(a=>a.Status==='MATCH').length,variances=latestByPart.filter(a=>a.Status==='VARIANCE').length,systemStock=latestByPart.reduce((sum,a)=>sum+(Number(a.System_Stock)||0),0),actualCount=latestByPart.reduce((sum,a)=>sum+(Number(a.Actual_Count)||0),0),auditSummary={total:auditRows.length,partsAudited:latestByPart.length,matches,variances,systemStock,actualCount,netVariance:actualCount-systemStock,absoluteVariance:latestByPart.reduce((sum,a)=>sum+Math.abs(Number(a.Variance)||0),0),recentVariances:latestByPart.filter(a=>a.Status==='VARIANCE').slice(0,10),latestByPart:latestByPart.slice(0,300)};
  const totalValue=user.Role==='Admin'?parts.reduce((sum,p)=>sum+(String(p.Price_Currency).toUpperCase()==='THB'?(Number(p.Unit_Cost)||0)*(Number(p.Current_Stock)||0):0),0):null;
  return {user,parts,transactions,audits,auditSummary,totalValue};
}
function appendObject_(sheetName,obj){const sh=db_().getSheetByName(sheetName),heads=SHEETS[sheetName];sh.appendRow(heads.map(h=>obj[h]===undefined?'':obj[h]));}
function findPart_(partNo){const sh=db_().getSheetByName('Parts_Inventory'),vals=sh.getDataRange().getValues(),head=vals[0],idx=head.indexOf('Part_No'),key=partCodeKey_(partNo);for(let i=1;i<vals.length;i++)if(partCodeKey_(vals[i][idx])===key)return {sh,row:i+1,head,data:Object.fromEntries(head.map((h,j)=>[h,vals[i][j]]))};return null;}
function savePart(token,p){requireAdmin_(token);if(!p||!String(p.Part_No||'').trim()||!String(p.Part_Name||'').trim())throw new Error('Part number and name are required.');const found=findPart_(p.Part_No);if(found)throw new Error('Part number already exists.');const q=Number(p.Current_Stock),cost=Number(p.Unit_Cost),min=Number(p.Min_Stock);if(!Number.isFinite(q)||q<0||!Number.isFinite(cost)||cost<0||!Number.isFinite(min)||min<0)throw new Error('Stock, minimum stock and cost must be valid non-negative numbers.');const code=String(p.Part_No).trim();appendObject_('Parts_Inventory',{Part_No:code,Part_Name:String(p.Part_Name).trim(),Device_Model:String(p.Device_Model||''),Part_Type:String(p.Part_Type||'Other'),Part_Condition:p.Part_Condition==='Defective'?'Defective':'Good',Unit_Cost:cost,Current_Stock:q,Min_Stock:min,Bin_Location:String(p.Bin_Location||''),Last_Updated:new Date()});upsertPartPrice_(code,cost,p.Currency||'THB');return true;}
function updatePart(token,originalPartNo,p){requireAdmin_(token);const f=findPart_(originalPartNo);if(!f)throw new Error('Part not found.');if(!p||!String(p.Part_No||'').trim()||!String(p.Part_Name||'').trim())throw new Error('Part number and name are required.');if(partCodeKey_(originalPartNo)!==partCodeKey_(p.Part_No)&&findPart_(p.Part_No))throw new Error('Part number already exists.');const q=Number(p.Current_Stock),cost=Number(p.Unit_Cost),min=Number(p.Min_Stock);if(!Number.isFinite(q)||q<0||!Number.isFinite(cost)||cost<0||!Number.isFinite(min)||min<0)throw new Error('Stock, minimum stock and cost must be valid non-negative numbers.');const code=String(p.Part_No).trim(),row={Part_No:code,Part_Name:String(p.Part_Name).trim(),Device_Model:String(p.Device_Model||''),Part_Type:String(p.Part_Type||'Other'),Part_Condition:p.Part_Condition==='Defective'?'Defective':'Good',Unit_Cost:cost,Current_Stock:q,Min_Stock:min,Bin_Location:String(p.Bin_Location||''),Last_Updated:new Date()};f.sh.getRange(f.row,1,1,SHEETS.Parts_Inventory.length).setValues([SHEETS.Parts_Inventory.map(h=>row[h]===undefined?'':row[h])]);if(partCodeKey_(originalPartNo)!==partCodeKey_(code))deletePartPrice_(originalPartNo);upsertPartPrice_(code,cost,p.Currency||'THB');return true;}
function deletePart(token,partNo){requireAdmin_(token);const f=findPart_(partNo);if(!f)throw new Error('Part not found.');f.sh.deleteRow(f.row);deletePartPrice_(partNo);return true;}
function transact(token,x){const u=session_(token),type=String(x.Type||'');if(!['IN','OUT','RETURN'].includes(type))throw new Error('Invalid transaction type.');const f=findPart_(x.Part_No);if(!f)throw new Error('Part not found.');const qty=Number(x.Qty);if(!Number.isInteger(qty)||qty<=0)throw new Error('Quantity must be a positive whole number.');const job=String(x.Job_Order_No||'').trim();if(type==='OUT'&&!job)throw new Error('Job order number is required for stock issue.');const old=Number(f.data.Current_Stock)||0;if(type==='OUT'&&qty>old)throw new Error('Insufficient stock. Available: '+old);const next=old+(type==='IN'?qty:-qty);const now=new Date();f.sh.getRange(f.row,f.head.indexOf('Current_Stock')+1).setValue(next);f.sh.getRange(f.row,f.head.indexOf('Last_Updated')+1).setValue(now);appendObject_('Transactions',{Tx_ID:id_(),Timestamp:now,Type:type,Part_No:f.data.Part_No,Part_Name:f.data.Part_Name,Qty:qty,Job_Order_No:job,Technician_Or_User:u.Full_Name,Note:String(x.Note||'')});return {stock:next};}
function saveAudit(token,x){const u=session_(token),f=findPart_(x.Part_No);if(!f)throw new Error('Part not found.');const actual=Number(x.Actual_Count);if(!Number.isInteger(actual)||actual<0)throw new Error('Actual count must be a non-negative whole number.');const entry={Audit_ID:id_(),Date:new Date(),Part_No:f.data.Part_No,Part_Name:f.data.Part_Name,System_Stock:Number(f.data.Current_Stock)||0,Actual_Count:actual,Variance:actual-(Number(f.data.Current_Stock)||0),Status:actual===(Number(f.data.Current_Stock)||0)?'MATCH':'VARIANCE',Auditor:u.Full_Name};appendObject_('Stock-Audit',entry);appendObject_('Audit_Logs',entry);return {system:entry.System_Stock,actual,variance:entry.Variance,auditId:entry.Audit_ID};}
function saveAuditBatch(token,items){const u=session_(token);if(!Array.isArray(items)||!items.length)throw new Error('No scanned parts to save.');if(items.length>500)throw new Error('A batch may contain at most 500 part codes.');const lock=LockService.getScriptLock();lock.waitLock(15000);try{const parts=new Map(rows_('Parts_Inventory').map(p=>[partCodeKey_(p.Part_No),p])),seen=new Set(),now=new Date(),entries=items.map(item=>{const key=partCodeKey_(item&&item.Part_No),part=parts.get(key),actual=Number(item&&item.Actual_Count);if(!key||!part)throw new Error('Part not found: '+String(item&&item.Part_No||''));if(seen.has(key))throw new Error('Duplicate part code in batch: '+part.Part_No);seen.add(key);if(!Number.isInteger(actual)||actual<0)throw new Error('Count must be a non-negative whole number for '+part.Part_No);const system=Number(part.Current_Stock)||0,variance=actual-system;return {Audit_ID:id_(),Date:now,Part_No:part.Part_No,Part_Name:part.Part_Name,System_Stock:system,Actual_Count:actual,Variance:variance,Status:variance===0?'MATCH':'VARIANCE',Auditor:u.Full_Name};});appendObjects_('Stock-Audit',entries);appendObjects_('Audit_Logs',entries);return {saved:entries.length,entries:entries.map(clean_)};}finally{lock.releaseLock();}}
function appendObjects_(sheetName,objects){if(!objects.length)return;const sh=db_().getSheetByName(sheetName),headers=SHEETS[sheetName],rows=objects.map(o=>headers.map(h=>o[h]===undefined?'':o[h]));sh.getRange(sh.getLastRow()+1,1,rows.length,headers.length).setValues(rows);}
function adjustStock(token,partNo,actual,note){const u=requireAdmin_(token),f=findPart_(partNo);if(!f)throw new Error('Part not found.');actual=Number(actual);if(!Number.isInteger(actual)||actual<0)throw new Error('Count must be a non-negative whole number.');const old=Number(f.data.Current_Stock)||0,diff=actual-old,now=new Date();f.sh.getRange(f.row,f.head.indexOf('Current_Stock')+1).setValue(actual);f.sh.getRange(f.row,f.head.indexOf('Last_Updated')+1).setValue(now);appendObject_('Transactions',{Tx_ID:id_(),Timestamp:now,Type:'ADJUST',Part_No:f.data.Part_No,Part_Name:f.data.Part_Name,Qty:Math.abs(diff),Job_Order_No:'',Technician_Or_User:u.Full_Name,Note:String(note||'Audit adjustment: '+old+' to '+actual)});return true;}
function listUsers(token){requireAdmin_(token);return rows_('Users').map(u=>({Username:u.Username,Full_Name:u.Full_Name,Role:u.Role,Branch:u.Branch}));}
function saveUser(token,x){requireAdmin_(token);const username=String(x.Username||'').trim();if(!username||!x.Password||!x.Full_Name||!['Admin','Staff'].includes(x.Role))throw new Error('Username, password, full name and valid role are required.');if(rows_('Users').some(u=>String(u.Username)===username))throw new Error('Username already exists.');appendObject_('Users',{Username:username,Password:String(x.Password),Full_Name:String(x.Full_Name),Role:x.Role,Branch:String(x.Branch||'Main')});return true;}
function getUsers(token){return listUsers(token);}
function deleteUser(token,username){const u=requireAdmin_(token);if(String(u.Username)===String(username))throw new Error('You cannot delete your own account.');const sh=db_().getSheetByName('Users'),v=sh.getDataRange().getDisplayValues(),i=v.findIndex((r,n)=>n>0&&r[0]===String(username));if(i<1)throw new Error('User not found.');sh.deleteRow(i+1);return true;}
function getCsvData(token){const u=session_(token);return rows_('Transactions').map(t=>{clean_(t);if(u.Role!=='Admin')delete t.Unit_Cost;return t;});}
function getAuditCsvData(token){session_(token);return rows_('Stock-Audit').map(clean_).reverse();}
function getAdminRecords(token){requireAdmin_(token);return {transactions:rows_('Transactions').map(clean_).reverse().slice(0,200),audits:rows_('Stock-Audit').map(clean_).reverse().slice(0,200)};}
function deleteTransactionRecord(token,txId){requireAdmin_(token);return deleteById_('Transactions','Tx_ID',txId);}
function deleteAuditRecord(token,auditId){requireAdmin_(token);const removed=deleteById_('Stock-Audit','Audit_ID',auditId);deleteByIdIfExists_('Audit_Logs','Audit_ID',auditId);return removed;}
function deleteById_(sheetName,idHeader,id){const sh=db_().getSheetByName(sheetName);if(!sh||sh.getLastRow()<2)throw new Error('Record not found.');const values=sh.getDataRange().getDisplayValues(),col=values[0].indexOf(idHeader);if(col<0)throw new Error('Record ID column is missing.');for(let i=values.length-1;i>0;i--)if(String(values[i][col])===String(id)){sh.deleteRow(i+1);return true;}throw new Error('Record not found.');}
function deleteByIdIfExists_(sheetName,idHeader,id){const sh=db_().getSheetByName(sheetName);if(!sh||sh.getLastRow()<2)return false;const values=sh.getDataRange().getDisplayValues(),col=values[0].indexOf(idHeader);if(col<0)return false;for(let i=values.length-1;i>0;i--)if(String(values[i][col])===String(id)){sh.deleteRow(i+1);return true;}return false;}

// Vercel's /api/ims calls this endpoint server-to-server. The browser never calls
// Apps Script directly, so CORS headers are intentionally not added here.
// ContentService returns the JSON envelope; the Vercel proxy maps errors to HTTP status codes.
function doPost(e){
  try{
    const body=JSON.parse(e&&e.postData&&e.postData.contents||'{}');
    const action=String(body.action||'');
    if(action==='setupSheets')return apiJson_({ok:true,data:{message:setupSheets(body.setupKey)}});
    const actions={login,getAppData,logout,savePart,updatePart,deletePart,transact,saveAudit,saveAuditBatch,adjustStock,getUsers,listUsers,saveUser,deleteUser,getCsvData,getAuditCsvData,getAdminRecords,deleteTransactionRecord,deleteAuditRecord};
    if(!Object.prototype.hasOwnProperty.call(actions,action))throw new Error('Unknown action.');
    const args=Array.isArray(body.args)?body.args:[];
    return apiJson_({ok:true,data:actions[action].apply(null,args)});
  }catch(err){
    console.error('IMS API error: '+(err&&err.stack||err));
    return apiJson_({ok:false,error:String(err&&err.message||'Server error')});
  }
}
function apiJson_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
