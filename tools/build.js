// HWPX 예산설명서 → index.html 빌드
// 사용법(프로젝트 루트에서): node tools/build.js
//   Node 22.12 + 한글 경로에서 파일 실행 시 크래시가 나면: node - < tools/build.js
//   (unzip 필요 — Git Bash에 포함)
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const ROOT=process.cwd();
const SRC='부처별 예산안';

// ── HWPX(XML) → 텍스트. 표는 '| a | b |' 줄로 변환
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
function textOf(x){let r='';x.replace(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g,(m,t)=>{r+=t.replace(/<[^>]+>/g,'');});return dec(r);}
function conv(xml){
  // tokenise: tables -> rows; paragraphs outside tables -> lines
  const lines=[];let i=0;
  const re=/<hp:tbl\b|<\/hp:tbl>|<hp:tr\b|<\/hp:tr>|<hp:tc\b|<\/hp:tc>|<hp:p\b[^>]*>|<\/hp:p>|<hp:t(?:\s[^>]*)?>[\s\S]*?<\/hp:t>|<hp:t\/>/g;
  let depth=0,row=null,cell=null,para='',m;const stack=[];
  while((m=re.exec(xml))){const tk=m[0];
    if(tk.startsWith('<hp:tbl')){stack.push({row,cell,para});row=null;cell=null;para='';depth++;}
    else if(tk==='</hp:tbl>'){depth--;const s=stack.pop();row=s.row;cell=s.cell;para=s.para;}
    else if(tk.startsWith('<hp:tr')){row=[];}
    else if(tk==='</hp:tr>'){if(row){const l='| '+row.join(' | ')+' |';if(depth===1)lines.push(l);else if(cell)cell.push('['+row.join(' ; ')+']');}row=null;}
    else if(tk.startsWith('<hp:tc')){cell=[];}
    else if(tk==='</hp:tc>'){if(row&&cell)row.push(cell.filter(Boolean).join(' / '));cell=null;}
    else if(tk.startsWith('<hp:p')){para='';}
    else if(tk==='</hp:p>'){const t=para.trim();if(t){if(depth>0&&cell)cell.push(t);else if(depth===0)lines.push(t);}para='';}
    else {para+=textOf(tk);}
  }
  return lines.join('\n');
}

