const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const md5 = require('../app/vendor/md5.min.js');
const code = fs.readFileSync(path.join(__dirname,'../app/api.js'),'utf8');
function load(fetch) { const context={md5,URL,AbortController,setTimeout,clearTimeout,fetch,localStorage:{getItem(){return null;},setItem(){},removeItem(){}}};vm.createContext(context);vm.runInContext(code,context);return context.IyfApi; }
test('Chinese search query is signed before URL encoding',()=>{
  const api=load();const value=api.signed({tags:'中文 电影',page:1},{publicKey:'test-public',privateKey:['test-key']});
  const url=new URL('https://example.test/?'+value);
  assert.equal(url.searchParams.get('tags'),'中文 电影');
  assert.equal(url.searchParams.get('vv'),crypto.createHash('md5').update('test-public&tags=中文 电影&page=1&test-key').digest('hex'));
});
test('Search records use contxt as the key, not as their synopsis',()=>{
  const api=load();const item=api.normalize({contxt:'fFbERQGe4L5',title:'片名',postTime:'2026-01-01',cidMapper:'0,1,3,19|0,1,3,22',cid:'喜剧',rating:742,pingFen:74,imgPath:'https://static.iyf.tv/a.jpg'});
  assert.equal(item.key,'fFbERQGe4L5');assert.equal(item.summary,'');assert.equal(item.year,'2026');assert.equal(item.genre,'喜剧');assert.equal(item.rating,'7.4');
});
test('Playback preserves the returned pre-roll then content order',()=>{
  const api=load();const result=api.playableSequence({flvPathList:[{result:'https://example.test/ad.mp4',link:'https://example.test/ad'},{result:'https://example.test/content.m3u8',isHls:true}]});
  assert.equal(result.length,2);assert.equal(result[0].isAd,true);assert.equal(result[1].isAd,false);assert.equal(result[1].isHls,true);
});
test('Explicit login, preview and stream restrictions use the original player',()=>{
  const api=load();const valid={flvPathList:[{result:'https://example.test/content.m3u8'}]};
  for(const restriction of [{needLogin:1},{isPreView:true},{isLimitedStream:true},{videoServer:{status:1}}])assert.throws(()=>api.playableSequence({...valid,...restriction}));
  assert.throws(()=>api.playableSequence({flvPathList:[{result:'javascript:alert(1)'}]}));
});
test('Member playback signs the official stream URL and accepts playback metadata',async()=>{
  const api=load(async(url)=>{
    const info=url.includes('getmyregion')?[{regionCode:'AU'}]:[{pConfig:{publicKey:'test-public',privateKey:['test-key']}}];
    return {ok:true,json:async()=>({data:{code:0,info}})};
  });
  api.setSession({uid:42,expire:'2099',gid:5,sign:'member-sign',token:'member-token'});
  await api.init();
  const sequence=api.playableSequence({videoServer:{status:0},flvPathList:[{result:'https://stream.example/episode.m3u8?id=1',needSign:true,broker:'https://history.example',validator:{},isHls:true}]});
  assert.equal(sequence.length,1);
  const url=new URL(sequence[0].url);
  assert.equal(url.searchParams.get('uid'),'42');
  assert.equal(url.searchParams.get('token'),'member-token');
  assert.equal(url.searchParams.get('pub'),'test-public');
  assert.equal(url.searchParams.get('vv'),crypto.createHash('md5').update('test-public&id=1&uid=42&expire=2099&gid=5&sign=member-sign&token=member-token&test-key').digest('hex'));
});
test('Member-only episodes do not issue a playback request',async()=>{
  let requests=0;const api=load(async()=>{requests++;throw new Error('unexpected');});
  await assert.rejects(api.media({key:'member',isVip:'true',isBought:false}));assert.equal(requests,0);
});
test('Guest initialization is shared and requests never carry account cookies',async()=>{
  const calls=[];const api=load(async(url,options)=>{
    calls.push({url,options});
    const info=url.includes('getmyregion')?[{regionCode:'AU'}]:[{pConfig:{publicKey:'test',privateKey:['test']}}];
    return {ok:true,json:async()=>({data:{code:0,info}})};
  });
  await Promise.all([api.init(),api.init()]);assert.equal(calls.length,2);for(const call of calls)assert.equal(call.options.credentials,'omit');
});
test('An API error never becomes an empty success',async()=>{
  const api=load(async()=>({ok:true,json:async()=>({data:{code:1,msg:'签名过期',info:[]}})}));
  await assert.rejects(api.catalog(),/签名过期/);
});

test('Playback positions do not deny an authorized episode such as 雷霆令',()=>{
 const api=load();const result=api.playableSequence({needLogin:0,isPreView:false,isLimitedStream:false,customData:{s:97,e:2593,t:2739},videoServer:{status:0},flvPathList:[{result:'https://example.test/content.m3u8',isHls:true}]});
 assert.equal(result.length,1);assert.equal(result[0].isAd,false);
});

test('Member watch history uses the official account token and maps episode progress',async()=>{
 let sawSession=false,sawPost=false;
 const api=load(async(url,options)=>{
  let info;
  if(url.includes('ObtainListWithCount')){const parsed=new URL(url);sawSession=parsed.searchParams.get('uid')==='42'&&parsed.searchParams.get('token')==='member-token';sawPost=options.method==='POST'&&options.body.includes('pageSize=20');info=[{recordCount:1,list:[{link:'//www.main.tv/detail?id=film123',lastId:'episode123',title:'片名',lastTitle:'第 1 集',imgPath:'https://static.example/poster.jpg',playTime:480,totalTime:3600,isFinish:false,updateTime:'2026-09-29T12:45:46'}]}];}
  else info=url.includes('getmyregion')?[{regionCode:'AU'}]:[{pConfig:{publicKey:'public',privateKey:['private']}}];
  return {ok:true,json:async()=>({data:{code:0,info}})};
 });
 api.setSession({uid:42,expire:'2099',gid:5,sign:'member-sign',token:'member-token'});
 const result=await api.watchHistory();const rows=result.items;assert.equal(sawSession,true);assert.equal(sawPost,true);assert.equal(result.total,1);assert.equal(rows.length,1);assert.equal(rows[0].itemKey,'film123');assert.equal(rows[0].episodeKey,'episode123');assert.equal(rows[0].time,480);
});

test('Comments and danmu use official read endpoints and map their records',async()=>{
 const paths=[];
 const api=load(async(url)=>{
  paths.push(new URL(url).pathname);let info;
  if(url.includes('commentList'))info=[{recordSum:12,commHot:[],commNormal:[{nickName:'甲',context:'好看',post_Date:'今天',likes:3,childrenCount:0,children:[]}]}];
  else if(url.includes('getBarrage'))info=[{contxt:'第一条',second:2.5,isDeleted:0,position:0,color:0},{contxt:'已删除',second:4,isDeleted:1}];
  else info=url.includes('getmyregion')?[{regionCode:'AU'}]:[{pConfig:{publicKey:'public',privateKey:['private']}}];
  return {ok:true,json:async()=>({data:{code:0,info}})};
 });
 const comments=await api.comments({raw:{id:123}},1);assert.equal(comments.items[0].text,'好看');assert.equal(comments.total,12);
 const danmu=await api.danmu('room-key');assert.equal(danmu.length,1);assert.equal(danmu[0].second,2.5);
 assert.ok(paths.some(p=>p.endsWith('/video/commentList')));assert.ok(paths.some(p=>p.endsWith('/video/getBarrage')));
});
