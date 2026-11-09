import * as THREE from 'three';

const canvas = document.querySelector('#game-canvas');
const shell = document.querySelector('#game-shell');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#171318');
scene.fog = new THREE.FogExp2('#171318', 0.029);
const camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, 0.08, 100);
camera.rotation.order = 'YXZ';
scene.add(camera);
const clock = new THREE.Clock();

const mat = (color, roughness=0.85, metalness=0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const concrete = mat('#454044');
const darkMetal = mat('#252329', .53, .62);
const trimMetal = mat('#70615b', .42, .65);
const rust = mat('#703a2e');
const floorMat = mat('#39363a');
const hazardMat = new THREE.MeshStandardMaterial({ color:'#e4a247', roughness:.75, emissive:'#54260e', emissiveIntensity:.35 });
const obstacles = [];
const enemies = [];
let bullet = null;
let playing = false;
let ammo = true;
let health = 100;
let kills = 0;
let yaw = 0, pitch = 0;
let player = new THREE.Vector3(0, 1.65, 12);
let velocity = new THREE.Vector3();
let moveInput = { x: 0, y: 0 };
let fireCooldown = 0;
let hurtCooldown = 0;
let toastTimer = 0;
let soundOn = true;
let audioContext = null;
let muzzleFlash = null;
const raycaster = new THREE.Raycaster();
const keys = new Set();
const tempV = new THREE.Vector3();

scene.add(new THREE.HemisphereLight('#bcb5c1', '#30201c', 1.6));
const ambient = new THREE.AmbientLight('#a9847a', .42); scene.add(ambient);
const mainLight = new THREE.DirectionalLight('#ffd0a2', 2.2); mainLight.position.set(-7, 13, 6); mainLight.castShadow = true;
mainLight.shadow.mapSize.set(1024, 1024); mainLight.shadow.camera.left=-23; mainLight.shadow.camera.right=23; mainLight.shadow.camera.top=23; mainLight.shadow.camera.bottom=-23; mainLight.shadow.bias=-.001; scene.add(mainLight);

function makeFloorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); g.fillStyle = '#454146'; g.fillRect(0,0,512,512);
  for(let y=0;y<512;y+=64) for(let x=0;x<512;x+=64){
    g.fillStyle = ((x+y)/64)%2 ? '#403d42' : '#48444a'; g.fillRect(x+1,y+1,62,62);
    g.strokeStyle='rgba(12,10,12,.42)'; g.lineWidth=2; g.strokeRect(x+1,y+1,62,62);
    g.fillStyle='rgba(190,165,143,.2)'; for(let i=0;i<5;i++){g.fillRect(x+7+i*11,y+7,2,2);}
  }
  for(let i=0;i<1100;i++){g.fillStyle=`rgba(12,10,12,${Math.random()*.16})`;g.fillRect(Math.random()*512,Math.random()*512,1+Math.random()*3,1+Math.random()*2)}
  const t = new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(3.2,3.2); t.colorSpace=THREE.SRGBColorSpace; return t;
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(48,48), new THREE.MeshStandardMaterial({ map:makeFloorTexture(), roughness:.94 }));
floor.rotation.x=-Math.PI/2; floor.position.y=-.04; floor.receiveShadow=true; scene.add(floor);

