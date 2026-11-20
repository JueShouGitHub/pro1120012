export const ZipRide = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>Zip Ride</title>
<style>
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#22354a;touch-action:none;
-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
canvas{display:block;touch-action:none}
#fsBtn{position:fixed;top:6px;right:6px;z-index:99;width:42px;height:30px;
background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.65);border:1px solid rgba(255,255,255,0.22);
border-radius:8px;font-size:15px;line-height:1;padding:0;touch-action:none;-webkit-tap-highlight-color:transparent}
</style>
</head>
<body>
<canvas id="cv"></canvas>
<button id="fsBtn" aria-label="Fullscreen">&#9974;</button>
<script>
(function(){
  var b=document.getElementById('fsBtn'),last=0;
  function toggle(){
    var now=Date.now();
    if(now-last<500)return;
    last=now;
    try{
      if(!document.fullscreenElement&&!document.webkitFullscreenElement){
        var el=document.documentElement;
        var fn=el.requestFullscreen||el.webkitRequestFullscreen;
        if(fn){var p=fn.call(el);if(p&&p.catch)p.catch(function(){});}
      }else{
        var ex=document.exitFullscreen||document.webkitExitFullscreen;
        if(ex)ex.call(document);
      }
      setTimeout(function(){window.dispatchEvent(new Event('resize'));},120);
    }catch(e){}
  }
  b.addEventListener('pointerdown',function(e){e.stopPropagation();toggle();});
  b.addEventListener('touchstart',function(e){e.stopPropagation();},{passive:false});
  b.addEventListener('click',function(e){e.stopPropagation();});
  document.addEventListener('fullscreenchange',function(){setTimeout(function(){window.dispatchEvent(new Event('resize'));},150);});
  window.__lw=document.documentElement.clientWidth||window.innerWidth;
  window.__lh=document.documentElement.clientHeight||window.innerHeight;
  setInterval(function(){
    var cw=document.documentElement.clientWidth,ch=document.documentElement.clientHeight;
    var cv=document.querySelector('canvas');
    var stale=cv&&(cv.clientWidth!==cw||cv.clientHeight!==ch);
    if(stale||(cw&&cw!==window.__lw)||(ch&&ch!==window.__lh)){
      window.__lw=cw||window.innerWidth;window.__lh=ch||window.innerHeight;
      try{window.dispatchEvent(new Event('resize'));}catch(e){}
    }
  },250);
  if(window.visualViewport)window.visualViewport.addEventListener('resize',function(){window.dispatchEvent(new Event('resize'));});
})();
</script>

