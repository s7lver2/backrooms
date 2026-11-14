import {
  HIT_DAMAGE, ParkingSkinAI, ParkingSmilerAI, addItem, canHold, generateParking, parkingContains, parkingDoorBlocks, parkingFits, parkingOptionsForMission,
  type ItemId, type Mission, type ParkingInteraction, type ParkingPoint, type ParkingRect, type ParkingSnapshot, type PlayerState, type SkinTarget,
} from '@backrooms/shared';
import type { Player } from './match';

const EYE = 1.62;
const REPAIR_REACH = 2.45;
const REPAIR_HEARTBEAT = 400;
const OPEN_MS = 1100;
const CABIN_DEPTH = .85;
const angleDirection = (p: PlayerState) => {
  const cp = Math.cos(p.pitch);
  return { x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp };
};

export class ParkingMatch {
  readonly map;
  readonly skinwalkers: ParkingSkinAI;
  readonly smilers: ParkingSmilerAI;
  private targets: Player[] = [];
  private damage?: (player:Player) => void;
  private simulationNow = 0;
  private readonly poweredFloors = new Set<number>();
  private readonly movementNoise = new Map<string,{distance:number;time:number}>();
  private readonly solids: ParkingRect[][];
  private readonly recentHits = new Map<string,number>();
  frozen = false;
  private readonly repaired = new Set<string>();
  private readonly tapes = new Set<string>();
  private readonly doors: Record<string, number> = {};
  private readonly looted = new Set<string>();
  private readonly lastState = new Map<string, number>();
  private readonly moveCredit = new Map<string, number>();
  private readonly controls = new Map<string, { id: string; last: number }>();
  private repair?: { id: string; by: string; since: number };
  private elevatorOpenedAt: number | null = null;
  private age = 0;
  private forced = false;

  constructor(seed: number, readonly mission: Mission) {
    this.map = generateParking(seed, parkingOptionsForMission(mission));
    this.solids = this.map.floors.map(f => [...f.walls.filter(w=>!w.hidden),...f.pillars,...f.furniture,...f.cars.map(c=>({x:c.x-1.05,z:c.z-2.35,w:2.1,d:4.7}))]);
    const world = {
      fits:(x:number,z:number,y:number)=>this.fits(x,z,y,this.simulationNow,false),
      sight:(a:ParkingPoint,b:ParkingPoint)=>this.clear(a,b),
    };
    this.skinwalkers = new ParkingSkinAI(this.map,{
      ...world,bright:p=>this.floorPowered(p.floor)&&this.map.floors[p.floor].fixtures.some(l=>(l.x-p.x)**2+(l.z-p.z)**2<25)?1:0,
      hit:id=>this.hit(id,false),
    });
    this.smilers = new ParkingSmilerAI(this.map,{...world,illumination:p=>this.illumination(p),hit:id=>this.hit(id,true)});
  }

  get progress() {
    if (this.forced) return this.mission.goal;
    const progress = this.mission.kind === 'generators' ? this.repaired.size
      : this.mission.kind === 'tapes' ? this.tapes.size : Math.floor(this.age);
    return Math.min(this.mission.goal, progress);
  }

  complete() {
    this.forced = true;
    for (const goal of this.map.objectives) {
      if(this.mission.kind==='generators'){this.repaired.add(goal.id);this.poweredFloors.add(goal.floor);}
      else if(this.mission.kind==='tapes')this.tapes.add(goal.id);
    }
    if (this.mission.kind === 'tapes') this.updateTapeDifficulty();
    if (this.mission.kind === 'generators') this.updateGeneratorDifficulty();
    if (this.mission.kind === 'survive') this.updateSurvivalDifficulty();
  }

  private updateTapeDifficulty() {
    this.skinwalkers.setCursedTapes(this.tapes.size);
    this.smilers.setCursedTapes(this.tapes.size);
  }

  private updateGeneratorDifficulty() {
    this.skinwalkers.setRepairedGenerators(this.repaired.size);
    this.smilers.setRepairedGenerators(this.repaired.size);
  }

  private updateSurvivalDifficulty() {
    this.skinwalkers.setSurvivalElapsed(this.progress);
    this.smilers.setSurvivalElapsed(this.progress);
  }

