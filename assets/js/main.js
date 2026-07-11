/* ============================================================
   UNIVERSE ENGINE — vanilla JS, no dependencies
   ============================================================ */
(function(){
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var eco = (navigator.hardwareConcurrency||8) <= 4 || ((navigator.deviceMemory||8) <= 4);
  if(eco){ document.documentElement.classList.add("eco"); }

  /* ---- live GPU/compositor probe ----
     hardwareConcurrency/deviceMemory tell you nothing about GPU headroom, which is
     what the aurora blend-mode blobs + nav backdrop-filter actually cost. Instead,
     measure real frame times for ~1s right after load; if the page can't hold a
     healthy pace even doing nothing yet, mark it "gpu-weak" and the CSS strips the
     two most expensive effects (see main.css eco-mode block). */
  if(!reduced && !eco && "requestAnimationFrame" in window){
    var probeFrames = 0, probeStart = null, probeBad = 0;
    (function probe(now){
      if(probeStart === null) probeStart = now;
      probeFrames++;
      if(probeFrames > 1){
        var dt = now - probe.last;
        if(dt > 26) probeBad++; /* a healthy 60fps frame is ~16.6ms; ~26ms+ means the device is straining even at idle */
      }
      probe.last = now;
      if(now - probeStart < 900){
        requestAnimationFrame(probe);
      } else if(probeBad / probeFrames > 0.35){
        document.documentElement.classList.add("gpu-weak");
      }
    })();
  }

  /* pause fixed, always-on decorations (aurora) the instant the tab is backgrounded —
     CSS animations keep ticking in background tabs otherwise */
  document.addEventListener("visibilitychange", function(){
    document.documentElement.classList.toggle("tab-hidden", document.hidden);
  });

  /* ---------- nav ---------- */
  var nav = document.getElementById("nav");
  var onScroll = function(){ nav.classList.toggle("solid", window.scrollY > 24); };
  window.addEventListener("scroll", onScroll, {passive:true});
  onScroll();

  var burger = document.getElementById("burger");
  var links  = document.getElementById("navLinks");
  burger.addEventListener("click", function(){
    var open = links.classList.toggle("open");
    burger.classList.toggle("x", open);
    burger.setAttribute("aria-expanded", open);
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });
  links.addEventListener("click", function(e){
    if(e.target.tagName === "A"){ links.classList.remove("open"); burger.classList.remove("x"); burger.setAttribute("aria-expanded","false"); }
  });

  /* ---------- hookReveals (scroll reveal) ---------- */
  function hookReveals(){
    var els = document.querySelectorAll(".rv");
    if(reduced || !("IntersectionObserver" in window)){
      els.forEach(function(el){ el.classList.add("on"); });
      return;
    }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting){ en.target.classList.add("on"); io.unobserve(en.target); }
      });
    },{threshold:.12, rootMargin:"0px 0px -6% 0px"});
    els.forEach(function(el){ io.observe(el); });
  }
  hookReveals();

  /* ---------- shelf rails ---------- */
  document.querySelectorAll(".shelf-nav button").forEach(function(btn){
    btn.addEventListener("click", function(){
      var rail = btn.closest(".shelf").querySelector(".rail");
      var dir  = btn.dataset.rail === "next" ? 1 : -1;
      rail.scrollBy({left: dir * rail.clientWidth * .8, behavior: reduced ? "auto" : "smooth"});
    });
  });


  /* ---------- cine-bands: lazy video, plays only in view ---------- */
  (function(){
    var bands = document.querySelectorAll(".band-vid");
    if(!bands.length) return;
    if(window.innerWidth <= 700 || reduced){
      bands.forEach(function(v){ v.remove(); });
      return;
    }
    if(!("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        var v = en.target;
        if(en.isIntersecting){
          if(!v.src){ v.src = v.dataset.src; }
          v.play().catch(function(){});
        } else {
          v.pause();
        }
      });
    },{rootMargin:"260px 0px", threshold:0});
    bands.forEach(function(v){ io.observe(v); });
    document.addEventListener("visibilitychange", function(){
      if(document.hidden) bands.forEach(function(v){ v.pause(); });
    });
  })();

  /* ---------- Apple-style showcase: slides follow the video's 3 acts ---------- */
  var ACTS = [0, 4.65, 8.95, 13.62]; /* act boundaries in the 3-act hero video */
  var slides = document.querySelectorAll(".show-slide");
  var pills  = document.querySelectorAll(".show-pill");
  var curSlide = 0, showTimer = null;
  function setSlide(i){
    curSlide = i;
    slides.forEach(function(s,k){
      var on = (k===i);
      s.classList.toggle("is-on", on);
      s.setAttribute("aria-hidden", on ? "false" : "true");
      try{ s.inert = !on; }catch(e){}
      s.querySelectorAll("a,button").forEach(function(el){
        if(on){ el.removeAttribute("tabindex"); } else { el.setAttribute("tabindex","-1"); }
      });
    });
    pills.forEach(function(p,k){
      p.classList.remove("active");
      var f = p.querySelector(".fill");
      f.style.animation = "none"; void f.offsetWidth; f.style.animation = "";
      if(k===i){
        f.style.animationDuration = (ACTS[i+1]-ACTS[i]) + "s";
        p.classList.add("active");
      }
    });
  }
  function startTimerLoop(){ /* phones / no video: 5s per slide */
    clearTimeout(showTimer);
    ACTS = [0,5,10,15];
    (function tick(){
      showTimer = setTimeout(function(){
        setSlide((curSlide+1)%slides.length); tick();
      }, (ACTS[curSlide+1]-ACTS[curSlide])*1000);
    })();
  }
  setSlide(0);

  /* ---------- hero video: desktop only — phones never load a byte ---------- */
  var hv = document.getElementById("heroVid");
  var heroPoster = document.getElementById("heroPoster");
  var isMobileViewport = window.innerWidth <= 700;
  if(hv && (isMobileViewport || reduced)){
    /* Mobile: remove video only (not parent) so poster <img> stays as the LCP element */
    hv.remove(); hv = null;
  } else {
    /* Desktop: hide the static poster img — video handles the visual */
    if(heroPoster) heroPoster.style.display = "none";
  }
  if(!hv){
    startTimerLoop();
    pills.forEach(function(p,k){
      p.addEventListener("click", function(){ setSlide(k); startTimerLoop(); });
    });
  }
  if(hv){
    hv.preload = "metadata";
    hv.autoplay = true;
    hv.play().catch(function(){});
    hv.addEventListener("timeupdate", function(){
      var t = hv.currentTime;
      var i = t < ACTS[1] ? 0 : (t < ACTS[2] ? 1 : 2);
      if(i !== curSlide) setSlide(i);
    });
    pills.forEach(function(p,k){
      p.addEventListener("click", function(){
        hv.currentTime = ACTS[k] + 0.05;
        setSlide(k);
      });
    });
    var hvWrap = hv.parentElement;
    hv.addEventListener("error", function(){ hvWrap.style.display = "none"; }, true);
    var srcEl = hv.querySelector("source");
    if(srcEl) srcEl.addEventListener("error", function(){ hvWrap.style.display = "none"; });
    if("IntersectionObserver" in window){
      new IntersectionObserver(function(en){
        en.forEach(function(e){ e.isIntersecting ? hv.play().catch(function(){}) : hv.pause(); });
      },{threshold:.05}).observe(hvWrap);
    }
    document.addEventListener("visibilitychange", function(){
      document.hidden ? hv.pause() : hv.play().catch(function(){});
    });
  }

  /* ---------- services: 3D tilt follows the cursor ---------- */
  if(!reduced && window.matchMedia("(pointer:fine)").matches){
    document.querySelectorAll(".svc").forEach(function(card){
      card.addEventListener("mousemove", function(e){
        var r = card.getBoundingClientRect();
        var x = (e.clientX - r.left)/r.width - .5;
        var y = (e.clientY - r.top)/r.height - .5;
        card.classList.add("tilting");
        card.style.transform = "rotateY(" + (x*10) + "deg) rotateX(" + (-y*8) + "deg) translateY(-6px)";
      });
      card.addEventListener("mouseleave", function(){
        card.classList.remove("tilting");
        card.style.transform = "";
      });
    });
  }

  /* ---------- newsletter → Cloudflare Worker (live contract: {email}) ---------- */
  var form = document.getElementById("freqForm");
  var msg  = document.getElementById("freqMsg");
  var subBtn = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", function(e){
    e.preventDefault();
    var email = document.getElementById("freqEmail").value.trim();
    if(!email){ return; }
    subBtn.disabled = true; subBtn.textContent = "Sending...";
    msg.textContent = ""; msg.className = "freq-msg";
    fetch("https://subscribe.vishalhingolauthor.com", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ email: email })
    }).then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
    .then(function(res){
      if(res.ok && res.d.success){
        msg.textContent = "✓ Check your inbox — The Night Before is on the way!";
        msg.className = "freq-msg ok";
        document.getElementById("freqEmail").value = "";
        try{ localStorage.setItem("nlSubscribed","1"); }catch(err){}
      } else {
        msg.textContent = (res.d && res.d.error) || "Something went wrong. Please try again.";
        msg.className = "freq-msg err";
      }
    }).catch(function(){
      msg.textContent = "Network error. Please try again.";
      msg.className = "freq-msg err";
    }).finally(function(){
      subBtn.disabled = false; subBtn.textContent = "Get the Lost Chapter";
    });
  });

  /* ══ SKY ENGINE v2 — same visuals, half the GPU: DPR cap, 30fps, hidden-pause ══ */
  (function(){
    if(window.innerWidth <= 700){ return; }
    var lowEnd = (navigator.hardwareConcurrency||8) <= 4 || ((navigator.deviceMemory||8) <= 4);
    if(lowEnd){ return; } /* eco devices: CSS phone-sky aesthetics not needed, skip canvas entirely */
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var c = document.getElementById('sky');
    var x = c.getContext('2d');
    var DPR = Math.min(devicePixelRatio||1, 1.5);
    var W,H,stars=[],shooting=null,mx=-9999,my=-9999;

    function size(){
      DPR = Math.min(devicePixelRatio||1, 1.5);
      W = c.width = innerWidth * DPR;
      H = c.height = innerHeight * DPR;
      c.style.width = innerWidth+'px'; c.style.height = innerHeight+'px';
      var maxStars = lowEnd ? 80 : 140;
      var n = Math.min(maxStars, Math.floor(innerWidth*innerHeight/11000));
      stars = Array.from({length:n},function(){return {
        x:Math.random()*W, y:Math.random()*H,
        r:(Math.random()*1.4+.4)*DPR,
        tw:Math.random()*Math.PI*2,
        ts:.016+Math.random()*.04,
        vx:(Math.random()-.5)*.08*DPR,
        vy:(Math.random()-.5)*.08*DPR,
        hue:Math.random()<.14 ? 'gold' : (Math.random()<.12 ? 'cyan' : 'white')
      };});
    }
    size(); addEventListener('resize',size);
    addEventListener('pointermove',function(e){mx=e.clientX*DPR;my=e.clientY*DPR},{passive:true});
    addEventListener('pointerleave',function(){mx=my=-9999});

    function spawnShooting(){
      if(reduce) return;
      shooting = {x:Math.random()*W*.7, y:Math.random()*H*.35,vx:(7+Math.random()*5)*DPR, vy:(2.4+Math.random()*2)*DPR,life:1};
      setTimeout(spawnShooting, 6000+Math.random()*9000);
    }
    setTimeout(spawnShooting, 3000);

    var scrollBursts = [];
    var lastScrollY = window.scrollY, scrollBurstCooldown = 0;
    addEventListener('scroll', function(){
      if(reduce) return;
      var dy = Math.abs(window.scrollY - lastScrollY);
      lastScrollY = window.scrollY;
      if(dy < 6) return;
      var now = performance.now();
      if(now < scrollBurstCooldown) return;
      scrollBurstCooldown = now + 800;
      for(var i=0;i<2;i++){
        scrollBursts.push({x:Math.random()*W, y:-20*DPR,
          vx:(Math.random()-.5)*1.2*DPR, vy:(2+Math.random()*2)*DPR, life:1, r:(.8+Math.random())*DPR});
      }
      if(scrollBursts.length > 40) scrollBursts = scrollBursts.slice(-40);
    }, {passive:true});

    var LINK = 140*DPR, LINK2 = LINK*LINK;
    var last = 0, INTERVAL = 1000/30; /* 30fps — invisible difference, half the work */

    function frame(now){
      requestAnimationFrame(frame);
      if(document.hidden) return;
      if(now - last < INTERVAL) return;
      last = now;
      x.clearRect(0,0,W,H);
      var i, s;
      for(i=0;i<stars.length;i++){
        s = stars[i];
        s.tw += s.ts;
        if(!reduce){ s.x+=s.vx; s.y+=s.vy; if(s.x<0)s.x=W; if(s.x>W)s.x=0; if(s.y<0)s.y=H; if(s.y>H)s.y=0; }
        var a = .35 + Math.sin(s.tw)*.3;
        x.beginPath(); x.arc(s.x,s.y,s.r,0,7);
        x.fillStyle = s.hue==='gold' ? 'rgba(232,187,107,'+(a+.15)+')' : s.hue==='cyan' ? 'rgba(125,230,255,'+(a+.1)+')' : 'rgba(214,220,245,'+a+')';
        x.fill();
      }
      if(mx>0 && !lowEnd){
        var prev = null;
        for(i=0;i<stars.length;i++){
          s = stars[i];
          var dx=s.x-mx, dy=s.y-my, d2=dx*dx+dy*dy;
          if(d2 >= LINK2) continue;
          var a2 = (1-Math.sqrt(d2)/LINK)*.35;
          x.beginPath(); x.moveTo(mx,my); x.lineTo(s.x,s.y);
          x.strokeStyle='rgba(232,187,107,'+a2+')'; x.lineWidth=DPR*.6; x.stroke();
          if(prev){ x.beginPath(); x.moveTo(s.x,s.y); x.lineTo(prev.x,prev.y);
            x.strokeStyle='rgba(125,230,255,'+(a2*.5)+')'; x.stroke(); }
          prev = s;
        }
      }
      if(shooting){
        var sh=shooting; sh.x+=sh.vx; sh.y+=sh.vy; sh.life-=.018;
        if(sh.life<=0 || sh.x>W || sh.y>H){ shooting=null; }
        else{
          var grad = x.createLinearGradient(sh.x,sh.y,sh.x-sh.vx*14,sh.y-sh.vy*14);
          grad.addColorStop(0,'rgba(244,238,226,'+sh.life+')'); grad.addColorStop(1,'rgba(244,238,226,0)');
          x.beginPath(); x.moveTo(sh.x,sh.y); x.lineTo(sh.x-sh.vx*14,sh.y-sh.vy*14);
          x.strokeStyle=grad; x.lineWidth=DPR*1.6; x.lineCap='round'; x.stroke();
        }
      }
      if(scrollBursts.length){
        scrollBursts = scrollBursts.filter(function(p){ return p.life > 0 && p.y < H + 40; });
        for(i=0;i<scrollBursts.length;i++){
          var p = scrollBursts[i];
          p.x += p.vx; p.y += p.vy; p.life -= .028;
          x.beginPath(); x.arc(p.x,p.y,p.r,0,7);
          x.fillStyle = 'rgba(232,187,107,'+(Math.max(p.life,0)*.6)+')';
          x.fill();
        }
      }
    }
    requestAnimationFrame(frame);
  })();

})();


