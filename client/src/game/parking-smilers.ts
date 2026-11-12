import * as THREE from 'three';
import {parkingArea,type ParkingPoint} from '@backrooms/shared';
import type { ParkingLevel } from './parking';
import type { SkinTarget } from './parking-skinwalker-ai';
import { ParkingSmilerAI,SMILER_DARK,type DarkSection } from './parking-smiler-ai';

/** Cara del Smiler sobre el humo, orientada hacia el jugador. */
export class ParkingSmilers {
  readonly ai:ParkingSmilerAI;
  private group=new THREE.Group();private visuals=new Map<string,THREE.Group>();
  private resources:{dispose():void}[]=[];private selected?:DarkSection;private last?:ParkingPoint;private player?:ParkingPoint;private inspection=0;
  private smoke=new Map<string,THREE.InstancedMesh>();private smokeGeometry:THREE.PlaneGeometry;private smokeMaterial:THREE.MeshBasicMaterial;private smokeCount:number;
  private smokeAxis=new THREE.Vector3(0,0,1);private smokeMatrix=new THREE.Matrix4();private smokePosition=new THREE.Vector3();private smokeScale=new THREE.Vector3();private smokeRotation=new THREE.Quaternion();
  private face:THREE.PlaneGeometry;private veil:THREE.PlaneGeometry;private faceMat:THREE.MeshBasicMaterial;private veilMat:THREE.MeshBasicMaterial;
  constructor(private level:ParkingLevel,hit:()=>void,faceTexture:THREE.Texture,low=false){
    this.ai=new ParkingSmilerAI(level.map,{fits:(x,z,y)=>level.fits(x,z,y,false),illumination:p=>level.illumination(p),sight:(a,b)=>level.lineOfSight(a,b),hit});level.scene.add(this.group);
    faceTexture.colorSpace=THREE.SRGBColorSpace;
    this.face=new THREE.PlaneGeometry(1.18,1.18*610/720);
    // El negro del PNG no aporta luz. La niebla no debe iluminar ese fondo rectangular.
    this.faceMat=new THREE.MeshBasicMaterial({map:faceTexture,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,toneMapped:false});
    this.resources.push(faceTexture);
    const canvas=Object.assign(document.createElement('canvas'),{width:128,height:128}),ctx=canvas.getContext('2d')!,gradient=ctx.createRadialGradient(64,64,8,64,64,64);gradient.addColorStop(0,'rgba(1,4,3,.8)');gradient.addColorStop(1,'rgba(1,4,3,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    this.veil=new THREE.PlaneGeometry(1.05,.65);this.veilMat=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false,fog:true,side:THREE.DoubleSide});this.resources.push(this.face,this.faceMat,this.veil,this.veilMat,texture);
    this.smokeCount=low?6:12;this.smokeGeometry=new THREE.PlaneGeometry(1,1);this.smokeMaterial=this.veilMat.clone();this.smokeMaterial.opacity=.30;this.resources.push(this.smokeGeometry,this.smokeMaterial);
  }
  update(dt:number,target:SkinTarget,running:boolean){this.player={...target.pos};if(running)this.ai.update(dt,target);
    for(const section of this.ai.sections){
      const a=section.active;
      let root=this.visuals.get(section.id);
      if(a&&!root){
        root=new THREE.Group();
        const veil=new THREE.Mesh(this.veil,this.veilMat);
        veil.position.z=-.24;
        const face=new THREE.Mesh(this.face,this.faceMat.clone());
        face.name='Smiler face';
        face.position.set(0,.08,.025);
        this.resources.push(face.material);
        const smoke=new THREE.InstancedMesh(this.smokeGeometry,this.smokeMaterial,this.smokeCount);
        smoke.frustumCulled=false;
        root.add(veil,smoke,face);
        this.smoke.set(section.id,smoke);
        this.group.add(root);
        this.visuals.set(section.id,root);
      }
      if(!root)continue;
      const distance=a?Math.hypot(a.pos.x-target.pos.x,a.pos.y-target.pos.y,a.pos.z-target.pos.z):Infinity;
      root.visible=distance<22;
      if(a&&root.visible){
        const face=root.getObjectByName('Smiler face') as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
        face.material.opacity=1-THREE.MathUtils.smoothstep(distance,13,22);
        root.position.set(a.pos.x,a.pos.y+1.45,a.pos.z);
        root.lookAt(target.eye.x,target.eye.y,target.eye.z);
        const smoke=this.smoke.get(section.id)!;let radius=.8;const f=this.level.map.floors[a.pos.floor];for(const r of [...f.walls,...f.pillars]){const d=Math.hypot(Math.max(r.x-a.pos.x,0,a.pos.x-r.x-r.w),Math.max(r.z-a.pos.z,0,a.pos.z-r.z-r.d));radius=Math.min(radius,Math.max(.1,(d-.08)/1.45));}
        for(let i=0;i<this.smokeCount;i++){const phase=(this.ai.time*.19+i/this.smokeCount)%1,size=Math.sin(phase*Math.PI)*radius;this.smokePosition.set(Math.sin(i*2.3+this.ai.time*.2)*radius*.4,(phase-.5)*.85,-radius*(.2+(.5+.5*Math.cos(i*1.7+this.ai.time*.13))*.3));this.smokeScale.set(size*1.45,size*1.10,1);this.smokeRotation.setFromAxisAngle(this.smokeAxis,Math.sin(i+this.ai.time*.1)*.4);this.smokeMatrix.compose(this.smokePosition,this.smokeRotation,this.smokeScale);smoke.setMatrixAt(i,this.smokeMatrix);}smoke.instanceMatrix.needsUpdate=true;
      }}
  }
  inspect(near=false){const active=this.ai.sections.filter(s=>s.active).sort((a,b)=>Math.abs(a.floor-(this.player?.floor??0))-Math.abs(b.floor-(this.player?.floor??0)));const section=near&&this.selected?.active?this.selected:active[this.inspection++%active.length];if(!section?.active)return;const a=section.active;
    for(let i=0;i<24;i++){const angle=i*Math.PI/12,p=this.level.fits(a.pos.x+Math.sin(angle)*(near?4:7),a.pos.z+Math.cos(angle)*(near?4:7),a.pos.y);if(p&&p.floor===section.floor&&(!near||(parkingArea(this.level.map.floors[p.floor],p.x)===section.area&&this.level.illumination(p)<=SMILER_DARK))&&Math.abs(p.y-a.pos.y)<.1&&!this.level.map.floors[p.floor].rooms.some(r=>p.x>r.x&&p.x<r.x+r.w&&p.z>r.z&&p.z<r.z+r.d)&&this.level.lineOfSight({...p,y:p.y+1.65},{...a.pos,y:a.pos.y+1.45})){this.selected=section;this.last={...a.pos};return {position:p,target:{x:a.pos.x,y:a.pos.y+1.45,z:a.pos.z}};}}
  }
  clearDebug(){this.selected=undefined;}
  debug(){if(!this.selected)return '';const a=this.selected.active,p=a?.pos??this.last;return `DEBUG SMILER ${this.selected.id} ${a?.state.toUpperCase()??'COOLDOWN'} | GAZE ${this.ai.gazeSeconds.toFixed(1)}/10 S | DARK ${p?this.level.illumination(p).toFixed(3):'?'} <= ${SMILER_DARK} | BEAM ${a?.beamFor.toFixed(2)??'0'}/1.5 S | COOLDOWN ${Math.max(0,this.selected.cooldown-this.ai.time).toFixed(1)} S`;}
  dispose(){this.group.removeFromParent();this.resources.forEach(r=>r.dispose());this.visuals.clear();this.smoke.forEach(mesh=>mesh.dispose());this.smoke.clear();}
}