  private fits(x: number, z: number, feet: number, now: number, player = true) {
    const e = this.map.elevator, depth = (x-e.x)*e.inward, lateral = Math.abs(z-e.z);
    if (Math.abs(feet-e.y)<.8 && depth<.38 && depth>-2.75 && lateral<2.2) {
      if (player && this.elevatorOpenedAt !== null && now-this.elevatorOpenedAt>=OPEN_MS && depth>-2.10 && lateral<.67) return { x,y:e.y,z,floor:e.floor };
      return null;
    }
    return parkingFits(this.map,x,z,feet,.25,this.doors);
  }

  move(player: Player, next: PlayerState, now: number, admin: boolean) {
    const previous = this.lastState.get(player.id);
    this.lastState.set(player.id, now);
    if (admin && this.fits(next.x,next.z,next.y,now)) return;
    let { x,y,z } = player.st;
    const dx = next.x-x, dz = next.z-z, distance = Math.hypot(dx,dz);
    const speed = admin ? 14 : 7;
    const credit = Math.min(1.6,(this.moveCredit.get(player.id) ?? .8) + Math.min(.25,(now-(previous??now))/1000)*speed);
    const travel = Math.min(distance,credit), parts = Math.max(1,Math.ceil(travel/.16));
    const sx = distance ? dx*travel/distance/parts : 0, sz = distance ? dz*travel/distance/parts : 0;
    for (let i=0;i<parts;i++) {
      const result = this.fits(x+sx,z+sz,y,now);
      if (!result) break;
      ({x,y,z}=result);
    }
    const actual=Math.hypot(x-player.st.x,z-player.st.z);
    this.moveCredit.set(player.id,credit-actual);
    this.movementNoise.set(player.id,{distance:actual,time:Math.max(.04,Math.min(.3,(now-(previous??now))/1000))});
    Object.assign(next,{x,y,z,hiding:false,holding:false,held:'none',tank:false});
  }

  teleport(p: Player, destination: { x:number; y:number; z:number }, now=Date.now()) {
    const position=this.fits(destination.x,destination.z,destination.y,now);
    if(!position)return false;
    p.st={...p.st,x:position.x,y:position.y,z:position.z};
    this.lastState.set(p.id,now);
    this.moveCredit.delete(p.id);
    this.movementNoise.delete(p.id);
    this.controls.delete(p.id);
    if(this.repair?.by===p.id)this.repair=undefined;
    return true;
  }

  private point(p: Player) {
    return this.fits(p.st.x,p.st.z,p.st.y,Date.now());
  }

  private eye(p: Player, floor: number): ParkingPoint {
    return { x:p.st.x,y:p.st.y+EYE-(p.st.duck?.6:0),z:p.st.z,floor };
  }

  private clear(a: ParkingPoint, b: ParkingPoint, excluded?: ParkingRect) {
    const f = this.map.floors[a.floor];
    if (a.floor !== b.floor) return false;
    const dx=b.x-a.x, dz=b.z-a.z, steps=Math.ceil(Math.hypot(dx,dz)/.13);
    const boxes=this.solids[f.index];
    for(let i=1;i<steps;i++) {
      const t=i/steps,x=a.x+dx*t,z=a.z+dz*t,y=a.y+(b.y-a.y)*t;
      if (excluded && parkingContains(excluded,x,z)) continue;
      if(boxes.some(r=>parkingContains(r,x,z)) || f.rooms.some(room=>parkingDoorBlocks(room,x,z,this.doors[room.id]??0,.015))) return false;
      if(y < f.y+.02 || y > f.y+3.55) return false;
    }
    return true;
  }

  private aim(p:Player,target:ParkingPoint,reach:number,cosine:number,excluded?:ParkingRect) {
    const origin=this.point(p);
    if(!origin || origin.floor!==target.floor)return false;
    const a=this.eye(p,target.floor), d=angleDirection(p.st);
    const dx=target.x-a.x,dy=target.y-a.y,dz=target.z-a.z,len=Math.hypot(dx,dy,dz);
    return len<=reach && (len<.1 || (dx*d.x+dy*d.y+dz*d.z)/len>=cosine) && this.clear(a,target,excluded);
  }

