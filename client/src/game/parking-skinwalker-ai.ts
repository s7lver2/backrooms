import { parkingContains, parkingGeneratorBounds, runBehaviors, type ParkingMap, type ParkingPoint, type ParkingRoom } from '@backrooms/shared';

export type SkinState = 'wander'|'idle'|'approach'|'run'|'transform'|'recover'|'beast'|'flee'|'search'|'wait';
export const SKIN_APPROACH_BEAT=1,SKIN_VISION=12,SKIN_RUN_DISTANCE=5,SKIN_RECOVERY=3,SKIN_SEARCH=7,SKIN_FLASH_ATTENTION=12;
export const SKIN_SPEED = { walk:1.6, run:5.1, beast:5.82, flee:5.82 };
export interface SkinAgent { id:number; originFloor:number; pos:ParkingPoint; yaw:number; state:SkinState; beast:boolean; transform:number; recoverUntil:number; repelUntil:number; nextThink:number; nextPath:number; lastSeen?:ParkingPoint; seenAt:number; path:number[]; goal:number; attackAt:number; moving:boolean; waitUntil:number; fakeTask?:ParkingPoint }
export interface SkinTarget { pos:ParkingPoint; eye:{x:number;y:number;z:number}; beam:{x:number;y:number;z:number}|null; noise:number; alive:boolean }
export interface SkinWorld { fits(x:number,z:number,y:number):ParkingPoint|null; sight(a:ParkingPoint,b:ParkingPoint):boolean; bright(p:ParkingPoint):number; hit():void }
const distance=(a:ParkingPoint,b:ParkingPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const roomDistance=(r:ParkingRoom,p:ParkingPoint)=>Math.hypot(Math.max(r.x-p.x,0,p.x-r.x-r.w),Math.max(r.z-p.z,0,p.z-r.z-r.d));
const BRAIN_ORDER = ['waitOutside', 'approach', 'search', 'wander'] as const;

/** Simulacion local sobre la misma navegacion/collision del parking, sin teletransportes. */
export class ParkingSkinAI {
  readonly agents:SkinAgent[]=[];
  pressure=0;
  private allowed:Uint8Array;
  private floorNodes:number[][];
  private clock=0;
  private brightness:Float32Array;
  private nextBrightness=0;
  private blockedEdges=new Set<string>();
  private accumulator=0;
  private occupied?:ParkingRoom;
  private walkUntil = new Map<number,number>();
  private safe(p:ParkingPoint){return this.map.floors[p.floor].rooms.some(r=>parkingContains(r,p.x,p.z,.38));}
  private random(n:number){const v=Math.sin(n*12.9898+this.map.seed*.01)*43758.5453;return v-Math.floor(v);}
  constructor(readonly map:ParkingMap,private world:SkinWorld,initial:ParkingPoint=map.spawn) {
    this.brightness=new Float32Array(map.nav.length);
    this.allowed=new Uint8Array(map.nav.length);this.floorNodes=map.floors.map(()=>[]);
    map.nav.forEach((n,i)=>{if(!this.safe(n)&&!(map.options.mission==='generators'&&map.objectives.some(g=>g.floor===n.floor&&parkingContains(parkingGeneratorBounds(g),n.x,n.z,.35)))){this.allowed[i]=1;this.floorNodes[n.floor].push(i);}});
    for(const [i,n] of map.nav.entries())for(const j of n.edges){const b=map.nav[j];for(let step=1;step<8;step++){const t=step/8,p={x:n.x+(b.x-n.x)*t,z:n.z+(b.z-n.z)*t,y:n.y+(b.y-n.y)*t,floor:t<.5?n.floor:b.floor};if(this.safe(p)){this.blockedEdges.add(`${i}/${j}`);break;}}}
    for(const floor of map.floors){const candidates=this.floorNodes[floor.index].filter(i=>Math.abs(map.nav[i].y-floor.y)<.01&&world.fits(map.nav[i].x,map.nav[i].z,map.nav[i].y)&&distance(map.nav[i],initial)>20);const id=floor.index,index=candidates[Math.floor(this.random(id*19+11)*candidates.length)]??this.floorNodes[id][0];if(index===undefined)throw Error('No Skinwalker spawn');this.agents.push({id,originFloor:id,pos:{...map.nav[index]},yaw:this.random(id*71)*6.28,state:'idle',beast:false,transform:0,recoverUntil:0,repelUntil:0,nextThink:id*.05,nextPath:0,seenAt:-Infinity,path:[],goal:-1,attackAt:0,moving:false,waitUntil:1+this.random(id*37)*3});}
  }
  private nearest(p:ParkingPoint,filter?:(i:number)=>boolean){let best=-1,d=Infinity;for(const i of this.floorNodes[p.floor]){if(filter&&!filter(i))continue;const q=distance(p,this.map.nav[i]);if(q<d){d=q;best=i;}}return best;}
  private boundary(p:ParkingPoint){if(!this.occupied||p.floor!==this.map.floors.find(f=>f.rooms.includes(this.occupied!))?.index)return Infinity;return Math.min(Math.hypot(p.x-this.occupied.door.x,p.z-this.occupied.door.z)-5,roomDistance(this.occupied,p)-2.5);}
  private route(start:number,goal:number){
    if(start<0||goal<0)return [];const nav=this.map.nav,scores=new Float64Array(nav.length).fill(Infinity),parents=new Int32Array(nav.length).fill(-1),closed=new Uint8Array(nav.length),heap:[number,number][]=[];
    const push=(id:number,f:number)=>{let i=heap.length;heap.push([id,f]);while(i){const p=(i-1)>>1;if(heap[p][1]<=f)break;heap[i]=heap[p];i=p;}heap[i]=[id,f];};
    const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][1]<heap[c][1])c++;if(heap[c][1]>=last[1])break;heap[i]=heap[c];i=c;}heap[i]=last;}return first[0];};
    scores[start]=0;push(start,distance(nav[start],nav[goal]));let budget=nav.length;
    while(heap.length&&budget>0){const i=pop();if(closed[i])continue;closed[i]=1;budget--;if(i===goal){const path=[];for(let n=i;n!==start;n=parents[n]){if(n<0)return [];path.push(n);}return path.reverse();}
      for(const j of nav[i].edges){if(!this.allowed[j]||closed[j]||this.blockedEdges.has(`${i}/${j}`))continue;const before=this.boundary(nav[i]),after=this.boundary(nav[j]);if(after<0&&(before>=0||after<before-.02))continue;const score=scores[i]+distance(nav[i],nav[j])*(1+this.brightness[j]*.55);if(score>=scores[j])continue;scores[j]=score;parents[j]=i;push(j,score+distance(nav[j],nav[goal]));}
    }return [];
  }
  private go(a:SkinAgent,goal:number){if(goal<0)return;if(goal!==a.goal||(!a.path.length&&this.clock>=a.nextPath)){a.goal=goal;const start=a.path[0]??this.nearest(a.pos);a.path=this.route(start,goal);if(start>=0&&distance(a.pos,this.map.nav[start])>.08)a.path.unshift(start);a.nextPath=this.clock+.6;}}
  private sees(a:SkinAgent,t:SkinTarget){const d=distance(a.pos,t.pos);if(d>SKIN_VISION||Math.abs(a.pos.y-t.pos.y)>3.8)return false;const dot=(Math.sin(a.yaw)*(t.pos.x-a.pos.x)+Math.cos(a.yaw)*(t.pos.z-a.pos.z))/Math.max(.01,d);return (dot>-.25||d<4)&&this.world.sight({...a.pos,y:a.pos.y+1.3},{...t.pos,y:t.eye.y});}
  private beam(a:SkinAgent,t:SkinTarget){if(!t.beam||distance(a.pos,t.pos)>13)return false;const dx=a.pos.x-t.eye.x,dy=a.pos.y+1.15-t.eye.y,dz=a.pos.z-t.eye.z,d=Math.hypot(dx,dy,dz);return (dx*t.beam.x+dy*t.beam.y+dz*t.beam.z)/Math.max(.01,d)>.93&&this.world.sight({...t.pos,y:t.eye.y},{...a.pos,y:a.pos.y+1.15});}
  private readonly brain = {
    waitOutside: (agent: SkinAgent, target: SkinTarget) => {
      if (!this.occupied) return false;
      agent.lastSeen = undefined;
      if (agent.pos.floor !== target.pos.floor) return false;
      agent.state = 'wait';
      this.go(agent, this.nearest(agent.pos, i => this.boundary(this.map.nav[i]) > .6));
      return true;
    },
    approach: (agent: SkinAgent, target: SkinTarget) => {
      if (this.occupied || !target.alive || !this.sees(agent, target)) return false;
      if (!agent.beast && !['approach', 'run', 'transform'].includes(agent.state))
        this.walkUntil.set(agent.id, this.clock + SKIN_APPROACH_BEAT);
      agent.lastSeen = { ...target.pos };
      agent.seenAt = this.clock;
      const range = distance(agent.pos, target.pos);
      const walking = this.clock + 1e-9 < (this.walkUntil.get(agent.id) ?? 0);
      if (agent.beast) agent.state = 'beast';
      else if (walking) agent.state = 'approach';
      else if (range < 3) agent.state = 'transform';
      else agent.state = range < SKIN_RUN_DISTANCE ? 'run' : 'approach';
      this.go(agent, this.nearest(target.pos));
      return true;
    },
    search: (agent: SkinAgent, target: SkinTarget) => {
      if (!this.occupied && target.alive) {
        const range = distance(agent.pos, target.pos);
        const heard = target.noise > 0 && range < target.noise * (1 + .2 * this.pressure)
          && Math.abs(agent.pos.y - target.pos.y) < 1
          && this.world.sight({ ...agent.pos, y: agent.pos.y + 1 }, { ...target.pos, y: target.pos.y + 1 });
        const flashlight = !!target.beam && range < SKIN_FLASH_ATTENTION
          && this.world.sight({ ...agent.pos, y: agent.pos.y + 1.3 }, { ...target.pos, y: target.eye.y });
        if (heard || flashlight) {
          agent.lastSeen = { ...target.pos };
          agent.seenAt = this.clock;
        }
      }
      const last = agent.lastSeen;
      if (!last || this.clock - agent.seenAt >= SKIN_SEARCH) return false;
      agent.state = 'search';
      let goal = this.nearest(last);
      if (distance(agent.pos, last) < 1.2) {
        const choices = this.floorNodes[last.floor].filter(i => distance(this.map.nav[i], last) < 8);
        const index = Math.floor(this.random(agent.id * 41 + Math.floor(this.clock)) * choices.length);
        goal = choices[index] ?? goal;
      }
      this.go(agent, goal);
      return true;
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

  private wander(a: SkinAgent) {
    if(a.lastSeen){a.beast=false;a.transform=0;a.recoverUntil=0;a.path=[];a.goal=-1;}a.lastSeen=undefined;
    if(a.path.length){a.state='wander';return;}
    if(this.clock<a.waitUntil){a.state='idle';if(a.fakeTask)a.yaw=Math.atan2(a.fakeTask.x-a.pos.x,a.fakeTask.z-a.pos.z);return;}
    const tasks=this.map.objectives.filter(p=>p.floor===a.pos.floor);
    if(tasks.length&&this.random(a.id*91+Math.floor(this.clock))<.3){a.fakeTask={...tasks[Math.floor(this.random(a.id*43+this.clock)*tasks.length)]};this.go(a,this.nearest(a.fakeTask));a.state='wander';return;}a.fakeTask=undefined;
    const choices=this.floorNodes[a.pos.floor].filter(i=>distance(this.map.nav[i],a.pos)>5&&distance(this.map.nav[i],a.pos)<22).sort((i,j)=>this.brightness[i]-this.brightness[j]);
    this.go(a,choices[Math.floor(this.random(a.id*19+Math.floor(this.clock))*Math.max(1,choices.length*.4))]??this.nearest(a.pos));a.state='wander';a.waitUntil=this.clock+(2+this.random(a.id+this.clock)*4)*(1-.5*this.pressure);
  }
  update(dt:number,target:SkinTarget){this.accumulator=Math.min(.25,this.accumulator+Math.max(0,dt));while(this.accumulator>=.05){this.accumulator-=.05;this.step(.05,target);}}
  private step(dt:number,t:SkinTarget){
    this.clock+=dt;if(this.clock>=this.nextBrightness){this.map.nav.forEach((n,i)=>this.brightness[i]=this.world.bright(n));this.nextBrightness=this.clock+1;}this.occupied=this.map.floors[t.pos.floor].rooms.find(r=>parkingContains(r,t.pos.x,t.pos.z,.15));
    for(const a of this.agents){
      if((a.beast||a.state==='transform')&&this.beam(a,t)){a.repelUntil=this.clock+3;a.state='flee';a.beast=true;a.transform=1.15;a.recoverUntil=0;}
      if(this.clock<a.repelUntil){a.state='flee';if(this.clock>=a.nextThink){a.nextThink=this.clock+.35;const choices=this.floorNodes[a.pos.floor].filter(i=>distance(this.map.nav[i],a.pos)<15&&distance(this.map.nav[i],t.pos)>distance(a.pos,t.pos)+3).sort((i,j)=>distance(this.map.nav[j],t.pos)-distance(this.map.nav[i],t.pos));this.go(a,choices[0]??this.nearest(a.pos));}}
      else if(a.state==='recover'){
        a.moving=false;if(this.clock+1e-9<a.recoverUntil)continue;a.state='search';a.nextThink=0;this.think(a,t);
      }
      else if(this.clock>=a.nextThink)this.think(a,t);
      if(a.state==='transform'){a.transform+=dt;if(a.transform>=1.15){a.beast=true;a.state='recover';a.recoverUntil=this.clock+SKIN_RECOVERY;a.path=[];a.transform=1.15;}}
      a.moving=false;
      if(a.beast&&this.clock>=a.repelUntil&&a.state!=='transform'&&a.state!=='recover'&&this.clock-a.seenAt>=SKIN_SEARCH){a.beast=false;a.transform=0;a.recoverUntil=0;a.lastSeen=undefined;a.path=[];a.goal=-1;a.nextThink=0;a.state=this.occupied?'wait':'wander';}
      const canMove=a.state!=='transform'&&a.state!=='recover'&&a.state!=='idle';
      if(canMove){
        const speed=a.state==='flee'?SKIN_SPEED.flee:a.state==='beast'?SKIN_SPEED.beast:a.state==='run'?SKIN_SPEED.run:SKIN_SPEED.walk;
        let remaining=speed*dt;
        for(let segment=0;segment<4&&remaining>.00001;segment++){
          const direct=!this.occupied&&(a.state==='beast'||a.state==='run'||a.state==='approach')&&this.clock-a.seenAt<.35&&!!a.lastSeen&&distance(a.pos,a.lastSeen)<4;
          if(!direct&&!a.path.length)break;
          const n=direct?a.lastSeen!:this.map.nav[a.path[0]],d=distance(a.pos,n);
          if(d<.0001){if(!direct){a.path.shift();continue;}break;}
          const step=Math.min(d,remaining),f=step/d,x=a.pos.x+(n.x-a.pos.x)*f,z=a.pos.z+(n.z-a.pos.z)*f,y=a.pos.y+(n.y-a.pos.y)*f,p=this.world.fits(x,z,y),oldBoundary=this.boundary(a.pos);
          if(!p||this.safe(p)||(this.boundary(p)<0&&this.boundary(p)<oldBoundary-.001)){a.path=[];a.nextPath=0;a.nextThink=0;break;}
          a.yaw=Math.atan2(x-a.pos.x,z-a.pos.z);a.pos=p;a.moving=true;remaining-=step;
          if(!direct&&d-step<.0001){a.path.shift();if(!a.path.length&&a.state==='wander')a.waitUntil=this.clock+2+this.random(a.id*71+this.clock)*3;}
          if(direct&&d-step<.0001)break;
        }
      }
      if(a.beast&&a.state==='beast'&&!this.occupied&&t.alive&&this.clock>=a.repelUntil&&this.clock>=a.attackAt&&distance(a.pos,t.pos)<1.35&&this.world.sight({...a.pos,y:a.pos.y+1.1},{...t.pos,y:t.eye.y})){a.attackAt=this.clock+1.4;this.world.hit();}
    }
  }
  get time(){return this.clock;}
}