<script>
(function(){
'use strict';
/* ===================== Zip Ride =====================
   Hold anywhere to clip onto the zipline and glide; release to
   drop. Land on the landing pad to ride the next line - fall
   short, long, or into the water and you simply wade back to the
   start of the same line, free. The dotted arc previews your drop
   using the very same integrator as the real fall, so every line
   has a readable release window. */

var cv=document.getElementById('cv'),ctx=cv.getContext('2d');
var W=390,H=844,DPR=1;
var PHASE_START='start',PHASE_PLAY='play';
var phase=PHASE_START,winT=0,clock=0;
var level=1,score=0,best=0;
var lines=[]; /* per level: N ziplines {ax,ay,bx,by} + pad {x,y,w} under B */
var li=0;     /* current line */
var hero={mode:'idle',x:0,y:0,vx:0,vy:0,t:0,acc:0};
var G=1300,SPD=190;
var msg='',msgT=0;
var splashes=[];
var lastInput=0;
var precision=false;

/* ---- sound / haptics ---- */
var AC=null;
function playSound(type){
  try{
    if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();
    if(AC.state==='suspended')AC.resume();
    var o=AC.createOscillator(),g=AC.createGain();
    o.connect(g);g.connect(AC.destination);
    var t=AC.currentTime;
    if(type==='clip'){o.frequency.setValueAtTime(500,t);o.frequency.exponentialRampToValueAtTime(700,t+0.08);g.gain.setValueAtTime(0.05,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.1);o.start(t);o.stop(t+0.11);}
    else if(type==='land'){o.frequency.setValueAtTime(420,t);o.frequency.exponentialRampToValueAtTime(620,t+0.1);g.gain.setValueAtTime(0.07,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.14);o.start(t);o.stop(t+0.15);}
    else if(type==='splash'){o.frequency.setValueAtTime(200,t);o.frequency.exponentialRampToValueAtTime(70,t+0.25);g.gain.setValueAtTime(0.07,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.27);o.start(t);o.stop(t+0.28);}
    else if(type==='fan'){o.frequency.setValueAtTime(523,t);o.frequency.setValueAtTime(659,t+0.09);o.frequency.setValueAtTime(784,t+0.18);o.frequency.setValueAtTime(1047,t+0.27);g.gain.setValueAtTime(0.09,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.5);o.start(t);o.stop(t+0.5);}
  }catch(e){}
}
function vibrate(ms){try{if(navigator.vibrate)navigator.vibrate(ms);}catch(e){}}

/* ================= shared physics (sim == real) ================= */
function stepFall(s,dt){
  s.vy+=G*dt;
  s.x+=s.vx*dt;
  s.y+=s.vy*dt;
}

/* ---- level ---- */
function genLevel(){
  var n=3;
  lines=[];
  var x=Math.round(W*0.16);
  var y=Math.round(H*0.4);
  for(var i=0;i<n;i++){
    var dx=Math.round(W*0.2+Math.random()*W*0.14);
    var dy=Math.round(40+Math.random()*90);
    var ax=x,ay=y;
    var bx=Math.min(W-80,ax+dx);
    var by=Math.min(H*0.75,ay+dy);
    var padY=by+34;
    /* land the pad where a 0.9-fraction release actually drops:
       same integrator as the real fall, so every line is catchable */
    var len2=Math.hypot(bx-ax,by-ay);
    var ux=(bx-ax)/len2,uy=(by-ay)/len2;
    var sx2=ax+ux*len2*0.9,sy2=ay+uy*len2*0.9;
    var svx=ux*SPD,svy=uy*SPD;
    var landX=sx2;
    for(var f2=0;f2<300;f2++){
      svy+=G/120;svx+=0;
      sx2+=svx/120;sy2+=svy/120;
      if(sy2>=padY)break;
    }
    landX=Math.max(64,Math.min(W-70,sx2));
    lines.push({ax:ax,ay:ay,bx:bx,by:by,
      pad:{x:Math.round(landX-55),y:padY,w:110}});
    x=bx;y=by;
  }
  li=0;
  resetHero();
  msg='LEVEL '+level;msgT=1.1;
}
function resetHero(){
  var L=lines[li];
  hero.mode='idle';
  hero.x=L.ax;hero.y=L.ay;
  hero.vx=0;hero.vy=0;hero.t=0;hero.acc=0;
}
function newGame(){level=1;score=0;genLevel();}

/* ---- riding (real input path) ---- */
function clipOn(){
  if(phase!==PHASE_PLAY||winT>0)return null;
  if(hero.mode!=='idle')return null;
  hero.mode='ride';
  hero.t=0;
  playSound('clip');
  return 'clipped';
}
function letGo(){
  if(hero.mode!=='ride')return null;
  var L=lines[li];
  var len=Math.hypot(L.bx-L.ax,L.by-L.ay);
  var travelled=hero.t*SPD;
  var ux=(L.bx-L.ax)/len,uy=(L.by-L.ay)/len;
  var px=L.ax+ux*travelled;
  var py=L.ay+uy*travelled;
  hero.x=px;hero.y=py;
  hero.vx=ux*SPD;
  hero.vy=uy*SPD;
  hero.mode='fall';
  hero.acc=0;
  return {x:Math.round(px),y:Math.round(py)};
}
function resolveLanding(){
  var L=lines[li];
  var pad=L.pad;
  /* the caller has already verified the landing window; only the
     x-range needs re-checking here */
  if(hero.x>=pad.x&&hero.x<=pad.x+pad.w&&hero.vy>0){
    precision=Math.abs(hero.x-(pad.x+pad.w/2))<=26;
    var pts=70+level*8+(precision?40:0);
    score+=pts;
    if(score>best){best=score;try{localStorage.setItem('zipride_best',String(best));}catch(e){}}
    li++;
    playSound('land');vibrate(25);
    if(li>=lines.length){
      var bonus=level*30;
      score+=bonus;
      if(score>best){best=score;try{localStorage.setItem('zipride_best',String(best));}catch(e){}}
      msg='COURSE DONE  +'+bonus;msgT=1.6;
      winT=1.5;
      playSound('fan');vibrate(40);
      hero.mode='idle';
      return 'level-win';
    }
    msg=(precision?'NAILED IT  ':'LANDED  +')+pts;msgT=1.1;
    resetHero();
    return 'landed';
  }
  /* water: splash and wade back, free */
  splashes.push({x:hero.x,y:H-46,t:0});
  msg='splash! back to the start of the line';msgT=1.2;
  playSound('splash');vibrate(30);
  resetHero();
  return 'splash';
}

/* ---- update ---- */
function update(dt){
  if(msgT>0)msgT-=dt;
  if(phase!==PHASE_PLAY)return;
  if(winT>0){
    winT-=dt;
    if(winT<=0){winT=0;level++;genLevel();}
    return;
  }
  if(hero.mode==='ride'){
    hero.t+=dt;
    var L=lines[li];
    var len=Math.hypot(L.bx-L.ax,L.by-L.ay);
    if(hero.t*SPD>=len){ /* reached the anchor: auto-drop */
      letGo();
    }
  }else if(hero.mode==='fall'){
    var guard=0;
    hero.acc+=dt;
    while(hero.acc>=1/120&&guard++<20){
      hero.acc-=1/120;
      stepFall(hero,1/120);
      /* land on the pad surface first; only miss everything -> water */
      var L=lines[li];
      if(hero.vy>0&&hero.x>=L.pad.x&&hero.x<=L.pad.x+L.pad.w&&hero.y>=L.pad.y-8&&hero.y<=L.pad.y+22){
        resolveLanding();
        break;
      }
      if(hero.y>=H-46){
        resolveLanding();
        break;
      }
    }
  }
  for(var s=splashes.length-1;s>=0;s--){
    splashes[s].t+=dt;
    if(splashes[s].t>0.6)splashes.splice(s,1);
  }
}

/* ---- input ---- */
function inputDown(x,y){
  if(phase===PHASE_START){phase=PHASE_PLAY;newGame();clipOn();return;}
  if(winT>0){winT=Math.min(winT,0.06);return;}
  clipOn();
}
function inputUp(){
  letGo();
}
function handleDown(x,y){
  var now=Date.now();
  if(now-lastInput<40)return;
  lastInput=now;
  inputDown(x,y);
}

/* ---- aim preview (same integrator) ---- */
function previewArc(){
  if(hero.mode!=='ride')return null;
  var L=lines[li];
  var len=Math.hypot(L.bx-L.ax,L.by-L.ay);
  var travelled=hero.t*SPD;
  var ux=(L.bx-L.ax)/len,uy=(L.by-L.ay)/len;
  var s={x:L.ax+ux*travelled,y:L.ay+uy*travelled,vx:ux*SPD,vy:uy*SPD};
  var pts=[];
  var steps=Math.ceil(1.6*120);
  for(var i=0;i<steps;i++){
    stepFall(s,1/120);
    if(i%8===0)pts.push({x:s.x,y:s.y});
    if(s.y>=H-46)break;
  }
  return pts;
}

/* ---- drawing ---- */
function drawHeroM(x,y,riding){
  ctx.save();
  ctx.translate(x,y);
  if(riding)ctx.rotate(0.3);
  ctx.fillStyle='#69db7c';
  ctx.beginPath();ctx.arc(0,-14,7,0,6.2832);ctx.fill();
  ctx.strokeStyle='#69db7c';ctx.lineWidth=3;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(0,4);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,4);ctx.lineTo(-4,12);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,4);ctx.lineTo(4,12);ctx.stroke();
  if(riding){
    ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(8,-2);ctx.stroke();
  }
  ctx.restore();
}
function draw(){
  ctx.clearRect(0,0,W,H);
  var g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#2a4258');g.addColorStop(1,'#22354a');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  if(phase===PHASE_START){drawStart();return;}
  drawHUD();
  /* water at the bottom */
  var waterY=H-46;
  ctx.fillStyle='#173a56';
  ctx.fillRect(0,waterY,W,H-waterY);
  ctx.strokeStyle='rgba(180,220,250,0.25)';ctx.lineWidth=2;
  ctx.beginPath();
  for(var wx=0;wx<=W;wx+=14){
    if(wx===0)ctx.moveTo(wx,waterY+Math.sin(wx*0.05+clock*2)*3);
    else ctx.lineTo(wx,waterY+Math.sin(wx*0.05+clock*2)*3);
  }
  ctx.stroke();
  /* platforms + cables */
  for(var i=0;i<lines.length;i++){
    var L=lines[i];
    /* start platform */
    ctx.fillStyle=i===li?'#514678':'#39435c';
    ctx.fillRect(L.ax-34,L.ay,52,14);
    /* cable */
    ctx.strokeStyle=i===li?'rgba(255,224,102,0.85)':'rgba(255,224,102,0.3)';
    ctx.lineWidth=i===li?3:2;
    ctx.beginPath();
    ctx.moveTo(L.ax+6,L.ay-26);
    ctx.lineTo(L.bx+6,L.by-26);
    ctx.stroke();
    /* end tower + pad */
    ctx.fillStyle='#6b4423';
    ctx.fillRect(L.bx-2,L.by-6,10,waterY-L.by+6);
    ctx.fillStyle=L.pad.x<=hero.x&&hero.x<=L.pad.x+L.pad.w?'#69db7c':'#514678';
    ctx.fillRect(L.pad.x,L.pad.y,L.pad.w,12);
    ctx.fillStyle='#e6edf3';ctx.font='bold 10px system-ui,sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';
    if(i===li)ctx.fillText('LAND',L.pad.x+L.pad.w/2,L.pad.y+6);
  }
  /* preview arc */
  var arc=previewArc();
  if(arc){
    ctx.fillStyle='rgba(255,212,67,0.65)';
    for(var a2=0;a2<arc.length;a2++){
      ctx.beginPath();ctx.arc(arc[a2].x,arc[a2].y,2.6,0,6.2832);ctx.fill();
    }
  }
  /* hero */
  if(hero.mode==='ride'){
    var L2=lines[li];
    var len2=Math.hypot(L2.bx-L2.ax,L2.by-L2.ay);
    var tr=Math.min(len2,hero.t*SPD);
    var ux=(L2.bx-L2.ax)/len2,uy=(L2.by-L2.ay)/len2;
    drawHeroM(L2.ax+ux*tr,L2.ay+uy*tr+16,true);
    /* trolley */
    ctx.fillStyle='#8b949e';
    ctx.beginPath();ctx.arc(L2.ax+ux*tr,L2.ay+uy*tr,5,0,6.2832);ctx.fill();
  }else if(hero.mode==='fall'){
    drawHeroM(hero.x,hero.y,false);
  }else{
    var L3=lines[li];
    drawHeroM(L3.ax+6,L3.ay+16,false);
  }
  /* splashes */
  for(var s2=0;s2<splashes.length;s2++){
    var sp=splashes[s2];
    ctx.globalAlpha=1-sp.t/0.6;
    ctx.strokeStyle='#c9d1d9';ctx.lineWidth=2;
    for(var k=0;k<4;k++){
      ctx.beginPath();ctx.arc(sp.x,sp.y,6+sp.t*46+k*7,0,6.2832);ctx.stroke();
    }
    ctx.globalAlpha=1;
  }
  if(msgT>0&&msg){
    ctx.globalAlpha=Math.min(1,msgT*2);
    ctx.fillStyle=msg.indexOf('splash')===0?'#8b949e':(msg.indexOf('NAILED')===0?'#69db7c':'#ffe066');
    ctx.font='bold 16px system-ui,sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(msg,W/2,waterY-64);
    ctx.globalAlpha=1;
  }
  if(winT>0)drawBanner();
}
function drawHUD(){
  ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.fillStyle='#e6edf3';ctx.font='bold 20px system-ui,sans-serif';
  ctx.fillText('LEVEL '+level,16,40);
  ctx.font='13px system-ui,sans-serif';ctx.fillStyle='#8b949e';
  ctx.fillText('SCORE '+score,16,64);
  ctx.textAlign='right';
  ctx.fillText('BEST '+best,W-16,66);
  ctx.textAlign='center';ctx.fillStyle='#ffd43b';ctx.font='bold 15px system-ui,sans-serif';
  ctx.fillText('LINE '+(li+1)+'/'+lines.length,W/2,40);
  ctx.font='13px system-ui,sans-serif';ctx.fillStyle='rgba(232,237,243,0.5)';
  ctx.fillText('hold to ride, release to drop on the pad',W/2,66);
}
function drawBanner(){
  ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(0,0,W,H);
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#69db7c';ctx.font='bold 34px system-ui,sans-serif';
  ctx.fillText('COURSE DONE!',W/2,H*0.4);
  ctx.fillStyle='#e6edf3';ctx.font='bold 20px system-ui,sans-serif';
  ctx.fillText('+'+(level*30),W/2,H*0.4+46);
}
function drawStart(){
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#69db7c';ctx.font='bold 42px system-ui,sans-serif';
  ctx.fillText('ZIP RIDE',W/2,H*0.26);
  ctx.fillStyle='#8b949e';ctx.font='16px system-ui,sans-serif';
  ctx.fillText('Hold to clip onto the zipline and glide',W/2,H*0.26+56);
  ctx.fillText('Release to drop onto the landing pad',W/2,H*0.26+84);
  ctx.fillText('The dotted arc is your true drop path',W/2,H*0.26+112);
  ctx.globalAlpha=0.5+0.5*Math.sin(clock*3);
  ctx.fillStyle='#e6edf3';ctx.font='bold 22px system-ui,sans-serif';
  ctx.fillText('HOLD TO START',W/2,H*0.58);
  ctx.globalAlpha=1;
}