// ── 텍스트 → 사업 정보
const cells=l=>l.replace(/^\|\s?/,'').replace(/\s?\|$/,'').split(' | ').map(s=>s.trim());
const num=s=>{if(s==null)return null;s=s.replace(/\s/g,'');if(s===''||s==='-'||s==='해당없음')return 0;const neg=/^[△▲-]/.test(s)&&s!=='-';const n=parseFloat(s.replace(/[△▲,]/g,'').replace(/^-/,''));return isNaN(n)?null:(neg?-n:n);};
const clean=s=>s.replace(/\s*\/\s*/g,' ').replace(/\s+/g,' ').trim();
function parseDoc(text,dept,file){
  const L=text.split('\n');
  const r={dept,file};
  const idx=(re,from=0)=>{for(let i=from;i<L.length;i++)if(re.test(L[i]))return i;return -1;};
  // name
  let i=idx(/\(\d{4}-\d{3}\)\s*\|$/); if(i<0)i=idx(/사\s*업\s*명/)+1; let nm=cells(L[i])[0];
  const code=nm.match(/\((\d{4}-\d{3})\)\s*$/); r.code=code?code[1]:'';
  r.name=nm.replace(/\((\d{4}-\d{3})\)\s*$/,'').replace(/^\(\d+\)\s*/,'').trim();
  i=idx(/^\| 소관 \| 실·국/); if(i>=0){const c=cells(L[i+1]);r.office=clean(c[1]);r.team=clean(c[2]);r.account=clean(c[3]);}
  i=idx(/^\| 명칭 \|/); if(i>=0){const c=cells(L[i]);r.program=clean(c[4]);r.unit=clean(c[5]);}
  i=idx(/^\| 신규 \| 계속/); if(i>=0){const c=cells(L[i+1]);r.status=c[0]==='Y'?'신규':c[1]==='Y'?'계속':c[2]==='Y'?'완료':'';r.yeta=c[3]==='Y';}
  i=idx(/^\| 직접 \| 출자/); if(i>=0){const h=cells(L[i]).slice(0,5),c=cells(L[i+1]);r.support=h.filter((x,k)=>c[k]==='Y').join('·');r.subsidyRate=c[5];}
  i=idx(/^\| 사업명 \| 2025년/); if(i>=0){const c=cells(L[i+1]);r.b2025=num(c[1]);r.b2026=num(c[2]);r.b2026r=num(c[3]);r.req2027=num(c[4]);r.b2027=num(c[5]);}
  // 내역사업 table
  i=idx(/^1\) 기능별\(내역사업별\)/); r.items=[];
  if(i>=0){let j=idx(/^\| ○ 합계/,i);for(j=j+1;j<L.length&&L[j].startsWith('|');j++){const c=cells(L[j]);const raw=c[0];const lvl=/^\s*·/.test(raw)?1:2;r.items.push({name:clean(raw.replace(/^[\s·\-ㆍ○․∙•]+/,'')),lvl,raw,b2025:num(c[1]),b2026:num(c[6]),b2027:num(c[9])});}}
  // 목적·내용
  const pi=idx(/^1\) 사업목적·내용/),pe=idx(/^2\) 사업개요/);r.purposes=[];let cur=null;
  for(let j=pi+1;j<pe;j++){const l=L[j];const m=l.match(/^\(1-\d+\)\s*(.+)/);
    if(m){cur={name:clean(m[1])};r.purposes.push(cur);continue;}
    if(l.startsWith('| 사업목적')||l.startsWith('| 사업내용')){if(!cur){cur={name:''};r.purposes.push(cur);}const c=cells(l);cur[c[0]==='사업목적'?'goal':'content']=c.slice(1).join(' ').replace(/\s\/\s/g,'\n');}}
  const grab=k=>{const j=idx(new RegExp('^○\\s*'+k+'\\s*:'));return j>=0?L[j].split(':').slice(1).join(':').trim():'';};
  r.period=grab('사업기간');r.totalCost=grab('총사업비');r.executor=grab('사업시행주체');r.method=grab('사업시행방법');r.beneficiary=grab('사업 수혜자');
  i=idx(/^\| 사업비 \|/); if(i>=0){const h=cells(L[i-1]).slice(1),c=cells(L[i]).slice(1);r.history=h.map((y,k)=>({y:y.replace(/년.*/,''),v:num(c[k])}));}
  i=idx(/^\| 추진경위/); if(i>=0){r.history_text=cells(L[i]).slice(1).join(' ').split(' / ').map(s=>s.trim()).filter(Boolean);}
  // 산출내역
  const si=idx(/^\(3-1\)/),se=idx(/^4\) 사업효과/);r.calc=[];cur=null;let mode=null;
  for(let j=si+1;j<(se<0?L.length:se);j++){const l=L[j];if(l.startsWith('|'))continue;
    if(/^[○◦□]/.test(l)){cur={head:l.replace(/^[○◦□]\s*/,''),desc:'',calc:[]};r.calc.push(cur);mode=null;continue;}
    if(!cur)continue;
    let m;
    if((m=l.match(/^-\s*\(설명\)\s*(.*)/))){cur.desc=m[1];mode='d';}
    else if((m=l.match(/^-\s*\(산출\)\s*(.*)/))){if(m[1])cur.calc.push(m[1]);mode='c';}
    else if(mode==='c')cur.calc.push(l);
    else if(mode==='d')cur.desc+=' '+l;
    else cur.calc.push(l);}
  // 성과지표
  r.kpis=[];for(let j=0;j<L.length;j++){const m=L[j].match(/^○ 성과지표\s*:\s*(.+)/);if(m){const t=cells(L[j+2]||''),h=cells(L[j+1]||'');r.kpis.push({name:m[1],target2027:t[h.length-1]});}}
  return r;
}

function load(){
  const docs=[];
  for(const dept of fs.readdirSync(path.join(ROOT,SRC))){
    const dir=path.join(ROOT,SRC,dept);if(!fs.statSync(dir).isDirectory())continue;
    for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.hwpx'))){
      const xml=execFileSync('unzip',['-p',path.join(dir,f),'Contents/section*.xml'],{maxBuffer:1e8}).toString('utf8');
      docs.push(parseDoc(conv(xml),dept,[SRC,dept,f].join('/')));
    }
  }
  return docs;
}

