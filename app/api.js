/* Public guest protocol observed on iyf.tv, 2026-09-28. No account tokens. */
(function (root) {
  'use strict';
  var API = 'https://m10.iyf.tv/v3/';
  var LEGACY_API = 'https://m10.iyf.tv/api/';
  var RANK = 'https://rankv21.iyf.tv/v3/';
  var md5 = root.md5;
  var sessionStorageKey = 'iyftv.official-session.v1';
  var sessionToken = loadSession();
  var certificate = null;
  var initializing = null;
  var region = 'GL';
  var initialKeys = ['version001','vers1on001','vers1on00i','bersion001','vcrsion001','versi0n001','versio_001','version0o1'];
  function loadSession() {
    try {
      var value = JSON.parse(root.localStorage.getItem(sessionStorageKey) || 'null');
      return value && Number(value.uid) > 0 && value.token ? value : null;
    } catch (_) { return null; }
  }
  function withSession(params) {
    return sessionToken ? Object.assign({}, params || {}, sessionToken) : Object.assign({}, params || {});
  }
  function query(params, encoded) {
    return Object.keys(params).filter(function (key) { return params[key] !== undefined && params[key] !== null && params[key] !== ''; }).map(function (key) {
      return key + '=' + (encoded ? encodeURIComponent(String(params[key])) : String(params[key]));
    }).join('&');
  }
  function signed(params, cert) {
    var plain = query(params, false);
    var signature = md5(cert.publicKey + '&' + plain.toLowerCase() + '&' + String(cert.privateKey));
    return query(params, true) + '&vv=' + signature + '&pub=' + encodeURIComponent(cert.publicKey);
  }
  async function request(url, options) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 18000);
    try {
      var response = await fetch(url, Object.assign({credentials:'omit', signal:controller.signal}, options || {}));
      if (!response.ok) throw new Error('服务暂不可用（HTTP ' + response.status + '）');
      var body = await response.json();
      if (!body.data || body.data.code !== 0) {
        var error = new Error(body.data && body.data.msg || '网站返回了无法识别的数据');
        error.siteCode = body.data && body.data.code;
        throw error;
      }
      if (!Array.isArray(body.data.info)) throw new Error('网站数据格式已变化');
      return body.data.info;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接超时，请检查网络后重试');
      if (error instanceof TypeError) throw new Error('无法连接网站，请检查网络或使用「打开原站」');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function init() {
    if (certificate) return Promise.resolve();
    if (initializing) return initializing;
    var now = Date.now();
    var initial = { publicKey:String(now), privateKey:initialKeys[now % initialKeys.length] };
    initializing = request(API + 'home/config?' + signed({cinema:1}, initial)).then(function (data) {
      var config = data[0] && data[0].pConfig;
      if (!config || !config.publicKey || !config.privateKey) throw new Error('网站初始化协议已变化，请使用原站');
      certificate = {publicKey:config.publicKey, privateKey:config.privateKey};
      return request('https://m10.iyf.tv/api/home/getmyregion?' + signed({cinema:1},certificate)).then(function(info){
        if (info[0] && /^[A-Z]{2}$/.test(info[0].regionCode)) region = info[0].regionCode;
      }).catch(function(){ /* The site's default GL route remains available. */ });
    }).finally(function () { initializing = null; });
    return initializing;
  }
  async function get(path, params) {
    await init();
    return request(API + path + '?' + signed(withSession(Object.assign({cinema:1}, params)), certificate));
  }
  async function getWithSession(path, params, legacy) {
    await init();
    var base = legacy ? LEGACY_API : API;
    return request(base + path + '?' + signed(withSession(Object.assign({cinema:1}, params)), certificate), {credentials:'include'});
  }
  function imageUrl(value) {
    try { var url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; }
  }
  function normalize(item, category) {
    var searchKey = !item.key && /^[A-Za-z0-9_-]+$/.test(item.contxt || '') ? item.contxt : '';
    var genre = item.cidMapper || item.videoType || item.cid || '';
    if (/^[0-9,|]+$/.test(genre)) genre = item.videoType || item.cid || '';
    if (/^[0-9,|]+$/.test(genre)) genre = '';
    var rating = item.score && item.score !== '暂无评分' ? item.score : item.pingFen ? (Number(item.pingFen)/10).toFixed(1) : Number(item.rating)<=10 ? item.rating : '';
    return {
      key:String(item.key || searchKey || ''), title:String(item.title || '未命名影片'),
      image:imageUrl(item.image || item.imgPath || ''),
      year:String(item.year || item.post_Year || (item.postTime || '').slice(0,4)), region:String(item.regional || ''),
      genre:String(genre), language:String(item.lang || item.language || ''),
      summary:String(item.summary || item.shortDes || (searchKey ? '' : item.contxt) || ''), rating:String(rating || ''),
      lastName:String(item.lastName || ''), actors:Array.isArray(item.stars) ? item.stars.join(' / ') : String(item.starring || ''),
      directors:Array.isArray(item.directors) ? item.directors.join(' / ') : String(item.directed || ''),
      category:category || String(item.channel || item.atypeName || ''), raw:item
    };
  }
  async function catalog() {
    var info = await get('home/getAllVideo', {set:1,size:24});
    var data = info[0] || {};
    var channels = [['filmList','电影'],['tvList','电视剧'],['varietyList','综艺'],['animeList','动漫'],['documentaryList','纪录片'],['shortList','短剧']];
    var result = [];
    channels.forEach(function (pair) {
      (data[pair[0]] || []).forEach(function (item) { if (item.key) result.push(normalize(item,pair[1])); });
    });
    if (!result.length) throw new Error('目录暂时为空，或网站的数据格式已变化');
    return result;
  }
  var categoryIds = {'电影':'0,1,3','电视剧':'0,1,4','综艺':'0,1,5','动漫':'0,1,6','纪录片':'0,1,7','短剧':'0,1,8','体育':'0,1,95'};
  var categoryTypePaths = {'电影':'FilmType','电视剧':'TvType','综艺':'VarietyType','动漫':'AnimeType','纪录片':'DocumentaryType','体育':'SportType'};
  var categoryTypeCache = {};
  async function categoryFilters(name) {
    if (categoryTypeCache[name]) return categoryTypeCache[name];
    var path = categoryTypePaths[name];
    if (!path) return [];
    var info = await getWithSession('list/' + path, {}, true);
    var base = categoryIds[name];
    var filters = (info || []).filter(function(item){return item && typeof item.className === 'string' && typeof item.path === 'string' && item.path.indexOf(base + ',') === 0 && /^[0-9,]+$/.test(item.path);}).map(function(item){return {name:item.className,path:item.path};});
    categoryTypeCache[name] = filters;
    return filters;
  }
  async function category(name, page, filterPath) {
    var cid = categoryIds[name];
    if (!cid) throw new Error('暂不支持这个分类');
    if (filterPath && (filterPath.indexOf(cid + ',') !== 0 || !/^[0-9,]+$/.test(filterPath))) filterPath = '';
    var info = await getWithSession('list/index', {page:page||1,cid:filterPath||cid,size:24,isn:0,isfree:-1}, true);
    return (info || []).map(function(item){return normalize(item,name);}).filter(function(item){return item.key;});
  }
  async function search(term, page) {
    await init();
    var params = withSession({cinema:1,tags:term,orderby:4,page:page||1,size:20,desc:1,isserial:-1});
    var info = await request(RANK + 'list/briefsearch?' + query(params,true), {
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:signed({tags:term},certificate)
    });
    var data = info[0] || {};
    return {items:(data.result || []).map(function(item){return normalize(item);}), count:Number(data.recordcount || 0)};
  }
  async function detail(key) {
    if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('影片标识无效，请重新搜索');
    var info = await get('video/detail', {id:key,device:1,lang:'cns'});
    if (!info[0]) throw new Error('没有找到影片详情');
    return normalize(info[0]);
  }
  async function episodes(item, languageKey) {
    var info = await get('video/languagesplaylist', {vid:languageKey || item.key,lsk:1,taxis:item.raw.taxis || 0,cid:item.raw.cid});
    return info[0] && Array.isArray(info[0].playList) ? info[0].playList : [];
  }
  function truth(value) { return value === true || value === 1 || value === '1' || value === 'true'; }
  function signedMediaUrl(value) {
    var url = new URL(value);
    if (!certificate || url.searchParams.has('vv') || url.searchParams.has('pub')) return value;
    var plain = url.search.slice(1).split('&').filter(Boolean).map(function(part){
      var sections=part.split('=');return sections[0]+sections.slice(1).map(function(v){return '='+decodeURIComponent(v).replace(/\+/g,' ');}).join('');
    }).join('&');
    return value+(url.search?'&':'?')+'vv='+md5(certificate.publicKey+'&'+plain.toLowerCase()+'&'+String(certificate.privateKey))+'&pub='+encodeURIComponent(certificate.publicKey);
  }
  function mediaUrlWithSession(value) {
    var url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('此播放地址暂不支持，请在原站播放');
    if (sessionToken && Number(sessionToken.uid) > 0) {
      Object.keys(sessionToken).forEach(function (key) {
        if (sessionToken[key] !== undefined && sessionToken[key] !== null) url.searchParams.set(key, String(sessionToken[key]));
      });
    }
    return url.href;
  }
  function playableSequence(data) {
    if (!data) throw new Error('没有可播放的信息');
    if (data.needLogin) throw new Error('此内容需要登录，请在原站登录并播放');
    if (data.isPreView || data.isLimitedStream) throw new Error('此内容有试看或播放限制，请在原站播放');
    // customData.s/e are playback positions used by the website's play config.
    // Access restrictions are reported separately above; positions do not deny playback.
    if (data.videoServer && Number(data.videoServer.status) !== 0) throw new Error(data.videoServer.info || '播放服务暂不可用');
    var sequence = (data.startData || []).concat(data.flvPathList || []).filter(function(x){return x && x.result;});
    if (!sequence.length) throw new Error('暂未获得可播放的视频，请使用原站');
    sequence.forEach(function (x) {
      if (!/^https:\/\//i.test(x.result)) throw new Error('此播放地址暂不支持，请在原站播放');
    });
    return sequence.map(function(x,index){return {url:signedMediaUrl(x.needSign?mediaUrlWithSession(x.result):x.result),isHls:!!x.isHls,isAd:!!x.link || index < (data.startData || []).length,duration:Number(x.duration)||0};});
  }
  async function account() {
    if (!sessionToken) return {loggedIn:false,member:false};
    try {
      var info = await getWithSession('user/getuserinfo', {});
      var user = info && info[0];
      if (!user || !(Number(user.uid)>0)) return {loggedIn:false,member:false};
      var days = Number(user.endDays || 0);
      var member = !!(user.vipImage || days > 0);
      return {loggedIn:true,member:member,uid:Number(user.uid),name:String(user.nickName || user.userName || ''),days:days};
    } catch (_) { return {loggedIn:false,member:false,unknown:true}; }
  }
  async function validateLoginToken(loginToken, remember) {
    if (!loginToken) throw new Error('官网没有返回有效的登录票据');
    await init();
    var params = {token:String(loginToken),remeberme:remember ? 1 : 0,autologin:1};
    var info = await request(LEGACY_API + 'user/validate?' + signed(params, certificate), {credentials:'include'});
    var result = info && info[0];
    var token = result && result.userToken;
    if (!token || !(Number(token.uid) > 0) || !token.token || !token.sign) throw new Error('爱壹帆未确认登录，请重试或使用官网播放器');
    return {uid:Number(token.uid),expire:token.expire,gid:token.gid,sign:token.sign,token:token.token};
  }
  async function revalidateSession() {
    if (!sessionToken || !sessionToken.token) return false;
    try {
      var token = await validateLoginToken(sessionToken.token, false);
      setSession(token);
      return true;
    } catch (_) { return false; }
  }
  function setSession(token) {
    if (!token || !(Number(token.uid) > 0) || !token.token) throw new Error('登录票据格式无效');
    sessionToken = {uid:Number(token.uid),expire:token.expire,gid:token.gid,sign:token.sign,token:token.token};
    try { root.localStorage.setItem(sessionStorageKey, JSON.stringify(sessionToken)); }
    catch (_) { throw new Error('无法在本机保存登录状态'); }
    return sessionToken;
  }
  function clearSession() {
    sessionToken = null;
    try { root.localStorage.removeItem(sessionStorageKey); } catch (_) {}
  }
  async function media(episode, sharpness) {
    if (episode && truth(episode.isVip) && !truth(episode.isBought) && !sessionToken) throw new Error('此内容需要登录或会员权限，请先登录后重试');
    await init();
    var info = await getWithSession('video/play', {id:episode.key,lang:'cns',usersign:1,region:region,device:1,a:0,isMasterSupport:1,sharpness:sharpness||720});
    var data = info[0];
    return {data:data, sequence:playableSequence(data)};
  }
  async function watchHistory(page) {
    if (!sessionToken || !(Number(sessionToken.uid)>0)) return {items:[],total:0};
    page=Math.max(1,Math.floor(Number(page)||1));
    var url = new URL('https://w.anybound.vip/v3/PlayList/ObtainListWithCount');
    ['uid','expire','gid','sign','token'].forEach(function(key){if(sessionToken[key]!==undefined&&sessionToken[key]!==null)url.searchParams.set(key,String(sessionToken[key]));});
    var data = await request(url.href, {method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'pageSize=20&orderBy=time&pageIndex='+page+'&desc=1'});
    var list = data[0] && data[0].list;
    if (!Array.isArray(list)) return {items:[],total:0};
    var items=list.map(function(row){
      var match = String(row.link || '').match(/[?&]id=([A-Za-z0-9_-]+)/);
      if (!match || !/^[A-Za-z0-9_-]+$/.test(String(row.lastId || ''))) return null;
      var time = Number(row.playTime)||0, duration=Number(row.totalTime)||0;
      return {itemKey:match[1],episodeKey:String(row.lastId),title:String(row.title||'影片'),episodeName:String(row.lastTitle||''),image:imageUrl(row.imgPath||''),time:Math.max(0,time),duration:Math.max(0,duration),completed:truth(row.isFinish)||duration>0&&time/duration>=0.95,updatedAt:Date.parse(row.updateTime)||0,remote:true};
    }).filter(Boolean);
    return {items:items,total:Number(data[0].recordCount)||0};
  }
  async function comments(item,page){
    var id=Number(item&&item.raw&&item.raw.id);
    if(!Number.isFinite(id)||id<=0)throw new Error('无法取得评论编号');
    page=Math.max(1,Math.floor(Number(page)||1));
    var info=await get('video/commentList',{id:id,page:page,pagesize:10,type:1,orderBy:0});
    var data=info[0]||{};
    function map(row){return {author:String(row.nickName||'用户'),text:String(row.context||''),date:String(row.post_Date||''),likes:Number(row.likes)||0,replies:Number(row.childrenCount)||0,children:Array.isArray(row.children)?row.children.slice(0,3).map(map):[]};}
    return {items:(data.commNormal||[]).map(map),hot:(data.commHot||[]).map(map),total:Number(data.recordSum)||0,page:page};
  }
  async function danmu(uniqueKey){
    if(!uniqueKey||!/^[A-Za-z0-9_-]{1,100}$/.test(uniqueKey))return [];
    var info=await getWithSession('video/getBarrage',{page:1,size:12000,uniqueKey:uniqueKey},true);
    return info.filter(function(row){return row&&!truth(row.isDeleted)&&Number.isFinite(Number(row.second))&&Number(row.second)>=0&&String(row.contxt||row.processContext||'').trim();}).map(function(row){return {second:Number(row.second),text:String(row.contxt||row.processContext).trim().slice(0,120),position:Number(row.position)||0,color:Number(row.color)||0};}).sort(function(a,b){return a.second-b.second;});
  }
  root.IyfApi = {init:init,catalog:catalog,category:category,categoryFilters:categoryFilters,account:account,search:search,detail:detail,episodes:episodes,media:media,watchHistory:watchHistory,comments:comments,danmu:danmu,normalize:normalize,playableSequence:playableSequence,signed:signed,truth:truth,validateLoginToken:validateLoginToken,revalidateSession:revalidateSession,setSession:setSession,clearSession:clearSession};
})(typeof window !== 'undefined' ? window : globalThis);
