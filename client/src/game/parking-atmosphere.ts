import * as THREE from 'three';
import { type ParkingMap, type ParkingPoint, type ParkingRect } from '@backrooms/shared';

/** Niebla localizada: volúmenes pequeños sin atravesar paredes ni huecos. */
export class ParkingAtmosphere {
  readonly anchors: (ParkingPoint & { phase: number; lampId: number })[] = [];
  private volumes: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>[] = [];
  private shafts: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>[] = [];
  private drips: THREE.LineSegments;
  private impacts: THREE.InstancedMesh;
  private resources: { dispose(): void }[] = [];
  private dropPositions: Float32Array;
  private selected: typeof this.anchors = [];
  private floor = -1;
  private lastSelection = -Infinity;
  private group = new THREE.Group();
  private matrix = new THREE.Matrix4();
  constructor(private map: ParkingMap, scene: THREE.Scene, private low: boolean) {
    this.group.userData.parkingAtmosphere = true; scene.add(this.group);
    const overlaps = (a: ParkingRect,b: ParkingRect) => a.x < b.x+b.w && a.x+a.w > b.x && a.z < b.z+b.d && a.z+a.d > b.z;
    let lampId=-1;
    for (const f of map.floors) for (const [i,light] of f.fixtures.entries()) {
      lampId++;
      const r = { x: light.x-2.2,z: light.z-2.2,w:4.4,d:4.4 };
      if (r.x<f.bounds.x+.3 || r.z<f.bounds.z+.3 || r.x+r.w>f.bounds.x+f.bounds.w-.3 || r.z+r.d>f.bounds.z+f.bounds.d-.3) continue;
      if ([...f.walls,...f.pillars,...f.rooms,...f.cars.map(c=>({x:c.x-1.5,z:c.z-2.7,w:3,d:5.4})),...f.props,...f.furniture,...map.links.filter(l=>l.top===f.index||l.bottom===f.index)].some(b=>overlaps(r,b))) continue;
      this.anchors.push({x:light.x,y:f.y,z:light.z,floor:f.index,phase:i*1.713,lampId});
    }
    const vertex = `varying vec3 vWorld; varying vec3 vNormal; void main(){vNormal=normalize(mat3(modelMatrix)*normal);vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`;
    const box = new THREE.BoxGeometry(4.4,2.9,4.4); this.resources.push(box);
    const cone = new THREE.ConeGeometry(1.35,3.1,24,1,true); this.resources.push(cone);
    for(let i=0;i<(low?1:3);i++) {
      const fog = new THREE.ShaderMaterial({ uniforms:{uTime:{value:0},uPower:{value:1},uMin:{value:new THREE.Vector3()},uMax:{value:new THREE.Vector3()}}, vertexShader:vertex, fragmentShader:`
        varying vec3 vWorld; uniform float uTime,uPower; uniform vec3 uMin,uMax;
        float density(vec3 p){vec3 q=p*.9+vec3(uTime*.035,0.,uTime*.017);float n=sin(q.x+sin(q.z*1.7))*sin(q.z*.7+sin(q.y*2.1))+sin(q.x*2.3+q.z*1.3+uTime*.06)*.3;return (.65+n*.22)*exp(-(p.y-uMin.y)*1.35);}
        void main(){bool inside=all(greaterThanEqual(cameraPosition,uMin))&&all(lessThanEqual(cameraPosition,uMax));if(gl_FrontFacing==inside)discard;vec3 rd=normalize(vWorld-cameraPosition);vec3 inv=1./rd;vec3 a=(uMin-cameraPosition)*inv,b=(uMax-cameraPosition)*inv;vec3 mn=min(a,b),mx=max(a,b);float near=max(max(mn.x,mn.y),mn.z),far=min(min(mx.x,mx.y),mx.z);near=max(0.,near);if(far<=near)discard;float stepSize=(far-near)/${low?'4.':'10.'};float optical=0.;for(int j=0;j<${low?4:10};j++){vec3 p=cameraPosition+rd*(near+(float(j)+.5)*stepSize);float edge=smoothstep(0.,.6,min(min(p.x-uMin.x,uMax.x-p.x),min(p.z-uMin.z,uMax.z-p.z)));optical+=density(p)*edge*stepSize;}float alpha=(1.-exp(-optical*.12))*(1.-smoothstep(6.,18.,distance(cameraPosition,vWorld)));gl_FragColor=vec4(vec3(.14,.18,.15)+vec3(.02)*uPower,min(alpha,.25));}`,
        transparent:true,depthTest:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false });
      this.resources.push(fog); const mesh=new THREE.Mesh(box,fog);mesh.renderOrder=4;this.group.add(mesh);this.volumes.push(mesh);
      const shaft = new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uBase:{value:0},uPower:{value:1}},vertexShader:vertex,fragmentShader:`varying vec3 vWorld;varying vec3 vNormal;uniform float uTime,uBase,uPower;void main(){float h=clamp((vWorld.y-uBase)/3.1,0.,1.);float edge=smoothstep(0.,.45,abs(dot(normalize(vNormal),normalize(cameraPosition-vWorld))));float pulse=uPower;float alpha=.012*sin(h*3.14159)*edge*pulse*(1.-smoothstep(3.,15.,distance(cameraPosition,vWorld)));gl_FragColor=vec4(.61,.67,.48,alpha);}`,transparent:true,depthTest:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
      this.resources.push(shaft);const beam=new THREE.Mesh(cone,shaft);beam.renderOrder=3;this.group.add(beam);this.shafts.push(beam);
    }
    this.dropPositions=new Float32Array((low?3:8)*6);const drops=new THREE.BufferGeometry();drops.setAttribute('position',new THREE.BufferAttribute(this.dropPositions,3));this.resources.push(drops);
    const dripMaterial=new THREE.LineBasicMaterial({color:0x7b958a,transparent:true,opacity:.23,depthWrite:false,fog:true});this.resources.push(dripMaterial);this.drips=new THREE.LineSegments(drops,dripMaterial);this.drips.frustumCulled=false;this.group.add(this.drips);
    const ring=new THREE.RingGeometry(.035,.046,16).rotateX(-Math.PI/2),ringMaterial=new THREE.MeshBasicMaterial({color:0x59695e,transparent:true,opacity:.22,depthWrite:false,fog:true});this.resources.push(ring,ringMaterial);this.impacts=new THREE.InstancedMesh(ring,ringMaterial,low?3:8);this.impacts.frustumCulled=false;this.group.add(this.impacts);
  }
  inspect(floor:number) { return this.anchors.find(a=>a.floor===floor) ?? this.anchors[0]; }
  wetAt(p: ParkingPoint) {
    if (!this.group.visible || this.floor !== p.floor) return false;
    for (let i = 0; i < this.dropPositions.length; i += 6)
      if (this.dropPositions[i+4] > this.dropPositions[i+1] && Math.hypot(p.x-this.dropPositions[i],p.z-this.dropPositions[i+2]) < .24) return true;
    return false;
  }
  update(time:number,p:ParkingPoint,outputs?:ArrayLike<number>) {
    const indoors=this.map.floors[p.floor].rooms.some(r=>p.x>r.x&&p.x<r.x+r.w&&p.z>r.z&&p.z<r.z+r.d);
    this.group.visible=!indoors;
    if(indoors)return;
    if (this.floor!==p.floor || time-this.lastSelection>1) {
      this.floor=p.floor;this.lastSelection=time;
      this.selected=this.anchors.filter(a=>a.floor===p.floor).sort((a,b)=>(a.x-p.x)**2+(a.z-p.z)**2-(b.x-p.x)**2-(b.z-p.z)**2).slice(0,this.volumes.length);
    }
    this.volumes.forEach((mesh,i)=>{const a=this.selected[i],visible=!!a&&Math.hypot(a.x-p.x,a.z-p.z)<15;mesh.visible=visible;this.shafts[i].visible=visible;if(!a)return;mesh.position.set(a.x,a.y+1.53,a.z);mesh.material.uniforms.uTime.value=time;mesh.material.uniforms.uPower.value=outputs?.[a.lampId]??1;mesh.material.uniforms.uMin.value.set(a.x-2.2,a.y+.08,a.z-2.2);mesh.material.uniforms.uMax.value.set(a.x+2.2,a.y+2.98,a.z+2.2);this.shafts[i].position.set(a.x,a.y+1.78,a.z);this.shafts[i].material.uniforms.uBase.value=a.y+.23;this.shafts[i].material.uniforms.uTime.value=time;this.shafts[i].material.uniforms.uPower.value=outputs?.[a.lampId]??1;});
    this.drips.visible=this.impacts.visible=this.selected.length>0;
    for(let i=0;i<this.dropPositions.length/6;i++){const a=this.selected[i%this.selected.length];const phase=(time*.45+i*.371)%1,active=!!a&&Math.hypot(a.x-p.x,a.z-p.z)<14;if(!a){for(let j=0;j<6;j++)this.dropPositions[i*6+j]=0;continue;}const x=a.x+Math.sin(i*2.1)*.7,z=a.z+Math.cos(i*1.7)*.7,y=a.y+3.1*(1-phase*phase);
      this.dropPositions.set([x,y,z,x,y+(active ? .09 : 0),z],i*6);const size=active&&phase>.88?(phase-.88)*10:0;this.matrix.makeScale(size,1,size).setPosition(x,a.y+.006,z);this.impacts.setMatrixAt(i,this.matrix);}
    this.drips.geometry.attributes.position.needsUpdate=true;this.impacts.instanceMatrix.needsUpdate=true;
  }
  dispose(){this.group.removeFromParent();this.resources.forEach(r=>r.dispose());}
}