function box(w,h,d,material,x,y,z, opts={}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material); mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; scene.add(mesh);
  if(opts.block) obstacles.push({x,z,hw:w/2,hd:d/2});
  return mesh;
}
function addLight(color,intensity,distance,x,y,z) { const l=new THREE.PointLight(color,intensity,distance,2); l.position.set(x,y,z); scene.add(l); return l; }
// Industrial arena walls, buttresses and warning stripes
for(const z of [-20,20]){
  box(42,8,1.3,concrete,0,4,z,{block:true});
  box(42,.35,1.45,darkMetal,0,7.75,z);
  for(let x=-18;x<=18;x+=6){box(.28,6,.22,trimMetal,x,4,z<0?z+.72:z-.72);box(1.7,.16,.25,rust,x,1.5,z<0?z+.72:z-.72)}
}
for(const x of [-20,20]){
  box(1.3,8,40,concrete,x,4,0,{block:true}); box(1.45,.35,40,darkMetal,x,7.75,0);
  for(let z=-15;z<=15;z+=6){box(.22,6,.28,trimMetal,x<0?x+.72:x-.72,4,z);box(.25,.16,1.7,rust,x<0?x+.72:x-.72,1.5,z)}
}
// support columns and machinery
const pillarSpots=[[-8,-7],[8,-7],[-8,4],[8,4],[-14,12],[14,-12]];
for(const [x,z] of pillarSpots){
  box(1.6,6,1.6,darkMetal,x,3,z,{block:true});
  box(2.1,.45,2.1,trimMetal,x,5.95,z);
  box(2,.22,2,hazardMat,x,1.2,z);
  const glow=addLight('#f05a32',1.8,5,x,2.1,z);
  const lamp=new THREE.Mesh(new THREE.BoxGeometry(.24,.18,.24),new THREE.MeshBasicMaterial({color:'#ff6743'})); lamp.position.set(x,5.3,z); scene.add(lamp);
}
// central low barricades create lanes without closing the arena
for(const [x,z,w,d] of [[0,-3,5,1.1],[-3,9,1.1,4],[12,3,1.2,5],[-13,-1,1.2,5]]){
  box(w,1.2,d,rust,x,.6,z,{block:true}); box(w+.12,.12,d+.12,trimMetal,x,1.23,z);
  box(w*.72,.055,d*.8,hazardMat,x,1.3,z);
}
// floor hazard markings and drains
for(let x=-18;x<=18;x+=6){
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(2.3,.018,.12),hazardMat); stripe.position.set(x,.005,-18.9);scene.add(stripe);
  const grate=box(1.4,.03,.35,darkMetal,x,.015,0); grate.castShadow=false;
}
// scattered pipes / vents on walls
for(let i=0;i<8;i++){
  const x=-17+i*4.85;
  box(.55,2.1,.55,darkMetal,x,1.1,-19.05);
  box(.75,.16,.72,trimMetal,x,2.15,-19.05);
}
// ominous overhead lamps and molten glow
for(const [x,z] of [[0,-14],[-15,5],[15,9],[0,16]]){
  box(1.2,.12,1.2,darkMetal,x,7.15,z);
  const lamp=new THREE.Mesh(new THREE.BoxGeometry(.62,.08,.62),new THREE.MeshBasicMaterial({color:'#ff9b59'}));lamp.position.set(x,7.05,z);scene.add(lamp);
  addLight('#ff633e',2.4,11,x,6.6,z);
}

// A chunky improvised pistol, mounted to the camera so the player always owns the only weapon.
const weapon = new THREE.Group(); camera.add(weapon); weapon.position.set(.38,-.34,-.67); weapon.scale.setScalar(.62); weapon.rotation.set(-.04,-.04,0);
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(.19,.18,.49),darkMetal); gunBody.position.set(0,0,-.08); weapon.add(gunBody);
const gunSlide = new THREE.Mesh(new THREE.BoxGeometry(.17,.13,.35),trimMetal); gunSlide.position.set(0,.075,-.12); weapon.add(gunSlide);
const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(.14,.25,.16),rust); gunGrip.position.set(0,-.19,.02); gunGrip.rotation.x=-.18; weapon.add(gunGrip);
const gunMuzzle = new THREE.Mesh(new THREE.CylinderGeometry(.047,.047,.02,12),mat('#101014',.35,.8)); gunMuzzle.rotation.x=Math.PI/2;gunMuzzle.position.set(0,.01,-.34);weapon.add(gunMuzzle);
const gunSight = new THREE.Mesh(new THREE.BoxGeometry(.045,.07,.07),hazardMat);gunSight.position.set(0,.13,-.17);weapon.add(gunSight);
muzzleFlash=new THREE.Mesh(new THREE.ConeGeometry(.15,.43,8),new THREE.MeshBasicMaterial({color:'#ffb35a',transparent:true,opacity:.95}));muzzleFlash.rotation.x=-Math.PI/2;muzzleFlash.position.set(0,.01,-.64);muzzleFlash.visible=false;weapon.add(muzzleFlash);

