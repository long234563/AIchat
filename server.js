/**
 * long AI — backend Node.js không cần cài npm packages.
 * Chạy: node server.js  | Node.js >= 20.
 * API key chỉ ở .env phía máy chủ, KHÔNG gửi cho trình duyệt.
 */
import http from 'node:http';
import { readFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');

function loadEnv() {
  let raw;
  try { raw = readFileSync(path.join(root, '.env'), 'utf8'); }
  catch { return; }
  for (const line of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] != null) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}
loadEnv();
const port = Number(process.env.PORT || 3012);
const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const searchModel = process.env.GEMINI_SEARCH_MODEL || 'gemini-2.5-flash-lite';
const apiKey = (process.env.GEMINI_API_KEY || '').trim();
const configured = Boolean(apiKey && !/^(your-|paste-|dien-|sk-proj-)/i.test(apiKey));
const MAX_BODY = 120000;
const maxHistory = 16;
const hits = new Map();
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png','.txt':'text/plain; charset=utf-8'};

function json(res, status, data) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function sendLine(res, value) {
  if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value) + '\n');
}
function checkRate(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > 600000) { hits.set(ip, {start:now,count:1}); return true; }
  entry.count++;
  return entry.count <= 40;
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString('utf8');
    if (Buffer.byteLength(raw) > MAX_BODY) throw Object.assign(new Error('Nội dung yêu cầu quá dài.'), {status:413});
  }
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Dữ liệu gửi lên không đúng định dạng JSON.'), {status:400}); }
}
function validatedHistory(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw Object.assign(new Error('Lịch sử chat không hợp lệ.'), {status:400});
  const selected = value.slice(-maxHistory);
  const result = [];
  for (const item of selected) {
    if (!item || !['user','assistant'].includes(item.role) || typeof item.text !== 'string') continue;
    const text = item.text.trim().slice(0, 5000);
    if (!text) continue;
    const role = item.role === 'assistant' ? 'model' : 'user';
    if (result.at(-1)?.role === role) result.at(-1).parts[0].text += '\n' + text;
    else result.push({role,parts:[{text}]});
  }
  // Gemini chat history bắt đầu bằng user; không kết thúc ở user (câu hỏi cuối sẽ thêm sau).
  while (result[0]?.role === 'model') result.shift();
  while (result.at(-1)?.role === 'user') result.pop();
  return result;
}
function getError(status, payload, searchWeb) {
  const apiError = payload?.error || {};
  const msg = String(apiError.message || '');
  if (status === 400 && /api.?key|invalid.?key/i.test(msg)) return 'API key không hợp lệ. Hãy kiểm tra khóa trong file .env và tạo khóa mới nếu cần.';
  if (status === 401) return 'API key không được chấp nhận. Hãy kiểm tra khóa trong file .env.';
  if (status === 403) return searchWeb
    ? 'Tài khoản chưa có quyền tìm web với model này. Hãy tắt “Tìm web” hoặc kiểm tra quyền truy cập API.'
    : 'Nhà cung cấp API từ chối quyền truy cập khóa, dự án hoặc khu vực này (403).';
  if (status === 404) return 'Model đang cấu hình không khả dụng (404). Kiểm tra cấu hình model trong file .env rồi khởi động lại.';
  if (status === 429) return 'Đã chạm giới hạn sử dụng API (429). Hãy chờ rồi thử lại hoặc kiểm tra hạn mức.';
  if (searchWeb && status === 400) return 'Tìm web hiện không khả dụng với model/tài khoản này. Hãy tắt “Tìm web” để chat miễn phí. Chi tiết: ' + msg.slice(0, 200);
  return `API báo lỗi ${status}: ${msg.slice(0, 250) || 'Không thể xử lý yêu cầu.'}`;
}
function pickSources(metadata, list) {
  for (const chunk of metadata?.groundingChunks || []) {
    const web = chunk?.web;
    if (typeof web?.uri !== 'string') continue;
    let url;
    try { url = new URL(web.uri); }
    catch { continue; }
    if (!['http:','https:'].includes(url.protocol)) continue;
    if (!list.some(s => s.url === url.href)) list.push({url:url.href,title:String(web.title || url.hostname).slice(0, 180)});
  }
}
async function streamGemini(req, res, body) {
  if (!configured) return json(res, 503, {error:'Chưa cấu hình API key trong file .env. Hãy đọc README.md để biết cách thiết lập.'});
  const message = body?.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 6000) return json(res, 400, {error:'Câu hỏi phải dài từ 1 đến 6000 ký tự.'});
  if (body?.searchWeb != null && typeof body.searchWeb !== 'boolean') return json(res,400,{error:'Chế độ tìm web không hợp lệ.'});
  const useSearch = body.searchWeb === true;
  let history;
  try { history = validatedHistory(body.history); }
  catch(e) { return json(res, e.status || 400, {error:e.message}); }
  const chosenModel = useSearch ? searchModel : model;
  const contents = [...history,{role:'user',parts:[{text:message.trim()}]}];
  const bodyForGemini = {
    systemInstruction: {parts:[{text: 'Bạn là long AI, trợ lý AI thân thiện, hữu ích. Mặc định trả lời bằng tiếng Việt nếu người dùng hỏi tiếng Việt. Trình bày rõ ràng với Markdown khi phù hợp; không bịa dẫn chứng. Nếu không chắc, nói rõ sự không chắc chắn.' + (useSearch ? ' Bạn được phép sử dụng Google Search grounding để tra cứu thông tin mới. Chỉ dẫn nguồn thực tế được công cụ trả về.' : '')}]},
    contents,
    generationConfig: {maxOutputTokens: 4096,temperature: 0.65},
    ...(useSearch ? {tools:[{google_search:{}}]} : {})
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), 105000);
  req.on('aborted', () => controller.abort());
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:streamGenerateContent?alt=sse`,{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify(bodyForGemini),signal:controller.signal
    });
    if (!upstream.ok) {
      const errorBody = await upstream.text();
      let data;
      try { data = JSON.parse(errorBody); } catch { data = {error:{message:errorBody.slice(0,200)}}; }
      const error = getError(upstream.status,data,useSearch);
      console.error(`[Gemini] HTTP ${upstream.status}: ${String(data?.error?.message || '').slice(0,200)}`);
      return json(res, upstream.status, {error});
    }
    if (!upstream.body) return json(res,502,{error:'API không trả về luồng dữ liệu.'});
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
    const decoder = new TextDecoder();
    let buffer = '',fullText = '', searchSuggestions = '', finishReason = null;
    const sources = [];
    function processEvent(event) {
      const lines = event.split('\n').filter(x=>x.startsWith('data:'));
      if (!lines.length) return;
      let data;
      try {data = JSON.parse(lines.map(x=>x.slice(5).trimStart()).join('\n'));}
      catch {return;}
      if (data.error) {sendLine(res,{type:'error',error:String(data.error.message || 'Dịch vụ AI gặp lỗi khi trả lời.')});return;}
      if (data.promptFeedback?.blockReason) finishReason = data.promptFeedback.blockReason;
      const candidate = data.candidates?.[0];
      if (!candidate) return;
      if (candidate.finishReason) finishReason = candidate.finishReason;
      for (const part of candidate.content?.parts || []) {
        if (typeof part.text === 'string' && !part.thought) {
          fullText += part.text;
          sendLine(res,{type:'delta',text:part.text});
        }
      }
      const metadata = candidate.groundingMetadata;
      if (metadata) {
        pickSources(metadata,sources);
        if (typeof metadata.searchEntryPoint?.renderedContent === 'string') searchSuggestions = metadata.searchEntryPoint.renderedContent.slice(0,60000);
      }
    }
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk,{stream:true}).replace(/\r/g,'');
      let i;
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0,i);
        buffer = buffer.slice(i+2);
        processEvent(event);
      }
    }
    buffer += decoder.decode().replace(/\r/g,'');
    if (buffer.trim()) processEvent(buffer);
    if (!fullText) {
      sendLine(res,{type:'error',error: finishReason === 'SAFETY' || finishReason === 'BLOCKLIST'
        ? 'Yêu cầu bị từ chối theo chính sách an toàn của dịch vụ AI.'
        : 'Dịch vụ AI không trả về văn bản. Hãy thử viết lại câu hỏi.'});
    } else {
      sendLine(res,{type:'done',sources:sources.slice(0,12), searchSuggestions, usedWeb: useSearch && sources.length > 0,finishReason});
    }
  } catch (e) {
    if (req.aborted || res.destroyed) return;
    console.error('[Gemini] Lỗi kết nối:', e?.message || e);
    if (!res.headersSent) json(res,502,{error:controller.signal.aborted ? 'Dịch vụ AI phản hồi quá lâu. Hãy thử lại.' : 'Không kết nối được dịch vụ AI. Kiểm tra Internet hoặc cấu hình mạng.'});
    else sendLine(res,{type:'error',error:controller.signal.aborted ? 'Dịch vụ AI phản hồi quá lâu. Hãy thử lại.' : 'Kết nối dịch vụ AI bị gián đoạn.'});
  } finally {
    clearTimeout(timeout);
    if (res.headersSent && !res.writableEnded && !res.destroyed) res.end();
  }
}
async function serveFile(url, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url,'http://127.0.0.1').pathname); }
  catch {return json(res,400,{error:'URL không hợp lệ.'});}
  if (pathname === '/') pathname = '/index.html';
  const full = path.resolve(publicDir,'.'+pathname);
  if (!full.startsWith(publicDir + path.sep)) return json(res,403,{error:'Không cho phép truy cập.'});
  try {
    const stat = await fs.stat(full);
    if (!stat.isFile()) return json(res,404,{error:'Không tìm thấy file.'});
    const content = await fs.readFile(full);
    res.writeHead(200,{'Content-Type':mime[path.extname(full)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
    res.end(content);
  } catch {json(res,404,{error:'Không tìm thấy file.'});}
}
const server = http.createServer(async(req,res)=>{
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    if (!checkRate(req.socket.remoteAddress || 'local')) return json(res,429,{error:'Bạn gửi quá nhiều yêu cầu trong 10 phút. Hãy thử lại sau.'});
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res,200,{ok:true,configured,model,searchModel, searchNote:'Google Search grounding yêu cầu model 2.5 được cấp quyền trong tài khoản.'});
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      try {return await streamGemini(req,res,await readBody(req));}
      catch(e){return json(res,e.status || 400,{error:e.message || 'Không thể xử lý yêu cầu.'});}
    }
    return json(res,404,{error:'API endpoint không tồn tại.'});
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Phương thức không hỗ trợ.'});
  return serveFile(req.url,res);
});
server.listen(port,'0.0.0.0',()=>{
  console.log(`\n✦ long AI: http://localhost:${port}`);
  console.log(`Chat model: ${model}; Search model: ${searchModel}`);
  if (!configured) console.log('⚠ Chưa cấu hình GEMINI_API_KEY — hãy tạo file .env rồi khởi động lại.');
});