  private repairOk(p: Player,id: string) {
    const goal=this.map.objectives.find(o=>o.id===id);
    if(!goal || this.repaired.has(id))return false;
    const bounds={x:goal.x-1.1,z:goal.z-.75,w:2.2,d:1.5};
    return this.aim(p,{...goal,y:goal.y+.85},REPAIR_REACH+.55,.88,bounds);
  }

  interact(p:Player, action:ParkingInteraction, players: Player[], now=Date.now()): boolean | ItemId {
    if(!action||typeof action!=='object'||p.dead||p.boarded||!p.seen)return false;
    const id=typeof action.id==='string' ? action.id : '';
    if(action.kind==='repair' && action.held!==true) {
      this.controls.delete(p.id);
      if(this.repair?.by===p.id)this.repair=undefined;
      return true;
    }
    if(now-(this.lastState.get(p.id)??0)>REPAIR_HEARTBEAT)return false;
    if(action.kind==='repair') {
      if(this.mission.kind!=='generators'||!this.repairOk(p,id))return false;
      this.controls.set(p.id,{id,last:now});
      return true;
    }
    if(action.kind==='elevator') {
      const e=this.map.elevator;
      if(this.progress<this.mission.goal||this.elevatorOpenedAt!==null||!this.aim(p,{...e,x:e.x+e.inward*.2,y:e.y+1.45},2.5,.74))return false;
      this.elevatorOpenedAt=now;
      return true;
    }
    if(action.kind==='tape') {
      const tape=this.map.objectives.find(o=>o.id===id);
      if(this.mission.kind!=='tapes'||!tape||this.tapes.has(id)||!this.aim(p,{...tape,y:tape.y+.06},2.55,.83))return false;
      this.tapes.add(id);
      this.updateTapeDifficulty();
      return true;
    }
    if(action.kind!=='door'&&action.kind!=='loot')return false;
    const pos=this.point(p);
    if(!pos)return false;
    const f=this.map.floors[pos.floor];
    for(const room of f.rooms) {
      const door={x:room.door.x,z:room.door.z,y:f.y+1.2,floor:f.index};
      if(action.kind==='door'&&room.id===id&&this.aim(p,door,2.65,.64,{x:door.x-.24,z:door.z-.7,w:.48,d:1.4})) {
        const closing=!!this.doors[id];
        if(closing&&players.some(q=>!q.dead&&!q.boarded&&Math.abs(q.st.y-f.y)<.4
          && [0,.25,.5,.75,1].some(open=>parkingDoorBlocks(room,q.st.x,q.st.z,open,.28))))return false;
        this.doors[id]=closing?0:1;
        return true;
      }
      for(const [index,locker] of (room.lockers??[]).entries()) {
        const point={...locker,y:f.y+(index%2?.98:.55),floor:f.index};
        const body={x:locker.x-.27,z:locker.z-.27,w:.54,d:.54};
        if(action.kind==='door'&&locker.id===id&&this.aim(p,{...point,y:f.y+1.05},2.65,.64,body)) {
          this.doors[id]=this.doors[id]?0:1;
          return true;
        }
        if(action.kind==='loot'&&id===locker.id+'-item'&&this.doors[locker.id]&&!this.looted.has(id)&&this.aim(p,point,2.45,.76,body)) {
          const item=index%2?'flashlight':'water';
          if(!canHold(p.cap,item))return false;
          this.looted.add(id);
          p.cap=addItem(p.cap,item);
          return item;
        }
      }
    }
    return false;
  }

  private floorPowered(floor:number) { return this.mission.kind!=='generators'||this.poweredFloors.has(floor); }

  private illumination(p:ParkingPoint) {
    if(!this.floorPowered(p.floor))return 0;
    const floor=this.map.floors[p.floor];
    if(floor.rooms.some(room=>parkingContains(room,p.x,p.z)))return 1;
    let light=0;
    for(const lamp of floor.fixtures){
      const distance=Math.hypot(lamp.x-p.x,lamp.z-p.z);
      if(distance>=7)continue;
      if(this.clear({...p,y:p.y+1.4},{...lamp,y:floor.y+3.1,floor:p.floor}))
        light+=Math.max(0,1-distance/7)**2;
    }
    return Math.min(1,light);
  }