function createDemon(x,z,index){
  const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
  const skin=new THREE.MeshStandardMaterial({color:index%2?'#773c37':'#604048',roughness:.72,emissive:'#20090d',emissiveIntensity:.28});
  const flesh2=new THREE.MeshStandardMaterial({color:'#9b5544',roughness:.72});
  const eyeMat=new THREE.MeshBasicMaterial({color:'#ff4b32'});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.43,.62,4,8),skin);torso.position.y=1.3;torso.castShadow=true;group.add(torso);
  torso.scale.set(1.05,1,0.82);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.34,12,10),flesh2);head.position.set(0,2.02,0);head.scale.set(.9,1.12,.85);head.castShadow=true;group.add(head);
  for(const s of [-1,1]){
    const horn=new THREE.Mesh(new THREE.ConeGeometry(.105,.43,7),darkMetal);horn.position.set(s*.23,2.37,-.01);horn.rotation.z=s*-.48;horn.castShadow=true;group.add(horn);
    const eye=new THREE.Mesh(new THREE.SphereGeometry(.065,8,6),eyeMat);eye.position.set(s*.13,2.08,-.28);group.add(eye);
    const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.13,.5,3,7),skin);arm.position.set(s*.56,1.35,-.01);arm.rotation.z=s*-.3;arm.name='arm'+s;group.add(arm);
    const claw=new THREE.Mesh(new THREE.ConeGeometry(.11,.34,6),darkMetal);claw.position.set(s*.66,.93,-.03);claw.rotation.x=Math.PI;group.add(claw);
    const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.17,.45,3,7),skin);leg.position.set(s*.22,.43,0);leg.name='leg'+s;group.add(leg);
  }
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.55,.035,6,16),new THREE.MeshBasicMaterial({color:'#a53d2b',transparent:true,opacity:.4}));ring.rotation.x=Math.PI/2;ring.position.y=.045;group.add(ring);
  const demon={group,hp:1,alive:true,speed:1.15+Math.random()*.27,phase:Math.random()*6,attack:0,index};enemies.push(demon);return demon;
}
[[-13,-12],[13,-11],[-13,12],[13,13]].forEach((p,i)=>createDemon(...p,i));

function addBullet(){
  const group=new THREE.Group();
  const shellMesh=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.22,10),new THREE.MeshStandardMaterial({color:'#c29969',metalness:.75,roughness:.27,emissive:'#55300b',emissiveIntensity:.45}));
  shellMesh.rotation.x=Math.PI/2;group.add(shellMesh);
  const tip=new THREE.Mesh(new THREE.ConeGeometry(.055,.11,10),new THREE.MeshStandardMaterial({color:'#ffd48a',metalness:.55,roughness:.25,emissive:'#8b4b10',emissiveIntensity:.45}));tip.rotation.x=-Math.PI/2;tip.position.z=-.15;group.add(tip);
  const glow=new THREE.Mesh(new THREE.SphereGeometry(.12,8,8),new THREE.MeshBasicMaterial({color:'#ff9c42',transparent:true,opacity:.17}));group.add(glow);
  const light=new THREE.PointLight('#ff7a36',1.4,3);group.add(light);
  scene.add(group);
  return {group,velocity:new THREE.Vector3(),grounded:false,settled:false,life:0,spin:0};
}