/* ══ GOLD STAR — live canvas engines, as on vishalhingolauthor.com ══ */
function makePRNG2(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/0xffffffff}}

/* Effect 1: accreting ring system + wavy sine lines */
(function(){
  const canvas=document.getElementById('gs-ring-canvas');
  if(!canvas)return;
  if(window.innerWidth<=700)return;
  const ctx=canvas.getContext('2d');
  let W,H,dpr;const rng=makePRNG2(88888);let rings=[];const MAX_RINGS=150;let ringCount=0;let gsOn=false;
  const gsHost=document.querySelector('.gs-feature-inner');
  if(gsHost&&'IntersectionObserver'in window){new IntersectionObserver(es=>{es.forEach(e=>{gsOn=e.isIntersecting})},{threshold:.05}).observe(gsHost)}else{gsOn=true}
  var glowGrd1=null,glowGrd2=null;
  function buildGlowGradients(){
    const W2=W*0.62,H2=H*0.5;
    glowGrd1=ctx.createRadialGradient(W2,H2,0,W2,H2,90);
    glowGrd1.addColorStop(0,'rgba(232,187,107,.22)');glowGrd1.addColorStop(0.5,'rgba(200,120,30,.08)');glowGrd1.addColorStop(1,'transparent');
    glowGrd2=ctx.createRadialGradient(W2,H2,0,W2,H2,28);
    glowGrd2.addColorStop(0,'rgba(255,215,120,.35)');glowGrd2.addColorStop(1,'transparent');
  }
  function resize(){dpr=Math.min(window.devicePixelRatio||1,1.5);const parent=canvas.parentElement;W=parent.offsetWidth;H=parent.offsetHeight;
    canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(1,0,0,1,0,0);ctx.scale(dpr,dpr);if(rings.length===0)initRings();buildGlowGradients()}
  function initRings(){rings=[];ringCount=0;for(let i=0;i<MAX_RINGS*0.65;i++)spawnRing(true)}
  function spawnRing(instant){const t=ringCount/MAX_RINGS;const cx=W*0.62,cy=H*0.5;
    rings.push({cx,cy,r:6+t*Math.min(W,H)*0.62,jx:(rng()-0.5)*Math.min(W,H)*0.05,jy:(rng()-0.5)*Math.min(W,H)*0.05,
      isArc:rng()<0.5,arcStart:rng()*Math.PI*2,arcLen:(0.4+rng()*1.5)*Math.PI,lw:0.3+rng()*0.65,t,
      alpha:instant?(1-t*0.55)*0.38:0,targetAlpha:(1-t*0.55)*0.38});ringCount++}
  const WAVE_COUNT=8;let waves=[];
  function initWaves(){waves=Array.from({length:WAVE_COUNT},(_,i)=>({amp:18+i*6,freq:0.006+i*0.0012,phase:(i/WAVE_COUNT)*Math.PI*2,
    speed:0.008+i*0.003,alpha:0.04+(i<4?0.06:0.02),isGold:i%3!==2,yOffset:H*(0.2+i*0.06)}))}
  let tick=0,spawnTimer=0;
  function draw(){tick++;ctx.clearRect(0,0,W,H);
    waves.forEach(w=>{ctx.beginPath();for(let x=0;x<=W;x+=3){const y=w.yOffset+Math.sin(x*w.freq+tick*w.speed+w.phase)*w.amp;
      if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}
      ctx.strokeStyle=w.isGold?`rgba(232,187,107,${w.alpha})`:`rgba(157,123,255,${w.alpha*0.7})`;ctx.lineWidth=0.8;ctx.stroke()});
    if(ringCount<MAX_RINGS){spawnTimer+=0.35;while(spawnTimer>=1&&ringCount<MAX_RINGS){spawnRing(false);spawnTimer--}}
    else if(tick%700===0){rings=[];ringCount=0;for(let i=0;i<MAX_RINGS*0.65;i++)spawnRing(true)}
    const breathe=Math.sin(tick*0.005)*0.1;
    rings.forEach(ring=>{if(ring.alpha<ring.targetAlpha)ring.alpha=Math.min(ring.alpha+0.006,ring.targetAlpha);
      const gt=Math.max(0,1-ring.t*2.0);const warm=Math.max(0,1-ring.t*3.5);
      const rv=Math.round(232*gt+140*warm+60*(1-gt-warm));const gv=Math.round(187*gt+80*warm+30*(1-gt-warm));const bv=Math.round(107*gt+20*warm+120*(1-gt-warm));
      ctx.beginPath();
      if(ring.isArc)ctx.arc(ring.cx+ring.jx,ring.cy+ring.jy,ring.r,ring.arcStart,ring.arcStart+ring.arcLen);
      else ctx.arc(ring.cx+ring.jx,ring.cy+ring.jy,ring.r,0,Math.PI*2);
      ctx.strokeStyle=`rgba(${Math.max(0,Math.min(255,rv))},${Math.max(0,Math.min(255,gv))},${Math.max(0,Math.min(255,bv))},${ring.alpha*(1+breathe)})`;
      ctx.lineWidth=ring.lw;ctx.stroke()});
    if(rings.length>10){const W2=W*0.62,H2=H*0.5;
      if(!glowGrd1)buildGlowGradients();
      ctx.fillStyle=glowGrd1;ctx.beginPath();ctx.arc(W2,H2,90,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=glowGrd2;ctx.beginPath();ctx.arc(W2,H2,28,0,Math.PI*2);ctx.fill()}}
  resize();initWaves();
  var last1=0,INTERVAL1=1000/30; /* match the sky engine's 30fps cap — half the redraw cost, same look */
  function loop(now){
    requestAnimationFrame(loop);
    if(!gsOn||document.hidden) return;
    if(now-last1<INTERVAL1) return;
    last1=now;
    draw();
  }
  requestAnimationFrame(loop);
  window.addEventListener('resize',()=>{resize();initWaves()},{passive:true});
})();

/* Effect 2: interactive particle field */
(function(){
  const canvas=document.getElementById('gs-particle-canvas');
  if(!canvas)return;
  if(window.innerWidth<=700)return;
  const ctx=canvas.getContext('2d');
  let W,H,dpr;let mouse={x:-9999,y:-9999};const rng=makePRNG2(12345);let particles=[];const N=60;let gsOn2=false;
  const gsHost2=document.querySelector('.gs-feature-inner');
  if(gsHost2&&'IntersectionObserver'in window){new IntersectionObserver(es=>{es.forEach(e=>{gsOn2=e.isIntersecting})},{threshold:.05}).observe(gsHost2)}else{gsOn2=true}
  function resize(){dpr=Math.min(window.devicePixelRatio||1,1.5);const parent=canvas.parentElement;W=parent.offsetWidth;H=parent.offsetHeight;
    canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(1,0,0,1,0,0);ctx.scale(dpr,dpr);if(particles.length===0)initParticles()}
  function initParticles(){particles=[];for(let i=0;i<N;i++){particles.push({x:rng()*W,y:rng()*H,vx:(rng()-0.5)*0.3,vy:(rng()-0.5)*0.3,
    r:1+rng()*2,alpha:0.1+rng()*0.35,isGold:rng()<0.4,phase:rng()*Math.PI*2})}}
  const parent=document.querySelector('.gs-feature-inner');
  if(parent){parent.addEventListener('mousemove',function(e){const rect=parent.getBoundingClientRect();mouse.x=e.clientX-rect.left;mouse.y=e.clientY-rect.top},{passive:true});
    parent.addEventListener('mouseleave',function(){mouse.x=-9999;mouse.y=-9999},{passive:true})}
  let tick=0;
  function draw(){tick++;ctx.clearRect(0,0,W,H);
    particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;
      if(p.x<0)p.x=W;if(p.x>W)p.x=0;if(p.y<0)p.y=H;if(p.y>H)p.y=0;
      const dx=p.x-mouse.x,dy=p.y-mouse.y;const dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<100&&dist>0){const force=(100-dist)/100*0.8;p.vx+=(dx/dist)*force*0.12;p.vy+=(dy/dist)*force*0.12}
      p.vx*=0.98;p.vy*=0.98;
      if(Math.abs(p.vx)<0.05)p.vx+=(rng()-0.5)*0.06;
      if(Math.abs(p.vy)<0.05)p.vy+=(rng()-0.5)*0.06;
      const pulse=0.85+0.15*Math.sin(tick*0.03+p.phase);
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=p.isGold?`rgba(232,187,107,${p.alpha*pulse})`:`rgba(157,123,255,${p.alpha*pulse*0.7})`;ctx.fill();
      if(p.isGold&&dist<120&&mouse.x>0){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(mouse.x,mouse.y);
        ctx.strokeStyle=`rgba(232,187,107,${0.04*(1-dist/120)})`;ctx.lineWidth=0.5;ctx.stroke()}})}
  resize();
  var last2=0,INTERVAL2=1000/30;
  function loop(now){
    requestAnimationFrame(loop);
    if(!gsOn2||document.hidden) return;
    if(now-last2<INTERVAL2) return;
    last2=now;
    draw();
  }
  requestAnimationFrame(loop);
  window.addEventListener('resize',resize,{passive:true});
})();