/* ---- main loop ---- */
var last=0;
function frame(ts){
  var dt=(ts-last)/1000;
  if(!(dt>0)||dt>0.05)dt=0.016;
  last=ts;
  clock+=dt;
  try{
    update(dt);
    draw();
  }catch(e){}
  requestAnimationFrame(frame);
}

/* ---- boot ---- */
function resize(){
  W=window.innerWidth;H=window.innerHeight;
  DPR=Math.min(2,window.devicePixelRatio||1);
  cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);
  cv.style.width=W+'px';cv.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  if(lines.length)genLevel();
}
window.addEventListener('resize',resize);
window.addEventListener('orientationchange',function(){setTimeout(resize,120);});
window.addEventListener('touchstart',function(e){
  if(e.cancelable)e.preventDefault();
  var t=e.changedTouches[0];
  handleDown(t.clientX,t.clientY);
},{passive:false});
window.addEventListener('touchend',function(e){
  if(e.cancelable)e.preventDefault();
  inputUp();
},{passive:false});
window.addEventListener('mousedown',function(e){handleDown(e.clientX,e.clientY);});
window.addEventListener('mouseup',function(){inputUp();});

try{best=parseInt(localStorage.getItem('zipride_best')||'0',10)||0;}catch(e){best=0;}
resize();
genLevel();
phase=PHASE_START;
requestAnimationFrame(frame);

/* ================= test api ================= */
var api={
  state:function(){return {phase:phase,level:level,score:score,best:best,
    winT:winT,msg:msg,li:li,mode:hero.mode,
    x:Math.round(hero.x),y:Math.round(hero.y),
    rideT:Math.round(hero.t*100)/100,
    lines:lines.map(function(L){return {ax:L.ax,ay:L.ay,bx:L.bx,by:L.by,
      pad:{x:L.pad.x,y:L.pad.y,w:L.pad.w}};})};},
  clip:function(){return clipOn();},
  release:function(){return letGo();},
  /* sim: release after exactly p seconds of ride (real path) */
  dropAfter:function(p){
    clipOn();
    hero.t=p;
    var r=letGo();
    var guard=0;
    while(hero.mode==='fall'&&guard++<600)tickF(1/60);
    return {res:r,mode:hero.mode,winT:winTState()};
  },
  newGame:function(){newGame();},
  tick:function(dt){var s;while(dt>0){s=Math.min(0.016,dt);update(s);dt-=s;}}
};
function tickF(dt){update(dt);}
function winTState(){return winT;}
if(typeof window!=='undefined')window.__zip=api;
})();
</script>
</body>
</html>
`;