import{g as Ve,a as bt,c as Xt,G as Zt,i as Yt,d as Se,b as tt,e as Kt,f as Jt}from"./v-@sentry_core-DF45WuLj.js";const H=Zt,C=H.document,he=H.navigator,vt="Report a Bug",Qt="Cancel",er="Send Bug Report",tr="Confirm",rr="Report a Bug",nr="your.email@example.org",or="Email",ar="What's the bug? What did you expect?",ir="Description",lr="Your Name",sr="Name",cr="Thank you for your report!",_r="(required)",ur="Add a screenshot",dr="Remove screenshot",fr="Highlight",pr="Hide",hr="Remove",yt="Unable to submit feedback with empty message",wt="No client setup, cannot send feedback.",Et="Unable to determine if Feedback was correctly sent.",Ct="Unable to send feedback. This could be because this domain is not in your list of allowed domains.",xt="Unable to send feedback. This could be because of network issues, or because you are using an ad-blocker.",gr="widget",mr="api",br=5e3,vr={ERROR_EMPTY_MESSAGE:yt,ERROR_NO_CLIENT:wt,ERROR_TIMEOUT:Et,ERROR_FORBIDDEN:Ct,ERROR_GENERIC:xt};function yr(e,t){return t?.[e]??vr[e]}function pe(e,t){return new Error(yr(e,t))}const wr=(e,t={includeReplay:!0})=>{const r=t.errorMessages;if(!e.message)throw pe("ERROR_EMPTY_MESSAGE",r);const n=Ve();if(!n)throw pe("ERROR_NO_CLIENT",r);e.tags&&Object.keys(e.tags).length&&bt().setTags(e.tags);const o=Xt({source:mr,url:Er(),...e},t);return new Promise((a,l)=>{const c=setTimeout(()=>{d(),l(pe("ERROR_TIMEOUT",r))},3e4),d=n.on("afterSendEvent",(s,_)=>{if(s.event_id===o)return clearTimeout(c),d(),_?.statusCode&&_.statusCode>=200&&_.statusCode<300?a(o):_?.statusCode===403?l(pe("ERROR_FORBIDDEN",r)):l(pe("ERROR_GENERIC",r))})})};function Er(){try{return H.document.location.href}catch{return""}}const ke=typeof __SENTRY_DEBUG__>"u"||__SENTRY_DEBUG__;function Cr(){return!(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(he.userAgent)||/Macintosh/i.test(he.userAgent)&&he.maxTouchPoints&&he.maxTouchPoints>1||!isSecureContext)}function Ee(e,t){return{...e,...t,tags:{...e.tags,...t.tags},onFormOpen:()=>{t.onFormOpen?.(),e.onFormOpen?.()},onFormClose:()=>{t.onFormClose?.(),e.onFormClose?.()},onSubmitSuccess:(r,n)=>{t.onSubmitSuccess?.(r,n),e.onSubmitSuccess?.(r,n)},onSubmitError:r=>{t.onSubmitError?.(r),e.onSubmitError?.(r)},onFormSubmitted:()=>{t.onFormSubmitted?.(),e.onFormSubmitted?.()},themeDark:{...e.themeDark,...t.themeDark},themeLight:{...e.themeLight,...t.themeLight}}}function xr(e){const t=C.createElement("style");return t.textContent=`
.widget__actor {
  position: fixed;
  z-index: var(--z-index);
  margin: var(--page-margin);
  inset: var(--actor-inset);

  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;

  font-family: inherit;
  font-size: var(--font-size);
  font-weight: 600;
  line-height: 1.14em;
  text-decoration: none;

  background: var(--actor-background, var(--background));
  border-radius: var(--actor-border-radius, 1.7em/50%);
  border: var(--actor-border, var(--border));
  box-shadow: var(--actor-box-shadow, var(--box-shadow));
  color: var(--actor-color, var(--foreground));
  fill: var(--actor-color, var(--foreground));
  cursor: pointer;
  opacity: 1;
  transition: transform 0.2s ease-in-out;
  transform: translate(0, 0) scale(1);
}
.widget__actor[aria-hidden="true"] {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transform: translate(0, 16px) scale(0.98);
}

.widget__actor:hover {
  background: var(--actor-hover-background, var(--background));
  filter: var(--interactive-filter);
}

.widget__actor svg {
  width: 1.14em;
  height: 1.14em;
}

@media (max-width: 600px) {
  .widget__actor span {
    display: none;
  }
}
`,e&&t.setAttribute("nonce",e),t}function G(e,t){return Object.entries(t).forEach(([r,n])=>{e.setAttributeNS(null,r,n)}),e}const _e=20,Sr="http://www.w3.org/2000/svg";function kr(){const e=c=>H.document.createElementNS(Sr,c),t=G(e("svg"),{width:`${_e}`,height:`${_e}`,viewBox:`0 0 ${_e} ${_e}`,fill:"var(--actor-color, var(--foreground))"}),r=G(e("g"),{clipPath:"url(#clip0_57_80)"}),n=G(e("path"),{"fill-rule":"evenodd","clip-rule":"evenodd",d:"M15.6622 15H12.3997C12.2129 14.9959 12.031 14.9396 11.8747 14.8375L8.04965 12.2H7.49956V19.1C7.4875 19.3348 7.3888 19.5568 7.22256 19.723C7.05632 19.8892 6.83435 19.9879 6.59956 20H2.04956C1.80193 19.9968 1.56535 19.8969 1.39023 19.7218C1.21511 19.5467 1.1153 19.3101 1.11206 19.0625V12.2H0.949652C0.824431 12.2017 0.700142 12.1783 0.584123 12.1311C0.468104 12.084 0.362708 12.014 0.274155 11.9255C0.185602 11.8369 0.115689 11.7315 0.0685419 11.6155C0.0213952 11.4995 -0.00202913 11.3752 -0.00034808 11.25V3.75C-0.00900498 3.62067 0.0092504 3.49095 0.0532651 3.36904C0.0972798 3.24712 0.166097 3.13566 0.255372 3.04168C0.344646 2.94771 0.452437 2.87327 0.571937 2.82307C0.691437 2.77286 0.82005 2.74798 0.949652 2.75H8.04965L11.8747 0.1625C12.031 0.0603649 12.2129 0.00407221 12.3997 0H15.6622C15.9098 0.00323746 16.1464 0.103049 16.3215 0.278167C16.4966 0.453286 16.5964 0.689866 16.5997 0.9375V3.25269C17.3969 3.42959 18.1345 3.83026 18.7211 4.41679C19.5322 5.22788 19.9878 6.32796 19.9878 7.47502C19.9878 8.62209 19.5322 9.72217 18.7211 10.5333C18.1345 11.1198 17.3969 11.5205 16.5997 11.6974V14.0125C16.6047 14.1393 16.5842 14.2659 16.5395 14.3847C16.4948 14.5035 16.4268 14.6121 16.3394 14.7042C16.252 14.7962 16.147 14.8698 16.0307 14.9206C15.9144 14.9714 15.7891 14.9984 15.6622 15ZM1.89695 10.325H1.88715V4.625H8.33715C8.52423 4.62301 8.70666 4.56654 8.86215 4.4625L12.6872 1.875H14.7247V13.125H12.6872L8.86215 10.4875C8.70666 10.3835 8.52423 10.327 8.33715 10.325H2.20217C2.15205 10.3167 2.10102 10.3125 2.04956 10.3125C1.9981 10.3125 1.94708 10.3167 1.89695 10.325ZM2.98706 12.2V18.1625H5.66206V12.2H2.98706ZM16.5997 9.93612V5.01393C16.6536 5.02355 16.7072 5.03495 16.7605 5.04814C17.1202 5.13709 17.4556 5.30487 17.7425 5.53934C18.0293 5.77381 18.2605 6.06912 18.4192 6.40389C18.578 6.73866 18.6603 7.10452 18.6603 7.47502C18.6603 7.84552 18.578 8.21139 18.4192 8.54616C18.2605 8.88093 18.0293 9.17624 17.7425 9.41071C17.4556 9.64518 17.1202 9.81296 16.7605 9.90191C16.7072 9.91509 16.6536 9.9265 16.5997 9.93612Z"});t.appendChild(r).appendChild(n);const o=e("defs"),a=G(e("clipPath"),{id:"clip0_57_80"}),l=G(e("rect"),{width:`${_e}`,height:`${_e}`,fill:"white"});return a.appendChild(l),o.appendChild(a),t.appendChild(o).appendChild(a).appendChild(l),t}function Rr({triggerLabel:e,triggerAriaLabel:t,shadow:r,styleNonce:n}){const o=C.createElement("button");if(o.type="button",o.className="widget__actor",o.ariaHidden="false",o.ariaLabel=t||e||vt,o.appendChild(kr()),e){const l=C.createElement("span");l.appendChild(C.createTextNode(e)),o.appendChild(l)}const a=xr(n);return{el:o,appendToDom(){r.appendChild(a),r.appendChild(o)},removeFromDom(){o.remove(),a.remove()},show(){o.ariaHidden="false"},hide(){o.ariaHidden="true"}}}const St="rgba(88, 74, 192, 1)",Tr={foreground:"#2b2233",background:"#ffffff",accentForeground:"white",accentBackground:St,successColor:"#268d75",errorColor:"#df3338",border:"1.5px solid rgba(41, 35, 47, 0.13)",boxShadow:"0px 4px 24px 0px rgba(43, 34, 51, 0.12)",outline:"1px auto var(--accent-background)",interactiveFilter:"brightness(95%)"},rt={foreground:"#ebe6ef",background:"#29232f",accentForeground:"white",accentBackground:St,successColor:"#2da98c",errorColor:"#f55459",border:"1.5px solid rgba(235, 230, 239, 0.15)",boxShadow:"0px 4px 24px 0px rgba(43, 34, 51, 0.12)",outline:"1px auto var(--accent-background)",interactiveFilter:"brightness(150%)"};function nt(e){return`
  --foreground: ${e.foreground};
  --background: ${e.background};
  --accent-foreground: ${e.accentForeground};
  --accent-background: ${e.accentBackground};
  --success-color: ${e.successColor};
  --error-color: ${e.errorColor};
  --border: ${e.border};
  --box-shadow: ${e.boxShadow};
  --outline: ${e.outline};
  --interactive-filter: ${e.interactiveFilter};
  `}function ot({colorScheme:e,themeDark:t,themeLight:r,styleNonce:n}){const o=C.createElement("style");return o.textContent=`
:host {
  --font-family: system-ui, 'Helvetica Neue', Arial, sans-serif;
  --font-size: 14px;
  --z-index: 100000;

  --page-margin: 16px;
  --inset: auto 0 0 auto;
  --actor-inset: var(--inset);

  font-family: var(--font-family);
  font-size: var(--font-size);

  ${e!=="system"?`color-scheme: only ${e};`:""}

  ${nt(e==="dark"?{...rt,...t}:{...Tr,...r})}
}

${e==="system"?`
@media (prefers-color-scheme: dark) {
  :host {
    color-scheme: only dark;

    ${nt({...rt,...t})}
  }
}`:""}
`,n&&o.setAttribute("nonce",n),o}const bn=({lazyLoadIntegration:e,getModalIntegration:t,getScreenshotIntegration:r})=>(({id:o="sentry-feedback",autoInject:a=!0,showBranding:l=!0,isEmailRequired:c=!1,isNameRequired:d=!1,showEmail:s=!0,showName:_=!0,enableScreenshot:f=!0,useSentryUser:i={email:"email",name:"username"},tags:u,styleNonce:h,scriptNonce:v,colorScheme:y="system",themeLight:b={},themeDark:p={},addScreenshotButtonLabel:F=ur,cancelButtonLabel:k=Qt,confirmButtonLabel:O=tr,emailLabel:I=or,emailPlaceholder:q=nr,formTitle:N=rr,isRequiredLabel:W=_r,messageLabel:T=ir,messagePlaceholder:D=ar,nameLabel:m=sr,namePlaceholder:w=lr,removeScreenshotButtonLabel:A=dr,submitButtonLabel:$=er,successMessageText:ee=cr,triggerLabel:le=vt,triggerAriaLabel:P="",highlightToolText:U=fr,hideToolText:M=pr,removeHighlightText:z=hr,errorEmptyMessageText:ve=yt,errorNoClientText:Y=wt,errorTimeoutText:se=Et,errorForbiddenText:ye=Ct,errorGenericText:Bt=xt,onFormOpen:Gt,onFormClose:qt,onSubmitSuccess:zt,onSubmitError:Wt,onFormSubmitted:Vt}={})=>{const te={id:o,autoInject:a,showBranding:l,isEmailRequired:c,isNameRequired:d,showEmail:s,showName:_,enableScreenshot:f,useSentryUser:i,tags:u,styleNonce:h,scriptNonce:v,colorScheme:y,themeDark:p,themeLight:b,triggerLabel:le,triggerAriaLabel:P,cancelButtonLabel:k,submitButtonLabel:$,confirmButtonLabel:O,formTitle:N,emailLabel:I,emailPlaceholder:q,messageLabel:T,messagePlaceholder:D,nameLabel:m,namePlaceholder:w,successMessageText:ee,isRequiredLabel:W,addScreenshotButtonLabel:F,removeScreenshotButtonLabel:A,highlightToolText:U,hideToolText:M,removeHighlightText:z,errorEmptyMessageText:ve,errorNoClientText:Y,errorTimeoutText:se,errorForbiddenText:ye,errorGenericText:Bt,onFormClose:qt,onFormOpen:Gt,onSubmitError:Wt,onSubmitSuccess:zt,onFormSubmitted:Vt};let V=null,ce=null,fe=[];const Je=E=>{if(!V){const L=C.createElement("div");L.id=String(E.id),C.body.appendChild(L),V=L.attachShadow({mode:"open"}),ce=ot(E),V.appendChild(ce)}return V},Qe=async E=>{const L=E.enableScreenshot&&Cr();let K,B;try{K=(t?t():await e("feedbackModalIntegration",v))(),tt(K)}catch{throw ke&&Se.error("[Feedback] Error when trying to load feedback integrations. Try using `feedbackSyncIntegration` in your `Sentry.init`."),new Error("[Feedback] Missing feedback modal integration!")}try{const ne=L?r?r():await e("feedbackScreenshotIntegration",v):void 0;ne&&(B=ne(),tt(B))}catch{ke&&Se.error("[Feedback] Missing feedback screenshot integration. Proceeding without screenshots.")}const j={ERROR_EMPTY_MESSAGE:E.errorEmptyMessageText,ERROR_NO_CLIENT:E.errorNoClientText,ERROR_TIMEOUT:E.errorTimeoutText,ERROR_FORBIDDEN:E.errorForbiddenText,ERROR_GENERIC:E.errorGenericText},we=(ne,jt)=>wr(ne,{includeReplay:!0,...jt,errorMessages:j}),re=K.createDialog({options:{...E,onFormClose:()=>{re?.close(),E.onFormClose?.()},onFormSubmitted:()=>{re?.close(),E.onFormSubmitted?.()}},screenshotIntegration:B,sendFeedback:we,shadow:Je(E)});return re},et=(E,L={})=>{const K=Ee(te,L),B=typeof E=="string"?C.querySelector(E):typeof E.addEventListener=="function"?E:null;if(!B)throw ke&&Se.error("[Feedback] Unable to attach to target element"),new Error("Unable to attach to target element");let j=null;const we=async()=>{j||(j=await Qe({...K,onFormSubmitted:()=>{j?.removeFromDom(),K.onFormSubmitted?.()}})),j.appendToDom(),j.open()};B.addEventListener("click",we);const re=()=>{fe=fe.filter(ne=>ne!==re),j?.removeFromDom(),j=null,B.removeEventListener("click",we)};return fe.push(re),re},He=(E={})=>{const L=Ee(te,E),K=Je(L),B=Rr({triggerLabel:L.triggerLabel,triggerAriaLabel:L.triggerAriaLabel,shadow:K,styleNonce:h});return et(B.el,{...L,onFormOpen(){B.hide()},onFormClose(){B.show()},onFormSubmitted(){B.show()}}),B};return{name:"Feedback",setupOnce(){!Yt()||!te.autoInject||(C.readyState==="loading"?C.addEventListener("DOMContentLoaded",()=>He().appendToDom()):He().appendToDom())},attachTo:et,createWidget(E={}){const L=He(Ee(te,E));return L.appendToDom(),L},async createForm(E={}){return Qe(Ee(te,E))},setTheme(E){if(te.colorScheme=E,V){const L=ot(te);ce?V.replaceChild(L,ce):V.prepend(L),ce=L}},remove(){V&&(V.parentElement?.remove(),V=null,ce=null),fe.forEach(E=>E()),fe=[]}}});function vn(){return Ve()?.getIntegrationByName("Feedback")}var De,S,kt,J,at,Rt,Tt,Oe,Re,ge,Lt,je,qe,ze,Me={},Ae=[],Lr=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,$e=Array.isArray;function X(e,t){for(var r in t)e[r]=t[r];return e}function Xe(e){e&&e.parentNode&&e.parentNode.removeChild(e)}function g(e,t,r){var n,o,a,l={};for(a in t)a=="key"?n=t[a]:a=="ref"?o=t[a]:l[a]=t[a];if(arguments.length>2&&(l.children=arguments.length>3?De.call(arguments,2):r),typeof e=="function"&&e.defaultProps!=null)for(a in e.defaultProps)l[a]===void 0&&(l[a]=e.defaultProps[a]);return Te(e,l,n,o,null)}function Te(e,t,r,n,o){var a={type:e,props:t,key:r,ref:n,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:o??++kt,__i:-1,__u:0};return o==null&&S.vnode!=null&&S.vnode(a),a}function me(e){return e.children}function Le(e,t){this.props=e,this.context=t}function ae(e,t){if(t==null)return e.__?ae(e.__,e.__i+1):null;for(var r;t<e.__k.length;t++)if((r=e.__k[t])!=null&&r.__e!=null)return r.__e;return typeof e.type=="function"?ae(e):null}function Fr(e){if(e.__P&&e.__d){var t=e.__v,r=t.__e,n=[],o=[],a=X({},t);a.__v=t.__v+1,S.vnode&&S.vnode(a),Ze(e.__P,a,t,e.__n,e.__P.namespaceURI,32&t.__u?[r]:null,n,r??ae(t),!!(32&t.__u),o),a.__v=t.__v,a.__.__k[a.__i]=a,Dt(n,a,o),t.__e=t.__=null,a.__e!=r&&Ft(a)}}function Ft(e){if((e=e.__)!=null&&e.__c!=null)return e.__e=e.__c.base=null,e.__k.some(function(t){if(t!=null&&t.__e!=null)return e.__e=e.__c.base=t.__e}),Ft(e)}function it(e){(!e.__d&&(e.__d=!0)&&J.push(e)&&!Ie.__r++||at!=S.debounceRendering)&&((at=S.debounceRendering)||Rt)(Ie)}function Ie(){try{for(var e,t=1;J.length;)J.length>t&&J.sort(Tt),e=J.shift(),t=J.length,Fr(e)}finally{J.length=Ie.__r=0}}function Mt(e,t,r,n,o,a,l,c,d,s,_){var f,i,u,h,v,y,b=n&&n.__k||Ae,p=t.length;for(d=Mr(r,t,b,d,p),f=0;f<p;f++)(u=r.__k[f])!=null&&(i=u.__i!=-1&&b[u.__i]||Me,u.__i=f,y=Ze(e,u,i,o,a,l,c,d,s,_),h=u.__e,u.ref&&i.ref!=u.ref&&(i.ref&&Ye(i.ref,null,u),_.push(u.ref,u.__c||h,u)),v==null&&h!=null&&(v=h),4&u.__u?(d=At(u,d,e),i.__e&&(i.__e=null)):typeof u.type=="function"&&y!==void 0?d=y:h&&(d=h.nextSibling),u.__u&=-7);return r.__e=v,d}function Mr(e,t,r,n,o){var a,l,c,d,s,_=r.length,f=_,i=0;for(e.__k=new Array(o),a=0;a<o;a++)(l=t[a])!=null&&typeof l!="boolean"&&typeof l!="function"?(typeof l=="string"||typeof l=="number"||typeof l=="bigint"||l.constructor==String?l=e.__k[a]=Te(null,l,null,null,null):$e(l)?l=e.__k[a]=Te(me,{children:l},null,null,null):l.constructor===void 0&&l.__b>0?l=e.__k[a]=Te(l.type,l.props,l.key,l.ref?l.ref:null,l.__v):e.__k[a]=l,d=a+i,l.__=e,l.__b=e.__b+1,c=null,(s=l.__i=Ar(l,r,d,f))!=-1&&(f--,(c=r[s])&&(c.__u|=2)),c==null||c.__v==null?(s==-1&&(o>_?i--:o<_&&i++),typeof l.type!="function"&&(l.__u|=4)):s!=d&&(s==d-1?i--:s==d+1?i++:(s>d?i--:i++,l.__u|=4))):e.__k[a]=null;if(f)for(a=0;a<_;a++)(c=r[a])!=null&&(2&c.__u)==0&&(c.__e==n&&(n=ae(c)),Ht(c,c));return n}function At(e,t,r){var n,o;if(typeof e.type=="function"){for(n=e.__k,o=0;n&&o<n.length;o++)n[o]&&(n[o].__=e,t=At(n[o],t,r));return t}e.__e!=t&&(t&&e.type&&!t.parentNode&&(t=ae(e)),t=r.insertBefore(e.__e,t||null));do t=t&&t.nextSibling;while(t!=null&&t.nodeType==8);return t}function Ar(e,t,r,n){var o,a,l,c=e.key,d=e.type,s=t[r],_=s!=null&&(2&s.__u)==0;if(s===null&&c==null||_&&c==s.key&&d==s.type)return r;if(n>(_?1:0)){for(o=r-1,a=r+1;o>=0||a<t.length;)if((s=t[l=o>=0?o--:a++])!=null&&(2&s.__u)==0&&c==s.key&&d==s.type)return l}return-1}function lt(e,t,r){t[0]=="-"?e.setProperty(t,r??""):e[t]=r==null?"":typeof r!="number"||Lr.test(t)?r:r+"px"}function Ce(e,t,r,n,o){var a,l;e:if(t=="style")if(typeof r=="string")e.style.cssText=r;else{if(typeof n=="string"&&(e.style.cssText=n=""),n)for(t in n)r&&t in r||lt(e.style,t,"");if(r)for(t in r)n&&r[t]==n[t]||lt(e.style,t,r[t])}else if(t[0]=="o"&&t[1]=="n")a=t!=(t=t.replace(Lt,"$1")),l=t.toLowerCase(),t=l in e||t=="onFocusOut"||t=="onFocusIn"?l.slice(2):t.slice(2),e.l||(e.l={}),e.l[t+a]=r,r?n?r[ge]=n[ge]:(r[ge]=je,e.addEventListener(t,a?ze:qe,a)):e.removeEventListener(t,a?ze:qe,a);else{if(o=="http://www.w3.org/2000/svg")t=t.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(t!="width"&&t!="height"&&t!="href"&&t!="list"&&t!="form"&&t!="tabIndex"&&t!="download"&&t!="rowSpan"&&t!="colSpan"&&t!="role"&&t!="popover"&&t in e)try{e[t]=r??"";break e}catch{}typeof r=="function"||(r==null||r===!1&&t[4]!="-"?e.removeAttribute(t):e.setAttribute(t,t=="popover"&&r==1?"":r))}}function st(e){return function(t){if(this.l){var r=this.l[t.type+e];if(t[Re]==null)t[Re]=je++;else if(t[Re]<r[ge])return;return r(S.event?S.event(t):t)}}}function Ze(e,t,r,n,o,a,l,c,d,s){var _,f,i,u,h,v,y,b,p,F,k,O,I,q,N,W,T=t.type;if(t.constructor!==void 0)return null;128&r.__u&&(d=!!(32&r.__u),a=[c=t.__e=r.__e]),(_=S.__b)&&_(t);e:if(typeof T=="function"){f=l.length;try{if(p=t.props,F=T.prototype&&T.prototype.render,k=(_=T.contextType)&&n[_.__c],O=_?k?k.props.value:_.__:n,r.__c?b=(i=t.__c=r.__c).__=i.__E:(F?t.__c=i=new T(p,O):(t.__c=i=new Le(p,O),i.constructor=T,i.render=Dr),k&&k.sub(i),i.state||(i.state={}),i.__n=n,u=i.__d=!0,i.__h=[],i._sb=[]),F&&i.__s==null&&(i.__s=i.state),F&&T.getDerivedStateFromProps!=null&&(i.__s==i.state&&(i.__s=X({},i.__s)),X(i.__s,T.getDerivedStateFromProps(p,i.__s))),h=i.props,v=i.state,i.__v=t,u)F&&T.getDerivedStateFromProps==null&&i.componentWillMount!=null&&i.componentWillMount(),F&&i.componentDidMount!=null&&i.__h.push(i.componentDidMount);else{if(F&&T.getDerivedStateFromProps==null&&p!==h&&i.componentWillReceiveProps!=null&&i.componentWillReceiveProps(p,O),t.__v==r.__v||!i.__e&&i.shouldComponentUpdate!=null&&i.shouldComponentUpdate(p,i.__s,O)===!1){t.__v!=r.__v&&(i.props=p,i.state=i.__s,i.__d=!1),t.__e=r.__e,t.__k=r.__k,t.__k.some(function(D){D&&(D.__=t)}),Ae.push.apply(i.__h,i._sb),i._sb=[],i.__h.length&&l.push(i),c=ae(r);break e}i.componentWillUpdate!=null&&i.componentWillUpdate(p,i.__s,O),F&&i.componentDidUpdate!=null&&i.__h.push(function(){i.componentDidUpdate(h,v,y)})}if(i.context=O,i.props=p,i.__P=e,i.__e=!1,I=S.__r,q=0,F)i.state=i.__s,i.__d=!1,I&&I(t),_=i.render(i.props,i.state,i.context),Ae.push.apply(i.__h,i._sb),i._sb=[];else do i.__d=!1,I&&I(t),_=i.render(i.props,i.state,i.context),i.state=i.__s;while(i.__d&&++q<25);i.state=i.__s,i.getChildContext!=null&&(n=X(X({},n),i.getChildContext())),F&&!u&&i.getSnapshotBeforeUpdate!=null&&(y=i.getSnapshotBeforeUpdate(h,v)),N=_!=null&&_.type===me&&_.key==null?$t(_.props.children):_,c=Mt(e,$e(N)?N:[N],t,r,n,o,a,l,c,d,s),i.base=t.__e,t.__u&=-161,i.__h.length&&l.push(i),b&&(i.__E=i.__=null)}catch(D){if(l.length=f,t.__v=null,d||a!=null){if(D.then){for(t.__u|=d?160:128;c&&c.nodeType==8&&c.nextSibling;)c=c.nextSibling;a!=null&&(a[a.indexOf(c)]=null),t.__e=c}else if(a!=null)for(W=a.length;W--;)Xe(a[W])}else t.__e=r.__e;t.__k==null&&(t.__k=r.__k||[]),D.then||It(t),S.__e(D,t,r)}}else a==null&&t.__v==r.__v?(t.__k=r.__k,t.__e=r.__e):c=t.__e=Ir(r.__e,t,r,n,o,a,l,d,s);return(_=S.diffed)&&_(t),128&t.__u?void 0:c}function It(e){e&&(e.__c&&(e.__c.__e=!0),e.__k&&e.__k.some(It))}function Dt(e,t,r){for(var n=0;n<r.length;n++)Ye(r[n],r[++n],r[++n]);S.__c&&S.__c(t,e),e.some(function(o){try{e=o.__h,o.__h=[],e.some(function(a){a.call(o)})}catch(a){S.__e(a,o.__v)}})}function $t(e){return typeof e!="object"||e==null||e.__b>0?e:$e(e)?e.map($t):e.constructor!==void 0?null:X({},e)}function Ir(e,t,r,n,o,a,l,c,d){var s,_,f,i,u,h,v,y=r.props||Me,b=t.props,p=t.type;if(p=="svg"?o="http://www.w3.org/2000/svg":p=="math"?o="http://www.w3.org/1998/Math/MathML":o||(o="http://www.w3.org/1999/xhtml"),a!=null){for(s=0;s<a.length;s++)if((u=a[s])&&"setAttribute"in u==!!p&&(p?u.localName==p:u.nodeType==3)){e=u,a[s]=null;break}}if(e==null){if(p==null)return document.createTextNode(b);e=document.createElementNS(o,p,b.is&&b),c&&(S.__m&&S.__m(t,a),c=!1),a=null}if(p==null)y===b||c&&e.data==b||(e.data=b);else{if(a=p=="textarea"&&b.defaultValue!=null?null:a&&De.call(e.childNodes),!c&&a!=null)for(y={},s=0;s<e.attributes.length;s++)y[(u=e.attributes[s]).name]=u.value;for(s in y)u=y[s],s=="dangerouslySetInnerHTML"?f=u:s=="children"||s in b||s=="value"&&"defaultValue"in b||s=="checked"&&"defaultChecked"in b||Ce(e,s,null,u,o);for(s in b)u=b[s],s=="children"?i=u:s=="dangerouslySetInnerHTML"?_=u:s=="value"?h=u:s=="checked"?v=u:c&&typeof u!="function"||y[s]===u||Ce(e,s,u,y[s],o);if(_)c||f&&(_.__html==f.__html||_.__html==e.innerHTML)||(e.innerHTML=_.__html),t.__k=[];else if(f&&(e.innerHTML=""),Mt(t.type=="template"?e.content:e,$e(i)?i:[i],t,r,n,p=="foreignObject"?"http://www.w3.org/1999/xhtml":o,a,l,a?a[0]:r.__k&&ae(r,0),c,d),a!=null)for(s=a.length;s--;)Xe(a[s]);c&&p!="textarea"||(s="value",p=="progress"&&h==null?e.removeAttribute("value"):h!=null&&(h!==e[s]||p=="progress"&&!h||p=="option"&&h!=y[s])&&Ce(e,s,h,y[s],o),s="checked",v!=null&&v!=e[s]&&Ce(e,s,v,y[s],o))}return e}function Ye(e,t,r){try{if(typeof e=="function"){var n=typeof e.__u=="function";n&&e.__u(),n&&t==null||(e.__u=e(t))}else e.current=t}catch(o){S.__e(o,r)}}function Ht(e,t,r){var n,o;if(S.unmount&&S.unmount(e),(n=e.ref)&&(n.current&&n.current!=e.__e||Ye(n,null,t)),(n=e.__c)!=null){if(n.componentWillUnmount)try{n.componentWillUnmount()}catch(a){S.__e(a,t)}n.base=n.__P=n.__n=null}if(n=e.__k)for(o=0;o<n.length;o++)n[o]&&Ht(n[o],t,r||typeof e.type!="function");r||Xe(e.__e),e.__c=e.__=e.__e=void 0}function Dr(e,t,r){return this.constructor(e,r)}function $r(e,t,r){var n,o,a,l;t==document&&(t=document.documentElement),S.__&&S.__(e,t),o=(n=!1)?null:t.__k,a=[],l=[],Ze(t,e=t.__k=g(me,null,[e]),o||Me,Me,t.namespaceURI,o?null:t.firstChild?De.call(t.childNodes):null,a,o?o.__e:t.firstChild,n,l),Dt(a,e,l),e.props.children=null}De=Ae.slice,S={__e:function(e,t,r,n){for(var o,a,l;t=t.__;)if((o=t.__c)&&!o.__)try{if((a=o.constructor)&&a.getDerivedStateFromError!=null&&(o.setState(a.getDerivedStateFromError(e)),l=o.__d),o.componentDidCatch!=null&&(o.componentDidCatch(e,n||{}),l=o.__d),l)return o.__E=o}catch(c){e=c}throw e}},kt=0,Le.prototype.setState=function(e,t){var r;r=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=X({},this.state),typeof e=="function"&&(e=e(X({},r),this.props)),e&&X(r,e),e!=null&&this.__v&&(t&&this._sb.push(t),it(this))},Le.prototype.forceUpdate=function(e){this.__v&&(this.__e=!0,e&&this.__h.push(e),it(this))},Le.prototype.render=me,J=[],Rt=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,Tt=function(e,t){return e.__v.__b-t.__v.__b},Ie.__r=0,Oe=Math.random().toString(8),Re="__d"+Oe,ge="__a"+Oe,Lt=/(PointerCapture)$|Capture$/i,je=0,qe=st(!1),ze=st(!0);var Z,x,Ne,ct,de=0,Ot=[],R=S,_t=R.__b,ut=R.__r,dt=R.diffed,ft=R.__c,pt=R.unmount,ht=R.__;function ie(e,t){R.__h&&R.__h(x,e,de||t),de=0;var r=x.__H||(x.__H={__:[],__h:[]});return e>=r.__.length&&r.__.push({}),r.__[e]}function oe(e){return de=1,Nt(Ut,e)}function Nt(e,t,r){var n=ie(Z++,2);if(n.t=e,!n.__c&&(n.__=[r?r(t):Ut(void 0,t),function(c){var d=n.__N?n.__N[0]:n.__[0],s=n.t(d,c);d!==s&&(n.__N=[s,n.__[1]],n.__c.setState({}))}],n.__c=x,!x.__f)){var o=function(c,d,s){if(!n.__c.__H)return!0;var _=!1,f=n.__c.props!==c;if(n.__c.__H.__.some(function(u){if(u.__N){_=!0;var h=u.__[0];u.__=u.__N,u.__N=void 0,h!==u.__[0]&&(f=!0)}}),a){var i=a.call(this,c,d,s);return _?i||f:i}return!_||f};x.__f=!0;var a=x.shouldComponentUpdate,l=x.componentWillUpdate;x.componentWillUpdate=function(c,d,s){if(this.__e){var _=a;a=void 0,o(c,d,s),a=_}l&&l.call(this,c,d,s)},x.shouldComponentUpdate=o}return n.__N||n.__}function Hr(e,t){var r=ie(Z++,3);!R.__s&&Ke(r.__H,t)&&(r.__=e,r.u=t,x.__H.__h.push(r))}function Pt(e,t){var r=ie(Z++,4);!R.__s&&Ke(r.__H,t)&&(r.__=e,r.u=t,x.__h.push(r))}function Or(e){return de=5,be(function(){return{current:e}},[])}function Nr(e,t,r){de=6,Pt(function(){if(typeof e=="function"){var n=e(t());return function(){e(null),n&&typeof n=="function"&&n()}}if(e)return e.current=t(),function(){return e.current=null}},r==null?r:r.concat(e))}function be(e,t){var r=ie(Z++,7);return Ke(r.__H,t)&&(r.__=e(),r.__H=t,r.__h=e),r.__}function ue(e,t){return de=8,be(function(){return e},t)}function Pr(e){var t=x.context[e.__c],r=ie(Z++,9);return r.c=e,t?(r.__==null&&(r.__=!0,t.sub(x)),t.props.value):e.__}function Ur(e,t){R.useDebugValue&&R.useDebugValue(t?t(e):e)}function Br(e){var t=ie(Z++,10),r=oe();return t.__=e,x.componentDidCatch||(x.componentDidCatch=function(n,o){t.__&&t.__(n,o),r[1](n)}),[r[0],function(){r[1](void 0)}]}function Gr(){var e=ie(Z++,11);if(!e.__){for(var t=x.__v;t!==null&&!t.__m&&t.__!==null;)t=t.__;var r=t.__m||(t.__m=[0,0]);e.__="P"+r[0]+"-"+r[1]++}return e.__}function qr(){for(var e;e=Ot.shift();){var t=e.__H;if(e.__P&&t)try{t.__h.some(Fe),t.__h.some(We),t.__h=[]}catch(r){t.__h=[],R.__e(r,e.__v)}}}R.__b=function(e){x=null,_t&&_t(e)},R.__=function(e,t){e&&t.__k&&t.__k.__m&&(e.__m=t.__k.__m),ht&&ht(e,t)},R.__r=function(e){ut&&ut(e),Z=0;var t=(x=e.__c).__H;t&&(Ne===x?(t.__h=[],x.__h=[],t.__.some(function(r){r.__N&&(r.__=r.__N),r.u=r.__N=void 0})):(t.__h.some(Fe),t.__h.some(We),t.__h=[],Z=0)),Ne=x},R.diffed=function(e){dt&&dt(e);var t=e.__c;t&&t.__H&&(t.__H.__h.length&&(Ot.push(t)!==1&&ct===R.requestAnimationFrame||((ct=R.requestAnimationFrame)||zr)(qr)),t.__H.__.some(function(r){r.u&&(r.__H=r.u,r.u=void 0)})),Ne=x=null},R.__c=function(e,t){t.some(function(r){try{r.__h.some(Fe),r.__h=r.__h.filter(function(n){return!n.__||We(n)})}catch(n){t.some(function(o){o.__h&&(o.__h=[])}),t=[],R.__e(n,r.__v)}}),ft&&ft(e,t)},R.unmount=function(e){pt&&pt(e);var t,r=e.__c;r&&r.__H&&(r.__H.__.some(function(n){try{Fe(n)}catch(o){t=o}}),r.__H=void 0,t&&R.__e(t,r.__v))};var gt=typeof requestAnimationFrame=="function";function zr(e){var t,r=function(){clearTimeout(n),gt&&cancelAnimationFrame(t),setTimeout(e)},n=setTimeout(r,35);gt&&(t=requestAnimationFrame(r))}function Fe(e){var t=x,r=e.__c;typeof r=="function"&&(e.__c=void 0,r()),x=t}function We(e){var t=x;e.__c=e.__(),x=t}function Ke(e,t){return!e||e.length!==t.length||t.some(function(r,n){return r!==e[n]})}function Ut(e,t){return typeof t=="function"?t(e):t}const Wr=Object.defineProperty({__proto__:null,useCallback:ue,useContext:Pr,useDebugValue:Ur,useEffect:Hr,useErrorBoundary:Br,useId:Gr,useImperativeHandle:Nr,useLayoutEffect:Pt,useMemo:be,useReducer:Nt,useRef:Or,useState:oe},Symbol.toStringTag,{value:"Module"}),Vr="http://www.w3.org/2000/svg";function jr(){const e=n=>C.createElementNS(Vr,n),t=G(e("svg"),{width:"32",height:"30",viewBox:"0 0 72 66",fill:"inherit"}),r=G(e("path"),{transform:"translate(11, 11)",d:"M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z"});return t.appendChild(r),t}function Xr({options:e}){const t=be(()=>({__html:jr().outerHTML}),[]);return g("h2",{class:"dialog__header"},g("span",{class:"dialog__title"},e.formTitle),e.showBranding?g("a",{class:"brand-link",target:"_blank",href:"https://sentry.io/welcome/",title:"Powered by Sentry",rel:"noopener noreferrer",dangerouslySetInnerHTML:t}):null)}function Zr(e,t){const r=[];return t.isNameRequired&&!e.name&&r.push(t.nameLabel),t.isEmailRequired&&!e.email&&r.push(t.emailLabel),e.message||r.push(t.messageLabel),r}function Pe(e,t){const r=e.get(t);return typeof r=="string"?r.trim():""}function Yr({options:e,defaultEmail:t,defaultName:r,onFormClose:n,onSubmit:o,onSubmitSuccess:a,onSubmitError:l,showEmail:c,showName:d,screenshotInput:s}){const{tags:_,addScreenshotButtonLabel:f,removeScreenshotButtonLabel:i,cancelButtonLabel:u,emailLabel:h,emailPlaceholder:v,isEmailRequired:y,isNameRequired:b,messageLabel:p,messagePlaceholder:F,nameLabel:k,namePlaceholder:O,submitButtonLabel:I,isRequiredLabel:q}=e,[N,W]=oe(!1),[T,D]=oe(null),[m,w]=oe(!1),A=s?.input,[$,ee]=oe(null),le=ue(M=>{ee(M),w(!1)},[]),P=ue(M=>{const z=Zr(M,{emailLabel:h,isEmailRequired:y,isNameRequired:b,messageLabel:p,nameLabel:k});return z.length>0?D(`Please enter in the following required fields: ${z.join(", ")}`):D(null),z.length===0},[h,y,b,p,k]),U=ue(async M=>{W(!0);try{if(M.preventDefault(),!(M.target instanceof HTMLFormElement))return;const z=new FormData(M.target),ve=await(s&&m?s.value():void 0),Y={name:Pe(z,"name"),email:Pe(z,"email"),message:Pe(z,"message"),attachments:ve?[ve]:void 0};if(!P(Y))return;try{const se=await o({name:Y.name,email:Y.email,message:Y.message,source:gr,tags:_},{attachments:Y.attachments});a(Y,se)}catch(se){ke&&Se.error(se);const ye=se;D(ye.message),l(ye)}}finally{W(!1)}},[s&&m,a,l]);return g("form",{class:"form",onSubmit:U},A&&m?g(A,{onError:le}):null,g("fieldset",{class:"form__right","data-sentry-feedback":!0,disabled:N},g("div",{class:"form__top"},T?g("div",{class:"form__error-container"},T):null,d?g("label",{for:"name",class:"form__label"},g(Ue,{label:k,isRequiredLabel:q,isRequired:b}),g("input",{class:"form__input",defaultValue:r,id:"name",name:"name",placeholder:O,required:b,type:"text"})):g("input",{"aria-hidden":!0,value:r,name:"name",type:"hidden"}),c?g("label",{for:"email",class:"form__label"},g(Ue,{label:h,isRequiredLabel:q,isRequired:y}),g("input",{class:"form__input",defaultValue:t,id:"email",name:"email",placeholder:v,required:y,type:"email"})):g("input",{"aria-hidden":!0,value:t,name:"email",type:"hidden"}),g("label",{for:"message",class:"form__label"},g(Ue,{label:p,isRequiredLabel:q,isRequired:!0}),g("textarea",{autoFocus:!0,class:"form__input form__input--textarea",id:"message",name:"message",placeholder:F,required:!0,rows:5})),A?g("label",{for:"screenshot",class:"form__label"},g("button",{class:"btn btn--default",disabled:N,type:"button",onClick:()=>{ee(null),w(M=>!M)}},m?i:f),$?g("div",{class:"form__error-container"},$.message):null):null),g("div",{class:"btn-group"},g("button",{class:"btn btn--primary",disabled:N,type:"submit"},I),g("button",{class:"btn btn--default",disabled:N,type:"button",onClick:n},u))))}function Ue({label:e,isRequired:t,isRequiredLabel:r}){return g("span",{class:"form__label__text"},e,t&&g("span",{class:"form__label__text--required"},r))}const xe=16,mt=17,Kr="http://www.w3.org/2000/svg";function Jr(){const e=d=>H.document.createElementNS(Kr,d),t=G(e("svg"),{width:`${xe}`,height:`${mt}`,viewBox:`0 0 ${xe} ${mt}`,fill:"inherit"}),r=G(e("g"),{clipPath:"url(#clip0_57_156)"}),n=G(e("path"),{"fill-rule":"evenodd","clip-rule":"evenodd",d:"M3.55544 15.1518C4.87103 16.0308 6.41775 16.5 8 16.5C10.1217 16.5 12.1566 15.6571 13.6569 14.1569C15.1571 12.6566 16 10.6217 16 8.5C16 6.91775 15.5308 5.37103 14.6518 4.05544C13.7727 2.73985 12.5233 1.71447 11.0615 1.10897C9.59966 0.503466 7.99113 0.34504 6.43928 0.653721C4.88743 0.962403 3.46197 1.72433 2.34315 2.84315C1.22433 3.96197 0.462403 5.38743 0.153721 6.93928C-0.15496 8.49113 0.00346625 10.0997 0.608967 11.5615C1.21447 13.0233 2.23985 14.2727 3.55544 15.1518ZM4.40546 3.1204C5.46945 2.40946 6.72036 2.03 8 2.03C9.71595 2.03 11.3616 2.71166 12.575 3.92502C13.7883 5.13838 14.47 6.78405 14.47 8.5C14.47 9.77965 14.0905 11.0306 13.3796 12.0945C12.6687 13.1585 11.6582 13.9878 10.476 14.4775C9.29373 14.9672 7.99283 15.0953 6.73777 14.8457C5.48271 14.596 4.32987 13.9798 3.42502 13.075C2.52018 12.1701 1.90397 11.0173 1.65432 9.76224C1.40468 8.50718 1.5328 7.20628 2.0225 6.02404C2.5122 4.8418 3.34148 3.83133 4.40546 3.1204Z"}),o=G(e("path"),{d:"M6.68775 12.4297C6.78586 12.4745 6.89218 12.4984 7 12.5C7.11275 12.4955 7.22315 12.4664 7.32337 12.4145C7.4236 12.3627 7.51121 12.2894 7.58 12.2L12 5.63999C12.0848 5.47724 12.1071 5.28902 12.0625 5.11098C12.0178 4.93294 11.9095 4.77744 11.7579 4.67392C11.6064 4.57041 11.4221 4.52608 11.24 4.54931C11.0579 4.57254 10.8907 4.66173 10.77 4.79999L6.88 10.57L5.13 8.56999C5.06508 8.49566 4.98613 8.43488 4.89768 8.39111C4.80922 8.34735 4.713 8.32148 4.61453 8.31498C4.51605 8.30847 4.41727 8.32147 4.32382 8.35322C4.23038 8.38497 4.14413 8.43484 4.07 8.49999C3.92511 8.63217 3.83692 8.81523 3.82387 9.01092C3.81083 9.2066 3.87393 9.39976 4 9.54999L6.43 12.24C6.50187 12.3204 6.58964 12.385 6.68775 12.4297Z"});t.appendChild(r).append(o,n);const a=e("defs"),l=G(e("clipPath"),{id:"clip0_57_156"}),c=G(e("rect"),{width:`${xe}`,height:`${xe}`,fill:"white",transform:"translate(0 0.5)"});return l.appendChild(c),a.appendChild(l),t.appendChild(a).appendChild(l).appendChild(c),t}function Qr({open:e,onFormSubmitted:t,...r}){const n=r.options,o=be(()=>({__html:Jr().outerHTML}),[]),[a,l]=oe(null),c=ue(()=>{a&&(clearTimeout(a),l(null)),t()},[a]),d=ue((s,_)=>{r.onSubmitSuccess(s,_),l(setTimeout(()=>{t(),l(null)},br))},[t]);return g(me,null,a?g("div",{class:"success__position",onClick:c},g("div",{class:"success__content"},n.successMessageText,g("span",{class:"success__icon",dangerouslySetInnerHTML:o}))):g("dialog",{class:"dialog",onClick:n.onFormClose,open:e},g("div",{class:"dialog__position"},g("div",{class:"dialog__content",onClick:s=>{s.stopPropagation()}},g(Xr,{options:n}),g(Yr,{...r,onSubmitSuccess:d})))))}const en=`
.dialog {
  position: fixed;
  z-index: var(--z-index);
  margin: 0;
  inset: 0;

  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  height: 100vh;
  width: 100vw;

  color: var(--dialog-color, var(--foreground));
  fill: var(--dialog-color, var(--foreground));
  line-height: 1.75em;

  background-color: rgba(0, 0, 0, 0.05);
  border: none;
  inset: 0;
  opacity: 1;
  transition: opacity 0.2s ease-in-out;
}

.dialog__position {
  position: fixed;
  z-index: var(--z-index);
  inset: var(--dialog-inset);
  padding: var(--page-margin);
  display: flex;
  max-height: calc(100vh - (2 * var(--page-margin)));
}
@media (max-width: 600px) {
  .dialog__position {
    inset: var(--page-margin);
    padding: 0;
  }
}

.dialog__position:has(.editor) {
  inset: var(--page-margin);
  padding: 0;
}

.dialog:not([open]) {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}
.dialog:not([open]) .dialog__content {
  transform: translate(0, -16px) scale(0.98);
}

.dialog__content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: var(--dialog-padding, 24px);
  max-width: 100%;
  width: 100%;
  max-height: 100%;
  overflow: auto;

  background: var(--dialog-background, var(--background));
  border-radius: var(--dialog-border-radius, 20px);
  border: var(--dialog-border, var(--border));
  box-shadow: var(--dialog-box-shadow, var(--box-shadow));
  transform: translate(0, 0) scale(1);
  transition: transform 0.2s ease-in-out;
}

`,tn=`
.dialog__header {
  display: flex;
  gap: 4px;
  justify-content: space-between;
  font-weight: var(--dialog-header-weight, 600);
  margin: 0;
}
.dialog__title {
  align-self: center;
  width: var(--form-width, 272px);
}

@media (max-width: 600px) {
  .dialog__title {
    width: auto;
  }
}

.dialog__position:has(.editor) .dialog__title {
  width: auto;
}


.brand-link {
  display: inline-flex;
}
.brand-link:focus-visible {
  outline: var(--outline);
}
`,rn=`
.form {
  display: flex;
  overflow: auto;
  flex-direction: row;
  gap: 16px;
  flex: 1 0;
}

.form fieldset {
  border: none;
  margin: 0;
  padding: 0;
}

.form__right {
  flex: 0 0 auto;
  display: flex;
  overflow: auto;
  flex-direction: column;
  justify-content: space-between;
  gap: 20px;
  width: var(--form-width, 100%);
}

.dialog__position:has(.editor) .form__right {
  width: var(--form-width, 272px);
}

.form__top {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form__error-container {
  color: var(--error-color);
  fill: var(--error-color);
  width: 0;
  min-width: 100%;
  overflow-wrap: break-word;
}

.form__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0px;
}

.form__label__text {
  display: flex;
  gap: 4px;
  align-items: center;
}

.form__label__text--required {
  font-size: 0.85em;
}

.form__input {
  font-family: inherit;
  line-height: inherit;
  background: transparent;
  box-sizing: border-box;
  border: var(--input-border, var(--border));
  border-radius: var(--input-border-radius, 6px);
  color: var(--input-color, inherit);
  fill: var(--input-color, inherit);
  font-size: var(--input-font-size, inherit);
  font-weight: var(--input-font-weight, 500);
  padding: 6px 12px;
}

.form__input::placeholder {
  opacity: 0.65;
  color: var(--input-placeholder-color, inherit);
  filter: var(--interactive-filter);
}

.form__input:focus-visible {
  outline: var(--input-focus-outline, var(--outline));
}

.form__input--textarea {
  font-family: inherit;
  resize: vertical;
}

.error {
  color: var(--error-color);
  fill: var(--error-color);
}
`,nn=`
.btn-group {
  display: grid;
  gap: 8px;
}

.btn {
  line-height: inherit;
  border: var(--button-border, var(--border));
  border-radius: var(--button-border-radius, 6px);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--button-font-size, inherit);
  font-weight: var(--button-font-weight, 600);
  padding: var(--button-padding, 6px 16px);
}
.btn[disabled] {
  opacity: 0.6;
  pointer-events: none;
}

.btn--primary {
  color: var(--button-primary-color, var(--accent-foreground));
  fill: var(--button-primary-color, var(--accent-foreground));
  background: var(--button-primary-background, var(--accent-background));
  border: var(--button-primary-border, var(--border));
  border-radius: var(--button-primary-border-radius, 6px);
  font-weight: var(--button-primary-font-weight, 500);
}
.btn--primary:hover {
  color: var(--button-primary-hover-color, var(--accent-foreground));
  fill: var(--button-primary-hover-color, var(--accent-foreground));
  background: var(--button-primary-hover-background, var(--accent-background));
  filter: var(--interactive-filter);
}
.btn--primary:focus-visible {
  background: var(--button-primary-hover-background, var(--accent-background));
  filter: var(--interactive-filter);
  outline: var(--button-primary-focus-outline, var(--outline));
}

.btn--default {
  color: var(--button-color, var(--foreground));
  fill: var(--button-color, var(--foreground));
  background: var(--button-background, var(--background));
  border: var(--button-border, var(--border));
  border-radius: var(--button-border-radius, 6px);
  font-weight: var(--button-font-weight, 500);
}
.btn--default:hover {
  color: var(--button-color, var(--foreground));
  fill: var(--button-color, var(--foreground));
  background: var(--button-hover-background, var(--background));
  filter: var(--interactive-filter);
}
.btn--default:focus-visible {
  background: var(--button-hover-background, var(--background));
  filter: var(--interactive-filter);
  outline: var(--button-focus-outline, var(--outline));
}
`,on=`
.success__position {
  position: fixed;
  inset: var(--dialog-inset);
  padding: var(--page-margin);
  z-index: var(--z-index);
}
.success__content {
  background: var(--success-background, var(--background));
  border: var(--success-border, var(--border));
  border-radius: var(--success-border-radius, 1.7em/50%);
  box-shadow: var(--success-box-shadow, var(--box-shadow));
  font-weight: var(--success-font-weight, 600);
  color: var(--success-color);
  fill: var(--success-color);
  padding: 12px 24px;
  line-height: 1.75em;

  display: grid;
  align-items: center;
  grid-auto-flow: column;
  gap: 6px;
  cursor: default;
}

.success__icon {
  display: flex;
}
`;function an(e){const t=C.createElement("style");return t.textContent=`
:host {
  --dialog-inset: var(--inset);
}

${en}
${tn}
${rn}
${nn}
${on}
`,e&&t.setAttribute("nonce",e),t}function ln(){const e=bt().getUser(),t=Kt().getUser(),r=Jt().getUser();return e&&Object.keys(e).length?e:t&&Object.keys(t).length?t:r}const yn=(()=>({name:"FeedbackModal",setupOnce(){},createDialog:({options:e,screenshotIntegration:t,sendFeedback:r,shadow:n})=>{const o=n,a=e.useSentryUser,l=ln(),c=C.createElement("div"),d=an(e.styleNonce);let s="";const _={get el(){return c},appendToDom(){!o.contains(d)&&!o.contains(c)&&(o.appendChild(d),o.appendChild(c))},removeFromDom(){c.remove(),d.remove(),C.body.style.overflow=s},open(){i(!0),e.onFormOpen?.(),Ve()?.emit("openFeedbackWidget"),s=C.body.style.overflow,C.body.style.overflow="hidden"},close(){i(!1),C.body.style.overflow=s}},f=t?.createInput({h:g,hooks:Wr,dialog:_,options:e}),i=u=>{$r(g(Qr,{options:e,screenshotInput:f,showName:e.showName||e.isNameRequired,showEmail:e.showEmail||e.isEmailRequired,defaultName:String(a&&l?.[a.name]||""),defaultEmail:String(a&&l?.[a.email]||""),onFormClose:()=>{i(!1),e.onFormClose?.()},onSubmit:r,onSubmitSuccess:(h,v)=>{i(!1),e.onSubmitSuccess?.(h,v)},onSubmitError:h=>{e.onSubmitError?.(h)},onFormSubmitted:()=>{e.onFormSubmitted?.()},open:u}),c)};return _}}));function sn({h:e}){return function(){return e("svg",{"data-test-id":"icon-close",viewBox:"0 0 16 16",fill:"#2B2233",height:"25px",width:"25px"},e("circle",{r:"7",cx:"8",cy:"8",fill:"white"}),e("path",{strokeWidth:"1.5",d:"M8,16a8,8,0,1,1,8-8A8,8,0,0,1,8,16ZM8,1.53A6.47,6.47,0,1,0,14.47,8,6.47,6.47,0,0,0,8,1.53Z"}),e("path",{strokeWidth:"1.5",d:"M5.34,11.41a.71.71,0,0,1-.53-.22.74.74,0,0,1,0-1.06l5.32-5.32a.75.75,0,0,1,1.06,1.06L5.87,11.19A.74.74,0,0,1,5.34,11.41Z"}),e("path",{strokeWidth:"1.5",d:"M10.66,11.41a.74.74,0,0,1-.53-.22L4.81,5.87A.75.75,0,0,1,5.87,4.81l5.32,5.32a.74.74,0,0,1,0,1.06A.71.71,0,0,1,10.66,11.41Z"}))}}function cn(e){const t=C.createElement("style"),r="#1A141F",n="#302735";return t.textContent=`
.editor {
  display: flex;
  flex-grow: 1;
  flex-direction: column;
}

.editor__image-container {
  justify-items: center;
  padding: 15px;
  position: relative;
  height: 100%;
  border-radius: var(--menu-border-radius, 6px);

  background-color: ${r};
  background-image: repeating-linear-gradient(
      -145deg,
      transparent,
      transparent 8px,
      ${r} 8px,
      ${r} 11px
    ),
    repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 15px,
      ${n} 15px,
      ${n} 16px
    );
}

.editor__canvas-container {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.editor__canvas-container > * {
  object-fit: contain;
  position: absolute;
}

.editor__tool-container {
  padding-top: 8px;
  display: flex;
  justify-content: center;
}

.editor__tool-bar {
  display: flex;
  gap: 8px;
}

.editor__tool {
  display: flex;
  padding: 8px 12px;
  justify-content: center;
  align-items: center;
  border: var(--button-border, var(--border));
  border-radius: var(--button-border-radius, 6px);
  background: var(--button-background, var(--background));
  color: var(--button-color, var(--foreground));
}

.editor__tool--active {
  background: var(--button-primary-background, var(--accent-background));
  color: var(--button-primary-color, var(--accent-foreground));
}

.editor__rect {
  position: absolute;
  z-index: 2;
}

.editor__rect button {
  opacity: 0;
  position: absolute;
  top: -12px;
  right: -12px;
  cursor: pointer;
  padding: 0;
  z-index: 3;
  border: none;
  background: none;
}

.editor__rect:hover button {
  opacity: 1;
}
`,e&&t.setAttribute("nonce",e),t}function _n({h:e}){return function({action:r,setAction:n,options:o}){return e("div",{class:"editor__tool-container"},e("div",{class:"editor__tool-bar"},e("button",{type:"button",class:`editor__tool ${r==="highlight"?"editor__tool--active":""}`,onClick:()=>{n(r==="highlight"?"":"highlight")}},o.highlightToolText),e("button",{type:"button",class:`editor__tool ${r==="hide"?"editor__tool--active":""}`,onClick:()=>{n(r==="hide"?"":"hide")}},o.hideToolText)))}}const un=2,dn=300;function fn(e,t){return new Promise(r=>{const n=setTimeout(r,t);let o=e;const a=()=>{if(o-=1,o>0){H.requestAnimationFrame(a);return}clearTimeout(n),r()};H.requestAnimationFrame(a)})}function pn({hooks:e}){function t(){const[r,n]=e.useState(H.devicePixelRatio??1);return e.useEffect(()=>{const o=()=>{n(H.devicePixelRatio)},a=matchMedia(`(resolution: ${H.devicePixelRatio}dppx)`);return a.addEventListener("change",o),()=>{a.removeEventListener("change",o)}},[]),r}return function({onBeforeScreenshot:n,onScreenshot:o,onAfterScreenshot:a,onError:l}){const c=t();e.useEffect(()=>{(async()=>{n(),await fn(un,dn);const s=await he.mediaDevices.getDisplayMedia({video:{width:H.innerWidth*c,height:H.innerHeight*c},audio:!1,monitorTypeSurfaces:"exclude",preferCurrentTab:!0,selfBrowserSurface:"include",surfaceSwitching:"exclude"}),_=C.createElement("video");await new Promise((f,i)=>{_.srcObject=s,_.onloadedmetadata=()=>{o(_,c),s.getTracks().forEach(u=>u.stop()),f()},_.play().catch(i)}),a()})().catch(l)},[])}}function hn(e,t,r){switch(e.type){case"highlight":{t.save(),t.shadowColor="rgba(0, 0, 0, 0.7)",t.shadowBlur=50,t.fillStyle=r,t.fillRect(e.x-1,e.y-1,e.w+2,e.h+2),t.clearRect(e.x,e.y,e.w,e.h),t.restore();break}case"hide":t.fillStyle="rgb(0, 0, 0)",t.fillRect(e.x,e.y,e.w,e.h);break}}function Q(e,t,r){if(!e)return;const n=e.getContext("2d",t);n&&r(e,n)}function Be(e,t){Q(e,{alpha:!0},(r,n)=>{n.drawImage(t,0,0,t.width,t.height,0,0,r.width,r.height)})}function Ge(e,t,r){Q(e,{alpha:!0},(n,o)=>{r.length&&(o.fillStyle="rgba(0, 0, 0, 0.25)",o.fillRect(0,0,n.width,n.height)),r.forEach(a=>{hn(a,o,t)})})}function gn({h:e,hooks:t,outputBuffer:r,dialog:n,options:o}){const a=pn({hooks:t}),l=_n({h:e}),c=sn({h:e}),d={__html:cn(o.styleNonce).innerText},s=n.el.style,_=({screenshot:f})=>{const[i,u]=t.useState("highlight"),[h,v]=t.useState([]),y=t.useRef(null),b=t.useRef(null),p=t.useRef(null),F=t.useRef(null),[k,O]=t.useState(1),I=t.useMemo(()=>{const m=C.getElementById(o.id);if(!m)return"white";const w=getComputedStyle(m);return w.getPropertyValue("--button-primary-background")||w.getPropertyValue("--accent-background")},[o.id]);t.useLayoutEffect(()=>{const m=()=>{const w=y.current;w&&(Q(f.canvas,{alpha:!1},A=>{const $=Math.min(w.clientWidth/A.width,w.clientHeight/A.height);O($)}),(w.clientHeight===0||w.clientWidth===0)&&setTimeout(m,0))};return m(),H.addEventListener("resize",m),()=>{H.removeEventListener("resize",m)}},[f]);const q=t.useCallback((m,w)=>{Q(m,{alpha:!0},(A,$)=>{$.scale(w,w),A.width=f.canvas.width,A.height=f.canvas.height})},[f]);t.useEffect(()=>{q(b.current,f.dpi),Be(b.current,f.canvas)},[f]),t.useEffect(()=>{q(p.current,f.dpi),Q(p.current,{alpha:!0},(m,w)=>{w.clearRect(0,0,m.width,m.height)}),Ge(p.current,I,h)},[h,I]),t.useEffect(()=>{q(r,f.dpi),Be(r,f.canvas),Q(C.createElement("canvas"),{alpha:!0},(m,w)=>{w.scale(f.dpi,f.dpi),m.width=f.canvas.width,m.height=f.canvas.height,Ge(m,I,h),Be(r,m)})},[h,f,I]);const N=m=>{if(!i||!F.current)return;const w=F.current.getBoundingClientRect(),A={type:i,x:(m.clientX-w.x)/k,y:(m.clientY-w.y)/k},$=(P,U)=>{const M=(U.clientX-w.x)/k,z=(U.clientY-w.y)/k;return{type:P.type,x:Math.min(P.x,M),y:Math.min(P.y,z),w:Math.abs(M-P.x),h:Math.abs(z-P.y)}},ee=P=>{Q(p.current,{alpha:!0},(U,M)=>{M.clearRect(0,0,U.width,U.height)}),Ge(p.current,I,[...h,$(A,P)])},le=P=>{const U=$(A,P);U.w*k>=1&&U.h*k>=1&&v(M=>[...M,U]),C.removeEventListener("mousemove",ee),C.removeEventListener("mouseup",le)};C.addEventListener("mousemove",ee),C.addEventListener("mouseup",le)},W=t.useCallback(m=>w=>{w.preventDefault(),w.stopPropagation(),v(A=>{const $=[...A];return $.splice(m,1),$})},[]),T={width:`${f.canvas.width*k}px`,height:`${f.canvas.height*k}px`},D=m=>{m.stopPropagation()};return e("div",{class:"editor"},e("style",{nonce:o.styleNonce,dangerouslySetInnerHTML:d}),e("div",{class:"editor__image-container"},e("div",{class:"editor__canvas-container",ref:y},e("canvas",{ref:b,id:"background",style:T}),e("canvas",{ref:p,id:"foreground",style:T}),e("div",{ref:F,onMouseDown:N,style:T},h.map((m,w)=>e("div",{key:w,class:"editor__rect",style:{top:`${m.y*k}px`,left:`${m.x*k}px`,width:`${m.w*k}px`,height:`${m.h*k}px`}},e("button",{"aria-label":o.removeHighlightText,onClick:W(w),onMouseDown:D,onMouseUp:D,type:"button"},e(c,null))))))),e(l,{options:o,action:i,setAction:u}))};return function({onError:i}){const[u,h]=t.useState();return a({onBeforeScreenshot:t.useCallback(()=>{s.display="none"},[]),onScreenshot:t.useCallback((v,y)=>{Q(C.createElement("canvas"),{alpha:!1},(b,p)=>{p.scale(y,y),b.width=v.videoWidth,b.height=v.videoHeight,p.drawImage(v,0,0,b.width,b.height),h({canvas:b,dpi:y})}),r.width=v.videoWidth,r.height=v.videoHeight},[]),onAfterScreenshot:t.useCallback(()=>{s.display="block"},[]),onError:t.useCallback(v=>{s.display="block",i(v)},[])}),u?e(_,{screenshot:u}):e("div",null)}}const wn=(()=>({name:"FeedbackScreenshot",setupOnce(){},createInput:({h:e,hooks:t,dialog:r,options:n})=>{const o=C.createElement("canvas");return{input:gn({h:e,hooks:t,outputBuffer:o,dialog:r,options:n}),value:async()=>{const a=await new Promise(l=>{o.toBlob(l,"image/png")});if(a)return{data:new Uint8Array(await a.arrayBuffer()),filename:"screenshot.png",contentType:"application/png"}}}}}));export{yn as a,bn as b,wn as f,vn as g,wr as s};
