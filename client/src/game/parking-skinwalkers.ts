import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HP_MAX, HIT_DAMAGE, parkingContains, type Look, type ParkingPoint } from '@backrooms/shared';
import { Rig } from './rig';
import { Cosmetics } from './cosmetics';
import { ParkingSkinAI, type SkinAgent, type SkinTarget } from './parking-skinwalker-ai';
import type { ParkingLevel } from './parking';
import { ParkingSmilers } from './parking-smilers';

type Actor={agent:SkinAgent;root:THREE.Group;human:Rig;beast:Rig;cos:Cosmetics;humanMats:THREE.Material[];beastMats:THREE.Material[];owned:THREE.Material[];particles:THREE.Points;particleMat:THREE.PointsMaterial;attack:number;attackHold:number};
type NetworkSkinwalker = Pick<SkinAgent, 'id' | 'pos' | 'yaw' | 'state' | 'beast' | 'transform' | 'attackAt' | 'moving' | 'fakeTask'>;
/** Presentacion de la ronda local; los rigs y cosmeticos son los mismos del jugador. */
export class ParkingSkinwalkers {
  readonly ai:ParkingSkinAI;
  readonly smilers:ParkingSmilers;
  private hitAt=-Infinity;
  hp=HP_MAX;
  paused=false;
  private immunity=0;
  private actors:Actor[]=[];
  private group=new THREE.Group();
  private resources=new Set<{dispose():void}>();
  private disposed=false;
  private inspection=0;
  private debugAgent?:SkinAgent;
  private lastPlayer?:ParkingPoint;
  private network = new Map<number, NetworkSkinwalker>();
  private visualTime = 0;
  private constructor(private level:ParkingLevel,human:GLTF,beast:GLTF,smilerFace:THREE.Texture,look:Look,initial?:ParkingPoint,low=false){
    this.ai=new ParkingSkinAI(level.map,{fits:(x,z,y)=>level.fits(x,z,y,false),sight:(a,b)=>level.lineOfSight(a,b),bright:p=>level.routeBrightness(p),hit:()=>this.hurt()},initial);
    this.smilers=new ParkingSmilers(level,()=>this.killBySmiler(),smilerFace,low);
    level.scene.add(this.group);
    const ownMaterials=(root:THREE.Object3D)=>{const owned:THREE.Material[]=[];root.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;mesh.material=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>{const c=m.clone();c.transparent=true;c.depthWrite=true;c.alphaTest=.04;owned.push(c);return c;});if(mesh.material.length===1)mesh.material=mesh.material[0];});return owned;};
    const materials=(root:THREE.Object3D)=>{const found=new Set<THREE.Material>();root.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh)(Array.isArray(m.material)?m.material:[m.material]).forEach(v=>found.add(v));});return [...found];};
    const points=new Float32Array(32*3);for(let i=0;i<32;i++){points[i*3]=Math.sin(i*17.1)*.45;points[i*3+1]=.1+(i%13)/8;points[i*3+2]=Math.cos(i*13.7)*.45;}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(points,3));this.resources.add(geometry);
    for(const agent of this.ai.agents){const h=new Rig(human),b=new Rig(beast),root=new THREE.Group(),owned=[...ownMaterials(h.root),...ownMaterials(b.root)],cos=new Cosmetics(h.root);cos.set(look);root.add(h.root,b.root);root.visible=cos.root.visible=false;this.group.add(root,cos.root);const particleMat=new THREE.PointsMaterial({color:0x69766b,size:.05,transparent:true,opacity:0,depthWrite:false,fog:true}),particles=new THREE.Points(geometry,particleMat);root.add(particles);this.resources.add(particleMat);h.play('Neutral Idle',0);h.update(0);b.play('idle',0);b.update(0);this.actors.push({agent,root,human:h,beast:b,cos,humanMats:materials(h.root),beastMats:materials(b.root),owned,particles,particleMat,attack:0,attackHold:0});}
  }
  static async load(level:ParkingLevel,look:Look,initial?:ParkingPoint,low=false,humanPrefab?:GLTF){
    const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [human,beast,smilerFace]=await Promise.all([
      humanPrefab ?? loader.loadAsync('/models/backrooms/hazmat.glb'),
      loader.loadAsync('/models/parking/skinwalker.glb'),
      new THREE.TextureLoader().loadAsync('/models/parking/smiler-face.png'),
    ]);
    const result=new ParkingSkinwalkers(level,human,beast,smilerFace,look,initial,low);
    for(const g of humanPrefab?[beast]:[human,beast])g.scene.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;result.resources.add(mesh.geometry);for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material]){result.resources.add(mat);for(const v of Object.values(mat))if(v instanceof THREE.Texture)result.resources.add(v);}});
    return result;
  }
  private hurt(){if(this.paused||this.ai.time<this.immunity||this.hp<=0)return;this.hp=Math.max(0,this.hp-HIT_DAMAGE);this.immunity=this.ai.time+1.2;this.hitAt=this.ai.time;}
  private killBySmiler(){const p=this.lastPlayer;if(this.paused||this.hp<=0||!p||this.level.map.floors[p.floor].rooms.some(r=>parkingContains(r,p.x,p.z,.15)))return;this.hp=0;this.hitAt=this.ai.time;}
  recentHit(){return this.ai.time-this.hitAt<.8;}
  setLook(look:Look){for(const a of this.actors){a.cos.set(look);const mats=new Set<THREE.Material>();a.human.root.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh)(Array.isArray(m.material)?m.material:[m.material]).forEach(v=>mats.add(v));});a.humanMats=[...mats];}}
  update(dt:number,target:SkinTarget,smilerDt=dt){if(this.disposed)return;
    const count = this.level.tapesCollected;
    this.ai.setCursedTapes(count);
    this.smilers.ai.setCursedTapes(count);
    this.ai.setRepairedGenerators(this.level.repair.repaired);
    this.smilers.ai.setRepairedGenerators(this.level.repair.repaired);
    this.ai.setSurvivalElapsed(this.ai.time);
    this.smilers.ai.setSurvivalElapsed(this.ai.time);
    this.lastPlayer={...target.pos};if(!this.paused&&this.hp>0)this.ai.update(dt,{...target,alive:this.hp>0});this.smilers.update(smilerDt,{...target,alive:this.hp>0},!this.paused&&this.hp>0);
    this.renderActors(dt, target, false);
  }

  syncNetwork(actors: NetworkSkinwalker[]) {
    this.network = new Map(actors.map(actor => [actor.id, actor]));
  }

  updateNetwork(dt: number, target: SkinTarget) {
    this.smilers.update(dt, target, false);
    this.renderActors(dt, target, true);
  }

  private renderActors(dt: number, target: SkinTarget, networked: boolean) {
    this.visualTime += dt;
    for (const a of this.actors) {
      const s = networked ? this.network.get(a.agent.id) : a.agent;
      const visible = !!s && Math.hypot(s.pos.x - target.pos.x, s.pos.y - target.pos.y, s.pos.z - target.pos.z) < 23
        && Math.abs(s.pos.floor - target.pos.floor) <= 1;
      const wasVisible = a.root.visible;
      a.root.visible = a.cos.root.visible = visible;
      if (!visible || !s) continue;
      const { x, y, z } = s.pos;
      const position = a.root.position;
      if (networked && wasVisible && Math.hypot(position.x - x, position.y - y, position.z - z) < 3) {
        const alpha = 1 - Math.exp(-dt * 17);
        a.root.position.set(THREE.MathUtils.lerp(a.root.position.x, x, alpha), THREE.MathUtils.lerp(a.root.position.y, y, alpha), THREE.MathUtils.lerp(a.root.position.z, z, alpha));
        const yawDelta = Math.atan2(Math.sin(s.yaw - a.root.rotation.y), Math.cos(s.yaw - a.root.rotation.y));
        a.root.rotation.y += yawDelta * alpha;
      } else {
        a.root.position.set(x, y, z);
        a.root.rotation.y = s.yaw;
      }
      const blend = s.beast ? 1 : s.state === 'transform' ? Math.min(1, s.transform / 1.15) : 0;
      a.human.root.visible = blend < 1;
      a.beast.root.visible = blend > 0;
      a.humanMats.forEach(m => m.opacity = 1 - blend);
      a.beastMats.forEach(m => m.opacity = blend);
      a.cos.root.visible = blend < .4;
      if (networked || (!this.paused && this.hp > 0)) {
        const walk = s.moving ? (s.state === 'run' ? 'Slow Run' : 'Walking222') : 'Neutral Idle';
        const fake = s.state === 'idle' && !!s.fakeTask && Math.hypot(x - s.fakeTask.x, z - s.fakeTask.z) < 3.5;
        a.human.play(fake ? 'Picking Up' : walk, .18, fake);
        if (s.attackAt > a.attack) {
          a.attack = s.attackAt;
          a.attackHold = .65;
          a.beast.play('attack', .08, true);
        }
        a.attackHold = Math.max(0, a.attackHold - dt);
        if (!a.attackHold) a.beast.play(s.moving ? (s.state === 'beast' || s.state === 'flee' ? 'run' : 'walk') : 'idle', .15);
        a.human.update(dt);
        a.beast.update(dt);
      }
      a.cos.update();
      a.particles.visible = blend > 0 && blend < 1;
      a.particles.rotation.y = this.visualTime * 2;
      a.particles.scale.setScalar(.65 + blend * .8);
      a.particleMat.opacity = Math.sin(blend * Math.PI) * .45;
    }
  }
  inspectSmiler(near=false){this.debugAgent=undefined;return this.smilers.inspect(near);}
  inspect(near=false){this.smilers.clearDebug();const a=near&&this.debugAgent?this.debugAgent:this.ai.agents[this.inspection++%this.ai.agents.length];if(!a)return;
    if(near){for(let i=0;i<16;i++){const angle=i*Math.PI/8,p=this.level.fits(a.pos.x+Math.sin(angle)*2.7,a.pos.z+Math.cos(angle)*2.7,a.pos.y);if(p&&Math.abs(p.y-a.pos.y)<.15&&this.level.lineOfSight({...p,y:p.y+1.65},{...a.pos,y:a.pos.y+1.2})){this.debugAgent=a;return {position:p,target:{x:a.pos.x,y:a.pos.y+1.25,z:a.pos.z}};}}}
const nodes=this.level.map.nav.filter(n=>n.floor===a.pos.floor&&Math.abs(n.y-a.pos.y)<.1&&Math.hypot(n.x-a.pos.x,n.z-a.pos.z)>6&&Math.hypot(n.x-a.pos.x,n.z-a.pos.z)<11.5&&this.level.fits(n.x,n.z,n.y)&&!this.level.map.floors[n.floor].rooms.some(r=>n.x>r.x&&n.x<r.x+r.w&&n.z>r.z&&n.z<r.z+r.d)&&this.level.lineOfSight({...n,y:n.y+1.65},{...a.pos,y:a.pos.y+1.2}));const p=nodes.find(n=>Math.hypot(n.x-a.pos.x,n.z-a.pos.z)>9)??nodes[0];if(!p)return;this.debugAgent=a;return {position:p,target:{x:a.pos.x,y:a.pos.y+1.25,z:a.pos.z}};}
  clearDebug(){this.debugAgent=undefined;this.smilers.clearDebug();}
  debug(){const a=this.debugAgent;return a?`DEBUG NPC ${a.id} ${a.state.toUpperCase()} | TIME ${this.ai.time.toFixed(1)} | DIST ${this.lastPlayer?Math.hypot(a.pos.x-this.lastPlayer.x,a.pos.y-this.lastPlayer.y,a.pos.z-this.lastPlayer.z).toFixed(1):'?'} M | RETREAT ${Math.max(0,a.repelUntil-this.ai.time).toFixed(1)} S | RECOVERY ${Math.max(0,a.recoverUntil-this.ai.time).toFixed(1)} S`:this.smilers.debug();}
  dispose(){if(this.disposed)return;this.disposed=true;this.smilers.dispose();this.group.removeFromParent();for(const a of this.actors){a.cos.dispose();a.human.mixer.stopAllAction();a.beast.mixer.stopAllAction();a.human.mixer.uncacheRoot(a.human.root);a.beast.mixer.uncacheRoot(a.beast.root);const skeletons=new Set<THREE.Skeleton>();for(const root of [a.human.root,a.beast.root])root.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((o as THREE.SkinnedMesh).skeleton);});skeletons.forEach(s=>s.dispose());a.owned.forEach(m=>m.dispose());}this.resources.forEach(r=>r.dispose());this.resources.clear();}
}
