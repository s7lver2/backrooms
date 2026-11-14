import { parkingContains, parkingGeneratorBounds, type ParkingMap, type ParkingPoint, type ParkingRoom } from './parking';
import { runBehaviors } from './behaviors';
import { parkingCurseTier } from './parking-curse';
import { beamReaches, faces, withinHearingRange } from './perception';

export type SkinState = 'wander'|'idle'|'approach'|'run'|'transform'|'recover'|'beast'|'flee'|'search'|'wait';
export const SKIN_APPROACH_BEAT = 1, SKIN_VISION = 15, SKIN_RUN_DISTANCE = 7, SKIN_TRANSFORM_DISTANCE = 5;
export const SKIN_RECOVERY = 3, SKIN_SEARCH = 7, SKIN_FLASH_ATTENTION = 12;
export const SKIN_FLEE_SECONDS = 2, SKIN_LIGHT_RESISTANCE_SECONDS = 25;
const SKIN_INVESTIGATION_INTERVAL = [10, 9.5, 8.5] as const;
const SKIN_CURSE_SPEED = [0, .15, .20] as const;
const SKIN_GENERATOR_SPEED = .09;
const SKIN_GENERATOR_INVESTIGATION_REDUCTION = .5;
const SKIN_SURVIVAL_SPEED = .05;
const SKIN_SURVIVAL_INVESTIGATION_REDUCTION = .4;
export const SKIN_SPEED = { walk: 1.6, run: 5.1, beast: 5.82, flee: 5.82 };
export interface SkinAgent { id:number; originFloor:number; pos:ParkingPoint; yaw:number; state:SkinState; beast:boolean; transform:number; recoverUntil:number; repelUntil:number; nextThink:number; nextPath:number; lastSeen?:ParkingPoint; seenAt:number; path:number[]; goal:number; attackAt:number; moving:boolean; waitUntil:number; fakeTask?:ParkingPoint; investigationGoal?:number }
export interface SkinTarget { id?:string; pos:ParkingPoint; eye:{x:number;y:number;z:number}; yaw?:number; beam:{x:number;y:number;z:number}|null; noise:number; repairNoise?:ParkingPoint; lure?:boolean; alive:boolean }
export interface SkinWorld { fits(x:number,z:number,y:number):ParkingPoint|null; sight(a:ParkingPoint,b:ParkingPoint):boolean; repairAudible?(from:ParkingPoint, generator:ParkingPoint):boolean; bright(p:ParkingPoint):number; hit(id?:string):void }
const distance=(a:ParkingPoint,b:ParkingPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const roomDistance=(r:ParkingRoom,p:ParkingPoint)=>Math.hypot(Math.max(r.x-p.x,0,p.x-r.x-r.w),Math.max(r.z-p.z,0,p.z-r.z-r.d));
const BRAIN_ORDER = ['waitOutside', 'approach', 'search', 'investigate', 'wander'] as const;

/** Simulación sobre la navegación y las colisiones del parking. */
export class ParkingSkinAI {
  readonly agents:SkinAgent[]=[];
  pressure=0;
  private allowed:Uint8Array;
  private floorNodes:number[][];
  private spawnNodes:number[]=[];
  private returning=new Set<number>();
  private clock=0;
  private curseTier = 0;
  private repairedGenerators = 0;
  private survivalTier = 0;
  private nextInvestigation: number = SKIN_INVESTIGATION_INTERVAL[0];
  private brightness:Float32Array;
  private nextBrightness=0;
  private blockedEdges=new Set<string>();
  private accumulator=0;
  private occupied?:ParkingRoom;
  private walkUntil = new Map<number,number>();
  private flanks = new Map<number, { goal: number; targetId?: string }>();
  private trails = new Map<number, { headingX: number; headingZ: number; visited: Set<number> }>();
  // Ramp and stair points keep a floor label even as their elevation changes.
  private onDeck(p: ParkingPoint, floor: number) {
    return p.floor === floor && Math.abs(p.y - this.map.floors[floor].y) < 1e-6;
  }
  private safe(p:ParkingPoint){return this.map.floors[p.floor].rooms.some(r=>parkingContains(r,p.x,p.z,.38));}
  private random(n:number){const v=Math.sin(n*12.9898+this.map.seed*.01)*43758.5453;return v-Math.floor(v);}
  constructor(readonly map:ParkingMap,private world:SkinWorld,initial:ParkingPoint=map.spawn) {
    this.brightness=new Float32Array(map.nav.length);
    this.allowed=new Uint8Array(map.nav.length);this.floorNodes=map.floors.map(()=>[]);
    map.nav.forEach((n,i)=>{if(!this.safe(n)&&!(map.options.mission==='generators'&&map.objectives.some(g=>g.floor===n.floor&&parkingContains(parkingGeneratorBounds(g),n.x,n.z,.35)))){this.allowed[i]=1;if(this.onDeck(n,n.floor))this.floorNodes[n.floor].push(i);}});
    for(const [i,n] of map.nav.entries())for(const j of n.edges){const b=map.nav[j];for(let step=1;step<8;step++){const t=step/8,p={x:n.x+(b.x-n.x)*t,z:n.z+(b.z-n.z)*t,y:n.y+(b.y-n.y)*t,floor:t<.5?n.floor:b.floor};if(this.safe(p)){this.blockedEdges.add(`${i}/${j}`);break;}}}
    for (const floor of map.floors) {
      const id = floor.index;
      const spawnNodes = this.floorNodes[id].filter(i => {
        const n = map.nav[i];
        const p = world.fits(n.x, n.z, n.y);
        return p && this.onDeck(p, id);
      });
      const candidates = spawnNodes.filter(i => distance(map.nav[i], initial) > 20);
      const index = candidates[Math.floor(this.random(id * 19 + 11) * candidates.length)] ?? spawnNodes[0];
      if (index === undefined) throw Error('No Skinwalker spawn');
      this.spawnNodes[id] = index;
      this.agents.push({id,originFloor:id,pos:{...map.nav[index]},yaw:this.random(id*71)*6.28,state:'idle',beast:false,transform:0,recoverUntil:0,repelUntil:0,nextThink:id*.05,nextPath:0,seenAt:-Infinity,path:[],goal:-1,attackAt:0,moving:false,waitUntil:1+this.random(id*37)*3});
    }
  }
  private nearest(p:ParkingPoint,filter?:(i:number)=>boolean){let best=-1,d=Infinity;for(const i of this.floorNodes[p.floor]){if(filter&&!filter(i))continue;const q=distance(p,this.map.nav[i]);if(q<d){d=q;best=i;}}return best;}
  private boundary(p:ParkingPoint){if(!this.occupied||p.floor!==this.map.floors.find(f=>f.rooms.includes(this.occupied!))?.index)return Infinity;return Math.min(Math.hypot(p.x-this.occupied.door.x,p.z-this.occupied.door.z)-5,roomDistance(this.occupied,p)-2.5);}
  private route(start:number,goal:number,returning=false){
    const nav=this.map.nav;
    if(!this.allowed[start]||!this.allowed[goal])return [];
    const floor=nav[start].floor, homeFloor=nav[goal].floor;
    if(!returning&&(!this.onDeck(nav[start],floor)||!this.onDeck(nav[goal],floor)))return [];
    const scores=new Float64Array(nav.length).fill(Infinity),parents=new Int32Array(nav.length).fill(-1),closed=new Uint8Array(nav.length),heap:[number,number][]=[];
    const estimate=(i:number)=>returning?Math.abs(nav[i].y-this.map.floors[homeFloor].y):distance(nav[i],nav[goal]);
    const push=(id:number,f:number)=>{let i=heap.length;heap.push([id,f]);while(i){const p=(i-1)>>1;if(heap[p][1]<=f)break;heap[i]=heap[p];i=p;}heap[i]=[id,f];};
    const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][1]<heap[c][1])c++;if(heap[c][1]>=last[1])break;heap[i]=heap[c];i=c;}heap[i]=last;}return first[0];};
    scores[start]=0;push(start,estimate(start));let budget=nav.length;
    while(heap.length&&budget>0){const i=pop();if(closed[i])continue;closed[i]=1;budget--;if(returning?this.onDeck(nav[i],homeFloor):i===goal){const path=[];for(let n=i;n!==start;n=parents[n]){if(n<0)return [];path.push(n);}return path.reverse();}
      for(const j of nav[i].edges){if(!this.allowed[j]||(!returning&&!this.onDeck(nav[j],floor))||closed[j]||this.blockedEdges.has(`${i}/${j}`))continue;const before=this.boundary(nav[i]),after=this.boundary(nav[j]);if(after<0&&(before>=0||after<before-.02))continue;const score=scores[i]+distance(nav[i],nav[j])*(1+this.brightness[j]*.55);if(score>=scores[j])continue;scores[j]=score;parents[j]=i;push(j,score+estimate(j));}
    }return [];
  }
  private go(a:SkinAgent,goal:number){if(!this.allowed[goal]||!this.onDeck(this.map.nav[goal],a.originFloor))return;if(goal!==a.goal||(!a.path.length&&this.clock>=a.nextPath)){a.goal=goal;const start=a.path[0]??this.nearest(a.pos);a.path=this.route(start,goal);if(start>=0&&distance(a.pos,this.map.nav[start])>.08)a.path.unshift(start);a.nextPath=this.clock+.6;}}

  private returnHome(agent: SkinAgent) {
    if (this.returning.has(agent.id)) return;
    this.returning.add(agent.id);
    this.flanks.delete(agent.id);
    this.trails.delete(agent.id);
    this.walkUntil.delete(agent.id);
    agent.lastSeen = agent.fakeTask = undefined;
    agent.investigationGoal = undefined;
    agent.seenAt = -Infinity;
    agent.beast = false;
    agent.transform = agent.recoverUntil = 0;
    agent.state = 'wander';
    agent.goal = -1;

    let start = -1, closest = Infinity;
    for (const [i, node] of this.map.nav.entries()) {
      if (!this.allowed[i] || node.floor !== agent.pos.floor) continue;
      const range = distance(agent.pos, node);
      if (range >= closest) continue;
      start = i;
      closest = range;
    }
    const home = this.spawnNodes[agent.originFloor];
    agent.path = this.route(start, home, true);
    if (agent.path.length || (start >= 0 && this.onDeck(this.map.nav[start], agent.originFloor))) {
      agent.path.unshift(start);
    }
  }

  private finishReturn(agent: SkinAgent) {
    if (!this.onDeck(agent.pos, agent.originFloor)) {
      agent.pos = { ...this.map.nav[this.spawnNodes[agent.originFloor]] };
      agent.moving = false;
    }
    this.returning.delete(agent.id);
    agent.path = [];
    agent.nextThink = 0;
  }
  private sees(a: SkinAgent, t: SkinTarget) {
    if (t.lure) return false;
    const range = distance(a.pos, t.pos);
    if (range > SKIN_VISION || Math.abs(a.pos.y - t.pos.y) > 3.8) return false;
    const facing = faces(t.pos.x - a.pos.x, t.pos.z - a.pos.z, a.yaw, range, -.25);
    const tracking = (a.state === 'approach' || a.state === 'run' || a.state === 'beast')
      && this.clock - a.seenAt < .35 && !!a.lastSeen && distance(a.lastSeen, t.pos) < 3;
    return (tracking || facing || range < 4) && this.world.sight({ ...a.pos, y: a.pos.y + 1.3 }, { ...t.pos, y: t.eye.y });
  }
  private beam(a: SkinAgent, t: SkinTarget) {
    if (distance(a.pos, t.pos) > 13) return false;
    const face = { ...a.pos, y: a.pos.y + 1.15 };
    return beamReaches(t.eye, face, t.beam, Infinity, .93, .01) && this.world.sight({ ...t.pos, y: t.eye.y }, face);
  }

  private hears(a: SkinAgent, t: SkinTarget) {
    const source = t.repairNoise ?? t.pos;
    if (this.safe(t.pos) || Math.abs(a.pos.y - source.y) >= 1 || !withinHearingRange(distance(a.pos, source), t.noise, 1 + .2 * this.pressure)) return false;
    if (t.lure) return true;
    if (t.repairNoise && this.world.repairAudible) return this.world.repairAudible(a.pos, source);
    return this.world.sight({ ...a.pos, y: a.pos.y + 1 }, { ...source, y: source.y + 1 });
  }

  private clearWalk(from: ParkingPoint, to: ParkingPoint) {
    const steps = Math.ceil(distance(from, to) / .22);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p = this.world.fits(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t, from.y + (to.y - from.y) * t);
      if (!p || !this.onDeck(p, from.floor) || this.safe(p) || this.boundary(p) < 0) return false;
    }
    return true;
  }

  private startFlank(agent: SkinAgent, target: SkinTarget) {
    if (target.yaw === undefined || agent.pos.floor !== target.pos.floor) return false;
    const start = agent.path[0] ?? this.nearest(agent.pos);
    if (start < 0) return false;
    const forwardX = -Math.sin(target.yaw), forwardZ = -Math.cos(target.yaw);
    const choices: { goal: number; score: number }[] = [];
    for (const goal of this.floorNodes[target.pos.floor]) {
      if (goal === start) continue;
      const node = this.map.nav[goal];
      const dx = node.x - target.pos.x, dz = node.z - target.pos.z;
      const range = Math.hypot(dx, dz), forward = dx * forwardX + dz * forwardZ;
      if (range < SKIN_TRANSFORM_DISTANCE || range > SKIN_RUN_DISTANCE + 2 || forward > .15 * range
        || Math.abs(node.y - target.pos.y) > 1) continue;
      choices.push({ goal, score: distance(agent.pos, node) + .5 * forward });
    }
    choices.sort((a, b) => a.score - b.score);
    for (const { goal } of choices.slice(0, 3)) {
      const path = this.route(start, goal);
      if (!path.length) continue;
      if (distance(agent.pos, this.map.nav[start]) > .08) path.unshift(start);
      agent.path = path;
      agent.goal = goal;
      agent.nextPath = this.clock + .6;
      this.flanks.set(agent.id, { goal, targetId: target.id });
      return true;
    }
    return false;
  }

  private remember(agent: SkinAgent, position: ParkingPoint) {
    agent.investigationGoal = undefined;
    const previous = agent.lastSeen;
    const trail = this.trails.get(agent.id) ?? { headingX: 0, headingZ: 0, visited: new Set<number>() };
    if (previous?.floor === position.floor) {
      const dx = position.x - previous.x, dz = position.z - previous.z;
      const length = Math.hypot(dx, dz);
      if (length > .1) {
        trail.headingX = dx / length;
        trail.headingZ = dz / length;
      }
    } else {
      trail.headingX = trail.headingZ = 0;
    }
    trail.visited.clear();
    this.trails.set(agent.id, trail);
    agent.lastSeen = { ...position };
    agent.seenAt = this.clock;
  }

  private searchArea(agent: SkinAgent, last: ParkingPoint) {
    const trail = this.trails.get(agent.id);
    const lastNode = this.nearest(last);
    if (!trail || !trail.visited.has(lastNode)) {
      if (agent.goal !== lastNode || agent.path.length) return this.go(agent, lastNode);
      trail?.visited.add(lastNode);
    }
    if (!trail || agent.path.length) return;
    const aimX = last.x + trail.headingX * 4, aimZ = last.z + trail.headingZ * 4;
    const choices = this.floorNodes[last.floor]
      .filter(i => !trail.visited.has(i) && distance(this.map.nav[i], last) < 10)
      .sort((a, b) => {
        const left = this.map.nav[a], right = this.map.nav[b];
        return Math.hypot(left.x - aimX, left.z - aimZ) - Math.hypot(right.x - aimX, right.z - aimZ);
      });
    const goal = choices[0];
    if (goal === undefined) return;
    trail.visited.add(goal);
    this.go(agent, goal);
  }
  private readonly brain = {
    waitOutside: (agent: SkinAgent, target: SkinTarget) => {
      if (!this.occupied) return false;
      this.flanks.delete(agent.id);
      agent.lastSeen = undefined;
      this.trails.delete(agent.id);
      if (agent.pos.floor !== target.pos.floor) return false;
      agent.investigationGoal = undefined;
      agent.state = 'wait';
      this.go(agent, this.nearest(agent.pos, i => this.boundary(this.map.nav[i]) > .6));
      return true;
    },
    approach: (agent: SkinAgent, target: SkinTarget) => {
      const flank = this.flanks.get(agent.id);
      const range = distance(agent.pos, target.pos);
      const followingFlank = flank && flank.targetId === target.id && flank.goal === agent.goal && agent.path.length
        && agent.state === 'approach' && range >= SKIN_RUN_DISTANCE && target.pos.floor === agent.pos.floor
        && this.clock - agent.seenAt < SKIN_SEARCH;
      if (!target.alive || this.occupied || !this.sees(agent, target)) {
        if (target.alive && !this.occupied && followingFlank) return true;
        this.flanks.delete(agent.id);
        return false;
      }
      const startingApproach = !agent.beast && !['approach', 'run', 'transform'].includes(agent.state);
      const runRange = agent.state === 'run' ? SKIN_RUN_DISTANCE + .75 : SKIN_RUN_DISTANCE;
      if (startingApproach)
        this.walkUntil.set(agent.id, this.clock + SKIN_APPROACH_BEAT);
      this.remember(agent, target.pos);
      const walking = this.clock + 1e-9 < (this.walkUntil.get(agent.id) ?? 0);
      if (agent.beast) agent.state = 'beast';
      else if (walking) agent.state = 'approach';
      else if (range < SKIN_TRANSFORM_DISTANCE) agent.state = 'transform';
      else agent.state = range < runRange ? 'run' : 'approach';
      if (followingFlank) return true;
      this.flanks.delete(agent.id);
      if (startingApproach && range >= SKIN_RUN_DISTANCE && this.startFlank(agent, target)) return true;
      this.go(agent, this.nearest(target.pos));
      return true;
    },
    search: (agent: SkinAgent, target: SkinTarget) => {
      if (!this.occupied && target.alive) {
        const range = distance(agent.pos, target.pos);
        const heard = this.hears(agent, target);
        const flashlight = !!target.beam && range < SKIN_FLASH_ATTENTION
          && this.world.sight({ ...agent.pos, y: agent.pos.y + 1.3 }, { ...target.pos, y: target.eye.y });
        if (heard || flashlight) {
          this.remember(agent, flashlight ? target.pos : target.repairNoise ?? target.pos);
        }
      }
      const last = agent.lastSeen;
      if (!last || this.clock - agent.seenAt >= SKIN_SEARCH) return false;
      agent.state = 'search';
      this.searchArea(agent, last);
      return true;
    },
    investigate: (agent: SkinAgent, target: SkinTarget) => {
      if (!target.alive || target.lure || this.occupied || agent.beast) return false;
      if (this.investigationDue()) {
        const goal = this.nearest(target.pos);
        agent.investigationGoal = goal >= 0 ? goal : undefined;
        agent.lastSeen = undefined;
        agent.fakeTask = undefined;
        this.trails.delete(agent.id);
      }
      if (agent.investigationGoal === undefined) return false;
      this.go(agent, agent.investigationGoal);
      if (agent.path.length) {
        agent.state = 'search';
        return true;
      }
      agent.investigationGoal = undefined;
      return false;
    },
    wander: (agent: SkinAgent) => {
      this.wander(agent);
      return true;
    },
  };

  private think(agent: SkinAgent, target: SkinTarget) {
    agent.nextThink = this.clock + .25 - .1 * this.pressure;
    runBehaviors(BRAIN_ORDER, this.brain, agent, target);
  }

  private investigationDue() {
    return this.clock + 1e-9 >= this.nextInvestigation;
  }

  setCursedTapes(count: number) {
    const tier = this.map.options.mission === 'tapes' ? parkingCurseTier(count) : 0;
    this.nextInvestigation += SKIN_INVESTIGATION_INTERVAL[tier] - SKIN_INVESTIGATION_INTERVAL[this.curseTier];
    this.curseTier = tier;
  }

  setRepairedGenerators(count: number) {
    if (this.map.options.mission !== 'generators') return;
    const repaired = Math.max(0, Math.min(5, Math.floor(count)));
    this.nextInvestigation -= (repaired - this.repairedGenerators) * SKIN_GENERATOR_INVESTIGATION_REDUCTION;
    this.repairedGenerators = repaired;
  }

  setSurvivalElapsed(seconds: number) {
    if (this.map.options.mission !== 'survive') return;
    const tier = Math.floor(Math.max(0, Math.min((this.map.options.minutes ?? 5) * 60, seconds)) / 90);
    this.nextInvestigation -= (tier - this.survivalTier) * SKIN_SURVIVAL_INVESTIGATION_REDUCTION;
    this.survivalTier = tier;
  }

  private wander(a: SkinAgent) {
    if (a.investigationGoal !== undefined) {
      a.investigationGoal = undefined;
      a.path = [];
      a.goal = -1;
    }
    this.trails.delete(a.id);
    if(a.lastSeen){a.beast=false;a.transform=0;a.recoverUntil=0;a.path=[];a.goal=-1;}a.lastSeen=undefined;
    if(a.path.length){a.state='wander';return;}
    if(this.clock<a.waitUntil){a.state='idle';if(a.fakeTask)a.yaw=Math.atan2(a.fakeTask.x-a.pos.x,a.fakeTask.z-a.pos.z);return;}
    const tasks=this.map.objectives.filter(p=>p.floor===a.pos.floor);
    if(tasks.length&&this.random(a.id*91+Math.floor(this.clock))<.3){a.fakeTask={...tasks[Math.floor(this.random(a.id*43+this.clock)*tasks.length)]};this.go(a,this.nearest(a.fakeTask));a.state='wander';return;}a.fakeTask=undefined;
    const choices=this.floorNodes[a.pos.floor].filter(i=>distance(this.map.nav[i],a.pos)>5&&distance(this.map.nav[i],a.pos)<22).sort((i,j)=>this.brightness[i]-this.brightness[j]);
    this.go(a,choices[Math.floor(this.random(a.id*19+Math.floor(this.clock))*Math.max(1,choices.length*.4))]??this.nearest(a.pos));a.state='wander';a.waitUntil=this.clock+(2+this.random(a.id+this.clock)*4)*(1-.5*this.pressure);
  }
  update(dt:number,target:SkinTarget){this.updateMany(dt,[target]);}
  updateMany(dt:number,targets:SkinTarget[]){
    this.accumulator=Math.min(.25,this.accumulator+Math.max(0,dt));
    while(this.accumulator>=.05){this.accumulator-=.05;this.step(.05,targets.filter(t=>t.alive));}
  }
  speedBonus = 0;

  private step(dt:number,targets:SkinTarget[]){
    this.clock+=dt;
    const speedBonus = this.speedBonus + SKIN_CURSE_SPEED[this.curseTier] + this.repairedGenerators * SKIN_GENERATOR_SPEED
      + this.survivalTier * SKIN_SURVIVAL_SPEED;
    const investigationDue = this.investigationDue();
    if(this.clock>=this.nextBrightness){this.map.nav.forEach((n,i)=>this.brightness[i]=this.world.bright(n));this.nextBrightness=this.clock+1;}
    const roomOf=(t:SkinTarget)=>this.map.floors[t.pos.floor].rooms.find(r=>parkingContains(r,t.pos.x,t.pos.z,.15));
    for(const a of this.agents){
      if (!this.onDeck(a.pos, a.originFloor)) {
        this.occupied = undefined;
        this.returnHome(a);
        a.moving = false;
        this.move(a, (SKIN_SPEED.walk + speedBonus) * dt, false, true);
        if (this.onDeck(a.pos, a.originFloor) || !a.path.length) this.finishReturn(a);
        continue;
      }
      const ranked=targets.filter(target=>target.pos.floor===a.originFloor).sort((l,r)=>distance(a.pos,l.pos)-distance(a.pos,r.pos));
      const t=(ranked.length<=1?ranked[0]:ranked.find(target=>!roomOf(target)&&this.sees(a,target))
        ?? ranked.find(target=>target.repairNoise && this.hears(a,target)) ?? ranked[0])
        ?? {pos:a.pos,eye:a.pos,beam:null,noise:0,alive:false};
      this.occupied=t.alive?roomOf(t):undefined;
      const canRepel = this.clock + 1e-9 >= a.repelUntil + SKIN_LIGHT_RESISTANCE_SECONDS || a.repelUntil === 0;
      if (canRepel && (a.beast || a.state === 'transform') && ranked.some(target => this.beam(a, target))) {
        a.repelUntil = this.clock + SKIN_FLEE_SECONDS;
        a.state = 'flee';
        a.beast = true;
        a.transform = 1.15;
        a.recoverUntil = 0;
        a.nextThink = this.clock;
      }
      if(this.clock<a.repelUntil){a.state='flee';if(this.clock>=a.nextThink){a.nextThink=this.clock+.35;const choices=this.floorNodes[a.pos.floor].filter(i=>distance(this.map.nav[i],a.pos)<15&&distance(this.map.nav[i],t.pos)>distance(a.pos,t.pos)+3).sort((i,j)=>distance(this.map.nav[j],t.pos)-distance(this.map.nav[i],t.pos));this.go(a,choices[0]??this.nearest(a.pos));}}
      else if (a.state === 'flee') this.think(a, t);
      else if(a.state==='recover'){
        a.moving=false;if(this.clock+1e-9<a.recoverUntil)continue;a.state='search';a.nextThink=0;this.think(a,t);
      }
      else if(a.state!=='transform'&&(investigationDue||this.clock>=a.nextThink))this.think(a,t);
      if(a.state==='transform'){a.transform+=dt;if(a.transform>=1.15){a.beast=true;a.state='recover';a.recoverUntil=this.clock+SKIN_RECOVERY;a.path=[];a.transform=1.15;}}
      a.moving=false;
      if(a.beast&&this.clock>=a.repelUntil&&a.state!=='transform'&&a.state!=='recover'&&this.clock-a.seenAt>=SKIN_SEARCH){a.beast=false;a.transform=0;a.recoverUntil=0;a.lastSeen=undefined;a.path=[];a.goal=-1;a.nextThink=0;a.state=this.occupied?'wait':'wander';}
      const canMove=a.state!=='transform'&&a.state!=='recover'&&a.state!=='idle';
      if(canMove){
        const speed=a.state==='flee'?SKIN_SPEED.flee:a.state==='beast'?SKIN_SPEED.beast:a.state==='run'?SKIN_SPEED.run:SKIN_SPEED.walk;
        const direct = !this.occupied && !this.flanks.has(a.id) && (a.state === 'beast' || a.state === 'run' || a.state === 'approach')
          && this.clock - a.seenAt < .35 && !!a.lastSeen && distance(a.pos, a.lastSeen) < 7 && this.clearWalk(a.pos, a.lastSeen);
        if (!direct && a.path.length > 1 && distance(a.pos, this.map.nav[a.path[1]]) <= 5 && this.clearWalk(a.pos, this.map.nav[a.path[1]])) {
          a.path.shift();
        }
        this.move(a, (speed + speedBonus) * dt, direct);
      }
      if(a.beast&&a.state==='beast'&&!this.occupied&&t.alive&&!t.lure&&this.clock>=a.repelUntil&&this.clock>=a.attackAt&&distance(a.pos,t.pos)<1.35&&this.world.sight({...a.pos,y:a.pos.y+1.1},{...t.pos,y:t.eye.y})){a.attackAt=this.clock+1.4;this.world.hit(t.id);}
    }
    if (investigationDue) {
      const interval = SKIN_INVESTIGATION_INTERVAL[this.curseTier] - this.repairedGenerators * SKIN_GENERATOR_INVESTIGATION_REDUCTION
        - this.survivalTier * SKIN_SURVIVAL_INVESTIGATION_REDUCTION;
      this.nextInvestigation = Math.max(this.clock, this.nextInvestigation) + interval;
    }
  }
  private move(a: SkinAgent, remaining: number, direct: boolean, returning = false) {
    for(let segment=0;segment<4&&remaining>.00001;segment++){
      if(!direct&&!a.path.length)break;
      const n=direct?a.lastSeen!:this.map.nav[a.path[0]],d=distance(a.pos,n);
      if(d<.0001){if(!direct){a.path.shift();continue;}break;}
      const step=Math.min(d,remaining),f=step/d,x=a.pos.x+(n.x-a.pos.x)*f,z=a.pos.z+(n.z-a.pos.z)*f,y=a.pos.y+(n.y-a.pos.y)*f,p=this.world.fits(x,z,y),oldBoundary=this.boundary(a.pos);
      if(!p||(!returning&&!this.onDeck(p,a.originFloor))||this.safe(p)||(this.boundary(p)<0&&this.boundary(p)<oldBoundary-.001)){a.path=[];a.nextPath=0;a.nextThink=0;break;}
      const heading = Math.atan2(x-a.pos.x,z-a.pos.z);
      const turn = Math.atan2(Math.sin(heading - a.yaw), Math.cos(heading - a.yaw));
      a.yaw += turn * .45;
      a.pos=p;a.moving=true;remaining-=step;
      if(!direct&&d-step<.0001){a.path.shift();if(!a.path.length&&a.state==='wander')a.waitUntil=this.clock+2+this.random(a.id*71+this.clock)*3;}
      if(direct&&d-step<.0001)break;
    }
  }
  get time(){return this.clock;}
}