/* Effect 3: mini VS preview canvas */
(function(){
  const canvas=document.getElementById('gs-vs-mini');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  let W,H,dpr;const H_FIXED=180;
  const rngL=makePRNG2(777),rngR=makePRNG2(1234);
  const leftRings=[];const LEFT_N=50;const rightRings=[];const RIGHT_MAX=140;let rightCount=0,spawnTimer=0;
  function spawnLeft(){return{r:8+rngL()*70,lw:0.4+rngL()*0.8,jx:(rngL()-0.5)*18,jy:(rngL()-0.5)*18,arcStart:rngL()*Math.PI*2,
    arcLen:(0.3+rngL()*1.6)*Math.PI,maxAlpha:0.14+rngL()*0.22,life:0,maxLife:60+rngL()*100,phase:rngL()*Math.PI*2}}
  for(let i=0;i<LEFT_N;i++){const r=spawnLeft();r.life=rngL()*r.maxLife;leftRings.push(r)}
  let vsOn=false;
  if('IntersectionObserver'in window){new IntersectionObserver(es=>{es.forEach(e=>{vsOn=e.isIntersecting})},{threshold:.05}).observe(canvas)}else{vsOn=true}
  let rightGlow=null;
  function resize(){dpr=Math.min(window.devicePixelRatio||1,1.5);W=canvas.offsetWidth;H=H_FIXED;
    canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.height=H+'px';ctx.setTransform(1,0,0,1,0,0);ctx.scale(dpr,dpr);
    const mid=W/2,rcx=mid+mid*0.5,rcy=H*0.5;
    rightGlow=ctx.createRadialGradient(rcx,rcy,0,rcx,rcy,30);
    rightGlow.addColorStop(0,'rgba(232,187,107,.15)');rightGlow.addColorStop(1,'transparent');
  }
  let tick=0;
  function draw(){tick++;ctx.clearRect(0,0,W,H);const mid=W/2;
    ctx.save();ctx.beginPath();ctx.rect(0,0,mid,H);ctx.clip();
    const lcx=mid*0.5,lcy=H*0.5;
    leftRings.forEach(ring=>{ring.life++;
      if(ring.life>ring.maxLife){Object.assign(ring,spawnLeft());ring.life=0}
      const env=Math.sin(ring.life/ring.maxLife*Math.PI);
      ctx.beginPath();ctx.arc(lcx+ring.jx,lcy+ring.jy,ring.r,ring.arcStart,ring.arcStart+ring.arcLen);
      ctx.strokeStyle=`rgba(180,180,200,${ring.maxAlpha*env*(0.85+0.15*Math.sin(tick*0.1+ring.phase))})`;
      ctx.lineWidth=ring.lw;ctx.stroke()});
    ctx.font="600 8px 'Space Grotesk',monospace";ctx.fillStyle='rgba(154,161,199,.3)';ctx.textAlign='center';
    ctx.fillText('DISSOLVES',lcx,H-10);ctx.restore();
    ctx.fillStyle='rgba(157,123,255,.4)';ctx.fillRect(mid-0.5,H*0.08,1,H*0.84);
    ctx.save();ctx.beginPath();ctx.rect(mid,0,mid,H);ctx.clip();
    const rcx=mid+mid*0.5,rcy=H*0.5;
    if(rightCount<RIGHT_MAX){spawnTimer+=1.2;while(spawnTimer>=1&&rightCount<RIGHT_MAX){const t=rightCount/RIGHT_MAX;
      rightRings.push({r:4+t*80,lw:0.4+rngR()*0.8,jx:(rngR()-0.5)*8,jy:(rngR()-0.5)*8,isArc:rngR()<0.5,
        arcStart:rngR()*Math.PI*2,arcLen:(0.5+rngR()*1.3)*Math.PI,t});rightCount++;spawnTimer--}}
    else if(tick%300===0){rightRings.length=0;rightCount=0}
    rightRings.forEach(ring=>{const gt=Math.max(0,1-ring.t*2.2);
      ctx.beginPath();
      if(ring.isArc)ctx.arc(rcx+ring.jx,rcy+ring.jy,ring.r,ring.arcStart,ring.arcStart+ring.arcLen);
      else ctx.arc(rcx+ring.jx,rcy+ring.jy,ring.r,0,Math.PI*2);
      ctx.strokeStyle=`rgba(${Math.round(232*gt+157*(1-gt))},${Math.round(187*gt+123*(1-gt))},${Math.round(107*gt+255*(1-gt))},${(1-ring.t*.5)*.5})`;
      ctx.lineWidth=ring.lw;ctx.stroke()});
    if(rightRings.length>8){if(!rightGlow)resize();
      ctx.fillStyle=rightGlow;ctx.beginPath();ctx.arc(rcx,rcy,30,0,Math.PI*2);ctx.fill()}
    ctx.font="600 8px 'Space Grotesk',monospace";ctx.fillStyle='rgba(232,187,107,.45)';ctx.textAlign='center';
    ctx.fillText('ACCRETES',rcx,H-10);ctx.restore()}
  resize();
  if(window.innerWidth<=700){draw()}else{
    var last3=0,INTERVAL3=1000/30;
    (function loop(now){
      requestAnimationFrame(loop);
      if(!vsOn||document.hidden) return;
      if(now-last3<INTERVAL3) return;
      last3=now;
      draw();
    })();
  }
  window.addEventListener('resize',resize,{passive:true});
})();


