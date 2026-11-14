import { parkingContains,parkingArea,type ParkingMap,type ParkingPoint } from './parking';
import type { SkinTarget } from './parking-skinwalker-ai';
import { parkingCurseTier } from './parking-curse';
import { beamReaches } from './perception';
export const SMILER_MAX_ACTIVE=2,SMILER_ATTACK_RANGE=16,SMILER_GAZE_SECONDS=10,SMILER_DARK=.045,SMILER_FIRST_SPAWN=20,SMILER_COOLDOWN=75,SMILER_SPAWN_MIN=30,SMILER_SPAWN_MAX=45;
const SMILER_FLASHLIGHT_RANGE = 6;
const GAZE_LIMIT = [SMILER_GAZE_SECONDS, 8.5, 6.5] as const;
const COOLDOWN = [SMILER_COOLDOWN, 65, 55] as const;
const MAX_ACTIVE = [SMILER_MAX_ACTIVE, 3, 4] as const;
const SMILER_GENERATOR_GAZE_REDUCTION = .5;
const SMILER_GENERATOR_COOLDOWN_REDUCTION = 8;
const SMILER_SURVIVAL_GAZE_REDUCTION = .3;
export type SmilerState='watch'|'frozen';
export interface Smiler {id:string;pos:ParkingPoint;state:SmilerState;born:number;beamFor:number;gazeTicks?:number;visible?:boolean}
export interface DarkSection {id:string;floor:number;area:number;nodes:number[];cooldown:number;active?:Smiler}
export interface SmilerWorld {illumination(p:ParkingPoint):number;fits(x:number,z:number,y:number):ParkingPoint|null;sight(a:ParkingPoint,b:ParkingPoint):boolean;hit(id?:string):void}
const distance=(a:ParkingPoint,b:ParkingPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
/** Rare stationary encounters that turn lethal with sustained exposure. */
export class ParkingSmilerAI {
  readonly sections:DarkSection[]=[];
  private readonly gaze = new WeakMap<Smiler,Map<string,{ticks:number; hit:boolean}>>();
  private readonly baseSections: DarkSection[] = [];
  private readonly overflow = new Map<DarkSection, DarkSection[]>();
  private curseTier = 0;
  private repairedGenerators = 0;
  private survivalElapsed = 0;
  private clock=0;private accumulator=0;private spawnAt=SMILER_FIRST_SPAWN;private attempts=0;
  constructor(readonly map: ParkingMap, private world: SmilerWorld) {
    for (const floor of map.floors) for (let area = 1; area <= 3; area++) {
      const section: DarkSection = { id: `${floor.index}/${area}`, floor: floor.index, area, nodes: [], cooldown: 0 };
      map.nav.forEach((node, i) => {
        if (node.floor === floor.index && Math.abs(node.y - floor.y) < .01 && parkingArea(floor, node.x) === area && !this.safe(node)) {
          section.nodes.push(i);
        }
      });
      this.baseSections.push(section);
      this.sections.push(section);
    }
  }
  get gazeSeconds() { return this.gazeFor(''); }
  get gazeLimitSeconds() {
    return GAZE_LIMIT[this.curseTier] - this.repairedGenerators * SMILER_GENERATOR_GAZE_REDUCTION
      - Math.floor(this.survivalElapsed / 90) * SMILER_SURVIVAL_GAZE_REDUCTION;
  }
  private get activeLimit() {
    return MAX_ACTIVE[this.curseTier] + Math.floor(this.repairedGenerators / 2) + Math.floor(this.survivalElapsed / 210);
  }
  private get overflowSlots() {
    if (this.map.options.mission === 'tapes') return this.curseTier === 2 ? 1 : 0;
    return this.activeLimit > SMILER_MAX_ACTIVE ? this.activeLimit - 1 : 0;
  }
  gazeFor(id:string) {
    let ticks=0;
    for(const {active} of this.sections)if(active)ticks=Math.max(ticks,this.gaze.get(active)?.get(id)?.ticks??0);
    return ticks/20;
  }
  setCursedTapes(count: number) {
    const tier = this.map.options.mission === 'tapes' ? parkingCurseTier(count) : 0;
    if (tier === this.curseTier) return;
    this.shiftActiveCooldowns(COOLDOWN[tier] - COOLDOWN[this.curseTier]);
    this.curseTier = tier;
    this.expandSections();
  }
  setRepairedGenerators(count: number) {
    if (this.map.options.mission !== 'generators') return;
    const repaired = Math.max(0, Math.min(5, Math.floor(count)));
    this.shiftActiveCooldowns((this.repairedGenerators - repaired) * SMILER_GENERATOR_COOLDOWN_REDUCTION);
    this.repairedGenerators = repaired;
    this.expandSections();
  }
  setSurvivalElapsed(seconds: number) {
    if (this.map.options.mission !== 'survive') return;
    const limit = this.activeLimit;
    this.survivalElapsed = Math.max(0, Math.min((this.map.options.minutes ?? 5) * 60, seconds));
    if (this.activeLimit !== limit) this.expandSections();
  }
  private expandSections() {
    const count = this.overflowSlots;
    for (let index = this.overflow.get(this.baseSections[0])?.length ?? 0; index < count; index++) {
      for (const base of this.baseSections) {
        const slots = this.overflow.get(base) ?? [];
        const id = index === 0 ? `${base.id}/overflow` : `${base.id}/overflow/${index + 1}`;
        const cooldown = this.map.options.mission === 'tapes' ? base.cooldown : 0;
        const slot = { ...base, id, cooldown, active: undefined };
        slots.push(slot);
        this.overflow.set(base, slots);
        this.sections.push(slot);
      }
    }
  }
  private shiftActiveCooldowns(change: number) {
    if (!change) return;
    for (const section of this.sections) {
      if (section.cooldown > this.clock) section.cooldown += change;
    }
  }
  resetGaze() {
    for (const section of this.sections) if (section.active) {
      this.gaze.delete(section.active);
      section.active.gazeTicks = 0;
      section.active.visible = false;
    }
    this.accumulator = 0;
  }
  private safe(p:ParkingPoint){return this.map.floors[p.floor].rooms.some(r=>parkingContains(r,p.x,p.z,.6));}
  private dark(p:ParkingPoint){return !this.safe(p)&&this.world.illumination(p)<=SMILER_DARK;}
  private vanish(section: DarkSection) {
    section.active = undefined;
    section.cooldown = this.clock + COOLDOWN[this.curseTier] - this.repairedGenerators * SMILER_GENERATOR_COOLDOWN_REDUCTION;
  }
  private beam(a: Smiler, t: SkinTarget) {
    if (a.pos.floor !== t.pos.floor || distance(a.pos, t.pos) > SMILER_FLASHLIGHT_RANGE) return false;
    const face = { ...a.pos, y: a.pos.y + 1.4 };
    return beamReaches(t.eye, face, t.beam, Infinity, .94, .01) && this.world.sight({ ...t.pos, y: t.eye.y }, face);
  }
  update(dt:number,target:SkinTarget){this.updateMany(dt,[target]);}
  updateMany(dt:number,targets:SkinTarget[]){
    this.accumulator=Math.min(.25,this.accumulator+Math.max(0,dt));
    while(this.accumulator>=.05){this.accumulator-=.05;this.step(.05,targets.filter(t=>t.alive));}
  }
  private step(dt:number,targets:SkinTarget[]){
    this.clock+=dt;
    for(const section of this.sections){
      const a=section.active;
      if(!a)continue;
      const nearby=targets.filter(t=>t.pos.floor===section.floor&&distance(a.pos,t.pos)<45);
      if(!nearby.length||!this.dark(a.pos)){this.vanish(section);continue;}
      if(nearby.some(t=>this.beam(a,t))){
        this.gaze.delete(a);a.gazeTicks=0;a.visible=false;a.state='frozen';a.beamFor+=dt;
        if(a.beamFor+1e-9>=1.5)this.vanish(section);
        continue;
      }
      a.state='watch';a.beamFor=0;a.gazeTicks=0;a.visible=false;
      const gaze=this.gaze.get(a)??new Map<string,{ticks:number; hit:boolean}>();
      this.gaze.set(a,gaze);
      for(const id of gaze.keys())if(!nearby.some(t=>(t.id??'')===id))gaze.delete(id);
      for(const t of nearby){
        const visible=!this.safe(t.pos)&&distance(a.pos,t.pos)<SMILER_ATTACK_RANGE&&this.world.sight({...a.pos,y:a.pos.y+1.4},{...t.pos,y:t.eye.y});
        const id=t.id??'', lethal=Math.round(this.gazeLimitSeconds*20);
        const current=gaze.get(id)??{ticks:0,hit:false};
        if(!visible){gaze.delete(id);continue;}
        if(current.ticks<lethal)current.ticks++;
        gaze.set(id,current);
        a.gazeTicks=Math.max(a.gazeTicks,current.ticks);a.visible=true;
        if(!current.hit&&current.ticks>=lethal){current.hit=true;this.world.hit(t.id);}
      }
    }
    if(!targets.length||this.clock+1e-9<this.spawnAt)return;
    const random=Math.sin(this.map.seed*17.13+(++this.attempts)*93.7)*43758.5453;
    this.spawnAt=this.clock+SMILER_SPAWN_MIN+(random-Math.floor(random))*(SMILER_SPAWN_MAX-SMILER_SPAWN_MIN);
    const active=this.sections.flatMap(s=>s.active?[s.active]:[]);
    const limit=this.activeLimit;
    if(active.length>=limit)return;
    const candidates=new Map<number,DarkSection>();
    for(const section of this.baseSections){
      if(!this.canSpawn(section))continue;
      for(const i of section.nodes){
        const p=this.map.nav[i];
        if(targets.some(t=>t.pos.floor===p.floor&&distance(t.pos,p)<22))candidates.set(i,section);
      }
    }
    const pool=[...candidates];
    // Shuffle before testing to vary eligible positions every wave, including on the same map seed.
    for(let i=pool.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [pool[i],pool[j]]=[pool[j],pool[i]];
    }
    if (targets.some(t => t.repairNoise)) {
      const nearRepair = new Set(pool.filter(([index]) => {
        const p = this.map.nav[index];
        return targets.some(t => t.repairNoise?.floor === p.floor && distance(t.repairNoise, p) < t.noise);
      }).map(([index]) => index));
      pool.sort(([a], [b]) => Number(nearRepair.has(b)) - Number(nearRepair.has(a)));
    }
    for(const [i,base] of pool){
      const section=this.canSpawn(base);
      if(!section)continue;
      const p=this.map.nav[i];
      if(active.some(a=>distance(a.pos,p)<4)||!this.dark(p)||!this.world.fits(p.x,p.z,p.y))continue;
      if(targets.some(t=>t.pos.floor===p.floor&&(distance(t.pos,p)<9||this.world.sight({...t.pos,y:t.eye.y},{...p,y:p.y+1.4}))))continue;
      const smiler:Smiler={id:section.id,pos:{...p},state:'watch',born:this.clock,beamFor:0};
      section.active=smiler;
      active.push(smiler);
      if(active.length===limit)break;
    }
  }
  private canSpawn(base: DarkSection) {
    if (!base.active && this.clock >= base.cooldown) return base;
    const count = this.overflowSlots;
    return this.overflow.get(base)?.find((slot, index) => index < count && !slot.active && this.clock >= slot.cooldown);
  }
  get time(){return this.clock;}
}
