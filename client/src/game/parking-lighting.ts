/** Estado determinista de un fluorescente; una minoría tiene averías breves. */
export function parkingLampState(seed: number, id: number, stable: boolean, time: number) {
  const random = (n: number) => { const v=Math.sin(n*12.9898+seed*.01)*43758.5453;return v-Math.floor(v); };
  const brightness=.86+random(id*71+3)*.14, faulty=!stable&&random(id*19)<.18;
  if(!faulty)return { output:brightness, faulty:false, label:'STEADY', next:Infinity };
  const period=15+random(id*37+5)*13, offset=random(id*43+1)*period, clock=Math.max(0,time)+offset, cycle=Math.floor(clock/period), phase=clock-cycle*period;
  const start=(n:number)=>1+random(id*83+n*29+7)*3;
  const event=start(cycle), age=phase-event, long=random(id*53+cycle*17)<.18;
  const first=.065+random(id+cycle*3)*.075, second=.10+random(id*11+cycle)*.10;
  const duration=long?.48+random(id*7+cycle)*.27:first+.09+second;
  const off=age>=0&&(long?age<duration:age<first||(age>=first+.09&&age<duration));
  const next=phase<event?event-phase:period-phase+start(cycle+1);
  return { output:off?0:brightness, faulty:true, label:off?'DROPOUT':age>=0&&age<duration?'RESTRIKE':'ON', next:off?duration-age:next };
}
