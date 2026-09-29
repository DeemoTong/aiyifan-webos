const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../app/index.html'),'utf8');
const code=fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8');
async function flush(){for(let i=0;i<10;i++)await Promise.resolve();}
async function setup(t,{member=true,ad=false,mse=false,resumeAt=0,tv=false,remote=[],remoteTotal=remote.length,remotePages={},comments=[],danmu=[]}={}){
  const dom=new JSDOM(html,{url:'https://app.test/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());
  const w=dom.window,d=w.document,$=id=>d.getElementById(id);
  let now=100000,serial=0;const timers=new Map();
  w.Date.now=()=>now;w.setTimeout=(fn,delay=0)=>{const id=++serial;timers.set(id,{at:now+delay,fn});return id};w.clearTimeout=id=>timers.delete(id);w.setInterval=()=>0;w.clearInterval=()=>{};
  function tick(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);now=next[1].at;next[1].fn();}now=end;}
  w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};
  w.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[this.getBoundingClientRect()]};
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,right:100,top:0,bottom:50,width:100,height:50}};
  const v=$('video');let time=0,paused=true,ready=0,assignments=0;
  Object.defineProperties(v,{currentTime:{get:()=>time,set:value=>{time=value;assignments++}},duration:{get:()=>3600},paused:{get:()=>paused},readyState:{get:()=>ready}});
  const emit=name=>v.dispatchEvent(new w.Event(name));
  v.canPlayType=()=> 'probably';v.pause=()=>{paused=true;emit('pause')};v.play=()=>{paused=false;return Promise.resolve()};v.load=()=>{time=0;ready=0;paused=true};
  const item={key:'film',title:'测试影片',category:'电影',image:'',summary:'',raw:{}};const calls=[];
  const engines=[];
  if(mse){
    class FakeHls{
      static Events={MANIFEST_PARSED:'manifest',LEVEL_SWITCHED:'level',ERROR:'error',MEDIA_ATTACHED:'attached'};
      static isSupported(){return true}
      constructor(config){this.config=config;this.listeners={};this.loads=[];this.levels=[{name:'576',height:0},{name:'720',height:0},{name:'1080',height:0}];engines.push(this)}
      on(name,fn){this.listeners[name]=fn}
      emit(name,data){if(this.listeners[name])this.listeners[name](name,data)}
      attachMedia(video){this.video=video;this.emit('attached')}
      loadSource(){this.emit('manifest',{levels:this.levels})}
      startLoad(time){this.loads.push(time)}
      destroy(){this.destroyed=true}
    }
    w.Hls=FakeHls;
  }
  if(resumeAt)w.localStorage.setItem('iyftv.local-watch-history.v1',JSON.stringify([{itemKey:'film',episodeKey:'ep',title:'测试影片',episodeName:'01',time:resumeAt,updatedAt:1}]));
  w.IyfApi={watchHistory:async(page)=>({items:page===1?remote:(remotePages[page]||[]),total:remoteTotal}),comments:async(item,page)=>({items:comments.slice((page-1)*10,page*10),hot:[],total:comments.length}),danmu:async()=>danmu,catalog:async()=>[item],category:async()=>[item],categoryFilters:async()=>[],detail:async()=>item,episodes:async()=>[{key:'ep',name:'01'}],account:async()=>({loggedIn:member,member}),revalidateSession:async()=>member,media:async(ep,quality)=>{calls.push(quality);return {data:{uniqueKey:'room'},sequence:(ad?[{url:'https://media.test/ad.m3u8',isHls:true,isAd:true}]:[]).concat([{url:'https://media.test/film.m3u8',isHls:true,isAd:false}])}}};
  if(tv){w.PalmSystem={};w.webOS={platform:{tv:true}};}w.eval(code);await flush();if(resumeAt){$('continue-watching').click();await flush();}else{$('hero-open').click();await flush();$('guest-first').click();await flush();}
  function mediaReady(){ready=4;emit('loadedmetadata');emit('canplay');if(!paused)emit('playing');}
  function key(name,type='keydown',repeat=false){const e=new w.KeyboardEvent(type,{key:name,bubbles:true,cancelable:true,repeat});d.activeElement.dispatchEvent(e);return e;}
  return {w,d,$,v,key,tick,calls,emit,mediaReady,flush,engines,setTime(value){time=value},assignments:()=>assignments};
}
test('Loading feedback survives hidden controls and clears on playback or failure',async t=>{
  const x=await setup(t);assert.equal(x.$('player-spinner').hidden,false);assert.equal(x.$('player-status').parentElement.id,'player-view');
  x.mediaReady();assert.equal(x.$('player-status').hidden,true);x.tick(6100);assert.equal(x.$('player-overlay').style.opacity,'0');
  x.emit('waiting');assert.equal(x.$('player-spinner').hidden,false);assert.equal(x.$('player-overlay').style.opacity,'1');
  x.emit('playing');assert.equal(x.$('player-spinner').hidden,true);
  x.emit('error');assert.equal(x.$('player-spinner').hidden,true);assert.equal(x.$('player-fallback').hidden,false);
});
test('Holding a direction previews with acceleration and performs one seek on release',async t=>{
  const x=await setup(t);x.mediaReady();x.setTime(120);const before=x.assignments();
  x.key('ArrowRight');assert.equal(x.v.paused,true);assert.equal(x.v.currentTime,120);
  x.tick(1000);const early=Number(x.$('player-timeline').getAttribute('aria-valuenow'));x.key('ArrowRight','keydown',true);x.tick(3500);
  const late=Number(x.$('player-timeline').getAttribute('aria-valuenow'));assert.ok(late-early>200);assert.equal(x.assignments(),before);
  x.key('ArrowRight','keyup');x.tick(250);assert.equal(x.v.currentTime,late);assert.equal(x.assignments(),before+1);assert.equal(x.v.paused,false);assert.equal(x.$('seek-preview').hidden,true);
});
test('Seek clamps to the duration and preserves pause; Back cancels a preview first',async t=>{
  const x=await setup(t);x.mediaReady();x.v.pause();x.setTime(3595);x.key('ArrowRight');x.tick(6000);x.key('ArrowRight','keyup');x.tick(250);assert.equal(x.v.currentTime,3599);assert.equal(x.v.paused,true);
  x.setTime(5);x.key('ArrowLeft');x.tick(600);x.key('Escape');assert.equal(x.v.currentTime,5);assert.equal(x.$('player-view').hidden,false);assert.equal(x.$('seek-preview').hidden,true);x.key('ArrowLeft','keyup');x.tick(1000);assert.equal(x.v.currentTime,5);
});
test('Quality menu waits for selection and switching preserves position, pause and speed',async t=>{
  const x=await setup(t);x.mediaReady();x.$('player-speed').click();x.d.querySelector('[data-value="1.5"]').click();x.setTime(125);x.v.pause();
  x.$('player-quality').click();assert.deepEqual(x.calls,[720]);assert.equal(x.d.activeElement.dataset.value,'720');
  x.key('ArrowRight');assert.equal(x.$('seek-preview').hidden,true);x.key('ArrowUp');assert.equal(x.d.activeElement.dataset.value,'1080');x.d.activeElement.click();await x.flush();assert.deepEqual(x.calls,[720,1080]);x.mediaReady();assert.equal(x.v.currentTime,125);assert.equal(x.v.paused,true);assert.equal(x.v.playbackRate,1.5);
});
test('Back closes menus without exiting and restores the trigger focus',async t=>{
  const x=await setup(t);x.mediaReady();x.$('player-quality').click();x.key('Escape');assert.equal(x.$('player-menu').hidden,true);assert.equal(x.$('player-view').hidden,false);assert.equal(x.d.activeElement.id,'player-quality');
  x.$('player-speed').click();assert.equal(x.$('player-menu-options').querySelectorAll('button').length,6);x.d.querySelector('[data-value="2"]').click();assert.equal(x.v.playbackRate,2);assert.equal(x.$('player-speed').textContent,'速度 2×');
});
test('Ad segments cannot be scrubbed and guest menu does not offer member speed',async t=>{
  const x=await setup(t,{member:false,ad:true});x.mediaReady();x.setTime(30);x.key('ArrowRight');x.tick(1800);x.key('ArrowRight','keyup');x.tick(250);assert.equal(x.v.currentTime,30);assert.equal(x.$('seek-preview').hidden,true);
  x.$('player-speed').click();assert.equal(x.$('player-menu-options').querySelector('[data-value="2"]'),null);
});
test('MSE resumes at the requested fragment without loading the beginning and seeking again',async t=>{
  const x=await setup(t,{mse:true,resumeAt:1200});const hls=x.engines[0];
  assert.equal(x.w.IyfPlaybackDiagnostics().engine,'hls.js');assert.equal(hls.config.enableWorker,true);assert.equal(hls.config.autoStartLoad,false);assert.deepEqual(hls.loads,[1200]);assert.equal(hls.startLevel,1);
  x.mediaReady();assert.equal(x.assignments(),0);
});
test('Master playlist qualities switch in place without another playback API request',async t=>{
  const x=await setup(t,{mse:true});x.mediaReady();x.setTime(125);x.v.pause();x.$('player-speed').click();x.d.querySelector('[data-value="1.5"]').click();x.$('player-quality').click();
  assert.equal(x.$('player-menu-options').querySelector('[data-value="2160"]'),null);
  x.$('player-menu-options').querySelector('[data-value="1080"]').click();await flush();
  assert.deepEqual(x.calls,[720]);assert.equal(x.engines.length,1);assert.equal(x.engines[0].destroyed,undefined);assert.equal(x.engines[0].nextLevel,2);assert.equal(x.v.currentTime,125);assert.equal(x.v.paused,true);assert.equal(x.v.playbackRate,1.5);
  x.engines[0].emit('level',{level:2});assert.equal(x.$('player-quality').textContent,'画质 1080P');
});
test('Fatal MSE errors fall back to native once and preserve the playback position',async t=>{
  const x=await setup(t,{mse:true});x.mediaReady();x.setTime(640);x.v.pause();x.engines[0].emit('error',{fatal:true});
  assert.equal(x.engines[0].destroyed,true);assert.equal(x.w.IyfPlaybackDiagnostics().engine,'native');x.mediaReady();assert.equal(x.v.currentTime,640);assert.equal(x.v.paused,true);
  x.emit('error');assert.equal(x.$('player-fallback').hidden,false);assert.equal(x.engines.length,1);
});