  private hit(id:string|undefined,lethal:boolean) {
    const p=this.targets.find(target=>target.id===id);
    if(!p||p.dead||p.boarded||(p.immuneUntil??0)>this.simulationNow)return;
    if(!lethal&&(this.recentHits.get(p.id)??0)>this.simulationNow)return;
    p.hp=lethal?0:Math.max(0,p.hp-HIT_DAMAGE);
    this.recentHits.set(p.id,this.simulationNow+1200);
    if(p.hp===0){p.dead=true;this.damage?.(p);}
  }

  tick(dt:number,players:Player[],now=Date.now(),caught?:(player:Player)=>void) {
    this.age+=dt;
    if (this.mission.kind === 'survive') this.updateSurvivalDifficulty();
    for(const [by,request] of this.controls) {
      const p=players.find(q=>q.id===by);
      if(!p||p.dead||p.boarded||now-request.last>REPAIR_HEARTBEAT||now-(this.lastState.get(by)??0)>REPAIR_HEARTBEAT||!this.repairOk(p,request.id)) this.controls.delete(by);
    }
    if(this.repair && this.controls.get(this.repair.by)?.id!==this.repair.id)this.repair=undefined;
    if(!this.repair) {
      const first=this.controls.entries().next().value;
      if(first)this.repair={by:first[0],id:first[1].id,since:now};
    }
    if(this.repair&&now-this.repair.since>=8000) {
      this.repaired.add(this.repair.id);
      const goal=this.map.objectives.find(o=>o.id===this.repair!.id);
      if(goal)this.poweredFloors.add(goal.floor);
      this.updateGeneratorDifficulty();
      this.controls.delete(this.repair.by);
      this.repair=undefined;
    }
    if(this.frozen)return;
    this.simulationNow=now;
    this.targets=players;
    this.damage=caught;
    const targets:SkinTarget[]=[];
    for(const p of players){
      if(p.dead||p.boarded||!p.seen||now-(this.lastState.get(p.id)??0)>1000)continue;
      const pos=this.fits(p.st.x,p.st.z,p.st.y,now);
      if(!pos)continue;
      const movement=this.movementNoise.get(p.id), speed=movement?movement.distance/movement.time:0;
      targets.push({id:p.id,pos,eye:this.eye(p,pos.floor),yaw:p.st.yaw,beam:p.st.light?angleDirection(p.st):null,noise:speed>4?14:speed>1?8:0,alive:true});
    }
    this.skinwalkers.pressure=this.mission.kind==='generators'?0:this.progress/this.mission.goal;
    this.skinwalkers.updateMany(dt,targets);
    this.smilers.updateMany(dt,targets.filter(t=>!players.find(p=>p.id===t.id)?.dead));
  }

  canBoard(p:Player,now=Date.now()) {
    const e=this.map.elevator, depth=(p.st.x-e.x)*e.inward;
    return !p.dead&&!p.boarded&&p.seen&&this.elevatorOpenedAt!==null&&now-this.elevatorOpenedAt>=OPEN_MS
      && Math.abs(p.st.y-e.y)<.15&&depth<-CABIN_DEPTH&&depth>-2.1&&Math.abs(p.st.z-e.z)<.67;
  }

  snapshot(now=Date.now()):ParkingSnapshot {
    const active=this.repair;
    return {
      skinwalkers:this.skinwalkers.agents.map(({id,pos,yaw,state,beast,transform,attackAt,moving,fakeTask})=>({id,pos,yaw,state,beast,transform,attackAt,moving,fakeTask})),
      smilers:this.smilers.sections.flatMap(section=>section.active?[section.active]:[]),
      gaze:Object.fromEntries(this.targets.map(p=>[p.id,this.smilers.gazeFor(p.id)])),
      repaired:[...this.repaired],tapes:[...this.tapes],doors:{...this.doors},looted:[...this.looted],elevatorOpenedAt:this.elevatorOpenedAt,
      ...(this.mission.kind === 'survive' ? { survivalElapsed: this.progress } : {}),
      ...(active?{repair:{id:active.id,by:active.by,seconds:Math.min(8,(now-active.since)/1000)}}:{}),
    };
  }
}
