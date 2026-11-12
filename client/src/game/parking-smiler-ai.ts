import { parkingContains,parkingArea,type ParkingMap,type ParkingPoint } from '@backrooms/shared';
import type { SkinTarget } from './parking-skinwalker-ai';
export const SMILER_GAZE_SECONDS=10,SMILER_DARK=.045,SMILER_FIRST_SPAWN=20,SMILER_COOLDOWN=75,SMILER_SPAWN_MIN=30,SMILER_SPAWN_MAX=45;
export type SmilerState='watch'|'frozen';
export interface Smiler {id:string;pos:ParkingPoint;state:SmilerState;born:number;beamFor:number;gazeTicks?:number;visible?:boolean}
export interface DarkSection {id:string;floor:number;area:number;nodes:number[];cooldown:number;active?:Smiler}
export interface SmilerWorld {illumination(p:ParkingPoint):number;fits(x:number,z:number,y:number):ParkingPoint|null;sight(a:ParkingPoint,b:ParkingPoint):boolean;hit():void}
const distance=(a:ParkingPoint,b:ParkingPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
/** Rare stationary encounters. Ten uninterrupted seconds in sight are lethal. */
export class ParkingSmilerAI {
  readonly sections:DarkSection[]=[];
  private clock=0;private accumulator=0;private spawnAt=SMILER_FIRST_SPAWN;private attempts=0;
  constructor(readonly map:ParkingMap,private world:SmilerWorld){for(const f of map.floors)for(let area=1;area<=3;area++){const section:DarkSection={id:`${f.index}/${area}`,floor:f.index,area,nodes:[],cooldown:0};map.nav.forEach((n,i)=>{if(n.floor===f.index&&Math.abs(n.y-f.y)<.01&&parkingArea(f,n.x)===area&&!this.safe(n))section.nodes.push(i);});this.sections.push(section);}}
  get gazeSeconds() {
    const active = this.sections.find(section => section.active)?.active;
    return (active?.gazeTicks ?? 0) / 20;
  }
  resetGaze() {
    for (const section of this.sections) if (section.active) {
      section.active.gazeTicks = 0;
      section.active.visible = false;
    }
    this.accumulator = 0;
  }
  private safe(p:ParkingPoint){return this.map.floors[p.floor].rooms.some(r=>parkingContains(r,p.x,p.z,.6));}
  private dark(p:ParkingPoint){return !this.safe(p)&&this.world.illumination(p)<=SMILER_DARK;}
  private vanish(section:DarkSection){section.active=undefined;section.cooldown=this.clock+SMILER_COOLDOWN;}
  private beam(a:Smiler,t:SkinTarget){if(!t.beam||a.pos.floor!==t.pos.floor)return false;const dx=a.pos.x-t.eye.x,dy=a.pos.y+1.4-t.eye.y,dz=a.pos.z-t.eye.z,d=Math.hypot(dx,dy,dz);return d<13&&(dx*t.beam.x+dy*t.beam.y+dz*t.beam.z)/Math.max(.01,d)>.94&&this.world.sight({...t.pos,y:t.eye.y},{...a.pos,y:a.pos.y+1.4});}
  update(dt:number,t:SkinTarget){this.accumulator=Math.min(.25,this.accumulator+Math.max(0,dt));while(this.accumulator>=.05){this.accumulator-=.05;this.step(.05,t);}}
  private step(dt:number,t:SkinTarget){this.clock+=dt;
    for(const section of this.sections){const a=section.active;if(!a)continue;if(section.floor!==t.pos.floor||!this.dark(a.pos)||distance(a.pos,t.pos)>45){this.vanish(section);continue;}
      // La defensa se evalua antes de la vision letal, cada paso y sin cache de LOS.
      if(this.beam(a,t)){a.gazeTicks=0;a.visible=false;a.state='frozen';a.beamFor+=dt;if(a.beamFor+1e-9>=1.5)this.vanish(section);continue;}
      a.state='watch';a.beamFor=0;
      const eligible=t.alive&&t.pos.floor===section.floor&&!this.safe(t.pos)&&distance(a.pos,t.pos)<8;
      a.visible=eligible&&this.world.sight({...a.pos,y:a.pos.y+1.4},{...t.pos,y:t.eye.y});
      const previousGaze = a.gazeTicks ?? 0;
      const lethalTicks = SMILER_GAZE_SECONDS*20;
      a.gazeTicks=a.visible?Math.min(lethalTicks,previousGaze+1):0;
      if(previousGaze<lethalTicks&&a.gazeTicks===lethalTicks)this.world.hit();
    }
    if(!t.alive||this.clock+1e-9<this.spawnAt)return;
    const random=Math.sin(this.map.seed*17.13+(++this.attempts)*93.7)*43758.5453;this.spawnAt=this.clock+SMILER_SPAWN_MIN+(random-Math.floor(random))*(SMILER_SPAWN_MAX-SMILER_SPAWN_MIN);
    if(this.sections.some(s=>s.active))return;
    for(const section of this.sections){if(section.floor!==t.pos.floor||this.clock<section.cooldown)continue;const choices=section.nodes.filter(i=>{const d=distance(this.map.nav[i],t.pos);return d>11&&d<22;}).sort((i,j)=>Math.sin(i*17.13+this.map.seed)-Math.sin(j*17.13+this.map.seed)).slice(0,32);
      const node=choices.find(i=>{const p=this.map.nav[i];return this.dark(p)&&!!this.world.fits(p.x,p.z,p.y)&&!this.world.sight({...t.pos,y:t.eye.y},{...p,y:p.y+1.4});});if(node===undefined)continue;section.active={id:section.id,pos:{...this.map.nav[node]},state:'watch',born:this.clock,beamFor:0};break;
    }
  }
  get time(){return this.clock;}
}