function sound(type){
  if(!soundOn)return;
  try{
    audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==='suspended')audioContext.resume();
    const now=audioContext.currentTime, osc=audioContext.createOscillator(), gain=audioContext.createGain();
    osc.connect(gain);gain.connect(audioContext.destination);
    if(type==='shot'){osc.type='sawtooth';osc.frequency.setValueAtTime(115,now);osc.frequency.exponentialRampToValueAtTime(37,now+.19);gain.gain.setValueAtTime(.18,now);gain.gain.exponentialRampToValueAtTime(.001,now+.22);osc.start(now);osc.stop(now+.23)}
    else if(type==='pickup'){osc.type='triangle';osc.frequency.setValueAtTime(480,now);osc.frequency.exponentialRampToValueAtTime(940,now+.15);gain.gain.setValueAtTime(.13,now);gain.gain.exponentialRampToValueAtTime(.001,now+.2);osc.start(now);osc.stop(now+.21)}
    else {osc.type='square';osc.frequency.setValueAtTime(105,now);osc.frequency.exponentialRampToValueAtTime(54,now+.2);gain.gain.setValueAtTime(.1,now);gain.gain.exponentialRampToValueAtTime(.001,now+.22);osc.start(now);osc.stop(now+.23)}
  }catch(e){}
}
function showToast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('show');toastTimer=1.8}
function updateHUD(){
  document.querySelector('#health-value').textContent=Math.max(0,Math.ceil(health));document.querySelector('#health-fill').style.width=Math.max(0,health)+'%';
  document.querySelector('#enemy-count').textContent=String(enemies.filter(e=>e.alive).length).padStart(2,'0');
  document.querySelector('#ammo-count').textContent=ammo?'01':'00';document.querySelector('#ammo-state').textContent=ammo?'ROUND LOADED':bullet?'ROUND ON FLOOR':'ROUND LOST';document.querySelector('#bullet-icon').classList.toggle('empty',!ammo);
  const pips=document.querySelectorAll('#enemy-pips i');enemies.forEach((e,i)=>pips[i]?.classList.toggle('dead',!e.alive));
}
function requestPickup(){if(!playing||ammo||!bullet)return;const d=player.distanceTo(bullet.group.position);if(d<2.1){scene.remove(bullet.group);bullet=null;ammo=true;weapon.visible=true;sound('pickup');showToast('ROUND RECOVERED // CHAMBERED');updateHUD()}else showToast('ROUND OUT OF REACH');}
function fire(){
  if(!playing||!ammo||fireCooldown>0)return;
  ammo=false;fireCooldown=.38;weapon.position.z=-.55;weapon.position.y=-.37;muzzleFlash.visible=true;setTimeout(()=>{if(muzzleFlash)muzzleFlash.visible=false},65);
  const dir=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).normalize();
  bullet=addBullet();bullet.group.position.copy(camera.position).addScaledVector(dir,.72);bullet.velocity.copy(dir).multiplyScalar(23);bullet.velocity.y+=.8;bullet.group.quaternion.copy(camera.quaternion);bullet.life=0;
  sound('shot');showToast('ROUND OUT // GO GET IT');updateHUD();
}
function damage(amount){if(hurtCooldown>0||!playing)return;health=Math.max(0,health-amount);hurtCooldown=.7;document.querySelector('#damage-flash').classList.add('show');setTimeout(()=>document.querySelector('#damage-flash').classList.remove('show'),150);sound('hurt');updateHUD();if(health<=0)endGame(false)}
function endGame(won){playing=false;document.exitPointerLock?.();const screen=document.querySelector('#end-screen');document.querySelector('#end-title').innerHTML=won?'ROOM<br><em>CLEARED.</em>':'YOU<br><em>FLATLINED.</em>';document.querySelector('#end-copy').textContent=won?'The foundry is quiet. For now.':'The foundry keeps another marine. Try a different route.';document.querySelector('#final-kills').textContent=`${String(kills).padStart(2,'0')} / 04`;screen.classList.remove('hidden')}
function startGame(){
  document.querySelector('#intro').classList.add('hidden');document.querySelector('#end-screen').classList.add('hidden');playing=true;
  if(!isTouch)canvas.requestPointerLock?.();
  updateHUD();
}
function resetGame(){
  enemies.forEach(e=>scene.remove(e.group));enemies.length=0;[[-13,-12],[13,-11],[-13,12],[13,13]].forEach((p,i)=>createDemon(...p,i));
  if(bullet){scene.remove(bullet.group);bullet=null}ammo=true;health=100;kills=0;player.set(0,1.65,12);velocity.set(0,0,0);yaw=0;pitch=0;camera.rotation.set(0,0,0);weapon.visible=true;weapon.position.set(.38,-.34,-.67);playing=false;updateHUD();document.querySelector('#intro').classList.remove('hidden');document.querySelector('#end-screen').classList.add('hidden');
}
function collides(x,z,r=.38){
  if(Math.abs(x)>18.8||Math.abs(z)>18.8)return true;
  for(const o of obstacles)if(Math.abs(x-o.x)<o.hw+r&&Math.abs(z-o.z)<o.hd+r)return true;
  return false;
}
function movePlayer(dx,dz){
  let nx=player.x+dx,nz=player.z+dz;
  if(!collides(nx,player.z))player.x=nx;
  if(!collides(player.x,nz))player.z=nz;
}
function updatePlayer(dt){
  const forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-moveInput.y;
  const strafe=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+moveInput.x;
  const len=Math.hypot(forward,strafe)||1;const f=forward/len,s=strafe/len;
  const speed=keys.has('ShiftLeft')?6.6:4.7;
  const dx=(-Math.sin(yaw)*f+Math.cos(yaw)*s)*speed*dt;
  const dz=(-Math.cos(yaw)*f-Math.sin(yaw)*s)*speed*dt;
  movePlayer(dx,dz);
  camera.position.copy(player);camera.rotation.set(pitch,yaw,0,'YXZ');
  const walking=Math.abs(f)+Math.abs(s)>.1;weapon.position.y=-.34+(walking?Math.sin(performance.now()*.012)*.012:0);weapon.position.x=.38+(walking?Math.cos(performance.now()*.006)*.008:0);
}
function updateEnemies(dt,time){
  for(const e of enemies){if(!e.alive)continue;e.phase+=dt*5;
    const dx=player.x-e.group.position.x,dz=player.z-e.group.position.z,dist=Math.hypot(dx,dz);
    if(dist>1.3){const speed=e.speed*(dist<4?1.18:1);const mx=dx/(dist||1)*speed*dt,mz=dz/(dist||1)*speed*dt;const nx=e.group.position.x+mx,nz=e.group.position.z+mz;
      if(!collides(nx,e.group.position.z,.48))e.group.position.x=nx;
      if(!collides(e.group.position.x,nz,.48))e.group.position.z=nz;
    }else if(e.attack<=0){damage(7);e.attack=1.5;showToast('CONTACT // MOVE!')}
    e.attack=Math.max(0,e.attack-dt);e.group.rotation.y=Math.atan2(dx,dz);e.group.position.y=Math.sin(e.phase)*.045;
    e.group.children.forEach(c=>{if(c.name==='arm1')c.rotation.z=-.3+Math.sin(e.phase)*.16;if(c.name==='arm-1')c.rotation.z=.3-Math.sin(e.phase)*.16;if(c.name==='leg1')c.rotation.x=Math.sin(e.phase)*.28;if(c.name==='leg-1')c.rotation.x=-Math.sin(e.phase)*.28});
  }
  if(enemies.every(e=>!e.alive))endGame(true);
}
function updateBullet(dt,time){
  if(!bullet)return;
  bullet.life+=dt;const b=bullet.group;
  if(!bullet.settled){
    bullet.velocity.y-=11.5*dt;
    const old=b.position.clone();b.position.addScaledVector(bullet.velocity,dt);
    // Bullet hits a demon, stays where it lands, and can be retrieved.
    for(const e of enemies){if(!e.alive)continue;const center=e.group.position.clone().add(new THREE.Vector3(0,1.38,0));if(b.position.distanceTo(center)<.73){
      e.alive=false;kills++;e.group.rotation.x=-.12;e.group.position.y=-.05;for(const m of e.group.children)if(m.material?.emissive)m.material.emissive.set('#080507');
      bullet.velocity.multiplyScalar(.16);bullet.velocity.y=Math.max(.4,bullet.velocity.y);showToast('DEMON DOWN // ROUND STILL LIVE');sound('pickup');updateHUD();break;
    }}
    const hitWall=collides(b.position.x,b.position.z,.12)||b.position.y>7.7;
    if(hitWall){b.position.copy(old);bullet.velocity.multiply(new THREE.Vector3(-.25,.25,-.25));bullet.velocity.y=Math.max(.7,Math.abs(bullet.velocity.y)*.45)}
    if(b.position.y<.14){b.position.y=.14;if(Math.abs(bullet.velocity.y)>.9){bullet.velocity.y=Math.abs(bullet.velocity.y)*.38;bullet.velocity.x*=.72;bullet.velocity.z*=.72}else{bullet.velocity.y=0;bullet.velocity.x*=.84;bullet.velocity.z*=.84;if(Math.hypot(bullet.velocity.x,bullet.velocity.z)<.35)bullet.settled=true}}
    bullet.spin+=dt*8;b.rotation.set(Math.PI/2,bullet.spin,Math.atan2(bullet.velocity.x,bullet.velocity.z));
  }else{b.position.y=.15+Math.sin(time*3)*.035;b.rotation.y+=dt*1.1;}
  const dist=player.distanceTo(b.position);
  const near=dist<2.1&&!ammo;
  document.querySelector('#pickup-prompt').classList.toggle('show',near&&!isTouch);
  document.querySelector('#pickup-button').classList.toggle('show',near&&isTouch);
  if(near&&isTouch)document.querySelector('#pickup-button').classList.add('show');
  if(bullet.settled&&dist>40){/* a round never despawns */}
}
function updateHUDPrompt(){if(ammo){document.querySelector('#pickup-prompt').classList.remove('show');document.querySelector('#pickup-button').classList.remove('show')}}

