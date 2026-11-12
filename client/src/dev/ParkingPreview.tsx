import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PARKING_HEIGHT, generateParking, missionLine, parkingFits, parkingContains, parkingArea, parkingFloorLabel, type ParkingMission, type ParkingMinutes, type ParkingPoint } from '@backrooms/shared';
import { Input } from '../game/input';
import { ParkingAudio, type ParkingCue } from '../game/parking-audio';
import { ParkingLevel } from '../game/parking';
import { ParkingSkinwalkers } from '../game/parking-skinwalkers';
import { useAccount } from '../account';
import { guestLook } from '../game/Computer';
import { settings } from '../settings';
import './parking-preview.css';

/** Local solo mission preview. */
export default function ParkingPreview() {
  const account=useAccount(),appearance=account.me?.loadout??guestLook(),lookRef=useRef(appearance),skinRef=useRef<ParkingSkinwalkers>();lookRef.current=appearance;
  useEffect(()=>{skinRef.current?.setLook(appearance);},[appearance.color,appearance.head,appearance.back]);
  const roundAction=useRef<()=>void>(()=>{}),[roundMode,setRoundMode]=useState('START LOCAL ROUND');
  const host = useRef<HTMLDivElement>(null), status = useRef<HTMLDivElement>(null), prompt = useRef<HTMLDivElement>(null), storage = useRef<HTMLDivElement>(null),roundUI=useRef<HTMLDivElement>(null);
  const repairHeld=useRef(false),repairUI=useRef<HTMLDivElement>(null),repairCircle=useRef<SVGCircleElement>(null),repairPercent=useRef<HTMLSpanElement>(null),objectiveUI=useRef<HTMLDivElement>(null);
  const useInteraction = useRef<() => void>(() => {});
  const sound = useRef<ParkingAudio>(), mutedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const inspect = useRef<(kind: string) => void>(() => {});
  const releaseInput = useRef<(leaving?: boolean) => void>(() => {});
  const [loading, setLoading] = useState('GENERATING PARKING'), [error, setError] = useState('');
  const params = new URLSearchParams(location.search);
  const seed = (Number(params.get('seed')) || 1) >>> 0;
  const mission: ParkingMission = params.get('mission') === 'generators' ? 'generators' : params.get('mission') === 'survive' ? 'survive' : 'tapes';
  const minutes: ParkingMinutes = params.get('minutes') === '15' ? 15 : params.get('minutes') === '10' ? 10 : 5;
  const low = params.has('low');

  useEffect(() => {
    setRoundMode('START LOCAL ROUND');
    const el = host.current!;
    let cancelled = false, frame = 0, level: ParkingLevel | undefined, input: Input | undefined;
    let resize: ResizeObserver | undefined, renderer: THREE.WebGLRenderer | undefined;
    let cleanupDebug = () => {};
    let roundLoading=false, foreground=true, audioUnavailable=false;
    const unlockAudio = () => {
      if (document.hidden) return;
      foreground = true;
      if (audioUnavailable || mutedRef.current) return;
      try {
        sound.current ??= new ParkingAudio();
        sound.current.resume();
      } catch {
        audioUnavailable = true;
      }
    };
    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    const run = async () => {
      const map = generateParking(seed, { mission, minutes });
      renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.5)); renderer.setSize(el.clientWidth, el.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
      el.appendChild(renderer.domElement); const gl=renderer.getContext(),depthBits=gl.getParameter(gl.DEPTH_BITS) as number;
      const camera = new THREE.PerspectiveCamera(72, el.clientWidth / el.clientHeight, .12, 40);
      camera.rotation.order = 'YXZ';
      level = new ParkingLevel(map, renderer, low);
      await level.load(text => { if (!cancelled) setLoading(text); });
      if (cancelled) return;
      input = new Input(renderer.domElement); input.active = true;
      releaseInput.current = (leaving = false) => { if (input) { input.active = !leaving; input.unlock(); } };
      const state: ParkingPoint = { ...map.spawn };
      let stride=0, ambienceClock=0, nextMetal=6, nextMix=0, unlocked=false;
      let glitchStage=0, reducedGlitch=false;
      const emit = (cue: ParkingCue, source?: ParkingPoint) => {
        const audio = sound.current;
        if (!audio || mutedRef.current || !foreground || document.hidden || skinRef.current?.paused) return;
        if (!source) { audio.play(cue); return; }
        if (source.floor !== state.floor) return;
        const dy = source.y <= map.floors[source.floor].y+.1 && cue !== 'drip' ? .8 : 0;
        const x = source.x-state.x, z = source.z-state.z, distance = Math.hypot(x,z,source.y+dy-state.y-1.65);
        if (distance > 24) return;
        const pan = THREE.MathUtils.clamp((x*Math.cos(yaw)-z*Math.sin(yaw))/Math.max(2,Math.hypot(x,z)),-1,1);
        const blocked = distance > 2.4 && !level?.lineOfSight({ ...state,y:state.y+1.65 },{ ...source,y:source.y+dy });
        audio.play(cue,(blocked ? .48 : 1)/(1+(distance/5)**2),pan,blocked);
      };
      level.onSound = emit;
      roundAction.current=()=>{
        const current=skinRef.current;
        if(level?.repair.finished)return;
        if(current&&current.hp>0){current.paused=!current.paused;if(current.paused){sound.current?.stopCues();sound.current?.environment(false);}else current.clearDebug();setRoundMode(current.paused?'RESUME LOCAL ROUND':'PAUSE LOCAL ROUND');return;}
        if(roundLoading)return;if(current&&current.hp<=0){Object.assign(state,map.spawn);level?.retrySurvival();sound.current?.resetEncounters();stride=0;unlocked=level?.elevatorUnlocked??false;}roundLoading=true;current?.dispose();skinRef.current=undefined;setLoading('LOADING LOCAL SKINWALKER ROUND');
        void ParkingSkinwalkers.load(level!,lookRef.current,{...state},low).then(round=>{if(cancelled){round.dispose();return;}skinRef.current=round;setRoundMode('PAUSE LOCAL ROUND');setLoading('');roundLoading=false;}).catch(e=>{roundLoading=false;setLoading('');setError(String(e));});
      };
      let yaw = .45, pitch = .04, last = performance.now(), elapsed = 0, nextHud = 0, survivalClockRunning = false;
      const flash = new THREE.SpotLight(0xd8dfd5, 12, 18, .38, .6, 1.4);
      const aim = new THREE.Object3D(); level.scene.add(flash, aim); flash.target = aim;
      let lightingInspection=false, flashlight = true, inspectionLight=0, inspectionGenerator=0, inspectionTape=0, inspectionProp = 0, inspectionRoom = 0, selectedRoom = '';
      let paintScan: { floor:number; from:number; to:number; z:number; targetX:number; targetZ:number } | undefined;
      const debug = { map, state, camera, renderer, level, teleport(floor: number, x?: number, z?: number) {
        if (floor < 0 || floor >= map.floors.length) return;
        const b = map.floors[floor].bounds; x ??= b.x + b.w / 2; z ??= b.z + b.d / 2;
        const tx = x, tz = z;
        const p = parkingFits(map, x, z, -floor * PARKING_HEIGHT) ?? map.nav.filter(n => n.floor === floor && Math.abs(n.y + floor * PARKING_HEIGHT) < .01).sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))[0];
        if (p) Object.assign(state, p);
      }, get position() { return { ...state }; } };
      useInteraction.current = () => { const round=skinRef.current; if(level&&!level.repair.finished&&(!round||(!round.paused&&round.hp>0)))level.interact(camera, state); };
      const inspectView = (kind: string) => {
        if(level?.repair.finished)return;
        paintScan=undefined; lightingInspection=kind==='lighting'; nextHud=0; stride=0;
        const f = map.floors[state.floor];
        if (kind.endsWith('-mid')) {
          const l = map.links.find(l => l.kind === kind.slice(0, -4) && (l.top === f.index || l.bottom === f.index)) ?? map.links.find(l => l.kind === kind.slice(0, -4));
          if (l) {
            const p = parkingFits(map, l.x + l.w / 2, l.z + l.d / 2, -l.top * PARKING_HEIGHT - PARKING_HEIGHT / 2);
            if (p) { Object.assign(state, p); yaw = -Math.PI / 2; pitch = -.6; }
          }
          return;
        }
        if (['room-in', 'door', 'door-side', 'locker', 'locker-side'].includes(kind)) {
          const choices = map.floors.flatMap(owner => owner.rooms.map(room => ({ owner, room })));
          let choice = choices.find(c => c.room.id === selectedRoom) ?? choices.find(c => c.owner.index === state.floor) ?? choices[0];
          if (kind === 'room-in') { const n = inspectionRoom++, pool = choices.filter(c => c.room.door.inward === (n % 2 ? 1 : -1)); choice = pool[Math.floor(n / 2) % pool.length] ?? choices[n % choices.length]; }
          if (!choice) return;
          const { owner, room } = choice; selectedRoom = room.id;
          let tx = room.door.x, tz = room.door.z, ty = owner.y + 1.2;
          if (kind === 'door-side') { const target = level?.doorView(room); debug.teleport(owner.index, room.door.x + room.door.inward * 1.4, room.door.z + .9); tx = target?.x ?? tx; tz = target?.z ?? tz; ty = target?.y ?? ty; }
          else if (kind === 'door') debug.teleport(owner.index, tx - room.door.inward * 1.5, tz);
          else if (kind === 'locker' || kind === 'locker-side') {
            const l = room.lockers![0], item = level?.lockerView(room, kind === 'locker-side'); tx = item?.x ?? l.x; tz = item?.z ?? l.z; ty = item?.y ?? owner.y + 1.05;
            debug.teleport(owner.index, l.x - room.door.inward * (kind === 'locker-side' ? .85 : 1.1), l.z + (kind === 'locker-side' ? .65 : 0));
          } else { debug.teleport(owner.index, room.x + 3, room.z + 3); tx = room.door.x + room.door.inward * 5.4; tz = room.z + 1.8; ty = owner.y + 1.2; }
          yaw = Math.atan2(state.x - tx, state.z - tz); pitch = Math.atan2(ty - state.y - 1.65, Math.hypot(state.x - tx, state.z - tz)); return;
        }
        if(kind==='ceiling'||kind==='wall'||kind==='sign'){
          if(kind==='ceiling'){debug.teleport(0,map.spawn.x,map.spawn.z);yaw=-Math.PI/2;pitch=.85;}
          else if(kind==='wall'){debug.teleport(f.index,f.bounds.x+7.8,f.bounds.z+2);yaw=Math.PI/2;pitch=.02;}
          else{const p=f.pillars[0];if(p){debug.teleport(f.index,p.x+p.w/2,p.z+p.d+1.8);yaw=Math.atan2(state.x-p.x-p.w/2,state.z-p.z-p.d-.0175);pitch=Math.atan2(.05,Math.hypot(state.x-p.x-p.w/2,state.z-p.z-p.d-.0175));}}
          return;
        }
        if(kind==='smiler'||kind==='smiler-near') {
          const view=skinRef.current?.inspectSmiler(kind==='smiler-near');if(view){Object.assign(state,view.position);yaw=Math.atan2(state.x-view.target.x,state.z-view.target.z);pitch=Math.atan2(view.target.y-state.y-1.65,Math.hypot(state.x-view.target.x,state.z-view.target.z));flashlight=false;}return;
        }
        if(kind==='encounter'||kind==='encounter-near') {
          const view=skinRef.current?.inspect(kind==='encounter-near');
          if(view){Object.assign(state,view.position);yaw=Math.atan2(state.x-view.target.x,state.z-view.target.z);pitch=Math.atan2(view.target.y-state.y-1.65,Math.hypot(state.x-view.target.x,state.z-view.target.z));}
          return;
        }
        if(kind==='elevator') {
          const e=map.elevator;
          const p=level?.fits(e.x+e.inward*1.6,e.z,e.y);
          if(p){Object.assign(state,p);yaw=e.yaw;pitch=-.11;flashlight=true;}
          return;
        }
        if(kind==='generator'||kind==='tape') {
          const view=kind==='generator'?level?.generatorView(inspectionGenerator++):level?.tapeView(inspectionTape++);
          if(view){Object.assign(state,view.position);yaw=Math.atan2(state.x-view.target.x,state.z-view.target.z);pitch=Math.atan2(view.target.y-state.y-1.65,Math.hypot(state.x-view.target.x,state.z-view.target.z));flashlight=true;}
          return;
        }
        if(kind==='lighting') {
          const l=level?.lightingView(f.index,inspectionLight++);
          if(l){debug.teleport(l.floor,l.x+3,l.z+3);yaw=Math.atan2(state.x-l.x,state.z-l.z);pitch=.12;flashlight=false;}
          return;
        }
        if(kind==='atmosphere') {
          const a=level?.atmosphereView(f.index);
          if(a){debug.teleport(a.floor,a.x+3,a.z+3);yaw=Math.atan2(state.x-a.x,state.z-a.z);pitch=-.04;}
          return;
        }
        if(kind==='damage') {
          const a=level?.damageViews.find(a=>a.floor===f.index);
          if(a){debug.teleport(a.floor,a.x+a.nx*1.8,a.z+a.nz*1.8);yaw=Math.atan2(state.x-a.x,state.z-a.z);pitch=Math.atan2(a.y-state.y-1.65,Math.hypot(state.x-a.x,state.z-a.z));}
          return;
        }
        if (kind === 'asphalt') {
          debug.teleport(0,map.spawn.x,map.spawn.z); const directions=[[1,0],[-1,0],[0,1],[0,-1]];
          const [dx,dz]=directions.find(([x,z])=>[1,2,3].every(d=>!!level?.fits(state.x+x*d,state.z+z*d,state.y)))??directions[0];
          yaw=Math.atan2(-dx,-dz);pitch=-.65;flashlight=true;return;
        }
        if (kind === 'paint' || kind==='paint-scan') {
          const rows = new Map<string, typeof f.bays>();
          for (const b of f.bays) { const key = `${b.cz}/${b.yaw}`; if (!rows.has(key)) rows.set(key, []); rows.get(key)!.push(b); }
          let best: typeof f.bays = [];
          for (const row of rows.values()) { row.sort((a,b) => a.cx-b.cx); let run: typeof f.bays = []; for (const b of row) { if (run.length && b.cx-run[run.length-1].cx > 3.01) run=[]; run.push(b); if (run.length>best.length) best=[...run]; } }
          if (best.length) { const b=best[0], sign=Math.cos(b.yaw), line=b.cz+sign*b.d/2; debug.teleport(f.index,b.cx-1.4,line+(kind==='paint-scan'?sign*.45:-sign*.8)); const tx=Math.min(best[best.length-1].cx+1.5,state.x+14); yaw=Math.atan2(state.x-tx,state.z-line);pitch=Math.atan2(f.y+.0025-state.y-1.65,Math.hypot(tx-state.x,line-state.z)); if(kind==='paint-scan'&&tx-state.x>4)paintScan={floor:f.index,from:state.x,to:tx-3,z:state.z,targetX:tx,targetZ:line}; }
          return;
        }
        if (kind === 'fog') {
          const nodes = map.nav.map((n, i) => ({ n, i })).filter(({ n }) => n.floor === f.index && Math.abs(n.y - f.y) < .01);
          const grid = new Map(nodes.map(v => [`${v.n.x.toFixed(2)}/${v.n.z.toFixed(2)}`, v]));
          let best = { n: nodes[0]?.n, dx: 1, dz: 0, distance: 0 };
          for (const { n, i } of nodes) for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            let previous = i, distance = 0;
            for (let d = 3; d <= 45; d += 3) { const next = grid.get(`${(n.x + dx * d).toFixed(2)}/${(n.z + dz * d).toFixed(2)}`); if (!next || !map.nav[previous].edges.includes(next.i)) break; distance = d; previous = next.i; }
            if (distance > best.distance) best = { n, dx, dz, distance };
          }
          if (best.n) { Object.assign(state, best.n); yaw = Math.atan2(-best.dx, -best.dz); pitch = 0; }
          return;
        }
        if (kind === 'pillar' || kind === 'corner') {
          const r = kind === 'pillar' ? f.pillars[0] : f.walls.find(w => w.x > f.bounds.x + 10 && Math.max(w.w, w.d) >= 9);
          if (r) { const distance = kind === 'pillar' ? 5.5 : 2; debug.teleport(f.index, r.x - distance, r.z - distance); yaw = Math.atan2(state.x - r.x - r.w / 2, state.z - r.z - r.d / 2); pitch = kind === 'pillar' ? Math.atan2(.15, Math.hypot(state.x-r.x-r.w/2,state.z-r.z-r.d/2)) : -.04; }
          return;
        }
        if (kind === 'portal') {
          const l = map.links.find(l => l.top === f.index) ?? map.links[0];
          debug.teleport(l.top, l.x - 3, l.z + l.d / 2); yaw = -Math.PI / 2; pitch = 0; return;
        }
        if (kind === 'sector') {
          const wall = f.walls.find(w => w.x > f.bounds.x + 10 && w.x < f.bounds.x + f.bounds.w - 10 && Math.max(w.w, w.d) >= 9);
          if (wall) { debug.teleport(f.index, wall.x - 6, wall.z - 6); yaw = Math.atan2(state.x - wall.x - wall.w / 2, state.z - wall.z - wall.d / 2); pitch = -.06; }
          return;
        }
        let aimY: number | undefined;
        let target: { x: number; z: number; floor: number; y: number } | undefined;
        if (kind === 'services' || kind === 'pipe' || kind === 'duct') {
          const service = f.services.find(s => s.kind === (kind === 'services' ? 'duct' : kind)) ?? f.services[0];
          if (service) { target = { x: service.x + service.w / 2, z: service.z + service.d / 2, floor: f.index, y: f.y }; aimY = f.y + PARKING_HEIGHT - .95; }
        } else if (kind === 'props' || kind === 'sector') {
          const r = kind === 'props' ? f.props[inspectionProp++ % f.props.length] : f.walls.find(w => w.x > f.bounds.x + 10 && w.x < f.bounds.x + f.bounds.w - 10 && Math.max(w.w, w.d) >= 9);
          if (r) target = { x: r.x + r.w / 2, z: r.z + r.d / 2, floor: f.index, y: f.y };
        }
        else if (kind === 'ramp' || kind === 'stairs') {
          const l = map.links.find(l => l.kind === kind && l.top === f.index) ?? map.links.find(l => l.kind === kind);
          if (l) target = { x: l.x + 2, z: l.z + l.d / 2, floor: l.top, y: -l.top * PARKING_HEIGHT };
        } else {
          const owner = map.floors.find(g => (kind === 'room' ? g.rooms : g.cars).length && g.index >= f.index) ?? map.floors.find(g => (kind === 'room' ? g.rooms : g.cars).length);
          if (owner) { const r = kind === 'room' ? owner.rooms[0].door : owner.cars[0]; target = { x: r.x, z: r.z, floor: owner.index, y: owner.y }; }
        }
        if (!target) return;
        const t = target;
        const candidates = map.nav.filter(n => n.floor === t.floor && Math.abs(n.y - t.y) < .01 && parkingFits(map, n.x, n.z, n.y));
        candidates.sort((a, b) => Math.abs(Math.hypot(a.x - t.x, a.z - t.z) - 4) - Math.abs(Math.hypot(b.x - t.x, b.z - t.z) - 4));
        if (candidates[0]) { Object.assign(state, candidates[0]); yaw = Math.atan2(state.x - t.x, state.z - t.z); pitch = aimY === undefined ? -.08 : Math.atan2(aimY - (state.y + 1.65), Math.hypot(state.x - t.x, state.z - t.z)); }
      };
      inspect.current = inspectView;
      const view = params.get('view'); if (view) inspectView(view);
      (window as unknown as { __parking?: typeof debug & { inspect: typeof inspectView } }).__parking = Object.assign(debug, { inspect: inspectView });
      const jumpFloor = (e: KeyboardEvent) => { if (e.code === 'PageDown' || e.code === 'PageUp') { e.preventDefault(); debug.teleport(state.floor + (e.code === 'PageDown' ? 1 : -1)); } };
      const cancelRepair=()=>{foreground=false;sound.current?.stopCues();sound.current?.environment(false);survivalClockRunning=false;skinRef.current?.smilers.ai.resetGaze();if(skinRef.current&&!level?.repair.finished){skinRef.current.paused=true;setRoundMode(skinRef.current.hp>0?'RESUME LOCAL ROUND':'RETRY ENCOUNTER');}repairHeld.current=false;input?.clear();level?.holdRepair(camera,state,performance.now()/1000,false);};
      const hiddenRepair=()=>{if(document.hidden)cancelRepair();};
      const focusAudio=()=>{foreground=true;};
      window.addEventListener('focus',focusAudio);window.addEventListener('blur',cancelRepair);document.addEventListener('visibilitychange',hiddenRepair);
      window.addEventListener('keydown', jumpFloor);
      cleanupDebug = () => { window.removeEventListener('focus',focusAudio);window.removeEventListener('blur',cancelRepair);document.removeEventListener('visibilitychange',hiddenRepair);window.removeEventListener('keydown', jumpFloor); delete (window as unknown as { __parking?: typeof debug }).__parking; };
      resize = new ResizeObserver(() => {
        if (!renderer) return; const w = el.clientWidth, h = el.clientHeight;
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      }); resize.observe(el);
      const tick = (now: number) => {
        if (cancelled || !renderer || !level || !input) return;
        const frameSeconds = Math.max(0,(now-last)/1000), dt = Math.min(frameSeconds,.04); last = now; elapsed += dt;
        const c = input.read();
        if(paintScan&&!input.locked){const scan=paintScan;state.x=THREE.MathUtils.lerp(scan.from,scan.to,(Math.sin(now*.00055)+1)/2);state.z=scan.z;state.y=map.floors[scan.floor].y;state.floor=scan.floor;yaw=Math.atan2(state.x-scan.targetX,state.z-scan.targetZ);pitch=Math.atan2(.0025-1.65,Math.hypot(scan.targetX-state.x,scan.targetZ-state.z));}
        if(c.pause&&!level.repair.finished&&skinRef.current&&skinRef.current.hp>0){skinRef.current.paused=true;sound.current?.stopCues();sound.current?.environment(false);setRoundMode('RESUME LOCAL ROUND');}
        const round=skinRef.current,canPlay=!level.repair.finished&&(!round||(!round.paused&&round.hp>0));
        const survivalActive=mission==='survive'&&!!round&&canPlay&&foreground&&!document.hidden;
        if(survivalActive&&survivalClockRunning)level.advanceSurvival(frameSeconds);
        survivalClockRunning=survivalActive;
        if (input.locked&&canPlay) {
          if(c.move.lengthSq()>.01||c.look.lengthSq()>.0001)round?.clearDebug();
          paintScan=undefined; lightingInspection=false;
          yaw -= c.look.x; pitch = THREE.MathUtils.clamp(pitch - c.look.y, -1.35, 1.35);
          const speed = c.run ? 6.0 : 3.1;
          const dx = (c.move.x * Math.cos(yaw) - c.move.y * Math.sin(yaw)) * speed * dt;
          const dz = (-c.move.x * Math.sin(yaw) - c.move.y * Math.cos(yaw)) * speed * dt;
          // Por ejes para deslizarse por pilares; altura compartida en rampas/escaleras.
          const previous = { ...state };
          const px = level.fits(state.x + dx, state.z, state.y); if (px) Object.assign(state, px);
          const pz = level.fits(state.x, state.z + dz, state.y); if (pz) Object.assign(state, pz);
          stride += Math.hypot(state.x-previous.x,state.z-previous.z);
          if(stride >= (c.run ? 1.52 : 1.34)){
            level.audioFootstep(state,c.run);
            stride=0;
          }
          if(level.enterElevator(previous,state)){
            if(round)round.paused=true;
            setRoundMode('ESCAPED');
            input.unlock();
            nextHud=0;
          }
        }
        if (c.flash) { flashlight = !flashlight; emit('flashlight'); }
        camera.position.set(state.x, state.y + 1.65, state.z); camera.rotation.set(pitch, yaw, 0);
        camera.updateMatrixWorld();
        if (c.bag&&canPlay&&!level.repair.finished) level.interact(camera, state);
        if(mission==='generators') {
          level.holdRepair(camera,state,now/1000,!document.hidden&&canPlay&&(!!c.bagHeld||repairHeld.current));
          if(repairUI.current)repairUI.current.hidden=!level.repair.active;
          repairCircle.current?.setAttribute('stroke-dashoffset',String(100-level.repair.progress*100));
          if(repairPercent.current)repairPercent.current.textContent=`${Math.floor(level.repair.progress*100)}%`;
          repairUI.current?.setAttribute('aria-valuenow',String(level.repair.progress*8));
        }
        flash.position.copy(camera.position); aim.position.set(0, 0, -10).applyMatrix4(camera.matrixWorld);
        flash.intensity = flashlight ? 12 : 0;
        level.update(elapsed, state, now/1000);
        if(round&&!level.repair.finished&&foreground&&!document.hidden){
          round.ai.pressure=level.pressure;
          const beam=new THREE.Vector3();
          camera.getWorldDirection(beam);
          const before=round.hp;
          round.update(dt,{pos:state,eye:{x:camera.position.x,y:camera.position.y,z:camera.position.z},beam:flashlight?beam:null,noise:input.locked&&c.move.lengthSq()>.1?(c.run?14:8):0,alive:round.hp>0},Math.min(frameSeconds,.25));
          if(!round.paused&&before>0){
            const smiler=round.smilers.ai.sections.find(section=>section.active)?.active;
            sound.current?.encounters(round.ai.agents,smiler,state,round.ai.time,emit);
          }
          if(round.hp<before)emit(round.hp>0?'hurt':'death');
          if(before>0&&round.hp===0){setRoundMode('RETRY ENCOUNTER');input.unlock();repairHeld.current=false;}
        }
        const gaze = round?.smilers.ai;
        const exposed = !!round && foreground && !document.hidden && !round.paused && round.hp > 0 && !level.repair.finished;
        if (!exposed) gaze?.resetGaze();
        const nextStage = exposed ? Math.floor((gaze?.gazeSeconds ?? 0) + 1e-6) : 0;
        if (nextStage !== glitchStage || settings.reduceMotion !== reducedGlitch) {
          glitchStage = nextStage;
          reducedGlitch = settings.reduceMotion;
          el.toggleAttribute('data-smiler-gaze', glitchStage > 0);
          el.toggleAttribute('data-reduce-motion', reducedGlitch);
          el.style.setProperty('--gaze-strength', String(glitchStage / 10));
        }
        if(level.elevatorUnlocked&&!unlocked)emit('unlock');
        unlocked=level.elevatorUnlocked;
        const audible=foreground&&!document.hidden&&!level.repair.finished&&(!round||(!round.paused&&round.hp>0));
        if(audible)ambienceClock+=dt;
        if(elapsed>=nextMix&&sound.current){
          const mix=level.audioEnvironment(state);
          sound.current.environment(audible,mix.room,mix.lighting,mix.engine);
          nextMix=elapsed+.075;
          if(audible&&!mix.room&&ambienceClock>=nextMetal){
            const services=map.floors[state.floor].services.filter(s=>Math.hypot(s.x+s.w/2-state.x,s.z+s.d/2-state.z)<21);
            const service=services[Math.floor(Math.random()*services.length)];
            if(service)emit(level.pressure>.35&&Math.random()<level.pressure?'metal':'pipe',{x:service.x+service.w/2,y:map.floors[state.floor].y+2.8,z:service.z+service.d/2,floor:state.floor});
            nextMetal=ambienceClock+(9+Math.random()*12)*(1-.6*level.pressure);
          }
        }
        const submitStart=performance.now(); renderer.render(level.scene, camera); const submitMs=performance.now()-submitStart;
        if (elapsed > nextHud && status.current) {
          const safe = map.floors[state.floor].rooms.some(r => parkingContains(r, state.x, state.z));
          const bounds = map.floors[state.floor].bounds;
          status.current.textContent = `FLOOR ${parkingFloorLabel(state.floor)} / ${map.floors.length} · AREA ${String(parkingArea(map.floors[state.floor], state.x)).padStart(2,'0')} · ${bounds.w} × ${bounds.d} M DECK @ ${bounds.x},${bounds.z} · SEED ${seed}${safe ? ' · SAFE ROOM' : ''} · ${renderer.info.render.calls} DRAWS | ${lightingInspection?level.lightingStatus():''} | CPU UPDATE ${level.performance.updateMs.toFixed(2)} / FOCUS ${level.performance.focusMs.toFixed(2)} / SUBMIT ${submitMs.toFixed(2)} MS | RAYS ${level.performance.raycasts}/${level.performance.candidates} · DEPTH ${depthBits} BITS${paintScan ? ` · PAINT SCAN ${Math.hypot(state.x-paintScan.targetX,state.z-paintScan.targetZ).toFixed(1)} M` : ''}`;
          if (prompt.current) prompt.current.textContent = level.prompt(camera, state);
          if(roundUI.current)roundUI.current.textContent=round&&!level.repair.finished?`LOCAL ROUND - HEALTH ${round.hp}/100 ${round.hp<=0?' - DEAD':round.paused?' - PAUSED':round.recentHit()?' - HIT':''} | ${round.debug()}`:'';
          if(objectiveUI.current){
            const seconds=Math.ceil(level.survivalRemaining);
            const pendingFloors = mission === 'generators' ? map.floors.filter(f => !level!.floorPowered(f.index)).map(f => parkingFloorLabel(f.index)) : [];
            const floorHint = pendingFloors.length ? ` | GENERATORS LEFT ON ${pendingFloors.join(', ')}` : '';
            const objective=mission==='generators'
              ? `GENERATORS ${level.repair.repaired}/${level.repair.total}${floorHint} | FLOOR ${parkingFloorLabel(state.floor)} POWER ${level.floorPowered(state.floor)?'ON':'OFF'}`
              : mission==='tapes'?`VHS ${missionLine({ kind: 'tapes', goal: map.objectives.length, progress: level.tapesCollected })}`
              : `${missionLine({ kind: 'survive', goal: minutes * 60, progress: minutes * 60 - seconds })}${!round?' | START LOCAL ROUND':round.paused&&round.hp>0?' | PAUSED':''}`;
            objectiveUI.current.textContent=level.repair.finished?'ESCAPED THROUGH THE ELEVATOR':`${objective} | ELEVATOR ${level.elevatorOpen?'OPEN - STEP INSIDE':level.elevatorUnlocked?'UNLOCKED':'LOCKED'}`;
          }
          if (storage.current) storage.current.textContent = `PREVIEW STORAGE · WATER ${level.inventory.WATER} · FLASHLIGHT ${level.inventory.FLASHLIGHT}`;
          nextHud = elapsed + (lightingInspection ? .04 : .15);
        }
        frame = requestAnimationFrame(tick);
      };
      setLoading(''); frame = requestAnimationFrame(tick);
    };
    void run().catch(e => {
      console.error('parking preview', e);
      level?.dispose(); renderer?.dispose(); renderer?.domElement.remove();
      if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(''); }
    });
    return () => {
      cancelled = true;
      el.removeAttribute('data-smiler-gaze');
      el.removeAttribute('data-reduce-motion');
      el.style.removeProperty('--gaze-strength');
      window.removeEventListener('pointerdown',unlockAudio,true);window.removeEventListener('keydown',unlockAudio,true);
      sound.current?.dispose();sound.current=undefined;
      cancelAnimationFrame(frame); resize?.disconnect(); input?.dispose(); cleanupDebug();
      releaseInput.current = () => {}; inspect.current = () => {}; useInteraction.current = () => {};
      skinRef.current?.dispose();skinRef.current=undefined;roundAction.current=()=>{};level?.dispose(); renderer?.dispose(); renderer?.domElement.remove();
    };
  }, [seed, mission, minutes, low]);

  const link = (kind: ParkingMission, duration = 5) => `/?parking&seed=${seed}&mission=${kind}&minutes=${duration}${low ? '&low' : ''}`;
  return <div className="parking-preview">
    <div className="parking-preview-canvas" ref={host} />
    <header><strong>THE HABITABLE ZONE</strong><span>{roundMode==='ESCAPED'?'ESCAPED - SOLO PREVIEW':roundMode==='START LOCAL ROUND'?'LOCAL MISSION - SOLO PREVIEW':'LOCAL ENTITY ROUND - SOLO PREVIEW'}</span><div ref={status} /></header>
    <nav aria-label="Preview profiles" onMouseDown={e => e.stopPropagation()} onClick={e => releaseInput.current(!!(e.target as Element).closest('a'))}>
      {['smiler', 'smiler-near', 'encounter', 'encounter-near', ...(mission==='generators'?['generator']:mission==='tapes'?['tape']:[]), 'lighting', 'atmosphere', 'damage', 'asphalt', 'paint', 'paint-scan', 'ceiling', 'wall', 'sign', 'fog', 'room-in', 'door', 'door-side', 'locker', 'locker-side', 'corner', 'pillar', 'portal', 'ramp', 'ramp-mid', 'stairs', 'stairs-mid', 'services', 'pipe', 'duct', 'sector', 'props', 'room', 'elevator', 'car'].map(kind => <button key={kind} title={kind === 'props' ? 'CYCLE BARRIER, CONE, TRASH CAN' : undefined} onClick={() => inspect.current(kind)}>{kind.toUpperCase()}</button>)}
      <button disabled={roundMode==='ESCAPED'} onClick={()=>roundAction.current()}>{roundMode}</button>
      <button onClick={() => useInteraction.current()}>INTERACT [E]</button>
      <button aria-label="Preview sound" aria-pressed={!muted} onClick={() => {
        mutedRef.current=!mutedRef.current;
        setMuted(mutedRef.current);
        sound.current?.setLocalMute(mutedRef.current);
        if(!mutedRef.current)sound.current?.resume();
      }}>{muted?'SOUND OFF':'SOUND ON'}</button>
      {mission==='generators'&&<button onPointerDown={e=>{repairHeld.current=true;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={()=>repairHeld.current=false} onPointerCancel={()=>repairHeld.current=false} onLostPointerCapture={()=>repairHeld.current=false}>HOLD REPAIR [E]</button>}
      <a href={link('tapes')} aria-current={mission === 'tapes' ? 'page' : undefined}>TAPES</a>
      <a href={link('generators')} aria-current={mission === 'generators' ? 'page' : undefined}>GENERATORS</a>
      {[5, 10, 15].map(n => <a key={n} href={link('survive', n)} aria-current={mission === 'survive' && minutes === n ? 'page' : undefined}>SURVIVAL {n}</a>)}
      <a href={`/?parking&seed=${(seed + 1) >>> 0}&mission=${mission}&minutes=${minutes}${low ? '&low' : ''}`}>NEXT SEED</a><a href="/">BACK TO GAME</a>
    </nav>
    <div className="parking-preview-objective" ref={objectiveUI} />
    {mission==='generators'&&<div hidden className="parking-preview-repair" ref={repairUI} role="progressbar" aria-label="Generator repair" aria-valuemin={0} aria-valuemax={8}><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" className="repair-track"/><circle cx="60" cy="60" r="50" pathLength="100" strokeDasharray="100" strokeDashoffset="100" ref={repairCircle}/></svg><span ref={repairPercent}>0%</span><small>HOLD E - 8 SECONDS</small></div>}
    <div className="parking-preview-round" ref={roundUI} />
    <div className="parking-preview-interaction" ref={prompt} /><div className="parking-preview-storage" ref={storage} />
    <footer>E INTERACT · CLICK TO WALK · WASD · SHIFT SPRINT · F FLASHLIGHT · PGUP/PGDN PREVIEW FLOORS · ESC RELEASE</footer>
    <div className="parking-preview-crosshair" aria-hidden="true">+</div>
    {(loading || error) && <div className="parking-preview-loading" role="status">{error ? `PREVIEW ERROR: ${error}` : loading}</div>}

  </div>;
}