// ── 내역사업에 목적·설명·산출근거 붙이기
function prep(docs){
const norm=s=>(s||'').replace(/\(R&D\)|\(R＆D\)/g,'').replace(/[\s·ㆍ․,\-()（）]/g,'').toLowerCase();
const hd=h=>h.replace(/\s*\(20\d\d.*$/,'');
const order={'과기정통부':0,'문체부':1,'산업통상부':2,'중기부':3};
const out=docs.map(r=>{
  const items=r.items.filter(x=>(x.b2026||0)+(x.b2027||0)>0).map(x=>({n:x.name,a:x.b2026||0,b:x.b2027||0}));
  const match=(list,key)=>{const used=new Set();
    items.forEach(it=>{const k=norm(it.n);let j=list.findIndex((p,ix)=>!used.has(ix)&&(norm(key(p))===k));
      if(j<0)j=list.findIndex((p,ix)=>!used.has(ix)&&key(p)&&(norm(key(p)).includes(k)||k.includes(norm(key(p)))));
      if(j<0&&items.length===1&&list.length>=1)j=list.findIndex((p,ix)=>!used.has(ix));
      if(j>=0){used.add(j);it[key===pk?'p':'c']=list[j];}});
    return list.filter((_,ix)=>!used.has(ix));};
  const pk=p=>p.name, ck=c=>hd(c.head);
  const restP=match(r.purposes,pk), restC=match(r.calc,ck);
  return {d:r.dept,file:r.file,n:r.name,code:r.code,st:r.status,sup:r.support,acc:r.account,office:r.office,team:r.team,prog:r.program,unit:r.unit,
    y25:r.b2025||0,a:r.b2026||0,req:r.req2027||0,b:r.b2027||0,period:r.period,exe:r.executor,ben:r.beneficiary,
    hist:(r.history||[]).map(h=>[h.y,h.v||0]),kpi:r.kpis.map(k=>[k.name,k.target2027]),
    items:items.map(it=>({n:it.n,a:it.a,b:it.b,goal:it.p&&it.p.goal||'',desc:(it.p&&it.p.content)||(it.c&&it.c.desc)||'',why:it.c&&it.p?it.c.desc:'',calc:it.c?it.c.calc.filter(l=>!/^[\d,.]+백만원$/.test(l.trim())):[]})),
    extraP:restP, extraC:restC.map(c=>({h:c.head,desc:c.desc,calc:c.calc}))};
}).sort((x,y)=>order[x.d]-order[y.d]||y.b-x.b);
  return out;
}

const view=prep(load());
// 브이씨텍 협업 후보 표시 (tools/selection.json)
const selFile=path.join(ROOT,'tools','selection.json');
const sel=fs.existsSync(selFile)?JSON.parse(fs.readFileSync(selFile,'utf8')):{};
const vc=sel.vctech||[];
for(const r of view)if(vc.includes(r.code))r.vc=1;
for(const c of vc)if(!view.some(r=>r.code===c))console.warn('selection.json: 사업코드 '+c+' 없음');
// 우선순위 별 개수(★)
for(const [c,n] of Object.entries(sel.stars||{})){
  const r=view.find(r=>r.code===c);if(r)r.pr=n;else console.warn('selection.json: 별 표시 코드 '+c+' 없음');}
const tpl=fs.readFileSync(path.join(ROOT,'tools','template.html'),'utf8');
const page=tpl.replace('/*__DATA__*/',()=>JSON.stringify(view).replace(/<\//g,'<\\/'));
// --artifact <경로>: claude.ai 아티팩트용(문서 골격 없음, 다운로드 링크 숨김)
const ai=process.argv.indexOf('--artifact');
const out=ai>0?page.replace('const DOWNLOADS=true','const DOWNLOADS=false'):
  '<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n'+page+'\n</body></html>\n';
const target=ai>0?process.argv[ai+1]:path.join(ROOT,'index.html');
fs.writeFileSync(target,out);
console.log(view.length+'개 사업 →',target);
