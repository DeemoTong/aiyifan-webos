(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var api = window.IyfApi;
  var state = {mode:'catalog',category:'推荐',catalog:[],items:[],item:null,episodes:[],request:0,page:1,term:'',selectedKey:'',returnFocus:null,filterPath:'',account:null,resumeRequest:null,officialSession:false};
  var player = {hls:null,sequence:[],index:0,token:0,episode:null,timer:null,failed:false,quality:720,resumeAt:0,speed:1,lastSaved:0};
  var tvApp=!!(window.PalmSystem&&window.webOS&&window.webOS.platform&&window.webOS.platform.tv);
  var watchStorageKey='iyftv.local-watch-history.v1';
  var danmuStorageKey='iyftv.danmu-settings.v1';
  var danmuSettings=(function(){try{var saved=JSON.parse(localStorage.getItem(danmuStorageKey)||'{}');return {enabled:saved.enabled!==false,size:[18,22,26,30].includes(Number(saved.size))?Number(saved.size):22};}catch(_){return {enabled:true,size:22};}})();
  var remoteHistory=[],remoteHistoryTotal=0,historyFetchedAt=0,historyPromise=null,historyAccountUid=0;
  var loginClient=null;
  var qrLogin={key:'',timer:null,request:0,expiresAt:0};
  var modalReturn = null;
  var toastTimer;
  var commentRequest=0;
  var categories = [['推荐','⌂'],['观看历史','◷'],['电影','▤'],['电视剧','▣'],['综艺','✧'],['动漫','◇'],['纪录片','◎'],['短剧','▥'],['体育','◉'],['搜索','⌕']];
  function node(tag, text, className) { var el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(className)el.className=className; return el; }
  function button(text, handler, className) {var el=node('button',text,className||'secondary');el.type='button';el.addEventListener('click',handler);return el;}
  function focus(el) {if(el && el.isConnected && !el.disabled){el.focus({preventScroll:true});el.scrollIntoView({block:'nearest',inline:'nearest'});}}
  function toast(text) {$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(function(){$('toast').hidden=true;},3500);}
  function photo(url, title, className) {var img=node('img',undefined,className);img.alt=title;img.referrerPolicy='no-referrer';if(url)img.src=url;img.addEventListener('error',function(){img.style.visibility='hidden';},{once:true});return img;}
  function meta(item) {return [item.year,item.region,item.genre,item.language].filter(Boolean).join(' · ');}
  function openModal(title, text, actions) {
    modalReturn=document.activeElement;
    $('modal-title').textContent=title;$('modal-text').textContent=text;$('modal-actions').replaceChildren();
    (actions||[{label:'知道了',run:function(){}}]).forEach(function(action,index){$('modal-actions').append(button(action.label,function(){closeModal();action.run();},index===0?'primary':'secondary'));});
    $('modal-layer').hidden=false;focus($('modal-actions').querySelector('button'));
  }
  function closeModal() {$('modal-layer').hidden=true;focus(modalReturn);}
  function original(key, episodeKey) {
    var url='https://www.iyf.tv/'+(key?'play/'+encodeURIComponent(key):'');
    if(episodeKey)url+='?id='+encodeURIComponent(episodeKey);
    if(state.mode==='player')$('video').pause();
    var message=key?(state.officialSession?'将打开爱壹帆官方播放页。扫码登录会话已通过官网验证；会员画质与广告由官网播放器处理。':'将打开爱壹帆官方播放页；若官网页面未识别登录状态，请在官网登录一次。'):'将打开爱壹帆官网首页。官网页面由爱壹帆处理登录、会员画质与广告。';
    openModal('前往爱壹帆原站',message+'\n需要返回电视界面时，请重新打开「帆·电视」。',[
      {label:'打开原站',run:function(){location.assign(url);}}, {label:'留在这里',run:function(){}}
    ]);
  }
  function memberLogin() {
    if(state.account&&state.account.loggedIn){
      openModal('爱壹帆账号',state.account.name?(state.account.name+' 已在自制播放器中验证。'):'账号已在自制播放器中验证。',[{label:'退出此应用',run:function(){api.clearSession();state.officialSession=false;refreshAccount();toast('已退出此应用账号');}},{label:'关闭',run:function(){}}]);
      return;
    }
    openMemberLogin();
  }
  function closeMemberLogin() {
    cancelQrLogin(true);
    $('login-view').hidden=true;
    focus($('member-login'));
  }
  function openMemberLogin() {
    $('login-view').hidden=false;
    $('login-status').textContent='选择扫码登录，使用爱壹帆 App 扫码后，登录状态会同步到本应用播放器。';
    selectLoginMethod('qr');
    focus($('qr-refresh'));
  }
  function authService(method,parameters) {
    return new Promise(function(resolve,reject){
      if(!window.webOS||!window.webOS.service||typeof window.webOS.service.request!=='function'){
        reject(new Error('webOS 登录服务不可用；请安装包含扫码服务的新版应用'));
        return;
      }
      window.webOS.service.request('luna://com.personal.iyftv.auth/',{
        method:method,parameters:parameters||{},subscribe:false,resubscribe:false,
        onSuccess:function(result){if(result&&result.returnValue)resolve(result);else reject(new Error(result&&result.errorText||'爱壹帆扫码服务暂不可用'));},
        onFailure:function(error){reject(new Error(error&&error.errorText||'无法连接爱壹帆扫码服务'));}
      });
    });
  }
  function cancelQrLogin(invalidate) {
    clearTimeout(qrLogin.timer);qrLogin.timer=null;qrLogin.request++;
    var key=qrLogin.key;qrLogin.key='';qrLogin.expiresAt=0;
    if(invalidate&&key)authService('invalidateQrCode',{key:key}).catch(function(){});
  }
  function selectLoginMethod(method) {
    var qr=method==='qr';
    $('qr-login').hidden=!qr;$('account-login').hidden=qr;
    $('login-qr-tab').classList.toggle('selected',qr);$('login-account-tab').classList.toggle('selected',!qr);
    $('login-qr-tab').setAttribute('aria-selected',qr?'true':'false');$('login-account-tab').setAttribute('aria-selected',qr?'false':'true');
    if(qr){
      if(!qrLogin.key||Date.now()>=qrLogin.expiresAt)requestQrLogin();
      else scheduleQrPoll(qrLogin.request,0);
    }else{
      cancelQrLogin(true);
      openAccountLogin();
    }
  }
  function requestQrLogin() {
    cancelQrLogin(true);
    var request=qrLogin.request;
    $('login-qr').hidden=true;$('login-qr').removeAttribute('src');$('qr-placeholder').hidden=false;$('qr-placeholder').textContent='正在向爱壹帆申请安全二维码…';$('qr-status').textContent='正在获取二维码…';$('qr-refresh').disabled=true;
    authService('getQrCode').then(function(result){
      if(request!==qrLogin.request||$('login-view').hidden||$('qr-login').hidden)return;
      if(!result.key||!result.url)throw new Error('爱壹帆没有返回有效的扫码信息');
      if(typeof window.qrcode!=='function')throw new Error('二维码组件未加载，请重新安装应用');
      var code=window.qrcode(0,'M');code.addData(result.url,'Byte');code.make();
      qrLogin.key=result.key;qrLogin.expiresAt=Date.now()+5*60*1000;
      $('login-qr').src=code.createDataURL(7,4);$('login-qr').hidden=false;$('qr-placeholder').hidden=true;
      $('qr-status').textContent='请用爱壹帆 App「首页」右上角「＋」中的「扫一扫」扫描；扫码后请在手机上确认。';
      scheduleQrPoll(request,0);
    }).catch(function(error){
      if(request!==qrLogin.request)return;
      $('qr-placeholder').textContent='暂时无法获取二维码';$('qr-status').textContent=(error&&error.message||'二维码加载失败')+'。可刷新重试，或切换到账号登录。';
    }).finally(function(){if(request===qrLogin.request)$('qr-refresh').disabled=false;});
  }
  function scheduleQrPoll(request,delay) {
    clearTimeout(qrLogin.timer);
    qrLogin.timer=setTimeout(function(){pollQrLogin(request);},delay);
  }
  function sessionFromQr(value) {
    if(!value||!(Number(value.uid)>0)||!value.token||!value.sign)return null;
    return {uid:Number(value.uid),token:String(value.token),sign:String(value.sign),gid:value.gid,expire:value.expire};
  }
  function pollQrLogin(request) {
    if(request!==qrLogin.request||!qrLogin.key||$('login-view').hidden||$('qr-login').hidden)return;
    if(Date.now()>=qrLogin.expiresAt){cancelQrLogin(true);$('qr-status').textContent='二维码已失效，请刷新后重新扫描。';$('qr-placeholder').hidden=false;$('qr-placeholder').textContent='二维码已失效';$('login-qr').hidden=true;return;}
    authService('getAuthInfo',{key:qrLogin.key}).then(function(result){
      if(request!==qrLogin.request)return;
      if(result.status==='expired'){
        cancelQrLogin(true);$('qr-status').textContent='二维码已失效，请刷新后重新扫描。';$('qr-placeholder').hidden=false;$('qr-placeholder').textContent='二维码已失效';$('login-qr').hidden=true;return;
      }
      var session=result.status==='authorized'?sessionFromQr(result.session):null;
      if(result.status==='authorized'&&!session)throw new Error('官方扫码授权已完成，但返回的会话信息格式不受支持');
      if(session){
        $('qr-status').textContent='已扫码，正在验证账号权限…';
        return api.validateLoginToken(session.token,false).then(function(websiteSession){
          state.officialSession=true;api.setSession(websiteSession);
        }).catch(function(){
          state.officialSession=false;api.setSession(session);
        }).then(function(){return refreshAccount();}).then(function(account){
          if(!account.loggedIn)throw new Error('官方已授权，但本应用未能验证会话，请重新扫码');
          cancelQrLogin(false);$('login-view').hidden=true;focus($('member-login'));
          toast(account.member?'会员已验证，可以使用自制播放器':'账号已验证');
        });
      }
      $('qr-status').textContent='等待扫码或手机确认…';
      scheduleQrPoll(request,1800);
    }).catch(function(error){
      if(request!==qrLogin.request)return;
      $('qr-status').textContent=(error&&error.message||'扫码状态暂不可读')+'；正在重试…';
      scheduleQrPoll(request,3500);
    });
  }
  function openAccountLogin() {
    $('login-status').textContent='请在爱壹帆官方登录组件中登录；密码不会由本应用保存。';
    focus($('login-close'));
    if(!window.DNa||!window.DNA_Config){
      $('login-status').textContent='官方登录组件暂不可用。可打开官网登录，但该会话无法同步给自制播放器。';
      return;
    }
    window.dnapublic='cd7bfe907329c083389fffd24563fa80';
    window.DNA_Config.Host='iyf.tv';
    window.DNA_Config.UseAuthorizeCode=1;
    window.DNA_Config.Theme='darkinone';
    window.DNA_Config.DefaultLoginMethod=1;
    window.DNA_Config.UsingEventHandler=true;
    window.DNA_Config.UsingEffect=false;
    window.DNA_Config.DNA_AutoLogin=true;
    window.DNA_Config.RemeberMe=false;
    window.DNA_Config.DisabledServerRender=1;
    window.DNA_Config.AuthCodeType='1';
    window.DNA_Config.__protocol='https:';
    window.DNA_Config.IsFileSystem=true;
    window.DNA_Config.DisableCookie=true;
    window.DNA_Config.DNA_LoginURL='https://m10.iyf.tv/api/user/validate';
    window.DNA_Config.Method='POST';
    window.DNA_Config.UsingSafe=true;
    window.DNA_Config.PageContainerID='login-frame';
    // DNA SDK throws when this is null; an unmatched selector requests immediate rendering.
    window.DNA_Config.DNA_ClickContent='#iyf-tv-login-launch';
    window.DNA_Config.ServerCallback=false;
    window.DNA_Config.TokenExistRefreshIt=function(){};
    window.DNA_Config.ComponentLoaded=function(){$('login-status').textContent='请使用遥控器在爱壹帆官方页面完成登录。';};
    window.DNA_Config.CustomValidation=function(payload){
      $('login-status').textContent='登录成功，正在向爱壹帆验证账号…';
      api.validateLoginToken(payload&&payload.token,payload&&payload.remeberme).then(function(token){
        state.officialSession=true;
        api.setSession(token);
        return refreshAccount();
      }).then(function(result){
        if(!result.loggedIn)throw new Error('官网尚未确认账号状态，请重试或使用官网播放器');
        closeMemberLogin();
        toast(result.member?'会员已验证，可以使用自制播放器':'账号已验证');
      }).catch(function(error){
        $('login-status').textContent=(error&&error.message||'登录验证失败')+'。可以重试，或打开官网登录。';
      });
    };
    try{
      if(loginClient)loginClient.ShowLoginBox();
      else loginClient=new window.DNa({key:window.dnapublic});
    }catch(error){
      $('login-status').textContent='无法加载官方登录组件。可以打开官网登录，但该会话无法同步给自制播放器。';
    }
  }
  function setHero(item) {
    if(!item)return;
    state.selectedKey=item.key;
    $('hero-title').textContent=item.title;$('hero-meta').textContent=meta(item);
    $('hero-summary').textContent=item.summary || '查看影片详情与剧集，开始今晚的大屏时光。';
    $('hero-art').style.backgroundImage=item.image?'url('+JSON.stringify(item.image)+')':'none';
    $('hero-open').disabled=false;
  }
  function showCatalog() {updateContinueButton();$('watch-history').hidden=state.category!=='推荐';$('catalog-view').hidden=false;$('detail-view').hidden=true;$('player-view').hidden=true;state.mode='catalog';if(state.category==='观看历史'&&state.page===1)renderHistoryPage(combinedHistory(0));}
  function setCategory(name) {
    state.request++;state.category=name;state.page=1;state.filterPath='';showCatalog();$('main').scrollTop=0;if(name==='推荐'&&state.account&&state.account.loggedIn)refreshWatchHistory();
    document.querySelectorAll('[data-category]').forEach(function(el){el.classList.toggle('active',el.dataset.category===name);el.setAttribute('aria-current',el.dataset.category===name?'page':'false');});
    $('breadcrumb').textContent=name==='推荐'?'发现 / 为大屏而做':'发现 / '+name;
    $('search-form').hidden=name!=='搜索';document.querySelector('.hero').hidden=name==='搜索'||name==='观看历史';
    $('catalog-view').classList.toggle('history-mode',name==='观看历史');if(name==='观看历史')$('filters').before($('pagination'));else $('cards').before($('pagination'));
    $('section-title').textContent=name==='推荐'?'今晚看什么':name==='搜索'?'搜索结果':name==='观看历史'?'观看历史':name+' · 最近更新';
    $('catalog-error').hidden=true;$('catalog-status').hidden=true;$('filters').hidden=name==='推荐'||name==='搜索'||name==='短剧'||name==='观看历史';$('filters').replaceChildren();
    if(name==='观看历史'){loadHistoryPage(1,false);return;}
    if(name==='搜索'){
      $('cards').replaceChildren();$('result-count').textContent='';updatePages(0);
      if(state.term)performSearch(state.term,1);else{$('catalog-status').textContent='输入片名，搜索全站影片。';$('catalog-status').hidden=false;}
      focus($('search-input'));return;
    }
    if(name==='推荐'){
      if(!state.catalog.length){loadCatalog();return;}
      renderCatalog();return;
    }
    loadCategoryFilters(name);loadCategory(name,1,false);
  }
  function renderCatalog() {
    var items=state.catalog.filter(function(item){return state.category==='推荐'||item.category===state.category;});
    if(state.category==='推荐'){
      var groups=categories.slice(2,8).map(function(pair){return items.filter(function(x){return x.category===pair[0];});});
      items=[];for(var i=0;i<24;i++)groups.forEach(function(group){if(group[i])items.push(group[i]);});
    }
    state.items=items;renderCards(items);updatePages(0);setHero(items.find(function(x){return x.key===state.selectedKey;})||items[0]);
    $('result-count').textContent=items.length+' 部 · 官网推荐';
  }
  function renderCards(items) {
    $('cards').replaceChildren();
    items.forEach(function(item){
      var card=button('',function(){openDetail(item.key,card);},'card');card.dataset.key=item.key;card.setAttribute('aria-label',item.title);
      var poster=node('div',undefined,'poster');var img=photo(item.image,item.title);img.loading='lazy';poster.append(img);
      if(item.rating && item.rating!=='0')poster.append(node('span',item.rating,'rating'));
      poster.append(node('span',item.lastName?(/集|P|期|全/.test(item.lastName)?item.lastName:'更新至 '+item.lastName):item.category,'update'));
      card.append(poster,node('h3',item.title),node('p',[item.year,item.region,item.genre].filter(Boolean).join(' / ')));
      card.addEventListener('focus',function(){setHero(item);});$('cards').append(card);
    });
    if(!items.length)$('cards').append(node('p',state.category==='搜索'?'没有找到影片，换一个片名试试。':'这个分类暂时没有影片。','empty'));
  }
  function updatePages(count) {
    if(state.category==='观看历史'){
      var pages=Math.max(1,Math.ceil(remoteHistoryTotal/20));$('pagination').hidden=pages<=1;$('previous-page').hidden=state.page<=1;$('next-page').hidden=state.page>=pages;$('page-label').textContent='第 '+state.page+' / '+pages+' 页';return;
    }
    var pageable=state.category!=='推荐';
    $('pagination').hidden=!pageable||!count;
    $('previous-page').hidden=!pageable||state.page<=1;
    $('next-page').hidden=!pageable||!count;
    $('page-label').textContent=pageable&&count?'第 '+state.page+' 页':'';
  }
  async function loadCatalog() {
    var token=++state.request;
    $('catalog-status').hidden=false;$('catalog-status').textContent='正在获取影片目录…';$('catalog-error').hidden=true;
    try {
      var items=await api.catalog();state.catalog=items;
      if(token!==state.request)return;
      $('connection').textContent='● 官网目录已连接';$('catalog-status').hidden=true;renderCatalog();
    } catch(error){if(token===state.request){$('connection').textContent='连接未完成';catalogError(error.message);}}
  }
  async function loadCategory(name,page,focusFirst) {
    state.page=page;var token=++state.request;
    $('cards').replaceChildren();$('catalog-error').hidden=true;$('catalog-status').hidden=false;$('catalog-status').textContent='正在加载官网「'+name+'」…';$('result-count').textContent='';updatePages(0);
    try{
      var items=await api.category(name,page,state.filterPath);if(token!==state.request)return;
      state.items=items;$('catalog-status').hidden=true;renderCards(items);setHero(items[0]);
      $('result-count').textContent=items.length+' 部 · 第 '+page+' 页';updatePages(items.length===24?1:0);
      if(focusFirst!==false)focus($('cards').querySelector('button')||document.querySelector('[data-category="'+name+'"]'));
      else{if(document.activeElement===document.body||!document.activeElement.getClientRects().length)focus(!$('next-page').hidden?$('next-page'):$('previous-page'));$('main').scrollTop=0;}
    }catch(error){if(token===state.request)catalogError(error.message);}
  }
  async function loadCategoryFilters(name) {
    if(name==='短剧')return;
    try{
      var filters=await api.categoryFilters(name);if(state.category!==name)return;
      var host=$('filters');host.replaceChildren();
      [{name:'全部',path:''}].concat(filters).forEach(function(filter){
        var b=button(filter.name,function(){state.filterPath=filter.path;host.querySelectorAll('button').forEach(function(x){x.classList.toggle('selected',x===b);});loadCategory(name,1);},'filter-chip'+(filter.path===state.filterPath?' selected':''));
        host.append(b);
      });
      host.hidden=false;
    }catch(_){if(state.category===name)$('filters').hidden=true;}
  }
  async function refreshAccount() {
    var result=await api.account();state.account=result;var label=$('member-label');
    if(Number(result.uid||0)!==historyAccountUid){historyAccountUid=Number(result.uid)||0;remoteHistory=[];remoteHistoryTotal=0;historyFetchedAt=0;updateContinueButton();}
    if(result.loggedIn)label.textContent=(result.name?result.name+' · ':'')+(result.member?'会员':'已登录');
    else label.textContent=result.unknown?'官网状态不可读':'登录 / 会员';
    $('member-login').setAttribute('aria-label',result.loggedIn?(result.member?'已登录，会员':'已登录'):'登录 / 会员');
    document.querySelectorAll('.episode small').forEach(function(el){el.textContent=result.member?'自制播放器 · 会员已验证':'自制播放器 · 账号权限待验证';});
    if(result.loggedIn)refreshWatchHistory();
    else if(remoteHistory.length){remoteHistory=[];remoteHistoryTotal=0;historyFetchedAt=0;updateContinueButton();}
    return result;
  }
  function renderHistoryPage(rows){
    $('cards').replaceChildren();$('catalog-status').hidden=true;$('result-count').textContent=(remoteHistoryTotal||rows.length)+' 条 · '+(remoteHistoryTotal?'会员与本机':'本机')+'记录';
    rows.forEach(function(saved){
      var card=button('',function(){resumeHistory(saved,card);},'card history-grid-card');card.dataset.historyEpisode=saved.episodeKey;card.setAttribute('aria-label',saved.title+' '+saved.episodeName+' '+(saved.completed?'已看完':'继续观看'));
      var poster=node('div',undefined,'poster');var placeholder=node('span','暂无海报','poster-placeholder');poster.append(placeholder);if(saved.image){var img=photo(saved.image,saved.title);img.addEventListener('error',function(){placeholder.hidden=false;},{once:true});poster.append(img);placeholder.hidden=true;}poster.append(node('span',saved.completed?'已看完':timeLabel(Number(saved.time))+(saved.duration?' / '+timeLabel(Number(saved.duration)):'') ,'update'));
      card.append(poster,node('h3',saved.title),node('p',(saved.episodeName||'正片')+' · '+(saved.completed?'重新播放':'继续观看')));$('cards').append(card);
    });
    if(!rows.length)$('cards').append(node('p','还没有观看记录。播放过的影片会显示在这里。','empty'));
    updatePages(rows.length);
  }
  async function loadHistoryPage(page,focusFirst){
    state.page=page;var token=++state.request;
    $('cards').replaceChildren();$('catalog-status').hidden=false;$('catalog-status').textContent='正在加载观看历史…';$('catalog-error').hidden=true;
    try{
      var rows;
      if(page===1){if(historyPromise)await historyPromise;rows=combinedHistory(0);}
      else{var result=await api.watchHistory(page);remoteHistoryTotal=result.total;var localKeys=new Set(localWatchHistory().map(function(x){return x.itemKey+'\n'+x.episodeKey;}));rows=result.items.filter(function(x){return !localKeys.has(x.itemKey+'\n'+x.episodeKey);});}
      if(token!==state.request)return;renderHistoryPage(rows);if(focusFirst!==false)focus($('cards').querySelector('button')||document.querySelector('[data-category="观看历史"]'));else{if(document.activeElement===document.body||!document.activeElement.getClientRects().length)focus(!$('next-page').hidden?$('next-page'):$('previous-page'));$('main').scrollTop=0;}
    }catch(error){if(token===state.request)catalogError(error.message);}
  }
  function localWatchHistory() {
    try { var value=JSON.parse(localStorage.getItem(watchStorageKey)||'[]');return Array.isArray(value)?value.filter(function(x){return x&&typeof x.itemKey==='string'&&typeof x.episodeKey==='string'&&Number(x.time)>0;}):[]; }
    catch (_) { return []; }
  }
  function combinedHistory(limit){
    var byEpisode={};
    remoteHistory.concat(localWatchHistory()).forEach(function(entry){
      var key=entry.itemKey+'\n'+entry.episodeKey,previous=byEpisode[key];
      if(!previous||Number(entry.updatedAt)>Number(previous.updatedAt))byEpisode[key]=entry;
    });
    var rows=Object.keys(byEpisode).map(function(key){return byEpisode[key];}).sort(function(a,b){return Number(b.updatedAt)-Number(a.updatedAt);});
    return limit===0?rows:rows.slice(0,20);
  }
  function refreshWatchHistory(){
    if(typeof api.watchHistory!=='function'||historyPromise||Date.now()-historyFetchedAt<60000)return historyPromise;
    historyFetchedAt=Date.now();
    historyPromise=api.watchHistory(1).then(function(result){remoteHistory=result.items;remoteHistoryTotal=result.total;updateContinueButton();if(state.category==='观看历史'&&state.page===1)renderHistoryPage(combinedHistory(0));}).catch(function(){/* Keep the local list when the remote service is unavailable. */}).finally(function(){historyPromise=null;});
    return historyPromise;
  }
  function resumeHistory(saved,origin){state.resumeRequest=Object.assign({},saved,{time:saved.completed?0:Number(saved.time)||0});openDetail(saved.itemKey,origin);}
  function updateContinueButton() {
    var list=combinedHistory(),last=list.find(function(x){return !x.completed;});
    $('continue-watching').hidden=!last;
    if(last)$('continue-watching').textContent='继续观看 · '+last.title+' · '+last.episodeName;
    $('watch-history-source').textContent=remoteHistory.length?'本机与会员历史 · 选择影片继续观看':'本机记录 · 选择影片继续观看';
    $('history-cards').replaceChildren();$('history-empty').hidden=!!list.length;
    list.slice(0,20).forEach(function(saved){
      var el=button('',function(){resumeHistory(saved,el);},'history-card');el.dataset.historyEpisode=saved.episodeKey;
      if(saved.image)el.append(photo(saved.image,saved.title,'history-poster'));
      var copy=node('span',undefined,'history-copy');copy.append(node('strong',saved.title||'影片'),node('span',saved.episodeName||'正片'),node('small',saved.completed?'已看完 · 重新播放':timeLabel(Number(saved.time))+(saved.duration?' / '+timeLabel(saved.duration):'')+' · 继续观看'));
      el.append(copy);$('history-cards').append(el);
    });
  }
  function saveLocalProgress(force) {
    if(state.mode!=='player'||player.switchingEngine||!state.item||!player.episode||!currentSegment()||currentSegment().isAd)return;
    var video=$('video'),time=Number(video.currentTime)||0,duration=Number(video.duration)||0;
    if(time<1||(!force&&Math.abs(time-player.lastSaved)<10))return;
    player.lastSaved=time;
    var list=localWatchHistory().filter(function(x){return !(x.itemKey===state.item.key&&x.episodeKey===player.episode.key);});
    list.push({itemKey:state.item.key,episodeKey:player.episode.key,title:state.item.title,episodeName:player.episode.name||'',image:state.item.image||'',time:time,duration:duration,completed:duration>0&&time/duration>=0.95,updatedAt:Date.now()});
    list.sort(function(a,b){return Number(b.updatedAt)-Number(a.updatedAt);});
    try{localStorage.setItem(watchStorageKey,JSON.stringify(list.slice(0,20)));}catch(_){}
  }
  function catalogError(message){$('catalog-status').hidden=true;$('catalog-error').hidden=false;$('catalog-error').querySelector('p').textContent=message;}
  async function performSearch(term,page) {
    term=term.trim();if(!term){toast('请先输入片名');return;}
    state.term=term;state.page=page;var token=++state.request;
    $('cards').replaceChildren();$('catalog-error').hidden=true;$('catalog-status').hidden=false;$('catalog-status').textContent='正在搜索「'+term+'」…';updatePages(0);
    try{
      var result=await api.search(term,page);if(token!==state.request)return;
      state.items=result.items;$('catalog-status').hidden=true;renderCards(result.items);$('result-count').textContent='找到 '+result.count+' 部';updatePages(result.count);
      focus($('cards').querySelector('button')||$('search-input'));
    }catch(error){if(token===state.request)catalogError(error.message);}
  }
  async function openDetail(key,origin) {
    var token=++state.request;state.returnFocus=origin||document.activeElement;state.mode='detail';state.item=null;state.episodes=[];
    $('catalog-view').hidden=true;$('detail-view').hidden=false;$('detail-view').replaceChildren();$('main').scrollTop=0;
    var back=button('← 返回选片',backToCatalog);$('detail-view').append(back,node('p','正在获取影片与剧集…','status'));focus(back);
    try{
      var item=await api.detail(key);if(token!==state.request)return;
      state.item=item;renderDetail(item,back);
      await loadEpisodes(item,key,token);
    }catch(error){if(token===state.request){$('detail-view').replaceChildren(back,node('p',error.message,'error-box'),button('在原站打开 ↗',function(){original(key);}));}}
  }
  function renderDetail(item,back) {
    var restoreBack=document.activeElement===back;
    $('detail-view').replaceChildren(back);
    var top=node('div',undefined,'detail-top');top.append(photo(item.image,item.title,'detail-poster'));
    var copy=node('div',undefined,'detail-copy');copy.append(node('span',item.category||'影片详情','eyebrow'),node('h1',item.title),node('p',meta(item)+(item.rating?' · '+item.rating+' 分':''),'meta'),node('p',item.summary,'summary'),node('p','导演：'+(item.directors||'暂无')+'\n主演：'+(item.actors||'暂无'),'credits'));
    var actions=node('div',undefined,'detail-actions');var start=button('官网播放第一集',function(){if(state.episodes[0])original(item.key,state.episodes[0].key);},'primary');start.id='start-first';start.disabled=true;
    var guest=button('自制播放器播放第一集',function(){if(state.episodes[0])startPlayback(state.episodes[0]);});guest.id='guest-first';guest.disabled=true;
    actions.append(guest,start,button('查看评论',focusComments),button('查看原站详情 ↗',function(){original(item.key);}));copy.append(actions);top.append(copy);$('detail-view').append(top);
    var langs=node('div',undefined,'language-buttons');
    var options=[{title:item.language||'默认语言',link:item.key}].concat(item.raw.languageList||[]);
    options.forEach(function(lang){var b=button(lang.title,function(){var token=++state.request;langs.querySelectorAll('button').forEach(function(x){x.classList.remove('selected');});b.classList.add('selected');loadEpisodes(item,lang.link,token);});if(lang.link===item.key)b.classList.add('selected');langs.append(b);});
    $('detail-view').append(langs,node('h2','选集'),node('p','官网登录与自制播放器登录票据相互独立。使用侧栏官方登录后，自制播放器会按官网返回的账号权限申请画质和片源；账号未验证时，请用官网播放器获得完整会员权益。','episode-note'));
    var status=node('p','正在获取剧集…','status');status.id='episode-status';var episodes=node('div',undefined,'episodes');episodes.id='episodes';$('detail-view').append(status,episodes);
    var comments=node('section',undefined,'comments-section');comments.id='comments-section';var heading=node('h2','评论');heading.id='comments-heading';heading.tabIndex=0;var note=node('p','正在加载官网评论…','status');note.id='comments-status';var list=node('div',undefined,'comments-list');list.id='comments-list';var pager=node('div',undefined,'comment-pagination');pager.id='comment-pagination';comments.append(heading,note,list,pager);$('detail-view').append(comments);loadComments(item,1);
    if(restoreBack)focus(back);
  }
  function scrollCommentsIntoView(){var section=$('comments-section'),main=$('main');if(!section)return;main.scrollTop+=section.getBoundingClientRect().top-main.getBoundingClientRect().top-24;}
  function focusComments(){focus($('comments-heading'));scrollCommentsIntoView();}
  async function loadComments(item,page){
    var token=++commentRequest;if(!$('comments-status'))return;
    $('comments-status').hidden=false;$('comments-status').textContent='正在加载官网评论…';$('comments-list').replaceChildren();$('comment-pagination').replaceChildren();
    try{
      var result=await api.comments(item,page);if(token!==commentRequest||state.mode==='catalog'||!state.item||state.item.key!==item.key)return;
      $('comments-status').hidden=!!(result.items.length||result.hot.length);$('comments-status').textContent='暂无评论';
      function addComment(entry,hot){var article=node('article',undefined,'comment-card');article.tabIndex=0;var top=node('div',undefined,'comment-byline');top.append(node('strong',entry.author),node('span',(entry.date||'')+(entry.likes?' · '+entry.likes+' 赞':'')+(hot?' · 热门':'')));article.append(top,node('p',entry.text));entry.children.forEach(function(reply){article.append(node('p',(reply.author||'用户')+'：'+reply.text,'comment-reply'));});if(entry.replies>entry.children.length)article.append(node('small','还有 '+(entry.replies-entry.children.length)+' 条回复，请在官网查看。'));$('comments-list').append(article);}
      if(page===1)result.hot.forEach(function(entry){addComment(entry,true);});result.items.forEach(function(entry){addComment(entry,false);});
      var pager=$('comment-pagination');if(page>1)pager.append(button('上一页',function(){loadComments(item,page-1);},'secondary'));pager.append(node('span','第 '+page+' 页 · 共 '+result.total+' 条'));if(page*10<result.total)pager.append(button('下一页',function(){loadComments(item,page+1);},'secondary'));if(document.activeElement===$('comments-heading'))scrollCommentsIntoView();
    }catch(error){if(token===commentRequest&&$('comments-status')){$('comments-status').hidden=false;$('comments-status').textContent='评论加载失败：'+error.message;$('comment-pagination').append(button('重试',function(){loadComments(item,page);},'secondary'));}}
  }
  async function loadEpisodes(item,key,token) {
    $('episode-status').hidden=false;$('episode-status').textContent='正在获取剧集…';$('episodes').replaceChildren();state.episodes=[];$('start-first').disabled=true;$('guest-first').disabled=true;
    try{
      var episodes=await api.episodes(item,key);if(token!==state.request)return;
      state.episodes=episodes;$('episode-status').hidden=episodes.length>0;$('episode-status').textContent='暂无可用剧集，请在原站查看。';
      $('start-first').disabled=!episodes.length;$('guest-first').disabled=!episodes.length;$('start-first').textContent=episodes.length===1?'官网播放器播放':'官网播放器播放第一集';
      episodes.forEach(function(ep){var el=button(ep.name||'播放',function(){startPlayback(ep);},'episode');el.dataset.episode=ep.key;el.append(node('small',state.account&&state.account.member?'自制播放器 · 会员已验证':'自制播放器 · 账号权限待验证'));$('episodes').append(el);});
      if(state.resumeRequest&&state.resumeRequest.itemKey===item.key){var saved=state.resumeRequest;state.resumeRequest=null;var resumeEpisode=episodes.find(function(ep){return ep.key===saved.episodeKey;});if(resumeEpisode)startPlayback(resumeEpisode,saved.time);}
    }catch(error){if(token===state.request)$('episode-status').textContent=error.message;}
  }
  function backToCatalog() {state.request++;showCatalog();focus(state.returnFocus||$('hero-open'));}
  function currentSegment(){return player.sequence[player.index];}
  function timeLabel(t){if(!Number.isFinite(t)||t<0)return'00:00';t=Math.floor(t);var h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=t%60;return(h?h+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');}
  function saveDanmuSettings(){try{localStorage.setItem(danmuStorageKey,JSON.stringify(danmuSettings));}catch(_){}updateDanmuButtons();}
  function updateDanmuButtons(){$('player-danmu-toggle').textContent='弹幕 '+(danmuSettings.enabled?'开':'关');$('player-danmu-size').textContent='字号 '+danmuSettings.size;$('danmu-layer').hidden=!danmuSettings.enabled;}
  function resetDanmuTimeline(){player.danmuCursor=0;player.danmuLast=-1;player.danmuLane=0;$('danmu-layer').replaceChildren();}
  function toggleDanmu(){danmuSettings.enabled=!danmuSettings.enabled;saveDanmuSettings();resetDanmuTimeline();showControls();}
  function changeDanmuSize(size){if(![18,22,26,30].includes(Number(size)))return;danmuSettings.size=Number(size);saveDanmuSettings();$('danmu-layer').style.fontSize=danmuSettings.size+'px';showControls();}
  function loadDanmu(uniqueKey){
    if(!uniqueKey||(uniqueKey===player.danmuKey&&player.danmuToken===player.token))return;
    var token=player.token;player.danmuKey=uniqueKey;player.danmuToken=token;player.danmu=[];resetDanmuTimeline();
    api.danmu(uniqueKey).then(function(rows){if(token!==player.token||state.mode!=='player'||player.danmuKey!==uniqueKey)return;player.danmu=rows;resetDanmuTimeline();}).catch(function(){if(token===player.token)player.danmu=[];});
  }
  function updateDanmu(){
    if(!danmuSettings.enabled||state.mode!=='player'||!player.danmu||!player.danmu.length||!currentSegment()||currentSegment().isAd||$('video').paused)return;
    var t=Number($('video').currentTime)||0,rows=player.danmu;
    if(player.danmuLast<0||t<player.danmuLast||t-player.danmuLast>5){$('danmu-layer').replaceChildren();var lo=0,hi=rows.length;while(lo<hi){var mid=(lo+hi)>>1;if(rows[mid].second<t-.5)lo=mid+1;else hi=mid;}player.danmuCursor=lo;}
    var added=0;while(player.danmuCursor<rows.length&&rows[player.danmuCursor].second<=t&&added<12){var entry=rows[player.danmuCursor++];if(entry.second<t-1)continue;var el=node('span',entry.text,'danmu-item');var lane=player.danmuLane++%7;el.style.top=(10+lane*54)+'px';el.style.fontSize=danmuSettings.size+'px';if(entry.color>0&&entry.color<=0xffffff)el.style.color='#'+entry.color.toString(16).padStart(6,'0');if(entry.position===1||entry.position===2){el.classList.add(entry.position===1?'danmu-top':'danmu-bottom');if(entry.position===2){el.style.top='auto';el.style.bottom=(10+lane*45)+'px';}}el.addEventListener('animationend',function(){this.remove();},{once:true});$('danmu-layer').append(el);added++;}
    player.danmuLast=t;
  }
  function setPlayerStatus(text,loading){player.loading=!!loading;$('player-message').textContent=text||'';$('player-status').hidden=!text;$('player-spinner').hidden=!loading;$('player-view').setAttribute('aria-busy',String(!!loading));if(loading)showControls();}
  function updateTimeline(time){var v=$('video'),duration=Number.isFinite(v.duration)?v.duration:0;time=Number.isFinite(time)?time:v.currentTime||0;var percent=duration?Math.max(0,Math.min(100,time/duration*100)):0;$('progress').style.width=percent+'%';$('seek-marker').style.left=percent+'%';$('play-time').textContent=timeLabel(time)+' / '+timeLabel(duration);$('player-timeline').setAttribute('aria-valuemax',String(Math.floor(duration)));$('player-timeline').setAttribute('aria-valuenow',String(Math.floor(time)));$('player-timeline').setAttribute('aria-valuetext',timeLabel(time)+' / '+timeLabel(duration));}
  function destroyMedia(){player.playRequest=(player.playRequest||0)+1;finishScrub(false,false);player.switchingEngine=true;player.onMediaError=null;player.levelChoices=[];var oldHls=player.hls;player.hls=null;if(oldHls)oldHls.destroy();$('video').pause();$('video').removeAttribute('src');$('video').load();player.switchingEngine=false;}
  function showControls(){clearTimeout(player.timer);$('player-overlay').style.opacity='1';if(state.mode==='player'&&!$('video').paused&&!player.failed&&!player.loading&&!player.menu&&!player.scrub)player.timer=setTimeout(function(){if(state.mode==='player'&&$('modal-layer').hidden&&!player.menu&&!player.scrub&&!player.loading){focus($('player-timeline'));$('player-overlay').style.opacity='0';}},6000);}
  function closePlayerMenu(restore){var menu=player.menu;player.menu=null;$('player-menu').hidden=true;['player-quality','player-speed','player-danmu-size'].forEach(function(id){$(id).setAttribute('aria-expanded','false');});if(menu&&restore!==false)focus($(menu==='quality'?'player-quality':menu==='speed'?'player-speed':'player-danmu-size'));if(state.mode==='player')showControls();}
  function openPlayerMenu(kind){
    if(state.mode!=='player')return;
    if(kind==='quality'&&currentSegment()&&currentSegment().isAd){toast('片前内容结束后可切换画质');return;}
    finishScrub(true);player.menu=kind;showControls();
    var quality=kind==='quality',danmuSize=kind==='danmu-size',selected=quality?player.quality:danmuSize?danmuSettings.size:player.speed;
    var available=(player.levelChoices||[]).map(function(x){return x.quality;}).filter(function(q,i,a){return a.indexOf(q)===i;}).sort(function(a,b){return b-a;});var values=quality?(available.length?available:[2160,1080,720,576]):danmuSize?[18,22,26,30]:[0.5,0.75,1,1.25,1.5];if(!quality&&!danmuSize&&state.account&&state.account.member)values.push(2);if(!quality&&!danmuSize&&tvApp)values=[1];
    $('player-menu-title').textContent=quality?'选择画质':danmuSize?'弹幕字体大小':'播放速度';$('player-menu-note').textContent=quality?'画质由片源及账号权益决定':danmuSize?'上下选择字号 · 确认应用 · 返回关闭':tvApp?'当前电视应用的播放器暂不支持倍速，保持正常速度。':'上下选择 · 确认应用 · 返回关闭';$('player-menu-options').replaceChildren();
    values.forEach(function(value){var label=quality?value+'P'+(value===2160?' · 4K':''):danmuSize?value+' 像素':value+'×'+(value===1?' · 正常':'');var el=button(label+(value===selected?' · 当前':''),function(){closePlayerMenu();if(quality)changeQuality(value);else if(danmuSize)changeDanmuSize(value);else changeSpeed(value);},'player-option');el.dataset.value=value;el.setAttribute('role','menuitemradio');el.setAttribute('aria-checked',String(value===selected));$('player-menu-options').append(el);});
    var trigger=$(quality?'player-quality':danmuSize?'player-danmu-size':'player-speed'),rect=trigger.getBoundingClientRect(),view=$('player-view').getBoundingClientRect();$('player-menu').style.right=Math.max(24,view.right-rect.right)+'px';$('player-menu').style.top=Math.max(90,rect.bottom-view.top+16)+'px';$('player-menu').hidden=false;trigger.setAttribute('aria-expanded','true');focus($('player-menu-options').querySelector('[aria-checked="true"]')||$('player-menu-options').firstElementChild);
  }
  function failPlayback(message){finishScrub(false,false);closePlayerMenu(false);player.failed=true;$('video').pause();setPlayerStatus(message,false);$('play-toggle').disabled=true;$('seek-back').disabled=true;$('seek-forward').disabled=true;$('player-fallback').hidden=false;showControls();focus($('player-fallback'));}
  async function startPlayback(episode,resumeAt) {
    closePlayerMenu(false);finishScrub(false,false);var token=++player.token;state.mode='player';player.episode=episode;player.sequence=[];player.index=0;player.failed=false;player.keepPaused=false;player.danmu=[];player.danmuKey='';resetDanmuTimeline();updateDanmuButtons();$('danmu-layer').style.fontSize=danmuSettings.size+'px';player.timing={started:Date.now(),apiMs:null,playingMs:null,metadataMs:null};
    player.quality=720;player.resumeAt=Number(resumeAt)||0;player.speed=1;player.lastSaved=0;$('video').playbackRate=1;$('player-speed').textContent='速度 1×';
    $('player-view').hidden=false;$('player-fallback').hidden=true;setPlayerStatus('正在连接播放服务…',true);$('player-title').textContent=state.item.title+' · '+(episode.name||'');$('player-quality').textContent='画质 '+player.quality+'P';$('play-toggle').disabled=true;$('seek-back').disabled=true;$('seek-forward').disabled=true;updateTimeline(0);showControls();focus($('player-timeline'));
    try{var result=await api.media(episode,player.quality);if(token!==player.token||state.mode!=='player')return;player.timing.apiMs=Date.now()-player.timing.started;player.sequence=result.sequence;loadDanmu(result.data&&result.data.uniqueKey);playSegment();}
    catch(error){if(token===player.token&&state.mode==='player')failPlayback(error.message);}
  }
  function qualityOfLevel(level){var name=Number(level.name);return Number.isFinite(name)&&name>0?name:Number(level.height)||0;}
  function playSegment() {
    destroyMedia();resetDanmuTimeline();var segment=currentSegment();if(!segment){exitPlayer();toast('本集播放结束');return;}
    var video=$('video'),token=player.token,index=player.index,stayPaused=player.keepPaused&&!segment.isAd;if(!segment.isAd)player.keepPaused=false;
    var resume=segment.isAd?0:player.resumeAt;if(!segment.isAd)player.resumeAt=0;
    player.failed=false;player.pendingQuality=null;player.engine='';$('player-fallback').hidden=true;setPlayerStatus('正在缓冲…',true);$('player-quality').textContent='画质 '+player.quality+'P'+(segment.isAd?' · 片前内容':'');video.playbackRate=segment.isAd?1:player.speed;video.preload='auto';
    $('play-toggle').disabled=false;$('seek-back').disabled=segment.isAd;$('seek-forward').disabled=segment.isAd;$('play-toggle').textContent=stayPaused?'播放':'暂停';
    var valid=function(){return state.mode==='player'&&token===player.token&&index===player.index;};
    var begin=function(){if(valid()&&!player.failed&&!stayPaused)requestPlay();};
    function setNativeSource(){
      player.engine='native';
      video.addEventListener('loadedmetadata',function(){if(!valid()||player.engine!=='native')return;video.playbackRate=segment.isAd?1:player.speed;if(resume>0&&Number.isFinite(video.duration))video.currentTime=Math.min(resume,Math.max(0,video.duration-1));},{once:true});
      video.src=segment.url;begin();
    }
    function fallbackNative(){
      if(!valid()||player.engine!=='hls.js')return;
      if(!video.canPlayType('application/vnd.apple.mpegurl')){failPlayback('此视频暂时无法播放，请重试或使用官网播放器');return;}
      if(video.currentTime>0)resume=video.currentTime;if(video.readyState>0)stayPaused=video.paused;
      player.switchingEngine=true;player.onMediaError=null;var previous=player.hls;player.hls=null;if(previous)previous.destroy();player.levelChoices=[];video.pause();video.removeAttribute('src');video.load();player.switchingEngine=false;
      setPlayerStatus('正在尝试兼容播放…',true);setNativeSource();
    }
    video.addEventListener('loadedmetadata',function(){if(!valid())return;video.playbackRate=segment.isAd?1:player.speed;if(player.timing&&player.timing.metadataMs===null)player.timing.metadataMs=Date.now()-player.timing.started;},{once:true});
    if(segment.isHls&&window.Hls&&Hls.isSupported()){
      player.engine='hls.js';player.onMediaError=fallbackNative;
      try{
        var hls=new Hls({enableWorker:true,autoStartLoad:false,startPosition:resume,maxBufferLength:30,backBufferLength:30});player.hls=hls;
        hls.on(Hls.Events.MANIFEST_PARSED,function(_,data){
          if(!valid()||player.hls!==hls)return;
          player.levelChoices=data.levels.map(function(level,i){return{quality:qualityOfLevel(level),index:i};}).filter(function(x){return x.quality>0;});
          var choices=player.levelChoices.slice().sort(function(a,b){return b.quality-a.quality;});var choice=choices.find(function(x){return x.quality===player.quality;})||choices.find(function(x){return x.quality<=player.quality;})||choices[choices.length-1];
          if(choice){if(!segment.isAd)player.quality=choice.quality;hls.startLevel=choice.index;hls.loadLevel=choice.index;$('player-quality').textContent='画质 '+player.quality+'P'+(segment.isAd?' · 片前内容':'');}
          hls.startLoad(resume);begin();
        });
        hls.on(Hls.Events.LEVEL_SWITCHED,function(_,data){if(!valid()||player.hls!==hls||segment.isAd)return;var level=hls.levels[data.level],quality=level&&qualityOfLevel(level);if(quality&&(!player.pendingQuality||quality===player.pendingQuality)){player.quality=quality;player.pendingQuality=null;$('player-quality').textContent='画质 '+quality+'P';}});
        hls.on(Hls.Events.ERROR,function(_,data){if(valid()&&player.hls===hls&&data.fatal)fallbackNative();});
        hls.on(Hls.Events.MEDIA_ATTACHED,function(){if(valid()&&player.hls===hls)hls.loadSource(segment.url);});hls.attachMedia(video);
      }catch(_){fallbackNative();}
    }else if(segment.isHls&&!video.canPlayType('application/vnd.apple.mpegurl')){failPlayback('此设备暂不支持该视频格式，请在原站播放');return;}
    else setNativeSource();
    focus($('player-timeline'));showControls();
  }
  async function changeQuality(value) {
    if(!player.episode||state.mode!=='player'||value===player.quality)return;
    var existing=(player.levelChoices||[]).find(function(x){return x.quality===value;});
    if(player.hls&&existing&&!player.failed){player.quality=value;player.pendingQuality=value;$('player-quality').textContent='画质 '+value+'P · 切换中';player.hls.nextLevel=existing.index;showControls();return;}
    var old=player.quality;player.quality=value;player.keepPaused=$('video').paused;
    var token=++player.token;player.resumeAt=$('video').currentTime||0;destroyMedia();player.index=0;player.failed=false;
    $('player-fallback').hidden=true;$('player-quality').textContent='正在切换画质…';setPlayerStatus('正在切换到 '+value+'P…',true);$('play-toggle').disabled=true;$('seek-back').disabled=true;$('seek-forward').disabled=true;
    try{var result=await api.media(player.episode,value);if(token!==player.token||state.mode!=='player')return;player.sequence=result.sequence;loadDanmu(result.data&&result.data.uniqueKey);playSegment();}
    catch(error){if(token===player.token&&state.mode==='player'){player.quality=old;$('player-quality').textContent='画质 '+old+'P';failPlayback(error.message+'；可重新选择画质或使用官网播放器');}}
  }
  function changeSpeed(value){if(tvApp&&value!==1){toast('当前电视播放器暂不支持倍速');return;}player.speed=value;$('video').playbackRate=currentSegment()&&currentSegment().isAd?1:value;$('player-speed').textContent='速度 '+value+'×';showControls();}
  function canSeek(){var v=$('video'),segment=currentSegment();return state.mode==='player'&&segment&&!segment.isAd&&!player.failed&&!$('play-toggle').disabled&&Number.isFinite(v.duration)&&v.duration>0;}
  function previewScrub(step){var s=player.scrub;if(!s)return;s.target=Math.max(0,Math.min(Math.max(0,$('video').duration-1),s.target+step));$('seek-target').textContent=(s.direction>0?'快进  ':'快退  ')+timeLabel(s.target)+' / '+timeLabel($('video').duration);updateTimeline(s.target);}
  function requestPlay(){
    var token=player.token,index=player.index,id=player.playRequest=(player.playRequest||0)+1;
    var promise=$('video').play();if(!promise||!promise.catch)return;
    promise.catch(function(error){
      if(state.mode!=='player'||token!==player.token||index!==player.index||id!==player.playRequest||player.scrub||player.failed)return;
      if(error&&error.name==='AbortError')return;
      if(error&&error.name==='NotAllowedError'){setPlayerStatus('按确认键开始播放',false);$('play-toggle').textContent='播放';showControls();return;}
      failPlayback('无法继续播放，请重试');
    });
  }
  function startScrub(direction){
    if(!canSeek())return;
    var s=player.scrub;
    if(s){s.direction=direction;if(!s.released)return;clearTimeout(s.commitTimer);s.released=false;s.started=Date.now();previewScrub(direction*10);}
    else{var v=$('video');player.playRequest=(player.playRequest||0)+1;player.scrub={direction:direction,target:v.currentTime||0,started:Date.now(),wasPlaying:!v.paused,timer:null,commitTimer:null,released:false};v.pause();setPlayerStatus('',false);$('seek-preview').hidden=false;$('seek-marker').hidden=false;focus($('player-timeline'));showControls();previewScrub(direction*10);}
    function tick(){var current=player.scrub;if(!current||current.released)return;var held=Date.now()-current.started;previewScrub(current.direction*(held>=4000?60:held>=1500?30:10));current.timer=setTimeout(tick,150);}
    player.scrub.timer=setTimeout(tick,450);
  }
  function releaseScrub(){var s=player.scrub;if(!s)return;clearTimeout(s.timer);clearTimeout(s.commitTimer);s.released=true;s.commitTimer=setTimeout(function(){if(player.scrub===s)finishScrub(true);},240);}
  function finishScrub(commit,resume){var s=player.scrub;if(!s)return;clearTimeout(s.timer);clearTimeout(s.commitTimer);player.scrub=null;$('seek-preview').hidden=true;$('seek-marker').hidden=true;var v=$('video');if(commit&&Math.abs(v.currentTime-s.target)>.1){setPlayerStatus('正在定位…',true);v.currentTime=s.target;}updateTimeline();if(resume!==false&&s.wasPlaying)requestPlay();showControls();}
  function exitPlayer(){saveLocalProgress(true);finishScrub(false,false);closePlayerMenu(false);player.token++;clearTimeout(player.timer);state.mode='detail';destroyMedia();player.sequence=[];player.danmu=[];player.danmuKey='';resetDanmuTimeline();setPlayerStatus('',false);$('player-view').hidden=true;$('player-fallback').hidden=true;var ep=player.episode;var target=Array.from(document.querySelectorAll('[data-episode]')).find(function(el){return ep&&el.dataset.episode===ep.key;});focus(target||$('start-first'));}
  function togglePlay(){if(player.failed||!currentSegment())return;var video=$('video');if(video.paused)requestPlay();else{player.playRequest=(player.playRequest||0)+1;video.pause();}showControls();}
  function seek(seconds){if(!canSeek())return;var video=$('video'),target=Math.max(0,Math.min(video.duration-1,video.currentTime+seconds));if(Math.abs(video.currentTime-target)>.1){setPlayerStatus('正在定位…',true);video.currentTime=target;}updateTimeline();showControls();}
  function back(){if(player.menu){closePlayerMenu();return;}if(player.scrub){finishScrub(false);return;}if(!$('login-view').hidden){closeMemberLogin();return;}if(!$('modal-layer').hidden){closeModal();return;}if(state.mode==='player'){exitPlayer();return;}if(state.mode==='detail'){backToCatalog();return;}if(state.category!=='推荐'){setCategory('推荐');focus(document.querySelector('[data-category="推荐"]'));return;}openModal('退出电视界面？','也可以继续选片。',[{label:'继续选片',run:function(){}},{label:'退出',run:function(){if(window.PalmSystem&&PalmSystem.platformBack)PalmSystem.platformBack();else window.close();}}]);}
  // Keep one history entry under the app so webOS Back becomes a popstate event
  // for our SPA. Navigating to iyf.tv adds a document entry above it; Back there
  // returns to this same app instance and keeps the site's session in its webview.
  var appHistoryState={iyftv:true};
  if(!window.history.state||window.history.state.iyftv!==true)window.history.pushState(appHistoryState,'',window.location.href);
  window.addEventListener('popstate',function(){back();window.history.pushState(appHistoryState,'',window.location.href);});
  function candidates(){var container=!$('login-view').hidden?$('login-view'):!$('modal-layer').hidden?$('modal-layer'):player.menu?$('player-menu'):state.mode==='player'?$('player-view'):document.body;return Array.from(container.querySelectorAll('button:not(:disabled), input, a[href], iframe, [tabindex="0"]')).filter(function(el){return el.getClientRects().length>0&&el.tabIndex>=0;});}
  function spatialMove(key) {
    var all=candidates(),current=document.activeElement;
    if(!all.includes(current)){focus(all[0]);return;}
    var a=current.getBoundingClientRect(),horizontal=key==='ArrowLeft'||key==='ArrowRight',positive=key==='ArrowRight'||key==='ArrowDown';
    var best=null,bestScore=Infinity;
    all.forEach(function(el){if(el===current)return;var b=el.getBoundingClientRect();var primary=horizontal?(b.left+b.width/2)-(a.left+a.width/2):(b.top+b.height/2)-(a.top+a.height/2);if((positive?primary:-primary)<2)return;var cross=horizontal?Math.abs((b.top+b.height/2)-(a.top+a.height/2)):Math.abs((b.left+b.width/2)-(a.left+a.width/2));var overlap=horizontal?Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top):Math.min(a.right,b.right)-Math.max(a.left,b.left);var score=Math.abs(primary)+cross*2+(overlap<=0?1000:0);if(score<bestScore){bestScore=score;best=el;}});focus(best);
  }
  function navIcon(name){var wrap=node('span',undefined,'nav-icon');wrap.setAttribute('aria-hidden','true');var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('focusable','false');if(name==='search'){var circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','10.8');circle.setAttribute('cy','10.8');circle.setAttribute('r','6.6');var path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','m16 16 4.5 4.5');svg.append(circle,path);}else if(name==='history'){var face=document.createElementNS('http://www.w3.org/2000/svg','circle');face.setAttribute('cx','12');face.setAttribute('cy','12');face.setAttribute('r','9');var hands=document.createElementNS('http://www.w3.org/2000/svg','path');hands.setAttribute('d','M12 6v6l4 2');svg.append(face,hands);}wrap.append(svg);return wrap;}
  categories.forEach(function(pair){var b=button('',function(){setCategory(pair[0]);},'nav-button'+(pair[0]==='推荐'?' active':''));b.dataset.category=pair[0];b.append(pair[0]==='搜索'?navIcon('search'):pair[0]==='观看历史'?navIcon('history'):node('span',pair[1]),node('span',pair[0]));$('navigation').append(b);});
  $('hero-open').addEventListener('click',function(){if(state.selectedKey)openDetail(state.selectedKey,$('hero-open'));});
  $('continue-watching').addEventListener('click',function(){var last=combinedHistory().find(function(x){return !x.completed;});if(last)resumeHistory(last,$('continue-watching'));});
  $('member-login').addEventListener('click',memberLogin);
  $('login-close').addEventListener('click',closeMemberLogin);
  $('login-qr-tab').addEventListener('click',function(){selectLoginMethod('qr');});
  $('login-account-tab').addEventListener('click',function(){selectLoginMethod('account');});
  $('qr-refresh').addEventListener('click',requestQrLogin);
  $('login-original').addEventListener('click',function(){closeMemberLogin();original();});
  $('original-home').addEventListener('click',function(){original();});
  $('help-button').addEventListener('click',function(){openModal('为遥控器准备的界面','方向键移动，确认键选择，返回键回到上一层。\n分类、类型筛选和分页从爱壹帆实时加载。\n官网登录与自制播放器登录票据相互独立；要使用自制播放器的会员权益，请在侧栏使用官方登录组件。\n画质与免广告由爱壹帆账号权限决定；倍速还取决于设备播放能力；官网播放器始终是完整权益的可靠入口。\n这是非官方个人练习版。');});
  $('search-form').addEventListener('submit',function(e){e.preventDefault();performSearch($('search-input').value,1);});
  $('retry').addEventListener('click',function(){if(state.category==='搜索')performSearch(state.term,state.page);else if(state.category==='推荐')loadCatalog();else if(state.category==='观看历史')loadHistoryPage(state.page);else loadCategory(state.category,state.page);});
  $('previous-page').addEventListener('click',function(){if(state.category==='搜索')performSearch(state.term,state.page-1);else if(state.category==='观看历史')loadHistoryPage(state.page-1,false);else loadCategory(state.category,state.page-1,false);});
  $('next-page').addEventListener('click',function(){if(state.category==='搜索')performSearch(state.term,state.page+1);else if(state.category==='观看历史')loadHistoryPage(state.page+1,false);else loadCategory(state.category,state.page+1,false);});
  $('player-back').addEventListener('click',exitPlayer);$('player-quality').addEventListener('click',function(){openPlayerMenu('quality');});$('player-speed').addEventListener('click',function(){openPlayerMenu('speed');});$('player-danmu-toggle').addEventListener('click',toggleDanmu);$('player-danmu-size').addEventListener('click',function(){openPlayerMenu('danmu-size');});$('play-toggle').addEventListener('click',togglePlay);$('seek-back').addEventListener('click',function(){seek(-10);});$('seek-forward').addEventListener('click',function(){seek(10);});
  $('player-original').addEventListener('click',function(){original(state.item.key,player.episode&&player.episode.key);});
  $('player-fallback').addEventListener('click',function(){original(state.item.key,player.episode&&player.episode.key);});
  ['player-quality','player-speed','player-danmu-size'].forEach(function(id){$(id).setAttribute('aria-haspopup','menu');$(id).setAttribute('aria-expanded','false');$(id).setAttribute('aria-controls','player-menu');});
  $('video').addEventListener('playing',function(){if(state.mode!=='player'||player.failed)return;$('player-view').classList.remove('danmu-paused');if(player.timing&&player.timing.playingMs===null)player.timing.playingMs=Date.now()-player.timing.started;setPlayerStatus('',false);$('play-toggle').textContent='暂停';showControls();});
  $('video').addEventListener('pause',function(){$('player-view').classList.add('danmu-paused');saveLocalProgress(true);$('play-toggle').textContent='播放';if(state.mode==='player')showControls();});
  $('video').addEventListener('waiting',function(){if(state.mode==='player'&&!player.failed&&!player.scrub&&$('video').getAttribute('src'))setPlayerStatus('正在缓冲…',true);});
  $('video').addEventListener('seeking',function(){resetDanmuTimeline();if(state.mode==='player'&&!player.failed&&!player.scrub)setPlayerStatus('正在定位…',true);});
  function readyAfterSeek(){if(state.mode==='player'&&!player.failed&&!player.scrub&&$('video').readyState>=3){setPlayerStatus('',false);showControls();}}
  $('video').addEventListener('seeked',readyAfterSeek);$('video').addEventListener('canplay',readyAfterSeek);
  $('video').addEventListener('timeupdate',function(){if(!player.scrub)updateTimeline();saveLocalProgress();updateDanmu();});
  $('video').addEventListener('ended',function(){if(state.mode==='player'&&!player.failed){saveLocalProgress(true);player.index++;playSegment();}});
  $('video').addEventListener('error',function(){if(state.mode!=='player'||player.switchingEngine)return;if(player.onMediaError){player.onMediaError();return;}if($('video').getAttribute('src'))failPlayback('视频无法播放，请返回重试或在原站播放');});
  $('player-view').addEventListener('mousemove',showControls);
  $('player-timeline').addEventListener('click',function(e){if(e.detail>0&&canSeek()){var rect=this.getBoundingClientRect();seek((e.clientX-rect.left)/rect.width*$('video').duration-$('video').currentTime);}});
  document.addEventListener('visibilitychange',function(){if(document.hidden&&state.mode==='player'){saveLocalProgress(true);finishScrub(false,false);$('video').pause();}});
  window.addEventListener('blur',function(){finishScrub(false,false);});
  document.addEventListener('keyup',function(e){if(player.scrub&&((e.key==='ArrowLeft'&&player.scrub.direction<0)||(e.key==='ArrowRight'&&player.scrub.direction>0))){e.preventDefault();releaseScrub();}});
  document.addEventListener('keydown',function(e){
    var key=e.key;if(key==='Escape'||e.keyCode===461||(key==='Backspace'&&document.activeElement.tagName!=='INPUT')){e.preventDefault();if(!e.repeat)back();return;}
    if(state.mode==='player'&&$('modal-layer').hidden){
      var wasHidden=$('player-overlay').style.opacity==='0';showControls();
      if(player.menu){
        if(key==='ArrowUp'||key==='ArrowDown'){e.preventDefault();var options=Array.from($('player-menu-options').querySelectorAll('button')),at=options.indexOf(document.activeElement);focus(options[(at+(key==='ArrowDown'?1:-1)+options.length)%options.length]);return;}
        if(key==='ArrowLeft'||key==='ArrowRight'||key===' '){e.preventDefault();return;}
        if(key==='Enter'&&e.repeat){e.preventDefault();return;}
      }else{
        if(key==='ArrowLeft'||key==='ArrowRight'){
          if(wasHidden||player.scrub||document.activeElement===$('player-timeline')){e.preventDefault();startScrub(key==='ArrowRight'?1:-1);return;}
        }
        if(player.scrub){e.preventDefault();if(key==='Enter')finishScrub(true);return;}
        if((key==='ArrowUp'||key==='ArrowDown')&&(wasHidden||document.activeElement===$('player-timeline'))){e.preventDefault();focus($(key==='ArrowUp'?'player-quality':'play-toggle'));return;}
        if(key==='ArrowUp'&&document.activeElement.closest('.player-controls')){e.preventDefault();focus($('player-timeline'));return;}
        if(key==='ArrowDown'&&document.activeElement.closest('.player-top')){e.preventDefault();focus($('player-timeline'));return;}
        if((key==='Enter'&&(wasHidden||document.activeElement===$('player-timeline')))||key===' '||e.keyCode===415||e.keyCode===19){e.preventDefault();if(e.repeat)return;if(e.keyCode===415){requestPlay();}else if(e.keyCode===19)$('video').pause();else togglePlay();return;}
        if(e.keyCode===413){e.preventDefault();exitPlayer();return;}
      }
    }
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key)){if(document.activeElement.tagName==='INPUT'&&(key==='ArrowLeft'||key==='ArrowRight'))return;e.preventDefault();spatialMove(key);}
    if(key==='Tab'&&(!$('modal-layer').hidden||state.mode==='player')){e.preventDefault();var list=candidates(),i=list.indexOf(document.activeElement);focus(list[(i+(e.shiftKey?-1:1)+list.length)%list.length]);}
  });
  window.IyfPlaybackDiagnostics=function(){var t=player.timing||{};return{engine:player.engine||'',apiMs:t.apiMs,metadataMs:t.metadataMs,playingMs:t.playingMs,requestedQuality:player.quality,width:$('video').videoWidth,height:$('video').videoHeight,paused:$('video').paused,readyState:$('video').readyState,playbackRate:$('video').playbackRate,speedSupported:!tvApp};};
  function clock(){$('clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});}clock();setInterval(clock,30000);
  window.addEventListener('pageshow',refreshAccount);document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshAccount();});
  updateContinueButton();focus(document.querySelector('[data-category="推荐"]'));loadCatalog();refreshAccount();
  api.revalidateSession().then(function(ok){state.officialSession=!!ok;return refreshAccount();});
})();