test('Rapid taps accumulate one seek and retain playback intent',async t=>{
 const x=await setup(t);x.mediaReady();x.setTime(120);const before=x.assignments();
 for(let i=0;i<5;i++){x.key('ArrowRight');x.key('ArrowRight','keyup');x.tick(80);}
 assert.equal(x.assignments(),before);x.tick(250);assert.equal(x.v.currentTime,170);assert.equal(x.assignments(),before+1);assert.equal(x.v.paused,false);assert.equal(x.$('player-fallback').hidden,true);
});
test('Interrupted and stale play promises never turn subsequent seeks into a playback failure',async t=>{
 const x=await setup(t);x.mediaReady();let reject;
 x.v.play=()=>new Promise((resolve,r)=>{reject=r});
 x.key('ArrowRight');x.key('ArrowRight','keyup');x.tick(250);const first=reject;
 x.key('ArrowRight');first(Object.assign(new Error('interrupted'),{name:'AbortError'}));await flush();assert.equal(x.$('player-fallback').hidden,true);
 x.key('ArrowRight','keyup');x.tick(250);x.$('player-back').click();reject(new Error('stale failure'));await flush();assert.equal(x.$('player-view').hidden,true);assert.equal(x.$('player-fallback').hidden,true);
});
test('A current genuine play error remains visible',async t=>{
 const x=await setup(t);x.mediaReady();x.v.play=()=>Promise.reject(Object.assign(new Error('decode failure'),{name:'NotSupportedError'}));
 x.key('ArrowRight');x.key('ArrowRight','keyup');x.tick(250);await flush();assert.equal(x.$('player-fallback').hidden,false);
});
test('Home history saves exit progress, includes finished episodes and resumes the chosen episode',async t=>{
 const x=await setup(t);x.mediaReady();x.setTime(120);x.$('player-back').click();x.key('Escape');
 let entry=x.$('history-cards').querySelector('button');assert.ok(entry);assert.match(entry.textContent,/02:00/);entry.click();await flush();x.mediaReady();assert.equal(x.v.currentTime,120);
 x.setTime(3550);x.$('player-back').click();x.key('Escape');entry=x.$('history-cards').querySelector('button');assert.match(entry.textContent,/已看完/);entry.click();await flush();x.mediaReady();assert.equal(x.v.currentTime,0);
});
test('History accepts rewinding and survives malformed stored data',async t=>{
 const x=await setup(t);x.mediaReady();x.setTime(600);x.emit('timeupdate');x.setTime(40);x.emit('timeupdate');
 let saved=JSON.parse(x.w.localStorage.getItem('iyftv.local-watch-history.v1'));assert.equal(saved[0].time,40);
 x.$('player-back').click();x.w.localStorage.setItem('iyftv.local-watch-history.v1','invalid');x.key('Escape');assert.equal(x.$('history-empty').hidden,false);
});