(function(){
  var banner = document.getElementById('cookieBanner');
  if (!banner) return;
  if (!localStorage.getItem('cookieOk')) { banner.style.display = 'block'; }
  ['analytics','prefs'].forEach(function(id){
    var toggle = document.getElementById(id + 'Toggle');
    var slider = document.getElementById(id + 'Slider');
    var knob   = document.getElementById(id + 'Knob');
    if (!toggle) return;
    toggle.addEventListener('change', function(){
      slider.style.background = toggle.checked ? '#E8BB6B' : 'rgba(244,238,226,.15)';
      knob.style.left = toggle.checked ? '19px' : '3px';
    });
  });
})();
function acceptAllCookies(){
  localStorage.setItem('cookieOk','1');
  localStorage.setItem('cookieAnalytics','1');
  localStorage.setItem('cookiePrefs','1');
  document.getElementById('cookieBanner').style.display = 'none';
  maybeShowNlPopup();
}
function toggleCookieDetails(){
  var d = document.getElementById('cookieDetails');
  var btn = document.getElementById('customizeBtn');
  var save = document.getElementById('savePrefsBtn');
  var isHidden = d.style.display === 'none' || !d.style.display;
  d.style.display = isHidden ? 'block' : 'none';
  btn.textContent  = isHidden ? 'Hide Settings' : 'Customize Settings';
  save.style.display = isHidden ? 'block' : 'none';
}
function saveCustomCookies(){
  var analytics = document.getElementById('analyticsToggle').checked;
  var prefs     = document.getElementById('prefsToggle').checked;
  localStorage.setItem('cookieOk','1');
  localStorage.setItem('cookieAnalytics', analytics ? '1' : '0');
  localStorage.setItem('cookiePrefs', prefs ? '1' : '0');
  document.getElementById('cookieBanner').style.display = 'none';
  maybeShowNlPopup();
}
function maybeShowNlPopup(){
  if (localStorage.getItem('nlSubscribed')) return;
  if (localStorage.getItem('nlPopupDismissed')) return;
  setTimeout(function(){
    var popup = document.getElementById('nlPopup');
    if (popup) popup.style.display = 'flex';
  }, 3000);
}
function closeNlPopup(){
  var popup = document.getElementById('nlPopup');
  if (popup) popup.style.display = 'none';
  localStorage.setItem('nlPopupDismissed','1');
}
async function submitNlPopup(){
  var email = document.getElementById('popupEmail').value.trim();
  var msg   = document.getElementById('popupMsg');
  if (!email || !email.includes('@')) {
    msg.style.color = '#FF9B9B';
    msg.textContent = 'Please enter a valid email address.';
    return;
  }
  msg.style.color = '#9AA1C7';
  msg.textContent = 'Sending...';
  try {
    var res = await fetch('https://subscribe.vishalhingolauthor.com', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email: email})
    });
    var data = await res.json();
    if (res.ok && data.success) {
      msg.style.color = '#7DE6FF';
      msg.textContent = '✓ Welcome to The Signal! Check your inbox.';
      localStorage.setItem('nlSubscribed','1');
      setTimeout(closeNlPopup, 2500);
    } else {
      msg.style.color = '#FF9B9B';
      msg.textContent = data.error || 'Something went wrong. Try again.';
    }
  } catch(e) {
    msg.style.color = '#FF9B9B';
    msg.textContent = 'Network error. Please try again.';
  }
}
/* ---- shared session check ----
   Both the sign-in reminder and the nav name-swap used to each fire their own
   independent POST to /check_session on every page load. Same endpoint, same
   body, same moment — now fetched once and reused by both. */