// Keyboard and pointer controls
window.addEventListener('keydown',e=>{keys.add(e.code);if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(e.code==='KeyE'||e.code==='KeyF')requestPickup();if(e.code==='Space')fire()});
window.addEventListener('keyup',e=>keys.delete(e.code));
document.addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas&&playing){yaw-=e.movementX*.0022;pitch=Math.max(-1.25,Math.min(1.25,pitch-e.movementY*.0022))}});
canvas.addEventListener('click',()=>{if(!playing)return;if(!isTouch&&document.pointerLockElement!==canvas)canvas.requestPointerLock?.();else if(!isTouch)fire()});
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement===canvas)showToast('');});

// Mobile: left virtual stick, drag the right side to look, dedicated fire and pickup controls.
const joystick=document.querySelector('#joystick'),knob=document.querySelector('#joy-knob');let joyPointer=null;
function joyMove(e){const r=joystick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;let dx=e.clientX-cx,dy=e.clientY-cy;const max=36,len=Math.hypot(dx,dy);if(len>max){dx=dx/len*max;dy=dy/len*max}knob.style.transform=`translate(${dx}px,${dy}px)`;moveInput={x:dx/max,y:dy/max}}
joystick.addEventListener('pointerdown',e=>{e.preventDefault();joyPointer=e.pointerId;joystick.setPointerCapture(e.pointerId);joyMove(e)});
joystick.addEventListener('pointermove',e=>{if(e.pointerId===joyPointer)joyMove(e)});
function joyEnd(e){if(e.pointerId===joyPointer){joyPointer=null;moveInput={x:0,y:0};knob.style.transform='translate(0,0)'}}
joystick.addEventListener('pointerup',joyEnd);joystick.addEventListener('pointercancel',joyEnd);
let lookPointer=null,lastLook={x:0,y:0};shell.addEventListener('pointerdown',e=>{if(!isTouch||e.target.closest('button,.joystick,.overlay'))return;lookPointer=e.pointerId;lastLook={x:e.clientX,y:e.clientY};shell.setPointerCapture(e.pointerId)});
shell.addEventListener('pointermove',e=>{if(e.pointerId!==lookPointer)return;const dx=e.clientX-lastLook.x,dy=e.clientY-lastLook.y;lastLook={x:e.clientX,y:e.clientY};yaw-=dx*.006;pitch=Math.max(-1.2,Math.min(1.2,pitch-dy*.006))});
shell.addEventListener('pointerup',e=>{if(e.pointerId===lookPointer)lookPointer=null});shell.addEventListener('pointercancel',e=>{if(e.pointerId===lookPointer)lookPointer=null});
const fireButton=document.querySelector('#fire-button');fireButton.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();fireButton.setPointerCapture(e.pointerId);fire()});
document.querySelector('#pickup-button').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();requestPickup()});
document.querySelector('#start-button').addEventListener('click',startGame);document.querySelector('#restart-button').addEventListener('click',resetGame);document.querySelector('#sound-toggle').addEventListener('click',e=>{soundOn=!soundOn;e.currentTarget.innerHTML=soundOn?'♫ <span>SOUND</span>':'♪ <span>MUTED</span>'});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,isTouch?1.5:2))});

function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04),time=clock.elapsedTime;
  if(playing){fireCooldown=Math.max(0,fireCooldown-dt);hurtCooldown=Math.max(0,hurtCooldown-dt);if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)document.querySelector('#toast').classList.remove('show')}updatePlayer(dt);updateEnemies(dt,time);updateBullet(dt,time);updateHUDPrompt()}
  renderer.render(scene,camera);
}
updateHUD();document.querySelector('#input-note').textContent=isTouch?'LEFT STICK MOVE · DRAG TO LOOK · FIRE / PICK UP BUTTONS':'WASD MOVE · MOUSE LOOK · CLICK FIRE · E PICK UP';document.querySelector('#controls-hint').innerHTML=isTouch?'LEFT STICK <span>·</span> DRAG TO LOOK':'<kbd>WASD</kbd> MOVE <span>·</span> <kbd>MOUSE</kbd> AIM <span>·</span> <kbd>CLICK</kbd> FIRE';animate();