test('TV does not advertise speed settings ignored by its media pipeline',async t=>{
 const x=await setup(t,{tv:true});x.mediaReady();x.$('player-speed').click();
 assert.equal(x.$('player-menu-options').querySelectorAll('button').length,1);assert.equal(x.$('player-menu-options').firstElementChild.dataset.value,'1');assert.match(x.$('player-menu-note').textContent,/暂不支持倍速/);assert.equal(x.v.playbackRate,1);
});

test('Member history appears on home and resumes its recorded episode',async t=>{
 const record={itemKey:'film',episodeKey:'ep',title:'云端影片',episodeName:'01',time:480,duration:3600,completed:false,updatedAt:50000,remote:true};
 const x=await setup(t,{remote:[record]});await x.flush();x.$('player-back').click();x.key('Escape');
 const history=x.$('history-cards').querySelectorAll('button');assert.ok([...history].some(el=>el.textContent.includes('云端影片')));
 assert.match(x.$('watch-history-source').textContent,/会员历史/);
 [...history].find(el=>el.textContent.includes('云端影片')).click();await x.flush();x.mediaReady();assert.equal(x.v.currentTime,480);
});

test('History sidebar shows a grid and pages through all remote history',async t=>{
 const record=i=>({itemKey:'film'+i,episodeKey:'ep'+i,title:'历史'+i,episodeName:'01',time:120,duration:1200,completed:false,updatedAt:50000-i,remote:true});
 const first=Array.from({length:20},(_,i)=>record(i)),second=Array.from({length:20},(_,i)=>record(i+20));
 const x=await setup(t,{remote:first,remoteTotal:45,remotePages:{2:second,3:[record(40),record(41),record(42),record(43),record(44)]}});
 x.setTime(120);x.$('player-back').click();x.d.querySelector('[data-category="观看历史"]').click();await x.flush();
 assert.equal(x.d.querySelector('.hero').hidden,true);assert.equal(x.$('cards').querySelectorAll('.history-grid-card').length,21);assert.equal(x.$('next-page').hidden,false);
 x.$('next-page').click();await x.flush();assert.equal(x.$('cards').querySelectorAll('.history-grid-card').length,20);assert.equal(x.$('page-label').textContent,'第 2 / 3 页');
 x.$('next-page').click();await x.flush();assert.equal(x.$('cards').querySelectorAll('.history-grid-card').length,5);assert.equal(x.$('next-page').hidden,true);
});
test('Detail comments render real text and page through responses',async t=>{
 const comments=Array.from({length:12},(_,i)=>({author:'用户'+i,text:'评论内容'+i,date:'今天',likes:i,replies:0,children:[]}));
 const x=await setup(t,{comments});x.$('player-back').click();await x.flush();
 assert.equal(x.$('comments-list').querySelectorAll('.comment-card').length,10);assert.match(x.$('comments-list').textContent,/评论内容0/);
 const next=[...x.$('comment-pagination').querySelectorAll('button')].find(el=>el.textContent==='下一页');next.click();await x.flush();assert.equal(x.$('comments-list').querySelectorAll('.comment-card').length,2);assert.match(x.$('comment-pagination').textContent,/第 2 页/);
});
test('Opening a category preserves sidebar focus and the top of its page',async t=>{
 const x=await setup(t);x.$('player-back').click();const movie=x.d.querySelector('[data-category="电影"]');movie.focus();x.$('main').scrollTop=500;movie.click();await x.flush();
 assert.equal(x.d.activeElement,movie);assert.equal(x.$('main').scrollTop,0);assert.equal(x.$('cards').querySelectorAll('.card').length,1);
});
test('Category pagination restores focus after loading hides the current button',async t=>{
 const x=await setup(t);x.$('player-back').click();x.w.IyfApi.category=async(_name,page)=>Array.from({length:page===1?24:4},(_,i)=>({key:'film'+i,title:'影片'+i,category:'电影',image:'',raw:{}}));
 const movie=x.d.querySelector('[data-category="电影"]');movie.focus();movie.click();await x.flush();assert.equal(x.$('next-page').hidden,false);
 x.$('next-page').focus();x.$('next-page').click();await x.flush();assert.equal(x.$('main').scrollTop,0);assert.equal(x.$('next-page').hidden,true);assert.equal(x.d.activeElement,x.$('previous-page'));
});
test('View comments scrolls the panel into view and Down reaches its entries',async t=>{
 const x=await setup(t,{comments:[{author:'用户',text:'评论内容',date:'今天',likes:0,replies:0,children:[]}]});x.$('player-back').click();await x.flush();
 x.$('main').getBoundingClientRect=()=>({top:100,bottom:900,left:0,right:1200,width:1200,height:800});x.$('comments-section').getBoundingClientRect=()=>({top:700,bottom:1000,left:0,right:1200,width:1200,height:300});
 [...x.d.querySelectorAll('button')].find(el=>el.textContent==='查看评论').click();assert.equal(x.d.activeElement,x.$('comments-heading'));assert.equal(x.$('main').scrollTop,576);
 x.$('comments-heading').getBoundingClientRect=()=>({top:100,bottom:130,left:0,right:100,width:100,height:30});const card=x.$('comments-list').firstElementChild;card.getBoundingClientRect=()=>({top:200,bottom:320,left:0,right:500,width:500,height:120});x.key('ArrowDown');assert.equal(x.d.activeElement,card);
});
test('Timed danmu renders, pauses, seeks, toggles and saves font size',async t=>{
 const x=await setup(t,{danmu:[{second:2,text:'你好',position:0,color:0},{second:60,text:'稍后',position:0,color:0}]});x.mediaReady();x.setTime(2);x.emit('timeupdate');
 assert.equal(x.$('danmu-layer').children.length,1);assert.equal(x.$('danmu-layer').textContent,'你好');
 x.v.pause();assert.equal(x.$('player-view').classList.contains('danmu-paused'),true);
 x.$('player-danmu-toggle').click();assert.equal(x.$('danmu-layer').hidden,true);assert.equal(x.$('danmu-layer').children.length,0);
 x.$('player-danmu-size').click();x.$('player-menu-options').querySelector('[data-value="30"]').click();assert.equal(JSON.parse(x.w.localStorage.getItem('iyftv.danmu-settings.v1')).size,30);
 x.$('player-danmu-toggle').click();assert.equal(x.$('danmu-layer').hidden,false);
 x.v.play();x.setTime(60);x.emit('seeking');x.emit('timeupdate');assert.equal(x.$('danmu-layer').textContent,'稍后');assert.equal(x.$('danmu-layer').firstElementChild.style.fontSize,'30px');
});