function getSessionOnce(){
  if(!window.__sessionPromise){
    window.__sessionPromise = fetch('https://subscribe.vishalhingolauthor.com', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({type:'check_session'})
    }).then(function(r){ return r.json(); }).catch(function(){ return {}; });
  }
  return window.__sessionPromise;
}

(function(){
  if (!localStorage.getItem('cookieOk')) return;
  if (localStorage.getItem('signinDismissed')) return;
  getSessionOnce().then(function(data){
    if (data && data.loggedIn) return;
    setTimeout(function(){
      var reminder = document.getElementById('signinReminder');
      if (reminder) reminder.style.display = 'block';
    }, 5000);
  });
})();
if (localStorage.getItem('cookieOk')) { maybeShowNlPopup(); }

/* Account nav swap — logged-in visitors see their first name */
(function(){
  function firstName(fullName, email){
    if (fullName && fullName.trim()) return fullName.trim().split(/\s+/)[0];
    if (email) return email.split('@')[0];
    return 'Account';
  }
  getSessionOnce().then(function(data){
    if (!data || !data.loggedIn) return;
    const name = firstName(data.fullName, data.email);
    const links = document.querySelectorAll('#navAccount, a[href="account.html"], a[href="/account.html"]');
    links.forEach(function(link){
      link.textContent = name;
      link.href = 'my-account.html';
    });
  });
})();
